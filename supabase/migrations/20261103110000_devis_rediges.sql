-- Devis rédigés dans l'outil, à partir d'une dictée de l'artisan.
--
-- L'artisan dicte ce qu'il a prévu de faire ; l'IA le met en lignes de devis en
-- s'appuyant sur ses propres prix (dv_service_prices et grille tarifaire).
-- Le devis reste modifiable ligne par ligne avant d'être envoyé.

create table if not exists dv_quotes (
  id bigint generated always as identity primary key,
  public_id text not null unique
    default ('dq_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  artisan_id bigint not null references dv_artisans(id) on delete cascade,
  lead_id bigint references dv_leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  number text,
  title text,
  client_name text,
  client_email text,
  client_address text,

  status text not null default 'brouillon'
    check (status in ('brouillon', 'envoye', 'accepte', 'refuse')),
  vat_rate numeric(5, 2) not null default 20
    check (vat_rate >= 0 and vat_rate <= 100),
  validity_days integer not null default 30
    check (validity_days between 0 and 365),
  notes text,

  -- Dictée d'origine, gardée pour que l'artisan retrouve ses mots.
  transcript text,
  drafted_by_ai boolean not null default false
);

create index if not exists idx_dv_quotes_artisan on dv_quotes (artisan_id, created_at desc);
create index if not exists idx_dv_quotes_lead on dv_quotes (lead_id);

create table if not exists dv_quote_lines (
  id bigint generated always as identity primary key,
  quote_id bigint not null references dv_quotes(id) on delete cascade,
  sort_order integer not null default 0,
  label text not null,
  detail text,
  quantity numeric(12, 3) not null default 1,
  unit text not null default 'u',
  unit_price_ht numeric(12, 2) not null default 0,
  -- D'où vient le prix : un prix déjà pratiqué, la grille, ou rien (à compléter).
  price_origin text not null default 'a_completer'
    check (price_origin in ('prix_pratique', 'grille', 'a_completer', 'saisi'))
);

create index if not exists idx_dv_quote_lines_quote on dv_quote_lines (quote_id, sort_order);

-- ---------------------------------------------------------------------------
-- Numérotation : DEV-2026-0001, repartant de 1 chaque année, par artisan.
-- ---------------------------------------------------------------------------
create or replace function dv_next_quote_number(p_artisan_id bigint)
returns text
language sql
stable
as $$
  select 'DEV-' || to_char(now(), 'YYYY') || '-' ||
         lpad((
           coalesce(max(substring(number from '\d+$')::int), 0) + 1
         )::text, 4, '0')
  from dv_quotes
  where artisan_id = p_artisan_id
    and number like 'DEV-' || to_char(now(), 'YYYY') || '-%';
$$;

-- ---------------------------------------------------------------------------
-- Accès : chaque artisan ne voit que ses devis.
-- ---------------------------------------------------------------------------
alter table dv_quotes enable row level security;
alter table dv_quote_lines enable row level security;

drop policy if exists quotes_all_own on dv_quotes;
create policy quotes_all_own on dv_quotes
  for all to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()))
  with check (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

drop policy if exists quote_lines_all_own on dv_quote_lines;
create policy quote_lines_all_own on dv_quote_lines
  for all to authenticated
  using (exists (
    select 1 from dv_quotes q
    join dv_artisans a on a.id = q.artisan_id
    where q.id = quote_id and a.auth_user_id = auth.uid()))
  with check (exists (
    select 1 from dv_quotes q
    join dv_artisans a on a.id = q.artisan_id
    where q.id = quote_id and a.auth_user_id = auth.uid()));

grant select, insert, update, delete on dv_quotes to authenticated;
grant select, insert, update, delete on dv_quote_lines to authenticated;
grant execute on function dv_next_quote_number(bigint) to authenticated;

create or replace function dv_quotes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_dv_quotes_touch on dv_quotes;
create trigger trg_dv_quotes_touch before update on dv_quotes
  for each row execute function dv_quotes_touch();
