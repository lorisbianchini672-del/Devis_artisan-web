-- Planning : rendez-vous clients, chantiers et interventions de l'équipe.
--
-- L'artisan cale ses visites et ses chantiers au même endroit que ses demandes,
-- et voit qui fait quoi. Un événement peut être rattaché à une demande
-- (dv_leads) et confié à un membre de l'équipe (dv_members) : c'est ce qui le
-- rend « connecté » plutôt qu'un agenda de plus.
--
-- À appliquer APRÈS 20261103120000_roles_equipe.sql, dont elle reprend les
-- fonctions d'appartenance.

create table if not exists dv_events (
  id bigint generated always as identity primary key,
  public_id text not null unique
    default ('ev_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  artisan_id bigint not null references dv_artisans(id) on delete cascade,

  -- Rattachements : les deux facultatifs, et conservés si la cible disparaît.
  lead_id bigint references dv_leads(id) on delete set null,
  member_id bigint references dv_members(id) on delete set null,

  kind text not null default 'rdv'
    check (kind in ('rdv', 'chantier', 'autre')),
  title text not null,
  notes text,
  location text,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,

  status text not null default 'prevu'
    check (status in ('prevu', 'confirme', 'fait', 'annule')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un événement qui finit avant de commencer est une erreur de saisie, pas
  -- une donnée à conserver.
  constraint dv_events_ordre check (ends_at >= starts_at)
);

create index if not exists idx_dv_events_artisan_date
  on dv_events (artisan_id, starts_at);
create index if not exists idx_dv_events_lead on dv_events (lead_id);
create index if not exists idx_dv_events_member on dv_events (member_id);

create or replace function dv_events_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_dv_events_touch on dv_events;
create trigger trg_dv_events_touch before update on dv_events
  for each row execute function dv_events_touch();

-- ---------------------------------------------------------------------------
-- Accès : l'équipe voit le planning de son entreprise. Le patron et les
-- salariés le remplissent ; le comptable le consulte sans y toucher.
-- ---------------------------------------------------------------------------
alter table dv_events enable row level security;

drop policy if exists events_cal_select on dv_events;
create policy events_cal_select on dv_events
  for select to authenticated
  using (artisan_id in (select dv_my_artisan_ids()));

drop policy if exists events_cal_write on dv_events;
create policy events_cal_write on dv_events
  for all to authenticated
  using (dv_has_role(artisan_id, array['patron', 'salarie']))
  with check (dv_has_role(artisan_id, array['patron', 'salarie']));

grant select, insert, update, delete on dv_events to authenticated;
