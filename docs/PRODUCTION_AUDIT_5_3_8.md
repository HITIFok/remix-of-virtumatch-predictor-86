# PRODUCTION AUDIT 5.3.8

**Commit attendu** : `3dce63385cab431a501c9e20c90b5471140d0c16` (court : `3dce633`)
**Branche** : `main`
**Push GitHub** : confirmé
**Scientific collection status** : **NOT READY**
**Document version** : 5.3.10 (Phase 5.3.10 — corrected per static review)

> **IMPORTANT** :
> This audit does NOT modify the prediction model.
> This audit does NOT modify historical predictions.
> This audit does NOT add features.
> This audit does NOT add new migrations.
> This audit ONLY verifies production state and applies migration 010.

> **CORRECTIONS APPLIED IN PHASE 5.3.10** (per static review 5.3.9) :
> - §2.2 : Vercel lazy chunks procedure rewritten (no shell wildcards on remote URLs)
> - §7.5 : Hash chain — Python scripts check IS NOT NULL only, do NOT recompute. New `scripts/recompute-ai-hashes.ts` does the real recomputation.
> - §7.6 : Provenance JSON paths corrected (use `feature_snapshot->'ai_snapshot'->...` not `feature_snapshot->'odds'->'provenance'`)
> - §8.6 : value → NULL via PATCH does NOT test the trigger. Use direct SQL UPDATE instead.
> - §8.7 : NULL → value may be N/A for normal flow predictions.
> - §6.4 : Smoke test now captures explicit UUIDs in addition to `created_at >= :start_utc` filter.

---

## 0. PREREQUISITES

### 0.1 Tools required on the operator machine

| Tool | Required for | Check command |
|------|--------------|---------------|
| `git` | Verify commit on remote | `git --version` |
| `curl` | Vercel chunk verification | `curl --version` |
| `psql` (optional) | Apply migration 010 from CLI | `psql --version` |
| `python3` (optional) | Run Neon MCP audit scripts | `python3 --version` |
| `python3 -m fastmcp` (optional) | Neon MCP client | `python3 -c "import fastmcp"` |

> **Note** : All scripts under `scripts/*neon*.py` and `scripts/*audit*.py` are **Python 3** (shebang `#!/usr/bin/env python3`). They MUST be run with `python3`, NOT `npx tsx`. The `.py` extension always indicates Python in this repo.

### 0.2 Secrets / env required

- `NEON_DATABASE_URL` — for `psql` connection. Format : `postgresql://user:pass@host/db?sslmode=require`.
- OR `scripts/.neon-oauth-token.json` — for MCP-based scripts (created by `scripts/neon-mcp-oauth.py`).
- OR Neon SQL Editor web access — for copy/paste SQL execution.

### 0.3 Identification préalable

Before starting, the operator MUST record these explicitly:

```text
NEON PROJECT ID   = ______________________________________
NEON BRANCH ID    = ______________________________________
NEON DATABASE     = ______________________________________
NEON PRODUCTION BRANCH (mark with ★) = ____________________
```

If multiple branches exist, you MUST confirm which one is the production branch.
Do NOT apply any migration to a non-production branch by accident.

---

## 1. REPOSITORY STATE

### 1.1 Working tree state

```bash
cd /path/to/repo
git status
git branch --show-current
git log -3 --oneline
```

Expected output (after commit `3dce633`):

```text
On branch main
nothing to commit, working tree clean

main

3dce633 Phase 5 forensic fix: 12 bugs corrected, migration 010, tests green
6ed4bcf fix: increase Groq deadline from 2.5s to 5s — API was being killed before response arrived
```

### 1.2 Files modified in commit `3dce633` (13 files)

```text
api/_lib/ai-context.js                  (modified)
api/analyze-match.js                     (modified)
api/predictions.js                       (modified)
scripts/phase5.2-scientific-golive.ts    (modified)
src/lib/ai-context.ts                    (modified)
src/lib/ai-traceability.ts               (modified)
src/lib/feature-snapshot.ts               (modified)
src/lib/snapshot-audit.ts                 (modified)
src/test/feature-snapshot.test.ts         (modified)
src/test/phase5-production-snapshot.test.ts (modified)
api/_migrations/010_scientific_integrity.sql (new)
docs/HISTORICAL_DATA_POLICY.md             (new)
src/test/phase5-forensic-audit.test.ts     (new)
```

### 1.3 Forbidden file check

```bash
git log --name-only -1 3dce633 | grep -E "prediction-engine|prediction-config"
```

Expected output : **EMPTY**. No model file modified.

If output is non-empty → **STOP — model integrity compromised**.

### 1.4 Final local tests (re-verify before production audit)

```bash
npm run test
npm run test:api
npm run test:all
npm run build
```

Expected:

| Command | Expected result |
|---------|-----------------|
| `npm run test` | 7 files, 211 tests, 0 fail |
| `npm run test:api` | 39 files, 930 tests, 0 fail |
| `npm run test:all` | 46 files, 1141 tests, 0 fail |
| `npm run build` | Vite OK + PWA OK, 60 precache entries |

If any of these fails → **DO NOT PROCEED** to production audit.

---

## 2. VERCEL DEPLOYMENT VERIFICATION

### 2.1 Verify deployment exists for commit `3dce633`

#### Option A — Via Vercel dashboard (no API token required)

1. Open `https://vercel.com/HITIFok/remix-of-virtumatch-predictor-86/deployments` in your browser.
2. Find the deployment whose commit message is `Phase 5 forensic fix: 12 bugs corrected, migration 010, tests green` and commit hash `3dce633`.
3. Record:

```text
VERCEL DEPLOYMENT URL = https://__________________.vercel.app
VERCEL STATUS         = Ready / Building / Error
VERCEL BUILD DURATION = _____ s
VERCEL BUILD LOG URL  = ____________________________________
```

If status is `Error` → **STOP** — investigate build log.

#### Option B — Via Vercel API (requires `VERCEL_TOKEN`)

```bash
VERCEL_TOKEN=<your-token>
PROJECT_ID=<your-project-id>

curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&limit=5" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for d in data.get('deployments', []):
    print(f\"sha={d.get('meta', {}).get('githubCommitSha', '?')[:7]} status={d.get('readyState', '?')} url=https://{d.get('url', '?')}\")
"
```

Look for the line with `sha=3dce633`. The `status` should be `READY`.

### 2.2 Production URL verification (chunk integrity)

> **Do NOT use shell wildcards on remote URLs.** The shell cannot resolve remote wildcards. The History and Shop chunks are **lazy-loaded** (Vite dynamic `import()`) — they are NOT referenced in `index.html`. They are only discoverable by inspecting the main bundle.

#### 2.2.1 Phase A — Build local reference (commit `3dce633`)

```bash
# Confirm working tree is on commit 3dce633
git rev-parse HEAD
# Expected: 3dce63385cab431a501c9e20c90b5471140d0c16

# Confirm working tree is clean (no uncommitted changes)
git status --porcelain
# Expected: empty output

# Build locally to produce the reference chunk names
npm run build
```

> The local build MUST be on the same commit as the deployed one. Vite generates chunk names with content hashes (e.g., `History-B81IdKCR.js`) — these are **deterministic** for the same input content, so the same commit produces the same chunk names locally and on Vercel.

#### 2.2.2 Phase B — Identify the lazy-loaded chunks locally

```bash
# List all History and Shop chunks in the local build output
find dist/assets -maxdepth 1 -type f \
  | grep -E '/(History|Shop)-[^/]+\.js$' \
  | sort

# Expected output (chunk names will vary by content hash):
#   dist/assets/History-B81IdKCR.js
#   dist/assets/Shop-DgsGNjY1.js
```

Record the chunk names:

```text
LOCAL_HISTORY_CHUNK = /assets/History-________________.js
LOCAL_SHOP_CHUNK    = /assets/Shop-________________.js
```

#### 2.2.3 Phase C — Verify the SAME chunk names exist on the production deployment

```bash
PRODUCTION_URL=https://<your-production-url>

# Verify History chunk
curl -s -I "$PRODUCTION_URL$LOCAL_HISTORY_CHUNK" | head -5

# Verify Shop chunk
curl -s -I "$PRODUCTION_URL$LOCAL_SHOP_CHUNK" | head -5
```

Expected (for each):

```text
HTTP/2 200
content-type: application/javascript
```

If `content-type: text/html` → **STOP** — `vercel.json` rewrite rule has regressed (the `/((?!api/.*|assets/.*).*)` rule is no longer in effect, and `/assets/*` is being rewritten to `/index.html`).

If `HTTP/2 404` → the chunk name on production differs from local. This means either:
1. The deployed commit is NOT `3dce633` (mismatched deployment)
2. The build is non-deterministic (shouldn't happen with Vite content-hashing)
3. The deployment failed mid-build

In any of these cases → **STOP** — investigate before proceeding.

#### 2.2.4 Alternative — Discover chunk names from the production main bundle

If you cannot build locally (e.g., different machine), you can discover the chunk names from the production main bundle:

```bash
# 1. Fetch the production index.html
curl -s "$PRODUCTION_URL/" -o /tmp/prod-index.html

# 2. Extract the main bundle URL from index.html
#    (Vite includes it as <script type="module" src="/assets/index-XXXX.js">)
MAIN_BUNDLE=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/prod-index.html | head -1)
echo "Main bundle: $MAIN_BUNDLE"

# 3. Fetch the main bundle
curl -s "$PRODUCTION_URL$MAIN_BUNDLE" -o /tmp/prod-main.js

# 4. Search for History and Shop chunk references in the main bundle
#    (Vite uses patterns like: t.e("History-B81IdKCR") or import("./History-B81IdKCR.js"))
grep -oE 'History-[A-Za-z0-9_-]+\.js' /tmp/prod-main.js | sort -u
grep -oE 'Shop-[A-Za-z0-9_-]+\.js'    /tmp/prod-main.js | sort -u

# 5. For each chunk name found, verify Content-Type on production
for chunk in $(grep -oE '/assets/History-[A-Za-z0-9_-]+\.js' /tmp/prod-main.js | sort -u); do
  echo "Checking: $chunk"
  curl -s -I "$PRODUCTION_URL$chunk" | grep -iE "HTTP|content-type"
done
```

> This alternative is more fragile (depends on Vite's chunk naming patterns) — prefer Phase A–C when possible.

### 2.3 Static routes smoke test

```bash
# Home page returns 200 HTML
curl -s -o /dev/null -w "Home: HTTP %{http_code} (%{content_type})\n" "$PRODUCTION_URL/"

# API endpoint (predictions) returns 401 (auth required) — proves the function is deployed
curl -s -o /dev/null -w "Predictions API: HTTP %{http_code}\n" "$PRODUCTION_URL/api/predictions"
```

Expected:

```text
Home: HTTP 200 (text/html; charset=utf-8)
Predictions API: HTTP 401   (auth required)
```

If `Home` is not 200 → deployment failed.
If `Predictions API` is 404 → the `/api/predictions` Serverless Function is NOT deployed.

### 2.4 Verify local build matches deployed commit

> **Phase 5.3.10 NEW** : Do not assume that a local build automatically corresponds to the deployed commit. Verify explicitly.

#### 2.4.1 Confirm local HEAD matches the deployed commit

```bash
# Local HEAD
git rev-parse HEAD
# Expected: 3dce63385cab431a501c9e20c90b5471140d0c16

# Remote HEAD (origin/main)
git rev-parse origin/main
# Expected: 3dce63385cab431a501c9e20c90b5471140d0c16

# Confirm they match
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && echo "MATCH" || echo "MISMATCH"
```

If MISMATCH → **STOP**. The local working tree is on a different commit than what's deployed. Re-checkout `3dce633` before proceeding:

```bash
git checkout 3dce633
```

#### 2.4.2 Confirm local build produces the expected chunk names

```bash
# Clean and rebuild
rm -rf dist
npm run build

# List History and Shop chunks produced
find dist/assets -maxdepth 1 -type f \
  | grep -E '/(History|Shop)-[^/]+\.js$' \
  | sort
```

Record the chunk names locally. These MUST match the chunk names served from production (verified in §2.2.3).

#### 2.4.3 Record Vercel section

```text
VERCEL DEPLOYMENT STATUS = READY / BUILDING / ERROR
VERCEL DEPLOYMENT URL    = ____________________
VERCEL COMMIT SHA        = 3dce633 (verified via §2.1)
LOCAL HEAD SHA           = 3dce633 (verified via §2.4.1)
HEAD vs DEPLOYED = MATCH / MISMATCH
History chunk Content-Type = application/javascript ✓ / ✗
Shop chunk Content-Type    = application/javascript ✓ / ✗
Home HTTP code           = _____
Predictions API HTTP code = _____
```

---

## 3. NEON — PRE-MIGRATION AUDIT

### 3.1 Connection methods (pick ONE)

#### Method 1 — `psql` (recommended)

```bash
# Verify connection string
echo "$NEON_DATABASE_URL" | head -c 50   # don't print full secret

# Test connection (should print server version)
psql "$NEON_DATABASE_URL" -c "SELECT version();"
```

Expected: `PostgreSQL 16.x on x86_64-pc-linux-gnu, ...`

#### Method 2 — Neon SQL Editor (web)

1. Log in to `https://console.neon.tech`.
2. Select the project (must match `NEON PROJECT ID` recorded in §0.3).
3. Select the production branch (must match `NEON PRODUCTION BRANCH`).
4. Open SQL Editor.
5. Run each query below by copy/paste.

#### Method 3 — Neon MCP (Python scripts, read-only)

These scripts use `fastmcp` and an OAuth token stored at `scripts/.neon-oauth-token.json`.

**Step 1 — OAuth (first time only)**

```bash
python3 scripts/neon-mcp-oauth.py
# Follow instructions, visit URL, complete OAuth flow
# Token saved to scripts/.neon-oauth-token.json
```

**Step 2 — List projects (read-only)**

```bash
python3 scripts/neon-mcp-audit.py
```

**Step 3 — Full forensic audit (read-only)**

```bash
python3 scripts/neon-forensic-audit.py
```

**Step 4 — End-to-end timeline audit (read-only)**

```bash
python3 scripts/neon-mcp-e2e-audit.py
```

> ⚠️ The hardcoded project/branch in `scripts/neon-mcp-e2e-audit.py` may not match your current Neon project. Verify by inspecting lines 25-27:

```bash
grep -E "PROJECT_ID|BRANCH_ID|DATABASE" scripts/neon-mcp-e2e-audit.py | head -3
```

If the values don't match your `NEON PROJECT ID` / `NEON BRANCH ID`, edit the script locally OR use Method 2 (Neon SQL Editor) for the audit queries.

### 3.2 Scripts classification (READ-ONLY vs WRITE)

| Script | Runtime | Command | Purpose | Read/Write |
|--------|---------|---------|---------|------------|
| `neon-mcp-oauth.py` | Python 3 | `python3 scripts/neon-mcp-oauth.py` | OAuth flow → produces token file | **WRITE** (local file only, no DB) |
| `neon-mcp-audit.py` | Python 3 | `python3 scripts/neon-mcp-audit.py` | Lists tools + projects + runs audit queries | **READ ONLY** |
| `neon-forensic-audit.py` | Python 3 | `python3 scripts/neon-forensic-audit.py` | Full forensic audit on 15 scientific predictions | **READ ONLY** |
| `neon-mcp-e2e-audit.py` | Python 3 | `python3 scripts/neon-mcp-e2e-audit.py` | End-to-end timeline audit | **READ ONLY** |
| `convert_neon_sql.py` | Python 3 | (not needed for audit) | Converts SQL backup format | (utility) |
| `audit-report.py` | Python 3 | `python3 scripts/audit-report.py` | Generates PDF audit report locally | **WRITE** (local PDF, no DB) |
| `generate-audit-pdf.py` / `generate-audit-report.py` / `generate_audit_pdf.py` | Python 3 | `python3 scripts/<name>.py` | Generate local PDF reports | **WRITE** (local PDF, no DB) |

> **NEVER** run `npx tsx scripts/<name>.py` — these are Python files. The `.py` extension is mandatory and tsx is a TypeScript runtime.

### 3.3 Pre-migration counters — READ ONLY

Run these queries BEFORE applying migration 010. Record the results in §6.

#### 3.3.1 Global counts

```sql
SELECT
  COUNT(*) AS total_predictions,
  COUNT(feature_snapshot) AS with_snapshot,
  COUNT(ai_trace) AS with_ai_trace,
  COUNT(ai_context_hash) AS with_ai_context_hash,
  COUNT(ai_input_hash) AS with_ai_input_hash,
  COUNT(ai_prompt_hash) AS with_ai_prompt_hash,
  COUNT(ai_response_hash) AS with_ai_response_hash,
  COUNT(t_feature) AS with_t_feature,
  COUNT(t_prediction) AS with_t_prediction,
  COUNT(snapshot_timestamp) AS with_snapshot_timestamp,
  COUNT(*) FILTER (WHERE scientific_collection_eligible = TRUE) AS scientific_eligible,
  COUNT(version_freeze) AS with_version_freeze,
  COUNT(provenance_status) AS with_provenance,
  COUNT(completeness_score) AS with_completeness_score,
  COUNT(temporal_safety_score) AS with_temporal_safety_score,
  COUNT(timestamp_provenance) AS with_timestamp_provenance,
  COUNT(temporal_safety_reason) AS with_temporal_safety_reason,
  COUNT(ai_provenance_risk) AS with_ai_provenance_risk
FROM predictions;
```

#### 3.3.2 Immutability violations table

```sql
SELECT
  COUNT(*) AS immutability_violations,
  MAX(detected_at) AS last_violation,
  COUNT(*) FILTER (WHERE blocked = TRUE) AS blocked_count,
  COUNT(*) FILTER (WHERE blocked = FALSE) AS not_blocked_count
FROM snapshot_immutability_violations;
```

#### 3.3.3 Audit log table

```sql
SELECT
  COUNT(*) AS audit_log_entries,
  MAX(created_at) AS last_audit_entry
FROM snapshot_audit_log;
```

#### 3.3.4 Legacy rows (from previous migrations 007/008 backfills)

```sql
SELECT
  COUNT(*) FILTER (WHERE t_prediction = created_at)
    AS legacy_t_prediction_backfilled,
  COUNT(*) FILTER (
    WHERE provenance_status = 'PARTIALLY_VALID'
      AND ai_prompt_version IS NULL
  ) AS legacy_provenance_silently_upgraded,
  COUNT(*) FILTER (
    WHERE ai_prompt_version = '7.0'
      AND ai_response_hash IS NULL
  ) AS legacy_ai_trace_fabricated,
  COUNT(*) FILTER (
    WHERE feature_snapshot IS NULL
  ) AS legacy_no_snapshot
FROM predictions;
```

#### 3.3.5 Trigger state BEFORE migration

```sql
SELECT
  tgname,
  tgenabled,
  pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgname = 'trg_snapshot_immutability'
  AND tgrelid = 'predictions'::regclass;
```

Expected: 1 row, `tgenabled = 'O'` (origin, enabled).

```text
TGNAME                 = trg_snapshot_immutability
TGENABLED              = O
TRIGGER DEFINITION     = BEFORE UPDATE ON predictions FOR EACH ROW EXECUTE FUNCTION enforce_snapshot_immutability()
```

#### 3.3.6 Function source

```sql
SELECT
  proname,
  pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'enforce_snapshot_immutability';
```

> Save the full function definition to compare with post-migration. The function should currently have ~10 rules (from migrations 007+008). After migration 010, it should have ~19 rules (10 original + 9 new).

#### 3.3.7 Columns catalog (verify all scientific columns exist)

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'predictions'
  AND column_name IN (
    'feature_snapshot', 'feature_snapshot_hash', 'prediction_hash',
    'snapshot_timestamp', 'provenance_status',
    'model_version', 'feature_version', 'config_version',
    'calibration_version', 'dataset_version',
    't_prediction', 't_feature',
    'completeness_score', 'temporal_safety_score',
    'temporal_safety_reason', 'timestamp_provenance', 'ai_provenance_risk',
    'ai_context_hash', 'ai_input_hash', 'ai_prompt_hash', 'ai_response_hash',
    'ai_prompt_version', 'ai_model', 'ai_trace',
    'scientific_collection_eligible', 'version_freeze', 'dataset_split'
  )
ORDER BY column_name;
```

Expected: 27 rows. If any column is missing → migrations 006/007/008/009 were not all applied.

---

## 4. APPLY MIGRATION 010 — ONLY ON CONFIRMED PRODUCTION BRANCH

> ⚠️ **CONFIRM BEFORE RUNNING** :
> - Branch = `NEON PRODUCTION BRANCH` recorded in §0.3
> - Pre-migration counters are recorded in §6
> - No production traffic is running that would conflict with the trigger

### 4.1 Apply via `psql`

```bash
psql "$NEON_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f api/_migrations/010_scientific_integrity.sql
```

Expected output (extract):

```text
NOTICE:  trg_snapshot_immutability trigger confirmed present.
NOTICE:  Migration 010 (scientific_integrity) applied successfully.
NOTICE:    - enforce_snapshot_immutability() extended with 9 new rules:
NOTICE:      t_feature, t_prediction, scientific_collection_eligible,
NOTICE:      version_freeze, completeness_score, temporal_safety_score,
NOTICE:      timestamp_provenance, temporal_safety_reason, ai_provenance_risk
NOTICE:    - Rules: NULL→value ALLOWED, value→same ALLOWED,
NOTICE:             value→different BLOCKED, value→NULL BLOCKED
NOTICE:    - CRITICAL: No historical data was modified.
NOTICE:    - CRITICAL: No backfill was performed.
NOTICE:    - Existing rows keep their current values, including NULLs.
```

If `psql` reports an error or aborts, **STOP** — do not retry. Investigate before re-running.

### 4.2 Apply via Neon SQL Editor

Open `api/_migrations/010_scientific_integrity.sql` in a text editor, copy the entire content, paste into the SQL Editor, and execute. The migration is **idempotent** (`CREATE OR REPLACE FUNCTION`, `IF NOT EXISTS`), so re-running is safe.

Expected output: same `NOTICE` lines as above.

### 4.3 What migration 010 does NOT do

- ❌ Does NOT `UPDATE predictions SET ...`
- ❌ Does NOT `INSERT INTO predictions ...`
- ❌ Does NOT `DELETE FROM predictions ...`
- ❌ Does NOT `ALTER TABLE predictions ...` (columns already exist via 007/008)
- ❌ Does NOT backfill any historical row

The migration ONLY replaces the `enforce_snapshot_immutability()` function with an extended version that has 9 additional rules.

---

## 5. POST-MIGRATION VERIFICATION

### 5.1 Confirm trigger is still active

```sql
SELECT
  tgname,
  tgenabled,
  pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgname = 'trg_snapshot_immutability'
  AND tgrelid = 'predictions'::regclass;
```

Expected (unchanged from pre-migration):

```text
TGNAME         = trg_snapshot_immutability
TGENABLED      = O
TRIGGER DEFN   = BEFORE UPDATE ON predictions FOR EACH ROW EXECUTE FUNCTION enforce_snapshot_immutability()
```

If `tgenabled` is not `O` → **STOP** — trigger is disabled.

### 5.2 Confirm function has 9 new rules

```sql
SELECT pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'enforce_snapshot_immutability';
```

The function body must contain these patterns (grep mentally):

```text
IF OLD.t_feature IS NOT NULL AND ...
IF OLD.t_prediction IS NOT NULL AND ...
IF OLD.scientific_collection_eligible IS NOT NULL AND ...
IF OLD.version_freeze IS NOT NULL AND ...
IF OLD.completeness_score IS NOT NULL AND ...
IF OLD.temporal_safety_score IS NOT NULL AND ...
IF OLD.timestamp_provenance IS NOT NULL AND ...
IF OLD.temporal_safety_reason IS NOT NULL AND ...
IF OLD.ai_provenance_risk IS NOT NULL AND ...
```

If any of these 9 patterns is missing → the function was not extended properly. Re-apply migration 010.

### 5.3 Re-run §3.3 queries — counters must be IDENTICAL

Run the SAME queries as in §3.3 (3.3.1 through 3.3.4).

| Metric | Pre-migration | Post-migration | Identical? |
|--------|---------------|----------------|------------|
| total_predictions |  |  | ✓ / ✗ |
| with_snapshot |  |  | ✓ / ✗ |
| with_ai_trace |  |  | ✓ / ✗ |
| with_ai_context_hash |  |  | ✓ / ✗ |
| with_ai_input_hash |  |  | ✓ / ✗ |
| with_ai_prompt_hash |  |  | ✓ / ✗ |
| with_ai_response_hash |  |  | ✓ / ✗ |
| scientific_eligible |  |  | ✓ / ✗ |
| with_version_freeze |  |  | ✓ / ✗ |
| with_t_feature |  |  | ✓ / ✗ |
| with_t_prediction |  |  | ✓ / ✗ |
| legacy_t_prediction_backfilled |  |  | ✓ / ✗ |
| legacy_provenance_silently_upgraded |  |  | ✓ / ✗ |
| legacy_ai_trace_fabricated |  |  | ✓ / ✗ |

**ALL values MUST be IDENTICAL**. If any counter changed → **NO-GO** — migration 010 modified historical data, which it should NOT do. Investigate immediately.

> **Never manually UPDATE `predictions` to make counters match.** If they differ, the migration 010 file has been tampered with. Re-fetch the file from the commit:

```bash
git checkout 3dce633 -- api/_migrations/010_scientific_integrity.sql
git diff
# If empty, file is correct. Re-apply.
```

---

## 6. SMOKE TEST — GENERATE 3 TO 10 NEW PREDICTIONS

> Do NOT generate 50 predictions. Do NOT launch the scientific collection. Do NOT run a backtest yet.

### 6.1 Record start timestamp (UTC)

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

Record:

```text
SMOKE_TEST_START_UTC = 2026-__-__T__:__:__Z
```

### 6.2 Generate predictions

Open the production app (`PRODUCTION_URL` from §2.2), log in, and generate **between 3 and 10** predictions on real matches.

For each prediction, record:

```text
UUID          = ______________________________________
HOME_TEAM     = ______________________________________
AWAY_TEAM     = ______________________________________
LEAGUE        = ______________________________________
MATCH_DATE    = ______________________________________
GENERATED_AT  = 2026-__-__T__:__:__Z
AI_PROVIDER   = groq / math-v2
```

### 6.3 Record end timestamp (UTC)

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

Record:

```text
SMOKE_TEST_END_UTC = 2026-__-__T__:__:__Z
```

### 6.4 Retrieve the new predictions from Neon

> **Phase 5.3.10 CORRECTION** : The `created_at >= :start_utc` filter is necessary but not sufficient. It returns **candidates** — rows that may include predictions created by other users between `:start_utc` and the end of the smoke test. To be certain a row is a smoke-test row, the operator MUST also capture the UUID of each prediction they generated via the UI and cross-check.

#### 6.4.1 Capture explicit UUIDs from the UI

For each prediction generated during the smoke test, record the UUID. The UUID is returned in the POST `/api/predictions` response (field `prediction.id`). If the UI doesn't display it, capture it from the browser's network tab.

```text
SMOKE_TEST_UUIDS = [
  _______________________,  # UUID 1
  _______________________,  # UUID 2
  _______________________,  # UUID 3
  ...
]
```

#### 6.4.2 Retrieve candidates by time (broad filter)

```sql
-- Replace :start_utc with the actual SMOKE_TEST_START_UTC value
-- This returns ALL rows created after the start time, including potentially
-- rows from other users (if the app is in production use).
SELECT
  id,
  created_at,
  home_team,
  away_team,
  league,
  t_feature,
  t_prediction,
  snapshot_timestamp,
  feature_snapshot_hash,
  ai_context_hash,
  ai_input_hash,
  ai_prompt_hash,
  ai_response_hash,
  ai_model,
  ai_prompt_version,
  scientific_collection_eligible,
  provenance_status,
  version_freeze,
  completeness_score,
  temporal_safety_score,
  temporal_safety_reason,
  timestamp_provenance,
  ai_provenance_risk
FROM predictions
WHERE created_at >= '2026-__-__T__:__:__Z'::timestamptz  -- SMOKE_TEST_START_UTC
ORDER BY created_at ASC;
```

#### 6.4.3 Cross-check candidates against confirmed UUIDs

```sql
-- Replace the IN list with the actual SMOKE_TEST_UUIDS captured in §6.4.1
SELECT
  id,
  created_at,
  home_team,
  away_team
FROM predictions
WHERE id IN (
  '_______________________'::uuid,  -- UUID 1
  '_______________________'::uuid,  -- UUID 2
  '_______________________'::uuid   -- UUID 3
)
ORDER BY created_at ASC;
```

Expected: the count returned here matches the number of UUIDs you captured. If the count is less, some predictions failed to save (investigate). If the count is more, you have duplicate UUIDs or stale data.

#### 6.4.4 Distinguish in the audit report

The final audit must distinguish:

```text
CANDIDATES FOUND BY TIME = _____  (rows from §6.4.2)
CONFIRMED SMOKE-TEST UUIDs = _____  (rows from §6.4.3, cross-checked against §6.4.1)
```

**Scientific validation uses CONFIRMED UUIDs only.** If a candidate row is not in the confirmed UUID list, it is excluded from the audit — even if it was created during the smoke test window. This protects against accidental contamination from other users' predictions.

Save the §6.4.3 result. These rows are the **only** ones used for scientific validation.

> ⚠️ NEVER use `WHERE id = (SELECT MAX(id) FROM predictions)` to "pick the latest" — this would mix smoke-test rows with any concurrent production rows. Use `created_at >= :start_utc` strictly.

---

## 7. PER-PREDICTION SCIENTIFIC CHECKS

For EACH row returned by §6.4, perform these checks. Use the table below as a checklist (one block per prediction).

### 7.1 Identity

```text
UUID            = ______________________________________
HOME_TEAM       = ______________________________________
AWAY_TEAM       = ______________________________________
LEAGUE          = ______________________________________
CREATED_AT      = ______________________________________
```

### 7.2 Snapshot integrity

```sql
-- Replace :uuid with the prediction's UUID
SELECT
  feature_snapshot IS NOT NULL AS has_snapshot,
  feature_snapshot_hash IS NOT NULL AS has_hash,
  feature_snapshot->>'schema_version' AS snapshot_schema_version,
  jsonb_typeof(feature_snapshot) AS snapshot_type,
  octet_length(feature_snapshot::text) AS snapshot_size_bytes
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected:

```text
HAS_SNAPSHOT             = t
HAS_HASH                 = t
SNAPSHOT_SCHEMA_VERSION  = 1   (or matches SNAPSHOT_SCHEMA_VERSION constant)
SNAPSHOT_TYPE            = object
SNAPSHOT_SIZE_BYTES      = > 1000 (a real snapshot has meaningful size)
```

If `HAS_SNAPSHOT = f` → prediction was saved without a snapshot → **NO-GO** for this prediction.

### 7.3 Timeline verification

```sql
SELECT
  t_feature,
  t_prediction,
  snapshot_timestamp,
  created_at,
  -- Phase 5.3.7 fix: NULL when source timestamps absent
  CASE
    WHEN t_feature IS NULL THEN 'T_FEATURE_UNKNOWN'
    WHEN t_feature > t_prediction THEN 'VIOLATION_T_FEATURE_FUTURE'
    WHEN t_prediction > snapshot_timestamp THEN 'VIOLATION_SNAPSHOT_BEFORE_PREDICTION'
    ELSE 'VERIFIED'
  END AS timeline_status
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected:

```text
TIMELINE_STATUS = VERIFIED
                  (or T_FEATURE_UNKNOWN if no source timestamps exist — this is acceptable)
```

If `TIMELINE_STATUS` starts with `VIOLATION_` → **NO-GO** for this prediction.

### 7.4 AI trace verification

```sql
SELECT
  ai_model,
  ai_prompt_version,
  ai_context_hash IS NOT NULL AS has_context_hash,
  ai_input_hash IS NOT NULL AS has_input_hash,
  ai_prompt_hash IS NOT NULL AS has_prompt_hash,
  ai_response_hash IS NOT NULL AS has_response_hash,
  ai_trace IS NOT NULL AS has_ai_trace,
  scientific_collection_eligible
FROM predictions
WHERE id = ':uuid'::uuid;
```

**Case A — A real LLM (Groq) was called** (provider = `groq-v6`):

```text
AI_MODEL                = qwen/qwen3.8-27b (or another real Groq model)
AI_PROMPT_VERSION       = 7.0
HAS_CONTEXT_HASH        = t
HAS_INPUT_HASH          = t
HAS_PROMPT_HASH         = t
HAS_RESPONSE_HASH       = t
HAS_AI_TRACE            = t
SCIENTIFIC_ELIGIBLE     = t  (ONLY if all other criteria pass too)
```

**Case B — Math fallback was used** (provider = `math-v2`):

```text
AI_MODEL                = math-v2 (or null)
AI_RESPONSE_HASH        = NULL  ← CRITICAL: must be NULL
SCIENTIFIC_ELIGIBLE     = f     ← CRITICAL: must be false
```

If `ai_response_hash IS NOT NULL` while `ai_model = 'math-v2'` → **NO-GO** — fabricated hash detected.

### 7.5 Hash chain verification (manual recompute)

The hash chain must be coherent:

```text
AI_CONTEXT_HASH  = sha256("ai_context:" + canonical_json(AIContext))
AI_INPUT_HASH    = sha256("ai_inputs:" + sorted_json(AIInputs))
AI_PROMPT_HASH   = sha256("prompt:" + system_prompt + "|" + user_prompt)
AI_RESPONSE_HASH = sha256("response:" + actual_groq_response_text)  OR null when no LLM
```

> **Phase 5.3.10 CORRECTION** : The Python audit scripts (`scripts/neon-forensic-audit.py` and `scripts/neon-mcp-e2e-audit.py`) verify ONLY the **presence** of hashes (`IS NOT NULL` checks) and classify the chain as `COMPLETE` / `STOPS_AT_RESPONSE` / etc. They do **NOT** recompute the hashes from stored data. To verify hash value integrity (not just presence), use the new `scripts/recompute-ai-hashes.ts` tool below.

#### 7.5.1 What can be recomputed

| Hash | Data needed (DB source) | Canonical function | Recomputable ? |
|------|--------------------------|---------------------|----------------|
| `AI_CONTEXT_HASH` | `predictions.home_team`, `predictions.away_team`, `predictions.feature_snapshot` (`{odds, standings, form, h2h, source_timestamps, match_index}`) | `computeAIContextHash(ctx)` from `src/lib/ai-context.ts` | **YES** |
| `AI_INPUT_HASH` | `predictions.feature_snapshot.ai_snapshot` (the `AIInputs` structure stored verbatim) | `computeAIInputHashFromContext(inputs)` from `src/lib/ai-context.ts` | **YES** |
| `AI_PROMPT_HASH` | `predictions.feature_snapshot` (to rebuild `AIContext` → `buildUserPromptFromContext`) + `SYSTEM_PROMPT` extracted from `api/analyze-match.js` source | `computeAIPromptHashFromContext(systemPrompt, userPrompt)` from `src/lib/ai-context.ts` | **YES** (assumes `version_freeze.ai_prompt_version = '7.0'` matches the current SYSTEM_PROMPT) |
| `AI_RESPONSE_HASH` | The raw Groq response text — **NOT STORED IN DB** (only the hash is stored, in `predictions.ai_response_hash` and `ai_trace.hashes.ai_response_hash`) | `computeAIResponseHashFromContext(response)` from `src/lib/ai-context.ts` | **NO** — response text is not persisted |

#### 7.5.2 Use the canonical recomputation tool

```bash
# Read-only — requires NEON_DATABASE_URL
# Uses canonical hash functions from src/lib/ai-context.ts (no second implementation)
npx tsx scripts/recompute-ai-hashes.ts <prediction-uuid>
```

Expected output:

```text
════════════════════════════════════════════════════════════════
  Hash Recomputation — Prediction <UUID>
════════════════════════════════════════════════════════════════
  Match: <home> vs <away>
  AI model: <model>
  Has feature_snapshot: YES
  Has ai_snapshot: YES

  AI_CONTEXT_HASH
    stored:      <hash>
    recomputed:  <hash>
    MATCH:       MATCH

  AI_INPUT_HASH
    stored:      <hash>
    recomputed:  <hash>
    MATCH:       MATCH

  AI_PROMPT_HASH
    stored:      <hash>
    recomputed:  <hash>
    MATCH:       MATCH

  AI_RESPONSE_HASH
    stored:      <hash or NULL>
    recomputed:  NULL
    MATCH:       NOT_RECOMPUTABLE   ← raw LLM response text not stored in DB

  Notes:
    - AI_RESPONSE_HASH is NOT recomputable: the raw LLM response text is not stored in the database.

════════════════════════════════════════════════════════════════
  OVERALL: PASS (recomputable hashes match stored values)
  AI_RESPONSE_HASH: NOT RECOMPUTABLE (raw LLM response not stored)
════════════════════════════════════════════════════════════════
```

#### 7.5.3 Verdict rules

- `MATCH` for `AI_CONTEXT_HASH`, `AI_INPUT_HASH`, `AI_PROMPT_HASH` → PASS for these hashes.
- `MISMATCH` for any of the 3 recomputable hashes → **NO-GO** for this prediction. The stored hash does not match the recomputed value — investigate.
- `NOT_RECOMPUTABLE` for `AI_RESPONSE_HASH` → expected and acceptable. The hash value cannot be verified without the raw response text. **Document this as a known limitation** — do NOT invent a way to "verify" it.
- `NO_STORED_VALUE` for any hash → the field is NULL in DB. If the prediction used a real LLM, this is a bug. If math-v2 fallback, `AI_RESPONSE_HASH = NULL` is expected.

If `stored hash != recomputed hash` for any recomputable hash → **NO-GO** for this prediction.

### 7.6 Provenance verification

> **Phase 5.3.10 CORRECTION** : The previous version used JSON paths `feature_snapshot->'odds'->'provenance'` etc., but the stored `feature_snapshot.odds` only contains `{home, draw, away, source_timestamp}` — it does NOT have a `provenance` field. The provenance info lives in `feature_snapshot.ai_snapshot.{odds.home, standings_home, form_home, h2h}` (the AIInputs structure).

The **canonical** provenance value to check is the `provenance_status` column on the predictions table (set by `api/predictions.js` at INSERT time using the canonical enum).

```sql
-- PRIMARY CHECK: use the provenance_status column (canonical enum)
SELECT
  provenance_status,
  timestamp_provenance
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected: `provenance_status` is one of the canonical values:

```text
RECORDED        ← all required features captured (snapshot has odds + form + stats with source_timestamps)
RECONSTRUCTED   ← partial snapshot (e.g., odds-only)
UNKNOWN         ← no snapshot OR no source timestamps
UNSAFE          ← temporal leak detected (a source_timestamp > t_prediction)
```

For **deeper per-feature provenance inspection** (when you need to verify individual features, not just the overall status), use the correct JSON paths via `ai_snapshot`:

```sql
SELECT
  feature_snapshot->'ai_snapshot'->'odds'->'home'->>'provenance'      AS odds_provenance,
  feature_snapshot->'ai_snapshot'->'standings_home'->>'provenance'   AS standings_home_provenance,
  feature_snapshot->'ai_snapshot'->'standings_away'->>'provenance'   AS standings_away_provenance,
  feature_snapshot->'ai_snapshot'->'form_home'->>'provenance'         AS form_home_provenance,
  feature_snapshot->'ai_snapshot'->'form_away'->>'provenance'         AS form_away_provenance,
  feature_snapshot->'ai_snapshot'->'h2h'->>'provenance'               AS h2h_provenance
FROM predictions
WHERE id = ':uuid'::uuid;
```

> ⚠️ Note: there is NO `stats` key in `feature_snapshot` (the snapshot uses `standings` for ranking data, not `stats`). Any query referencing `feature_snapshot->'stats'` will return NULL.

If `provenance_status = 'PARTIALLY_VALID'` or `'VALID'` or `'INVALID'` → these are LEGACY values from migration 007 backfill, NOT a new prediction. Check that `created_at >= SMOKE_TEST_START_UTC`. New predictions should only have the canonical values (`RECORDED` / `RECONSTRUCTED` / `UNKNOWN` / `UNSAFE`).

### 7.7 Version freeze verification

```sql
SELECT
  version_freeze->>'model_version' AS vf_model,
  version_freeze->>'feature_version' AS vf_feature,
  version_freeze->>'config_version' AS vf_config,
  version_freeze->>'calibration_version' AS vf_calibration,
  version_freeze->>'ai_prompt_version' AS vf_ai_prompt,
  version_freeze->>'ai_model' AS vf_ai_model
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected (Phase 11 fix — canonical constants):

```text
VF_MODEL         = 2.0.0
VF_FEATURE       = 1.0.0
VF_CONFIG        = 1.0.0
VF_CALIBRATION   = 0.0.0
VF_AI_PROMPT     = 7.0
VF_AI_MODEL      = qwen/qwen3.8-27b  (or another real Groq model if used)
```

> Old historical predictions may have `VF_MODEL = 1.0.0` and `VF_FEATURE = 3.0` — these are LEGACY values. Check `created_at >= SMOKE_TEST_START_UTC` to ensure the row is new.

### 7.8 Source timestamps inspection

```sql
SELECT
  feature_snapshot->'source_timestamps' AS source_timestamps,
  feature_snapshot->'odds'->'source_timestamp' AS odds_source_ts,
  feature_snapshot->'standings'->'source_timestamp' AS standings_source_ts,
  feature_snapshot->'form'->'source_timestamp' AS form_source_ts,
  feature_snapshot->'h2h'->'source_timestamp' AS h2h_source_ts,
  t_feature
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected (per Phase 4 fix):

```text
T_FEATURE = MAX(odds_source_ts, standings_source_ts, form_source_ts, h2h_source_ts)
            OR NULL if all are NULL
```

If `t_feature` does not match this MAX → the server did not recompute properly. Check api/predictions.js POST handler.

### 7.9 Leakage check

For each new prediction, verify that NO source timestamp is strictly greater than `t_prediction`:

```sql
SELECT
  id,
  t_prediction,
  (feature_snapshot->'odds'->>'source_timestamp')::timestamptz AS odds_ts,
  (feature_snapshot->'standings'->>'source_timestamp')::timestamptz AS standings_ts,
  (feature_snapshot->'form'->>'source_timestamp')::timestamptz AS form_ts,
  (feature_snapshot->'h2h'->>'source_timestamp')::timestamptz AS h2h_ts,
  CASE
    WHEN (feature_snapshot->'odds'->>'source_timestamp')::timestamptz > t_prediction
      THEN 'LEAK: odds'
    WHEN (feature_snapshot->'standings'->>'source_timestamp')::timestamptz > t_prediction
      THEN 'LEAK: standings'
    WHEN (feature_snapshot->'form'->>'source_timestamp')::timestamptz > t_prediction
      THEN 'LEAK: form'
    WHEN (feature_snapshot->'h2h'->>'source_timestamp')::timestamptz > t_prediction
      THEN 'LEAK: h2h'
    ELSE 'NO_LEAK'
  END AS leak_check
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected: `LEAK_CHECK = NO_LEAK`.

If any `LEAK: ...` → **NO-GO** for this prediction. The system saved a snapshot with future data.

---

## 8. IMMUTABILITY TEST — REAL PATCH ATTEMPT

> Use ONE new prediction (with `scientific_collection_eligible = TRUE` if possible, otherwise any with a non-null scientific field).

### 8.1 Read the current value (BEFORE)

```sql
-- Replace :uuid with the prediction's UUID
SELECT
  id,
  t_feature,
  scientific_collection_eligible,
  version_freeze->>'model_version' AS vf_model,
  ai_response_hash
FROM predictions
WHERE id = ':uuid'::uuid;
```

Record:

```text
BEFORE_T_FEATURE              = ____________________
BEFORE_SCIENTIFIC_ELIGIBLE    = ____________________
BEFORE_VF_MODEL               = ____________________
BEFORE_AI_RESPONSE_HASH       = ____________________
```

### 8.2 Attempt an illegal PATCH (value → different value)

```bash
# You need a valid auth token (HMAC device token OR user session token)
# Replace :uuid, :auth_token, :production_url with actual values

curl -X PATCH "$PRODUCTION_URL/api/predictions" \
  -H "Authorization: Device :auth_token" \
  -H "Content-Type: application/json" \
  -d '{
    "prediction_id": ":uuid",
    "t_feature": "2099-12-31T23:59:59Z"
  }'
```

> The PATCH endpoint requires authentication. Use the same token the app uses.

### 8.3 Expected behavior

```text
HTTP_STATUS = 409
BODY        = {
  "success": false,
  "error": "All attempted updates are blocked by immutability rules (field already set)",
  "blocked_updates": [
    { "field": "t_feature", "reason": "FIELD_ALREADY_SET — only NULL → value is allowed (initial enrichment)" }
  ]
}
```

If `HTTP_STATUS = 200` → **NO-GO** — immutability trigger is NOT working.

### 8.4 Verify the value is UNCHANGED (AFTER)

```sql
SELECT
  t_feature,
  scientific_collection_eligible,
  version_freeze->>'model_version',
  ai_response_hash
FROM predictions
WHERE id = ':uuid'::uuid;
```

Expected: identical to BEFORE values.

### 8.5 Verify the violation was logged

```sql
SELECT
  violation_type,
  old_value,
  new_value,
  attempted_by,
  blocked,
  detected_at
FROM snapshot_immutability_violations
WHERE prediction_id = ':uuid'::uuid
ORDER BY detected_at DESC
LIMIT 5;
```

Expected: at least 1 row with `violation_type = 't_feature_change'`, `blocked = TRUE`, `attempted_by = 'trigger'`.

> **Mark this violation as `EXPECTED_TEST_VIOLATION`** in your audit notes. Do NOT confuse it with a spontaneous production violation.

### 8.6 Test value → NULL (trigger blocking — requires DIRECT SQL, NOT PATCH)

> **Phase 5.3.10 CORRECTION** : The PATCH endpoint's `tryUpdate()` helper **silently skips null values** — sending `{"t_feature": null}` does NOT enqueue any update and does NOT reach the DB trigger. The previous version of this section incorrectly claimed that a PATCH with `null` would return HTTP 409 with `blocked_updates` populated. In reality, the PATCH returns HTTP 409 with an **empty** `blocked_updates` array (because no field was actually attempted — the null value was filtered out before the existing-value check).

#### 8.6.1 Why PATCH cannot test value → NULL

The PATCH `tryUpdate(fieldName, newValue)` helper (in `api/predictions.js`) does this:

```javascript
const tryUpdate = (fieldName, newValue) => {
    if (newValue === undefined || newValue === null) return; // ← SILENT SKIP
    if (isSet(current[fieldName])) {
        blockedUpdates.push({...});
        return;
    }
    updates.push(...);
};
```

If you send `{"t_feature": null}`, the helper returns immediately without adding to either `updates` or `blockedUpdates`. No SQL `UPDATE` reaches the database. The trigger's value→NULL blocking rule (Rule 11 in migration 010) is **never exercised** via the PATCH API.

The HTTP response is HTTP 409 with `blocked_updates: []` (empty array) and an error message saying "All attempted updates are blocked by immutability rules" — which is misleading because nothing was actually attempted.

#### 8.6.2 To truly test value → NULL blocking — use direct SQL UPDATE

To exercise the trigger's value→NULL rule, run a direct SQL `UPDATE` against the DB:

```bash
# ⚠️ Execute ONLY on a SMOKE TEST prediction (created_at >= SMOKE_TEST_START_UTC).
# NEVER execute on a historical prediction.

psql "$NEON_DATABASE_URL" -c "
UPDATE predictions
SET t_feature = NULL
WHERE id = '<smoke-test-uuid>'::uuid
RETURNING id, t_feature;
"
```

Expected: the UPDATE is **blocked** by the trigger (Rule 11 fires). The `RETURNING` clause returns the **original** value (the trigger restores `NEW.t_feature = OLD.t_feature`). The query succeeds without modifying the row, but a violation is logged.

#### 8.6.3 Verify the violation was logged

```sql
SELECT
  violation_type,
  old_value,
  new_value,
  attempted_by,
  blocked,
  detected_at
FROM snapshot_immutability_violations
WHERE prediction_id = '<smoke-test-uuid>'::uuid
  AND violation_type = 't_feature_change'
ORDER BY detected_at DESC
LIMIT 5;
```

Expected: at least 1 row with `violation_type = 't_feature_change'`, `blocked = TRUE`, `attempted_by = 'trigger'`, `old_value = <original_t_feature>`, `new_value = NULL`.

#### 8.6.4 Verify the value is UNCHANGED

```sql
SELECT t_feature FROM predictions WHERE id = '<smoke-test-uuid>'::uuid;
```

Expected: `t_feature` is still the **original** value (the UPDATE did not modify it).

> Mark this violation as `EXPECTED_TEST_VIOLATION` in your audit notes — do NOT confuse it with spontaneous production violations.

### 8.7 Test NULL → value (may be N/A for normal flow predictions)

> **Phase 5.3.10 CORRECTION** : For predictions created via the normal flow (`analyze-match` → POST `/api/predictions` with the full `ai_traces` payload), **ALL scientific fields are populated at INSERT time** — there are no NULL fields to test the NULL → value PATCH path on. This is by design: the trace is built once by `computeAITraces()` and sent with the POST. There is no separate enrichment step in the current flow.

#### 8.7.1 When NULL → value is testable

NULL → value PATCH is testable only in these scenarios:

1. **Prediction that failed mid-creation** — e.g., Groq timed out before the trace was built. The POST may have inserted a row with `ai_response_hash = NULL` (if the POST handler ran before the trace was complete).
2. **Manually crafted test prediction** — insert a test row via SQL with minimal fields, then PATCH to add a scientific field.
3. **Skip the test** — if no naturally NULL field is found, mark NULL → value as `N/A` in the audit notes.

#### 8.7.2 If you find a NULL field — test it

If `BEFORE_T_FEATURE = NULL` (i.e., the prediction has no source timestamps):

```bash
curl -X PATCH "$PRODUCTION_URL/api/predictions" \
  -H "Authorization: Device :auth_token" \
  -H "Content-Type: application/json" \
  -d '{
    "prediction_id": ":uuid",
    "completeness_score": 0.85
  }'
```

Expected: HTTP 200, `completeness_score` updated from NULL to 0.85.

#### 8.7.3 If no NULL field is found — document as N/A

```text
NULL → VALUE PATCH TEST = N/A
Reason: All scientific fields were populated at INSERT time (normal flow).
        No NULL field available to test the enrichment path.
Impact: The trigger's NULL → value rule (which allows enrichment) is not
        exercised. This is acceptable — the rule is exercised implicitly
        by every new prediction's INSERT (which sets all fields from NULL
        to value in a single statement).
```

> **Do NOT create an artificial prediction solely to satisfy this test.** Do NOT INSERT a test row in production `predictions` table to manufacture a NULL field. If the normal flow doesn't produce a NULL field, document it as N/A.

### 8.8 Check all violations are intentional

```sql
SELECT
  COUNT(*) AS total_violations,
  COUNT(*) FILTER (WHERE detected_at >= :smoke_test_start_utc) AS post_smoke_violations,
  COUNT(*) FILTER (WHERE violation_type IN ('t_feature_change', 'scientific_eligible_change')) AS test_violations
FROM snapshot_immutability_violations;
```

If `post_smoke_violations` > `test_violations` → unexpected violations occurred. Investigate each one.

---

## 9. NEON AUDIT SCRIPTS — FINAL RUN

After the smoke test and immutability test, run the read-only Python audit scripts to cross-check:

```bash
# Re-run OAuth if the token has expired (>1 hour since last refresh)
python3 scripts/neon-mcp-oauth.py    # only if needed

# List all projects and tools
python3 scripts/neon-mcp-audit.py

# Forensic audit on the 15 most recent scientific predictions
python3 scripts/neon-forensic-audit.py

# End-to-end timeline audit
python3 scripts/neon-mcp-e2e-audit.py
```

> ⚠️ If `scripts/neon-mcp-e2e-audit.py` has hardcoded `PROJECT_ID`, `BRANCH_ID`, or `DATABASE` that don't match your current production Neon project, edit the script locally to use the correct values from §0.3, OR run the equivalent SQL queries directly in Neon SQL Editor.

Compare the scripts' output with the manual SQL results from §6, §7, §8. They MUST match.

If the scripts can't run (e.g., `fastmcp` not installed, OAuth fails):

```text
NEON AUDIT SCRIPT = NOT AVAILABLE
```

→ Fall back to manual SQL queries in Neon SQL Editor (Methods 1 or 2 from §3.1).

---

## 10. LEGACY DATA CLASSIFICATION

For ALL rows where `created_at < SMOKE_TEST_START_UTC`:

```sql
SELECT
  COUNT(*) AS legacy_total,
  COUNT(*) FILTER (WHERE t_prediction = created_at) AS legacy_t_prediction,
  COUNT(*) FILTER (WHERE provenance_status = 'PARTIALLY_VALID' AND ai_prompt_version IS NULL) AS legacy_provenance_upgrade,
  COUNT(*) FILTER (WHERE ai_prompt_version = '7.0' AND ai_response_hash IS NULL) AS legacy_ai_fabricated,
  COUNT(*) FILTER (WHERE feature_snapshot IS NULL) AS legacy_no_snapshot
FROM predictions
WHERE created_at < '2026-__-__T__:__:__Z'::timestamptz;  -- SMOKE_TEST_START_UTC
```

These rows MUST be excluded from any scientific backtest. Refer to `docs/HISTORICAL_DATA_POLICY.md` for the SQL filter:

```sql
-- Scientific backtest filter (only post-Phase-5 rows)
SELECT * FROM predictions
WHERE
  feature_snapshot IS NOT NULL
  AND t_prediction IS NOT NULL
  AND t_prediction != created_at
  AND (
    (ai_context_hash IS NULL AND ai_input_hash IS NULL
     AND ai_prompt_hash IS NULL AND ai_response_hash IS NULL)
    OR
    (ai_context_hash IS NOT NULL AND ai_input_hash IS NOT NULL
     AND ai_prompt_hash IS NOT NULL AND ai_response_hash IS NOT NULL)
  )
  AND provenance_status IN ('RECORDED', 'RECONSTRUCTED', 'UNKNOWN', 'UNSAFE')
  AND created_at >= '2026-__-__T__:__:__Z'::timestamptz;  -- SMOKE_TEST_START_UTC
```

> **Rule**: a row is scientifically valid ONLY if it was inserted AFTER the Phase 5 forensic fix was deployed AND has all the required fields.

---

## 11. RULE: ABSENT ≠ FALSE

The audit kit explicitly reminds:

```text
ABSENT ≠ FALSE                 (NULL is not a verdict — it is the absence of proof)
UNKNOWN ≠ VALIDATED            (UNKNOWN must not be silently promoted)
NULL ≠ ERROR                   (NULL is a valid state when no data exists)
LEGACY ≠ SCIENTIFICALLY VALIDATED  (legacy rows are HISTORICAL / NOT VALIDATED)
HASH PRESENT ≠ LLM RESPONSE VERIFIED  (a hash can be a placeholder — verify the source)
TEST PASS ≠ PRODUCTION VALIDATION     (local tests are necessary but not sufficient)
```

---

## 12. NO MODEL MODIFICATION — VERIFICATION

Before concluding the audit, verify that NO model file was modified during this audit:

```bash
cd /path/to/repo
git status
git log -1 --name-only
git diff --stat HEAD
```

Expected:

```text
On branch main
nothing to commit, working tree clean
HEAD = 3dce633 Phase 5 forensic fix: 12 bugs corrected, migration 010, tests green
```

If `git status` shows any modified file → **STOP** — the audit inadvertently modified a file. Investigate.

If the audit discovered a new bug → **DOCUMENT IT in a separate issue, DO NOT FIX IN THIS PHASE**.

---

## 13. GO / NO-GO — 14 CRITERIA GRID

Fill in the grid based on observed evidence ONLY:

| #  | Critère                   | Statut | Concrete proof (URL / UUID / SQL result) |
|----|---------------------------|--------|------------------------------------------|
| 1  | Code                      | PASS / FAIL / UNKNOWN | Commit `3dce633` on `origin/main`, 13 files changed |
| 2  | Tests                     | PASS / FAIL / UNKNOWN | 1141/1141 tests pass locally (211+930) |
| 3  | Build                     | PASS / FAIL / UNKNOWN | Vite build OK, PWA precache 60 entries |
| 4  | Migration 010             | PASS / FAIL / UNKNOWN | Trigger active post-migration (`tgenabled = O`), function has 9 new rules |
| 5  | Neon                      | PASS / FAIL / UNKNOWN | Production Neon project identified, all queries executed |
| 6  | Timeline                  | PASS / FAIL / UNKNOWN | All new predictions have `timeline_status = VERIFIED` OR `T_FEATURE_UNKNOWN` |
| 7  | Provenance                | PASS / FAIL / UNKNOWN | All new predictions have `provenance_status IN (RECORDED, RECONSTRUCTED, UNKNOWN, UNSAFE)` |
| 8  | Immutability              | PASS / FAIL / UNKNOWN | PATCH value→value returned 409, value unchanged after, violation logged |
| 9  | AI Trace                  | PASS / FAIL / UNKNOWN | For LLM-used predictions: 4 hashes non-null + ai_trace non-null. For math-v2: ai_response_hash IS NULL |
| 10 | Hash Chain                | PASS / FAIL / UNKNOWN | Stored hash = recomputed hash for at least one prediction (via neon-forensic-audit.py) |
| 11 | No Leakage                | PASS / FAIL / UNKNOWN | All new predictions have `leak_check = NO_LEAK` |
| 12 | No Fabricated Timestamps  | PASS / FAIL / UNKNOWN | `t_feature` is NULL when no source timestamps OR equals MAX(source_timestamps) |
| 13 | No Historical Fabrication | PASS / FAIL / UNKNOWN | Pre/post migration counters IDENTICAL — no row modified by migration 010 |
| 14 | Production Smoke Test     | PASS / FAIL / UNKNOWN | 3-10 new predictions generated, each passes §7 checks |

### Final verdict

```text
SCIENTIFIC_COLLECTION = READY
```

**UNIQUEMENT SI** : all 14 criteria are `PASS`.

**OTHERWISE**:

```text
SCIENTIFIC_COLLECTION = NOT READY
```

with the list of BLOCKERS:

```text
BLOCKERS:
1. <criterion #>: <missing proof> — <cause> — <action required>
2. ...
```

### Strict rule

- A `PASS` requires concrete proof (URL, UUID, SQL result, file path).
- A `UNKNOWN` is NOT a `PASS`.
- A `PARTIAL` (local OK, production not verified) is NOT a `PASS`.
- "Tests pass" is necessary but NOT sufficient — it does not prove production state.

---

## 14. SUMMARY — SINGLE-PAGE OUTPUT

After completing all steps, the operator returns this single block:

```text
==================================================
AUDIT KIT 5.3.8 — FINAL OUTPUT
==================================================

REPOSITORY:
  Commit:        3dce63385cab431a501c9e20c90b5471140d0c16
  Branch:        main
  Working tree:  clean
  Tests:         1141/1141 (211 frontend + 930 API), 0 fail
  Build:         PASS (Vite 8.2.1, PWA v1.3.0, 60 precache entries)
  Model integrity: PRESERVED (no prediction-engine/prediction-config/SYSTEM_PROMPT modified)

VERCEL:
  Deployment verification procedure: §2.1 (Option A or B)
  History chunk verification: §2.2.2 — Content-Type: application/javascript
  Shop chunk verification:    §2.2.3 — Content-Type: application/javascript
  Deployment status: READY / BUILDING / ERROR / NOT VERIFIED

NEON:
  Connection method: §3.1 (psql / SQL Editor / MCP Python)
  Project:           ____________________
  Branch:            ____________________
  Database:          ____________________
  Production branch: ____________________

MIGRATION 010:
  Syntax/local validation: PASS (9 new fields covered, 0 backfill, 0 ALTER)
  Production application procedure: §4.1 (psql) or §4.2 (SQL Editor)
  Trigger verification post-migration: §5.1 (tgenabled = O), §5.2 (9 new rules present)

SMOKE TEST:
  Start UTC:               ____________________
  End UTC:                 ____________________
  Number of predictions:   _____ (3-10)
  UUIDs:                   ____________________

SCIENTIFIC CHECKS:
  Timeline:                PASS / FAIL / UNKNOWN
  Provenance:              PASS / FAIL / UNKNOWN
  AI trace:                PASS / FAIL / UNKNOWN
  Hash chain:              PASS / FAIL / UNKNOWN
  Leakage:                 PASS / FAIL / UNKNOWN
  Immutability:            PASS / FAIL / UNKNOWN (PATCH value→value returned 409)
  Historical integrity:    PASS / FAIL / UNKNOWN (pre/post-migration counters identical)

14 CRITERIA: _____ / 14 PASS

==================================================
SCIENTIFIC_COLLECTION
==================================================

READY
or
NOT READY

BLOCKERS:
1. ____________________________________
2. ____________________________________
```

---

## APPENDIX A — Predictions table schema (for reference)

Full list of scientific columns in `predictions` (added by migrations 006, 007, 008, 009):

```text
feature_snapshot             JSONB
feature_snapshot_hash        TEXT
prediction_hash              TEXT
snapshot_timestamp           TIMESTAMPTZ
provenance_status            TEXT
model_version                TEXT
feature_version              TEXT
config_version               TEXT
calibration_version          TEXT
dataset_version              TEXT
t_prediction                 TIMESTAMPTZ
t_feature                    TIMESTAMPTZ
completeness_score           REAL
temporal_safety_score        REAL
temporal_safety_reason      TEXT
timestamp_provenance        JSONB
ai_provenance_risk           TEXT
ai_context_hash              TEXT
ai_input_hash                TEXT
ai_prompt_hash               TEXT
ai_response_hash             TEXT
ai_prompt_version            TEXT
ai_model                     TEXT
ai_trace                     JSONB
scientific_collection_eligible  BOOLEAN
version_freeze               JSONB
dataset_split                TEXT
```

Legacy values present in DB (from migrations 007/008 backfills — IRREVERSIBLE, documented as LEGACY):

```text
provenance_status = 'VALID' | 'PARTIALLY_VALID' | 'INVALID' | 'UNKNOWN' (migration 006/007 enum)
t_prediction = created_at (for pre-migration-007 rows)
ai_prompt_version = '7.0', ai_model = 'qwen/qwen3.8-27b' (for rows with snapshot but no real AI trace)
```

Canonical values for new predictions (per Phase 5 forensic fix):

```text
provenance_status = 'RECORDED' | 'RECONSTRUCTED' | 'UNKNOWN' | 'UNSAFE'
t_prediction = T_prediction_final (computed, NOT created_at)
ai_response_hash = NULL when no real LLM responded
version_freeze.model_version = '2.0.0'
version_freeze.feature_version = '1.0.0'
version_freeze.config_version = '1.0.0'
version_freeze.calibration_version = '0.0.0'
version_freeze.dataset_version = 'unversioned'
```

## APPENDIX B — Tables to inspect

| Table | Purpose | Read-only? |
|-------|---------|-----------|
| `predictions` | Main predictions table (30+ columns) | YES — for audit |
| `snapshot_immutability_violations` | Trigger-blocked UPDATE attempts | YES — for audit |
| `snapshot_audit_log` | Snapshot lifecycle events | YES — for audit |
| `device_secrets` | HMAC device tokens | YES — verify device exists |
| `early_alerts` | Early alerts cache | (not needed for audit) |
| `user_accounts` | User accounts | (not needed for audit) |
| `access_codes` | Premium access codes | (not needed for audit) |

**NEVER** run `TRUNCATE`, `DROP`, or `DELETE` on any table during this audit.

## APPENDIX C — References

- `AUDIT_FORENSIQUE_RAPPORT.md` — initial forensic audit (12 bugs documented)
- `CORRECTION_RAPPORT.md` — Phase 5 forensic fix report (12 bugs corrected)
- `docs/HISTORICAL_DATA_POLICY.md` — LEGACY row classification + backtest exclusion SQL
- `api/_migrations/010_scientific_integrity.sql` — migration applied in this audit
- `api/_migrations/006_feature_snapshot.sql` — original feature_snapshot schema
- `api/_migrations/007_snapshot_immutability.sql` — original trigger
- `api/_migrations/008_ai_context_integrity.sql` — AI hash columns
- `api/_migrations/009_temporal_provenance_audit.sql` — temporal_safety_reason + timestamp_provenance
