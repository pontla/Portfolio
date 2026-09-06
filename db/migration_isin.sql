-- A executer dans Supabase -> SQL Editor.
-- ISIN du titre, saisi ou resolu a la recherche. Identifiant stable : le
-- symbole Yahoo d'un OPCVM (0P0001OOS9.F) est un code Morningstar opaque,
-- illisible et susceptible de changer, alors que l'ISIN figure sur les relevés
-- de PEA et d'assurance-vie. Sert a retrouver un fonds et a rapprocher un
-- import de releve des lignes existantes.
-- NULL = ligne saisie par ticker, ou anterieure a la colonne.
alter table trades add column if not exists isin text;
create index if not exists trades_isin_idx on trades(isin) where isin is not null;
