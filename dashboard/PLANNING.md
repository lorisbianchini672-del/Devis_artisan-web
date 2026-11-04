# Planning

Rendez-vous clients, chantiers et interventions de l'équipe, au même endroit que
les demandes. Page : `dashboard/planning.html`.

**Cette branche se place sur `roles-equipe`**, et doit être fusionnée après elle :
c'est la table des membres qui permet de dire qui s'occupe de quoi, et ce sont
ses fonctions d'appartenance que les règles d'accès réutilisent.

## Ce que ça fait

Une semaine à la fois, du lundi au dimanche. Chaque événement porte :

- un **type** — rendez-vous client, chantier, ou autre — qui lui donne sa couleur ;
- un **client**, repris de la liste des demandes. Le choisir remplit l'adresse ;
- **qui s'en occupe**, parmi les membres de l'équipe ;
- un **état** — prévu, confirmé, fait, annulé.

Un chantier qui court sur trois jours apparaît sur les trois, avec la mention
« début », « en cours », « suite ». C'est ce qu'un artisan regarde en premier :
non pas quand le chantier commence, mais s'il travaille dessus aujourd'hui.

## Les droits

| | Patron | Salarié | Comptable |
|---|---|---|---|
| Voir le planning | oui | oui | oui |
| Ajouter, modifier, supprimer | oui | oui | **non** |

Le salarié planifie : c'est lui qui décale un rendez-vous depuis le chantier. Le
comptable consulte, pour savoir quand une facture pourra partir.

Ces droits sont tenus par la base, comme ceux des rôles.

## Sur téléphone

Sept colonnes deviennent illisibles sous 1000 px : la semaine se lit alors en
liste, un jour après l'autre, et **les jours vides disparaissent**. C'est de toute
façon l'usage sur un chantier — on regarde aujourd'hui et demain, pas la grille.

## Mise en service

SQL Editor → `supabase/migrations/20261104100000_planning.sql`.
Aucune fonction serveur, aucun nouveau secret.

Vérification : `supabase/tests/test-planning.sql` sur une base de test, six « OK ».

## Sans compte cloud

Le planning reste sur l'appareil et fonctionne entièrement, sauf la liste de
l'équipe, qui vient de la base.

## Ce qui reste à faire

- **Lier le planning aux devis et aux factures** : une fois `devis-dicte`
  fusionnée, un chantier planifié pourrait reprendre le devis accepté.
- **Vue mois**, pour la charge à venir plutôt que la semaine en cours.
- **Rappels** la veille d'un rendez-vous, en réutilisant l'envoi d'e-mails
  déjà en place pour les relances.
- **Export iCal**, pour que l'artisan retrouve ses rendez-vous dans son téléphone.
- Après fusion avec la refonte esthétique : ajouter `refonte.css` et `mobile.css`
  à `planning.html`, comme pour `abonnement.html`.
