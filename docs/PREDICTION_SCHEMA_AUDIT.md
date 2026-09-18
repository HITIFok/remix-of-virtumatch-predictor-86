# PREDICTION SCHEMA AUDIT — Phase 3

Date: 2026-09-18  
Scope: `predictions` table schema, data storage, feature traceability gaps

---

## 1. TABLE `predictions` — COMPLETE COLUMN INVENTORY

| # | Column | Type | Nullable | Default | Source | Stored at prediction time |
|---|--------|------|----------|---------|--------|--------------------------|
| 1 | id | UUID | NO | gen_random_uuid() | Server | Auto |
| 2 | match_id | BIGINT | YES | — | Client | YES |
| 3 | home_team | TEXT | NO | — | Client | YES |
| 4 | away_team | TEXT | NO | — | Client | YES |
| 5 | home | TEXT | YES | — | Client | YES (alternate name) |
| 6 | away | TEXT | YES | — | Client | YES (alternate name) |
| 7 | league | TEXT | YES | 'Instant League' | Client | YES |
| 8 | league_id | TEXT | YES | — | Client | YES |
| 9 | round | INTEGER | YES | — | Client | YES |
| 10 | odd_home | DECIMAL(6,2) | YES | — | Client | YES |
| 11 | odd_draw | DECIMAL(6,2) | YES | — | Client | YES |
| 12 | odd_away | DECIMAL(6,2) | YES | — | Client | YES |
| 13 | prob_home | DECIMAL(5,2) | YES | — | Engine output | YES |
| 14 | prob_draw | DECIMAL(5,2) | YES | — | Engine output | YES |
| 15 | prob_away | DECIMAL(5,2) | YES | — | Engine output | YES |
| 16 | prediction | TEXT | NO | — | Engine output | YES |
| 17 | confidence | DECIMAL(5,2) | NO | — | Engine output | YES |
| 18 | predicted_home_score | INTEGER | YES | — | Engine output | YES |
| 19 | predicted_away_score | INTEGER | YES | — | Engine output | YES |
| 20 | predicted_score | TEXT | YES | — | Engine output | YES |
| 21 | winner_1x2 | TEXT | YES | — | Engine output | YES |
| 22 | score_home | INTEGER | YES | — | Engine output | YES |
| 23 | score_away | INTEGER | YES | — | Engine output | YES |
| 24 | exact_score | TEXT | YES | — | Engine output | YES |
| 25 | gg_result | TEXT | YES | — | Engine output | YES |
| 26 | total_goals | INTEGER | YES | — | Engine output | YES |
| 27 | parity | TEXT | YES | — | Engine output | YES |
| 28 | over_under_15 | TEXT | YES | — | Engine output | YES |
| 29 | over_under_25 | TEXT | YES | — | Engine output | YES |
| 30 | over_under_35 | TEXT | YES | — | Engine output | YES |
| 31 | prob_gg | DECIMAL(5,2) | YES | — | Engine output | YES |
| 32 | prob_gn | DECIMAL(5,2) | YES | — | Engine output | YES |
| 33 | btts_prob | DECIMAL(5,2) | YES | — | Engine output | YES |
| 34 | over25_prob | DECIMAL(5,2) | YES | — | Engine output | YES |
| 35 | first_half_goal_prob | DECIMAL(5,2) | YES | — | Engine output | YES |
| 36 | expected_goals | DECIMAL(5,2) | YES | — | Engine output | YES |
| 37 | actual_home_score | INTEGER | YES | — | Verification | NO (filled later) |
| 38 | actual_away_score | INTEGER | YES | — | Verification | NO (filled later) |
| 39 | actual_outcome | TEXT | YES | — | Verification | NO (filled later) |
| 40 | actual_score | TEXT | YES | — | Verification | NO (filled later) |
| 41 | status | TEXT | NO | 'pending' | System | YES |
| 42 | verified_at | TIMESTAMPTZ | YES | — | Verification | NO (filled later) |
| 43 | device_id | TEXT | YES | — | Client | YES |
| 44 | user_id | TEXT | YES | — | Server (auth) | YES |
| 45 | created_at | TIMESTAMPTZ | NO | NOW() | System | YES |

**Total: 45 columns**

---

## 2. INDEXES

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| idx_predictions_status | status | B-tree | Filter by status |
| idx_predictions_created | created_at DESC | B-tree | Chronological ordering |
| idx_predictions_match | match_id | B-tree | Match lookups |
| idx_predictions_unique_match_day | match_id, created_at::date | Unique (partial) | Dedup |
| idx_predictions_user_id | user_id | B-tree | User query |
| idx_predictions_user_status | user_id, status | B-tree | User+status query |

---

## 3. CRITICAL GAPS — FEATURES NOT STORED

### 3.1 Input Features (NOT persisted)

| Feature | Used by engine? | Stored in predictions? | Impact |
|---------|-----------------|------------------------|--------|
| teamStats (Map<string, TeamStats>) | YES (Step 4) | **NO** | Cannot reconstruct stats-based lambda adjustments |
| historicalResults (HistoricalResult[]) | YES (Steps 3, 5) | **NO** | Cannot reconstruct form, momentum, H2H |
| aiPrediction (AIPrediction) | YES (Step 7) | **NO** | Cannot reconstruct AI blend |
| newSeasonMode (boolean) | YES (Step 2) | **NO** | Cannot reconstruct new season boost |

### 3.2 Intermediate Values (NOT persisted)

| Value | Computed by engine? | Stored? | Impact |
|-------|---------------------|---------|--------|
| lambdaHome (before adjustments) | YES (Step 2) | **NO** | Only final lambdaHome stored in MatchResult |
| lambdaAway (before adjustments) | YES (Step 2) | **NO** | Only final lambdaAway stored in MatchResult |
| homeForm (formScores, avgScored, avgConceded, momentumScore) | YES (Step 3) | **NO** | Cannot reproduce form-based adjustment |
| awayForm | YES (Step 3) | **NO** | Same |
| h2h (totalMatches, homeWins, draws, awayWins, homeTeamBias) | YES (Step 3b) | **NO** | Cannot reproduce H2H adjustment |
| formAgreement | YES (Step 5) | **NO** | Affects confidence |
| h2hAgreement | YES (Step 5) | **NO** | Affects confidence |
| aiAgreement | YES (Step 7) | **NO** | Affects confidence |
| antiTrapAlerts | YES (Step 10) | **NO** | Affects confidence and situation |
| scoreMatrix (7x7) | YES (Step 6) | **NO** | Only top-5 stored in MatchResult |

### 3.3 Model/Config Versioning (NOT stored)

| Item | Exists? | Stored per prediction? |
|------|---------|----------------------|
| model_version | **NO** | **NO** |
| config_version | **NO** | **NO** |
| feature_version | **NO** | **NO** |
| calibration_version | **NO** | **NO** |
| dataset_version | **NO** | **NO** |
| coefficient hash | **NO** | **NO** |

---

## 4. ARCHITECTURAL OBSERVATIONS

### 4.1 Client-Side Prediction Computation

The prediction is computed entirely on the client side by `prediction-engine.ts`, then sent as a completed result to the API via POST `/api/predictions`. The server does NOT re-run the engine — it only validates and stores.

**Implication:** The server has no visibility into which features were available or used. It only sees the final output.

### 4.2 No Feature Snapshot

There is no `feature_snapshot` column (JSONB or otherwise) in the predictions table. This means:
- Historical predictions cannot be reproduced
- Feature provenance is impossible to verify
- Data leakage cannot be detected post-hoc
- Backtest validity is limited to odds-only features

### 4.3 Scraped Data is Ephemeral

The `scraped_data` table uses UPSERT — only the latest snapshot of ranking, results, and matches is retained. Historical ranking positions and form data at prediction time are lost.

**Implication:** Even if we wanted to reconstruct features for old predictions, the source data is gone.

### 4.4 No Immutability Guarantee

Nothing prevents a prediction's context from changing:
- Ranking changes → different stats → different lambda adjustments
- New match results → different form → different momentum
- Coefficient changes → different output for same input
- AI model changes → different AI blend

---

## 5. FEATURE SAFETY CLASSIFICATION (CURRENT STATE)

Based on what is currently stored vs. what the engine uses:

| Feature Family | Currently Stored? | Reconstructible? | Safety Status |
|----------------|-------------------|------------------|---------------|
| Odds (odd_home/draw/away) | YES | YES (trivially) | **SAFE** |
| Probabilities (prob_home/draw/away) | YES | YES (from odds) | **SAFE** |
| Prediction + Confidence | YES | YES (stored) | **SAFE** |
| Predicted Score | YES | YES (stored) | **SAFE** |
| Form (formScores, avgScored, avgConceded) | NO | NO (scraped_data upserted) | **UNKNOWN** |
| Momentum (momentumScore) | NO | No (derived from form, form unknown) | **UNKNOWN** |
| H2H (homeWins, draws, awayWins, homeTeamBias) | NO | No (scraped_data upserted) | **UNKNOWN** |
| Stats (position, attackStrength, defenseWeakness) | NO | No (scraped_data upserted) | **UNKNOWN** |
| Ranking Diff | NO | No (scraped_data upserted) | **UNKNOWN** |
| AI Prediction (Groq output) | NO | No (ephemeral API call) | **UNKNOWN** |
| AI Agreement | NO | No (depends on AI output) | **UNKNOWN** |
| Anti-trap Alerts | NO | No (depends on form+stats+H2H+AI) | **UNKNOWN** |
| Lambda values (intermediate) | Partial (final only) | No | **UNKNOWN** |
| Score Matrix | Partial (top-5 only) | No | **UNKNOWN** |

**Summary: 4 SAFE, 10 UNKNOWN, 0 UNSAFE (proven), 0 RECORDED (non-odds)**

---

## 6. CONSTRAINTS

| Constraint | Type | Definition |
|------------|------|------------|
| predictions_match_id_created_at_key | UNIQUE (partial) | (match_id, created_at::date) WHERE match_id IS NOT NULL |
| RLS | Policy | Public read/insert/update |

---

## 7. RELATIONS

| Table | Relation | Notes |
|-------|----------|-------|
| prediction_stats | Aggregate | Daily stats computed from predictions |
| scraped_data | Source (ephemeral) | Matches, results, ranking — upserted, no history |
| device_secrets | Auth | device_id FK-like (no formal FK) |
| user_accounts | Auth | user_id FK-like (no formal FK) |

---

## 8. DATA SIZE ESTIMATE

| Component | Estimate |
|-----------|----------|
| Average row size (no feature_snapshot) | ~500 bytes |
| Average row size (with feature_snapshot ~2KB JSONB) | ~2.5 KB |
| 1000 predictions without snapshot | ~0.5 MB |
| 1000 predictions with snapshot | ~2.5 MB |
| Indexes | ~200 KB per 1000 rows |
| JSONB GIN index on feature_snapshot | ~300 KB per 1000 rows |

---

## 9. RECOMMENDATIONS

1. **Add `feature_snapshot` JSONB column** — nullable for retrocompatibility, populated for new predictions
2. **Add `model_version` TEXT column** — immutable per prediction
3. **Add `feature_snapshot_hash` TEXT column** — SHA-256 of canonical snapshot JSON for reproducibility verification
4. **Add `prediction_hash` TEXT column** — SHA-256 of final prediction output
5. **Add GIN index on `feature_snapshot`** — for JSON queries
6. **Preserve scraped_data history** — add temporal snapshots or a separate `scraped_data_history` table
7. **Do NOT backfill** — old predictions remain feature_snapshot=NULL (UNKNOWN status)

---

## VERDICT

**The predictions table stores output, not input.** Without feature_snapshot, it is impossible to answer "what data was used to generate this prediction?" for any historical prediction. This makes the full model backtest scientifically unverifiable.

Only odds-based features are SAFE. All other feature families are UNKNOWN.
