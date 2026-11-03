-- Vérifie qu'un artisan connecté n'accède jamais aux données d'un autre.
--
-- À EXÉCUTER SUR UNE BASE DE TEST, JAMAIS EN PRODUCTION : ce script insère
-- deux artisans et un dossier complet, et ne les supprime pas.
--
-- Le scénario : Alice a un dossier client (demande, photos, travaux, notes,
-- estimation, fichiers). Bob est un autre artisan, inscrit normalement.
-- Bob doit voir zéro partout, et sa seule fiche artisan.
--
-- Résultat attendu, deux fois « OK » :
--   OK   cloisonnement respecté pour Bob
--   OK   Alice accède bien à tout son dossier
--
-- Sans la migration 20261103100000, ce test affiche « FUITE ».

-- Deux artisans, chacun avec son compte, et un dossier complet chez le premier.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.fr'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.fr');

insert into dv_artisans (public_id, email, display_name, auth_user_id) values
  ('art_alice', 'alice@test.fr', 'Alice Electricite', '11111111-1111-1111-1111-111111111111'),
  ('art_bob',   'bob@test.fr',   'Bob Plomberie',     '22222222-2222-2222-2222-222222222222');

insert into dv_leads (public_id, artisan_id, prenom, telephone, email, code_postal)
  select 'dv_lead_alice', id, 'Client', '0600000000', 'client@test.fr', '69100'
  from dv_artisans where public_id = 'art_alice';

insert into dv_lead_travaux (lead_id, travaux) select id, 'tableau' from dv_leads where public_id='dv_lead_alice';
insert into dv_photos (lead_id, sort_order, storage_path) select id, 1, 'dv_lead_alice/photo1.jpg' from dv_leads where public_id='dv_lead_alice';
insert into dv_lead_events (lead_id, kind, message) select id, 'note', 'Note privee d Alice' from dv_leads where public_id='dv_lead_alice';
insert into dv_ai_estimates (lead_id, price_min_ht, price_max_ht, complexity, confidence) select id, 100, 200, 'simple', 'calibre' from dv_leads where public_id='dv_lead_alice';
insert into dv_ai_prestations (estimate_id, sort_order, label, amount_ht) select id, 1, 'Pose', 150 from dv_ai_estimates;
insert into dv_ai_flags (estimate_id, kind, message) select id, 'alerte', 'drapeau' from dv_ai_estimates;
insert into dv_photo_requests (lead_id, note) select id, 'Merci d envoyer une photo' from dv_leads where public_id='dv_lead_alice';
insert into dv_photo_request_items (request_id, label) select id, 'Tableau' from dv_photo_requests;

insert into storage.buckets (id, name) values ('chantier-photos', 'chantier-photos') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values ('chantier-photos', 'dv_lead_alice/photo1.jpg');

-- ---------------------------------------------------------------
-- Bob se connecte. Il ne doit rien voir du dossier d'Alice.
-- ---------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;

select 'BOB voit ' ||
  (select count(*) from dv_leads)                 || ' demande(s), ' ||
  (select count(*) from dv_lead_travaux)          || ' travaux, '    ||
  (select count(*) from dv_photos)                || ' photo(s), '   ||
  (select count(*) from dv_lead_events)           || ' note(s), '    ||
  (select count(*) from dv_ai_estimates)          || ' estimation(s), ' ||
  (select count(*) from dv_ai_prestations)        || ' prestation(s), ' ||
  (select count(*) from dv_ai_flags)              || ' drapeau(x), ' ||
  (select count(*) from dv_photo_requests)        || ' demande(s) de photo, ' ||
  (select count(*) from dv_photo_request_items)   || ' item(s), '     ||
  (select count(*) from storage.objects)          || ' fichier(s), '  ||
  (select count(*) from dv_artisans)              || ' fiche(s) artisan'
  as resultat;

-- Bob ne doit voir que sa propre fiche artisan (1), et zero partout ailleurs.
select case when (
      (select count(*) from dv_leads) = 0
  and (select count(*) from dv_lead_travaux) = 0
  and (select count(*) from dv_photos) = 0
  and (select count(*) from dv_lead_events) = 0
  and (select count(*) from dv_ai_estimates) = 0
  and (select count(*) from dv_ai_prestations) = 0
  and (select count(*) from dv_ai_flags) = 0
  and (select count(*) from dv_photo_requests) = 0
  and (select count(*) from dv_photo_request_items) = 0
  and (select count(*) from storage.objects) = 0
  and (select count(*) from dv_artisans) = 1
) then 'OK   cloisonnement respecte pour Bob'
  else 'FUITE  Bob accede aux donnees d Alice' end as verdict;

commit;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;

select 'ALICE voit ' ||
  (select count(*) from dv_leads)               || ' demande(s), ' ||
  (select count(*) from dv_photos)              || ' photo(s), '   ||
  (select count(*) from dv_lead_events)         || ' note(s), '    ||
  (select count(*) from dv_ai_prestations)      || ' prestation(s), ' ||
  (select count(*) from storage.objects)        || ' fichier(s)'
  as resultat;

select case when (
      (select count(*) from dv_leads) = 1
  and (select count(*) from dv_lead_travaux) = 1
  and (select count(*) from dv_photos) = 1
  and (select count(*) from dv_lead_events) = 1
  and (select count(*) from dv_ai_estimates) = 1
  and (select count(*) from dv_ai_prestations) = 1
  and (select count(*) from dv_ai_flags) = 1
  and (select count(*) from dv_photo_requests) = 1
  and (select count(*) from dv_photo_request_items) = 1
  and (select count(*) from storage.objects) = 1
  and (select count(*) from dv_artisans) = 1
) then 'OK   Alice accede bien a tout son dossier'
  else 'REGRESSION  Alice ne voit plus ses propres donnees' end as verdict;
commit;
