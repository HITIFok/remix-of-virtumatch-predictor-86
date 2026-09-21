# Phase 5.3.1 — Persistence Debug Report

**Date**: 2026-09-21
**Commit**: `bcc8331` — fix: Phase 5.3.1 — fix scientific collection persistence
**Previous commit**: `11f894b` — Phase 5.3: Wire AI traceability into production pipeline
**Status**: FIX DEPLOYED — awaiting Neon verification

---

## 1. Cause Exacte du Problème

### Symptôme

31 nouvelles prédictions générées après le commit `11f894b`. Toutes ont **0 colonnes scientifiques** dans Neon :

```
with_feature_snapshot      = 0
with_ai_context_hash       = 0
with_ai_input_hash         = 0
with_ai_prompt_hash        = 0
with_ai_response_hash      = 0
with_ai_model              = 0
with_ai_prompt_version     = 0
with_ai_trace              = 0
scientific_collection      = 0
version_freeze             = 0
completeness_score         = 0
temporal_safety_score      = 0
```

### Cause Racine

**Deux saves contradictoires pour la même prédiction :**

1. **`handlePredict` (LiveMatches.tsx ligne 536)** :
   ```typescript
   savePredictionToDb(match, result)  // ← SANS aiTrace (3e paramètre absent)
   ```
   → INSERT avec tous les champs scientifiques = NULL

2. **`handleBatchPredict` (LiveMatches.tsx ligne 575)** :
   ```typescript
   Promise.all(batchResults.map(({ match, result }) => savePredictionToDb(match, result)))
   ```
   → INSERT avec tous les champs scientifiques = NULL

3. **`enhanceWithAI` (LiveMatches.tsx ligne 505)** — trop tard :
   ```typescript
   savePredictionToDb(t.match, result, aiTraces[i])  // ← AVEC aiTrace
   ```
   → Tente un DEUXIÈME INSERT → soit duplique la ligne (UUID différent), soit échoue silencieusement (erreur catchée)

### Pourquoi le 2e INSERT échoue

- Si `predictions[matchKey]` est undefined (stale closure React) → save sauté
- Si le save aboutit → crée une DUPLICATE row avec un UUID différent → mais les queries SQL comptent les lignes SANS snapshot, et la majorité n'en ont pas
- Si le Groq API rate-limited/timeout → `enhanceWithAI` échoue silencieusement → aucun save avec aiTrace

### Diagramme du Flux Cassé

```
handlePredict(match)
  │
  ├─ processMatch(match, undefined)  → result (math instantané)
  │
  ├─ savePredictionToDb(match, result)           ← SAVE #1: SANS aiTrace
  │   └─ POST /api/predictions                   ← INSERT: toutes colonnes scientifiques = NULL
  │
  └─ enhanceWithAI([match])                      ← Background
      ├─ POST /api/analyze-match                 → { predictions, ai_traces }
      │
      └─ savePredictionToDb(match, result, aiTraces[0])  ← SAVE #2: AVEC aiTrace
          └─ POST /api/predictions               ← DEUXIÈME INSERT (DUPLICATE!)
             ├─ Succès → 2 lignes dans Neon (1 sans + 1 avec snapshot)
             ├─ 409 Duplicate → ignoré silencieusement
             └─ Error → catchée, logguée, prediction perdue
```

---

## 2. Fichier et Ligne Où les Données Étaient Perdues

| Fichier | Ligne | Problème |
|---------|-------|----------|
| `src/pages/LiveMatches.tsx` | 536 | `savePredictionToDb(match, result)` — SANS aiTrace |
| `src/pages/LiveMatches.tsx` | 575 | `savePredictionToDb(match, result)` — SANS aiTrace |
| `src/pages/LiveMatches.tsx` | 505 | `savePredictionToDb(t.match, result, aiTraces[i])` — DEUXIÈME INSERT au lieu de UPDATE |

**Les données scientifiques étaient calculées correctement** par `computeAITraces()` dans `analyze-match.js` et retournées dans `response.ai_traces`. Le problème n'était pas dans le calcul, mais dans le **flux de persistance** : la première save (sans aiTrace) créait une ligne avec tous les champs NULL, et la deuxième save (avec aiTrace) ne pouvait pas mettre à jour la ligne existante car il n'y avait pas de mécanisme PATCH/UPDATE.

---

## 3. Preuve Avant Correction

Les 31 nouvelles prédictions dans Neon (après commit `11f894b`) :

```
total_new                         = 31
with_feature_snapshot             = 0  ← TOUS NULL
with_ai_context_hash              = 0  ← TOUS NULL
with_ai_input_hash                = 0  ← TOUS NULL
with_ai_prompt_hash               = 0  ← TOUS NULL
with_ai_response_hash             = 0  ← TOUS NULL
with_ai_trace                     = 0  ← TOUS NULL
with_scientific_collection_eligible = 0  ← TOUS FALSE/default
```

---

## 4. Correction Appliquée

### Architecture du Fix

```
handlePredict(match)
  │
  ├─ processMatch(match, undefined)  → result (math instantané)
  │
  ├─ savePredictionToDb(match, result)           ← SAVE #1: SANS aiTrace (inchangé)
  │   ├─ POST /api/predictions                   ← INSERT: colonnes scientifiques = NULL
  │   └─ return prediction UUID                  ← NOUVEAU: stocke UUID dans predictionIdMap
  │
  └─ enhanceWithAI([match])                      ← Background
      ├─ POST /api/analyze-match                 → { predictions, ai_traces }
      │
      └─ predictionIdMap.get(matchKey) → predId  ← NOUVEAU: retrouve l'UUID
          │
          ├─ Si predId existe:
          │   └─ PATCH /api/predictions           ← NOUVEAU: UPDATE au lieu de INSERT!
          │       body: { prediction_id: predId, ...aiTraces[i] }
          │       → Met à jour les colonnes NULL → valeurs scientifiques
          │       → Le trigger d'immutabilité autorise NULL → valeur
          │
          └─ Si predId n'existe pas (fallback):
              └─ savePredictionToDb(match, result, aiTraces[i])  ← INSERT avec aiTrace
```

### Changements par Fichier

| Fichier | Changement |
|---------|------------|
| `api/predictions.js` | Ajout PATCH method : UPDATE colonnes scientifiques par UUID |
| `api/predictions.js` | Diagnostic log POST : vérifie feature_snapshot, hashes après INSERT |
| `api/analyze-match.js` | Diagnostic log : vérifie ai_traces produit par computeAITraces() |
| `src/hooks/use-predictions.ts` | Ajout `updatePredictionScientificFields(id, fields)` → PATCH |
| `src/pages/LiveMatches.tsx` | `predictionIdMap` ref : matchKey → UUID mapping |
| `src/pages/LiveMatches.tsx` | `savePredictionToDb` retourne UUID, le stocke dans predictionIdMap |
| `src/pages/LiveMatches.tsx` | `enhanceWithAI` : PATCH au lieu de INSERT quand UUID existe |
| `api/_lib/auth-matrix.js` | PATCH ajouté aux methods de /api/predictions |

---

## 5. Trace Complète du Pipeline (Après Correction)

```
[1] analyze-match.js : computeAITraces()
    → buildAIContext(match) → ctx
    → buildAISnapshotFromContext(ctx) → snapshot
    → computeAIContextHash(ctx) → ai_context_hash (64-char hex)
    → computeAIInputHash(snapshot) → ai_input_hash
    → computeAIPromptHash(SYSTEM_PROMPT, userPrompt) → ai_prompt_hash
    → computeAIResponseHash(aiResponseText) → ai_response_hash (ou null)
    → feature_snapshot, completeness_score, temporal_safety_score, etc.
    → DIAGNOSTIC LOG: ai_traces[0] keys, has_snapshot, has_ctx_hash, eligible

[2] HTTP Response : { predictions: [...], ai_traces: [...] }
    → ai_traces présent dans le JSON

[3] LiveMatches.tsx : enhanceWithAI()
    → data.ai_traces extracted
    → DIAGNOSTIC LOG: aiTraces received count

[4] LiveMatches.tsx : predictionIdMap.get(matchKey) → predId
    → Si predId: PATCH /api/predictions { prediction_id, ...aiTraces[i] }
    → Si !predId: POST /api/predictions { ...fields, ...aiTraces[i] }

[5] api/predictions.js : PATCH handler
    → Validate UUID
    → Auth check (User or Device)
    → Build dynamic SET clause from provided fields
    → UPDATE predictions SET ... WHERE id = uuid AND owner
    → Immutability trigger: NULL → value ALLOWED
    → RETURNING *

[6] Neon : Row updated with scientific fields
```

---

## 6. Test d'Intégration

### Manual Test Procedure

1. Déployer `bcc8331` sur Vercel
2. Ouvrir l'application VirtuMatch
3. Générer 3-10 nouvelles prédictions (clic "Predict" ou batch)
4. Attendre 10-15 secondes (que enhanceWithAI complete)
5. Exécuter les SQL queries dans Neon

### SQL Verification

```sql
-- Vérifier les nouvelles prédictions ont des colonnes scientifiques
SELECT
  COUNT(*) AS total_new,
  COUNT(feature_snapshot) AS with_snapshot,
  COUNT(ai_context_hash) AS with_ctx_hash,
  COUNT(ai_input_hash) AS with_inp_hash,
  COUNT(ai_prompt_hash) AS with_prompt_hash,
  COUNT(ai_trace) AS with_trace,
  COUNT(CASE WHEN scientific_collection_eligible = true THEN 1 END) AS eligible
FROM predictions
WHERE created_at >= '2026-09-21';

-- Expected: with_snapshot > 0, with_ctx_hash > 0, etc.
```

### Diagnostic Console Logs

Dans le browser DevTools Console :
```
[savePredictionToDb] Saved TeamA-TeamB → uuid, aiTrace=false, fields=0
[enhanceWithAI] aiTraces received: 1, aiPreds: 1
[enhanceWithAI] PATCHING TeamA-TeamB → uuid with 20 trace fields
[updatePredictionScientificFields] PATCH success: uuid
```

Dans Vercel Function Logs :
```
[analyze-match] DIAGNOSTIC: ai_traces[0] keys=feature_snapshot,feature_snapshot_hash,..., eligible=true
[predictions POST] DIAGNOSTIC: id=uuid, has_snapshot=false, has_ctx_hash=false, eligible=false
[predictions PATCH] → (si le PATCH réussit, les champs sont mis à jour)
```

---

## 7. Commit Git

```
bcc8331 fix: Phase 5.3.1 — fix scientific collection persistence (root cause: duplicate INSERT instead of PATCH)
```

5 files changed, 233 insertions(+), 12 deletions(-)

---

## 8. Résultat du Déploiement

- Commit poussé sur `origin/main`
- Vercel auto-deploy depuis `main`
- 12 API endpoints (inchangé — PATCH est un method additionnel sur `predictions.js`)
- TypeScript compilation : PASS
- Tests : 173/173 PASS

---

## 9. Résultat de la Nouvelle Vérification Neon

**EN ATTENTE** — nécessite la génération de nouvelles prédictions après le déploiement de `bcc8331`.

---

## 10. Interdictions Respects

| Interdiction | Status |
|-------------|--------|
| No coefficient changes | RESPECTED |
| No weight changes | RESPECTED |
| No prompt changes | RESPECTED |
| No model changes | RESPECTED |
| No Poisson formula changes | RESPECTED |
| No backfill of 429 old predictions | RESPECTED |
| No calibration changes | RESPECTED |

---

## 11. SCIENTIFIC_COLLECTION Status

```
SCIENTIFIC_COLLECTION = NOT READY
```

**Raison** : Le fix est déployé mais pas encore vérifié dans Neon avec de nouvelles données réelles.

**Condition pour READY** : Après avoir généré ≥ 3 nouvelles prédictions et vérifié dans Neon que :
- `with_feature_snapshot > 0`
- `with_ai_context_hash > 0`
- `with_ai_input_hash > 0`
- `with_ai_prompt_hash > 0`
- `with_ai_trace > 0`

Alors :

```
SCIENTIFIC_COLLECTION = READY
```

---

## CODE VERIFIED vs PRODUCTION VERIFIED

| Aspect | Status |
|--------|--------|
| CODE VERIFIED | ✅ Le code câble correctement les 23 colonnes + le flux PATCH |
| PRODUCTION VERIFIED | ❌ En attente de vérification Neon avec nouvelles données réelles |
