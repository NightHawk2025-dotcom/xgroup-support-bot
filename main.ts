import { Bot, session, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ADMIN_IDS = (Deno.env.get("ADMIN_IDS") || "")
  .split(",")
  .map((id) => parseInt(id.trim()))
  .filter(Boolean);
const SUPPORT_CHAT_ID = Deno.env.get("SUPPORT_CHAT_ID")
  ? parseInt(Deno.env.get("SUPPORT_CHAT_ID")!)
  : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bot = new Bot(BOT_TOKEN);

const isAdmin = (id: number) => ADMIN_IDS.includes(id);

// ──────────────────────────────────────────────
// Session
// ──────────────────────────────────────────────

interface SessionData {
  state: string | null;
  ticketSubject: string | null;
  activeTicketId: number | null;
  replyTicketId: number | null;
}

bot.use(session({
  initial: (): SessionData => ({
    state: null,
    ticketSubject: null,
    activeTicketId: null,
    replyTicketId: null,
  }),
}));

// ──────────────────────────────────────────────
// Keyboards
// ──────────────────────────────────────────────

const userMainMenu = new Keyboard()
  .text("📩 Створити тікет").text("📋 Мої тікети").row()
  .text("❓ Допомога")
  .resized();

const adminMainMenu = new Keyboard()
  .text("📋 Всі тікети").text("🔓 Відкриті тікети").row()
  .text("📊 Статистика").text("👥 Користувачі").row()
  .text("✅ В обробці")
  .resized();

const cancelKeyboard = new Keyboard().text("❌ Скасувати").resized();

// ──────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────

async function upsertUser(from: any) {
  await supabase.from("users").upsert({
    telegram_id: from.id,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    last_seen: new Date().toISOString(),
  }, { onConflict: "telegram_id" });
}

async function logEvent(type: string, telegramId: number, meta = {}) {
  await supabase.from("logs").insert({ event_type: type, telegram_id: telegramId, meta });
}

async function createTicket(telegramId: number, subject: string, text: string) {
  const { data } = await supabase.from("tickets")
    .insert({ user_telegram_id: telegramId, subject, status: "open" })
    .select().single();
  if (data) await supabase.from("messages").insert({
    ticket_id: data.id, sender_telegram_id: telegramId, text, role: "user"
  });
  return data;
}

async function getTicket(ticketId: number) {
  const { data } = await supabase.from("tickets")
    .select("*, users(*)").eq("id", ticketId).single();
  return data;
}

async function getUserOpenTicket(telegramId: number) {
  const { data } = await supabase.from("tickets")
    .select("*").eq("user_telegram_id", telegramId).eq("status", "open")
    .order("created_at", { ascending: false }).limit(1).single();
  return data;
}

async function getUserTickets(telegramId: number) {
  const { data } = await supabase.from("tickets")
    .select("*").eq("user_telegram_id", telegramId)
    .order("created_at", { ascending: false });
  return data || [];
}

async function getAllTickets(status?: string) {
  let query = supabase.from("tickets")
    .select("*, users(first_name, username, telegram_id)")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data } = await query;
  return data || [];
}

async function updateTicketStatus(ticketId: number, status: string, adminId?: number) {
  const update: any = { status };
  if (status === "closed") { update.closed_at = new Date().toISOString(); update.closed_by = adminId; }
  const { data } = await supabase.from("tickets").update(update).eq("id", ticketId).select().single();
  return data;
}

async function assignTicket(ticketId: number, adminId: number) {
  const { data } = await supabase.from("tickets")
    .update({ assigned_to: adminId, status: "in_progress" })
    .eq("id", ticketId).select().single();
  return data;
}

async function addMessage(ticketId: number, senderTelegramId: number, text: string, role: string) {
  await supabase.from("messages").insert({ ticket_id: ticketId, sender_telegram_id: senderTelegramId, text, role });
}

async function getTicketMessages(ticketId: number) {
  const { data } = await supabase.from("messages")
    .select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true });
  return data || [];
}

async function getStats() {
  const [u, o, ip, c] = await Promise.all([
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
    supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "closed"),
  ]);
  return { totalUsers: u.count || 0, openTickets: o.count || 0, inProgressTickets: ip.count || 0, closedTickets: c.count || 0 };
}

async function getAllUsers() {
  const { data } = await supabase.from("users").select("*").order("created_at", { ascending: false });
  return data || [];
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function statusEmoji(status: string) {
  return ({ open: "🔓", in_progress: "🔄", closed: "✅" } as any)[status] || "❓";
}

async function sendTicketToAdmin(ctx: any, t: any) {
  const user = t.users;
  const userLine = user
    ? `${user.first_name || ""}${user.username ? " (@" + user.username + ")" : ""}`
    : `ID: ${t.user_telegram_id}`;

  await ctx.reply(
    `${statusEmoji(t.status)} *Тікет #${t.id}*\n👤 ${userLine}\n📌 ${t.subject}\n📅 ${new Date(t.created_at).toLocaleString("uk-UA")}\n🏷 ${t.status}`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("💬 Відповісти", `reply_${t.id}`).row()
        .text("🔄 Взяти в роботу", `assign_${t.id}`).text("✅ Закрити", `aclose_${t.id}`).row()
        .text("📜 Переглянути діалог", `view_${t.id}`)
    }
  );
}

// ──────────────────────────────────────────────
// /start
// ──────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await upsertUser(ctx.from!);
  await logEvent("start", ctx.from!.id);
  const name = ctx.from!.first_name || "друже";
  if (isAdmin(ctx.from!.id)) {
    await ctx.reply(`👋 Привіт, адмін *${name}*!\n\nПанель керування готова.`,
      { parse_mode: "Markdown", reply_markup: adminMainMenu });
  } else {
    await ctx.reply(
      `👋 Привіт, *${name}*! Я бот підтримки XGroup.\n\nЯкщо є питання — створи тікет і ми відповімо! 🚀`,
      { parse_mode: "Markdown", reply_markup: userMainMenu }
    );
  }
});

// ──────────────────────────────────────────────
// User handlers
// ──────────────────────────────────────────────

bot.hears("📩 Створити тікет", async (ctx) => {
  await upsertUser(ctx.from!);
  if (isAdmin(ctx.from!.id)) return ctx.reply("Адміни не створюють тікети 😄", { reply_markup: adminMainMenu });
  const existing = await getUserOpenTicket(ctx.from!.id);
  if (existing) {
    return ctx.reply(
      `⚠️ У тебе вже є відкритий тікет *#${existing.id}* (_${existing.subject}_).\n\nДочекайся відповіді або напиши в нього.`,
      { parse_mode: "Markdown", reply_markup: userMainMenu }
    );
  }
  (ctx.session as SessionData).state = "awaiting_subject";
  await ctx.reply("📝 Вкажи тему звернення:", { reply_markup: cancelKeyboard });
});

bot.hears("❌ Скасувати", async (ctx) => {
  const sess = ctx.session as SessionData;
  sess.state = null; sess.ticketSubject = null;
  await ctx.reply("Скасовано.", { reply_markup: isAdmin(ctx.from!.id) ? adminMainMenu : userMainMenu });
});

bot.hears("📋 Мої тікети", async (ctx) => {
  await upsertUser(ctx.from!);
  if (isAdmin(ctx.from!.id)) return;
  const tickets = await getUserTickets(ctx.from!.id);
  if (!tickets.length) return ctx.reply("У тебе ще немає тікетів 📩", { reply_markup: userMainMenu });
  for (const t of tickets.slice(0, 10)) {
    const btns = new InlineKeyboard();
    if (t.status !== "closed") {
      btns.text("💬 Написати", `write_${t.id}`).text("✅ Закрити", `uclose_${t.id}`)
    } else {
      btns.text("📜 Переглянути", `view_${t.id}`)
    }
    await ctx.reply(
      `${statusEmoji(t.status)} *Тікет #${t.id}*\n📌 ${t.subject}\n📅 ${new Date(t.created_at).toLocaleString("uk-UA")}`,
      { parse_mode: "Markdown", reply_markup: btns }
    );
  }
});

bot.hears("❓ Допомога", async (ctx) => {
  await ctx.reply(
    `📖 *Як користуватись:*\n\n1️⃣ Натисни "📩 Створити тікет"\n2️⃣ Вкажи тему і опиши проблему\n3️⃣ Очікуй відповіді\n4️⃣ Відповідай прямо в чат\n\n⏱ Зазвичай відповідаємо протягом 24 годин.`,
    { parse_mode: "Markdown", reply_markup: userMainMenu }
  );
});

// ──────────────────────────────────────────────
// Admin handlers
// ──────────────────────────────────────────────

bot.hears("📋 Всі тікети", async (ctx) => {
  if (!isAdmin(ctx.from!.id)) return;
  const tickets = await getAllTickets();
  if (!tickets.length) return ctx.reply("Тікетів поки немає.", { reply_markup: adminMainMenu });
  for (const t of tickets.slice(0, 10)) await sendTicketToAdmin(ctx, t);
});

bot.hears("🔓 Відкриті тікети", async (ctx) => {
  if (!isAdmin(ctx.from!.id)) return;
  const tickets = await getAllTickets("open");
  if (!tickets.length) return ctx.reply("Відкритих тікетів немає ✅", { reply_markup: adminMainMenu });
  for (const t of tickets.slice(0, 10)) await sendTicketToAdmin(ctx, t);
});

bot.hears("✅ В обробці", async (ctx) => {
  if (!isAdmin(ctx.from!.id)) return;
  const tickets = await getAllTickets("in_progress");
  if (!tickets.length) return ctx.reply("Тікетів в обробці немає.", { reply_markup: adminMainMenu });
  for (const t of tickets.slice(0, 10)) await sendTicketToAdmin(ctx, t);
});

bot.hears("📊 Статистика", async (ctx) => {
  if (!isAdmin(ctx.from!.id)) return;
  const s = await getStats();
  await ctx.reply(
    `📊 *Статистика:*\n\n👥 Користувачів: *${s.totalUsers}*\n🔓 Відкритих: *${s.openTickets}*\n🔄 В обробці: *${s.inProgressTickets}*\n✅ Закритих: *${s.closedTickets}*`,
    { parse_mode: "Markdown", reply_markup: adminMainMenu }
  );
});

bot.hears("👥 Користувачі", async (ctx) => {
  if (!isAdmin(ctx.from!.id)) return;
  const users = await getAllUsers();
  if (!users.length) return ctx.reply("Користувачів ще немає.", { reply_markup: adminMainMenu });
  let text = `👥 *Користувачі (${users.length}):*\n\n`;
  for (const u of users.slice(0, 20)) {
    text += `• ${u.first_name || ""}${u.username ? " @" + u.username : ""} — \`${u.telegram_id}\`\n`;
  }
  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: adminMainMenu });
});

// ──────────────────────────────────────────────
// Callback queries
// ──────────────────────────────────────────────

bot.callbackQuery(/^assign_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery("Немає доступу");
  const ticketId = parseInt(ctx.match[1]);
  await assignTicket(ticketId, ctx.from.id);
  await logEvent("ticket_assigned", ctx.from.id, { ticketId });
  await ctx.answerCallbackQuery("✅ Взято в роботу");
  const ticket = await getTicket(ticketId);
  if (ticket) await bot.api.sendMessage(ticket.user_telegram_id,
    `🔄 Ваш тікет *#${ticketId}* взяли в роботу!`, { parse_mode: "Markdown" }).catch(() => {});
});

bot.callbackQuery(/^aclose_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery("Немає доступу");
  const ticketId = parseInt(ctx.match[1]);
  await updateTicketStatus(ticketId, "closed", ctx.from.id);
  await logEvent("ticket_closed_admin", ctx.from.id, { ticketId });
  await ctx.answerCallbackQuery("✅ Закрито");
  const ticket = await getTicket(ticketId);
  if (ticket) await bot.api.sendMessage(ticket.user_telegram_id,
    `✅ Ваш тікет *#${ticketId}* закрито.\n\nДякуємо за звернення!`,
    { parse_mode: "Markdown", reply_markup: userMainMenu }).catch(() => {});
});

bot.callbackQuery(/^uclose_(\d+)$/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1]);
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.user_telegram_id !== ctx.from.id) return ctx.answerCallbackQuery("Немає доступу");
  await updateTicketStatus(ticketId, "closed");
  await ctx.answerCallbackQuery("✅ Закрито");
  await ctx.editMessageText(`✅ Тікет *#${ticketId}* закрито.`, { parse_mode: "Markdown" });
});

bot.callbackQuery(/^write_(\d+)$/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1]);
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.user_telegram_id !== ctx.from.id) return ctx.answerCallbackQuery("Немає доступу");
  const sess = ctx.session as SessionData;
  sess.state = "messaging_ticket";
  sess.activeTicketId = ticketId;
  await ctx.answerCallbackQuery();
  await ctx.reply(`💬 Пишіть повідомлення для тікету *#${ticketId}*:`, { parse_mode: "Markdown", reply_markup: cancelKeyboard });
});

bot.callbackQuery(/^reply_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery("Немає доступу");
  const ticketId = parseInt(ctx.match[1]);
  const sess = ctx.session as SessionData;
  sess.state = "admin_replying";
  sess.replyTicketId = ticketId;
  await ctx.answerCallbackQuery();
  await ctx.reply(`✍️ Відповідь для тікету *#${ticketId}*:`, { parse_mode: "Markdown", reply_markup: cancelKeyboard });
});

bot.callbackQuery(/^view_(\d+)$/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1]);
  const ticket = await getTicket(ticketId);
  if (!ticket) return ctx.answerCallbackQuery("Не знайдено");
  if (!isAdmin(ctx.from.id) && ticket.user_telegram_id !== ctx.from.id) return ctx.answerCallbackQuery("Немає доступу");
  const messages = await getTicketMessages(ticketId);
  await ctx.answerCallbackQuery();
  if (!messages.length) return ctx.reply(`Тікет #${ticketId}: повідомлень немає.`);
  let text = `📜 *Діалог тікету #${ticketId}*\n\n`;
  for (const m of messages) {
    const who = m.role === "admin" ? "👨‍💼 Підтримка" : "👤 Користувач";
    text += `${who} [${new Date(m.created_at).toLocaleString("uk-UA")}]:\n${m.text}\n\n`;
  }
  await ctx.reply(text, { parse_mode: "Markdown" });
});

// ──────────────────────────────────────────────
// Text message handler (state machine)
// ──────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  await upsertUser(ctx.from!);
  const sess = ctx.session as SessionData;
  const text = ctx.message.text;

  if (sess.state === "awaiting_subject") {
    if (text.length > 200) return ctx.reply("Тема занадто довга (до 200 символів):", { reply_markup: cancelKeyboard });
    sess.ticketSubject = text;
    sess.state = "awaiting_ticket_text";
    return ctx.reply("📝 Тепер опиши проблему детально:", { reply_markup: cancelKeyboard });
  }

  if (sess.state === "awaiting_ticket_text") {
    const ticket = await createTicket(ctx.from!.id, sess.ticketSubject!, text);
    sess.state = null; sess.ticketSubject = null;
    if (!ticket) return ctx.reply("❌ Помилка. Спробуй ще раз.", { reply_markup: userMainMenu });
    await logEvent("ticket_created", ctx.from!.id, { ticketId: ticket.id });
    await ctx.reply(
      `✅ Тікет *#${ticket.id}* створено!\n\nТема: _${ticket.subject}_\n\nВідповімо якомога швидше!`,
      { parse_mode: "Markdown", reply_markup: userMainMenu }
    );
    const adminText = `🆕 *Новий тікет #${ticket.id}*\n👤 ${ctx.from!.first_name || ""}${ctx.from!.username ? " (@" + ctx.from!.username + ")" : ""}\n📌 ${ticket.subject}\n💬 ${text.substring(0, 300)}`;
    const btns = new InlineKeyboard().text("💬 Відповісти", `reply_${ticket.id}`).text("🔄 В роботу", `assign_${ticket.id}`);
    if (SUPPORT_CHAT_ID) await bot.api.sendMessage(SUPPORT_CHAT_ID, adminText, { parse_mode: "Markdown", reply_markup: btns }).catch(() => {});
    for (const adminId of ADMIN_IDS) await bot.api.sendMessage(adminId, adminText, { parse_mode: "Markdown", reply_markup: btns }).catch(() => {});
    return;
  }

  if (sess.state === "messaging_ticket") {
    const ticketId = sess.activeTicketId!;
    await addMessage(ticketId, ctx.from!.id, text, "user");
    await logEvent("message_sent", ctx.from!.id, { ticketId, role: "user" });
    sess.state = null; sess.activeTicketId = null;
    await ctx.reply(`✅ Повідомлення надіслано до тікету *#${ticketId}*.`, { parse_mode: "Markdown", reply_markup: userMainMenu });
    const notifyText = `💬 *Нове повідомлення в тікеті #${ticketId}*\n👤 ${ctx.from!.first_name || ""}\n\n${text.substring(0, 500)}`;
    const btns = new InlineKeyboard().text("💬 Відповісти", `reply_${ticketId}`);
    if (SUPPORT_CHAT_ID) await bot.api.sendMessage(SUPPORT_CHAT_ID, notifyText, { parse_mode: "Markdown", reply_markup: btns }).catch(() => {});
    for (const adminId of ADMIN_IDS) await bot.api.sendMessage(adminId, notifyText, { parse_mode: "Markdown", reply_markup: btns }).catch(() => {});
    return;
  }

  if (sess.state === "admin_replying" && isAdmin(ctx.from!.id)) {
    const ticketId = sess.replyTicketId!;
    const ticket = await getTicket(ticketId);
    sess.state = null; sess.replyTicketId = null;
    if (!ticket) return ctx.reply("Тікет не знайдено.", { reply_markup: adminMainMenu });
    await addMessage(ticketId, ctx.from!.id, text, "admin");
    await logEvent("message_sent", ctx.from!.id, { ticketId, role: "admin" });
    if (ticket.status === "open") await assignTicket(ticketId, ctx.from!.id);
    await ctx.reply(`✅ Відповідь надіслано у тікет *#${ticketId}*.`, { parse_mode: "Markdown", reply_markup: adminMainMenu });
    await bot.api.sendMessage(
      ticket.user_telegram_id,
      `💬 *Відповідь по тікету #${ticketId}:*\n\n${text}`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💬 Відповісти", `write_${ticketId}`).text("✅ Закрити", `uclose_${ticketId}`) }
    ).catch(() => {});
    return;
  }

  await ctx.reply("Скористайся меню нижче 👇", { reply_markup: isAdmin(ctx.from!.id) ? adminMainMenu : userMainMenu });
});


// ──────────────────────────────────────────────
// Launch via Webhook (Deno Deploy)
// ──────────────────────────────────────────────

await bot.init();

const APP_URL = "https://xgroup-support-bot.nighthawk2025-dotcom.deno.net";
const WEBHOOK_PATH = `/${BOT_TOKEN}`;

await bot.api.setWebhook(`${APP_URL}${WEBHOOK_PATH}`);
console.log(`🔗 Webhook: ${APP_URL}${WEBHOOK_PATH}`);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
    const update = await req.json();
    await bot.handleUpdate(update);
    return new Response("OK", { status: 200 });
  }
  return new Response("🤖 XGroup Support Bot is running!", { status: 200 });
});

console.log("🤖 XGroup Support Bot (Deno) запущено!");

