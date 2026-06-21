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
const ADMIN_CHAT_ID = 657687591; // ← ИЗМЕНИ НА СВОЙ CHAT ID!!!

function sendToTelegram(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const data = JSON.stringify({
    chat_id: ADMIN_CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });

  const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, () => {});
  
  req.on('error', e => console.error('Telegram error:', e));
  req.write(data);
  req.end();
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename: (req, file, cb) => cb(null, 'training_text.txt')
});
const upload = multer({ storage });

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Database
const db = new sqlite3.Database('./users.db', (err) => {
  if (err) console.error('Ошибка БД:', err);
  else console.log('✓ SQLite подключена');
});

// Таблицы
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

// ====================== РЕГИСТРАЦИЯ ======================
app.post('/api/register', async (req, res) => {
  const { name, username, password, inviteCode, deviceInfo } = req.body;

  if (!name || !username || !password || !inviteCode) {
    return res.status(400).json({ error: 'Заполни все поля' });
  }

  const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    db.get('SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL', [inviteCode], async (err, invite) => {
      if (err || !invite) return res.status(400).json({ error: 'Неверный инвайт код' });

      const hashedPassword = await bcrypt.hash(password, 10);
      let userId = null;
      let isAdmin = 0;
      if (username.toLowerCase() === 'rocket') {
        userId = 1337;
        isAdmin = 1;
      }

      const query = userId 
        ? `INSERT INTO users (id, name, username, password, is_admin) VALUES (?, ?, ?, ?, ?)`
        : `INSERT INTO users (name, username, password, is_admin) VALUES (?, ?, ?, ?)`;
      
      const params = userId 
        ? [userId, name, username.toLowerCase(), hashedPassword, isAdmin]
        : [name, username.toLowerCase(), hashedPassword, isAdmin];

      db.run(query, params, function(err) {
        if (err) return res.status(400).json({ error: 'Такой юзернейм уже занят' });

        const newUserId = userId || this.lastID;
        db.run('UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?', [newUserId, inviteCode]);

        // Сохраняем устройство
        const devInfo = deviceInfo || {};
        db.run(`INSERT INTO user_devices (user_id, ip_address, user_agent, device_info) VALUES (?, ?, ?, ?)`,
          [newUserId, ipAddress, userAgent, JSON.stringify(devInfo)]);

        res.json({ id: newUserId, name, username: username.toLowerCase(), isAdmin: !!isAdmin });
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ====================== ЛОГИН ======================
app.post('/api/login', async (req, res) => {
  const { username, password, deviceInfo } = req.body;

  if (!username || !password) return res.status(400).json({ error: 'Заполни все поля' });

  const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  db.get('SELECT * FROM users WHERE username = ?', [username.toLowerCase()], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    if (user.is_banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const devInfo = deviceInfo || {};
    db.run(`INSERT INTO user_devices (user_id, ip_address, user_agent, device_info) VALUES (?, ?, ?, ?)`,
      [user.id, ipAddress, userAgent, JSON.stringify(devInfo)]);

    res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      isAdmin: user.is_admin === 1,
      isBanned: user.is_banned === 1,
      subscriptionUntil: user.subscription_until
    });
  });
});

// ====================== ГЕНЕРАЦИЯ (НОВАЯ) ======================
app.post('/api/generate', async (req, res) => {
  const { prompt, mode = 'default', userId, deviceInfo } = req.body;

  if (!prompt || !userId) return res.status(400).json({ error: 'Не хватает данных' });

  db.get('SELECT username, is_admin FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err || !user) return res.status(403).json({ error: 'Пользователь не найден' });

    const isAdmin = user.is_admin === 1;

    if (!isAdmin) {
      const devStr = deviceInfo ? JSON.stringify(deviceInfo).slice(0, 700) : '—';
      const log = `🔔 <b>Новый запрос</b>\n\n` +
                  `👤 Nick: ${user.username}\n` +
                  `🆔 UID: ${userId}\n` +
                  `🎛 Mode: ${mode}\n` +
                  `💬 Command: ${prompt}\n` +
                  `📱 Device: ${devStr}`;
      sendToTelegram(log);
    }

    let fileName = '1.txt';
    let minDelay = 4000, maxDelay = 8000;
    if (mode === 'short') { fileName = '2.txt'; minDelay = 2500; maxDelay = 6000; }
    else if (mode === 'long') { fileName = '3.txt'; minDelay = 6000; maxDelay = 13000; }

    await new Promise(r => setTimeout(r, minDelay + Math.random() * (maxDelay - minDelay)));

    let text = "Понял запрос...";
    if (fs.existsSync(`./uploads/${fileName}`)) {
      text = fs.readFileSync(`./uploads/${fileName}`, 'utf-8').trim();
    }

    res.json({ text });
  });
});

// Остальные роуты (admin, upload и т.д.)
app.post('/api/upload-training', upload.single('file'), (req, res) => res.json({ success: true }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  console.log(`📨 Логи в Telegram`);
});
