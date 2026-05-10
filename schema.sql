-- ============================================
-- XGroup Support Bot — Supabase Schema
-- Запусти це в Supabase SQL Editor
-- ============================================

-- USERS
create table if not exists users (
  id bigserial primary key,
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  language_code text,
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

-- TICKETS
create table if not exists tickets (
  id bigserial primary key,
  user_telegram_id bigint not null references users(telegram_id),
  subject text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  assigned_to bigint,          -- admin telegram_id
  closed_by bigint,            -- admin telegram_id
  closed_at timestamptz,
  created_at timestamptz default now()
);

-- MESSAGES
create table if not exists messages (
  id bigserial primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  sender_telegram_id bigint not null,
  text text not null,
  role text not null check (role in ('user', 'admin')),
  created_at timestamptz default now()
);

-- LOGS
create table if not exists logs (
  id bigserial primary key,
  event_type text not null,
  telegram_id bigint,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

-- INDEXES
create index if not exists idx_tickets_user on tickets(user_telegram_id);
create index if not exists idx_tickets_status on tickets(status);
create index if not exists idx_messages_ticket on messages(ticket_id);
create index if not exists idx_logs_event on logs(event_type);
create index if not exists idx_logs_user on logs(telegram_id);

-- RLS (Row Level Security) — вимикаємо для бота (він використовує anon key)
alter table users enable row level security;
alter table tickets enable row level security;
alter table messages enable row level security;
alter table logs enable row level security;

-- Дозволяємо все для anon (бот працює з anon key)
create policy "allow_all_users"    on users    for all using (true) with check (true);
create policy "allow_all_tickets"  on tickets  for all using (true) with check (true);
create policy "allow_all_messages" on messages for all using (true) with check (true);
create policy "allow_all_logs"     on logs     for all using (true) with check (true);
