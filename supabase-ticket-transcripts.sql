create table if not exists public.ticket_transcripts (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  ticket_id text not null,
  channel_name text,
  owner_id text,
  ticket_type text,
  closed_by_id text,
  closed_at timestamptz not null default now(),
  password_salt text not null,
  password_hash text not null,
  transcript jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, ticket_id)
);

create index if not exists ticket_transcripts_guild_ticket_idx
  on public.ticket_transcripts (guild_id, ticket_id);

alter table public.ticket_transcripts enable row level security;

drop policy if exists "Service role can manage ticket transcripts" on public.ticket_transcripts;

create policy "Service role can manage ticket transcripts"
  on public.ticket_transcripts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
