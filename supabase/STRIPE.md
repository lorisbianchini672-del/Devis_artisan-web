# Activer l'abonnement Stripe (artisans)

Le code est prêt : page `dashboard/abonnement.html`, fonctions `billing` et `stripe-webhook`,
table `dv_subscriptions`. Il reste à relier **votre** compte Stripe. Aucune clé n'est dans le code.

Commencez en **mode test** de Stripe (interrupteur « Test » en haut du tableau de bord Stripe),
puis refaites les étapes 1, 4 et 5 en mode réel le jour du lancement.

## 1. Créer les offres dans Stripe

Stripe → **Catalogue de produits** → **Ajouter un produit**, deux fois :

| Produit | Prix | Facturation |
|---------|------|-------------|
| Solo    | ex. 19 € HT | Récurrent, mensuel |
| Pro     | ex. 49 € HT | Récurrent, mensuel |

Le nom et la description du produit s'affichent tels quels sur la page Abonnement.
Notez l'identifiant de chaque **prix** (`price_…`).

## 2. Créer la table

Supabase → **SQL Editor** → coller et exécuter
`supabase/migrations/20261027190000_stripe_subscriptions.sql`.

## 3. Déployer les deux fonctions

Depuis le dossier du projet :

```
supabase functions deploy billing
supabase functions deploy stripe-webhook
```

## 4. Brancher le webhook

Stripe → **Développeurs → Webhooks → Ajouter un endpoint**

- URL : `https://eqqrvnmjnoudncfuwsxt.supabase.co/functions/v1/stripe-webhook`
- Événements : `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`

Notez le **secret de signature** (`whsec_…`).

## 5. Ajouter les secrets dans Supabase

Supabase → **Edge Functions → Secrets** :

| Nom | Valeur |
|-----|--------|
| `STRIPE_SECRET_KEY` | clé secrète Stripe (`sk_test_…` puis `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` de l'étape 4 |
| `STRIPE_PRICE_SOLO` | `price_…` de l'offre Solo |
| `STRIPE_PRICE_PRO` | `price_…` de l'offre Pro |
| `SITE_URL` | adresse du site, ex. `https://arthur-savin.github.io/Devis_artisan-web` |

Ne collez jamais la clé secrète dans le code ni dans un message.

## 6. Activer l'espace client Stripe

Stripe → **Paramètres → Facturation → Portail client** → activer
(résiliation, changement d'offre, mise à jour de la carte, factures).

## 7. Tester

Espace artisan → **Abonnement** → « Choisir Solo » → carte de test `4242 4242 4242 4242`,
date future, n'importe quel code. Au retour, la page affiche « Abonnement actif ».
