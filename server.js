const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// アップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// 全体データ保持
let users = {}; // socket.id -> { room, name }
let bannedUsers = new Set();
let chatLogs = []; // { room, name, message, time, type }

// アップロード用エンドポイント
app.post('/upload', upload.single('file'), (req, res) => {
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// 一斉送信 (全体)
app.post('/admin/broadcast', (req, res) => {
  const { message } = req.body;
  io.emit('chat', { name: '[管理者]', message, time: new Date().toLocaleTimeString(), type: 'text' });
  chatLogs.push({ room: 'all', name: '[管理者]', message, time: new Date().toLocaleTimeString(), type: 'text' });
  res.sendStatus(200);
});

// 一斉送信（ルーム別）
app.post('/admin/broadcastRoom', (req, res) => {
  const { message, room } = req.body;
  io.to(room).emit('chat', { name: '[管理者]', message, time: new Date().toLocaleTimeString(), type: 'text' });
  chatLogs.push({ room, name: '[管理者]', message, time: new Date().toLocaleTimeString(), type: 'text' });
  res.sendStatus(200);
});

// チャット履歴取得
app.get('/admin/chatlogs', (req, res) => {
  res.json(chatLogs);
});

// サーバーリセット
app.post('/admin/reset', (req, res) => {
  users = {};
  bannedUsers.clear();
  chatLogs = [];
  res.sendStatus(200);
});

// ユーザーBAN
app.post('/admin/ban', (req, res) => {
  const { name } = req.body;
  bannedUsers.add(name);
  res.sendStatus(200);
});

io.on('connection', (socket) => {
  console.log('ユーザー接続:', socket.id);

  socket.on('join', ({ name, room }) => {
    if (bannedUsers.has(name)) {
      socket.emit('banned');
      socket.disconnect();
      return;
    }

    socket.join(room);
    users[socket.id] = { name, room };

    io.to(room).emit('chat', {
      name: '[システム]',
      message: `${name}が入室しました`,
      time: new Date().toLocaleTimeString(),
      type: 'text'
    });
  });

  socket.on('chat', (msg) => {
    const user = users[socket.id];
    if (!user) return;

    const payload = {
      name: user.name,
      message: msg.message,
      time: new Date().toLocaleTimeString(),
      type: msg.type
    };

    chatLogs.push({ room: user.room, ...payload });
    io.to(user.room).emit('chat', payload);
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      io.to(user.room).emit('chat', {
        name: '[システム]',
        message: `${user.name}が退室しました`,
        time: new Date().toLocaleTimeString(),
        type: 'text'
      });
      delete users[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
