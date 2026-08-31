-- A executer dans Supabase -> SQL Editor.
alter table trades add column if not exists fees numeric not null default 0;
