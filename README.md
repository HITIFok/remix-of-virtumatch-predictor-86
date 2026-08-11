# VirtuMatch Predictor

Application de prédiction de matchs virtuels Instant League avec analyses statistiques avancées.

> Dernière mise à jour : Août 2026

## Fonctionnalités

- 🏆 **Matchs en direct** : Consultez les matchs de l'Instant League en temps réel
- 📊 **Classement** : Statistiques complètes des équipes
- 🔮 **Prédictions** : Algorithmes de prédiction basés sur les performances
- 📱 **Interface mobile** : Design responsive optimisé pour mobile

## Technologies utilisées

- **Frontend**: React + TypeScript + Vite
- **UI**: shadcn-ui + Tailwind CSS
- **Backend**: Neon PostgreSQL + Vercel Serverless Functions
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
# Éditer .env avec vos identifiants (voir .env.example)

# Lancer le serveur de développement
npm run dev
```

## Variables d'environnement

Créez un fichier `.env` à partir de `.env.example`.

Les variables sensibles (NEON_DATABASE_URL, ADMIN_TOKEN_SECRET) sont configurées côté serveur uniquement (Vercel Environment Variables). Elles ne sont **jamais** exposées au client.

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
│   └── config/         # Configuration API
├── api/                # Vercel Serverless Functions
├── scripts/            # Scrapers Python
├── legacy/             # Archives (ancienne config Supabase)
└── public/             # Assets statiques
```

## Licence

MIT
