create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  discord_user_id text unique,
  username text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.bot_registrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  server_id text not null unique,
  bot_name text not null,
  logo_url text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists bot_registrations_owner_id_idx
  on public.bot_registrations (owner_id);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create or replace function public.set_bot_registrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

drop trigger if exists set_bot_registrations_updated_at on public.bot_registrations;
create trigger set_bot_registrations_updated_at
before update on public.bot_registrations
for each row
execute function public.set_bot_registrations_updated_at();

alter table public.profiles enable row level security;
alter table public.bot_registrations enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can read own bot registrations" on public.bot_registrations;
create policy "Users can read own bot registrations"
  on public.bot_registrations
  for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Users can insert own bot registrations" on public.bot_registrations;
create policy "Users can insert own bot registrations"
  on public.bot_registrations
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Users can update own bot registrations" on public.bot_registrations;
create policy "Users can update own bot registrations"
  on public.bot_registrations
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own bot registrations" on public.bot_registrations;
create policy "Users can delete own bot registrations"
  on public.bot_registrations
  for delete
  to authenticated
  using (auth.uid() = owner_id);
