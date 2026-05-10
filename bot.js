require('dotenv').config()
const { Telegraf, Markup, session } = require('telegraf')
const db = require('./db')

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────

const bot = new Telegraf(process.env.BOT_TOKEN)

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => parseInt(id.trim()))
  .filter(Boolean)

const SUPPORT_CHAT_ID = process.env.SUPPORT_CHAT_ID
  ? parseInt(process.env.SUPPORT_CHAT_ID)
  : null

const isAdmin = (id) => ADMIN_IDS.includes(id)

// Session middleware (in-memory, for conversation state)
bot.use(session())

function getSession(ctx) {
  if (!ctx.session) ctx.session = {}
  return ctx.session
}

// ──────────────────────────────────────────────
// KEYBOARDS
// ──────────────────────────────────────────────

const userMainMenu = Markup.keyboard([
  ['📩 Створити тікет', '📋 Мої тікети'],
  ['❓ Допомога']
]).resize()

const adminMainMenu = Markup.keyboard([
  ['📋 Всі тікети', '🔓 Відкриті тікети'],
  ['📊 Статистика', '👥 Користувачі'],
  ['✅ В обробці']
]).resize()

const cancelKeyboard = Markup.keyboard([['❌ Скасувати']]).resize()

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

function ticketStatusEmoji(status) {
  return { open: '🔓', in_progress: '🔄', closed: '✅' }[status] || '❓'
}

function formatTicket(ticket) {
  const emoji = ticketStatusEmoji(ticket.status)
  const user = ticket.users
  const userLine = user
    ? `👤 ${user.first_name || ''}${user.username ? ' (@' + user.username + ')' : ''} [${user.telegram_id}]`
    : `👤 ID: ${ticket.user_telegram_id}`

  return (
    `${emoji} *Тікет #${ticket.id}*\n` +
    `${userLine}\n` +
    `📌 Тема: ${ticket.subject}\n` +
    `📅 Створено: ${new Date(ticket.created_at).toLocaleString('uk-UA')}\n` +
    `🏷 Статус: ${ticket.status}`
  )
}

// ──────────────────────────────────────────────
// /start
// ──────────────────────────────────────────────

bot.start(async (ctx) => {
  await db.upsertUser(ctx)
  await db.logEvent('start', ctx.from.id)

  const name = ctx.from.first_name || 'друже'

  if (isAdmin(ctx.from.id)) {
    await ctx.reply(
      `👋 Привіт, адмін *${name}*!\n\nПанель керування підтримкою готова.`,
      { parse_mode: 'Markdown', ...adminMainMenu }
    )
  } else {
    await ctx.reply(
      `👋 Привіт, *${name}*! Я бот підтримки XGroup.\n\n` +
      `Якщо у тебе є питання або проблема — створи тікет і ми відповімо якомога швидше. 🚀`,
      { parse_mode: 'Markdown', ...userMainMenu }
    )
  }
})

// ──────────────────────────────────────────────
// СТВОРЕННЯ ТІКЕТУ (User flow)
// ──────────────────────────────────────────────

bot.hears('📩 Створити тікет', async (ctx) => {
  await db.upsertUser(ctx)
  if (isAdmin(ctx.from.id)) return ctx.reply('Адміни не створюють тікети 😄', adminMainMenu)

  // Check if user already has open ticket
  const existing = await db.getUserOpenTicket(ctx.from.id)
  if (existing) {
    return ctx.reply(
      `⚠️ У тебе вже є відкритий тікет *#${existing.id}* (тема: _${existing.subject}_).\n\nДочекайся відповіді або напиши в нього повідомлення.`,
      { parse_mode: 'Markdown', ...userMainMenu }
    )
  }

  const sess = getSession(ctx)
  sess.state = 'awaiting_subject'
  await ctx.reply('📝 Вкажи тему звернення (коротко, 1-2 речення):', cancelKeyboard)
})

bot.hears('❌ Скасувати', async (ctx) => {
  const sess = getSession(ctx)
  sess.state = null
  sess.ticketSubject = null

  const menu = isAdmin(ctx.from.id) ? adminMainMenu : userMainMenu
  await ctx.reply('Скасовано.', menu)
})

// ──────────────────────────────────────────────
// МОЇ ТІКЕТИ (User)
// ──────────────────────────────────────────────

bot.hears('📋 Мої тікети', async (ctx) => {
  await db.upsertUser(ctx)
  if (isAdmin(ctx.from.id)) return

  const tickets = await db.getUserTickets(ctx.from.id)
  if (!tickets.length) {
    return ctx.reply('У тебе ще немає тікетів. Створи перший! 📩', userMainMenu)
  }

  for (const t of tickets.slice(0, 10)) {
    const emoji = ticketStatusEmoji(t.status)
    const btns = []
    if (t.status !== 'closed') {
      btns.push([Markup.button.callback('💬 Написати у тікет', `write_ticket_${t.id}`)])
      btns.push([Markup.button.callback('✅ Закрити тікет', `close_ticket_${t.id}`)])
    } else {
      btns.push([Markup.button.callback('📜 Переглянути', `view_ticket_${t.id}`)])
    }

    await ctx.reply(
      `${emoji} *Тікет #${t.id}*\n📌 ${t.subject}\n📅 ${new Date(t.created_at).toLocaleString('uk-UA')}\n🏷 ${t.status}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(btns) }
    )
  }
})

// ──────────────────────────────────────────────
// ДОПОМОГА
// ──────────────────────────────────────────────

bot.hears('❓ Допомога', async (ctx) => {
  await ctx.reply(
    `📖 *Як користуватись ботом:*\n\n` +
    `1️⃣ Натисни "📩 Створити тікет"\n` +
    `2️⃣ Вкажи тему і опиши проблему\n` +
    `3️⃣ Очікуй відповіді від команди підтримки\n` +
    `4️⃣ Відповідай прямо в чат — повідомлення потраплять до нас\n\n` +
    `⏱ Зазвичай відповідаємо протягом 24 годин.`,
    { parse_mode: 'Markdown', ...userMainMenu }
  )
})

// ──────────────────────────────────────────────
// АДМІН: Всі тікети
// ──────────────────────────────────────────────

bot.hears('📋 Всі тікети', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return
  const tickets = await db.getAllTickets()
  if (!tickets.length) return ctx.reply('Тікетів поки немає.', adminMainMenu)

  await ctx.reply(`📋 *Всі тікети (останні ${Math.min(tickets.length, 10)}):*`, { parse_mode: 'Markdown' })
  for (const t of tickets.slice(0, 10)) {
    await sendTicketToAdmin(ctx, t)
  }
})

bot.hears('🔓 Відкриті тікети', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return
  const tickets = await db.getAllTickets('open')
  if (!tickets.length) return ctx.reply('Відкритих тікетів немає ✅', adminMainMenu)

  await ctx.reply(`🔓 *Відкриті тікети (${tickets.length}):*`, { parse_mode: 'Markdown' })
  for (const t of tickets.slice(0, 10)) {
    await sendTicketToAdmin(ctx, t)
  }
})

bot.hears('✅ В обробці', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return
  const tickets = await db.getAllTickets('in_progress')
  if (!tickets.length) return ctx.reply('Тікетів в обробці немає.', adminMainMenu)

  for (const t of tickets.slice(0, 10)) {
    await sendTicketToAdmin(ctx, t)
  }
})

async function sendTicketToAdmin(ctx, t) {
  const user = t.users
  const userLine = user
    ? `${user.first_name || ''}${user.username ? ' (@' + user.username + ')' : ''}`
    : `ID: ${t.user_telegram_id}`

  const emoji = ticketStatusEmoji(t.status)

  await ctx.reply(
    `${emoji} *Тікет #${t.id}*\n👤 ${userLine}\n📌 ${t.subject}\n📅 ${new Date(t.created_at).toLocaleString('uk-UA')}\n🏷 ${t.status}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💬 Відповісти', `reply_ticket_${t.id}`)],
        [
          Markup.button.callback('🔄 Взяти в роботу', `assign_ticket_${t.id}`),
          Markup.button.callback('✅ Закрити', `admin_close_${t.id}`)
        ],
        [Markup.button.callback('📜 Переглянути діалог', `view_ticket_${t.id}`)]
      ])
    }
  )
}

// ──────────────────────────────────────────────
// АДМІН: Статистика
// ──────────────────────────────────────────────

bot.hears('📊 Статистика', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return
  const stats = await db.getStats()

  await ctx.reply(
    `📊 *Статистика бота:*\n\n` +
    `👥 Користувачів: *${stats.totalUsers}*\n` +
    `🔓 Відкритих тікетів: *${stats.openTickets}*\n` +
    `🔄 В обробці: *${stats.inProgressTickets}*\n` +
    `✅ Закритих: *${stats.closedTickets}*`,
    { parse_mode: 'Markdown', ...adminMainMenu }
  )
})

// ──────────────────────────────────────────────
// АДМІН: Користувачі
// ──────────────────────────────────────────────

bot.hears('👥 Користувачі', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return
  const users = await db.getAllUsers()
  if (!users.length) return ctx.reply('Користувачів ще немає.', adminMainMenu)

  let text = `👥 *Користувачі (${users.length}):*\n\n`
  for (const u of users.slice(0, 20)) {
    text += `• ${u.first_name || ''}${u.username ? ' @' + u.username : ''} — \`${u.telegram_id}\`\n`
  }
  if (users.length > 20) text += `\n...і ще ${users.length - 20}`

  await ctx.reply(text, { parse_mode: 'Markdown', ...adminMainMenu })
})

// ──────────────────────────────────────────────
// CALLBACK ACTIONS
// ──────────────────────────────────────────────

// Взяти тікет в роботу (адмін)
bot.action(/^assign_ticket_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Немає доступу')
  const ticketId = parseInt(ctx.match[1])
  await db.assignTicket(ticketId, ctx.from.id)
  await db.logEvent('ticket_assigned', ctx.from.id, { ticketId })
  await ctx.answerCbQuery('✅ Тікет взято в роботу')
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n🔄 *Взято в роботу*', { parse_mode: 'Markdown' })

  // Notify user
  const ticket = await db.getTicket(ticketId)
  if (ticket) {
    await bot.telegram.sendMessage(
      ticket.user_telegram_id,
      `🔄 Ваш тікет *#${ticketId}* взяли в роботу! Чекайте відповіді.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {})
  }
})

// Закрити тікет (адмін)
bot.action(/^admin_close_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Немає доступу')
  const ticketId = parseInt(ctx.match[1])
  await db.updateTicketStatus(ticketId, 'closed', ctx.from.id)
  await db.logEvent('ticket_closed_admin', ctx.from.id, { ticketId })
  await ctx.answerCbQuery('✅ Тікет закрито')
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *Закрито адміном*', { parse_mode: 'Markdown' })

  const ticket = await db.getTicket(ticketId)
  if (ticket) {
    await bot.telegram.sendMessage(
      ticket.user_telegram_id,
      `✅ Ваш тікет *#${ticketId}* закрито командою підтримки.\n\nДякуємо за звернення! Якщо є нові питання — створи новий тікет.`,
      { parse_mode: 'Markdown', ...userMainMenu }
    ).catch(() => {})
  }
})

// Закрити тікет (user)
bot.action(/^close_ticket_(\d+)$/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1])
  const ticket = await db.getTicket(ticketId)
  if (!ticket || ticket.user_telegram_id !== ctx.from.id) return ctx.answerCbQuery('Немає доступу')

  await db.updateTicketStatus(ticketId, 'closed')
  await db.logEvent('ticket_closed_user', ctx.from.id, { ticketId })
  await ctx.answerCbQuery('✅ Тікет закрито')
  await ctx.editMessageText(`✅ Тікет *#${ticketId}* закрито.`, { parse_mode: 'Markdown' })
})

// Написати у тікет (user)
bot.action(/^write_ticket_(\d+)$/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1])
  const ticket = await db.getTicket(ticketId)
  if (!ticket || ticket.user_telegram_id !== ctx.from.id) return ctx.answerCbQuery('Немає доступу')

  const sess = getSession(ctx)
  sess.state = 'messaging_ticket'
  sess.activeTicketId = ticketId
  await ctx.answerCbQuery()
  await ctx.reply(`💬 Пишіть повідомлення для тікету *#${ticketId}*:`, { parse_mode: 'Markdown', ...cancelKeyboard })
})

// Відповісти на тікет (адмін)
bot.action(/^reply_ticket_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Немає доступу')
  const ticketId = parseInt(ctx.match[1])

  const sess = getSession(ctx)
  sess.state = 'admin_replying'
  sess.replyTicketId = ticketId
  await ctx.answerCbQuery()
  await ctx.reply(`✍️ Введіть відповідь для тікету *#${ticketId}*:`, { parse_mode: 'Markdown', ...cancelKeyboard })
})

// Переглянути діалог
bot.action(/^view_ticket_(\d+)$/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1])
  const ticket = await db.getTicket(ticketId)
  if (!ticket) return ctx.answerCbQuery('Тікет не знайдено')

  // Check access
  const isOwnTicket = ticket.user_telegram_id === ctx.from.id
  if (!isAdmin(ctx.from.id) && !isOwnTicket) return ctx.answerCbQuery('Немає доступу')

  const messages = await db.getTicketMessages(ticketId)
  await ctx.answerCbQuery()

  if (!messages.length) return ctx.reply(`Тікет #${ticketId}: повідомлень ще немає.`)

  let text = `📜 *Діалог тікету #${ticketId}*\n\n`
  for (const m of messages) {
    const who = m.role === 'admin' ? '👨‍💼 Підтримка' : '👤 Користувач'
    const time = new Date(m.created_at).toLocaleString('uk-UA')
    text += `${who} [${time}]:\n${m.text}\n\n`
  }

  await ctx.reply(text, { parse_mode: 'Markdown' })
})

// ──────────────────────────────────────────────
// TEXT MESSAGE HANDLER (state machine)
// ──────────────────────────────────────────────

bot.on('text', async (ctx) => {
  await db.upsertUser(ctx)
  const sess = getSession(ctx)
  const text = ctx.message.text

  // ── Awaiting ticket subject ──
  if (sess.state === 'awaiting_subject') {
    if (text.length > 200) {
      return ctx.reply('Тема занадто довга. Вкажи коротко (до 200 символів):', cancelKeyboard)
    }
    sess.ticketSubject = text
    sess.state = 'awaiting_ticket_text'
    return ctx.reply('📝 Тепер опиши свою проблему детально:', cancelKeyboard)
  }

  // ── Awaiting ticket body ──
  if (sess.state === 'awaiting_ticket_text') {
    const ticket = await db.createTicket(ctx.from.id, sess.ticketSubject, text)
    sess.state = null
    sess.ticketSubject = null

    if (!ticket) {
      return ctx.reply('❌ Помилка при створенні тікету. Спробуй ще раз.', userMainMenu)
    }

    await db.logEvent('ticket_created', ctx.from.id, { ticketId: ticket.id })

    await ctx.reply(
      `✅ Тікет *#${ticket.id}* створено!\n\nТема: _${ticket.subject}_\n\nМи відповімо якомога швидше. Ти отримаєш сповіщення тут.`,
      { parse_mode: 'Markdown', ...userMainMenu }
    )

    // Notify admins
    const adminText =
      `🆕 *Новий тікет #${ticket.id}*\n` +
      `👤 ${ctx.from.first_name || ''}${ctx.from.username ? ' (@' + ctx.from.username + ')' : ''}\n` +
      `📌 Тема: ${ticket.subject}\n` +
      `💬 ${text.substring(0, 300)}`

    const adminButtons = Markup.inlineKeyboard([
      [Markup.button.callback('💬 Відповісти', `reply_ticket_${ticket.id}`)],
      [Markup.button.callback('🔄 Взяти в роботу', `assign_ticket_${ticket.id}`)]
    ])

    // Notify support chat if set
    if (SUPPORT_CHAT_ID) {
      await bot.telegram.sendMessage(SUPPORT_CHAT_ID, adminText, {
        parse_mode: 'Markdown',
        ...adminButtons
      }).catch(() => {})
    }

    // Notify each admin personally
    for (const adminId of ADMIN_IDS) {
      await bot.telegram.sendMessage(adminId, adminText, {
        parse_mode: 'Markdown',
        ...adminButtons
      }).catch(() => {})
    }

    return
  }

  // ── User messaging in ticket ──
  if (sess.state === 'messaging_ticket') {
    const ticketId = sess.activeTicketId
    await db.addMessage(ticketId, ctx.from.id, text, 'user')
    await db.logEvent('message_sent', ctx.from.id, { ticketId, role: 'user' })
    sess.state = null
    sess.activeTicketId = null

    await ctx.reply(`✅ Повідомлення надіслано до тікету *#${ticketId}*.`, { parse_mode: 'Markdown', ...userMainMenu })

    // Notify admins
    const notifyText =
      `💬 *Нове повідомлення в тікеті #${ticketId}*\n` +
      `👤 ${ctx.from.first_name || ''}${ctx.from.username ? ' (@' + ctx.from.username + ')' : ''}\n\n` +
      text.substring(0, 500)

    const replyBtn = Markup.inlineKeyboard([[Markup.button.callback('💬 Відповісти', `reply_ticket_${ticketId}`)]])

    if (SUPPORT_CHAT_ID) {
      await bot.telegram.sendMessage(SUPPORT_CHAT_ID, notifyText, { parse_mode: 'Markdown', ...replyBtn }).catch(() => {})
    }
    for (const adminId of ADMIN_IDS) {
      await bot.telegram.sendMessage(adminId, notifyText, { parse_mode: 'Markdown', ...replyBtn }).catch(() => {})
    }
    return
  }

  // ── Admin replying to ticket ──
  if (sess.state === 'admin_replying' && isAdmin(ctx.from.id)) {
    const ticketId = sess.replyTicketId
    const ticket = await db.getTicket(ticketId)
    sess.state = null
    sess.replyTicketId = null

    if (!ticket) return ctx.reply('Тікет не знайдено.', adminMainMenu)

    await db.addMessage(ticketId, ctx.from.id, text, 'admin')
    await db.logEvent('message_sent', ctx.from.id, { ticketId, role: 'admin' })

    // Auto set to in_progress if still open
    if (ticket.status === 'open') {
      await db.assignTicket(ticketId, ctx.from.id)
    }

    await ctx.reply(`✅ Відповідь надіслано у тікет *#${ticketId}*.`, { parse_mode: 'Markdown', ...adminMainMenu })

    // Notify user
    await bot.telegram.sendMessage(
      ticket.user_telegram_id,
      `💬 *Відповідь по тікету #${ticketId}:*\n\n${text}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💬 Відповісти', `write_ticket_${ticketId}`)],
          [Markup.button.callback('✅ Закрити тікет', `close_ticket_${ticketId}`)]
        ])
      }
    ).catch(() => {})
    return
  }

  // Default — show menu
  const menu = isAdmin(ctx.from.id) ? adminMainMenu : userMainMenu
  await ctx.reply('Скористайся меню нижче 👇', menu)
})

// ──────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────

bot.launch({
  allowedUpdates: ['message', 'callback_query']
})

console.log('🤖 XGroup Support Bot запущено!')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
