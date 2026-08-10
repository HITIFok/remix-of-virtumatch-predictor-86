# ⚠️ Legacy — Ancienne architecture Supabase (PRE-MIGRATION)

Ces fichiers documentent l'ancienne infrastructure Supabase, avant la **migration vers Neon PostgreSQL** le 10 août 2026.

## Ce que contient ce dossier

- `config.toml` — Configuration Supabase (Edge Functions, base de données)
- `functions/` — Supabase Edge Functions (Deno) — **remplacées par les API Routes Vercel (`api/*.js`)**
- `migrations/` — Migrations SQL Supabase — certaines ont été adaptées pour Neon
- `*.sql` — Scripts d'installation et de configuration Supabase

## ⚠️ Policies RLS INOPÉRANTES sur Neon

Les fichiers SQL de ce dossier contiennent des policies RLS du type :

```sql
FOR ALL USING (auth.role() = 'service_role')
```

**Ces policies ne fonctionnent PAS sur Neon.** La fonction `auth.role()` provient de l'extension `supabase_auth` qui n'existe que sur Supabase. Sur Neon :

- RLS peut être activé sur les tables, mais les policies basées sur `auth.role()` sont sans effet
- L'accès à la base de données est contrôlé **exclusivement par les permissions du rôle Postgres** de la connection string `NEON_DATABASE_URL`
- Si le rôle a `rolbypassrls = true` ou `rolsuper = true`, RLS est **complètement contourné**

## Modèle de sécurité actuel

Voir `docs/SECURITY-NEON.md` pour le modèle de sécurité réel en vigueur après la migration.

## Ne PAS exécuter ces fichiers

Ces scripts ne doivent **plus** être exécutés sur la base de données Neon. Ils sont conservés à titre d'historique uniquement.
