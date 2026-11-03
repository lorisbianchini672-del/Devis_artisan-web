# Plusieurs comptes par entreprise

Jusqu'ici, une entreprise valait un compte. Un patron qui voulait que son salarié
consulte les chantiers devait lui donner son mot de passe — ce qui ouvrait aussi
ses prix et ses paiements.

Page : `dashboard/equipe.html`. Migration :
`20261103120000_roles_equipe.sql`, à appliquer **après**
`20261103100000_cloisonnement_par_artisan.sql`, dont elle reprend et étend les règles.

## Les trois rôles

| | Patron | Salarié | Comptable |
|---|---|---|---|
| Demandes et chantiers | modifie | modifie | consulte |
| Photos et notes de chantier | oui | oui | consulte |
| Supprimer une demande | oui | non | non |
| Grille de prix, devis importés | oui | **non** | **non** |
| Paiements, factures, relances | oui | **non** | oui |
| Fiche de l'entreprise | modifie | consulte | consulte |
| Équipe | gère | consulte | consulte |

Ces droits sont tenus par la base de données, pas par l'interface. Masquer un
bouton n'empêche personne d'appeler l'API directement ; une règle d'accès, si.
Chaque ligne du tableau correspond à une règle vérifiée par un test.

## Ajouter quelqu'un

Le patron saisit une adresse électronique et un rôle. La personne n'a pas besoin
d'un compte à ce moment-là : quand elle s'inscrira avec cette adresse, un
déclencheur rattachera sa ligne de membre à son compte et son accès s'ouvrira.

Ce choix évite de dépendre d'un envoi de courrier électronique : pas de serveur
d'envoi à configurer, pas d'invitation qui se perd dans les indésirables. Le patron
dit simplement : « inscris-toi avec cette adresse ».

## Garde-fous

- **Le dernier patron ne peut être ni rétrogradé ni retiré.** Sans lui, plus
  personne ne pourrait gérer l'équipe ni les prix. L'interface bloque, et il faut
  nommer un autre patron d'abord.
- **Un salarié ne peut pas se promouvoir.** Écrire dans la table des membres est
  réservé au patron par une règle d'accès, pas par l'interface. Vérifié par un test.
- **Le propriétaire historique reste patron** même sans ligne de membre, pour qu'une
  migration ratée ne verrouille personne hors de son propre atelier.

## Limite connue : le prix sur la fiche d'une demande

Les règles d'accès travaillent par ligne, jamais par colonne. Un salarié qui voit
une demande voit donc toutes ses colonnes, dont `prix_reel_ht`, le prix réellement
facturé quand il a été renseigné.

Les tables de prix (`dv_service_prices`, `dv_quote_imports`) lui sont bien fermées :
il ne voit ni la grille tarifaire, ni les devis importés, ni les marges. Mais le
montant d'un chantier précis reste lisible.

Masquer cette colonne demanderait de faire lire l'application à travers une vue
plutôt que la table, ce qui touche à `shared/store.js` et sort du cadre de cette
migration. À faire si le cloisonnement doit être complet.

## Vérification

`supabase/tests/test-roles.sql`, joué sur PostgreSQL 16 avec les dix-huit migrations :

- le patron voit demandes, prix, factures et photos ;
- le salarié voit les chantiers, zéro prix, zéro facture, zéro réglage de paiement ;
- le comptable voit les factures, pas les prix ;
- le salarié ne peut pas supprimer une demande ;
- un artisan d'une autre entreprise ne voit que la sienne ;
- un salarié ne peut pas se promouvoir patron ;
- le rattachement à l'inscription fonctionne, casse de l'adresse indifférente.
