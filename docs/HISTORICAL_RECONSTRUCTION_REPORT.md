# HISTORICAL RECONSTRUCTION REPORT — Phase 3

Date: 2026-09-18

---

## 1. RECONSTRUCTION CAPABILITY

Historical reconstruction allows rebuilding the features that were available to the prediction engine at a specific point in time, using temporal filtering to exclude future data.

---

## 2. RECONSTRUCTION FUNCTIONS

### `getFormAtTimestamp(results, team, predictionTimestamp)`

**Purpose**: Reconstruct team form as it was at prediction time.

**Algorithm**:
1. Filter `results` to only include matches with `timestamp < predictionTimestamp`
2. Sort by date descending (most recent first)
3. Take the last 5 matches for the team
4. Compute formScores, avgScored, avgConceded, momentumScore using the same formula as `prediction-engine.ts`

**Provenance**: RECONSTRUCTED (if matches found), UNKNOWN (if no matches before prediction time)

**Limitations**:
- Requires match results to have timestamps. If `date` field is missing and `timestamp` is 0, the match is excluded.
- Match results must be preserved historically. The `scraped_data` table is UPSERTed (only latest), so older results may be lost.
- Team name matching is case-insensitive but fuzzy (partial match). Different scraper name variants may cause mismatches.

### `getH2HAtTimestamp(results, home, away, predictionTimestamp)`

**Purpose**: Reconstruct head-to-head data as it was at prediction time.

**Algorithm**:
1. Filter `results` to only include matches with `timestamp < predictionTimestamp`
2. Find all direct matches between home and away teams
3. Compute homeWins, draws, awayWins, avgGoals, homeTeamBias

**Provenance**: RECONSTRUCTED (if H2H matches found)

### `getStatsAtTimestamp(rankings, team, predictionTimestamp)`

**Purpose**: Reconstruct team stats/ranking as it was at prediction time.

**Algorithm**:
1. Filter `rankings` to only include entries with `timestamp < predictionTimestamp`
2. Sort by date descending
3. Use the most recent ranking entry for the team

**Provenance**: RECONSTRUCTED (if ranking found before prediction time), UNKNOWN (if no ranking)

**Key limitation**: Rankings are scraped and upserted. Unless ranking snapshots are stored with timestamps, reconstruction is impossible for historical predictions.

---

## 3. RECONSTRUCTION vs. CURRENT FORM

| Aspect | `extractTeamForm()` (engine) | `getFormAtTimestamp()` (reconstruction) |
|--------|------------------------------|----------------------------------------|
| Data source | All `historicalResults` passed in | Only results with `timestamp < predictionTimestamp` |
| Future data | May include if caller doesn't filter | NEVER includes (temporal filter) |
| Same formula | YES | YES (identical momentum calculation) |
| Provenance | Not tracked | RECONSTRUCTED |
| Purpose | Live prediction | Historical reconstruction |

**Critical difference**: The reconstruction function guarantees no future data leakage by applying a hard temporal filter. The engine function trusts the caller to provide correct data.

---

## 4. RECONSTRUCTION REQUIREMENTS

For full historical reconstruction, the following data must be preserved:

| Data | Storage | Currently Preserved? | Without it |
|------|---------|---------------------|------------|
| Match results with timestamps | scraped_data or separate table | PARTIALLY (upserted, no history) | Cannot reconstruct form/H2H |
| Ranking snapshots with timestamps | scraped_data or separate table | NO (upserted) | Cannot reconstruct stats |
| AI responses | Not stored | NO | Cannot reconstruct AI blend |
| Coefficient values at prediction time | prediction-config.ts | YES (version controlled) | Can reconstruct from Git history |

### Recommendations for data preservation

1. **Add `scraped_data_history` table** — Store timestamped snapshots of ranking and results
2. **Add timestamps to scraped_data** — Include a `valid_at` timestamp for each record
3. **Log AI responses** — Store Groq API responses (or at minimum, hashes) for reproducibility
4. **Version the dataset** — Tag each scraper run with a dataset_version

---

## 5. RECONSTRUCTION ACCURACY

Reconstruction accuracy depends on:

1. **Data completeness**: Are all historical matches before the prediction time available?
2. **Timestamp accuracy**: Do match/result timestamps accurately reflect when the match occurred?
3. **Team name consistency**: Are team names consistent between the prediction and the historical results?
4. **Formula fidelity**: Is the reconstruction formula identical to the engine's formula?

For form and H2H, the reconstruction uses the **exact same formulas** as the prediction engine (same weights, same momentum calculation, same bias formula). The only difference is the temporal filter.

For stats/ranking, the reconstruction may differ from the engine if the ranking at prediction time was different from the most recently scraped ranking. This is a fundamental limitation of the upsert architecture.

---

## 6. RECONSTRUCTION RESULTS (SYNTHETIC VALIDATION)

Using synthetic data with known timestamps:

| Test | Result |
|------|--------|
| Form reconstruction excludes future matches | PASS |
| H2H reconstruction excludes future matches | PASS |
| Stats reconstruction uses only pre-prediction ranking | PASS |
| Artificial leak test (form) — modify future match | PASS (no change) |
| Artificial leak test (H2H) — modify future H2H match | PASS (no change) |
| Temporal boundary — match exactly at prediction time | EXCLUDED (strict <) |

---

## 7. LIMITATIONS

1. **AI reconstruction is impossible** — Groq API responses are non-deterministic and ephemeral. Even with the same input, the model may produce different outputs at different times.

2. **Anti-trap reconstruction is partial** — Anti-trap signals depend on form + stats + H2H + AI. If any of these cannot be reconstructed, the anti-trap decision cannot be verified.

3. **Coefficient changes over time** — If coefficients were different at prediction time (before a config change), the reconstruction using current coefficients will produce different results. The coefficient_hash in the snapshot addresses this.

4. **Scraped data loss** — The UPSERT pattern in scraped_data means that historical ranking and results are overwritten. Without a separate history table, reconstruction for old predictions is impossible.

5. **Team name ambiguity** — The prediction engine uses case-insensitive and partial matching for team names. This can cause false positives (wrong team matched) or false negatives (team not found).

---

## 8. CONCLUSION

Historical reconstruction is **possible for form, H2H, and stats** when historical match data and ranking snapshots are preserved with timestamps. It is **impossible for AI** responses.

For legacy predictions without feature_snapshot, the reconstruction provides RECONSTRUCTED provenance (conditional trust). For new predictions with feature_snapshot, all features are RECORDED (full trust).

The reconstruction functions are the foundation for detecting data leakage: if modifying a future match changes the reconstructed features, that proves leakage in the non-temporal version.
