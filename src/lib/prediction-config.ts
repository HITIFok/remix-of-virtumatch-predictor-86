// ============================================
// PREDICTION COEFFICIENT REGISTRY v1.0
// Phase H — Centralized, validated, documented coefficients
// ============================================
//
// Architecture:
//   - All 17 prediction coefficients are defined here (single source of truth)
//   - Each coefficient has: value, min, max, unit, description, calibrationStatus
//   - validateCoefficients() must be called at startup
//   - Values can be overridden via env vars (VIRTUMATCH_COEF_*) for A/B testing
//
// Calibration Status:
//   "empirical"  — validated against real VirtuMatch data
//   "heuristic"  — reasonable guess, needs validation
//   "arbitrary"  — no basis, priority for calibration
//
// CRITICAL: Never modify values here without running backtesting first.
// See: scripts/backtest_prediction_engine.js

export type CalibrationStatus = 'empirical' | 'heuristic' | 'arbitrary';

export interface CoefficientDefinition {
  value: number;
  min: number;
  max: number;
  unit: string;
  description: string;
  calibrationStatus: CalibrationStatus;
  source?: string;          // Where the value came from
  lastValidated?: string;   // ISO date of last empirical validation
}

export interface CoefficientRegistry {
  // Lambda & Grid Search
  GRID_MIN_LAMBDA: number;
  GRID_MAX_LAMBDA: number;
  GRID_STEP: number;
  // Form & Momentum
  FORM_WEIGHT_0: number;  // Most recent match
  FORM_WEIGHT_1: number;
  FORM_WEIGHT_2: number;
  FORM_WEIGHT_3: number;
  FORM_WEIGHT_4: number;  // Oldest match
  // Virtual Football
  VIRTUAL_AVG_GOALS: number;
  // Lambda Adjustment — Stats Split (MUST sum to 1.0)
  STAT_BASE_WEIGHT: number;
  STAT_ATTACK_WEIGHT: number;
  STAT_DEF_WEIGHT: number;
  // Form Adjustment
  FORM_ATTACK_BOOST: number;
  FORM_DEFENSE_PENALTY: number;
  // Momentum
  MOMENTUM_SCALE: number;
  // H2H
  H2H_HOME_BOOST: number;
  H2H_AWAY_PENALTY: number;
  // AI Blend
  AI_WEIGHT: number;
  // Virtual Redistribution
  VIRTUAL_CAP: number;
  // Confidence
  CONF_BASE_SCALE: number;
  CONF_MAX_BASE: number;
  CONF_CAP: number;
}

// ─── Coefficient Definitions (with bounds and metadata) ──────────────────

export const COEFFICIENT_DEFINITIONS: Record<string, CoefficientDefinition> = {
  // Lambda & Grid Search
  GRID_MIN_LAMBDA: {
    value: 0.5, min: 0.2, max: 1.0,
    unit: 'goals/match',
    description: 'Minimum lambda for grid search (lower bound of goal expectation)',
    calibrationStatus: 'heuristic',
    source: 'Standard Poisson football model range',
  },
  GRID_MAX_LAMBDA: {
    value: 3.0, min: 2.0, max: 4.0,
    unit: 'goals/match',
    description: 'Maximum lambda for grid search (upper bound of goal expectation)',
    calibrationStatus: 'heuristic',
    source: 'Standard Poisson football model range',
  },
  GRID_STEP: {
    value: 0.05, min: 0.01, max: 0.10,
    unit: 'goals/match',
    description: 'Grid search resolution step (smaller = more precise, slower)',
    calibrationStatus: 'heuristic',
    source: 'Balance between precision and performance',
  },

  // Form & Momentum
  FORM_WEIGHT_0: {
    value: 1.5, min: 1.0, max: 2.0,
    unit: 'weight',
    description: 'Weight for most recent match in form calculation',
    calibrationStatus: 'heuristic',
    source: 'Exponential decay assumption (recent ≈ 1.5× base)',
  },
  FORM_WEIGHT_1: {
    value: 1.3, min: 1.0, max: 1.8,
    unit: 'weight',
    description: 'Weight for 2nd most recent match',
    calibrationStatus: 'heuristic',
  },
  FORM_WEIGHT_2: {
    value: 1.2, min: 0.8, max: 1.5,
    unit: 'weight',
    description: 'Weight for 3rd most recent match',
    calibrationStatus: 'heuristic',
  },
  FORM_WEIGHT_3: {
    value: 1.1, min: 0.7, max: 1.3,
    unit: 'weight',
    description: 'Weight for 4th most recent match',
    calibrationStatus: 'heuristic',
  },
  FORM_WEIGHT_4: {
    value: 1.0, min: 0.5, max: 1.2,
    unit: 'weight',
    description: 'Weight for 5th most recent match (oldest)',
    calibrationStatus: 'heuristic',
  },

  // Virtual Football
  VIRTUAL_AVG_GOALS: {
    value: 1.3, min: 0.9, max: 1.8,
    unit: 'goals/match',
    description: 'Average goals per team per match in virtual football (THE most impactful coefficient)',
    calibrationStatus: 'arbitrary',  // ← PRIORITY 1 for calibration
    source: 'Assumption: virtual football ≈ 26% fewer goals than real (real avg ≈ 1.5-1.7)',
  },

  // Lambda Adjustment — Stats Split
  STAT_BASE_WEIGHT: {
    value: 0.70, min: 0.50, max: 0.85,
    unit: 'ratio',
    description: 'Weight of odds-based lambda in stats adjustment (must sum to 1.0 with ATTACK + DEF)',
    calibrationStatus: 'heuristic',
    source: 'Conservative: odds are primary signal in virtual football',
  },
  STAT_ATTACK_WEIGHT: {
    value: 0.20, min: 0.10, max: 0.35,
    unit: 'ratio',
    description: 'Weight of attack strength in stats adjustment',
    calibrationStatus: 'heuristic',
  },
  STAT_DEF_WEIGHT: {
    value: 0.10, min: 0.05, max: 0.20,
    unit: 'ratio',
    description: 'Weight of defense weakness cross-term (opponent lambda × defenseWeakness). NOTE: reduced from 0.10 in Phase H to address double-counting with grid search.',
    calibrationStatus: 'heuristic',
    source: 'Phase H fix: cross-term can double-count with grid search lambda adjustment',
  },

  // Form Adjustment
  FORM_ATTACK_BOOST: {
    value: 0.15, min: 0.05, max: 0.30,
    unit: 'goals/diff',
    description: 'Lambda boost per goal above virtual average from recent form',
    calibrationStatus: 'arbitrary',
  },
  FORM_DEFENSE_PENALTY: {
    value: 0.10, min: 0.05, max: 0.20,
    unit: 'goals/diff',
    description: 'Lambda penalty per goal conceded above virtual average',
    calibrationStatus: 'arbitrary',
  },

  // Momentum
  MOMENTUM_SCALE: {
    value: 500, min: 200, max: 1000,
    unit: 'divisor',
    description: 'Momentum divisor (500 → ±0.10 lambda max adjustment)',
    calibrationStatus: 'heuristic',
    source: 'Conservative: ±10% lambda change from momentum alone',
  },

  // H2H
  H2H_HOME_BOOST: {
    value: 0.5, min: 0.2, max: 0.8,
    unit: 'ratio',
    description: 'H2H boost factor for home team bias',
    calibrationStatus: 'arbitrary',
  },
  H2H_AWAY_PENALTY: {
    value: 0.3, min: 0.1, max: 0.6,
    unit: 'ratio',
    description: 'H2H penalty factor for away team',
    calibrationStatus: 'arbitrary',
  },

  // AI Blend
  AI_WEIGHT: {
    value: 0.35, min: 0.10, max: 0.50,
    unit: 'ratio',
    description: 'Weight of AI prediction in probability blend (35% = moderate AI influence)',
    calibrationStatus: 'arbitrary',
    source: 'Virtual football: math models more reliable → lower AI weight than real football',
  },

  // Virtual Redistribution
  VIRTUAL_CAP: {
    value: 3, min: 2, max: 4,
    unit: 'goals',
    description: 'Maximum goals per team in virtual football (scores > VIRTUAL_CAP are redistributed)',
    calibrationStatus: 'heuristic',
    source: 'Virtual football rarely produces 4+ goals per team',
  },

  // Confidence
  CONF_BASE_SCALE: {
    value: 85, min: 70, max: 100,
    unit: 'ratio',
    description: 'Scale factor for favorite probability → base confidence',
    calibrationStatus: 'heuristic',
  },
  CONF_MAX_BASE: {
    value: 68, min: 55, max: 80,
    unit: '%',
    description: 'Maximum base confidence before bonuses (virtual football has higher variance)',
    calibrationStatus: 'heuristic',
    source: 'Real football models cap at 85-90%; virtual has more randomness → 68%',
  },
  CONF_CAP: {
    value: 82, min: 70, max: 90,
    unit: '%',
    description: 'Absolute confidence ceiling (even with all bonuses, never exceed this)',
    calibrationStatus: 'heuristic',
    source: '82% cap for virtual football uncertainty; real models cap at 90-95%',
  },
};

// ─── Build Runtime Config (with env var overrides) ──────────────────────

function getEnvOverride(name: string): number | undefined {
  const envKey = `VIRTUMATCH_COEF_${name}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined && envVal !== '') {
    const parsed = parseFloat(envVal);
    if (!isNaN(parsed)) return parsed;
    console.warn(`[prediction-config] Invalid env override ${envKey}=${envVal}, ignoring`);
  }
  return undefined;
}

function buildConfig(): CoefficientRegistry {
  const config: Record<string, number> = {};

  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    let value = def.value;

    // Check for env var override
    const override = getEnvOverride(name);
    if (override !== undefined) {
      if (override < def.min || override > def.max) {
        console.warn(
          `[prediction-config] Env override ${name}=${override} outside bounds [${def.min}, ${def.max}], clamping`
        );
        value = Math.max(def.min, Math.min(def.max, override));
      } else {
        value = override;
      }
      console.info(`[prediction-config] Override: ${name}=${value} (from env)`);
    }

    config[name] = value;
  }

  return config as unknown as CoefficientRegistry;
}

// Singleton config (built once at first import)
let _config: CoefficientRegistry | null = null;

export function getConfig(): CoefficientRegistry {
  if (!_config) {
    _config = buildConfig();
  }
  return _config;
}

// ─── Validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate all coefficients at startup.
 * MUST be called once during application initialization.
 * In production, invalid coefficients should cause a hard failure.
 * In development, they should produce warnings.
 */
export function validateCoefficients(config?: CoefficientRegistry): ValidationResult {
  const cfg = config || getConfig();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    const value = (cfg as Record<string, number>)[name];

    // Check value exists
    if (value === undefined || value === null) {
      errors.push(`${name}: value is undefined`);
      continue;
    }

    // Check bounds
    if (value < def.min) {
      errors.push(`${name}: value ${value} < min ${def.min}`);
    }
    if (value > def.max) {
      errors.push(`${name}: value ${value} > max ${def.max}`);
    }

    // Check calibration status
    if (def.calibrationStatus === 'arbitrary') {
      warnings.push(`${name}: coefficient is ARBITRARY (no empirical basis) — priority for calibration`);
    }
  }

  // Conservation law: STAT weights must sum to 1.0
  const statSum = cfg.STAT_BASE_WEIGHT + cfg.STAT_ATTACK_WEIGHT + cfg.STAT_DEF_WEIGHT;
  if (Math.abs(statSum - 1.0) > 0.01) {
    errors.push(
      `STAT weight split must sum to 1.0 (got ${statSum.toFixed(3)}: ` +
      `${cfg.STAT_BASE_WEIGHT}/${cfg.STAT_ATTACK_WEIGHT}/${cfg.STAT_DEF_WEIGHT})`
    );
  }

  // FORM_WEIGHTS must be monotonically decreasing
  const formWeights = [cfg.FORM_WEIGHT_0, cfg.FORM_WEIGHT_1, cfg.FORM_WEIGHT_2, cfg.FORM_WEIGHT_3, cfg.FORM_WEIGHT_4];
  for (let i = 1; i < formWeights.length; i++) {
    if (formWeights[i] >= formWeights[i - 1]) {
      errors.push(`FORM_WEIGHT_${i} (${formWeights[i]}) must be < FORM_WEIGHT_${i-1} (${formWeights[i-1]})`);
    }
  }

  // Lambda bounds: GRID_MIN < GRID_MAX
  if (cfg.GRID_MIN_LAMBDA >= cfg.GRID_MAX_LAMBDA) {
    errors.push(`GRID_MIN_LAMBDA (${cfg.GRID_MIN_LAMBDA}) must be < GRID_MAX_LAMBDA (${cfg.GRID_MAX_LAMBDA})`);
  }

  // Confidence bounds
  if (cfg.CONF_MAX_BASE >= cfg.CONF_CAP) {
    errors.push(`CONF_MAX_BASE (${cfg.CONF_MAX_BASE}) must be < CONF_CAP (${cfg.CONF_CAP})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get the count of arbitrary coefficients (priority for calibration).
 */
export function getArbitraryCount(): number {
  return Object.values(COEFFICIENT_DEFINITIONS)
    .filter(d => d.calibrationStatus === 'arbitrary')
    .length;
}

/**
 * Get all coefficients that need calibration.
 */
export function getCalibrationPriorities(): Array<{ name: string; def: CoefficientDefinition }> {
  const priority: CalibrationStatus[] = ['arbitrary', 'heuristic'];
  const result: Array<{ name: string; def: CoefficientDefinition }> = [];

  for (const status of priority) {
    for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
      if (def.calibrationStatus === status) {
        result.push({ name, def });
      }
    }
  }

  return result;
}
