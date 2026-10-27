# Activer les relances automatiques (e-mail + IA)

Le code est prêt : fonction `payment-reminders`, réglage « Envoi automatique » et
bouton « Rédiger avec l’IA » dans l’onglet Paiements. Aucune clé n’est dans le code.

## 1. Mettre à jour la base

Supabase → **SQL Editor** → exécuter, dans l’ordre :

- `supabase/migrations/20261027200000_payment_methods.sql`
- `supabase/migrations/20261027210000_auto_reminders.sql`

## 2. Créer le compte d’envoi d’e-mails (Resend)

1. Créer un compte sur resend.com (gratuit jusqu’à 3 000 e-mails par mois).
2. **Domains → Add domain** : ajouter le domaine du site et recopier les enregistrements DNS
   demandés chez l’hébergeur du domaine. Sans domaine vérifié, les e-mails partent en indésirables.
3. **API Keys → Create** : copier la clé (`re_…`).

Les e-mails partent au nom de l’artisan (« Atelier Lyon <relances@votre-domaine.fr> »)
et les réponses des clients arrivent directement dans la boîte de l’artisan.

## 3. Ajouter les secrets dans Supabase

Supabase → **Edge Functions → Secrets** :

| Nom | Valeur |
|-----|--------|
| `RESEND_API_KEY` | clé `re_…` de l’étape 2 |
| `REMINDER_FROM` | ex. `Devis artisan <relances@votre-domaine.fr>` (domaine vérifié) |
| `CRON_SECRET` | un mot de passe long, inventé (protège la tâche du matin) |
| `ANTHROPIC_API_KEY` | déjà présent (sert aussi à l’analyse des demandes) |

Ne collez jamais une clé dans le code ni dans un message.

## 4. Déployer la fonction

```
supabase functions deploy payment-reminders
```

## 5. Programmer l’envoi chaque matin

Supabase → **Integrations → Cron → Create job** :

- Nom : `relances-du-matin`
- Planification : `0 8 * * *` (8 h UTC, soit 9 h ou 10 h à Paris)
- Type : **Supabase Edge Function** → `payment-reminders`, méthode **POST**
- En-tête : `x-cron-secret` = la valeur de `CRON_SECRET`
- Corps : `{"action":"run"}`

## 6. Tester

1. Onglet Paiements → « Moyens de paiement acceptés » : cocher au moins un moyen.
2. Créer une facture avec **votre propre e-mail** comme client et une échéance passée.
3. Ouvrir « Relancer » → **Rédiger avec l’IA** : le texte s’affiche.
4. Activer « Envoi automatique », puis **Envoyer les relances du jour** : l’e-mail arrive.

## Règles de sécurité intégrées

- Une seule relance par facture et par jour, même si la tâche repasse.
- Factures payées et clients sans e-mail : jamais relancés (signalés dans le compte rendu).
- Le texte de l’IA doit citer le numéro de facture, le montant exact et les moyens de paiement ;
  sinon le modèle standard est envoyé à la place.
- Chaque envoi est noté dans le suivi de la facture et l’historique du client.
