# L'espace artisan sur téléphone

`dashboard/mobile.css`, chargé après `dashboard.css` sur chaque page de l'espace
artisan. Fichier séparé pour ne pas gêner les autres chantiers en cours sur la
feuille principale.

## Ce qui n'allait pas

Mesuré sur iPhone SE (375 px), le format le plus étroit encore courant :

| | Avant | Après |
|---|---|---|
| Débordement horizontal | 5 à 7 px sur quatre pages | 0 |
| Hauteur de la barre du haut | 190 px | 111 px |
| Premier contenu visible à | 267 px | 188 px |
| Cibles tactiles sous 40 px | 10 sur le tableau de bord | 0 |

## Le débordement

Dans une grille, un élément refuse par défaut de rétrécir sous la largeur de son
contenu : `min-width: auto`. La barre latérale, passée en ligne sur téléphone,
imposait une colonne de 380 px dans un écran de 375. Toute la page se décalait, et
un glissement horizontal parasite apparaissait à chaque défilement.

Corrigé par `min-width: 0` sur la chaîne de mise en page, et en laissant la barre
passer à la ligne.

## Les cibles tactiles

Sous 44 px, une cible se rate souvent au pouce — et un artisan consulte son
téléphone debout, parfois avec des gants. Les onglets, boutons, listes et champs
font désormais 44 px de haut au minimum, sur les appareils tactiles uniquement
(`@media (hover: none) and (pointer: coarse)`) : rien ne change à la souris.

Pour les cases à cocher, c'est le libellé qui sert de cible, pas la case. Un
pseudo-élément posé sur un `input` n'est pas rendu par tous les navigateurs ;
agrandir le libellé, si.

## Le zoom de Safari

iOS agrandit la page dès qu'un champ de moins de 16 px reçoit le curseur, et
l'artisan doit ensuite faire glisser son écran pour retrouver le formulaire.
Les champs passent à 16 px exactement sur petit écran, ce qui l'en empêche.

## L'en-tête

La barre du haut tient sur deux rangées : l'atelier et le lien du widget côte à
côte, puis les onglets, qui défilent latéralement s'ils deviennent nombreux. Une
grille nommée place chacun sans toucher au HTML, ce qui laisse les pages libres
d'évoluer de leur côté.

## Les compteurs

Empilés, trois chiffres occupaient 300 px avant la première demande. En rangée,
ils tiennent sur 90 px : ce sont des nombres courts, pas des phrases. La rangée
passe à deux par ligne si l'écran est vraiment étroit.

## Vérifié

iPhone SE (375 px) et iPhone 14 (390 px), sur le tableau de bord, les paiements,
« Former l'IA » et la fiche client : aucun débordement, aucune cible sous 44 px,
et le grand écran est inchangé — la barre latérale y reste verticale.

## Reste à faire

- `fiche-client.html` a ses propres styles, écrits à part. Seules les règles
  générales de `mobile.css` s'y appliquent ; sa mise en page n'a pas été reprise.
- Pas de mode hors connexion : le téléphone d'un artisan perd souvent le réseau
  en sous-sol ou en zone rurale. C'est un chantier à part entière.
