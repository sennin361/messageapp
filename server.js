const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// メディアファイルの保存設定
const upload = multer({ dest: path.join(__dirname, 'public', 'uploads/') });

// データ保存用（メモリ上）
let users = {};         // socket.id → {name, room}
let bannedUsers = new Set(); // 名前で管理
let chatLogs = [];      // 全チャットログ
let rooms = {};         // room名 → socket.id[]

// 管理者パスワード
const ADMIN_PASS = 'sennin25251515';

// public フォルダを静的ファイルとして配信
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 画像・動画アップロード用API
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
  // ファイルのURLを返す
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// 管理者パスワード認証用API（簡易）
app.post('/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// サーバーリセットAPI（管理者専用）
app.post('/admin/reset', (req, res) => {
  // 初期化処理
  users = {};
  bannedUsers.clear();
  chatLogs = [];
  rooms = {};
  io.emit('serverReset');
  res.json({ success: true });
});

// 垢バンAPI（管理者専用）
app.post('/admin/ban', (req, res) => {
  const { username } = req.body;
  if (username) {
    bannedUsers.add(username);
    // 接続中なら切断
    for (const [id, user] of Object.entries(users)) {
      if (user.name === username) {
        io.sockets.sockets.get(id)?.disconnect(true);
      }
    }
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'username required' });
  }
});

// 一斉送信API（管理者専用） - 全体
app.post('/admin/broadcast', (req, res) => {
  const { message } = req.body;
  if (!message) return res.json({ success: false, error: 'message required' });

  io.emit('adminMessage', {
    username: '管理者',
    message,
    time: new Date().toISOString(),
  });
  res.json({ success: true });
});

// 一斉送信API（管理者専用） - ルーム単位
app.post('/admin/roomBroadcast', (req, res) => {
  const { room, message } = req.body;
  if (!room || !message) return res.json({ success: false, error: 'room and message required' });

  io.to(room).emit('adminMessage', {
    username: '管理者',
    message,
    time: new Date().toISOString(),
  });
  res.json({ success: true });
});

io.on('connection', (socket) => {
  // 新規ユーザー参加時
  socket.on('join', ({ name, room, password }, callback) => {
    if (bannedUsers.has(name)) {
      return callback({ error: 'あなたは垢バンされています。' });
    }
    if (!name || !room) {
      return callback({ error: '名前とあいことば（ルーム名）が必要です。' });
    }

    // あいことばでマッチング（ルーム参加）
    socket.join(room);
    users[socket.id] = { name, room };

    if (!rooms[room]) rooms[room] = new Set();
    rooms[room].add(socket.id);

    // 過去ログをルーム限定で送信
    const roomLogs = chatLogs.filter((log) => log.room === room);

    // 全クライアントに参加通知
    io.to(room).emit('message', {
      username: 'システム',
      message: `${name} さんが入室しました。`,
      time: new Date().toISOString(),
      system: true,
    });

    // 過去ログ送信（ルーム内）
    socket.emit('chatHistory', roomLogs);

    // 管理画面へも全チャット履歴送信（リアルタイム）
    io.to('admin').emit('allChatLogs', chatLogs);

    callback({ success: true });
  });

  // 管理者専用ルーム参加
  socket.on('adminJoin', (callback) => {
    socket.join('admin');
    callback({ success: true });
  });

  // メッセージ送信
  socket.on('sendMessage', (message, callback) => {
    const user = users[socket.id];
    if (!user) return callback({ error: 'ユーザー情報なし' });
    if (bannedUsers.has(user.name)) {
      return callback({ error: 'あなたは垢バンされています。' });
    }
    const time = new Date().toISOString();
    const chatData = {
      username: user.name,
      message,
      time,
      room: user.room,
      system: false,
    };
    chatLogs.push(chatData);

    io.to(user.room).emit('message', chatData);
    io.to('admin').emit('allChatLogs', chatLogs);

    callback({ success: true });
  });

  // メディア送信（URLとして受け取り）
  socket.on('sendMedia', (mediaData, callback) => {
    const user = users[socket.id];
    if (!user) return callback({ error: 'ユーザー情報なし' });
    if (bannedUsers.has(user.name)) {
      return callback({ error: 'あなたは垢バンされています。' });
    }
    const time = new Date().toISOString();
    const chatData = {
      username: user.name,
      message: '',
      media: mediaData.url,
      mediaType: mediaData.type,
      time,
      room: user.room,
      system: false,
    };
    chatLogs.push(chatData);

    io.to(user.room).emit('message', chatData);
    io.to('admin').emit('allChatLogs', chatLogs);

    callback({ success: true });
  });

  // 退室処理
  socket.on('exit', () => {
    const user = users[socket.id];
    if (user) {
      io.to(user.room).emit('message', {
        username: 'システム',
        message: `${user.name} さんが退室しました。`,
        time: new Date().toISOString(),
        system: true,
      });
      rooms[user.room]?.delete(socket.id);
      delete users[socket.id];
      socket.leave(user.room);
    }
  });

  // 切断時処理
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      io.to(user.room).emit('message', {
        username: 'システム',
        message: `${user.name} さんが切断されました。`,
        time: new Date().toISOString(),
        system: true,
      });
      rooms[user.room]?.delete(socket.id);
      delete users[socket.id];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
