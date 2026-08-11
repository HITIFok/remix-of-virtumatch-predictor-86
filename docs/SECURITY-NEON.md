# Modèle de sécurité Neon — VirtuMatch/Bet261

> Documenté le 10 août 2026 après migration complète de Supabase vers Neon PostgreSQL.

## Architecture

```
┌─────────────┐     HTTPS      ┌──────────────────┐    postgres()     ┌──────────┐
│  Navigateur  │ ────────────► │  Vercel API Routes │ ──────────────► │  Neon DB  │
│  ou APK      │               │  (api/*.js)        │   NEON_DATABASE_URL│ PostgreSQL│
└─────────────┘               └──────────────────┘                   └──────────┘
                                       │
                                  ADMIN_TOKEN_SECRET
                                  (signe les JWT admin)
```

## Principe fondamental

**La connexion string Neon n'est JAMAIS exposée au client.**

Contrairement à Supabase où la clé `anon` publique permettait au client de faire des requêtes REST directes (protégées par RLS), avec Neon :

- **Seules les API Routes Vercel** (serveur) détiennent `NEON_DATABASE_URL`
- Le frontend (React/Vite) appelle les API Routes via HTTPS (`/api/*`)
- Il n'existe **aucun moyen** pour un client (navigateur, APK) de se connecter directement à Neon
- Les API Routes sont les **seuls points d'entrée** vers la base de données

## Rôle Postgres utilisé

Rôle utilisé par `NEON_DATABASE_URL` (vérifié le 10 août 2026) :

| Propriété | Valeur |
|-----------|--------|
| `current_user` | `neondb_owner` |
| `session_user` | `neondb_owner` |
| `rolsuper` | **false** |
| `rolbypassrls` | **true** |

**Conclusion : `rolbypassrls = true` signifie que RLS est complètement contourné.**

Le rôle `neondb_owner` contourne TOUTES les policies RLS. Cela signifie :

- Les policies RLS des anciens fichiers Supabase (`auth.role() = 'service_role'`) sont **doublement inopérantes** : la fonction `auth.role()` n'existe pas sur Neon, ET même si elle existait, `neondb_owner` contournerait la policy
- La protection repose **entièrement** sur le fait que `NEON_DATABASE_URL` ne fuit jamais du serveur
- Pas de clé anon publique, pas d'API REST directe côté client
- La seule porte d'entrée vers la BDD est les API Routes Vercel (qui sont les seules à détenir la connection string)

## Secrets critiques

| Secret | Où | Protection |
|--------|-----|-----------|
| `NEON_DATABASE_URL` | Vercel Environment Variables | Jamais dans le bundle client |
| `ADMIN_TOKEN_SECRET` | Vercel Environment Variables | Signe les JWT HMAC-SHA256 pour les opérations admin |

## Flux d'authentification admin

```
Client ──POST /api/admin-login──► Vercel API
  │                                    │
  │  password en clair                  │  Vérifie via SQL:
  │                                    │  SELECT * FROM admin_settings
  │                                    │  WHERE setting_key = 'admin_code'
  │                                    │  + compare bcrypt (pgcrypto.crypt)
  │                                    │
  │◄── JWT token (HMAC-SHA256) ────────│  Si mot de passe correct,
  │                                    │  signe un JWT avec ADMIN_TOKEN_SECRET
  │
  ├──GET /api/admin-verify──► Vercel API
  │                                    │  Vérifie le JWT + vérifie
  │                                    │  que le token est valide et non expiré
  │◄── { isAdmin: true } ──────────────│
```

## RLS — Statut actuel

Les policies RLS basées sur `auth.role() = 'service_role'` des anciens fichiers Supabase sont **INOPÉRANTES** sur Neon :

- `auth.role()` provient de l'extension `supabase_auth` qui n'existe pas sur Neon
- Si le rôle Neon a `rolbypassrls = true`, toute policy RLS est contournée
- Les tables critiques (`admin_settings`, `predictions`, `access_codes`) sont protégées par le fait que **seules les API Routes serveur** y accèdent

## Ce qui a été fait (10 août 2026)

1. ✅ Rotation du mot de passe admin (nouveau hash bcrypt dans Neon)
2. ✅ Rotation de ADMIN_TOKEN_SECRET
3. ✅ Purge de l'historique git (secrets + refs Supabase)
4. ✅ Suppression du système de scraping (push-odds, scrapers Python, table scraped_data)
5. ✅ Dossier `supabase/` déplacé vers `legacy/supabase-pre-migration/`
6. ✅ Nettoyage des tables inutilisées dans Neon (6 tables supprimées)
7. ✅ Tous les fichiers de config (README, CI/CD, .env.example) mis à jour
8. ✅ Demande de purge des refs PR auprès de GitHub Support

## Recommandations

- **Ne jamais** mettre `NEON_DATABASE_URL` dans une variable `VITE_*` (elles sont exposées au client)
- **Ne jamais** installer le client Supabase (`@supabase/supabase-js`) dans le frontend
- **Activer** Push Protection sur GitHub pour empêcher tout commit de secrets futurs
- **Vérifier** régulièrement que `NEON_DATABASE_URL` n'apparaît pas dans un build (`dist/`)
