-- Plusieurs comptes par entreprise, avec des droits différents.
--
-- Jusqu'ici, une entreprise = un compte : dv_artisans.auth_user_id. Un patron qui
-- veut que son salarié consulte les chantiers doit lui donner son mot de passe,
-- ce qui ouvre aussi les prix et les paiements.
--
-- Cette migration ajoute une table de membres et refait les règles d'accès pour
-- qu'elles reposent sur l'appartenance à l'entreprise, et non plus sur un compte
-- unique. Trois rôles :
--
--   patron    tout : clients, prix, devis, paiements, réglages, équipe
--   salarie   les demandes et les chantiers ; ni prix, ni paiements, ni réglages
--   comptable les paiements et factures ; les demandes en lecture seule
--
-- À appliquer APRÈS 20261103100000_cloisonnement_par_artisan.sql, dont elle
-- reprend et étend les règles.

-- ---------------------------------------------------------------------------
-- La table des membres
-- ---------------------------------------------------------------------------
create table if not exists dv_members (
  id bigint generated always as identity primary key,
  artisan_id bigint not null references dv_artisans(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'salarie'
    check (role in ('patron', 'salarie', 'comptable')),
  status text not null default 'invite'
    check (status in ('invite', 'actif', 'suspendu')),
  created_at timestamptz not null default now(),
  invited_by bigint references dv_members(id) on delete set null
);

create unique index if not exists uq_dv_members_user
  on dv_members (artisan_id, auth_user_id) where auth_user_id is not null;
create unique index if not exists uq_dv_members_email
  on dv_members (artisan_id, lower(email));
create index if not exists idx_dv_members_user on dv_members (auth_user_id);

-- Les comptes qui existent déjà deviennent patrons de leur entreprise.
-- Le filtre sur auth.users évite d'échouer sur une fiche dont le compte a été
-- supprimé, ou sur les données d'exemple livrées avec le schéma initial.
insert into dv_members (artisan_id, auth_user_id, email, display_name, role, status)
select a.id, a.auth_user_id, coalesce(a.email, ''), a.display_name, 'patron', 'actif'
from dv_artisans a
join auth.users u on u.id = a.auth_user_id
on conflict do nothing;

-- Un nouvel atelier crée son patron du même mouvement.
create or replace function dv_members_seed_patron()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is not null
     and exists (select 1 from auth.users u where u.id = new.auth_user_id) then
    insert into dv_members (artisan_id, auth_user_id, email, display_name, role, status)
    values (new.id, new.auth_user_id, coalesce(new.email, ''), new.display_name, 'patron', 'actif')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_dv_members_seed on dv_artisans;
create trigger trg_dv_members_seed after insert on dv_artisans
  for each row execute function dv_members_seed_patron();

-- ---------------------------------------------------------------------------
-- À quelles entreprises j'appartiens, et avec quel rôle
--
-- security definer : ces fonctions lisent dv_members pour décider d'un accès.
-- Sans cela, la lecture de contrôle repasserait par les règles de dv_members et
-- tournerait en rond. Elles ne renvoient que des identifiants et un rôle.
-- ---------------------------------------------------------------------------
create or replace function dv_my_artisan_ids()
returns setof bigint
language sql stable security definer set search_path = public as $$
  select a.id from dv_artisans a where a.auth_user_id = auth.uid()
  union
  select m.artisan_id from dv_members m
   where m.auth_user_id = auth.uid() and m.status = 'actif';
$$;

create or replace function dv_my_role(p_artisan_id bigint)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.role from dv_members m
      where m.artisan_id = p_artisan_id
        and m.auth_user_id = auth.uid()
        and m.status = 'actif'
      limit 1),
    -- Le propriétaire historique reste patron même sans ligne de membre.
    (select 'patron' from dv_artisans a
      where a.id = p_artisan_id and a.auth_user_id = auth.uid())
  );
$$;

/** Vrai si j'ai l'un des rôles demandés dans cette entreprise. */
create or replace function dv_has_role(p_artisan_id bigint, p_roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select dv_my_role(p_artisan_id) = any(p_roles);
$$;

/** Même question, à partir d'une demande. */
create or replace function dv_lead_role(p_lead_id bigint, p_roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dv_leads l
    where l.id = p_lead_id and dv_has_role(l.artisan_id, p_roles)
  );
$$;

revoke all on function dv_my_artisan_ids() from public, anon;
revoke all on function dv_my_role(bigint) from public, anon;
revoke all on function dv_has_role(bigint, text[]) from public, anon;
revoke all on function dv_lead_role(bigint, text[]) from public, anon;
grant execute on function dv_my_artisan_ids() to authenticated;
grant execute on function dv_my_role(bigint) to authenticated;
grant execute on function dv_has_role(bigint, text[]) to authenticated;
grant execute on function dv_lead_role(bigint, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Qui voit la liste des membres : tout le monde dans l'entreprise la lit,
-- seul le patron la modifie.
-- ---------------------------------------------------------------------------
alter table dv_members enable row level security;

drop policy if exists members_select_own on dv_members;
create policy members_select_own on dv_members
  for select to authenticated
  using (artisan_id in (select dv_my_artisan_ids()));

drop policy if exists members_write_patron on dv_members;
create policy members_write_patron on dv_members
  for all to authenticated
  using (dv_has_role(artisan_id, array['patron']))
  with check (dv_has_role(artisan_id, array['patron']));

grant select on dv_members to authenticated;
grant insert, update, delete on dv_members to authenticated;

-- ---------------------------------------------------------------------------
-- Les demandes et tout ce qui s'y rattache : patron et salarié travaillent
-- dessus, le comptable les consulte.
-- ---------------------------------------------------------------------------
drop policy if exists leads_select_auth on dv_leads;
create policy leads_select_team on dv_leads
  for select to authenticated
  using (artisan_id in (select dv_my_artisan_ids()));

drop policy if exists leads_update_auth on dv_leads;
create policy leads_update_team on dv_leads
  for update to authenticated
  using (dv_has_role(artisan_id, array['patron', 'salarie']))
  with check (dv_has_role(artisan_id, array['patron', 'salarie']));

drop policy if exists leads_delete_auth on dv_leads;
create policy leads_delete_patron on dv_leads
  for delete to authenticated
  using (dv_has_role(artisan_id, array['patron']));

drop policy if exists travaux_select_own on dv_lead_travaux;
create policy travaux_select_team on dv_lead_travaux
  for select to authenticated using (dv_lead_role(lead_id, array['patron', 'salarie', 'comptable']));
drop policy if exists travaux_delete_own on dv_lead_travaux;
create policy travaux_delete_team on dv_lead_travaux
  for delete to authenticated using (dv_lead_role(lead_id, array['patron', 'salarie']));

drop policy if exists photos_select_own on dv_photos;
create policy photos_select_team on dv_photos
  for select to authenticated using (dv_lead_role(lead_id, array['patron', 'salarie', 'comptable']));
drop policy if exists photos_delete_own on dv_photos;
create policy photos_delete_team on dv_photos
  for delete to authenticated using (dv_lead_role(lead_id, array['patron', 'salarie']));

drop policy if exists events_all_own on dv_lead_events;
create policy events_select_team on dv_lead_events
  for select to authenticated using (dv_lead_role(lead_id, array['patron', 'salarie', 'comptable']));
create policy events_write_team on dv_lead_events
  for insert to authenticated with check (dv_lead_role(lead_id, array['patron', 'salarie']));
create policy events_update_team on dv_lead_events
  for update to authenticated
  using (dv_lead_role(lead_id, array['patron', 'salarie']))
  with check (dv_lead_role(lead_id, array['patron', 'salarie']));
create policy events_delete_team on dv_lead_events
  for delete to authenticated using (dv_lead_role(lead_id, array['patron']));

drop policy if exists preq_all_own on dv_photo_requests;
create policy preq_all_team on dv_photo_requests
  for all to authenticated
  using (dv_lead_role(lead_id, array['patron', 'salarie']))
  with check (dv_lead_role(lead_id, array['patron', 'salarie']));

drop policy if exists preq_items_all_own on dv_photo_request_items;
create policy preq_items_all_team on dv_photo_request_items
  for all to authenticated
  using (exists (select 1 from dv_photo_requests r
                 where r.id = request_id and dv_lead_role(r.lead_id, array['patron', 'salarie'])))
  with check (exists (select 1 from dv_photo_requests r
                      where r.id = request_id and dv_lead_role(r.lead_id, array['patron', 'salarie'])));

drop policy if exists ai_all_own on dv_ai_estimates;
create policy ai_all_team on dv_ai_estimates
  for all to authenticated
  using (dv_lead_role(lead_id, array['patron', 'salarie']))
  with check (dv_lead_role(lead_id, array['patron', 'salarie']));

-- ---------------------------------------------------------------------------
-- Les prix : le patron seul. C'est la raison d'être des rôles.
-- ---------------------------------------------------------------------------
drop policy if exists service_prices_select_own on dv_service_prices;
create policy service_prices_patron on dv_service_prices
  for select to authenticated
  using (dv_has_role(artisan_id, array['patron']));

drop policy if exists quote_imports_select_own on dv_quote_imports;
drop policy if exists quote_imports_all_own on dv_quote_imports;
create policy quote_imports_patron on dv_quote_imports
  for all to authenticated
  using (dv_has_role(artisan_id, array['patron']))
  with check (dv_has_role(artisan_id, array['patron']));

-- ---------------------------------------------------------------------------
-- Les paiements : patron et comptable.
-- ---------------------------------------------------------------------------
drop policy if exists payment_settings_own on dv_payment_settings;
create policy payment_settings_team on dv_payment_settings
  for all to authenticated
  using (dv_has_role(artisan_id, array['patron', 'comptable']))
  with check (dv_has_role(artisan_id, array['patron', 'comptable']));

drop policy if exists payment_invoices_own on dv_payment_invoices;
create policy payment_invoices_team on dv_payment_invoices
  for all to authenticated
  using (dv_has_role(artisan_id, array['patron', 'comptable']))
  with check (dv_has_role(artisan_id, array['patron', 'comptable']));

-- ---------------------------------------------------------------------------
-- La fiche de l'entreprise : lue par l'équipe, modifiée par le patron.
-- ---------------------------------------------------------------------------
drop policy if exists artisans_select_own on dv_artisans;
create policy artisans_select_team on dv_artisans
  for select to authenticated
  using (id in (select dv_my_artisan_ids()));

drop policy if exists artisans_update_own on dv_artisans;
create policy artisans_update_patron on dv_artisans
  for update to authenticated
  using (dv_has_role(id, array['patron']))
  with check (dv_has_role(id, array['patron']));

-- ---------------------------------------------------------------------------
-- Les photos stockées suivent les demandes.
-- ---------------------------------------------------------------------------
drop policy if exists chantier_photos_select_own on storage.objects;
create policy chantier_photos_select_team on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chantier-photos'
    and exists (
      select 1 from dv_leads l
      where l.public_id = (storage.foldername(name))[1]
        and dv_has_role(l.artisan_id, array['patron', 'salarie', 'comptable'])
    )
  );

drop policy if exists chantier_photos_delete_own on storage.objects;
create policy chantier_photos_delete_team on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chantier-photos'
    and exists (
      select 1 from dv_leads l
      where l.public_id = (storage.foldername(name))[1]
        and dv_has_role(l.artisan_id, array['patron', 'salarie'])
    )
  );

-- ---------------------------------------------------------------------------
-- Rattachement à l'inscription
--
-- Le patron ajoute une adresse et un rôle avant que la personne ait un compte.
-- Quand elle s'inscrit avec cette adresse, sa ligne de membre se rattache à son
-- compte. Pas d'invitation par courrier électronique à configurer : le patron
-- lui dit simplement de créer son compte avec cette adresse.
-- ---------------------------------------------------------------------------
create or replace function dv_members_link_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update dv_members
     set auth_user_id = new.id,
         status = case when status = 'invite' then 'actif' else status end
   where auth_user_id is null
     and new.email is not null
     and lower(email) = lower(new.email);
  return new;
end $$;

drop trigger if exists trg_dv_members_link on auth.users;
create trigger trg_dv_members_link after insert on auth.users
  for each row execute function dv_members_link_on_signup();
