-- Vérifie les messages automatiques et les photos d'avancement.
--
-- À EXÉCUTER SUR UNE BASE DE TEST, JAMAIS EN PRODUCTION.
--
-- Résultat attendu : sept lignes « OK », aucune « ECHEC ».

insert into auth.users (id) values ('a0000000-0000-0000-0000-000000000001');
insert into dv_artisans (public_id, slug, email, display_name, auth_user_id)
  values ('at','at-msg','p@t.fr','Atelier','a0000000-0000-0000-0000-000000000001');
insert into dv_leads (public_id, artisan_id, prenom, telephone, email, code_postal, status)
  select 'l1', id, 'Marie', '0600000000', 'm@t.fr', '69100', 'contacte' from dv_artisans where public_id='at';

-- L'envoi automatique est désactivé par défaut : écrire aux clients de
-- quelqu'un ne doit jamais se déclencher tout seul.
select case when suivi_auto = false then 'OK    envoi automatique désactivé par défaut'
            else 'ECHEC activé par défaut' end from dv_artisans where public_id='at';

-- La troisième phase est acceptée.
insert into dv_photos (lead_id, sort_order, storage_path, phase) select id, 1, 'l1/p.jpg', 'pendant' from dv_leads where public_id='l1';
select case when count(*)=1 then 'OK    phase « pendant » acceptée' else 'ECHEC' end
  from dv_photos where phase='pendant';

do $$
declare ok boolean := false;
begin
  begin
    insert into dv_photos (lead_id, sort_order, storage_path, phase)
      select id, 2, 'l1/x.jpg', 'n_importe_quoi' from dv_leads where public_id='l1';
  exception when check_violation then ok := true;
  end;
  raise notice '%', case when ok then 'OK    une phase inconnue est refusée' else 'ECHEC phase inconnue acceptée' end;
end $$;

-- La date d'envoi du devis se pose toute seule au changement de statut.
update dv_leads set status='devis_envoye' where public_id='l1';
select case when devis_envoye_le is not null then 'OK    date d envoi du devis posée automatiquement'
            else 'ECHEC date absente' end from dv_leads where public_id='l1';

-- Un message d'un type donné ne part qu'une fois.
insert into dv_client_messages (lead_id, kind, subject) select id, 'relance_1', 'Reçu ?' from dv_leads where public_id='l1';
do $$
declare ok boolean := false;
begin
  begin
    insert into dv_client_messages (lead_id, kind, subject) select id, 'relance_1', 'Reçu ?' from dv_leads where public_id='l1';
  exception when unique_violation then ok := true;
  end;
  raise notice '%', case when ok then 'OK    un même message ne part jamais deux fois' else 'ECHEC doublon accepté' end;
end $$;

-- Sauf « avancement », qui peut repartir, mais pas deux fois le même jour.
insert into dv_client_messages (lead_id, kind, subject, sent_at)
  select id, 'avancement', 'Photos', now() - interval '2 days' from dv_leads where public_id='l1';
insert into dv_client_messages (lead_id, kind, subject, sent_at)
  select id, 'avancement', 'Photos', now() from dv_leads where public_id='l1';
select case when count(*)=2 then 'OK    « avancement » peut repartir un autre jour' else 'ECHEC' end
  from dv_client_messages where kind='avancement';
do $$
declare ok boolean := false;
begin
  begin
    insert into dv_client_messages (lead_id, kind, subject, sent_at)
      select id, 'avancement', 'Photos', now() from dv_leads where public_id='l1';
  exception when unique_violation then ok := true;
  end;
  raise notice '%', case when ok then 'OK    mais pas deux fois le même jour' else 'ECHEC deux envois le même jour' end;
end $$;
