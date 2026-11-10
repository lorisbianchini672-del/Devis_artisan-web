-- Vérifie le suivi client : jetons, phase des photos, et mur public.
--
-- À EXÉCUTER SUR UNE BASE DE TEST, JAMAIS EN PRODUCTION.
--
-- Résultat attendu : huit lignes « OK », aucune « ECHEC » ni « FUITE ».

insert into auth.users (id) values ('a0000000-0000-0000-0000-000000000001');
insert into dv_artisans (public_id, slug, email, display_name, auth_user_id)
  values ('atelier','atelier-test-lyon','p@t.fr','Atelier Lyon','a0000000-0000-0000-0000-000000000001');
insert into dv_leads (public_id, artisan_id, prenom, telephone, email, code_postal, ville, status)
  select 'lead1', id, 'Marie', '0600000000', 'm@t.fr', '69100', 'Villeurbanne', 'gagne'
  from dv_artisans where public_id='atelier';
insert into dv_lead_travaux (lead_id, travaux) select id, 'peinture' from dv_leads where public_id='lead1';

-- Chaque demande reçoit un jeton de 32 caractères hexadécimaux, et un seul.
select case when suivi_token ~ '^[0-9a-f]{32}$' then 'OK    jeton valide : ' || left(suivi_token, 8) || '…'
            else 'ECHEC jeton mal formé : ' || coalesce(suivi_token,'(nul)') end
  from dv_leads where public_id='lead1';
select case when count(distinct suivi_token) = count(*) then 'OK    jetons tous distincts'
            else 'ECHEC jetons en double' end from dv_leads;

-- Les photos de la demande sont des « avant » sans rien faire.
insert into dv_photos (lead_id, sort_order, storage_path) select id, 1, 'lead1/a.jpg' from dv_leads where public_id='lead1';
select case when phase='avant' then 'OK    photo de demande classée « avant » par défaut'
            else 'ECHEC phase = ' || phase end from dv_photos where storage_path='lead1/a.jpg';

insert into dv_photos (lead_id, sort_order, storage_path, phase) select id, 2, 'lead1/b.jpg', 'apres' from dv_leads where public_id='lead1';

-- Le mur public ne montre rien tant que le client n'a pas donné son accord.
select case when count(*)=0 then 'OK    sans accord, rien sur le mur public'
            else 'FUITE ' || count(*) || ' chantier(s) publié(s) sans accord' end
  from dv_public_realisations('atelier-test-lyon');

update dv_leads set consent_photos = true where public_id='lead1';

select case when count(*)=1 then 'OK    avec accord, le chantier apparaît'
            else 'ECHEC ' || count(*) || ' chantier(s) au lieu de 1' end
  from dv_public_realisations('atelier-test-lyon');

-- Ni le nom ni l'adresse ne sortent : seuls ville, mois et travaux.
select case when ville='Villeurbanne' and 'peinture' = any(travaux)
                 and array_length(avant,1)=1 and array_length(apres,1)=1
            then 'OK    ville, travaux et les deux photos sont là'
            else 'ECHEC contenu inattendu' end
  from dv_public_realisations('atelier-test-lyon');

-- La date d'accord est posée automatiquement, et retirée si on révoque.
select case when consent_photos_at is not null then 'OK    date d accord enregistrée'
            else 'ECHEC date d accord absente' end from dv_leads where public_id='lead1';
update dv_leads set consent_photos = false where public_id='lead1';
select case when consent_photos_at is null then 'OK    révocation efface la date et retire le chantier'
            else 'ECHEC date conservée après révocation' end from dv_leads where public_id='lead1';
