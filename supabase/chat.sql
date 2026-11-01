-- 채팅방 (매일 자정 리셋): SQL Editor에 붙여넣고 Run 한 번

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  author text not null,
  created_at timestamptz not null default now()
);
create index if not exists chats_created_idx on public.chats(created_at);

alter table public.chats enable row level security;
drop policy if exists "members" on public.chats;
create policy "members" on public.chats for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.chats to authenticated;

-- 매일 한국시간 자정(= UTC 15:00)에 채팅 전부 삭제
create extension if not exists pg_cron;
select cron.unschedule('reset-chats') where exists (select 1 from cron.job where jobname = 'reset-chats');
select cron.schedule('reset-chats', '0 15 * * *', $$ delete from public.chats $$);
