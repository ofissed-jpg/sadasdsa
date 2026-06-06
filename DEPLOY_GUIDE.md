# 🚀 Как загрузить на GitHub

## Вариант 1: Через GitHub Desktop (ПРОЩЕ ВСЕГО)

1. Скачай GitHub Desktop: https://desktop.github.com/
2. Установи и войди в свой аккаунт
3. File → Add Local Repository → выбери папку `d:\тест ебар`
4. Нажми "Publish repository"
5. Выбери `sadasdsa` репозиторий
6. Готово!

## Вариант 2: Через командную строку (если установил Git)

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ofissed-jpg/sadasdsa.git
git push -u origin main
```

## Вариант 3: Через веб-интерфейс GitHub

1. Открой https://github.com/ofissed-jpg/sadasdsa
2. Нажми "uploading an existing file"
3. Перетащи все файлы из папки `d:\тест ебар`:
   - server.js
   - package.json
   - package-lock.json
   - damp_neuro(1).html
   - admin.html
   - uploads/ (папка с файлами)
   - .gitignore
   - README.md
4. Нажми "Commit changes"

---

## После загрузки:

1. Открой Render.com
2. Жми "Configure GitHub App"
3. Выбери репозиторий `sadasdsa`
4. Настройки деплоя:
   - **Name**: damp-neuro
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Жми "Create Web Service"
6. Готово! Ждём деплой (~2-3 минуты)
