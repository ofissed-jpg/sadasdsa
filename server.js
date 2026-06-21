const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;

// ==================== TELEGRAM ====================
const BOT_TOKEN = '8866442838:AAFd7AoXTCzr8djVjesmIIl8aGz9JECnk5E';
const ADMIN_CHAT_ID = 657687591; // ←←← ИЗМЕНИ НА СВОЙ TELEGRAM CHAT ID !!!

function sendToTelegram(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const data = JSON.stringify({
    chat_id: ADMIN_CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });

  const req = https.request(url, { method: 'POST', headers: {'Content-Type': 'application/json'} }, () => {});
  req.on('error', e => console.error(e));
  req.write(data);
  req.end();
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Multer
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: () => 'training_text.txt'
});
const upload = multer({ storage });

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// DB
const db = new sqlite3.Database('./users.db');

db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, username TEXT UNIQUE, password TEXT, is_admin INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, subscription_until TEXT, created_at TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS invite_codes (code TEXT UNIQUE, created_by INTEGER, used_by INTEGER)`);
db.run(`CREATE TABLE IF NOT EXISTS user_devices (user_id INTEGER, ip_address TEXT, user_agent TEXT, device_info TEXT)`);

// REGISTER
app.post('/api/register', async (req, res) => {
  const { name, username, password, inviteCode } = req.body;
  if (!name || !username || !password || !inviteCode) return res.status(400).json({error: "Заполни все поля"});

  const hashed = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (name, username, password, is_admin) VALUES (?, ?, ?, ?)`, 
    [name, username.toLowerCase(), hashed, username.toLowerCase() === 'rocket' ? 1 : 0], 
    function(err) {
      if (err) return res.status(400).json({error: "Юзернейм занят"});
      res.json({id: this.lastID, username: username.toLowerCase()});
    });
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username.toLowerCase()], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({error: "Неверный логин/пароль"});
    res.json({id: user.id, username: user.username, isAdmin: user.is_admin === 1});
  });
});

// ====================== ГЛАВНЫЙ ГЕНЕРАТОР ======================
app.post('/api/generate', async (req, res) => {
  const { prompt, mode = 'default', userId, deviceInfo } = req.body;

  if (!prompt || !userId) return res.status(400).json({ error: 'Нет данных' });

  db.get('SELECT username, is_admin FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err || !user) return res.status(403).json({ error: 'Пользователь не найден' });

    if (user.is_admin !== 1) {
      const dev = deviceInfo ? JSON.stringify(deviceInfo).slice(0,600) : '—';
      const log = `🔔 Новый запрос\n\n👤 Nick: ${user.username}\n🆔 UID: ${userId}\n🎛 Mode: ${mode}\n💬 Command: ${prompt}\n📱 Device: ${dev}`;
      sendToTelegram(log);
    }

    let file = '1.txt';
    if (mode === 'short') file = '2.txt';
    if (mode === 'long') file = '3.txt';

    await new Promise(r => setTimeout(r, 3000 + Math.random()*4000));

    let text = "Ответ сгенерирован";
    if (fs.existsSync(`./uploads/${file}`)) {
      text = fs.readFileSync(`./uploads/${file}`, 'utf-8').trim();
    }

    res.json({ text });
  });
});

// Остальное
app.post('/api/upload-training', upload.single('file'), (req, res) => res.json({success: true}));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
  console.log(`Сервер на http://localhost:${PORT}`);
});
