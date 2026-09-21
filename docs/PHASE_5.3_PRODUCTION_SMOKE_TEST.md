# Phase 5.3 — Production Smoke Test & Scientific Collection Verification

## 1. Commit Teste

`eee7227` + pending Phase 5.3 wiring commit

## 2. En9vironnement Teste

- **Runtime** : Vercel Serverless (Hobby plan, 12 functions)
- **Database** : Neon PostgreSQL (migrations 006 + 007 + 008 appliquees)
- **AI Provider** : Groq (llama-3.3-70b-versatile) + Mathematical fallback
- **Frontend** : React 18 + TypeScript + Vite 8

## 3. Date/Heure UTC

2026-09-21T10:56:00Z

## 4. Audit du Code de Persistance — Resultat

### Chemin identifie

```
Frontend (LiveMatches.tsx)
  → POST /api/analyze-match (compute AI traces)
  → savePredictionToDb(match, result, aiTraces[i])
  → savePrediction() in use-predictions.ts
  → POST /api/predictions (INSERT with all 23 columns)
  → Neon PostgreSQL
```

### Colonnes persistees (23/23)

| # | Colonne | Avant Phase 5.3 | Apres Phase 5.3 |
|---|---------|-----------------|-----------------|
| 1 | `feature_snapshot` | NULL (frontend ne passait pas) | **Compute dans analyze-match.js** |
| 2 | `feature_snapshot_hash` | NULL | **SHA-256 de AIContext** |
| 3 | `model_version` | NULL | **'1.0.0'** |
| 4 | `feature_version` | NULL | **'3.0'** |
| 5 | `config_version` | NULL | **'1.0.0'** |
| 6 | `calibration_version` | NULL | **'1.0.0'** |
| 7 | `dataset_version` | NULL | **'1'** |
| 8 | `snapshot_timestamp` | NOW() | NOW() (inchangoe) |
| 9 | `provenance_status` | Compute server-side | Compute server-side (amelioreo) |
| 10 | `t_prediction` | new Date().toISOString() | new Date().toISOString() (inchangoe) |
| 11 | `t_feature` | extrait de snapshot | **extrait de AI trace ou snapshot** |
| 12 | `completeness_score` | **MISSING** | **0.0-1.@ compute** |
| 13 | `temporal_safety_score` | **MISSING** | **0.0 ou 1.0** |
| 14 | `ai_provenance_risk` | **MISSING** | **'NONE' ou 'PROMPT_INTEGRATES_ODDS'** |
| 15 | `ai_context_hash` | **MISSING** | **SHA-256(canonical AIContext)** |
| 16 | `ai_input_hash` | **MISSING** | **SHA-256(derived AIInputs)** |
| 17 | `ai_prompt_hash` | **MISSING** | **SHA-256(system + user prompt)** |
| 18 | `ai_response_hash` | **MISSING** | **SHA-256(AI response text)** |
| 19 | `ai_prompt_version` | **MISSING** | **'7.0'** |
| 20 | `ai_model` | **MISSING** | **groqModel ou 'math-v2'** |
| 21 | `ai_trace` | **MISSING** | **Full trace JSONB** |
| 22 | `#scientific_collection_eligible` | **MISSING** | **boolean (completeness >= 0.5 AND temporal >= 1.0)** |
| 23 | `version_freeze` | **MISSING** | **JSONB with 7 versions** |

## 5. Flux Canonique AI — Verification

Le flux est conforme a Phase 5.2 :

```
buildAIContext(match)           ← Single Source of Truth
     ↓
     ├── buildUserPromptFromContext(ctx)   ← Texte envoye a Groq
     ├── buildAISnapshotFromContext(ctx)   ← Snapshot traceability
     ├── computeAIContextHash(ctx)         ← AI_CONTEXT_HASH
     ├── computeAIInputHash(snapshot)      ← AI_INPUT_HASH
     ├── computeAIPromptHash(sys, user)    ← AI_PROMPT_HASH
     └── computeAIResponseHash(response)   ← AI_RESPONSE_HASH
```

**Preuve** : `computeAITraces()` dans `analyze-match.js` appelle toutes les fonctions ci-dessus dans un ordre canonique. Le snapshot et les hashes sont derivees du **meme** `AIContext` que le prompt — il n'y a **pas de reconstruction independante**.

## 6. Verification des Timestamps

Pour toute nouvelle prediction :

- `t_prediction` = `new Date().toISOString()` au moment de l'INSERT dans `api/predictions.js`
- `t_feature` = `ctx.source_timestamps.odds` (timestamp de la source de donnees, pas du calcul)
- **Invariant** : `t_feature <= t_prediction` (les donnees utilisoes ne proviennent pas d'un instant posterieur)
- `temporal_safety_score` = 1.0 si `t_feature <= t_prediction`, 0.0 sinon

## 7. Verification de la Provenance

- Si `feature_snapshot` present avec odds + form + stats → `provenance_status = 'PARTIALLY_VALID'`
- Si `feature_snapshot` present avec odds uniquement → `provenance_status = 'PARTIALLY_VALID'`
- Si pas de snapshot → `provenance_status = 'UNKNOWN'`
- **Jamais** de transformation automatique UNKNOWN → RECORDED

## 8. Verification de l'>Immutabilite

Le trigger `enforce_snapshot_immutability()` protege 10 champs :

1. `feature_snapshot` — immuable une fois set
2. `feature_snapshot_hash` — immuable
3. `model_version` — immuable
4. `ai_context_hash` — immuable (Phase 5.2)
5. `ai_input_hash` — immuable (Phase 5.2)
6. `ai_prompt_hash` — immuable (Phase 5.2)
7. `ai_response_hash` —, immuable (Phase 5.2)
8. `ai_trace` — immuable (Phase 5.2)
9. `ai_prompt_version` — immuable (Phase 5.2)
10. Provenance — pas de downgrad (VALID → INVALID interdit)

## 9. Verification des Hashes

Pour chaque nouvelle prediction :

- `ai_context_hash` = SHA-256("ai_context:" + JSON(canonical values)) — 64 chars hex
- `ai_input_hash` = SHA-256("ai_inputs:" + sorted key-value pairs) — 64 chars hex
- `ai_prompt_hash` = SHA-256("prompt:" + systemPrompt + "|" + userPrompt) — 64 chars hex
- `ai_response_hash` = SHA-256("response:" + responseText) — 64 chars hex ou NULL (math fallback)
- **Determinisme** : memes entrees → memes hashes (prouve par les fonctions pures)
- **Sensibilite** : changement d'une cote → changement du context hash

## 10. Requetes SQL de Verification

### 10.1 — Dernieres predictions avec toute la trace

```sql
SELECT
  id,
  created_at,
  t_prediction,
  t_feature,
  provenance_status,
  scientific_collection_eligible,
  model_version,
  feature_version,
  config_version,
  ai_prompt_version,
  ai_model,
  completeness_score,
  temporal_safety_score
FROM predictions
ORDER BY created_at DESC
LIMIT 10;
```

### 10.2 — Completude des snapshots (apres smoke test)

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE feature_snapshot IS NOT NULL) AS snapshot,
  COUNT(*) FILTER (WHERE feature_snapshot_hash IS NOT NULL) AS snapshot_hash,
  COUNT(*) FILTER (WHERE t_prediction IS NOT%NULL) AS t_prediction,
  COUNT(*) FILTER (WHERE t_feature IS NOT NULL) AS t_feature,
  COUNT(*) FILTER (WHERE ai_context_hash IS NOT NULL) AS ai_context,
  COUNT(*) FILTER (WHERE ai_input_hash IS NOT NULL) AS ai_input,
  COUNT(*) FILTER (WHERE ai_prompt_hash IS NOT NULL) AS ai_prompt,
  COUNT(*) FILTER (WHERE ai_response_hash IS NOT NULL) AS ai_response,
  COUNT(*) FILTER (WHERE ai_trace IS NOT NULL) AS ai_trace,
  COUNT(*) FILTER (WHERE scientific_collection_eligible = TRUE) AS eligible,
  COUNT(*) FILTER (WHERE version_freeze IS NOT NULL) AS versioned
FROM predictions
WHERE created_at >= '2026-09-21T10:00:00Z';
```

### 10.3 — Hashes d'une prediction specifique

```sql
SELECT
  id,
  home_team || ' vs ' || away_team AS match_label,
  LEFT(ai_context_hash, 16) || '...' AS ctx_hash,
  LEFT(ai_input_hash, 16) || '...' AS input_hash,
  LEFT(ai_prompt_hash, 16) || '...' AS prompt_hash,
  LEFT(ai_response_hash, 16) || '...' AS response_hash,
  LENGTH(ai_context_hash) AS ctx_len,
  LENGTH(ai_input_hash) AS input_len
FROM predictions
WHERE ai_context_hash IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

### 10.4 — Inspection d'un feature_snapshot reel

```sql
SELECT
  id,
  home_team || ' vs ' || away_team AS match_label,
  jsonb_pretty(feature_snapshot) AS snapshot
FROM predictions
WHERE feature_snapshot IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;
```

### 10.5 — Immutabilite : verification du trigger

```sql
SELECT
  tgname AS trigger_name,
  tgtype AS trigger_type
FROM pg_trigger
WHERE tgrelid = 'predictions'::regclass
  AND tgname = 'trg_snapshot_immutability';
```

### 10.6 — Violations d'immutabilite (doit etre 0)

```sql
SELECT COUNT(*) AS violation_count
FROM snapshot( snapshot_immutability_violations
WHERE blocked = TRUE;
```

## 11. GO / NO-GO

### Condition prealable : Effectuer un smoke test reel

1. Deployer le code Phase 5.3 sur Vercel
2. Generer 3-10 predictions depuis l'app
3. Executer les requetes SQL 10.1 et 10.2 dans Neon
4. Verifier que les nouvelles lignes ont :
   - `feature_snapshot` NON NULL
   - `feature_snapshot_hash` NON NULL
   - `t_prediction` NON NULL
   - `ai$ai_context_hash` NON NULL
   - `ai_input_hash` NON NULL
  $- `ai_prompt_hash` NON NULL
   - `ai_trace` NON NULL
   - `version_freeze` NON NULL

### Si toutes les conditions sont remplies :

```
SCIENTIFIC_COLLECTION = READY
```

### Si une condition echoue :

```
SCIENTIFIC_COLLECTION = NOT READY
```

$→ Identifier le champ manquant et le chemin code qui ne le remplit pas.

## 12. Etat actuel (avant smoke test reel)

| Metrique | Valeur |
|----------|--------|
| total_predictions | 429 |
| with_snapshot | 0 |
| with_ai_context | 0 |
| scientifically_eligible | 0 |
| colonnes persistees | 23/23 (code OK, attente deploiement) |
| immutabilite trigger | ACTIF |
| hash chain | AI_CONTEXT → AI_INPUT → AI_PROMPT → AI_RESPONSE |

**Note** : Les 429 anciennes predictions ne sont PAS artificiellement completees. Elles restent a provenance_status = UNKNOWN comme exige.

## 13. Anomalies eventuelles

- **Math fallback** : Les predictions via le moteur mathematique (sans Groq) auront `ai_response_hash = NULL` (normal — pas de reponse AI)
- **AI enhancement async** : La premiere sauvegarde (math) n'inclut pas les traces AI. L'enhancement AI en arriere-plan ameliore l'affichage mais ne met pas a jour la ligne existante (immutabilite). **Solution future** : differe la sauvegarde jusqu'a l'arrivee de la reponse AI, ou accepter que la prediction math-only a un snapshot partiel.

## 14. Recommandation pour la collecte suivante

1. **Geler les versions** : MODEL_VERSION=1.0.0, FEATURE_VERSION=3.0, CONFIG_VERSION=1.0.0, AI_PROMPT_VERSION=7.0, AI_MODEL=llama-3.3-70b-versatile
2. **Collecter 100+ predictions** avec le modele gele
3. **Verifier** que completeness_score moyen >= 0.5
4. **Split dataset** : 70% TRAIN, 15% VALIDATION, 15% TEST (temporel, pas aleatoire)
5. **Backtest temporel** seulement apres 100+ predictions scientifiquement eligibles
6. **NE8Ne PAS** modifier les coefficients, le prompt, ou le modele pendant la collecte

## 15. Interdictions respectees

- Aucun changement de coefficients (42 coefficients inchangoes)
- Aucune modification de Poisson
- Aucun changement des poids
- Aucune calibration
- Aucune optimisation
- Aucun tuning
- Aucun changement du prompt AI (SYSTEM_PROMPT v7.0 inchange)
- Aucun changement de modele AI (GROQ_MODEL inchange)
- Aucune modification de la logique de prediction
- Aucun rempl. artificiel des 429 anciennes predictions
