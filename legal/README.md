# Pages légales — ce qu'il reste à faire

Trois pages de brouillon : `mentions-legales.html`, `cgu.html`, `confidentialite.html`.
Elles sont liées depuis le pied de page de l'accueil et portent `noindex` pour ne pas
être indexées tant qu'elles ne sont pas finalisées.

**Ces textes n'ont pas été relus par un juriste.** Les CGU créent un contrat payant et
la politique de confidentialité engage votre responsabilité au titre du RGPD : faites-les
vérifier avant d'accueillir un vrai client.

## 1. Remplacer les champs en rouge

Chaque champ à compléter apparaît en rouge dans la page (`<span class="todo">`).
Pour les lister :

```
grep -c 'class="todo"' legal/*.html
```

Informations à rassembler :

- Dénomination, forme juridique, capital, siège, SIRET, RCS, numéro de TVA.
- Nom du directeur de la publication.
- Adresse électronique et téléphone de contact.
- Région d'hébergement du projet Supabase (tableau de bord Supabase → Settings → General).
- Durée de l'abonnement, prix hors taxes ou toutes taxes comprises, délai de suspension
  pour défaut de paiement, plafond de responsabilité, durées de conservation.
- Tribunal compétent.

Quand une page est validée, supprimer son encadré `<div class="draft">…</div>` et retirer
la ligne `<meta name="robots" content="noindex" />`.

## 2. Points à trancher avant la mise en ligne

- **Immatriculation.** Un service payant suppose une structure immatriculée. Sans elle, le
  site peut rester en ligne à titre de présentation, sans inscription ni paiement.
- **Professionnels uniquement ou particuliers aussi.** Si des particuliers peuvent souscrire,
  deviennent obligatoires : le droit de rétractation de quatorze jours et la désignation d'un
  médiateur de la consommation.
- **Contrat de sous-traitance.** Pour les données des clients des artisans, l'artisan est
  responsable du traitement et vous êtes sous-traitant. L'article 28 du RGPD exige un contrat
  écrit : ajoutez une annexe aux CGU ou un document séparé que l'artisan accepte à
  l'inscription.
- **Registre des traitements.** Obligatoire. Un tableau suffit : traitement, finalité, base
  légale, données, destinataires, durée. Les tableaux de la politique de confidentialité en
  donnent la matière.
- **Assurance responsabilité civile professionnelle.** À souscrire avant les premiers clients
  payants.

## 3. Correction technique recommandée

Les polices de caractères sont chargées depuis `fonts.googleapis.com`, ce qui transmet
l'adresse IP de chaque visiteur à Google. Héberger les deux fichiers de police avec le site
supprime ce transfert, allège la politique de confidentialité et accélère l'affichage.
C'est une demi-heure de travail.
