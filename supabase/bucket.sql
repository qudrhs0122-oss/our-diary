-- 버킷리스트: SQL Editor에 붙여넣고 Run 한 번

create table if not exists public.buckets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text not null,
  done boolean not null default false,
  done_by text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.buckets enable row level security;
drop policy if exists "members" on public.buckets;
create policy "members" on public.buckets for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.buckets to authenticated;
