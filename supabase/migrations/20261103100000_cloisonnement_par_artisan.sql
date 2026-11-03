-- Cloisonne par artisan les tables qui ne l'étaient pas encore.
--
-- Constat : la migration 20260917220000_multi_artisans a cloisonné dv_leads
-- (un artisan ne voit que ses propres demandes), mais les tables liées sont
-- restées sur les règles d'origine « to authenticated using (true) ».
-- Conséquence : tout compte connecté, y compris un artisan inscrit ce matin,
-- peut lire les photos de chantier, les relevés de travaux, les notes, les
-- estimations et la liste complète des artisans de tous les autres comptes.
--
-- Cette migration applique partout la même règle que sur dv_leads : on remonte
-- jusqu'à l'artisan propriétaire et on compare à l'utilisateur connecté.
-- À exécuter avant d'ouvrir le service à de vrais comptes.

-- ---------------------------------------------------------------------------
-- Fonction d'appartenance : « cette demande est-elle à moi ? »
-- security definer pour éviter que la lecture de contrôle repasse elle-même
-- par les règles d'accès ; elle ne renvoie qu'un booléen.
-- ---------------------------------------------------------------------------
create or replace function dv_lead_is_mine(p_lead_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from dv_leads l
    join dv_artisans a on a.id = l.artisan_id
    where l.id = p_lead_id
      and a.auth_user_id = auth.uid()
  );
$$;

revoke all on function dv_lead_is_mine(bigint) from public, anon;
grant execute on function dv_lead_is_mine(bigint) to authenticated;

create or replace function dv_estimate_is_mine(p_estimate_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from dv_ai_estimates e
    where e.id = p_estimate_id
      and dv_lead_is_mine(e.lead_id)
  );
$$;

revoke all on function dv_estimate_is_mine(bigint) from public, anon;
grant execute on function dv_estimate_is_mine(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- dv_artisans : chacun ne lit que sa propre fiche.
-- La page publique d'un artisan ne passe pas par ici : elle utilise la
-- fonction dv_public_artisan, qui reste inchangée.
-- ---------------------------------------------------------------------------
drop policy if exists artisans_select_auth on dv_artisans;
create policy artisans_select_own on dv_artisans
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Tables rattachées à une demande
-- ---------------------------------------------------------------------------
drop policy if exists travaux_select_auth on dv_lead_travaux;
create policy travaux_select_own on dv_lead_travaux
  for select to authenticated using (dv_lead_is_mine(lead_id));

drop policy if exists travaux_delete_auth on dv_lead_travaux;
create policy travaux_delete_own on dv_lead_travaux
  for delete to authenticated using (dv_lead_is_mine(lead_id));

drop policy if exists photos_select_auth on dv_photos;
create policy photos_select_own on dv_photos
  for select to authenticated using (dv_lead_is_mine(lead_id));

drop policy if exists photos_delete_auth on dv_photos;
create policy photos_delete_own on dv_photos
  for delete to authenticated using (dv_lead_is_mine(lead_id));

drop policy if exists events_select_auth on dv_lead_events;
drop policy if exists events_all_auth on dv_lead_events;
create policy events_all_own on dv_lead_events
  for all to authenticated
  using (dv_lead_is_mine(lead_id))
  with check (dv_lead_is_mine(lead_id));

drop policy if exists preq_all_auth on dv_photo_requests;
create policy preq_all_own on dv_photo_requests
  for all to authenticated
  using (dv_lead_is_mine(lead_id))
  with check (dv_lead_is_mine(lead_id));

drop policy if exists preq_items_all_auth on dv_photo_request_items;
create policy preq_items_all_own on dv_photo_request_items
  for all to authenticated
  using (exists (select 1 from dv_photo_requests r
                 where r.id = request_id and dv_lead_is_mine(r.lead_id)))
  with check (exists (select 1 from dv_photo_requests r
                      where r.id = request_id and dv_lead_is_mine(r.lead_id)));

-- ---------------------------------------------------------------------------
-- Estimations de l'IA et leur détail
-- ---------------------------------------------------------------------------
drop policy if exists ai_select_auth on dv_ai_estimates;
drop policy if exists ai_all_auth on dv_ai_estimates;
create policy ai_all_own on dv_ai_estimates
  for all to authenticated
  using (dv_lead_is_mine(lead_id))
  with check (dv_lead_is_mine(lead_id));

drop policy if exists ai_presta_auth on dv_ai_prestations;
create policy ai_presta_own on dv_ai_prestations
  for all to authenticated
  using (dv_estimate_is_mine(estimate_id))
  with check (dv_estimate_is_mine(estimate_id));

drop policy if exists ai_flags_auth on dv_ai_flags;
create policy ai_flags_own on dv_ai_flags
  for all to authenticated
  using (dv_estimate_is_mine(estimate_id))
  with check (dv_estimate_is_mine(estimate_id));

-- ---------------------------------------------------------------------------
-- Photos stockées : le premier dossier du chemin est le public_id de la
-- demande (voir shared/store.js, construction du chemin d'envoi).
-- ---------------------------------------------------------------------------
drop policy if exists chantier_photos_select_auth on storage.objects;
create policy chantier_photos_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chantier-photos'
    and exists (
      select 1
      from dv_leads l
      join dv_artisans a on a.id = l.artisan_id
      where l.public_id = (storage.foldername(name))[1]
        and a.auth_user_id = auth.uid()
    )
  );

drop policy if exists chantier_photos_delete_auth on storage.objects;
create policy chantier_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chantier-photos'
    and exists (
      select 1
      from dv_leads l
      join dv_artisans a on a.id = l.artisan_id
      where l.public_id = (storage.foldername(name))[1]
        and a.auth_user_id = auth.uid()
    )
  );
