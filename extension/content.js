// content.js - Simplified + Force Background Wake (v1.8)

console.log("[VRChat Content] ===== CONTENT SCRIPT STARTED (v1.8) =====");

(async () => {
  if (!window.location.href.startsWith('https://vrchat.com/home/avatar/')) {
    console.log("[VRChat Content] Not on avatar page - exiting");
    return;
  }

  const { enabled } = await chrome.storage.local.get('enabled');
  if (enabled === false) {
    console.log("[VRChat Content] Extension is disabled via settings.");
    return;
  }

  console.log("[VRChat Content] On VRChat avatar page");

  // Find user ID and username (Prioritize the logged-in user link)
  let userId = null;
  let username = null;
  for (let i = 0; i < 15; i++) {
    // Look for the user's profile link in the sidebar or menu first (Standard VRChat layout)
    const profileLink = document.querySelector('a[href^="/home/user/usr_"][class*="link"], a[href^="/home/user/usr_"]:not([href*="avatar"])');
    // Fallback to any user link if we can't find a sidebar one specifically
    const anyLink = document.querySelector('a[href^="/home/user/usr_"]');
    
    const targetLink = profileLink || anyLink;

    if (targetLink) {
      const match = targetLink.getAttribute('href').match(/usr_(.+)$/);
      if (match) {
        userId = match[1];
        username = targetLink.textContent.trim();
        console.log(`[VRChat Content] ✅ Found User ID: usr_${userId} (Name: ${username})`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }

  if (!userId) {
    console.warn("[VRChat Content] Failed to find user ID");
    return;
  }

  // Connect to background script via persistent port
  const port = chrome.runtime.connect({ name: "vrchat-avatar-port" });

  // Send registration via port
  port.postMessage({ 
    type: "REGISTER_USERID", 
    userId: userId,
    username: username
  });

  console.log("[VRChat Content] Sent REGISTER_USERID to background via port");

  // Status box
  function showStatus(text, color = 'red') {
    let div = document.getElementById('vrchat-ext-status');
    if (!div) {
      div = document.createElement('div');
      div.id = 'vrchat-ext-status';
      div.style.cssText = `position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:6px;font-size:15px;font-weight:bold;z-index:99999;color:white;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
      document.body.appendChild(div);
    }
    div.textContent = text;
    div.style.backgroundColor = color === 'green' ? '#00ff9d' : '#ff4444';
  }

  // Robust button click with retries
  async function clickChangeButton(retries = 15) {
    console.log(`[VRChat Content] 🔍 Searching for "Change Into Avatar" button (retries: ${retries})...`);
    for (let i = 0; i < retries; i++) {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => {
        // Use innerText for visibility-aware text, fallback to textContent
        const text = (b.innerText || b.textContent || "").trim();
        return text.includes('Change Into Avatar');
      });
      
      if (btn) {
        console.log("[VRChat Content] ✅ Button found! Clicking now...");
        btn.click();
        if (userId) {
          console.log(`[VRChat Content] 📤 Sending confirmation for User: ${userId}`);
          port.postMessage({ type: "SEND_CONFIRMATION", userId });
        } else {
          console.error("[VRChat Content] ❌ Cannot send confirmation: User ID is null!");
        }
        return true;
      }
      
      if (i % 5 === 0 && i > 0) console.log(`[VRChat Content] Still searching for button... (${i+1}/${retries})`);
      await new Promise(r => setTimeout(r, 1000));
    }
    console.warn("[VRChat Content] ❌ Failed to find 'Change Into Avatar' button after retries.");
    return false;
  }

  // Handle incoming messages from background via port
  port.onMessage.addListener(async (msg) => {
    console.log(`[VRChat Content] 📥 Message from background:`, msg);
    
    if (msg.type === "MESSAGE") {
      let data = msg.data.trim();
      
      // Handle messages with [IP] prefix from wsTESTER.js
      const match = data.match(/^\[.*?\]\s*(.*)$/);
      if (match) {
        data = match[1].trim();
      }
      
      console.log(`[VRChat Content] 📝 Processed message: "${data}"`);

      if (data === "200" || data.startsWith("avtr_")) {
        showStatus("Working Correctly", "green");
        if (data.startsWith("avtr_")) {
          const avatarId = data;
          if (!window.location.href.includes(avatarId)) {
            console.log(`[VRChat Content] ⏭️ Navigating to new avatar: ${avatarId}`);
            await chrome.storage.local.set({ pendingAvatarId: avatarId });
            window.location.href = `https://vrchat.com/home/avatar/${avatarId}`;
          } else {
            console.log(`[VRChat Content] 📍 Already on avatar page, triggers auto-click...`);
            clickChangeButton();
          }
        }
      } else {
        console.warn(`[VRChat Content] ⚠️ Unexpected message format: "${data}"`);
        showStatus("url not working as expected", "red");
      }
    } else if (msg.type === "STATUS") {
      console.log(`[VRChat Content] ℹ️ Connection status: ${msg.status}`);
      let div = document.getElementById('vrchat-ext-status');
      if (!div) {
        div = document.createElement('div');
        div.id = 'vrchat-ext-status';
        div.style.cssText = `position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:6px;font-size:15px;font-weight:bold;z-index:99999;color:white;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
        document.body.appendChild(div);
      }

      if (msg.status === "disabled") {
        if (div) div.remove();
      } else {
        const statusText = msg.status.toUpperCase();
        div.textContent = statusText === "PIN_REQUIRED" ? "⚠️ SET PIN IN POPUP" : 
                           statusText === "UNAUTHORIZED" ? "❌ INVALID PIN" :
                           statusText === "BLOCKED" ? "🚫 IP BLOCKED (5m)" :
                           `VRChat Sync: ${msg.status}`;
        div.style.backgroundColor = msg.color === "green" ? "rgba(0, 255, 157, 0.8)" : 
                                    msg.color === "orange" ? "rgba(255, 165, 0, 0.8)" : 
                                    "rgba(255, 68, 68, 0.8)";
      }
    }
  });

  // Check for pending avatar from previous navigation
  const storageData = await chrome.storage.local.get('pendingAvatarId');
  const pendingAvatarId = storageData.pendingAvatarId;
  
  if (pendingAvatarId && window.location.href.includes(pendingAvatarId)) {
    console.log(`[VRChat Content] 🚀 Running pending avatar change for: ${pendingAvatarId}`);
    const clicked = await clickChangeButton(25); // Increased wait time for slow loads
    if (clicked) {
      await chrome.storage.local.set({ pendingAvatarId: null });
      console.log("[VRChat Content] ✅ Pending avatar change completed and flag cleared.");
    }
  } else if (pendingAvatarId) {
    console.log(`[VRChat Content] Found pending ID ${pendingAvatarId} but URL doesn't match: ${window.location.href}`);
  }

  console.log("[VRChat Content] ===== CONTENT SCRIPT READY =====");
})();