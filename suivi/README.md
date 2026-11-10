# Suivi client

Une page privée que le client ouvre quand il veut, de sa demande jusqu'au
chantier fini. Page : `suivi/index.html?t=<jeton>`.

## Le principe

**La page se remplit toute seule.** C'est la seule décision qui compte : un
artisan ne se connectera jamais pour mettre à jour un statut, donc rien ne lui
est demandé. Le parcours se déduit de ce qu'il fait déjà dans l'outil.

| Ce que l'artisan fait | Ce que le client voit |
|---|---|
| La demande arrive | « Demande reçue » |
| Il crée un rendez-vous au planning | « Visite prévue mardi à 10 h » |
| Il enregistre un devis | « Devis en préparation » |
| Il le marque envoyé | « Devis envoyé » |
| Il passe la demande en « Gagné » | « Devis accepté » |
| Il ajoute les photos de fin | « Chantier terminé » + avant/après |

**La branche est autonome** : le suivi fonctionne avec le schéma actuel, et
s'enrichit si les migrations du planning (`dv_events`) et des devis
(`dv_quotes`) sont passées. La fonction serveur tolère leur absence.

## L'avant/après ne coûte presque rien

Les photos « avant » existent déjà : ce sont celles que le client a prises en
demandant son devis. La migration les étiquette, elle ne les refait pas. Il ne
manquait que le geste de fin de chantier, et un comparateur à glissière.

## Le lien

32 caractères hexadécimaux, soit 128 bits : impossible à deviner. Il ne sort
jamais de la fonction serveur et ne figure dans aucune table lisible par un
visiteur. Pas de compte, pas de mot de passe — le client reçoit son lien par
message et le garde.

La page porte `noindex, nofollow`.

## Le consentement de publication

Montrer l'intérieur du logement d'un client sur une page publique demande son
accord, et c'est un accord **distinct** de `consent_rgpd`, qui ne couvre que le
traitement des données.

- La question n'est posée au client qu'**une fois le chantier terminé**, sur sa
  page de suivi.
- C'est l'artisan qui enregistre la réponse, depuis la fiche client, après en
  avoir parlé. La page de suivi ne modifie rien en base : elle n'a pas de droits
  d'écriture, et une case cochée par un lien public ne vaut pas consentement.
- Révocable : décocher retire le chantier du mur public et efface la date.
- `dv_public_realisations` ne renvoie **jamais** le nom ni l'adresse : seulement
  la ville, le mois et le type de travaux.

## Mise en service

1. SQL Editor → `supabase/migrations/20261110100000_suivi_client.sql`
2. `supabase functions deploy suivi`
3. Aucun nouveau secret.

Vérification : `supabase/tests/test-suivi-client.sql` sur une base de test,
huit « OK ».

## Ce qui n'a pas pu être testé ici

Le côté artisan — récupération du lien, envoi des photos « après », case de
consentement — demande une vraie base Supabase. La mise en page est vérifiée,
le chemin de données ne l'est pas. À essayer avec un compte réel avant de
montrer la page à un client.

## Ce qui reste à faire

- **Le mur de réalisations** sur la page publique de l'artisan : la fonction
  `dv_public_realisations` existe et est testée, l'affichage reste à écrire.
- **Prévenir le client** par courriel ou SMS à chaque étape franchie, en
  réutilisant l'envoi déjà en place pour les relances.
- **Un bouton « poser une question »** sur la page de suivi, qui écrit dans le
  suivi de la demande plutôt que dans la boîte de l'artisan.
