# Devis dicté

L'artisan décrit son chantier à voix haute ; l'IA en fait des lignes de devis
chiffrées **avec ses propres prix**. Page : `dashboard/devis.html`.

## Le principe

1. L'artisan appuie sur « Dicter » et parle. La transcription se fait dans son
   navigateur (Chrome, Edge, Safari). Il peut aussi écrire : la suite est identique.
2. « Rédiger le devis » envoie la dictée à la fonction `draft-quote`, avec les prix
   déjà pratiqués (`dv_service_prices`) et la grille tarifaire de l'artisan.
3. L'IA renvoie des lignes : prestation, quantité, unité, prix unitaire.
4. L'artisan relit, corrige, complète, enregistre, imprime ou enregistre en PDF.

## Aucun prix n'est inventé

C'est la règle du site, et elle est appliquée deux fois.

Dans l'invite : l'IA doit rattacher chaque ligne soit à un prix déjà pratiqué,
soit à une ligne de la grille, soit la marquer « à chiffrer » avec un montant nul.

Dans le code, après la réponse : si l'IA affirme reprendre un prix connu mais que
le montant ne figure pas parmi ceux fournis, la ligne est ramenée à « à chiffrer »
et le prix remis à zéro. Un modèle qui invente un prix plausible ne passe donc pas.

Seule exception : un prix que l'artisan prononce lui-même dans sa dictée est repris,
et signalé comme dicté.

Les lignes à chiffrer sont surlignées, et un message indique combien il en reste.

## Mise en service

1. Supabase → SQL Editor → exécuter
   `migrations/20261103110000_devis_rediges.sql`.
2. Déployer la fonction :

   ```
   supabase functions deploy draft-quote
   ```

3. Aucun nouveau secret : `ANTHROPIC_API_KEY` est déjà en place.

## Sans compte cloud

La page reste utilisable : les devis sont créés à la main et gardés sur l'appareil,
avec numérotation, totaux et impression. Seule la rédaction par l'IA demande le
compte cloud, puisqu'elle passe par une fonction serveur.

## Le devis imprimé

L'impression ne sort que le devis : en-tête, coordonnées des deux parties, lignes,
totaux HT / TVA / TTC, remarques, mentions de base et case « bon pour accord ».

Les mentions légales obligatoires d'un devis du bâtiment (SIRET, assurance de
responsabilité civile professionnelle, garantie décennale avec le nom de l'assureur
et la zone couverte) sont rappelées en bas de page comme restant à compléter par
l'artisan : elles dépendent de son entreprise et ne peuvent pas être devinées.

## Ce qui reste à faire

- Envoyer le devis par courrier électronique depuis l'outil (la fonction
  `payment-reminders` montre déjà comment passer par Resend).
- Signature en ligne du client, et bascule automatique en facture une fois accepté.
- Rattacher le devis à une demande reçue par le widget (`lead_id` existe déjà en base,
  il n'est pas encore relié dans l'interface).
