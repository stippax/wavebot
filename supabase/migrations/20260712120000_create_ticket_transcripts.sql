create table if not exists public.ticket_transcripts (
  guild_id text not null,
  ticket_id text not null,
  channel_name text not null,
  owner_id text null,
  ticket_type text null,
  closed_by_id text null,
  closed_at timestamptz not null,
  password_salt text not null,
  password_hash text not null,
  transcript jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ticket_transcripts_pkey primary key (guild_id, ticket_id)
);

create index if not exists ticket_transcripts_closed_at_idx
  on public.ticket_transcripts (closed_at desc);

create index if not exists ticket_transcripts_owner_id_idx
  on public.ticket_transcripts (owner_id);

create or replace function public.set_ticket_transcripts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_ticket_transcripts_updated_at on public.ticket_transcripts;

create trigger set_ticket_transcripts_updated_at
before update on public.ticket_transcripts
for each row
execute function public.set_ticket_transcripts_updated_at();
