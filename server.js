const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const multer = require('multer');
const path = require('path');

const PORT = process.env.PORT || 3000;
const bannedUsers = new Set();
const rooms = {};
const chatLogs = [];

let adminPassword = "sennin25251515";

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ファイルアップロード（画像・動画）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

app.post('/upload', upload.single('media'), (req, res) => {
  const filePath = `/uploads/${req.file.filename}`;
  res.json({ filePath });
});

// 管理パスワードチェック
app.post('/admin-login', (req, res) => {
  res.json({ success: req.body.password === adminPassword });
});

// 一斉送信
app.post('/broadcast', (req, res) => {
  const { message } = req.body;
  io.emit('chat message', { name: '管理者', msg: message, time: new Date().toLocaleTimeString() });
  res.json({ success: true });
});

// 特定ルーム送信
app.post('/roomcast', (req, res) => {
  const { message, room } = req.body;
  io.to(room).emit('chat message', { name: '管理者', msg: message, time: new Date().toLocaleTimeString() });
  res.json({ success: true });
});

// 全チャット履歴取得
app.get('/logs', (req, res) => {
  res.json(chatLogs);
});

// サーバーリセット
app.post('/reset', (req, res) => {
  io.emit('chat message', { name: 'サーバー', msg: 'リセットされました。', time: new Date().toLocaleTimeString() });
  chatLogs.length = 0;
  res.json({ success: true });
});

// 垢バン
app.post('/ban', (req, res) => {
  bannedUsers.add(req.body.name);
  res.json({ success: true });
});

io.on('connection', (socket) => {
  socket.on('join', ({ name, room }) => {
    if (bannedUsers.has(name)) {
      socket.emit('banned');
      return;
    }
    socket.join(room);
    socket.name = name;
    socket.room = room;
    io.to(room).emit('chat message', { name: 'システム', msg: `${name}が入室しました`, time: new Date().toLocaleTimeString() });
  });

  socket.on('chat message', (msg) => {
    const time = new Date().toLocaleTimeString();
    const log = { name: socket.name, msg, room: socket.room, time };
    chatLogs.push(log);
    io.to(socket.room).emit('chat message', log);
  });

  socket.on('disconnect', () => {
    if (socket.name && socket.room) {
      io.to(socket.room).emit('chat message', { name: 'システム', msg: `${socket.name}が退室しました`, time: new Date().toLocaleTimeString() });
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
