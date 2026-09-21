# FEATURE SNAPSHOT SCHEMA — Phase 3

Date: 2026-09-18  
Purpose: Define the complete feature inventory and snapshot structure for traceability

---

## 1. COMPLETE FEATURE INVENTORY

### Source: `prediction-engine.ts` — 13-Step Pipeline Analysis

| # | Feature | Source | Type | Timestamp Required | Stored Currently | Reconstructible | Safety Status |
|---|---------|--------|------|--------------------|-----------------|-----------------|---------------|
| 1 | odd_home | MatchInput | number | YES (odds timestamp) | YES (DECIMAL) | YES (trivially) | SAFE |
| 2 | odd_draw | MatchInput | number | YES | YES (DECIMAL) | YES | SAFE |
| 3 | odd_away | MatchInput | number | YES | YES (DECIMAL) | YES | SAFE |
| 4 | implied_prob_home | Derived from odds | number | Same as odds | YES (DECIMAL) | YES | SAFE |
| 5 | implied_prob_draw | Derived from odds | number | Same as odds | YES (DECIMAL) | YES | SAFE |
| 6 | implied_prob_away | Derived from odds | number | Same as odds | YES (DECIMAL) | YES | SAFE |
| 7 | favorite | Derived from odds | '1'\|'X'\|'2' | Same as odds | Partial (in winner_1x2) | YES | SAFE |
| 8 | favoriteProb | Derived from odds | number | Same as odds | NO | YES | SAFE |
| 9 | lambda_home_initial | Grid search output | number | Same as odds | NO | YES (if odds known) | SAFE |
| 10 | lambda_away_initial | Grid search output | number | Same as odds | NO | YES | SAFE |
| 11 | grid_search_error | Grid search output | number | Same as odds | NO | YES | SAFE |
| 12 | home_form_scores | historicalResults | string[] | YES (match dates) | NO | CONDITIONAL | UNKNOWN |
| 13 | home_avg_scored | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 14 | home_avg_conceded | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 15 | home_momentum_score | Derived from form | number | YES | NO | CONDITIONAL | UNKNOWN |
| 16 | home_goals_balance | Derived from form | number | YES | NO | CONDITIONAL | UNKNOWN |
| 17 | away_form_scores | historicalResults | string[] | YES | NO | CONDITIONAL | UNKNOWN |
| 18 | away_avg_scored | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 19 | away_avg_conceded | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 20 | away_momentum_score | Derived from form | number | YES | NO | CONDITIONAL | UNKNOWN |
| 21 | away_goals_balance | Derived from form | number | YES | NO | CONDITIONAL | UNKNOWN |
| 22 | h2h_total_matches | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 23 | h2h_home_wins | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 24 | h2h_draws | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 25 | h2h_away_wins | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 26 | h2h_avg_home_goals | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 27 | h2h_avg_away_goals | historicalResults | number | YES | NO | CONDITIONAL | UNKNOWN |
| 28 | h2h_home_team_bias | Derived from H2H | number | YES | NO | CONDITIONAL | UNKNOWN |
| 29 | home_position | teamStats (ranking) | number | YES (ranking date) | NO | CONDITIONAL | UNKNOWN |
| 30 | home_played | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 31 | home_won | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 32 | home_drawn | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 33 | home_lost | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 34 | home_goals_for | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 35 | home_goals_against | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 36 | home_points | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 37 | home_avg_goals_scored | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 38 | home_avg_goals_conceded | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 39 | home_attack_strength | Derived from stats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 40 | home_defense_weakness | Derived from stats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 41 | away_position | teamStats (ranking) | number | YES | NO | CONDITIONAL | UNKNOWN |
| 42 | away_played | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 43 | away_won | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 44 | away_drawn | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 45 | away_lost | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 46 | away_goals_for | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 47 | away_goals_against | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 48 | away_points | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 49 | away_avg_goals_scored | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 50 | away_avg_goals_conceded | teamStats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 51 | away_attack_strength | Derived from stats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 52 | away_defense_weakness | Derived from stats | number | YES | NO | CONDITIONAL | UNKNOWN |
| 53 | stats_has_data | Step 4 output | boolean | YES | NO | CONDITIONAL | UNKNOWN |
| 54 | lambda_home_after_stats | Step 4 output | number | YES | NO | NO (intermediate) | UNKNOWN |
| 55 | lambda_away_after_stats | Step 4 output | number | YES | NO | NO | UNKNOWN |
| 56 | form_agreement | Step 5 output | number (-1,0,1) | YES | NO | CONDITIONAL | UNKNOWN |
| 57 | h2h_agreement | Step 5 output | number (-1,0,1) | YES | NO | CONDITIONAL | UNKNOWN |
| 58 | lambda_home_after_history | Step 5 output | number | YES | NO | NO | UNKNOWN |
| 59 | lambda_away_after_history | Step 5 output | number | YES | NO | NO | UNKNOWN |
| 60 | ai_enabled | Step 7 input | boolean | YES | NO | NO | UNKNOWN |
| 61 | ai_model | External (Groq) | string | YES | NO | NO | UNKNOWN |
| 62 | ai_score_home | AIPrediction | number | YES | NO | NO | UNKNOWN |
| 63 | ai_score_away | AIPrediction | number | YES | NO | NO | UNKNOWN |
| 64 | ai_confidence | AIPrediction | number | YES | NO | NO | UNKNOWN |
| 65 | ai_is_anti_trap | AIPrediction | boolean | YES | NO | NO | UNKNOWN |
| 66 | ai_tendency | AIPrediction | string | YES | NO | NO | UNKNOWN |
| 67 | ai_danger_level | AIPrediction | string | YES | NO | NO | UNKNOWN |
| 68 | ai_agreement | Step 7 output | number (-1,1) | YES | NO | NO | UNKNOWN |
| 69 | is_true_trap | Step 9 output | boolean | YES | NO | NO | UNKNOWN |
| 70 | is_anti_trap | Step 9 output | boolean | YES | NO | NO | UNKNOWN |
| 71 | anti_trap_alerts_count | Step 10 output | number (0-5) | YES | NO | NO | UNKNOWN |
| 72 | anti_trap_alert_momentum | Step 10 sub-check | boolean | YES | NO | NO | UNKNOWN |
| 73 | anti_trap_alert_attack | Step 10 sub-check | boolean | YES | NO | NO | UNKNOWN |
| 74 | anti_trap_alert_h2h | Step 10 sub-check | boolean | YES | NO | NO | UNKNOWN |
| 75 | anti_trap_alert_ranking | Step 10 sub-check | boolean | YES | NO | NO | UNKNOWN |
| 76 | anti_trap_alert_ai | Step 10 sub-check | boolean | YES | NO | NO | UNKNOWN |
| 77 | is_false_trap | Step 10 output | boolean | YES | NO | NO | UNKNOWN |
| 78 | is_domination | Step 10 output | boolean | YES | NO | NO | UNKNOWN |
| 79 | new_season_mode | MatchInput | boolean | YES | NO | NO | UNKNOWN |
| 80 | score_matrix_top5 | Step 6/8 output | Array | YES | NO | NO | UNKNOWN |

**Total: 80 features identified**

---

## 2. FEATURE FAMILY CLASSIFICATION

| Family | Feature Count | Stored Currently | Can Reconstruct | Notes |
|--------|--------------|-----------------|-----------------|-------|
| **Odds** | 8 | YES | YES | Core input, always available |
| **Form** | 10 | NO | CONDITIONAL | Requires historical results before prediction time |
| **H2H** | 7 | NO | CONDITIONAL | Requires historical results between the two teams |
| **Stats/Ranking** | 22 | NO | CONDITIONAL | Requires ranking snapshot before prediction time |
| **AI** | 8 | NO | NO | Ephemeral Groq API call, cannot be reproduced |
| **Anti-trap** | 7 | NO | NO | Depends on form+stats+H2H+AI |
| **Derived/Lambda** | 12 | Partial (final only) | Partial | Intermediate values not stored |
| **Config/Model** | 6 | NO | NO | No versioning exists |

---

## 3. FEATURE SNAPSHOT JSON STRUCTURE

```json
{
  "schema_version": 1,
  "snapshot_timestamp": "2026-09-18T14:30:00.000Z",
  "prediction_timestamp": "2026-09-18T14:30:00.000Z",

  "model_version": "2.0.0",
  "feature_version": "1.0.0",
  "config_version": "1.0.0",
  "calibration_version": "0.0.0",
  "dataset_version": "2026-09-18-a",

  "odds": {
    "odd_home": 1.85,
    "odd_draw": 3.40,
    "odd_away": 4.20,
    "implied_prob_home": 0.482,
    "implied_prob_draw": 0.262,
    "implied_prob_away": 0.256,
    "favorite": "1",
    "favorite_prob": 0.482,
    "source": "scraped",
    "source_timestamp": "2026-09-18T14:00:00.000Z",
    "provenance": "RECORDED"
  },

  "form": {
    "home": {
      "form_scores": ["V", "N", "V", "D", "V"],
      "avg_scored": 1.4,
      "avg_conceded": 0.8,
      "momentum_score": 73,
      "goals_balance": 3,
      "source": "historical_results",
      "source_timestamp": "2026-09-17T00:00:00.000Z",
      "match_ids": [12345, 12340, 12335, 12330, 12325],
      "provenance": "RECORDED"
    },
    "away": {
      "form_scores": ["D", "V", "N", "V", "D"],
      "avg_scored": 1.1,
      "avg_conceded": 1.2,
      "momentum_score": 47,
      "goals_balance": -1,
      "source": "historical_results",
      "source_timestamp": "2026-09-17T00:00:00.000Z",
      "match_ids": [12346, 12341, 12336, 12331, 12326],
      "provenance": "RECORDED"
    }
  },

  "h2h": {
    "total_matches": 5,
    "home_wins": 3,
    "draws": 1,
    "away_wins": 1,
    "avg_home_goals": 1.6,
    "avg_away_goals": 0.8,
    "avg_total_goals": 2.4,
    "home_team_bias": 40,
    "source": "historical_results",
    "source_timestamp": "2026-09-17T00:00:00.000Z",
    "provenance": "RECORDED"
  },

  "stats": {
    "home": {
      "position": 3,
      "played": 10,
      "won": 6,
      "drawn": 2,
      "lost": 2,
      "goals_for": 15,
      "goals_against": 8,
      "points": 20,
      "avg_goals_scored": 1.5,
      "avg_goals_conceded": 0.8,
      "attack_strength": 1.154,
      "defense_weakness": 0.615,
      "source": "ranking",
      "source_timestamp": "2026-09-18T12:00:00.000Z",
      "provenance": "RECORDED"
    },
    "away": {
      "position": 8,
      "played": 10,
      "won": 3,
      "drawn": 3,
      "lost": 4,
      "goals_for": 11,
      "goals_against": 13,
      "points": 12,
      "avg_goals_scored": 1.1,
      "avg_goals_conceded": 1.3,
      "attack_strength": 0.846,
      "defense_weakness": 1.0,
      "source": "ranking",
      "source_timestamp": "2026-09-18T12:00:00.000Z",
      "provenance": "RECORDED"
    },
    "has_data": true
  },

  "ai": {
    "enabled": true,
    "model": "llama-3.3-70b-versatile",
    "score_home": 2,
    "score_away": 0,
    "confidence": 72,
    "is_anti_trap": false,
    "tendency": "Match standard",
    "danger_level": "safe",
    "weight_used": 0.35,
    "agreement": 1,
    "input_hash": "sha256:abc123...",
    "response_hash": "sha256:def456...",
    "source": "groq_api",
    "source_timestamp": "2026-09-18T14:30:01.000Z",
    "provenance": "RECORDED"
  },

  "anti_trap": {
    "triggered": false,
    "signals": {
      "momentum_trap": false,
      "attack_trap": false,
      "h2h_trap": false,
      "ranking_trap": false,
      "ai_disagreement": false
    },
    "alert_count": 0,
    "is_true_trap": false,
    "is_false_trap": false,
    "is_domination": false,
    "trap_version": "1.0.0",
    "provenance": "RECORDED"
  },

  "derived": {
    "lambda_home_initial": 1.55,
    "lambda_away_initial": 1.05,
    "lambda_home_after_stats": 1.62,
    "lambda_away_after_stats": 0.98,
    "lambda_home_after_history": 1.70,
    "lambda_away_after_history": 0.95,
    "lambda_home_final": 1.70,
    "lambda_away_final": 0.95,
    "form_agreement": 1,
    "h2h_agreement": 1,
    "ai_agreement": 1,
    "grid_search_error": 0.0003,
    "new_season_mode": false,
    "provenance": "RECORDED"
  },

  "coefficients": {
    "hash": "sha256:789abc...",
    "values": {
      "VIRTUAL_AVG_GOALS": 1.3,
      "AI_WEIGHT": 0.35,
      "STAT_BASE_WEIGHT": 0.70,
      "STAT_ATTACK_WEIGHT": 0.20,
      "STAT_DEF_WEIGHT": 0.10
    },
    "provenance": "RECORDED"
  }
}
```

---

## 4. PROVENANCE STATUS DEFINITIONS

| Status | Meaning | When to use |
|--------|---------|-------------|
| RECORDED | Feature was captured at prediction time from real data | New predictions with feature_snapshot |
| RECONSTRUCTED | Feature was rebuilt from historical data using temporal functions | Historical predictions where source data is available |
| UNKNOWN | Feature cannot be verified — source data unavailable | Historical predictions where scraped_data was upserted |
| UNSAFE | Feature uses data from after the prediction timestamp (leakage) | Must NEVER occur in production |

**Rule: UNKNOWN is the default. SAFE is only assigned when proven.**

---

## 5. TIMESTAMP RULES

### 5.1 Required Timestamps

| Timestamp | Source | Purpose |
|-----------|--------|---------|
| prediction_timestamp | System clock | When the prediction was generated |
| snapshot_timestamp | System clock | When the snapshot was captured (should match prediction_timestamp) |
| odds_timestamp | Scraper | When odds were fetched |
| ranking_timestamp | Scraper | When ranking was fetched |
| form_source_timestamp | Historical results | Latest match date used in form calculation |
| h2h_source_timestamp | Historical results | Latest H2H match date |
| ai_timestamp | Groq API | When AI response was received |

### 5.2 Temporal Validity Rule

A feature is valid for a prediction only if:

```
feature_source_timestamp <= prediction_timestamp
```

If the feature's source timestamp is AFTER the prediction timestamp, the feature is UNSAFE (data leakage).

### 5.3 Unknown Timestamp Rule

If a feature's timestamp cannot be determined:
- The feature's provenance is set to **UNKNOWN**
- It is NEVER marked SAFE
- The backtest treats it as unavailable for validated mode

---

## 6. VERSIONING

### 6.1 Version Definitions

| Version | Source | Increment when |
|---------|--------|----------------|
| model_version | prediction-engine.ts | Mathematical logic changes |
| feature_version | feature-snapshot.ts | Snapshot schema changes |
| config_version | prediction-config.ts | Coefficient values change |
| calibration_version | calibration system | Calibration parameters change |
| dataset_version | scraper | Training/evaluation dataset changes |

### 6.2 Current Versions

| Version | Value |
|---------|-------|
| model_version | "2.0.0" |
| feature_version | "1.0.0" |
| config_version | "1.0.0" |
| calibration_version | "0.0.0" |
| dataset_version | "unversioned" |

---

## 7. HASH DEFINITIONS

### 7.1 feature_snapshot_hash

SHA-256 of the canonical JSON serialization of the feature_snapshot (excluding the hash itself).

Canonical form:
1. Remove `feature_snapshot_hash` and `prediction_hash` fields
2. Sort all keys alphabetically at every level
3. No whitespace (minified JSON)
4. UTF-8 encoding

### 7.2 prediction_hash

SHA-256 of the canonical JSON serialization of the prediction output (prob_home, prob_draw, prob_away, prediction, confidence, exact_score, lambda_home, lambda_away).

### 7.3 Reproducibility Equation

```
same feature_snapshot_hash
+ same model_version
+ same config_version
= same prediction_hash
```

If this equation does not hold, the prediction is NON-REPRODUCIBLE.
