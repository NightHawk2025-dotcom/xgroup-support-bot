const supabase = require('./supabase')

// ──────────────────────────────────────────────
// USERS
// ──────────────────────────────────────────────

async function upsertUser(ctx) {
  const u = ctx.from
  const { data, error } = await supabase
    .from('users')
    .upsert({
      telegram_id: u.id,
      username: u.username || null,
      first_name: u.first_name || null,
      last_name: u.last_name || null,
      language_code: u.language_code || null,
      last_seen: new Date().toISOString()
    }, { onConflict: 'telegram_id' })
    .select()
    .single()

  if (error) console.error('upsertUser error:', error.message)
  return data
}

async function getUser(telegramId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()
  return data
}

async function getAllUsers() {
  const { data } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
  return data || []
}

// ──────────────────────────────────────────────
// TICKETS
// ──────────────────────────────────────────────

async function createTicket(telegramId, subject, text) {
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      user_telegram_id: telegramId,
      subject,
      status: 'open'
    })
    .select()
    .single()

  if (error) { console.error('createTicket error:', error.message); return null }

  // save first message
  if (data) await addMessage(data.id, telegramId, text, 'user')
  return data
}

async function getTicket(ticketId) {
  const { data } = await supabase
    .from('tickets')
    .select('*, users(*)')
    .eq('id', ticketId)
    .single()
  return data
}

async function getUserOpenTicket(telegramId) {
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('user_telegram_id', telegramId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data
}

async function getUserTickets(telegramId) {
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('user_telegram_id', telegramId)
    .order('created_at', { ascending: false })
  return data || []
}

async function getAllTickets(status = null) {
  let query = supabase
    .from('tickets')
    .select('*, users(first_name, username, telegram_id)')
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data } = await query
  return data || []
}

async function updateTicketStatus(ticketId, status, adminId = null) {
  const update = { status }
  if (status === 'closed') {
    update.closed_at = new Date().toISOString()
    update.closed_by = adminId
  }

  const { data, error } = await supabase
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select()
    .single()

  if (error) console.error('updateTicketStatus error:', error.message)
  return data
}

async function assignTicket(ticketId, adminId) {
  const { data, error } = await supabase
    .from('tickets')
    .update({ assigned_to: adminId, status: 'in_progress' })
    .eq('id', ticketId)
    .select()
    .single()

  if (error) console.error('assignTicket error:', error.message)
  return data
}

// ──────────────────────────────────────────────
// MESSAGES
// ──────────────────────────────────────────────

async function addMessage(ticketId, senderTelegramId, text, role) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      ticket_id: ticketId,
      sender_telegram_id: senderTelegramId,
      text,
      role  // 'user' | 'admin'
    })
    .select()
    .single()

  if (error) console.error('addMessage error:', error.message)
  return data
}

async function getTicketMessages(ticketId) {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  return data || []
}

// ──────────────────────────────────────────────
// LOGS
// ──────────────────────────────────────────────

async function logEvent(type, telegramId, meta = {}) {
  const { error } = await supabase
    .from('logs')
    .insert({
      event_type: type,
      telegram_id: telegramId,
      meta
    })

  if (error) console.error('logEvent error:', error.message)
}

// ──────────────────────────────────────────────
// STATS
// ──────────────────────────────────────────────

async function getStats() {
  const [usersRes, openRes, inProgressRes, closedRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
  ])

  return {
    totalUsers: usersRes.count || 0,
    openTickets: openRes.count || 0,
    inProgressTickets: inProgressRes.count || 0,
    closedTickets: closedRes.count || 0,
  }
}

module.exports = {
  upsertUser, getUser, getAllUsers,
  createTicket, getTicket, getUserOpenTicket, getUserTickets, getAllTickets,
  updateTicketStatus, assignTicket,
  addMessage, getTicketMessages,
  logEvent, getStats
}
