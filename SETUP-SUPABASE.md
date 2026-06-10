# Brancher B.Conseil sur Supabase — Mise en route

Le CRM est désormais connecté à Supabase (clients, comptabilité, tâches, profils, auth).
Suis ces 4 étapes **une seule fois**.

## 1. Créer le schéma
Supabase → **SQL Editor** → *New query* → colle tout le contenu de **`schema.sql`** → **Run**.
Cela crée les tables (`clients`, `documents`, `tasks`, `profiles`), les policies RLS,
le trigger de création de profil, le realtime, et insère les 12 clients + 10 tâches de démo.

## 2. Activer l'inscription immédiate
Supabase → **Authentication → Providers → Email** :
- **Désactive « Confirm email »** (sinon l'inscription attend un email de confirmation
  avant de pouvoir se connecter).
- Laisse « Enable Email provider » activé.

## 3. Servir les fichiers
La connexion au SDK fonctionne mieux via un petit serveur statique (plutôt que `file://`).
Depuis le dossier `project/` :

```bash
python3 -m http.server 8080
# puis ouvre http://localhost:8080/Connexion.html
```

(N'importe quel hébergement statique convient : Netlify, Vercel, GitHub Pages, Nginx…)

## 4. Créer ton compte
Ouvre **Connexion.html** → « Créer un compte » → email + mot de passe (6 caractères min).
Tu es redirigé·e vers le suivi clients. Chaque membre de l'équipe crée son propre compte ;
**tout le monde voit les mêmes clients, devis et tâches** (espace de travail partagé).

---

## Où vivent les clés
Tout est dans **`bc-config.js`** (URL + clé `anon`). La clé `anon` est publique par design ;
l'accès aux données est verrouillé par les **policies RLS** (réservé aux utilisateurs connectés).
Aucune clé `service_role` n'est utilisée côté navigateur.

## Architecture
- **`bc-config.js`** — configuration (le seul fichier à éditer pour changer de projet).
- **`bc-supabase.js`** — couche partagée : API `window.BC` (auth, clients, docs, tasks, profile),
  cache, realtime, garde d'authentification. Réutilisable telle quelle en React (phase 2).
- **`schema.sql`** — schéma + RLS + seed.
- Chaque page charge : SDK CDN → `bc-config.js` → `bc-supabase.js`.

## Suppression de profil
Le bouton « Supprimer mon profil » (page Profil) efface la **ligne de profil** et déconnecte.
La **suppression du compte d'authentification** lui-même nécessite la clé `service_role`
(dashboard Supabase → Authentication → Users, ou une Edge Function admin) — impossible
en toute sécurité depuis le navigateur.

## Pas encore branchés sur la base (phase 2)
- **Tableau de bord.html** (graphiques) et **Rapport.html** : chiffres encore statiques
  (ils ne lisaient aucune donnée auparavant). À calculer depuis la base dans un second temps.
  Ils sont déjà protégés par l'authentification.
