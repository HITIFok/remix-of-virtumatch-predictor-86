# VirtuMatch Predictor

Application de prédiction de matchs virtuels Instant League avec analyses statistiques avancées.

> Dernière mise à jour : Mai 2026

## Fonctionnalités

- 🏆 **Matchs en direct** : Consultez les matchs de l'Instant League en temps réel
- 📊 **Classement** : Statistiques complètes des équipes
- 🔮 **Prédictions** : Algorithmes de prédiction basés sur les performances
- 📱 **Interface mobile** : Design responsive optimisé pour mobile

## Technologies utilisées

- **Frontend**: React + TypeScript + Vite
- **UI**: shadcn-ui + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Scraper**: Python

## Installation

```bash
# Cloner le repository
git clone https://github.com/HITIFok/remix-of-virtumatch-predictor-86.git

# Naviguer dans le projet
cd remix-of-virtumatch-predictor-86

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos identifiants Supabase

# Lancer le serveur de développement
npm run dev
```

## Variables d'environnement

Créez un fichier `.env` avec :

```
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-anon-key
```

Voir `.env.example` pour la liste complète des variables requises.

## Scraper (Termux/Android)

Les scrapers Python récupèrent les données depuis l'API :

```bash
# Dans Termux avec connexion 4G
pip install requests
python scripts/scraper-api.py
```

Les variables d'environnement suivantes sont requises pour les scripts :
- `SPORTY_API_BASE` — URL de base de l'API
- `API_ORIGIN` / `API_REFERER` — Headers d'authentification API
- `API_APP_VERSION` — Version de l'API
- `SUPABASE_URL` / `PUSH_KEY` / `ANON_KEY` — Connexion Supabase

## Déploiement

Le projet peut être déployé sur Vercel :

1. Créez un nouveau projet sur [Vercel](https://vercel.com)
2. Importez le repository GitHub
3. Ajoutez les variables d'environnement
4. Déployez !

## Structure du projet

```
├── src/
│   ├── components/     # Composants React
│   ├── pages/          # Pages de l'application
│   ├── hooks/          # Hooks personnalisés
│   ├── lib/            # Utilitaires et logique
│   └── integrations/   # Intégration Supabase
├── supabase/
│   └── functions/      # Edge Functions Deno
├── api/                # Vercel Serverless Functions
├── scripts/            # Scrapers Python
└── public/             # Assets statiques
```

## Licence

MIT
