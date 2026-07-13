create table if not exists public.ponto_states (
  guild_id text primary key,
  state jsonb not null default '{"users": {}}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create or replace function public.set_ponto_states_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_ponto_states_updated_at on public.ponto_states;
create trigger set_ponto_states_updated_at
before update on public.ponto_states
for each row
execute function public.set_ponto_states_updated_at();
