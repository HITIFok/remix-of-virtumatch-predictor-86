# LEAKAGE GATES

## Définitions

- **SAFE** : Feature disponible avant le moment de la prédiction (prouvé par code ou timestamp)
- **UNSAFE** : Feature utilise des données futures (leakage prouvé)
- **UNKNOWN** : Feature potentiellement disponible mais non prouvé — EXCLUE du backtest principal

## Audit par feature

### 1. Odds (odd_home, odd_draw, odd_away)

| Propriété | Valeur |
|-----------|--------|
| Source | API externe (hg-event-api-prod) via scraper |
| Timestamp | `created_at` de la prédiction |
| Disponible avant prédiction ? | OUI — les cotes sont capturées au moment de la prédiction |
| **Verdict** | **SAFE** |

Preuve : `predictions.js` POST stocke `odd_home`, `odd_draw`, `odd_away` du corps de la requête, qui provient du frontend au moment où l'utilisateur fait la prédiction.

### 2. Implied Probabilities (prob_home, prob_draw, prob_away)

| Propriété | Valeur |
|-----------|--------|
| Source | Dérivées des cotes par `prediction-engine.ts` |
| Timestamp | Même que les cotes |
| Disponible avant prédiction ? | OUI — calculées à partir des cotes |
| **Verdict** | **SAFE** |

Preuve : Les probabilités sont calculées par normalisation des inverses des cotes. Pas de donnée externe.

### 3. Team Stats / Ranking

| Propriété | Valeur |
|-----------|--------|
| Source | `scraped_data` (data_type='ranking') ou API externe |
| Timestamp | `scraped_at` de la dernière scrape |
| Disponible avant prédiction ? | **UNKNOWN** |
| **Verdict** | **UNKNOWN** |

Risque : Le ranking est upserté — seule la dernière version est conservée. Si le ranking a été scrapé APRÈS le début du round en cours, il peut inclure des résultats du round actuel (leakage). De plus, `teamStats` est passé au moteur mais n'est PAS stocké dans la prédiction.

**Action requise** : Vérifier que `scraped_at` < `match.expectedStart` pour chaque prédiction. Ajouter `feature_snapshot` aux futures prédictions.

### 4. Form (derniers 5 matchs)

| Propriété | Valeur |
|-----------|--------|
| Source | `historicalResults` passé au moteur |
| Timestamp | Non stocké — reconstruit au moment de la prédiction |
| Disponible avant prédiction ? | **UNKNOWN** |
| **Verdict** | **UNKNOWN** |

Risque : Les résultats historiques proviennent de l'API externe ou de `scraped_data`. Si les résultats incluent des matchs du MÊME round que la prédiction → leakage. Les résultats d'un round précédent ne sont disponibles qu'après la fin de ce round.

**Action requise** : Vérifier que tous les `historicalResults` ont un `round < round_de_la_prédiction`. Ajouter un filtre temporel.

### 5. H2H (confrontations directes)

| Propriété | Valeur |
|-----------|--------|
| Source | `historicalResults` filtré par home/away |
| Timestamp | Même que Form |
| Disponible avant prédiction ? | **UNKNOWN** |
| **Verdict** | **UNKNOWN** |

Même risque que Form. Les confrontations H2H pourraient inclure des matchs du round actuel.

**Action requise** : Même action que Form.

### 6. Momentum

| Propriété | Valeur |
|-----------|--------|
| Source | Dérivé de Form (derniers 5 matchs) |
| Timestamp | Même que Form |
| Disponible avant prédiction ? | **UNKNOWN** |
| **Verdict** | **UNKNOWN** |

Momentum = f(Form), donc même statut. Si Form est SAFE, Momentum est SAFE. Si Form est UNKNOWN, Momentum est UNKNOWN.

### 7. AI Prediction (Groq)

| Propriété | Valeur |
|-----------|--------|
| Source | Groq API (analyze-match.js côté serveur) |
| Timestamp | Moment de l'appel API |
| Disponible avant prédiction ? | **UNKNOWN** |
| **Verdict** | **UNKNOWN** |

Risques multiples :
1. Le modèle Groq peut avoir été entraîné sur des données incluant les résultats du match (contamination)
2. Le prompt envoyé à Groq peut inclure des informations sur le match en cours
3. La réponse Groq n'est pas stockée dans la prédiction — impossible à auditer a posteriori

**Action requise** : Pour le backtest, désactiver l'IA (AI_WEIGHT=0) ou documenter explicitement que les résultats incluent une composante IA non reproductible.

### 8. Anti-trap

| Propriété | Valeur |
|-----------|--------|
| Source | Dérivé de odds + momentum + H2H + AI + ranking |
| Timestamp | Même que les features sources |
| Disponible avant prédiction ? | **UNKNOWN** (dépend des features sources) |
| **Verdict** | **UNKNOWN** |

Anti-trap = f(odds, momentum, H2H, AI, ranking). Si une feature source est UNKNOWN, anti-trap est UNKNOWN.

## Résumé

| Feature | Verdict | Raison |
|---------|---------|--------|
| Odds | SAFE | Capturées au moment de la prédiction |
| Implied Probabilities | SAFE | Calculées à partir des cotes |
| Team Stats/Ranking | UNKNOWN | Timestamp non vérifié, pas stocké |
| Form | UNKNOWN | Peut inclure résultats du même round |
| H2H | UNKNOWN | Même risque que Form |
| Momentum | UNKNOWN | Dérivé de Form |
| AI (Groq) | UNKNOWN | Contamination potentielle, non reproductible |
| Anti-trap | UNKNOWN | Dépend de features UNKNOWN |

## Gate de Backtest

**Règle** : Toute feature `UNKNOWN` est EXCLUE du backtest principal jusqu'à résolution.

**Backtest principal (SAFE uniquement)** :
- ✅ Odds → Normalized Implied Probabilities →"Odds-Only" model
- ✅ Simple Poisson (dérivé des cotes)
- ✅ Baselines (Majority, Raw Odds)

**Backtest étendu (avec features UNKNOWN)** :
- ⚠️ VirtuMatch Current (inclut form, H2H, AI, etc.)
- ⚠️ Résultats à interpréter avec prudence
- ⚠️ Ne peut pas distinguer l'amélioration du leakage de l'amélioration réelle

**Pour rendre les features SAFE** :
1. Ajouter `feature_snapshot` JSONB à la table `predictions`
2. Ajouter `scraped_at` à chaque feature pour vérification temporelle
3. Implémenter des filtres temporels dans le moteur (ne pas utiliser résultats du round en cours)
4. Logger les inputs du moteur pour audit a posteriori
