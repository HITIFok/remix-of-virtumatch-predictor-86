# VirtuMatch Predictor

Application de prédiction de matchs virtuels Instant League (bet261.mg) avec analyses statistiques avancées.

## Fonctionnalités

- 🏆 **Matchs en direct** : Consultez les matchs de l'Instant League en temps réel
- 📊 **Classement** : Statistiques complètes des équipes
- 🔮 **Prédictions** : Algorithmes de prédiction basés sur les performances
- 📱 **Interface mobile** : Design responsive optimisé pour mobile

## Technologies utilisées

- **Frontend**: React + TypeScript + Vite
- **UI**: shadcn-ui + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Scraper**: Python (API sporty-tech.net)

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
VITE_SUPABASE_PROJECT_ID=votre-project-id
VITE_SUPABASE_PUBLISHABLE_KEY=votre-anon-key
```

## Scraper (Termux/Android)

Le scraper Python récupère les données depuis l'API bet261.mg :

```bash
# Dans Termux avec connexion 4G
pip install requests
python scripts/scraper-api.py
```

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
├── scripts/
│   └── scraper-api.py  # Scraper Python
└── public/             # Assets statiques
```

## Licence

MIT
