// api/_lib/normalize-expected-start.js
//
// Phase 5.3.49 — Sentinel normalization for Sporty expectedStart.
//
// BACKGROUND:
//   Phase 5.3.48 forensic audit proved that Sporty API returns the literal
//   string "0001-01-01T00:00:00Z" as m.expectedStart for every audited match
//   (34/34 matches across leagues 8065 + 8035). This is a sentinel, not a
//   real kickoff time. The string is TRUTHY and a syntactically valid ISO
//   8601 cast target, so PostgreSQL silently stored it as
//   `0001-01-01 00:00:00+00`, polluting the expected_start column with
//   false temporal evidence (10 rows in production).
//
// SINGLE-BOUNDARY FIX:
//   This module is the ONLY normalization point. The downstream chain:
//     fetch-live.js L479:  kickoff = normalizeExpectedStart(m.expectedStart)
//     LiveMatches.tsx L434: expected_start = match.kickoff || undefined
//     api/predictions.js L71: body.expected_start || null
//   already correctly converts '' → undefined → null → SQL NULL.
//
// SUBSTITUTION PROHIBITED (Phase 5.3.49 Rule 1):
//   This function NEVER substitutes created_at, t_prediction, Date.now(),
//   local/server time, or any artificial value. When Sporty returns the
//   sentinel, the result is '', which the downstream chain converts to
//   SQL NULL. B3 remains BLOCKED_BY_SOURCE_DATA until Sporty provides
//   a real kickoff.
//
// SCOPE:
//   - Recognize Sporty's year-0001 sentinel (and timezone-equivalent variants)
//   - Reject empty / non-string / unparseable values
//   - Preserve any real ISO 8601 kickoff time (e.g., "2026-10-01T15:00:00Z")
//
// NOT IN SCOPE:
//   - Range-checking the date against "current time" (would be over-engineering)
//   - Validating that the kickoff is in the future (out of scope for B3)
//   - Cross-validating against round-level expectedStart

// Anchored regex — matches "0001-01-01" at the start of the string,
// followed by anything (e.g., "T00:00:00Z", "T00:00:00+00:00", "", etc.).
// Case-insensitive to tolerate "0001-01-01t00:00:00z" variants.
const SENTINEL_YEAR_0001_RE = /^0001-01-01/i;

/**
 * Normalize Sporty's expectedStart into a valid ISO string or ''.
 *
 * Returns:
 *   - '' for: undefined, null, non-string, empty, whitespace-only,
 *             year-0001 sentinel (any ISO 8601 variant), unparseable strings
 *   - the (trimmed) original string for any other valid ISO 8601 date
 *
 * Never returns null or undefined — only a string.
 *
 * @param {unknown} value - raw m.expectedStart from Sporty API response
 * @returns {string} valid ISO 8601 timestamp, or '' if sentinel/invalid/empty
 */
export function normalizeExpectedStart(value) {
  // Step 1 — type guard. Only strings can be ISO timestamps.
  if (typeof value !== 'string') {
    return '';
  }

  // Step 2 — trim. Empty after trim means no usable value.
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  // Step 3 — sentinel detection. Sporty emits "0001-01-01T00:00:00Z" (or
  // timezone-equivalent variants like "0001-01-01T00:00:00+00:00"). All
  // ISO 8601 dates for year 0001 are sentinels — there is no plausible
  // football kickoff in year 1 AD.
  if (SENTINEL_YEAR_0001_RE.test(trimmed)) {
    return '';
  }

  // Step 4 — parseability. A valid kickoff must produce a real JS Date.
  // NOTE: parseability is necessary but NOT sufficient for scientific
  // validity. The year-0001 sentinel IS technically parseable — that's why
  // step 3 explicitly catches it first. Step 4 catches "not-a-date",
  // "garbage", and other malformed strings.
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  // Pass-through — the value is a real ISO 8601 kickoff time.
  return trimmed;
}
