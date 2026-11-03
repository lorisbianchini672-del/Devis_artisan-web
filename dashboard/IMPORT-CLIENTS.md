# Importer ses clients depuis un autre logiciel

Page : `dashboard/import-clients.html`, accessible depuis le bas de la barre
latérale. Aucune migration ni fonction serveur : les clients importés deviennent
des fiches ordinaires dans `dv_leads`.

## Ce que le lecteur gère

Les exports de CRM et de tableurs sont rarement propres. Ce qui est pris en charge :

- **Séparateurs** : point-virgule, virgule, tabulation, barre verticale. Détectés
  sur les douze premières lignes.
- **Encodages** : UTF-8 et Windows-1252. C'est le point qui casse le plus souvent
  un import français : Excel exporte en Windows-1252, et lu en UTF-8 « Benoît »
  devient illisible. Le fichier est décodé en UTF-8 strict, et bascule sur
  Windows-1252 au premier octet invalide. La marque d'ordre des octets est retirée.
- **Guillemets** : champs contenant le séparateur, des retours à la ligne, ou des
  guillemets doublés.
- **En-têtes** : français et anglais, accents et casse indifférents
  (`Téléphone`, `tel portable`, `Phone`, `Mobile`…).
- **Noms** : `Jean Dupont`, `M. Jean Dupont`, et `Dupont, Jean` (nom en premier,
  fréquent dans les exports).
- **Téléphones** : `+33 6…`, `0033…`, `06.12.34.56.78`, neuf chiffres sans le zéro
  initial — tout est ramené à `06 12 34 56 78`. Ce qui n'est pas un numéro français
  est gardé tel quel plutôt que jeté.
- **Codes postaux** collés à la ville (`69100 Villeurbanne`).

Si la reconnaissance se trompe, chaque colonne se corrige à la main, avec un
exemple tiré de la première ligne pour vérifier.

## Ce qui est écarté, et pourquoi

Une ligne sans nom, ou sans téléphone **ni** adresse électronique, est écartée :
une fiche client sans moyen de contact n'a pas d'usage. Les lignes écartées sont
listées avec leur numéro et le motif, pour être corrigées dans le fichier d'origine.

## Doublons

Deux fiches ayant le même téléphone (neuf derniers chiffres) ou la même adresse
électronique sont considérées comme la même personne. Sont marqués les doublons
avec la base existante et les répétitions internes au fichier. Ils sont ignorés
par défaut, et la case se décoche.

## Statut à l'import

L'artisan choisit : **Gagné** pour des clients déjà servis (choix par défaut),
**Nouveau** pour des prospects à rappeler, **Archivé** pour sortir du tableau de bord.
Sans ce choix, un import de trois cents anciens clients remplirait la colonne des
demandes à traiter.

## Limites connues

- L'import écrit dans la liste de clients : il demande le compte cloud. Sans lui,
  l'aperçu fonctionne quand même, ce qui permet de vérifier son fichier.
- Les colonnes `telephone`, `email` et `code_postal` sont obligatoires en base. Quand
  le fichier ne les fournit pas, une chaîne vide est enregistrée plutôt que de
  refuser la fiche.
- Les fiches sont enregistrées avec `consent_rgpd` à faux : ces personnes n'ont pas
  rempli le formulaire du site. Avant toute relance ou prospection, vérifier la base
  légale du traitement.
- Pas d'import de l'historique des chantiers ni des factures : seulement les fiches
  clients.
