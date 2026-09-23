# Worklog — Phase 5.3.3 Scientific Timeline Fix

---
Task ID: 1
Agent: main
Task: Audit code chain for source_timestamps propagation failure

Work Log:
- Traced full pipeline: buildAIContext() → enrichMatchesForAI() → analyze-match → computeAITraces() → predictions.js INSERT/PATCH → Neon
- ROOT CAUSE: enrichMatchesForAI() in LiveMatches.tsx does NOT propagate oddsTimestamp/rankingTimestamp/formTimestamp/h2hTimestamp
- ScrapedMatch type had no timestamp fields defined
- buildAIContext() correctly reads match.oddsTimestamp but always receives undefined
- computeAITraces() used only ctx.source_timestamps?.odds for t_feature (not MAX of all)
- temporal_safety_score defaulted to 1.0 when t_feature was null (FALSE safety)
- predictions.js PATCH used falsy check `if (body.t_feature)` which skips null

Stage Summary:
- 7 data loss points identified in the chain
- Root cause: timestamps never leave the frontend
- Secondary: t_feature used only odds, not MAX of all sources
- Critical: temporal_safety_score = 1.0 by default = false sense of safety

---
Task ID: 2
Agent: main
Task: Fix t_feature computation and timestamp propagation

Work Log:
- Added timestamp fields to ScrapedMatch type (types.ts)
- Added timestamp fields to EnrichedMatchInput interface (LiveMatches.tsx)
- Updated enrichMatchesForAI() to propagate timestamps from ScrapedMatch
- Updated use-live-matches.ts fetchFromAPI to use scrapedAt as oddsTimestamp fallback
- Updated use-live-matches.ts loadFromDatabaseRaw to use scraped_at as oddsTimestamp fallback
- Fixed computeAITraces(): t_feature = MAX(all available source timestamps)
- Fixed computeAITraces(): temporal_safety_score = 0.0 when t_feature is null (T_FEATURE_UNKNOWN)
- Added temporal_safety_reason and timestamp_provenance to trace output
- Fixed predictions.js PATCH: `if (body.t_feature != null)` instead of truthy check
- Fixed predictions.js INSERT: t_feature = MAX of all source timestamps
- Added normalizeBody and mapToCamelCase support for temporal_safety_reason and timestamp_provenance
- Created migration 009_temporal_provenance_audit.sql

Stage Summary:
- 7 files modified, 1 migration created
- t_feature now correctly computed as MAX of all available source timestamps
- temporal_safety_score = 0.0 when t_feature = null (no more false safety)
- PATCH can now correctly update t_feature with string values
- New columns: temporal_safety_reason, timestamp_provenance

---
Task ID: 3
Agent: main
Task: Write deterministic tests for scientific timeline

Work Log:
- Created phase5.3.3-scientific-timeline.test.ts with 10 tests
- TEST 1: feature_before_prediction = true (PASSED)
- TEST 2: feature_before_prediction = false / FUTURE_FEATURE_LEAK (PASSED)
- TEST 3: missing timestamp → temporal_safety = 0.0 / T_FEATURE_UNKNOWN (PASSED)
- TEST 3b: partial timestamps → provenance tracks UNKNOWN (PASSED)
- TEST 4: AI timeline order verified (PASSED)
- TEST 5: real future source → detected as leak (PASSED)
- TEST 6: T_AI_response NOT used as T_feature (PASSED)
- ADDITIONAL: t_feature = MAX of all sources (PASSED)
- ADDITIONAL: clock skew within 5 min → WITHIN_CLOCK_SKEW (PASSED)
- ADDITIONAL: feature_snapshot contains source_timestamps (PASSED)
- All existing tests still pass (47 + 27 + 49 = 123 tests)

Stage Summary:
- 10/10 new tests pass
- 0 regressions in existing tests
- Full coverage of the 6 required test cases
