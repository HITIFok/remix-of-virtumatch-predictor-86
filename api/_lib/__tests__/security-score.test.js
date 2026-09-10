// Phase AM — Security Score & Compliance Dashboard Tests
import { describe, it, expect } from 'vitest';
import {
  SCORE_DIMENSIONS,
  GRADE_THRESHOLDS,
  computeSecurityScore,
  getGrade,
  getImprovementRecommendations,
  getComplianceSummary,
} from '../security-score.js';

// ─── Score Dimensions ─────────────────────────────────────────────────────

describe('Phase AM: Security Score Dimensions', () => {
  it('has 8 scoring dimensions', () => {
    expect(SCORE_DIMENSIONS.length).toBe(8);
  });

  it('weights sum to 100%', () => {
    const totalWeight = SCORE_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('each dimension has required fields', () => {
    for (const dim of SCORE_DIMENSIONS) {
      expect(dim.id).toBeTruthy();
      expect(dim.name).toBeTruthy();
      expect(dim.weight).toBeGreaterThan(0);
      expect(dim.description).toBeTruthy();
      expect(typeof dim.calculate).toBe('function');
    }
  });

  it('each dimension calculates a valid score', () => {
    for (const dim of SCORE_DIMENSIONS) {
      const result = dim.calculate();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(result.maxScore);
      expect(result.details).toBeTruthy();
    }
  });

  it('all dimensions score at least 70', () => {
    for (const dim of SCORE_DIMENSIONS) {
      const result = dim.calculate();
      expect(result.score).toBeGreaterThanOrEqual(70);
    }
  });
});

// ─── Security Score Computation ───────────────────────────────────────────

describe('Phase AM: Security Score Computation', () => {
  it('computes overall security score', () => {
    const score = computeSecurityScore();
    expect(score.overallScore).toBeGreaterThanOrEqual(70);
    expect(score.overallScore).toBeLessThanOrEqual(100);
  });

  it('includes letter grade', () => {
    const score = computeSecurityScore();
    expect(score.grade).toMatch(/^[A-F][+-]?$/);
    expect(score.gradeLabel).toBeTruthy();
  });

  it('includes all dimension details', () => {
    const score = computeSecurityScore();
    expect(score.dimensions.length).toBe(8);
    for (const dim of score.dimensions) {
      expect(dim.weightedScore).toBeGreaterThan(0);
      expect(dim.details).toBeTruthy();
    }
  });

  it('includes audit metadata', () => {
    const score = computeSecurityScore();
    expect(score.auditPhases).toBeGreaterThanOrEqual(28);
    expect(score.totalTests).toBeGreaterThanOrEqual(700);
    expect(score.testFiles).toBeGreaterThanOrEqual(30);
    expect(score.timestamp).toBeTruthy();
  });

  it('score is at least B+ (80+)', () => {
    const score = computeSecurityScore();
    expect(score.overallScore).toBeGreaterThanOrEqual(80);
  });
});

// ─── Grade Thresholds ─────────────────────────────────────────────────────

describe('Phase AM: Grade Thresholds', () => {
  it('has 9 grade levels', () => {
    expect(GRADE_THRESHOLDS.length).toBe(9);
  });

  it('covers full 0-100 score range', () => {
    expect(getGrade(100).grade).toBe('A+');
    expect(getGrade(0).grade).toBe('F');
  });

  it('correct grade for boundary scores', () => {
    expect(getGrade(95).grade).toBe('A+');
    expect(getGrade(90).grade).toBe('A');
    expect(getGrade(85).grade).toBe('A-');
    expect(getGrade(80).grade).toBe('B+');
    expect(getGrade(75).grade).toBe('B');
    expect(getGrade(70).grade).toBe('B-');
    expect(getGrade(60).grade).toBe('C');
    expect(getGrade(50).grade).toBe('D');
    expect(getGrade(40).grade).toBe('F');
  });

  it('intermediate scores get correct grades', () => {
    expect(getGrade(97).grade).toBe('A+');
    expect(getGrade(82).grade).toBe('B+');
    expect(getGrade(55).grade).toBe('D');
  });
});

// ─── Improvement Recommendations ──────────────────────────────────────────

describe('Phase AM: Improvement Recommendations', () => {
  it('identifies dimensions below 90', () => {
    const recs = getImprovementRecommendations();
    for (const rec of recs) {
      expect(rec.currentScore).toBeLessThan(90);
    }
  });

  it('each recommendation has impact analysis', () => {
    const recs = getImprovementRecommendations();
    for (const rec of recs) {
      expect(rec.dimension).toBeTruthy();
      expect(rec.currentScore).toBeGreaterThan(0);
      expect(rec.impact).toBeTruthy();
    }
  });

  it('recommends at most 3 improvements', () => {
    // getImprovementRecommendations returns all, but compliance summary limits to 3
    const summary = getComplianceSummary();
    expect(summary.topRecommendations.length).toBeLessThanOrEqual(3);
  });
});

// ─── Compliance Summary ───────────────────────────────────────────────────

describe('Phase AM: Compliance Summary', () => {
  it('returns comprehensive compliance dashboard data', () => {
    const summary = getComplianceSummary();
    expect(summary.securityScore).toBeGreaterThanOrEqual(70);
    expect(summary.grade).toBeTruthy();
    expect(typeof summary.owaspCompliant).toBe('boolean');
    expect(summary.vulnsMitigated).toBeTruthy();
    expect(summary.testCoverage).toBeGreaterThanOrEqual(700);
    expect(summary.auditPhases).toBeGreaterThanOrEqual(28);
  });

  it('OWASP is compliant', () => {
    const summary = getComplianceSummary();
    expect(summary.owaspCompliant).toBe(true);
  });

  it('all critical vulnerabilities are mitigated', () => {
    const summary = getComplianceSummary();
    expect(summary.vulnsMitigated).toContain('3/3');
  });
});
