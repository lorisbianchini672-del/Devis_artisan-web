-- Vérifie les droits de chaque rôle, et le rattachement à l'inscription.
--
-- À EXÉCUTER SUR UNE BASE DE TEST, JAMAIS EN PRODUCTION : ce script crée des
-- comptes, deux entreprises et un dossier, et ne les supprime pas.
--
-- Résultat attendu : sept lignes « OK », aucune « ECHEC » ni « FUITE ».

-- Une entreprise, trois membres : patron, salarié, comptable. Plus un intrus.
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),  -- patron
  ('a0000000-0000-0000-0000-000000000002'),  -- salarié
  ('a0000000-0000-0000-0000-000000000003'),  -- comptable
  ('b0000000-0000-0000-0000-000000000009');  -- artisan d'une autre entreprise

insert into dv_artisans (public_id, email, display_name, auth_user_id) values
  ('atelier','patron@t.fr','Atelier Lyon','a0000000-0000-0000-0000-000000000001'),
  ('autre','intrus@t.fr','Autre Atelier','b0000000-0000-0000-0000-000000000009');

insert into dv_members (artisan_id, auth_user_id, email, role, status)
select id, 'a0000000-0000-0000-0000-000000000002', 'salarie@t.fr', 'salarie', 'actif'
from dv_artisans where public_id='atelier';
insert into dv_members (artisan_id, auth_user_id, email, role, status)
select id, 'a0000000-0000-0000-0000-000000000003', 'compta@t.fr', 'comptable', 'actif'
from dv_artisans where public_id='atelier';

-- Données du patron
insert into dv_leads (public_id, artisan_id, prenom, telephone, email, code_postal)
select 'lead1', id, 'Client', '0600000000', 'c@t.fr', '69100' from dv_artisans where public_id='atelier';
insert into dv_photos (lead_id, sort_order, storage_path) select id, 1, 'lead1/p.jpg' from dv_leads where public_id='lead1';
insert into dv_service_prices (artisan_id, service_label, amount_ht)
select id, 'Tableau', 850 from dv_artisans where public_id='atelier';
insert into dv_payment_settings (artisan_id) select id from dv_artisans where public_id='atelier';
insert into dv_payment_invoices (artisan_id, lead_id, client_name, client_email, number, amount_ttc, issued_on, due_on)
select a.id, l.id, 'Client', 'c@t.fr', 'F-001', 1000, current_date, current_date
from dv_artisans a, dv_leads l where a.public_id='atelier' and l.public_id='lead1';

\echo '--- PATRON : doit tout voir ---'
begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select 'role = ' || dv_my_role((select id from dv_artisans where public_id='atelier')) as r;
select case when (select count(*) from dv_leads)=1 and (select count(*) from dv_service_prices)=1
             and (select count(*) from dv_payment_invoices)=1 and (select count(*) from dv_photos)=1
       then 'OK    patron : demandes, prix, factures, photos'
       else 'ECHEC patron ne voit pas tout' end;
commit;

\echo '--- SALARIE : demandes oui, prix et paiements non ---'
begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select 'role = ' || dv_my_role((select id from dv_artisans where public_id='atelier')) as r;
select 'voit ' || (select count(*) from dv_leads) || ' demande(s), '
    || (select count(*) from dv_photos) || ' photo(s), '
    || (select count(*) from dv_service_prices) || ' prix, '
    || (select count(*) from dv_payment_invoices) || ' facture(s)' as detail;
select case when (select count(*) from dv_leads)=1 and (select count(*) from dv_photos)=1
             and (select count(*) from dv_service_prices)=0 and (select count(*) from dv_payment_invoices)=0
             and (select count(*) from dv_payment_settings)=0
       then 'OK    salarie : chantiers oui, prix et paiements non'
       else 'ECHEC cloisonnement salarie' end;
commit;

\echo '--- COMPTABLE : paiements oui, prix non ---'
begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
set local role authenticated;
select 'role = ' || dv_my_role((select id from dv_artisans where public_id='atelier')) as r;
select case when (select count(*) from dv_payment_invoices)=1 and (select count(*) from dv_service_prices)=0
             and (select count(*) from dv_leads)=1
       then 'OK    comptable : factures oui, prix non'
       else 'ECHEC cloisonnement comptable' end;
commit;

\echo '--- SALARIE ne doit pas pouvoir supprimer une demande ---'
begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
delete from dv_leads where public_id='lead1';
select case when (select count(*) from dv_leads)=1
       then 'OK    suppression refusee au salarie' else 'ECHEC salarie a supprime' end;
rollback;

\echo '--- INTRUS : artisan d une autre entreprise ---'
begin;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000009';
set local role authenticated;
-- Il voit sa propre fiche et sa propre ligne de membre : c'est normal.
-- Rien de l'autre entreprise ne doit apparaitre.
select case when (select count(*) from dv_leads)=0 and (select count(*) from dv_photos)=0
             and (select count(*) from dv_service_prices)=0 and (select count(*) from dv_payment_invoices)=0
             and (select count(*) from dv_payment_settings)=0
             and (select count(*) from dv_members where email <> 'intrus@t.fr')=0
             and (select count(*) from dv_artisans)=1
       then 'OK    aucune fuite : il ne voit que sa propre entreprise'
       else 'FUITE vers l autre entreprise' end;
commit;

\echo '--- SALARIE ne doit pas pouvoir se promouvoir patron ---'
begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
update dv_members set role='patron' where auth_user_id='a0000000-0000-0000-0000-000000000002';
rollback;
begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select case when dv_my_role((select id from dv_artisans where public_id='atelier'))='salarie'
       then 'OK    promotion refusee' else 'ECHEC le salarie s est promu' end;
commit;
-- Le patron ajoute un salarié par son adresse, avant qu'il ait un compte.
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000001','patron2@t.fr');
insert into dv_artisans (public_id, email, display_name, auth_user_id)
  values ('at2','patron2@t.fr','Atelier 2','c0000000-0000-0000-0000-000000000001');
insert into dv_members (artisan_id, email, role, status)
  select id, 'Nouveau.Salarie@T.FR', 'salarie', 'invite' from dv_artisans where public_id='at2';

select 'avant inscription : ' || status || ', compte = ' || coalesce(auth_user_id::text,'aucun')
  from dv_members where lower(email)='nouveau.salarie@t.fr';

-- La personne s'inscrit, avec une casse différente.
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000002','nouveau.salarie@t.fr');

select 'apres inscription : ' || status || ', compte = ' || coalesce(auth_user_id::text,'aucun')
  from dv_members where lower(email)='nouveau.salarie@t.fr';

select case when (select auth_user_id from dv_members where lower(email)='nouveau.salarie@t.fr')
            = 'c0000000-0000-0000-0000-000000000002'
       then 'OK    rattachement automatique a l inscription'
       else 'ECHEC rattachement' end;
