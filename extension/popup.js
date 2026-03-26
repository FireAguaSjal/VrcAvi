// popup.js
async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function isOnVrchatAvatar() {
  const tab = await getCurrentTab();
  return tab && tab.url && tab.url.includes('vrchat.com/home/avatar');
}

async function updateUI() {
  const onSite = await isOnVrchatAvatar();
  const banner = document.getElementById('status-banner');
  const openBtn = document.getElementById('not-on-vrchat');
  
  if (onSite) {
    banner.textContent = "✅ CONNECTED TO VRCHAT";
    banner.className = "status-banner on";
    openBtn.style.display = "none";
  } else {
    banner.textContent = "❌ NOT ON VRCHAT AVATAR PAGE";
    banner.className = "status-banner off";
    openBtn.style.display = "block";
  }

  // Load persistence
  const data = await chrome.storage.local.get(['wsDestinationUrl', 'enabled', 'pin', 'token']);
  
  const wsInput = document.getElementById('wsurl');
  const toggle = document.getElementById('enabled');
  const tokenDisplay = document.getElementById('tokenDisplay');
  const pinStatus = document.getElementById('pinStatus');
  const pinSetup = document.getElementById('pinSetup');
  const pinReset = document.getElementById('pinReset');

  wsInput.value = data.wsDestinationUrl || 'http://localhost:297';
  toggle.checked = data.enabled !== false;
  tokenDisplay.textContent = data.token || 'None';

  // PIN UI
  if (!data.pin) {
    pinStatus.textContent = "❌ NO PIN SET (Required)";
    pinStatus.style.color = "#ff4444";
    pinSetup.style.display = "block";
    pinReset.style.display = "none";
  } else {
    pinStatus.textContent = "✅ PIN SECURED";
    pinStatus.style.color = "#00ff9d";
    pinSetup.style.display = "none";
    pinReset.style.display = "block";
  }

  // Event Listeners
  document.getElementById('save').onclick = async () => {
    const url = wsInput.value.trim();
    const statusDiv = document.getElementById('status');
    statusDiv.style.display = "block";
    statusDiv.textContent = "Saving...";
    
    await chrome.storage.local.set({ wsDestinationUrl: url });
    chrome.runtime.sendMessage({ type: "SET_URL", url: url }, (resp) => {
        statusDiv.textContent = "Configuration Updated!";
        setTimeout(() => statusDiv.style.display = "none", 2000);
    });
  };

  toggle.onchange = async () => {
    await chrome.storage.local.set({ enabled: toggle.checked });
    chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: toggle.checked });
  };

  document.getElementById('savePinBtn').onclick = async () => {
    const pin = document.getElementById('newPin').value.trim();
    if (pin.length < 4) { alert("PIN must be 4 digits"); return; }
    await chrome.storage.local.set({ pin: pin });
    updateUI();
  };

  document.getElementById('resetPinBtn').onclick = async () => {
    if (confirm("Reset PIN? This will invalidate your token.")) {
        await chrome.storage.local.set({ pin: null, token: null });
        updateUI();
    }
  };

  document.getElementById('copyTokenBtn').onclick = () => {
    const token = tokenDisplay.textContent;
    if (token === 'None') return;
    navigator.clipboard.writeText(token).then(() => {
        const btn = document.getElementById('copyTokenBtn');
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy", 2000);
    });
  };

  document.getElementById('open-vrchat').onclick = () => {
    chrome.tabs.create({ url: 'https://vrchat.com/home/avatar' });
    window.close();
  };
}

document.addEventListener('DOMContentLoaded', updateUI);