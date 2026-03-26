const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const HTTP_PORT = 297;
const HTTPS_PORT = 298;
const HOST = "0.0.0.0";

const sslOptions = {
    key: fs.readFileSync("key.pem"),
    cert: fs.readFileSync("cert.pem")
};

// 🔥 Persistent storage file
const DATA_FILE = path.join(__dirname, "lastMessage.txt");

// Load last message (if exists)
let lastMessage = "";
if (fs.existsSync(DATA_FILE)) {
    lastMessage = fs.readFileSync(DATA_FILE, "utf-8");
}

// Shared request handler
function requestHandler(req, res) {
    if (req.url === "/") {
        res.writeHead(302, { Location: "/chat" });
        return res.end();
    }

    if (req.url === "/chat") {
        fs.readFile("index.html", (err, data) => {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(data);
        });
        return;
    }

    if (req.url === "/index.js") {
        fs.readFile("index.js", (err, data) => {
            res.writeHead(200, { "Content-Type": "application/javascript" });
            res.end(data);
        });
        return;
    }

    res.writeHead(404);
    res.end("Not found");
}

const httpServer = http.createServer(requestHandler);
const httpsServer = https.createServer(sslOptions, requestHandler);

const wss_http = new WebSocket.Server({ server: httpServer });
const wss_https = new WebSocket.Server({ server: httpsServer });

const clients = new Set();

// 🔥 Broadcast helper
function broadcast(message) {
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// 🔥 Handle connections
function handleWS(ws, req) {
    const ip = req.socket.remoteAddress;

    console.log(`Connected: ${ip}`);
    clients.add(ws);

    // ✅ Send last message immediately on connect
    if (lastMessage) {
        ws.send(`[LAST MESSAGE] ${lastMessage}`);
    }

    ws.on("message", (msg) => {
        const message = msg.toString().trim();
        if (!message) return;

        const formatted = `[${ip}] ${message}`;

        console.log(formatted);

        // 🔥 Save last message
        lastMessage = formatted;
        fs.writeFileSync(DATA_FILE, lastMessage);

        // 🔥 Broadcast to everyone
        broadcast(formatted);
    });

    ws.on("close", () => {
        clients.delete(ws);
        console.log(`Disconnected: ${ip}`);
    });

    ws.on("error", () => {
        clients.delete(ws);
    });
}

// Attach to BOTH ws + wss
wss_http.on("connection", handleWS);
wss_https.on("connection", handleWS);

// Start servers
httpServer.listen(HTTP_PORT, HOST, () => {
    console.log(`HTTP + WS  → http://localhost:${HTTP_PORT}`);
});

httpsServer.listen(HTTPS_PORT, HOST, () => {
    console.log(`HTTPS + WSS → https://localhost:${HTTPS_PORT}`);
});