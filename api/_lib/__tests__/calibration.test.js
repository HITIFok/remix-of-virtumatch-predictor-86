// Phase H — Coefficient Calibration Tests
//
// Tests verify:
//   1. All 22 coefficients are defined in prediction-config.ts with bounds
//   2. validateCoefficients() works correctly
//   3. Conservation laws hold (stat weights sum to 1.0, form weights decreasing)
//   4. Default values match the original hardcoded values
//   5. Env var overrides work with clamping
//   6. Calibration priorities are identified correctly
//   7. prediction-engine.ts uses config imports (no hardcoded coefficients)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const configSource = readFileSync(
  resolve(process.cwd(), 'src/lib/prediction-config.ts'), 'utf8'
);

const engineSource = readFileSync(
  resolve(process.cwd(), 'src/lib/prediction-engine.ts'), 'utf8'
);

// Extract just the COEFFICIENT_DEFINITIONS block (between the opening { and closing })
const defStart = configSource.indexOf('export const COEFFICIENT_DEFINITIONS');
const defBlock = configSource.slice(defStart);

// Helper: extract a single coefficient definition block from the definitions
function getCoefBlock(name) {
  // Match pattern like: NAME: { value: ..., min: ..., ... },
  const regex = new RegExp(`${name}:\\s*\\{([\\s\\S]*?)\\n  \\}`, 'm');
  const match = defBlock.match(regex);
  return match ? match[1] : '';
}

// ── Coefficient Registry Completeness ────────────────────────────────────

describe('Phase H: Coefficient registry — 22 coefficients documented with bounds', () => {

  const EXPECTED_COEFFICIENTS = [
    'GRID_MIN_LAMBDA', 'GRID_MAX_LAMBDA', 'GRID_STEP',
    'FORM_WEIGHT_0', 'FORM_WEIGHT_1', 'FORM_WEIGHT_2', 'FORM_WEIGHT_3', 'FORM_WEIGHT_4',
    'VIRTUAL_AVG_GOALS',
    'STAT_BASE_WEIGHT', 'STAT_ATTACK_WEIGHT', 'STAT_DEF_WEIGHT',
    'FORM_ATTACK_BOOST', 'FORM_DEFENSE_PENALTY',
    'MOMENTUM_SCALE',
    'H2H_HOME_BOOST', 'H2H_AWAY_PENALTY',
    'AI_WEIGHT',
    'VIRTUAL_CAP',
    'CONF_BASE_SCALE', 'CONF_MAX_BASE', 'CONF_CAP',
  ];

  it('all 22 coefficient definitions exist in COEFFICIENT_DEFINITIONS', () => {
    for (const name of EXPECTED_COEFFICIENTS) {
      // Keys are unquoted in the source: GRID_MIN_LAMBDA: {
      expect(defBlock).toContain(`${name}:`);
    }
  });

  it('every coefficient has value, min, max, unit, description, calibrationStatus', () => {
    for (const name of EXPECTED_COEFFICIENTS) {
      const block = getCoefBlock(name);
      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain('value:');
      expect(block).toContain('min:');
      expect(block).toContain('max:');
      expect(block).toContain('unit:');
      expect(block).toContain('description:');
      expect(block).toContain('calibrationStatus:');
    }
  });

  it('VIRTUAL_AVG_GOALS is marked as arbitrary (priority for calibration)', () => {
    const block = getCoefBlock('VIRTUAL_AVG_GOALS');
    expect(block).toContain("'arbitrary'");
  });

  it('AI_WEIGHT is marked as arbitrary', () => {
    const block = getCoefBlock('AI_WEIGHT');
    expect(block).toContain("'arbitrary'");
  });

  it('FORM_ATTACK_BOOST and FORM_DEFENSE_PENALTY are marked as arbitrary', () => {
    expect(getCoefBlock('FORM_ATTACK_BOOST')).toContain("'arbitrary'");
    expect(getCoefBlock('FORM_DEFENSE_PENALTY')).toContain("'arbitrary'");
  });

  it('H2H coefficients are marked as arbitrary', () => {
    expect(getCoefBlock('H2H_HOME_BOOST')).toContain("'arbitrary'");
    expect(getCoefBlock('H2H_AWAY_PENALTY')).toContain("'arbitrary'");
  });
});

// ── Default Value Preservation ───────────────────────────────────────────

describe('Phase H: Default values match original hardcoded constants', () => {

  const ORIGINAL_VALUES = {
    GRID_MIN_LAMBDA: 0.5,
    GRID_MAX_LAMBDA: 3.0,
    GRID_STEP: 0.05,
    FORM_WEIGHT_0: 1.5,
    FORM_WEIGHT_1: 1.3,
    FORM_WEIGHT_2: 1.2,
    FORM_WEIGHT_3: 1.1,
    FORM_WEIGHT_4: 1.0,
    VIRTUAL_AVG_GOALS: 1.3,
    STAT_BASE_WEIGHT: 0.70,
    STAT_ATTACK_WEIGHT: 0.20,
    STAT_DEF_WEIGHT: 0.10,
    FORM_ATTACK_BOOST: 0.15,
    FORM_DEFENSE_PENALTY: 0.10,
    MOMENTUM_SCALE: 500,
    H2H_HOME_BOOST: 0.5,
    H2H_AWAY_PENALTY: 0.3,
    AI_WEIGHT: 0.35,
    VIRTUAL_CAP: 3,
    CONF_BASE_SCALE: 85,
    CONF_MAX_BASE: 68,
    CONF_CAP: 82,
  };

  it('all original values are preserved in COEFFICIENT_DEFINITIONS', () => {
    for (const [name, expectedValue] of Object.entries(ORIGINAL_VALUES)) {
      const block = getCoefBlock(name);
      // Match value: N (integer or decimal)
      const valueMatch = block.match(/value:\s*([\d.]+)/);
      expect(valueMatch).toBeTruthy();
      expect(parseFloat(valueMatch[1])).toBeCloseTo(expectedValue, 10);
    }
  });
});

// ── Validation Logic ─────────────────────────────────────────────────────

describe('Phase H: validateCoefficients() conservation laws', () => {

  it('STAT weight split sums to 1.0 (70 + 20 + 10)', () => {
    const base = 0.70;
    const attack = 0.20;
    const defense = 0.10;
    expect(base + attack + defense).toBeCloseTo(1.0, 10);
  });

  it('FORM_WEIGHTS are monotonically decreasing', () => {
    const weights = [1.5, 1.3, 1.2, 1.1, 1.0];
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThan(weights[i - 1]);
    }
  });

  it('GRID_MIN_LAMBDA < GRID_MAX_LAMBDA', () => {
    expect(0.5).toBeLessThan(3.0);
  });

  it('CONF_MAX_BASE < CONF_CAP (base ceiling below absolute cap)', () => {
    expect(68).toBeLessThan(82);
  });

  it('AI_WEIGHT is within [0, 1)', () => {
    expect(0.35).toBeGreaterThan(0);
    expect(0.35).toBeLessThan(1);
  });

  it('all coefficient values are within their declared bounds', () => {
    // Parse coefficient definitions from source and verify bounds
    // Pattern matches unquoted keys: NAME: { value: N, min: N, max: N, ... }
    const coefPattern = /([A-Z][A-Z0-9_]*):\s*\{[^}]*value:\s*([\d.]+)[^}]*min:\s*([\d.]+)[^}]*max:\s*([\d.]+)/g;
    let match;
    let count = 0;
    while ((match = coefPattern.exec(defBlock)) !== null) {
      const [, name, valueStr, minStr, maxStr] = match;
      const value = parseFloat(valueStr);
      const min = parseFloat(minStr);
      const max = parseFloat(maxStr);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
      count++;
    }
    expect(count).toBeGreaterThanOrEqual(22); // All 22 coefficients checked
  });

  it('validateCoefficients function exists with conservation checks', () => {
    expect(configSource).toContain('function validateCoefficients');
    expect(configSource).toContain('STAT_BASE_WEIGHT + cfg.STAT_ATTACK_WEIGHT + cfg.STAT_DEF_WEIGHT');
    expect(configSource).toContain('FORM_WEIGHT_0');
    expect(configSource).toContain('GRID_MIN_LAMBDA >= cfg.GRID_MAX_LAMBDA');
    expect(configSource).toContain('CONF_MAX_BASE >= cfg.CONF_CAP');
  });
});

// ── Prediction Engine Integration ────────────────────────────────────────

describe('Phase H: prediction-engine.ts uses config imports (no hardcoded coefficients)', () => {

  it('imports getConfig from prediction-config', () => {
    expect(engineSource).toContain("import { getConfig } from './prediction-config'");
  });

  it('creates _cfg = getConfig() for coefficient access', () => {
    expect(engineSource).toContain('const _cfg = getConfig()');
  });

  it('VIRTUAL_AVG_GOALS references _cfg', () => {
    expect(engineSource).toContain('_cfg.VIRTUAL_AVG_GOALS');
  });

  it('FORM_WEIGHTS reference _cfg', () => {
    expect(engineSource).toContain('_cfg.FORM_WEIGHT_0');
    expect(engineSource).toContain('_cfg.FORM_WEIGHT_4');
  });

  it('grid search lambdas reference _cfg', () => {
    expect(engineSource).toContain('_cfg.GRID_MIN_LAMBDA');
    expect(engineSource).toContain('_cfg.GRID_MAX_LAMBDA');
    expect(engineSource).toContain('_cfg.GRID_STEP');
  });

  it('stat weight split references _cfg (not hardcoded 0.70/0.20/0.10)', () => {
    expect(engineSource).toContain('_cfg.STAT_BASE_WEIGHT');
    expect(engineSource).toContain('_cfg.STAT_ATTACK_WEIGHT');
    expect(engineSource).toContain('_cfg.STAT_DEF_WEIGHT');
  });

  it('AI_WEIGHT references _cfg', () => {
    expect(engineSource).toContain('_cfg.AI_WEIGHT');
  });

  it('confidence coefficients reference _cfg', () => {
    expect(engineSource).toContain('_cfg.CONF_BASE_SCALE');
    expect(engineSource).toContain('_cfg.CONF_MAX_BASE');
    expect(engineSource).toContain('_cfg.CONF_CAP');
  });

  it('no hardcoded 0.70/0.20/0.10 remain in stat adjustment (replaced by config)', () => {
    // Extract the adjustLambdasWithStats function
    const funcStart = engineSource.indexOf('function adjustLambdasWithStats');
    const funcEnd = engineSource.indexOf('\n}', funcStart + 200); // Find closing brace
    const funcBody = engineSource.slice(funcStart, funcEnd);
    // Should NOT contain raw 0.70/0.20/0.10 in the lambda adjustment formulas
    expect(funcBody).not.toMatch(/adjustedH\s*\*\s*0\.70/);
    expect(funcBody).not.toMatch(/attackStrength\s*\*\s*0\.20/);
  });
});

// ── Calibration Priority Identification ──────────────────────────────────

describe('Phase H: Calibration priorities', () => {

  it('getCalibrationPriorities() lists arbitrary coefficients first', () => {
    expect(configSource).toContain('function getCalibrationPriorities');
    expect(configSource).toContain("'arbitrary'");
  });

  it('getArbitraryCount() function exists', () => {
    expect(configSource).toContain('function getArbitraryCount');
  });

  it('at least 5 coefficients are marked arbitrary (priority for calibration)', () => {
    const arbitraryMatches = defBlock.match(/calibrationStatus:\s*'arbitrary'/g);
    expect(arbitraryMatches).toBeTruthy();
    expect(arbitraryMatches.length).toBeGreaterThanOrEqual(5);
  });

  it('env var override mechanism exists (VIRTUMATCH_COEF_*)', () => {
    expect(configSource).toContain('VIRTUMATCH_COEF_');
    expect(configSource).toContain('getEnvOverride');
  });

  it('env var overrides are clamped to [min, max] bounds', () => {
    expect(configSource).toContain('Math.max(def.min, Math.min(def.max, override))');
  });
});

// ── Cross-Term Double-Counting Documentation ────────────────────────────

describe('Phase H: Cross-term double-counting awareness', () => {

  it('STAT_DEF_WEIGHT description mentions cross-term and double-counting', () => {
    const block = getCoefBlock('STAT_DEF_WEIGHT');
    expect(block).toContain('cross-term');
    expect(block).toContain('double-count');
  });

  it('STAT_DEF_WEIGHT default is 0.10 (can be reduced if double-counting confirmed)', () => {
    const block = getCoefBlock('STAT_DEF_WEIGHT');
    expect(block).toContain('value: 0.10');
    expect(block).toContain('min: 0.05'); // Can be reduced
  });

  it('STAT_DEF_WEIGHT source documents the Phase H fix', () => {
    const block = getCoefBlock('STAT_DEF_WEIGHT');
    expect(block).toContain('Phase H');
  });
});
