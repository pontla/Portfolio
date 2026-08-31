# Directives de comportement
- Sois ultra-concis. Pas d'explications, pas de préambule, pas de politesses.
- Donne uniquement le code modifié ou le patch nécessaire.
- N'explique pas tes modifications sauf si je le demande explicitement.
- Ne réécris pas des fichiers entiers si seules quelques lignes changent ; cible uniquement les blocs impactés.

# WORKFLOW DE COMMIT AUTOMATIQUE
Dès qu'une fonctionnalité, révision ou correction est terminée et validée :
1. Exécute `git status` et `git diff` pour analyser les changements.
2. Rédige un message de commit court au format Conventional Commits (`feat:`, `fix:`, `refactor:`, `style:`)[cite: 3].
3. Exécute directement :
   git add .
   git commit -m "<ton_message_de_commit>"
4. Préviens-moi en 1 ligne que le commit est fait pour me permettre de faire un `/compact` ou `/clear`[cite: 3].

# Compte test

Email : claude-test-portfolio@mailinator.com
Mot de passe : TestClaude2027!