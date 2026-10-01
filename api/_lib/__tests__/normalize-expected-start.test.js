// api/_lib/__tests__/normalize-expected-start.test.js
//
// Phase 5.3.49 — Unit tests for normalizeExpectedStart()
//
// Covers all 8 mandatory cases from Phase 5.3.49 Rule 14:
//   1. Sentinel exact:              "0001-01-01T00:00:00Z"        → ""
//   2. Sentinel timezone variant:   "0001-01-01T00:00:00+00:00"   → ""
//   3. Null:                        null                          → ""
//   4. Undefined:                   undefined                     → ""
//   5. Empty:                       ""                            → ""
//   6. Invalid:                     "not-a-date"                  → ""
//   7. Valid ISO:                   "2026-10-01T15:00:00Z"        → "2026-10-01T15:00:00Z"
//   8. Valid ISO with offset:       "2026-10-01T18:00:00+03:00"   → "2026-10-01T18:00:00+03:00"

import { describe, it, expect } from 'vitest';
import { normalizeExpectedStart } from '../normalize-expected-start.js';

describe('Phase 5.3.49 — normalizeExpectedStart', () => {
  describe('sentinel recognition (Rule 14 cases 1-2)', () => {
    it('rejects the exact Sporty sentinel "0001-01-01T00:00:00Z"', () => {
      expect(normalizeExpectedStart('0001-01-01T00:00:00Z')).toBe('');
    });

    it('rejects the sentinel with +00:00 offset', () => {
      expect(normalizeExpectedStart('0001-01-01T00:00:00+00:00')).toBe('');
    });

    it('rejects the sentinel without time component (date-only year 0001)', () => {
      expect(normalizeExpectedStart('0001-01-01')).toBe('');
    });

    it('rejects the sentinel case-insensitively (lowercase t/z)', () => {
      expect(normalizeExpectedStart('0001-01-01t00:00:00z')).toBe('');
    });

    it('rejects the sentinel with surrounding whitespace', () => {
      expect(normalizeExpectedStart('  0001-01-01T00:00:00Z  ')).toBe('');
    });
  });

  describe('non-string inputs (Rule 14 cases 3-4 + extensions)', () => {
    it('rejects undefined', () => {
      expect(normalizeExpectedStart(undefined)).toBe('');
    });

    it('rejects null', () => {
      expect(normalizeExpectedStart(null)).toBe('');
    });

    it('rejects a number (0)', () => {
      expect(normalizeExpectedStart(0)).toBe('');
    });

    it('rejects a number (epoch millis)', () => {
      expect(normalizeExpectedStart(1696156800000)).toBe('');
    });

    it('rejects a boolean (false)', () => {
      expect(normalizeExpectedStart(false)).toBe('');
    });

    it('rejects a boolean (true)', () => {
      expect(normalizeExpectedStart(true)).toBe('');
    });

    it('rejects an object', () => {
      expect(normalizeExpectedStart({ iso: '2026-10-01' })).toBe('');
    });

    it('rejects an array', () => {
      expect(normalizeExpectedStart(['2026-10-01T15:00:00Z'])).toBe('');
    });
  });

  describe('empty / whitespace (Rule 14 case 5)', () => {
    it('rejects empty string', () => {
      expect(normalizeExpectedStart('')).toBe('');
    });

    it('rejects a single space', () => {
      expect(normalizeExpectedStart(' ')).toBe('');
    });

    it('rejects a tab', () => {
      expect(normalizeExpectedStart('\t')).toBe('');
    });

    it('rejects multi-space whitespace', () => {
      expect(normalizeExpectedStart('    ')).toBe('');
    });

    it('rejects newline-only string', () => {
      expect(normalizeExpectedStart('\n')).toBe('');
    });
  });

  describe('invalid date strings (Rule 14 case 6)', () => {
    it('rejects "not-a-date"', () => {
      expect(normalizeExpectedStart('not-a-date')).toBe('');
    });

    it('rejects "garbage"', () => {
      expect(normalizeExpectedStart('garbage')).toBe('');
    });

    it('rejects out-of-range components "2026-13-45T99:99:99Z"', () => {
      expect(normalizeExpectedStart('2026-13-45T99:99:99Z')).toBe('');
    });

    it('rejects plain text "tomorrow"', () => {
      expect(normalizeExpectedStart('tomorrow')).toBe('');
    });
  });

  describe('valid ISO 8601 dates (Rule 14 cases 7-8)', () => {
    it('preserves "2026-10-01T15:00:00Z"', () => {
      expect(normalizeExpectedStart('2026-10-01T15:00:00Z'))
        .toBe('2026-10-01T15:00:00Z');
    });

    it('preserves a date with a non-UTC offset (+03:00)', () => {
      expect(normalizeExpectedStart('2026-10-01T18:00:00+03:00'))
        .toBe('2026-10-01T18:00:00+03:00');
    });

    it('preserves a date with a negative offset (-05:00)', () => {
      expect(normalizeExpectedStart('2026-10-01T10:00:00-05:00'))
        .toBe('2026-10-01T10:00:00-05:00');
    });

    it('preserves a date-only ISO 8601 string', () => {
      expect(normalizeExpectedStart('2026-10-01')).toBe('2026-10-01');
    });

    it('trims surrounding whitespace from a valid date', () => {
      expect(normalizeExpectedStart('  2026-10-01T15:00:00Z  '))
        .toBe('2026-10-01T15:00:00Z');
    });

    it('preserves a far-future ISO date (year 2099)', () => {
      expect(normalizeExpectedStart('2099-12-31T23:59:59Z'))
        .toBe('2099-12-31T23:59:59Z');
    });

    it('preserves a recent past ISO date (year 2000)', () => {
      // Year 2000 is the floor of plausibility — it is NOT rejected because
      // it is not the Sporty year-0001 sentinel and is parseable.
      expect(normalizeExpectedStart('2000-01-01T00:00:00Z'))
        .toBe('2000-01-01T00:00:00Z');
    });
  });

  describe('non-regression: downstream chain contract (Rule 15)', () => {
    // These tests confirm that the function NEVER produces a truthy
    // string for any sentinel/invalid input — meaning the downstream
    // chain (match.kickoff || undefined → body.expected_start || null → SQL NULL)
    // will correctly convert all outputs to SQL NULL.

    it('every sentinel variant produces "" (falsy)', () => {
      const sentinelVariants = [
        '0001-01-01T00:00:00Z',
        '0001-01-01T00:00:00+00:00',
        '0001-01-01',
        '0001-01-01t00:00:00z',
        '  0001-01-01T00:00:00Z  ',
      ];
      for (const v of sentinelVariants) {
        const out = normalizeExpectedStart(v);
        expect(out).toBe('');
        expect(Boolean(out)).toBe(false);
      }
    });

    it('every invalid input produces "" (falsy)', () => {
      const invalids = [undefined, null, '', '   ', 'not-a-date', 0, false, {}];
      for (const v of invalids) {
        const out = normalizeExpectedStart(v);
        expect(out).toBe('');
        expect(Boolean(out)).toBe(false);
      }
    });

    it('every valid ISO date produces a truthy string', () => {
      const valids = [
        '2026-10-01T15:00:00Z',
        '2026-10-01T18:00:00+03:00',
        '2026-10-01',
        '2099-12-31T23:59:59Z',
      ];
      for (const v of valids) {
        const out = normalizeExpectedStart(v);
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
        expect(Boolean(out)).toBe(true);
      }
    });
  });
});
