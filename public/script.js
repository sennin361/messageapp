const socket = io();
const username = prompt("名前を入力してください");
const room = prompt("あいことばを入力（ルーム名）");

socket.emit("joinRoom", { username, room });

const chat = document.getElementById("chat");

socket.on("message", (data) => {
  const div = document.createElement("div");
  div.classList.add("bubble");
  div.classList.add(data.username === username ? "self" : "other");
  div.innerHTML = `<div>${data.text}</div><div class="meta">${data.username}・${data.time}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
});

document.getElementById("messageForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("messageInput").value;
  if (msg.trim() !== "") {
    socket.emit("chatMessage", msg);
    document.getElementById("messageInput").value = "";
  }
});

document.getElementById("leaveBtn").addEventListener("click", () => {
  socket.emit("leaveRoom");
  location.reload();
});

document.getElementById("mediaInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/upload", { method: "POST", body: formData });
  const data = await res.json();
  socket.emit("chatMedia", { url: data.fileUrl, type: data.type });
});
