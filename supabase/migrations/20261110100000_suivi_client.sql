-- Suivi client : une page que le client ouvre quand il veut, comme un suivi de
-- colis, de sa demande jusqu'au chantier fini.
--
-- Le principe tient en une phrase : la page se remplit toute seule à partir de
-- ce que l'artisan fait déjà. On ne lui demande aucune saisie supplémentaire,
-- sinon la page sera morte en deux semaines.
--
-- Autonome : elle fonctionne avec le schéma actuel, et s'enrichit si les
-- migrations du planning (dv_events) et des devis (dv_quotes) sont présentes.

-- ---------------------------------------------------------------------------
-- Le lien du client
--
-- 32 caractères hexadécimaux, soit 128 bits : impossible à deviner, et
-- suffisant pour servir de clé d'accès sans compte. Le jeton ne sort jamais de
-- la fonction serveur et ne figure dans aucune table lisible par un visiteur.
-- ---------------------------------------------------------------------------
alter table dv_leads
  add column if not exists suivi_token text
    default replace(gen_random_uuid()::text, '-', '');

update dv_leads
   set suivi_token = replace(gen_random_uuid()::text, '-', '')
 where suivi_token is null;

create unique index if not exists uq_dv_leads_suivi_token on dv_leads (suivi_token);

-- Date promise au client pour son devis. Sert au message « prêt jeudi », et à
-- alerter l'artisan quand il prend du retard.
alter table dv_leads add column if not exists devis_promis_le date;

-- ---------------------------------------------------------------------------
-- Les photos : avant, après
--
-- Les « avant » existent déjà — ce sont les photos que le client a prises en
-- demandant son devis. On ne les refait pas, on les étiquette.
-- ---------------------------------------------------------------------------
alter table dv_photos
  add column if not exists phase text not null default 'avant'
    check (phase in ('avant', 'apres'));

create index if not exists idx_photo_lead_phase on dv_photos (lead_id, phase, sort_order);

-- ---------------------------------------------------------------------------
-- Le consentement de publication
--
-- Montrer l'intérieur du logement d'un client sur une page publique demande son
-- accord, et c'est un accord distinct de consent_rgpd, qui ne couvre que le
-- traitement des données. Révocable : remettre à faux suffit à retirer les
-- photos du mur public.
-- ---------------------------------------------------------------------------
alter table dv_leads add column if not exists consent_photos boolean not null default false;
alter table dv_leads add column if not exists consent_photos_at timestamptz;

create or replace function dv_consent_photos_touch()
returns trigger language plpgsql as $$
begin
  if new.consent_photos is distinct from old.consent_photos then
    new.consent_photos_at := case when new.consent_photos then now() else null end;
  end if;
  return new;
end $$;

drop trigger if exists trg_dv_consent_photos on dv_leads;
create trigger trg_dv_consent_photos before update on dv_leads
  for each row execute function dv_consent_photos_touch();

-- ---------------------------------------------------------------------------
-- Le mur de réalisations d'un artisan
--
-- Ne renvoie que les chantiers dont le client a donné son accord, et jamais son
-- nom ni son adresse : seuls la ville, le mois et les travaux sortent.
-- security definer, comme dv_public_artisan : la page est consultée sans compte.
-- ---------------------------------------------------------------------------
create or replace function dv_public_realisations(p_artisan text, p_limit int default 12)
returns table (
  lead_ref text,
  ville text,
  mois text,
  travaux text[],
  avant text[],
  apres text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.public_id,
    l.ville,
    to_char(l.created_at, 'TMMonth YYYY'),
    coalesce(array(select t.travaux from dv_lead_travaux t where t.lead_id = l.id), '{}'),
    coalesce(array(select p.storage_path from dv_photos p
                    where p.lead_id = l.id and p.phase = 'avant' and p.storage_path is not null
                    order by p.sort_order), '{}'),
    coalesce(array(select p.storage_path from dv_photos p
                    where p.lead_id = l.id and p.phase = 'apres' and p.storage_path is not null
                    order by p.sort_order), '{}')
  from dv_leads l
  join dv_artisans a on a.id = l.artisan_id
  where (a.public_id = p_artisan or a.slug = p_artisan)
    and l.consent_photos = true
    and l.status = 'gagne'
    -- Un avant/après n'a de sens que si les deux existent.
    and exists (select 1 from dv_photos p where p.lead_id = l.id and p.phase = 'apres')
    and exists (select 1 from dv_photos p where p.lead_id = l.id and p.phase = 'avant')
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 48));
$$;

revoke all on function dv_public_realisations(text, int) from public;
grant execute on function dv_public_realisations(text, int) to anon, authenticated;
