# FEATURE PROVENANCE — Phase 3

Date: 2026-09-18

---

## 1. PROVENANCE MODEL

Each feature in the snapshot carries a provenance status indicating how its value was obtained and whether it can be trusted for scientific validation.

### Status Definitions

| Status | Color | Meaning | Trust Level |
|--------|-------|---------|-------------|
| RECORDED | Green | Captured at prediction time from live data | Full trust |
| RECONSTRUCTED | Yellow | Rebuilt from historical data using temporal functions | Conditional trust |
| UNKNOWN | Gray | Cannot verify — source data unavailable or lost | No trust |
| UNSAFE | Red | Uses data from after prediction timestamp (leakage) | Invalid |

### Trust Rules

1. RECORDED → can be used in any backtest
2. RECONSTRUCTED → can be used if reconstruction is verified (temporal integrity check passes)
3. UNKNOWN → cannot be used in validated backtest, can be used in exploratory analysis only
4. UNSAFE → must NEVER be used. If detected, the entire prediction is INVALID

---

## 2. PROVENANCE PER FEATURE FAMILY

### Odds (RECORDED for all predictions)

Odds are stored directly in the predictions table (odd_home, odd_draw, odd_away columns).

| Feature | Provenance | Reason |
|---------|-----------|--------|
| odd_home | RECORDED | Stored in DECIMAL(6,2) column |
| odd_draw | RECORDED | Stored in DECIMAL(6,2) column |
| odd_away | RECORDED | Stored in DECIMAL(6,2) column |
| implied_prob_home | RECORDED | Deterministically derived from odds |
| implied_prob_draw | RECORDED | Deterministically derived from odds |
| implied_prob_away | RECORDED | Deterministically derived from odds |
| favorite | RECORDED | Deterministically derived from odds |
| favorite_prob | RECORDED | Deterministically derived from odds |

**Verdict: SAFE — Full scientific validity for odds-based backtest**

### Form (UNKNOWN for legacy, RECORDED with snapshot)

Form is derived from `historicalResults` — the last 5 matches for each team.

| Feature | Legacy Provenance | With Snapshot | Reconstruction |
|---------|-------------------|---------------|----------------|
| formScores | UNKNOWN | RECORDED | CONDITIONAL (requires match history) |
| avgScored | UNKNOWN | RECORDED | CONDITIONAL |
| avgConceded | UNKNOWN | RECORDED | CONDITIONAL |
| momentumScore | UNKNOWN | RECORDED | CONDITIONAL (derived from form) |
| goalsBalance | UNKNOWN | RECORDED | CONDITIONAL |

**Reconstruction method**: `getFormAtTimestamp(team, predictionTimestamp)` — filters historical results to only include matches BEFORE the prediction time.

**Key risk**: The `scraped_data` table is UPSERTed (only latest snapshot), so historical match data may be lost. If match history is preserved in a separate table or external source, reconstruction is possible.

### H2H (UNKNOWN for legacy, RECORDED with snapshot)

Head-to-head data is derived from `historicalResults` — direct matches between the two teams.

| Feature | Legacy Provenance | With Snapshot | Reconstruction |
|---------|-------------------|---------------|----------------|
| totalMatches | UNKNOWN | RECORDED | CONDITIONAL |
| homeWins | UNKNOWN | RECORDED | CONDITIONAL |
| draws | UNKNOWN | RECORDED | CONDITIONAL |
| awayWins | UNKNOWN | RECORDED | CONDITIONAL |
| homeTeamBias | UNKNOWN | RECORDED | CONDITIONAL |

**Reconstruction method**: `getH2HAtTimestamp(results, home, away, predictionTimestamp)` — same temporal filter as form.

### Stats/Ranking (UNKNOWN for legacy, RECORDED with snapshot)

Team statistics come from the ranking table (position, played, won, drawn, lost, goalsFor, goalsAgainst, points).

| Feature | Legacy Provenance | With Snapshot | Reconstruction |
|---------|-------------------|---------------|----------------|
| position | UNKNOWN | RECORDED | CONDITIONAL (requires ranking history) |
| attackStrength | UNKNOWN | RECORDED | CONDITIONAL (derived from position) |
| defenseWeakness | UNKNOWN | RECORDED | CONDITIONAL |

**Key risk**: Ranking is scraped and upserted. Historical ranking at prediction time is lost unless preserved separately.

### AI (UNKNOWN for legacy, RECORDED with snapshot)

AI prediction comes from the Groq API call at prediction time.

| Feature | Legacy Provenance | With Snapshot | Reconstruction |
|---------|-------------------|---------------|----------------|
| ai_score_home | UNKNOWN | RECORDED | NOT RECONSTRUCTIBLE |
| ai_score_away | UNKNOWN | RECORDED | NOT RECONSTRUCTIBLE |
| ai_confidence | UNKNOWN | RECORDED | NOT RECONSTRUCTIBLE |
| ai_agreement | UNKNOWN | RECORDED | NOT RECONSTRUCTIBLE |
| ai_weight | UNKNOWN | RECORDED | YES (from config) |

**Key risk**: AI responses are ephemeral. The Groq API call is not reproducible — the model may produce different responses for the same input. Even with input_hash and response_hash, the AI response cannot be reconstructed. This is a fundamental limitation.

### Anti-trap (UNKNOWN for legacy, RECORDED with snapshot)

Anti-trap detection depends on form + stats + H2H + AI — all of which are UNKNOWN for legacy predictions.

| Feature | Legacy Provenance | With Snapshot |
|---------|-------------------|---------------|
| isTrueTrap | UNKNOWN | RECORDED |
| isAntiTrap | UNKNOWN | RECORDED |
| antiTrapAlerts | UNKNOWN | RECORDED |
| Individual signals (5) | UNKNOWN | RECORDED |

### Coefficients (UNKNOWN for legacy, RECORDED with snapshot)

The 34 coefficients from prediction-config.ts.

| Feature | Legacy Provenance | With Snapshot |
|---------|-------------------|---------------|
| All 34 values | UNKNOWN | RECORDED (in coefficients.values) |
| coefficient_hash | UNKNOWN | RECORDED |

---

## 3. PROVENANCE CHAIN

For a given prediction, the provenance follows this chain:

```
Prediction created
  ├─ feature_snapshot captured?
  │   ├─ YES → each feature: RECORDED
  │   └─ NO  → each feature: 
  │       ├─ Odds stored in DB? → RECORDED (odds only)
  │       └─ Not stored? → UNKNOWN
  │
  ├─ Temporal validation (source_timestamp <= prediction_timestamp)?
  │   ├─ YES → provenance unchanged
  │   └─ NO  → provenance = UNSAFE
  │
  └─ Reconstruction possible?
      ├─ YES → provenance = RECONSTRUCTED (if legacy)
      └─ NO  → provenance = UNKNOWN
```

---

## 4. IDEAL PROVENANCE RECORD

For maximum traceability, each feature should record:

```typescript
{
  source: string;          // "scraped", "historical_results", "ranking", "groq_api", "config"
  source_record_id: string; // ID of the source record
  source_timestamp: string; // When the source data was captured
  calculation_timestamp: string; // When the feature was computed
  calculation_version: string;  // Version of the computation logic
}
```

Currently implemented: `source`, `source_timestamp`, `provenance`  
Not yet implemented: `source_record_id`, `calculation_timestamp`, `calculation_version`

---

## 5. CURRENT STATE SUMMARY

| Feature Family | Legacy Status | With Snapshot | Can Reconstruct | Backtest A | Backtest B |
|----------------|---------------|---------------|-----------------|------------|------------|
| Odds | RECORDED | RECORDED | YES (trivially) | ✓ | ✓ |
| Form | UNKNOWN | RECORDED | CONDITIONAL | ✗ | ✓ |
| H2H | UNKNOWN | RECORDED | CONDITIONAL | ✗ | ✓ |
| Stats | UNKNOWN | RECORDED | CONDITIONAL | ✗ | ✓ |
| AI | UNKNOWN | RECORDED | NO | ✗ | ✓ |
| Anti-trap | UNKNOWN | RECORDED | NO (depends on all) | ✗ | ✓ |
| Coefficients | UNKNOWN | RECORDED | YES (from config) | ✗ | ✓ |
| Derived | UNKNOWN | RECORDED | NO | ✗ | ✓ |

**Backtest A** (Odds-validated): Scientifically valid. Uses only RECORDED + SAFE features.  
**Backtest B** (Full model): Valid only when feature_snapshot exists for all predictions.

---

## 6. RECOMMENDATION

To achieve full provenance (all features RECORDED), every new prediction must:
1. Capture the feature_snapshot at prediction time
2. Store it in the predictions table (feature_snapshot JSONB column)
3. Compute and store feature_snapshot_hash and prediction_hash
4. Record all version strings (model_version, config_version, etc.)

Legacy predictions will remain with UNKNOWN provenance for non-odds features. This is honest and correct — we cannot retroactively prove what data was used.
