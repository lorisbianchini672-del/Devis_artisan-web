-- Relances automatiques : l'artisan choisit l'envoi automatique chaque matin.
-- Idempotent.

alter table dv_payment_settings
  add column if not exists auto_send boolean not null default false;

-- Les réglages lus par la tâche du matin (clé de service) :
-- methods existe depuis 20261027200000_payment_methods.sql ; on la crée au besoin.
alter table dv_payment_settings
  add column if not exists methods jsonb not null default '{}'::jsonb;

alter table dv_payment_invoices
  add column if not exists paid_method text not null default '';
