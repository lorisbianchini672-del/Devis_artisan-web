-- Abonnement des artisans via Stripe.
-- Une ligne par artisan, écrite uniquement par les fonctions serveur
-- (billing et stripe-webhook, clé de service). L'artisan peut seulement la lire.
-- Idempotent.

create table if not exists dv_subscriptions (
  artisan_id bigint primary key references dv_artisans(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default '',
  status text not null default 'none',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_customer
  on dv_subscriptions (stripe_customer_id);

alter table dv_subscriptions enable row level security;

drop policy if exists subscriptions_read_own on dv_subscriptions;
create policy subscriptions_read_own on dv_subscriptions
  for select to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

-- Aucune politique d'écriture : seules les fonctions serveur (service_role) écrivent.
