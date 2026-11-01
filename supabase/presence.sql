-- 접속 중 표시 + 채팅 읽음 표시: SQL Editor에 붙여넣고 Run 한 번

create table if not exists public.presence (
  name text primary key,
  last_seen timestamptz not null default now(),
  active boolean not null default false,
  chat_seen_at timestamptz
);

alter table public.presence enable row level security;
drop policy if exists "members" on public.presence;
create policy "members" on public.presence for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.presence to authenticated;
