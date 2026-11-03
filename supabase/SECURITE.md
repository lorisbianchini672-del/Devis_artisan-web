# Cloisonnement des données entre artisans

## Ce qui a été trouvé

La migration `20260917220000_multi_artisans` a cloisonné la table des demandes :
un artisan ne voit que ses propres demandes. Les tables qui en dépendent sont
restées sur les règles d'origine, écrites à l'époque où le site ne servait qu'un
seul artisan :

```sql
create policy photos_select_auth on dv_photos
  for select to authenticated using (true);
```

`using (true)` veut dire : **tout compte connecté peut tout lire**. Pas seulement
l'administrateur — n'importe quel artisan inscrit sur le site.

Tables concernées : `dv_photos`, `dv_lead_travaux`, `dv_lead_events`,
`dv_ai_estimates`, `dv_ai_prestations`, `dv_ai_flags`, `dv_photo_requests`,
`dv_photo_request_items`, `dv_artisans`, et le stockage `chantier-photos`.

## Ce que cela donne en pratique

Test reproductible (`tests/test-cloisonnement.sql`), joué sur un PostgreSQL 16
avec les dix-sept migrations du dépôt. Alice a un dossier client complet, Bob est
un autre artisan qui vient de créer son compte.

| | Bob voit, aujourd'hui | Bob voit, après la migration |
|---|---|---|
| Demandes d'Alice | 0 | 0 |
| Photos de chantier | 1 | 0 |
| Travaux relevés | 1 | 0 |
| Notes internes | 1 | 0 |
| Estimations de l'IA | 1 | 0 |
| Fichiers stockés | 1 | 0 |
| Fiches artisans | 2 | 1 (la sienne) |

Les photos de chantier portent l'adresse, l'intérieur du logement et parfois le
visage des occupants. Les notes contiennent ce que l'artisan écrit sur son client.
C'est le genre de fuite qui se signale à la CNIL dans les 72 heures.

## Ce que fait la migration

`20261103100000_cloisonnement_par_artisan.sql` applique partout la règle déjà
utilisée pour les demandes : on remonte de la ligne jusqu'à l'artisan
propriétaire, et on le compare à l'utilisateur connecté.

Deux fonctions d'appartenance évitent de réécrire la même jointure douze fois :
`dv_lead_is_mine(lead_id)` et `dv_estimate_is_mine(estimate_id)`. Elles sont en
`security definer` pour que la lecture de contrôle ne repasse pas elle-même par
les règles d'accès, et ne renvoient qu'un booléen.

Les photos stockées sont rattachées par le premier dossier de leur chemin, qui
est l'identifiant public de la demande (voir `shared/store.js`).

## Ce que la migration ne change pas

- La page publique d'un artisan : elle passe par la fonction `dv_public_artisan`,
  qui n'est pas modifiée.
- L'envoi d'une demande par un client : les règles d'insertion anonyme restent
  telles quelles.
- Les fonctions serveur (`analyze-lead`, `extract-quote`, `payment-reminders`) :
  elles utilisent la clé de service, qui ne passe pas par ces règles.

## Comment l'appliquer

Supabase → **SQL Editor** → exécuter
`migrations/20261103100000_cloisonnement_par_artisan.sql`.

Puis vérifier, sur une base de test et non en production :
`tests/test-cloisonnement.sql` doit afficher deux fois « OK ».

## Reste à faire ensuite

- **Remettre la connexion.** `shared/supabase-config.js` porte `authRequired: false`,
  ce qui ouvre l'espace artisan sans mot de passe. La branche `securite-connexion`
  contient la bascule ; à décider avec Arthur, car elle coupe la démonstration
  libre.
- **Fermer les inscriptions ouvertes.** Tant que n'importe qui peut créer un
  compte, le cloisonnement est la seule barrière. Dans Supabase →
  Authentication → Providers, une liste d'adresses autorisées ou une validation
  manuelle protège la phase de test.
