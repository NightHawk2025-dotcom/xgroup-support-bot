# XGroup Support Bot 🤖

Telegram бот підтримки з Supabase базою даних, деплой на Railway.

## Функціонал

**Для користувачів:**
- Створення тікетів підтримки
- Перегляд своїх тікетів
- Листування з підтримкою в тікеті
- Закриття тікету

**Для адмінів:**
- Перегляд всіх / відкритих / активних тікетів
- Відповідь на тікети (юзер отримує сповіщення)
- Взяти тікет в роботу
- Закрити тікет
- Статистика (юзери, тікети)
- Список користувачів

## Що зберігається в Supabase

| Таблиця | Що зберігається |
|---------|----------------|
| `users` | Всі хто писали боту |
| `tickets` | Тікети підтримки |
| `messages` | Всі повідомлення в тікетах |
| `logs` | Всі дії (start, ticket_created, тощо) |

---

## 🚀 Деплой покроково

### Крок 1 — Supabase

1. Йди на [supabase.com](https://supabase.com) → **New project**
2. Введи назву, придумай пароль, обери регіон
3. Після створення йди в **SQL Editor**
4. Вставте весь вміст файлу `schema.sql` і натисни **Run**
5. Йди в **Settings → API**:
   - Копіюй `Project URL` → це `SUPABASE_URL`
   - Копіюй `anon public` key → це `SUPABASE_ANON_KEY`

### Крок 2 — GitHub

1. Створи новий репозиторій на GitHub
2. Завантаж всі файли (крім `node_modules` і `.env`)
3. Команди:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_NAME/xgroup-support-bot.git
git push -u origin main
```

### Крок 3 — Railway

1. Йди на [railway.app](https://railway.app) → **Login with GitHub**
2. **New Project → Deploy from GitHub repo** → обери свій репозиторій
3. Railway автоматично знайде `package.json` і запустить `npm start`
4. Відкрий проект → вкладка **Variables** → додай:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | `8643828092:AAER5UrQ...` |
| `ADMIN_IDS` | `123456789,987654321` |
| `SUPPORT_CHAT_ID` | `-1001234567890` (або видали) |
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGc...` |

5. Railway автоматично перезапустить бота після збереження змінних
6. У вкладці **Deployments** побачиш `✅ Active` — бот працює 24/7!

---

## Локальний запуск

```bash
npm install
cp .env.example .env
# Заповни .env своїми даними
npm start
```

## Структура файлів

```
xgroup-support-bot/
├── bot.js          # Головний файл бота
├── db.js           # Всі операції з Supabase
├── supabase.js     # Підключення до Supabase
├── schema.sql      # SQL таблиці (запустити в Supabase)
├── package.json
├── .env.example
└── .gitignore
```
