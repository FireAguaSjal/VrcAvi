const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 297;
const AUTH_FILE = path.join(__dirname, 'auth.json');
const SALT = "vrc_avatar_sync_v4_2026";
const SPECIAL_IP = "2a06:98c0:3600::103";

// In-memory state
let authDb = {}; 
let ipBlocks = new Map(); 
let userAvatars = new Map(); 
let userNames = new Map(); 
let logs = [];

function log(msg, type = "INFO") {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] [${type}] ${msg}`;
    console.log(entry);
    logs.push(entry);
    if (logs.length > 200) logs.shift();
}

function normalizeId(rawId) {
    if (!rawId) return null;
    return rawId.trim().replace(/-/g, '_').replace(/^usr_/i, '').replace(/^avtr_/i, '');
}

// Persistence functions
function loadAuth() {
    try {
        if (fs.existsSync(AUTH_FILE)) {
            const rawData = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
            authDb = {};
            // Normalize all existing keys on load
            Object.keys(rawData).forEach(k => {
                authDb[normalizeId(k)] = rawData[k];
            });
            log("Auth database loaded and normalized.");
        } else {
            authDb = {};
            saveAuth();
            log("No auth file found, created new one.", "WARN");
        }
    } catch (e) {
        log(`Load failed, creating fresh DB: ${e.message}`, "ERROR");
        authDb = {};
        saveAuth();
    }
}

function saveAuth() {
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(authDb, null, 2));
    } catch (e) {
        log(`Auth save failed: ${e.message}`, "ERROR");
    }
}

function hash(val) {
    if (!val) return null;
    return crypto.createHash('sha256').update(val + SALT).digest('hex');
}

function getIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    return (forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress).trim();
}

function isBlocked(ip) {
    if (ip === SPECIAL_IP) return false;
    if (!ipBlocks.has(ip)) return false;
    if (Date.now() > ipBlocks.get(ip)) {
        ipBlocks.delete(ip);
        log(`IP ${ip} is now unblocked.`, "SECURITY");
        return false;
    }
    return true;
}

function blockIp(ip, mins = 5) {
    if (ip === SPECIAL_IP) {
        log(`REJECTED BLOCK: ${ip} is on the impossible to block list.`, "SECURITY");
        return;
    }
    log(`BLOCKING IP ${ip} for ${mins} minutes`, "SECURITY");
    ipBlocks.set(ip, Date.now() + (mins * 60 * 1000));
}

function handleRedir(res, ip) {
    if (ip === SPECIAL_IP) return false;
    log(`Redirecting unauthorized IP ${ip} to intro.html`, "AUTH");
    res.writeHead(302, { 'Location': '/intro.html' });
    res.end();
    return true;
}

// Formats normalized ID (e.g. f559_bd90) into VRChat style (e.g. usr_f559-bd90)
function formatId(rawId, prefix = "usr") {
    if (!rawId) return null;
    // Replace ALL underscores/dashes with dashes first
    const clean = rawId.replace(/_/g, '-');
    return `${prefix}_${clean}`;
}

loadAuth();

const server = http.createServer((req, res) => {
    try {
        const parsedUrl = url.parse(req.url, true);
        // Normalize pathname: treat - and _ interchangeably for routing and lookups
        const normalizedPathname = parsedUrl.pathname.replace(/-/g, '_');
        const ip = getIp(req);
        
        // Universal Access: intro.html
        if (normalizedPathname === '/intro.html') {
            const introPath = path.join(__dirname, 'intro.html');
            if (fs.existsSync(introPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(fs.readFileSync(introPath));
                return;
            }
        }

        // Favicon Redirection
        if (parsedUrl.pathname === '/favicon.ico') {
            res.writeHead(302, { 'Location': '/intro.html' });
            res.end();
            return;
        }

        log(`${req.method} ${parsedUrl.pathname} from ${ip}`);

        if (isBlocked(ip)) {
            res.writeHead(403);
            res.end("IP Blocked");
            return;
        }

        // Root & Dashboard Redirection
        if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/chat') {
            if (handleRedir(res, ip)) {
                return; 
            }
        }

        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // API: Polling
        if (normalizedPathname.startsWith('/poll/')) {
            const userId = normalizeId(normalizedPathname.split('/')[2]);
            
            const { pin, token, username } = parsedUrl.query;

            if (!userId) {
                res.writeHead(400); res.end("Missing User ID");
                return;
            }

            const userRecord = authDb[userId];

            // Case 1: Brand New User
            if (!userRecord) {
                if (!pin) {
                    log(`Poll from unknown user ${userId} - PIN required`, "AUTH");
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: "PIN_REQUIRED" }));
                    return;
                }
                const rawToken = crypto.randomBytes(16).toString('hex');
                authDb[userId] = {
                    pinHash: hash(pin),
                    tokenHash: hash(rawToken),
                    ipHash: hash(ip),
                    lastSeen: Date.now()
                };
                saveAuth();
                log(`REGISTERED: ${username || userId} (${ip}) - Created new PIN and Token`, "SECURITY");
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token: rawToken, status: "ok" }));
                return;
            }

            // Case 2: Validation
            if (!pin || hash(pin) !== userRecord.pinHash) {
                log(`FAILED PIN: ${userId} from ${ip}`, "SECURITY");
                blockIp(ip);
                res.writeHead(401); res.end("Invalid PIN");
                return;
            }

            // Duplicate IP Check
            if (userRecord.ipHash !== hash(ip) && (Date.now() - userRecord.lastSeen) < 40000) {
                log(`CONFLICT: ${userId} accessed from ${ip} while session active on another IP`, "SECURITY");
                blockIp(ip);
                res.writeHead(403); res.end("Multiple IP Conflict");
                return;
            }

            // Token Renewal (If > 40s or token mismatch or IP change)
            const sessionActive = (Date.now() - userRecord.lastSeen) < 40000;
            if (!sessionActive || hash(token) !== userRecord.tokenHash || userRecord.ipHash !== hash(ip)) {
                const rawToken = crypto.randomBytes(16).toString('hex');
                userRecord.tokenHash = hash(rawToken);
                userRecord.ipHash = hash(ip);
                userRecord.lastSeen = Date.now();
                saveAuth();
                log(`TOKEN REFRESH: ${username || userId} (${ip}) - Session resumed/expired`, "AUTH");
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token: rawToken, status: "ok", msg: "Token Refreshed" }));
                return;
            }

            userRecord.lastSeen = Date.now();
            if (username) userNames.set(userId, username);
            
            const rawAv = userAvatars.get(userId);
            const formattedAv = rawAv ? formatId(rawAv, "avtr") : null;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ avatarId: formattedAv, status: "ok" }));
            return;
        }

        // API: Change (Path-based: /change/:userId/:avatarId/:pin/:token)
        if (normalizedPathname.startsWith('/change/')) {
            const segments = normalizedPathname.split('/');
            // Expected: ["", "change", userId, avatarId, pin, token]
            let userId = normalizeId(segments[2]);
            let avatarId = normalizeId(segments[3]);
            let pin = segments[4];
            let token = segments[5];
            
            const userRecord = authDb[userId];
            const isDashboard = (pin === "DASHBOARD" && token === "DASHBOARD" && (ip === "::1" || ip === "127.0.0.1" || ip === SPECIAL_IP));

            if (!isDashboard) {
                if (!userRecord) {
                    log(`CHANGE DENIED: User ${userId} not found from ${ip}`, "SECURITY");
                    res.writeHead(404); res.end("User Not Found");
                    return;
                }
                if (hash(pin) !== userRecord.pinHash) {
                    log(`CHANGE DENIED: Invalid PIN for ${userId} from ${ip}`, "SECURITY");
                    res.writeHead(401); res.end("Invalid PIN");
                    return;
                }
                if (hash(token) !== userRecord.tokenHash) {
                    log(`CHANGE DENIED: Invalid Token for ${userId} from ${ip}`, "SECURITY");
                    res.writeHead(401); res.end("Invalid Token");
                    return;
                }
            }

            if (avatarId) {
                userAvatars.set(userId, avatarId);
                log(`AVATAR SET (Path API): ${userId} -> ${avatarId}`, "INFO");
                res.writeHead(200); res.end("OK");
            } else {
                res.writeHead(400); res.end("Missing avatarId in path");
            }
            return;
        }

        // UI: Dashboard
        if (parsedUrl.pathname === '/chat') {
            let usersHtml = '';
            Object.keys(authDb).forEach(id => {
                const name = userNames.get(id) || 'Unknown';
                const record = authDb[id];
                const isOnline = (Date.now() - record.lastSeen) < 40000;
                const currentAv = userAvatars.get(id) || null;
                const displayAv = (ip === SPECIAL_IP) ? "HIDDEN (IP Restriction)" : (currentAv ? formatId(currentAv, "avtr") : "None");
                const formattedUserId = formatId(id, "usr");

                usersHtml += `
                    <div style="margin-bottom:15px; border:1px solid #333; padding:15px; border-radius:8px; background:#1a1a1a; opacity: ${isOnline ? 1 : 0.6}">
                        <strong style="color:#00ff9d">${name}</strong> <small style="color:#555">(${formattedUserId})</small> 
                        ${isOnline ? '<span style="color:lawngreen; font-size:10px;">● ONLINE</span>' : '<span style="color:#555; font-size:10px;">○ OFFLINE</span>'}<br>
                        <div style="margin:10px 0;">Target: <code style="color:#eee">${displayAv}</code></div>
                        <input type="text" id="av_${id}" placeholder="avtr_..." style="padding:5px; width:200px; background:#000; color:#fff; border:1px solid #444;">
                        <button onclick="setAvatar('${id}')" style="padding:5px 15px; background:#00ff9d; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Set</button>
                    </div>
                `;
            });

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>VRC Sync Dashboard v4</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: #eee; padding: 20px; }
                        .log-container { background: #000; padding: 15px; border: 1px solid #333; height: 350px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 11px; margin-top:20px; }
                        .log-line { border-bottom: 1px solid #111; padding: 2px 0; }
                    </style>
                </head>
                <body>
                    <h1>VRChat Sync Dashboard \${ip === SPECIAL_IP ? '<small>(Restricted)</small>' : ''}</h1>
                    <div id="users">\${usersHtml || '<p style="color:#555">No users registered yet.</p>'}</div>
                    <div class="log-container">
                        \${logs.map(l => \`<div class="log-line">\${l}</div>\`).reverse().join('')}
                    </div>
                    <script>
                        function setAvatar(userId) {
                            const avId = document.getElementById('av_' + userId).value.trim();
                            if (!avId) return;
                            // Dashboard override for convenience
                            fetch('/change/' + userId + '/' + avId + '/DASHBOARD/DASHBOARD').then(() => location.reload());
                        }
                        setInterval(() => location.reload(), 10000);
                    </script>
                </body>
                </html>
            `);
            return;
        }

        res.writeHead(404);
        res.end("Not Found");

    } catch (globalError) {
        log(`CRITICAL SERVER ERROR: ${globalError.message}`, "FATAL");
        if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal Server Error");
        }
    }
});

server.listen(PORT, () => {
    log(`SECURE VRChat Sync Server v4 running at http://localhost:${PORT}`);
    log(`Persistent Auth File: ${AUTH_FILE}`);
});
