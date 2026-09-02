# Directives de comportement
- Sois ultra-concis. Pas d'explications, pas de préambule, pas de politesses.
- Donne uniquement le code modifié ou le patch nécessaire.
- N'explique pas tes modifications sauf si je le demande explicitement.
- Ne réécris pas des fichiers entiers si seules quelques lignes changent ; cible uniquement les blocs impactés.

# WORKFLOW GIT, TESTS & COMMIT AUTOMATIQUE

1. **Inauguration de tâche (Création de branche) :**
   - Avant de démarrer toute nouvelle fonctionnalité ou correction, vérifie la branche courante.
   - Si tu es sur `main`, crée et bascule directement sur une nouvelle branche explicite :
     `git checkout main && git pull && git checkout -b feature/<nom-court-de-la-feature>`

2. **Validation par les tests (Obligatoire) :**
   - Une fois la modification terminée, lance la suite de tests unitaires : `npm test`.
   - Si la modification impacte l'UI, les composants ou un parcours utilisateur, lance également : `npm run test:e2e`[cite: 3].
   - **Interdiction absolue de commiter** tant que l'ensemble des tests ne passe pas à 100 %[cite: 3].

3. **Commit automatique sur la branche :**
   - Une fois les tests au vert, analyse le travail avec `git status` et `git diff`[cite: 3].
   - Rédige un message au format Conventional Commits (`feat:`, `fix:`, `refactor:`, `style:`)[cite: 3].
   - Exécute l'enregistrement :
     `git add .`
     `git commit -m "<ton_message_de_commit>"`[cite: 3]

4. **Fin de tâche :**
   - N'essaie pas de fusionner (*merge*) sur `main` toi-même[cite: 3].
   - Indique-moi simplement en 1 ligne : *"Commit effectué sur la branche <nom-de-branche>. Tu peux lancer `/compact` ou `/clear`."*

# DIRECTIVES DESIGN SYSTEM & UI
1. **Style visuel :** Respecter strictement la charte near-black / glassmorphism (`backdrop-filter: blur()`).
2. **Layout :** Privilégier les structures "Bento Grid" (cartes asymétriques à coins arrondis et bordures à faible opacité)[cite: 6].
3. **Typographie :** Utiliser `Archivo` pour les titres/UI et `Roboto Mono` pour toutes les données numériques tabulaires.
4. **Données manquantes :** Remplacer systématiquement les mentions "Donnée indisponible" ou les cartes vides par un tiret discret (`—`)[cite: 6].
5. **Composants :** Toujours créer des éléments atomiques réutilisables dans `src/components/`.

# Compte test

Email : claude-test-portfolio@mailinator.com
Mot de passe : TestClaude2027!