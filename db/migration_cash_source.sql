-- A executer dans Supabase -> SQL Editor.
-- Origine du financement d'un achat : 'CASH' (preleve sur le cash du
-- portefeuille) ou 'DIRECT' (achete hors cash, sans depot prealable).
-- NULL = lignes anterieures a la colonne, traitees comme 'CASH' puis ecretees
-- au cash reellement disponible par le moteur.
alter table trades add column if not exists cash_source text;
alter table trades drop constraint if exists trades_cash_source_check;
alter table trades add constraint trades_cash_source_check
    check (cash_source is null or cash_source in ('CASH', 'DIRECT'));

-- Rattrapage : fx_rate etait documentee dans schema.sql mais absente de la base
-- de production, ce qui faisait echouer toute ecriture de transaction.
alter table trades add column if not exists fx_rate numeric;
