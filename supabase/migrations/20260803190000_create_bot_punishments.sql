create table if not exists public.bot_punishments (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  user_id text not null,
  level smallint not null check (level between 1 and 3),
  role_id text not null,
  reason text not null,
  moderator_id text not null,
  status text not null default 'active' check (
    status in ('active', 'superseded', 'expired', 'removed_manually', 'member_left', 'exonerated')
  ),
  expires_at timestamptz not null,
  removed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists bot_punishments_one_active_per_member_idx
  on public.bot_punishments (guild_id, user_id)
  where status = 'active';

create index if not exists bot_punishments_expiration_idx
  on public.bot_punishments (guild_id, expires_at)
  where status = 'active';

alter table public.bot_punishments enable row level security;

create or replace function public.record_bot_punishment(
  p_guild_id text,
  p_user_id text,
  p_level smallint,
  p_role_id text,
  p_reason text,
  p_moderator_id text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  punishment_id uuid;
begin
  if p_level < 1 or p_level > 3 then
    raise exception 'Invalid punishment level';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_guild_id || ':' || p_user_id, 0)
  );

  update public.bot_punishments
  set status = 'superseded',
      removed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  where guild_id = p_guild_id
    and user_id = p_user_id
    and status = 'active';

  insert into public.bot_punishments (
    guild_id,
    user_id,
    level,
    role_id,
    reason,
    moderator_id,
    expires_at
  ) values (
    p_guild_id,
    p_user_id,
    p_level,
    p_role_id,
    p_reason,
    p_moderator_id,
    p_expires_at
  )
  returning id into punishment_id;

  return punishment_id;
end;
$$;

create or replace function public.record_bot_exoneration(
  p_guild_id text,
  p_user_id text,
  p_role_id text,
  p_reason text,
  p_moderator_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  punishment_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_guild_id || ':' || p_user_id, 0)
  );

  update public.bot_punishments
  set status = 'superseded',
      removed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  where guild_id = p_guild_id
    and user_id = p_user_id
    and status = 'active';

  insert into public.bot_punishments (
    guild_id,
    user_id,
    level,
    role_id,
    reason,
    moderator_id,
    status,
    expires_at,
    removed_at
  ) values (
    p_guild_id,
    p_user_id,
    3,
    p_role_id,
    p_reason,
    p_moderator_id,
    'exonerated',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  returning id into punishment_id;

  return punishment_id;
end;
$$;

create or replace function public.set_bot_punishments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_bot_punishments_updated_at on public.bot_punishments;
create trigger set_bot_punishments_updated_at
before update on public.bot_punishments
for each row execute function public.set_bot_punishments_updated_at();

revoke all on function public.record_bot_punishment(text, text, smallint, text, text, text, timestamptz) from public;
grant execute on function public.record_bot_punishment(text, text, smallint, text, text, text, timestamptz) to service_role;

revoke all on function public.record_bot_exoneration(text, text, text, text, text) from public;
grant execute on function public.record_bot_exoneration(text, text, text, text, text) to service_role;
