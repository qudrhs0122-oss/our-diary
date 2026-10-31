-- 우리 다이어리: Supabase SQL Editor에 통째로 붙여넣고 Run 한 번만 누르면 됩니다.

-- 1) 표 만들기
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time time,
  title text not null,
  memo text,
  author text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  body text,
  photo_path text,
  author text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  caption text,
  date date not null,
  author text not null,
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on public.events(date);
create index if not exists photos_date_idx on public.photos(date);
create index if not exists notes_created_idx on public.notes(created_at);

-- 2) 로그인한 사람만 읽고 쓰기
alter table public.events enable row level security;
alter table public.notes  enable row level security;
alter table public.photos enable row level security;

drop policy if exists "members" on public.events;
drop policy if exists "members" on public.notes;
drop policy if exists "members" on public.photos;
create policy "members" on public.events for all to authenticated using (true) with check (true);
create policy "members" on public.notes  for all to authenticated using (true) with check (true);
create policy "members" on public.photos for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.events, public.notes, public.photos to authenticated;

-- 3) 사진 저장소 (비공개)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "members read photos" on storage.objects;
drop policy if exists "members add photos" on storage.objects;
drop policy if exists "members delete photos" on storage.objects;
create policy "members read photos" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "members add photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "members delete photos" on storage.objects for delete to authenticated using (bucket_id = 'photos');
