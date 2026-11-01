-- 지도 (갔던 곳 기록): SQL Editor에 붙여넣고 Run 한 번

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  date date not null,
  memo text,
  photos text[] not null default '{}',
  author text not null,
  created_at timestamptz not null default now()
);

alter table public.places enable row level security;
drop policy if exists "members" on public.places;
create policy "members" on public.places for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.places to authenticated;
