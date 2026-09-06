-- A executer dans Supabase -> SQL Editor.
-- Devise native du titre, figee a la saisie. Jusqu'ici elle etait deduite du
-- suffixe du symbole (Utils.getCurrency) : tout symbole sans suffixe connu
-- tombait en USD sans avertissement, ce qui valorisait les OPCVM europeens
-- (0P0001OOS9.F, LU...SG) au mauvais taux. La valeur fait desormais autorite,
-- alimentee par le champ `currency` de l'API de cotation.
-- NULL = lignes anterieures a la colonne : le moteur retombe sur l'heuristique
-- de suffixe puis se corrige a la volee des que l'API repond.
alter table trades add column if not exists currency text;
