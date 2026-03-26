const protocol = location.protocol === "https:" ? "wss://" : "ws://";
const ws = new WebSocket(protocol + location.host.replace(/:\d+$/, "") + (location.protocol === "https:" ? ":298" : ":297"));

const chatBox = document.getElementById("chat");
const input = document.getElementById("message");

ws.onopen = () => addMessage("Connected");
ws.onmessage = (e) => addMessage(e.data);
ws.onclose = () => addMessage("Disconnected");

function sendMessage() {
    if (!input.value.trim()) return;
    ws.send(input.value);
    input.value = "";
}

function addMessage(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

input.addEventListener("keypress", e => {
    if (e.key === "Enter") sendMessage();
});