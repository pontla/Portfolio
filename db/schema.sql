-- A executer dans Supabase -> SQL Editor.

create table if not exists portfolios (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    color text not null default '#3b82f6',
    created_at timestamptz not null default now()
);

create table if not exists trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    type text not null,
    symbol text not null,
    qty numeric not null default 0,
    price numeric not null default 0,
    amount numeric not null default 0,
    fees numeric not null default 0,
    -- Taux de change fige au moment de la saisie : USD pour 1 unite de la devise
    -- native du titre (EUR/GBP/CAD...). NULL = lignes anterieures -> repli sur le
    -- taux spot courant. Evite de revaloriser l'historique au taux d'aujourd'hui.
    fx_rate numeric,
    -- Financement d'un achat : 'CASH' (preleve sur le cash du portefeuille) ou
    -- 'DIRECT' (achat hors cash, sans depot prealable). NULL sur les autres
    -- types et sur les lignes anterieures a la colonne.
    cash_source text check (cash_source is null or cash_source in ('CASH', 'DIRECT')),
    date date not null,
    created_at timestamptz not null default now()
);

-- Config IA par compte, pour retrouver ses reglages d'un appareil a l'autre.
-- ai_provider : fournisseur choisi. ai_providers_configured : fournisseurs pour
-- lesquels une cle API est stockee (chiffree) cote worker. Les cles ne sont PAS
-- en base (KV du worker, chiffrees AES-GCM). Une ligne par utilisateur.
create table if not exists user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    ai_provider text,
    ai_providers_configured text[] not null default '{}',
    updated_at timestamptz not null default now()
);

create index if not exists trades_user_id_idx on trades(user_id);
create index if not exists trades_portfolio_id_idx on trades(portfolio_id);

-- Migration pour une table trades deja existante :
--   alter table trades add column if not exists fees numeric not null default 0;
--   alter table trades add column if not exists fx_rate numeric;
--   alter table trades add column if not exists cash_source text;

alter table portfolios enable row level security;
alter table trades enable row level security;
alter table user_settings enable row level security;

create policy "portfolios_owner_all" on portfolios
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "trades_owner_all" on trades
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "user_settings_owner_all" on user_settings
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
