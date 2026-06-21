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
const ADMIN_CHAT_ID = 657687591; // ← ИЗМЕНИ НА СВОЙ CHAT ID !!!!

function sendToTelegram(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const data = JSON.stringify({
    chat_id: ADMIN_CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });

  const req = https.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    res.on('data', () => {});
  });

  req.on('error', (e) => console.error('Telegram error:', e));
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
  filename: (req, file, cb) => cb(null, 'training_text.txt')
});
const upload = multer({ storage });

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Database
const db = new sqlite3.Database('./users.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  is_banned INTEGER DEFAULT 0,
  subscription_until DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  created_by INTEGER NOT NULL,
  used_by INTEGER DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME DEFAULT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  device_info TEXT,
  screen_resolution TEXT,
  timezone TEXT,
  platform TEXT,
  battery_level INTEGER,
  battery_charging INTEGER,
  device_memory TEXT,
  hardware_concurrency INTEGER,
  connection_type TEXT,
  language TEXT,
  last_login DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Register
app.post('/api/register', async (req, res) => { /* ... твой оригинальный код ... */ });

// Login (оставлен оригинальный)
app.post('/api/login', async (req, res) => { /* ... твой оригинальный код ... */ });

// Generate Invite, Admin routes — оставлены как были

// ====================== ГЛАВНЫЙ ЭНДПОИНТ ======================
app.post('/api/generate', async (req, res) => {
  const { prompt, mode = 'default', userId, deviceInfo } = req.body;

  if (!userId || !prompt) {
    return res.status(400).json({ error: 'Не хватает данных' });
  }

  db.get('SELECT username, is_admin FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err || !user) return res.status(403).json({ error: 'Пользователь не найден' });

    const isAdmin = user.is_admin === 1;

    // ЛОГ АДМИНУ
    if (!isAdmin) {
      const dev = deviceInfo ? JSON.stringify(deviceInfo).slice(0, 700) : '—';
      const log = `🔔 <b>Новый запрос от пользователя</b>\n\n` +
                  `👤 Nick: ${user.username}\n` +
                  `🆔 UID: ${userId}\n` +
                  `🎛 Mode: ${mode}\n` +
                  `💬 Command: ${prompt}\n` +
                  `📱 Device: ${dev}`;

      sendToTelegram(log);
    }

    // Генерация ответа
    let fileName = '1.txt';
    let minD = 4000, maxD = 8000;

    if (mode === 'short') { fileName = '2.txt'; minD = 2500; maxD = 6000; }
    if (mode === 'long') { fileName = '3.txt'; minD = 6000; maxD = 13000; }

    await new Promise(r => setTimeout(r, minD + Math.random() * (maxD - minD)));

    let text = "Ошибка генерации";
    if (fs.existsSync(`./uploads/${fileName}`)) {
      text = fs.readFileSync(`./uploads/${fileName}`, 'utf-8').trim();
    }

    res.json({ text });
  });
});

// Upload, Admin routes...
app.post('/api/upload-training', upload.single('file'), (req, res) => {
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
  console.log(`🚀 Сервер на http://localhost:${PORT}`);
  console.log(`📨 Логи в Telegram (ID: ${ADMIN_CHAT_ID})`);
});
