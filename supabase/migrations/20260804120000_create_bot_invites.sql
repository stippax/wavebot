create table if not exists public.bot_invites (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null check (guild_id ~ '^\d{17,20}$'),
  inviter_id text not null check (inviter_id ~ '^\d{17,20}$'),
  invited_user_id text not null check (invited_user_id ~ '^\d{17,20}$'),
  invite_code text not null,
  invite_uses integer not null default 1 check (invite_uses >= 0),
  joined_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (guild_id, invited_user_id)
);

create index if not exists bot_invites_ranking_idx
  on public.bot_invites (guild_id, inviter_id);

alter table public.bot_invites enable row level security;

revoke all privileges on table public.bot_invites from anon, authenticated;

create or replace function public.get_bot_invite_ranking(
  target_guild_id text,
  result_limit integer default 10
)
returns table (inviter_id text, invite_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select bot_invites.inviter_id, count(*) as invite_count
  from public.bot_invites
  where bot_invites.guild_id = target_guild_id
  group by bot_invites.inviter_id
  order by invite_count desc, bot_invites.inviter_id
  limit least(greatest(coalesce(result_limit, 10), 1), 100);
$$;

revoke all on function public.get_bot_invite_ranking(text, integer) from public, anon, authenticated;
grant execute on function public.get_bot_invite_ranking(text, integer) to service_role;
