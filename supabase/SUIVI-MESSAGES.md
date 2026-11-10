# Messages automatiques au client

Prolonge le suivi client : au lieu d'attendre que le client ouvre sa page, on
lui écrit aux moments qui comptent. Et pendant le chantier, les photos
d'avancement lui donnent une raison d'y revenir.

À appliquer après `20261110100000_suivi_client.sql`.

## Les huit messages

| Quand | Ce qu'on écrit |
|---|---|
| Une date de devis est promise | « Votre devis arrive » |
| Le devis passe à « envoyé » | « Votre devis est prêt » |
| J+2 après l'envoi | « Vous avez bien reçu mon devis ? » |
| J+7 | « Une question sur le devis ? » |
| J+15 | « Mon devis arrive à échéance » |
| La veille du chantier | « On démarre demain » |
| De nouvelles photos d'avancement | « Des nouvelles de votre chantier » |
| Les photos « après » arrivent | « Votre chantier est terminé » |

Chaque message porte le lien de suivi.

## Les relances n'escaladent pas

C'est la différence avec les relances d'impayés, et elle est volontaire. Un
client qui n'a pas répondu à un devis **n'est pas un mauvais payeur** : il
hésite, il compare, ou il a oublié. Le ton reste le même aux trois étapes, et la
troisième propose même d'en refaire un plus tard, aux prix du moment.

Les textes sont écrits à la main, pas par l'IA. Ce sont des messages courts et
factuels, où une tournure inventée ferait plus de mal que de bien. L'IA reste
pour ce qui demande du jugement, comme chiffrer un devis.

## Les garde-fous

- **Désactivé par défaut.** Écrire à des clients au nom d'un artisan ne se
  déclenche jamais tout seul : il coche le réglage dans la fiche client.
- **Un message par client et par passage**, au maximum.
- **Jamais deux fois le même.** Une contrainte d'unicité en base, pas seulement
  du code : même si la tâche repasse, rien ne part en double. Seul
  « avancement » peut revenir, et pas deux fois le même jour.
- **Une affaire perdue ou archivée ne reçoit plus rien.** Un devis accepté non
  plus : on ne relance pas quelqu'un qui a déjà dit oui.
- **Pas d'adresse, pas de message** — signalé dans le compte rendu.
- **Un artisan qui active le réglage après coup ne déclenche pas la série
  entière** : on part de la relance la plus avancée qui est due, pas de la
  première.

## Mise en service

1. SQL Editor → `supabase/migrations/20261110110000_suivi_messages.sql`
2. `supabase functions deploy suivi-notify`
3. Secrets : `RESEND_API_KEY`, `REMINDER_FROM`, `CRON_SECRET` (déjà en place si
   les relances d'impayés tournent) et **`SITE_URL`**, sans quoi le lien de
   suivi serait incomplet — la fonction refuse de démarrer sans elle.
4. Cron quotidien : `suivi-notify`, POST, en-tête `x-cron-secret`, corps
   `{"action":"run"}`. Une fois par jour suffit.

Avant d'activer, le bouton **« Voir ce qui partirait aujourd'hui »** dans la
fiche client liste les envois sans rien expédier.

Vérification : `supabase/tests/test-suivi-messages.sql`, sept « OK ».

## Non vérifié

Aucun message n'a été envoyé pour de vrai : il n'y a pas eu de compte Resend.
La logique de décision est testée (19 cas), l'envoi ne l'est pas. Faites le
premier essai avec **votre propre adresse** comme client.
