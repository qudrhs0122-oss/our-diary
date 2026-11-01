-- 하트 누른 횟수: SQL Editor에 붙여넣고 Run 한 번

create table if not exists public.hearts (
  name text primary key,
  side text,
  count bigint not null default 0
);

alter table public.hearts enable row level security;
drop policy if exists "members" on public.hearts;
create policy "members" on public.hearts for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.hearts to authenticated;

-- 누른 횟수를 안전하게 더하기
create or replace function public.add_hearts(p_name text, p_side text, p_n int)
returns bigint
language sql
as $$
  insert into public.hearts (name, side, count) values (p_name, p_side, greatest(p_n, 0))
  on conflict (name) do update
    set count = public.hearts.count + greatest(excluded.count, 0),
        side = excluded.side
  returning count;
$$;
grant execute on function public.add_hearts(text, text, int) to authenticated;
