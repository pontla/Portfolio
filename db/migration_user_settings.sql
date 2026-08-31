-- A executer dans Supabase -> SQL Editor.
-- Config IA par compte, synchronisee entre appareils.
--  - ai_provider : fournisseur choisi (non secret).
--  - ai_providers_configured : fournisseurs pour lesquels une cle API est stockee
--    (chiffree) cote worker ; marqueur non secret, ecrit par le worker.
-- Les cles API elles-memes ne sont PAS en base : elles vivent chiffrees (AES-GCM)
-- dans le KV du worker proxy.

create table if not exists user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    ai_provider text,
    ai_providers_configured text[] not null default '{}',
    updated_at timestamptz not null default now()
);

-- Si la table existait deja avec l'ancienne colonne ai_keys :
alter table user_settings add column if not exists ai_providers_configured text[] not null default '{}';
alter table user_settings drop column if exists ai_keys;

alter table user_settings enable row level security;

drop policy if exists "user_settings_owner_all" on user_settings;
create policy "user_settings_owner_all" on user_settings
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
