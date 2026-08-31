-- A executer dans Supabase -> SQL Editor.
-- Ajoute la config IA par compte (fournisseur + cles API), synchronisee entre appareils.

create table if not exists user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    ai_provider text,
    ai_keys jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user_settings_owner_all" on user_settings
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
