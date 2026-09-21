# AI TRACEABILITY REPORT — Phase 5.1

Generated: 2026-09-21
Commit: be7bdff

---

## 1. AI Pipeline

```
FRONTEND                                     BACKEND
┌──────────────────────────┐                ┌──────────────────────────────────────┐
│ User selects match       │                │ Auth + Rate limit                    │
│ enrichMatchesForAI()     │  ─── POST ──> │ buildUserPrompt(matches)             │
│   ranking, form, H2H     │    /api/       │ callGroqSingle(apiKey, model, prompt)│
│                          │  analyze-match │   → api.groq.com/openai/v1/...       │
│ analyzeMatch(input, ai)  │  <── JSON ─── │ parsePredictions(response)           │
│   blendWithAI() 35%      │                │   or mathPredict() fallback          │
└──────────────────────────┘                └──────────────────────────────────────┘
```

## 2. Provider

| Setting | Value |
|---------|-------|
| Provider | Groq (OpenAI-compatible API) |
| Endpoint | `https://api.groq.com/openai/v1/chat/completions` |
| API Key | `GROQ_API_KEY` (env var) |
| Model | `llama-3.3-70b-versatile` (override via `GROQ_MODEL`) |
| Temperature | 0.3 |
| Max Tokens | 4096 |
| Response Format | JSON object |
| Deadline | 2500ms |
| Rate Limit | 10 req/min |

## 3. Model

`llama-3.3-70b-versatile` — Meta's Llama 3.3 70B parameter model, hosted on Groq's inference platform.

## 4. Prompt Versioning

| Version | Location | Hash |
|---------|----------|------|
| v7.0 | `api/analyze-match.js` lines 15-45 | Computed via `computeSystemPromptHash()` |
| v7.0 (duplicate) | `supabase/functions/analyze-match/index.ts` | Same hash (identical content) |

### System Prompt Structure (v7.0)

- **Persona**: ANALYSTE FOOTBALL VIRTUEL
- **Rules**: Virtual football scoring distribution (80% are 0-0,1-0,1-1,2-0,2-1)
- **Analysis**: 9-step multicriteria process (odds→P(1X2), attack, defense, momentum, H2H, balance, ranking, synthesis, anti-trap, score)
- **Anti-trap**: 5 alert criteria with scoring rules
- **Confidence**: Formula with boosts/penalties, ceiling 0.82, floor 0.25
- **Output**: Strict JSON format (no markdown)

### Hash Tracking

| Hash | Purpose |
|------|---------|
| `ai_system_prompt_hash` | SHA-256 of system prompt — identifies prompt version |
| `ai_user_prompt_hash` | SHA-256 of user prompt — identifies exact match data sent |
| `ai_prompt_hash` | SHA-256 of (system + user) — full prompt fingerprint |
| `ai_input_hash` | SHA-256 of all inputs — cryptographic proof of what AI received |

## 5. Input Provenance

### Data Injected into AI User Prompt

| Input | Source | Injected? | Format | Double Counting Risk |
|-------|--------|-----------|--------|---------------------|
| Odds (Home/Draw/Away) | Bookmaker/scraper | **YES** | `1.85/3.40/4.20` + implied P(1X2) | **HIGH**: Also used for Poisson base lambda |
| Standings Home | Ranking table | **YES** | `#3 15j 9V3N3D 24-12 30p att:1.6 def:0.8` | **MODERATE**: Also used for stats adjustment |
| Standings Away | Ranking table | **YES** | Same format | **MODERATE**: Same |
| Form Home (5 matches) | Historical matches | **YES** | `FH:V1-0 N1-1 V2-0 D0-1 V1-0` | **HIGH**: Also used for lambda adjustment |
| Form Away (5 matches) | Historical matches | **YES** | Same format | **HIGH**: Same |
| H2H (all matches) | Historical matches | **YES** | `H2H:3V1N1D avg:2.0bm` | **MODERATE**: Also used for H2H adjustment |
| Momentum | Derived from form | **NO** (AI computes from form) | N/A | **HIGH**: AI + explicit form = double path |
| Lambda values | Internal math | **NO** | N/A | None |
| Actual results | Post-match | **NO** | N/A | None (correctly excluded) |

### Input Audit Table

Each input to the AI is tracked with:

| Field | Description |
|-------|-------------|
| `name` | Input identifier (e.g., "odds_home", "form_home") |
| `value` | Actual value sent |
| `source` | Where the data came from |
| `source_timestamp` | When the data was available (ISO 8601 UTC) |
| `version` | Data version |
| `provenance` | RECORDED / RECONSTRUCTED / UNKNOWN / UNSAFE |

## 6. Timestamps

### Six Temporal Events

```
T_start          ─── Pipeline begins (user request received)
T_features       ─── All feature source data collected
T_AI_request     ─── AI API call initiated (null if no AI)
T_AI_response    ─── AI API response received (null if no AI)
T_prediction_final ─── Prediction officially available to user
T_snapshot       ─── Feature snapshot recorded to DB
```

### Invariants

```
T_start ≤ T_features
T_features ≤ T_AI_request (if AI used)
T_AI_request ≤ T_AI_response (if AI used)
T_AI_response ≤ T_prediction_final (if AI used)
T_prediction_final ≤ T_snapshot
All inputs' source_timestamp ≤ T_prediction_final
```

### Official Definition of T_prediction

**T_prediction = T_prediction_final**

This is the moment when the prediction becomes officially available to the user/system. It corresponds to the completion of the entire pipeline, including AI response.

We do NOT use:
- DB `created_at` (may differ due to network latency)
- `snapshot_timestamp` (is T_snapshot, which is ≥ T_prediction)
- AI response timestamp (is only one step in the pipeline)

## 7. Hashes

| Hash | Algorithm | Scope | Deterministic |
|------|-----------|-------|---------------|
| `ai_system_prompt_hash` | SHA-256 | System prompt text | Yes |
| `ai_user_prompt_hash` | SHA-256 | User prompt text | Yes |
| `ai_prompt_hash` | SHA-256 | System + User combined | Yes |
| `ai_input_hash` | SHA-256 | All input fields + timestamps | Yes |
| `ai_response_hash` | SHA-256 | Full AI response text | Yes |

### Properties Verified

- Same inputs → same hash ✓
- Different value → different hash ✓
- Different source_timestamp → different hash ✓
- Different prompt → different hash ✓

## 8. Leakage Tests

| Test | Description | Result |
|------|-------------|--------|
| AI Leakage Test | Adding future data to AI inputs changes hash → detected | ✓ PASS (correctly detects change) |
| AI No-Leakage Test | Same inputs produce same hash | ✓ PASS |
| Temporal Reconstruction | Form/H2H/Stats filtered by predictionTimestamp | ✓ PASS (existing Phase 3 tests) |

## 9. AI Immutability

| Field | Immutable? | Enforcement |
|-------|-----------|-------------|
| AI_PROVIDER | Yes | Code-level (constant) |
| AI_MODEL | Yes | Code-level (env var, read-only at prediction time) |
| AI_PROMPT_VERSION | Yes | Code-level (constant '7.0') |
| AI_PROMPT_HASH | Yes | DB trigger (007) — feature_snapshot_hash immutable |
| AI_INPUT_HASH | Yes | DB trigger (007) — part of feature_snapshot |
| AI_RESPONSE_HASH | Yes | DB trigger (007) — part of feature_snapshot |
| AI timestamps | Yes | DB trigger (007) — t_prediction/t_feature immutable |

### What is Stored

| Data | Stored? | Reason |
|------|---------|--------|
| AI provider | Yes | Traceability |
| AI model | Yes | Reproducibility |
| AI prompt version | Yes | Version tracking |
| AI prompt hash | Yes | Integrity verification |
| AI input hash | Yes | Cryptographic proof of what AI received |
| AI response hash | Yes | Integrity verification |
| AI request timestamp | Yes | Temporal ordering |
| AI response timestamp | Yes | Temporal ordering |
| AI prediction used | Yes | What part of response was used |
| Full AI response | **NO** | Cost and privacy (hash is sufficient for verification) |
| GROQ_API_KEY | **NO** | Secret — never stored in snapshots |

## 10. AI Provenance Classification

| Condition | Classification |
|-----------|---------------|
| All inputs have source_timestamp ≤ T_prediction | RECORDED |
| Inputs reconstructed from historical data | RECONSTRUCTED |
| Some inputs lack source_timestamp | UNKNOWN |
| Any input has source_timestamp > T_prediction | UNSAFE |

### Critical Rule

If AI provenance is UNKNOWN or UNSAFE:
- AI_PROVENANCE = PARTIAL (not RECORDED)
- The prediction CANNOT be used for full-model backtest (Backtest B)
- It CAN be used for odds-only backtest (Backtest A)

## 11. Double Counting Risks

### Risk 1: AI ↔ Odds (HIGH)

The AI prompt **includes odds** (line 54 of `buildUserPrompt()`):
```
M1: TeamA vs TeamB | 1.85/3.40/4.20 | P:56/22/22
```

The mathematical model also derives base lambdas from odds via grid search.
When `blendWithAI()` applies `AI_WEIGHT=0.35`, the odds signal is potentially **double-counted**.

**Status**: Risk identified, measurement infrastructure created, NOT yet measured on real data.

### Risk 2: AI ↔ Form (HIGH)

The AI prompt **includes form data** (lines 65-69):
```
FH:V1-0 D0-2 N1-1 V2-0 V1-0
FA:D0-1 D1-2 N0-0 D0-1 V1-0
```

The mathematical model also adjusts lambdas using form.
When `blendWithAI()` applies `AI_WEIGHT=0.35`, the form signal is potentially **double-counted**.

**Status**: Same as above.

### Risk 3: AI ↔ Standings (MODERATE)

The AI prompt **includes standings/ranking** (lines 56-63):
```
H:#3 15j 9V3N3D 24-12 30p att:1.6 def:0.8
A:#12 15j 3V3N9D 12-24 12p att:0.8 def:1.6
```

The mathematical model also uses stats for lambda adjustment.
Double counting risk is moderate because the formats differ.

## 12. Limitations

1. **Full AI response not stored** — Only hash is stored. To fully verify AI behavior, one would need to re-run the same prompt with the same model and compare responses.

2. **AI prompt content audit is manual** — While we hash the prompt, verifying that it does NOT contain future data requires either:
   - Manual audit of each prompt version
   - Or temporal provenance of every input field (which we now have)

3. **AI model may change server-side** — Groq may update `llama-3.3-70b-versatile` without notice. The `ai_model` field captures what we requested, not what actually ran.

4. **AI non-determinism** — Temperature=0.3 means the same prompt may produce different responses. The `ai_response_hash` captures what we actually received.

5. **Three duplicate implementations** — The AI call logic exists in `api/analyze-match.js`, `supabase/functions/analyze-match/index.ts`, and `legacy/`. Only the API version is production.

6. **Predetermined score path** — LiveMatches.tsx can create fake AIPrediction objects with `confidence: 0.95` from predetermined scores. These bypass the AI entirely and should be flagged separately.

## 13. Exit Criteria Assessment

> "Voici exactement ce que l'AI a reçu pour cette prédiction, voici quand chaque donnée était disponible, voici la version du prompt, voici le modèle utilisé et voici la preuve cryptographique de l'ensemble."

**Answer**: For new predictions with the traceability system active:

- ✅ What the AI received: `ai_inputs` + `ai_input_hash`
- ✅ When each datum was available: `source_timestamp` per input field
- ✅ Prompt version: `ai_prompt_version` (7.0) + `ai_system_prompt_hash`
- ✅ Model used: `ai_model` (llama-3.3-70b-versatile)
- ✅ Cryptographic proof: `ai_input_hash` (SHA-256 of all inputs)

**However**: If any input lacks `source_timestamp`, provenance is only PARTIAL:
- `AI_PROVENANCE = PARTIAL` (not RECORDED)

**Status**: AI traceability infrastructure is **COMPLETE** for new predictions. Legacy predictions without trace records remain PARTIAL.

---

## ABSOLUTE RULES OBSERVED

1. ✓ No model coefficients modified
2. ✓ AI_WEIGHT unchanged (0.35)
3. ✓ No optimization performed
4. ✓ Only traceability infrastructure added
