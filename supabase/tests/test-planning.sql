-- Vérifie les droits sur le planning selon le rôle.
--
-- À EXÉCUTER SUR UNE BASE DE TEST, JAMAIS EN PRODUCTION : ce script crée des
-- comptes, deux entreprises et des événements, et ne les supprime pas.
--
-- Résultat attendu : six lignes « OK », aucune « ECHEC » ni « FUITE ».

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000000009');
insert into dv_artisans (public_id, email, display_name, auth_user_id) values
  ('atelier','patron@t.fr','Atelier','a0000000-0000-0000-0000-000000000001'),
  ('autre','intrus@t.fr','Autre','b0000000-0000-0000-0000-000000000009');
insert into dv_members (artisan_id, auth_user_id, email, role, status)
  select id,'a0000000-0000-0000-0000-000000000002','sal@t.fr','salarie','actif' from dv_artisans where public_id='atelier';
insert into dv_members (artisan_id, auth_user_id, email, role, status)
  select id,'a0000000-0000-0000-0000-000000000003','cpt@t.fr','comptable','actif' from dv_artisans where public_id='atelier';

begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
insert into dv_events (artisan_id, kind, title, starts_at, ends_at)
  select id,'chantier','Rue des Fleurs', now(), now() + interval '2 days' from dv_artisans where public_id='atelier';
select case when (select count(*) from dv_events)=1 then 'OK    patron cree et voit son chantier' else 'ECHEC patron' end;
commit;

begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
insert into dv_events (artisan_id, kind, title, starts_at, ends_at)
  select id,'rdv','Visite Martin', now(), now() + interval '1 hour' from dv_artisans where public_id='atelier';
select case when (select count(*) from dv_events)=2 then 'OK    salarie voit le planning et peut planifier' else 'ECHEC salarie' end;
commit;

begin;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
set local role authenticated;
select case when (select count(*) from dv_events)=2 then 'OK    comptable consulte le planning' else 'ECHEC comptable ne voit pas' end;
commit;

-- Le comptable ne doit pas pouvoir ecrire : on attrape le refus plutot que
-- d'interrompre le script.
do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003', true);
  set local role authenticated;
  begin
    insert into dv_events (artisan_id, kind, title, starts_at, ends_at)
      select id,'rdv','Interdit', now(), now() + interval '1 hour' from dv_artisans where public_id='atelier';
  exception when insufficient_privilege or others then ok := true;
  end;
  reset role;
  raise notice '%', case when ok then 'OK    ecriture refusee au comptable' else 'ECHEC le comptable a pu ecrire' end;
end $$;

do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  begin
    insert into dv_events (artisan_id, kind, title, starts_at, ends_at)
      select id,'rdv','A l envers', now(), now() - interval '1 hour' from dv_artisans where public_id='atelier';
  exception when check_violation or others then ok := true;
  end;
  reset role;
  raise notice '%', case when ok then 'OK    une fin avant le debut est refusee' else 'ECHEC date a l envers acceptee' end;
end $$;

begin;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000009';
set local role authenticated;
select case when (select count(*) from dv_events)=0 then 'OK    aucune fuite vers l autre entreprise' else 'FUITE' end;
commit;
