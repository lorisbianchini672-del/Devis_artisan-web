-- Moyens de paiement acceptés par l'artisan (sans compte Stripe)
-- et moyen réellement utilisé quand une facture est payée.
-- Idempotent.

alter table dv_payment_settings
  add column if not exists methods jsonb not null default '{}'::jsonb;

alter table dv_payment_invoices
  add column if not exists paid_method text not null default '';
