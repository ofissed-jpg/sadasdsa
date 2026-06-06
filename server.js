const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Настройка загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, 'training_text.txt');
  }
});
const upload = multer({ storage });

// Создаем папку для загрузок
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Инициализация базы данных
const db = new sqlite3.Database('./users.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err);
  } else {
    console.log('✓ Подключено к базе данных SQLite');
  }
});

// Создание таблицы пользователей
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  is_banned INTEGER DEFAULT 0,
  subscription_until DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
  if (err) {
    console.error('Ошибка создания таблицы:', err);
  } else {
    console.log('✓ Таблица users готова');
  }
});

// Создание таблицы инвайт кодов
db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  created_by INTEGER NOT NULL,
  used_by INTEGER DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME DEFAULT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
)`, (err) => {
  if (err) {
    console.error('Ошибка создания таблицы инвайтов:', err);
  } else {
    console.log('✓ Таблица invite_codes готова');
    
    // Создаём первый инвайт код для регистрации админа
    db.get('SELECT COUNT(*) as count FROM invite_codes', [], (err, row) => {
      if (!err && row.count === 0) {
        const firstCode = 'INVITE-ROCKET1';
        db.run('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)', [firstCode, 1337], (err) => {
          if (!err) {
            console.log('✓ Создан первый инвайт код:', firstCode);
          }
        });
      }
    });
  }
});

// Создание таблицы устройств
db.run(`CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  device_info TEXT,
  last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`, (err) => {
  if (err) {
    console.error('Ошибка создания таблицы устройств:', err);
  } else {
    console.log('✓ Таблица user_devices готова');
  }
});

// API: Регистрация
app.post('/api/register', async (req, res) => {
  const { name, username, password, inviteCode } = req.body;

  if (!name || !username || !password || !inviteCode) {
    return res.status(400).json({ error: 'Заполни все поля' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Юзернейм минимум 3 символа' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  }

  const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    // Проверяем инвайт код
    db.get('SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL', [inviteCode], async (err, invite) => {
      if (err) {
        return res.status(500).json({ error: 'Ошибка сервера' });
      }

      if (!invite) {
        return res.status(400).json({ error: 'Неверный или уже использованный инвайт код' });
      }

      // Хешируем пароль
      const hashedPassword = await bcrypt.hash(password, 10);

      // Специальный ID и админ для rocket
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
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Такой юзернейм уже занят' });
          }
          return res.status(500).json({ error: 'Ошибка регистрации' });
        }

        const newUserId = userId || this.lastID;
        
        // Отмечаем инвайт код как использованный
        db.run('UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?', [newUserId, inviteCode]);

        // Сохраняем устройство
        db.run('INSERT INTO user_devices (user_id, ip_address, user_agent) VALUES (?, ?, ?)', [newUserId, ipAddress, userAgent]);

        // Получаем данные созданного пользователя
        db.get('SELECT id, name, username, is_admin, is_banned, subscription_until, created_at FROM users WHERE id = ?', [newUserId], (err, user) => {
          if (err) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
          }
          res.json({
            id: user.id,
            name: user.name,
            username: user.username,
            isAdmin: user.is_admin === 1,
            isBanned: user.is_banned === 1,
            subscriptionUntil: user.subscription_until,
            created: new Date(user.created_at).toLocaleDateString('ru')
          });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API: Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Заполни все поля' });
  }

  const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  db.get('SELECT * FROM users WHERE username = ?', [username.toLowerCase()], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Неверный юзернейм или пароль' });
    }

    // Проверка на бан
    if (user.is_banned === 1) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
    }

    try {
      const match = await bcrypt.compare(password, user.password);
      
      if (!match) {
        return res.status(401).json({ error: 'Неверный юзернейм или пароль' });
      }

      // Обновляем устройство или добавляем новое
      db.run(`INSERT INTO user_devices (user_id, ip_address, user_agent, last_login) 
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id, ip_address, user_agent) 
              DO UPDATE SET last_login = CURRENT_TIMESTAMP`,
              [user.id, ipAddress, userAgent]);

      res.json({
        id: user.id,
        name: user.name,
        username: user.username,
        isAdmin: user.is_admin === 1,
        isBanned: user.is_banned === 1,
        subscriptionUntil: user.subscription_until,
        created: new Date(user.created_at).toLocaleDateString('ru')
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Админ панель
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API: Генерация инвайт кода (только для админов)
app.post('/api/generate-invite', (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Не указан ID пользователя' });
  }

  // Проверяем что пользователь - админ
  db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!user || user.is_admin !== 1) {
      return res.status(403).json({ error: 'Только админы могут создавать инвайт коды' });
    }

    // Генерируем случайный код
    const code = 'INVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    db.run('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)', [code, userId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Ошибка создания кода' });
      }

      res.json({ code });
    });
  });
});

// API: Получить все инвайт коды пользователя
app.get('/api/invite-codes/:userId', (req, res) => {
  const userId = req.params.userId;

  // Проверяем что пользователь - админ
  db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!user || user.is_admin !== 1) {
      return res.status(403).json({ error: 'Только админы могут просматривать инвайт коды' });
    }

    // Получаем все коды созданные этим админом
    db.all(`
      SELECT 
        ic.code, 
        ic.created_at,
        ic.used_at,
        u.username as used_by_username
      FROM invite_codes ic
      LEFT JOIN users u ON ic.used_by = u.id
      WHERE ic.created_by = ?
      ORDER BY ic.created_at DESC
    `, [userId], (err, codes) => {
      if (err) {
        return res.status(500).json({ error: 'Ошибка получения кодов' });
      }

      res.json(codes);
    });
  });
});

// API: Удалить инвайт код
app.delete('/api/invite-codes/:code', (req, res) => {
  const { userId } = req.body;
  const code = req.params.code;

  db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!user || user.is_admin !== 1) {
      return res.status(403).json({ error: 'Только админы могут удалять коды' });
    }

    db.run('DELETE FROM invite_codes WHERE code = ?', [code], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Ошибка удаления' });
      }
      res.json({ success: true });
    });
  });
});

// API: Получить всех пользователей (для админа)
app.get('/api/admin/users/:adminId', (req, res) => {
  const adminId = req.params.adminId;

  db.get('SELECT is_admin FROM users WHERE id = ?', [adminId], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!admin || admin.is_admin !== 1) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    db.all(`SELECT id, name, username, is_admin, is_banned, subscription_until, created_at FROM users ORDER BY created_at DESC`, [], (err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Ошибка получения пользователей' });
      }

      res.json(users.map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        isAdmin: u.is_admin === 1,
        isBanned: u.is_banned === 1,
        subscriptionUntil: u.subscription_until,
        created: new Date(u.created_at).toLocaleDateString('ru')
      })));
    });
  });
});

// API: Забанить/разбанить пользователя
app.post('/api/admin/ban', (req, res) => {
  const { adminId, userId, banned } = req.body;

  db.get('SELECT is_admin FROM users WHERE id = ?', [adminId], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!admin || admin.is_admin !== 1) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    db.run('UPDATE users SET is_banned = ? WHERE id = ?', [banned ? 1 : 0, userId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Ошибка обновления' });
      }
      res.json({ success: true });
    });
  });
});

// API: Выдать подписку
app.post('/api/admin/subscription', (req, res) => {
  const { adminId, userId, days } = req.body;

  db.get('SELECT is_admin FROM users WHERE id = ?', [adminId], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!admin || admin.is_admin !== 1) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const subscriptionUntil = new Date();
    subscriptionUntil.setDate(subscriptionUntil.getDate() + days);

    db.run('UPDATE users SET subscription_until = ? WHERE id = ?', [subscriptionUntil.toISOString(), userId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Ошибка обновления' });
      }
      res.json({ success: true, subscriptionUntil: subscriptionUntil.toISOString() });
    });
  });
});

// API: Получить устройства пользователя
app.get('/api/admin/devices/:userId', (req, res) => {
  const { adminId } = req.query;
  const userId = req.params.userId;

  db.get('SELECT is_admin FROM users WHERE id = ?', [adminId], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (!admin || admin.is_admin !== 1) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    db.all('SELECT * FROM user_devices WHERE user_id = ? ORDER BY last_login DESC', [userId], (err, devices) => {
      if (err) {
        return res.status(500).json({ error: 'Ошибка получения устройств' });
      }
      res.json(devices);
    });
  });
});

// API: Загрузка текстового файла
app.post('/api/upload-training', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  res.json({ success: true, message: 'Файл загружен успешно' });
});

// API: Получить обучающий текст
app.get('/api/training-text', (req, res) => {
  const filePath = './uploads/training_text.txt';
  if (!fs.existsSync(filePath)) {
    return res.json({ text: '' });
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  res.json({ text });
});

// API: Генерация ответов (локально, без Groq)
app.post('/api/generate', async (req, res) => {
  const { prompt, mode } = req.body;

  try {
    // Определяем задержку и файл в зависимости от режима
    let fileName = '1.txt'; // default
    let minDelay = 5000; // 5 сек
    let maxDelay = 7000; // 7 сек
    
    if (mode === 'short') {
      fileName = '2.txt';
      minDelay = 3000; // 3 сек
      maxDelay = 7000; // 7 сек
    } else if (mode === 'long') {
      fileName = '3.txt';
      minDelay = 5000; // 5 сек
      maxDelay = 10000; // 10 сек
    }

    // Случайная задержка в диапазоне
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    
    // Ждем перед генерацией (имитация "думания")
    await new Promise(resolve => setTimeout(resolve, delay));

    // Читаем обучающий текст из соответствующего файла
    let response = '';
    const filePath = `./uploads/${fileName}`;
    if (fs.existsSync(filePath)) {
      // Просто отдаем весь текст из файла как есть
      response = fs.readFileSync(filePath, 'utf-8').trim();
    } else {
      // Если нет файла, простые ответы
      const responses = [
        'Понял тебя! Интересный вопрос.',
        'Хорошо, давай разберемся с этим.',
        'Отлично, могу помочь с этим.',
        'Понятно. Вот что думаю по этому поводу.',
        'Есть несколько вариантов решения.',
        'Конечно! Сейчас помогу.',
        'Хороший запрос. Давай обсудим это.',
      ];
      response = responses[Math.floor(Math.random() * responses.length)];
    }

    res.json({ text: response });
  } catch (error) {
    console.error('Ошибка генерации:', error);
    res.status(500).json({ error: 'Ошибка сервера при генерации' });
  }
});

// API: Получить всех пользователей (для отладки)
app.get('/api/users', (req, res) => {
  db.all('SELECT id, name, username, created_at FROM users', [], (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка получения пользователей' });
    }
    res.json(users);
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📊 База данных: users.db\n`);
});
