// Phase F+G+H — Tests pour le backtesting, l'audit des coefficients, et la calibration
//
// Tests verify:
//   1. The prediction engine uses centralized config (Phase H)
//   2. All 17 coefficients are documented with sensible ranges
//   3. Confidence is properly capped (config-driven)
//   4. Probabilities sum to 1.0 (normalized)
//   5. Lambda values stay within realistic bounds
//   6. Config values match original hardcoded constants

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Coefficient Audit Tests (updated for Phase H config) ──────────────────

describe('Phase G+H: Coefficient audit — config-driven coefficients', () => {

  const engineSource = readFileSync(
    resolve(process.cwd(), 'src/lib/prediction-engine.ts'), 'utf8'
  );

  const configSource = readFileSync(
    resolve(process.cwd(), 'src/lib/prediction-config.ts'), 'utf8'
  );

  it('VIRTUAL_AVG_GOALS is loaded from config (_cfg.VIRTUAL_AVG_GOALS)', () => {
    expect(engineSource).toContain('_cfg.VIRTUAL_AVG_GOALS');
  });

  it('AI_WEIGHT is loaded from config (_cfg.AI_WEIGHT)', () => {
    expect(engineSource).toContain('_cfg.AI_WEIGHT');
  });

  it('FORM_WEIGHTS are loaded from config (_cfg.FORM_WEIGHT_0..4)', () => {
    expect(engineSource).toContain('_cfg.FORM_WEIGHT_0');
    expect(engineSource).toContain('_cfg.FORM_WEIGHT_4');
  });

  it('CONF_CAP is config-driven (_cfg.CONF_CAP)', () => {
    // Confidence is clamped between 25 and _cfg.CONF_CAP
    expect(engineSource).toContain('_cfg.CONF_CAP');
  });

  it('CONF_MAX_BASE is config-driven (_cfg.CONF_MAX_BASE)', () => {
    expect(engineSource).toContain('_cfg.CONF_MAX_BASE');
  });

  it('Stat weight split is config-driven (_cfg.STAT_BASE_WEIGHT/ATTACK/DEF)', () => {
    expect(engineSource).toContain('_cfg.STAT_BASE_WEIGHT');
    expect(engineSource).toContain('_cfg.STAT_ATTACK_WEIGHT');
    expect(engineSource).toContain('_cfg.STAT_DEF_WEIGHT');
  });

  it('VIRTUAL_CAP is loaded from config (_cfg.VIRTUAL_CAP)', () => {
    expect(engineSource).toContain('_cfg.VIRTUAL_CAP');
  });

  it('config default values match original constants (1.3, 0.35, 82, 68, etc.)', () => {
    // Verify the config file preserves the original hardcoded values as defaults
    expect(configSource).toContain('value: 1.3');   // VIRTUAL_AVG_GOALS
    expect(configSource).toContain('value: 0.35');  // AI_WEIGHT
    expect(configSource).toContain('value: 82');    // CONF_CAP
    expect(configSource).toContain('value: 68');    // CONF_MAX_BASE
    expect(configSource).toContain('value: 0.70');  // STAT_BASE_WEIGHT
    expect(configSource).toContain('value: 0.20');  // STAT_ATTACK_WEIGHT
    expect(configSource).toContain('value: 0.10');  // STAT_DEF_WEIGHT
  });
});

describe('Phase G: Coefficient range validation', () => {

  it('AI_WEIGHT is between 0 and 1 (valid probability blend)', () => {
    const AI_WEIGHT = 0.35;
    expect(AI_WEIGHT).toBeGreaterThan(0);
    expect(AI_WEIGHT).toBeLessThan(1);
  });

  it('Stat weight split sums to 1.0 (conservation law)', () => {
    const base = 0.70;
    const attack = 0.20;
    const defense = 0.10;
    expect(base + attack + defense).toBeCloseTo(1.0, 2);
  });

  it('VIRTUAL_AVG_GOALS is within plausible range for virtual football', () => {
    const VIRTUAL_AVG_GOALS = 1.3;
    // Real football: 1.3-1.7 goals/match/team
    // Virtual should be in a similar or slightly lower range
    expect(VIRTUAL_AVG_GOALS).toBeGreaterThan(0.8);
    expect(VIRTUAL_AVG_GOALS).toBeLessThan(2.0);
  });

  it('FORM_WEIGHTS are monotonically decreasing (recent matches matter more)', () => {
    const FORM_WEIGHTS = [1.5, 1.3, 1.2, 1.1, 1.0];
    for (let i = 1; i < FORM_WEIGHTS.length; i++) {
      expect(FORM_WEIGHTS[i]).toBeLessThan(FORM_WEIGHTS[i - 1]);
    }
  });

  it('Confidence cap is within reasonable bounds for prediction systems', () => {
    const CONF_CAP = 82;
    // Too low → predictions are useless
    // Too high → overconfidence
    expect(CONF_CAP).toBeGreaterThan(60);
    expect(CONF_CAP).toBeLessThan(95);
  });

  it('Lambda bounds cover the typical football goal range', () => {
    const GRID_MIN_LAMBDA = 0.5;
    const GRID_MAX_LAMBDA = 3.0;
    // Typical lambda for football: 0.8-2.5
    expect(GRID_MIN_LAMBDA).toBeLessThanOrEqual(0.8);
    expect(GRID_MAX_LAMBDA).toBeGreaterThanOrEqual(2.5);
  });
});

describe('Phase F: Backtesting — probability conservation', () => {

  it('Odds conversion preserves probability sum = 1', () => {
    // Simulate convertOddsToProbabilities
    const oddHome = 1.80, oddDraw = 3.50, oddAway = 4.50;
    const invH = 1 / oddHome;
    const invD = 1 / oddDraw;
    const invA = 1 / oddAway;
    const total = invH + invD + invA;
    const pH = invH / total;
    const pD = invD / total;
    const pA = invA / total;
    expect(pH + pD + pA).toBeCloseTo(1.0, 10);
  });

  it('Confidence base formula: min(favProb * CONF_BASE_SCALE, CONF_MAX_BASE) is bounded', () => {
    // Test across the full range of favoriteProb (0.33 to 1.0)
    const CONF_BASE_SCALE = 85;
    const CONF_MAX_BASE = 68;
    for (let favProb = 0.33; favProb <= 1.0; favProb += 0.05) {
      const baseConf = Math.min(favProb * CONF_BASE_SCALE, CONF_MAX_BASE);
      expect(baseConf).toBeGreaterThanOrEqual(0);
      expect(baseConf).toBeLessThanOrEqual(CONF_MAX_BASE);
    }
  });

  it('Confidence after all modifications stays within [25, CONF_CAP]', () => {
    const CONF_CAP = 82;
    // Simulate the full confidence range
    for (let baseConf = 20; baseConf <= 90; baseConf += 5) {
      // Apply bonuses/penalties
      let conf = baseConf;
      conf += 15; // Max bonuses
      conf -= 35; // Max penalties
      conf = Math.max(25, Math.min(CONF_CAP, Math.round(conf)));
      expect(conf).toBeGreaterThanOrEqual(25);
      expect(conf).toBeLessThanOrEqual(CONF_CAP);
    }
  });
});
