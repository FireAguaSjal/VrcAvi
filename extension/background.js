// background.js - HTTP POLLING VERSION (v2.0)

console.log("[VRChat BG] ===== BACKGROUND SERVICE WORKER LOADED (v2.0 - HTTP POLLING) =====");

let pollUrl = null;
let isEnabled = true;
let latestUserId = null;
let latestUsername = null;
let connectedPorts = new Set();
let pollTimer = null;
let lastAvatarId = null;

// Load settings initially
chrome.storage.local.get(['wsDestinationUrl', 'enabled']).then((data) => {
  pollUrl = data.wsDestinationUrl;
  isEnabled = data.enabled !== false;
  
  if (pollUrl && isEnabled) {
    console.log("[VRChat BG] Found saved URL and enabled, starting poll...");
    startPolling();
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "vrchat-avatar-port") {
    console.log("[VRChat BG] ✅ Port connected from content script");
    connectedPorts.add(port);
    
    // Sync current state
    syncStatusToPort(port);

    port.onMessage.addListener((message) => {
      if (message.type === "REGISTER_USERID") {
        latestUserId = message.userId;
        latestUsername = message.username;
        console.log(`[VRChat BG] User registered: ${latestUsername} (${latestUserId})`);
        // Immediately poll once on registration
        doPoll();
      }

      if (message.type === "SEND_CONFIRMATION") {
        console.log(`[VRChat BG] Confirmation received for ${message.userId} 200`);
        // In polling mode, we might not send this back to server immediately 
        // unless we have a specific endpoint for it. For now, just log it.
        // The user said "reply with userid and 200", so let's send it to server via POST or GET.
        if (pollUrl) {
          fetch(`${pollUrl}/change?id=${lastAvatarId}&confirm=1&userId=${message.userId}`)
            .catch(e => console.error("[VRChat BG] Failed to send confirmation to server", e));
        }
      }
    });

    port.onDisconnect.addListener(() => {
      connectedPorts.delete(port);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SET_URL") {
    pollUrl = message.url;
    chrome.storage.local.set({ wsDestinationUrl: message.url });
    if (isEnabled) startPolling();
    sendResponse({ success: true });
    return;
  }

  if (message.type === "SET_ENABLED") {
    isEnabled = message.enabled;
    chrome.storage.local.set({ enabled: isEnabled });
    if (!isEnabled) {
      stopPolling();
    } else if (pollUrl) {
      startPolling();
    }
    broadcastToContent({ type: "STATUS", status: isEnabled ? "connected" : "disabled" });
    sendResponse({ success: true });
    return;
  }
});

function startPolling() {
  stopPolling();
  if (!pollUrl || !isEnabled) return;
  console.log(`[VRChat BG] Starting poll loop to: ${pollUrl}`);
  pollTimer = setInterval(doPoll, 3000);
  doPoll(); // First poll
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function getFormattedUrl(url) {
  if (!url || typeof url !== 'string') {
    console.warn("[VRChat BG] URL is missing or invalid, skipping format.");
    return null;
  }
  let formatted = url.trim();
  // Replace WebSocket protocols with HTTP for polling
  formatted = formatted.replace(/^ws:\/\//i, 'http://');
  formatted = formatted.replace(/^wss:\/\//i, 'https://');
  // Add protocol if missing
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'http://' + formatted;
  }
  // Remove trailing slash
  return formatted.replace(/\/$/, '');
}

async function doPoll() {
  if (!pollUrl || !isEnabled || !latestUserId) return;
  
  // Get latest auth data
  const data = await chrome.storage.local.get(['pin', 'token']);
  const pin = data.pin || '';
  const token = data.token || '';

  if (!pin) {
    console.log("[VRChat BG] No PIN configured, waiting...");
    broadcastToContent({ type: "STATUS", status: "pin_required", color: "orange" });
    return;
  }

  const base = getFormattedUrl(pollUrl);
  // URL now includes PIN and TOKEN for security
  const url = `${base}/poll/${latestUserId}?username=${encodeURIComponent(latestUsername || 'unknown')}&pin=${encodeURIComponent(pin)}&token=${encodeURIComponent(token)}`;
  
  try {
    const response = await fetch(url);
    if (response.status === 401) {
       broadcastToContent({ type: "STATUS", status: "unauthorized", color: "red" });
       return;
    }
    if (response.status === 403) {
       broadcastToContent({ type: "STATUS", status: "blocked", color: "red" });
       return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    
    // Auto-update token if provided by server
    if (result.token) {
       console.log("[VRChat BG] 🔑 NEW TOKEN RECEIVED FROM SERVER");
       await chrome.storage.local.set({ token: result.token });
    }

    if (result.status === "PIN_REQUIRED") {
       broadcastToContent({ type: "STATUS", status: "pin_required", color: "orange" });
       return;
    }

    broadcastToContent({ type: "STATUS", status: "connected", color: "green" });

    if (result.avatarId && result.avatarId !== lastAvatarId) {
       console.log(`[VRChat BG] 🆕 NEW AVATAR DETECTED: ${result.avatarId}`);
       lastAvatarId = result.avatarId;
       broadcastToContent({ type: "MESSAGE", data: result.avatarId });
    }
  } catch (e) {
    console.error(`[VRChat BG] Polling error for ${url}:`, e.message);
    broadcastToContent({ type: "STATUS", status: "error", color: "red" });
  }
}

function syncStatusToPort(port) {
  if (!isEnabled) {
    port.postMessage({ type: "STATUS", status: "disabled" });
  } else if (pollTimer) {
    port.postMessage({ type: "STATUS", status: "connected", color: "green" });
  }
}

function broadcastToContent(message) {
  connectedPorts.forEach(port => {
    try { port.postMessage(message); } catch (e) { connectedPorts.delete(port); }
  });
}
console.log("[VRChat BG] Background ready (Polling Version)");