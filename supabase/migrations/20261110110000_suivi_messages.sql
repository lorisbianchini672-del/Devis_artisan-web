-- Messages automatiques au client, relances de devis, photos d'avancement.
--
-- Prolonge le suivi client : au lieu d'attendre que le client ouvre sa page,
-- on lui écrit aux moments qui comptent. Et pendant le chantier, les photos
-- d'avancement donnent une raison d'y revenir.
--
-- À appliquer après 20261110100000_suivi_client.sql.

-- ---------------------------------------------------------------------------
-- Une troisième phase : pendant
--
-- Les photos de chantier en cours ne sont ni l'avant ni l'après. Elles vivent
-- sur la page de suivi, pas sur le mur public.
-- ---------------------------------------------------------------------------
alter table dv_photos drop constraint if exists dv_photos_phase_check;
alter table dv_photos
  add constraint dv_photos_phase_check check (phase in ('avant', 'pendant', 'apres'));

-- ---------------------------------------------------------------------------
-- Ce qui a déjà été envoyé
--
-- Même garde-fou que pour les relances d'impayés : un message d'un type donné
-- ne part qu'une fois par demande. Sans cette table, une tâche qui repasse
-- écrirait deux fois au client, et c'est le genre de détail qui fait
-- désinstaller un outil.
-- ---------------------------------------------------------------------------
create table if not exists dv_client_messages (
  id bigint generated always as identity primary key,
  lead_id bigint not null references dv_leads(id) on delete cascade,
  kind text not null
    check (kind in (
      'devis_annonce',    -- « votre devis vous parvient le … »
      'devis_pret',       -- « votre devis est disponible »
      'relance_1',        -- J+2  : bien reçu ?
      'relance_2',        -- J+7  : une question ?
      'relance_3',        -- J+15 : la validité approche
      'chantier_demain',  -- la veille du démarrage
      'avancement',       -- de nouvelles photos sont en ligne
      'chantier_fini'     -- c'est terminé, voici l'avant/après
    )),
  sent_at timestamptz not null default now(),
  channel text not null default 'email',
  subject text
);

create unique index if not exists uq_dv_client_messages
  on dv_client_messages (lead_id, kind);
create index if not exists idx_dv_client_messages_lead
  on dv_client_messages (lead_id, sent_at desc);

-- « avancement » peut repartir à chaque nouvelle série de photos : on le sort
-- de l'unicité en le datant par jour.
--
-- Le fuseau est écrit en toutes lettres : « sent_at::date » dépend du réglage
-- de la session et n'est donc pas utilisable dans un index. Europe/Paris est le
-- fuseau des artisans visés, et c'est leur journée qui fait foi.
drop index if exists uq_dv_client_messages;
create unique index if not exists uq_dv_client_messages
  on dv_client_messages (lead_id, kind, ((sent_at at time zone 'Europe/Paris')::date))
  where kind = 'avancement';
create unique index if not exists uq_dv_client_messages_once
  on dv_client_messages (lead_id, kind)
  where kind <> 'avancement';

-- ---------------------------------------------------------------------------
-- Le réglage de l'artisan
--
-- Écrire à un client en son nom ne doit jamais se déclencher sans qu'il l'ait
-- décidé. Désactivé par défaut.
-- ---------------------------------------------------------------------------
alter table dv_artisans add column if not exists suivi_auto boolean not null default false;

-- Date d'envoi du devis : la cadence des relances se compte à partir d'elle.
alter table dv_leads add column if not exists devis_envoye_le timestamptz;

create or replace function dv_marque_devis_envoye()
returns trigger language plpgsql as $$
begin
  if new.status = 'devis_envoye' and coalesce(old.status, '') <> 'devis_envoye'
     and new.devis_envoye_le is null then
    new.devis_envoye_le := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_dv_devis_envoye on dv_leads;
create trigger trg_dv_devis_envoye before update on dv_leads
  for each row execute function dv_marque_devis_envoye();

-- ---------------------------------------------------------------------------
-- Accès : l'artisan lit l'historique de ses envois.
-- ---------------------------------------------------------------------------
alter table dv_client_messages enable row level security;

drop policy if exists client_messages_own on dv_client_messages;
create policy client_messages_own on dv_client_messages
  for select to authenticated
  using (exists (
    select 1 from dv_leads l
    join dv_artisans a on a.id = l.artisan_id
    where l.id = lead_id and a.auth_user_id = auth.uid()
  ));

grant select on dv_client_messages to authenticated;
