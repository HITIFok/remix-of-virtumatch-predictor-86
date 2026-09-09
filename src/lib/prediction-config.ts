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
  // Phase W — High-priority extracted thresholds
  LAMBDA_MIN: number;
  LAMBDA_MAX: number;
  DEFAULT_AVG_SCORED: number;
  DEFAULT_AVG_CONCEDED: number;
  DEFAULT_MOMENTUM: number;
  DEF_PENALTY_SELF: number;
  DEF_PENALTY_CROSS: number;
  H2H_BIAS_DIVISOR: number;
  FORM_AGREEMENT_THRESHOLD: number;
  H2H_AGREEMENT_THRESHOLD: number;
  VIRT_REDIST_HIGH: number;
  VIRT_REDIST_LOW: number;
  HALF_TIME_FACTOR: number;
  NEW_SEASON_BOOST: number;
  NEW_SEASON_LAMBDA_MAX: number;
  CONF_FLOOR: number;
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

  // ═══ Phase W — Extracted High-Priority Thresholds ══════════════════════

  LAMBDA_MIN: {
    value: 0.3, min: 0.1, max: 0.5,
    unit: 'goals/match',
    description: 'Lower clamp bound for adjusted lambda (prevents near-zero goal expectation)',
    calibrationStatus: 'heuristic',
    source: 'Virtual football minimum: even weak teams score occasionally',
  },
  LAMBDA_MAX: {
    value: 2.8, min: 2.0, max: 3.5,
    unit: 'goals/match',
    description: 'Upper clamp bound for adjusted lambda (prevents unrealistic goal explosion)',
    calibrationStatus: 'heuristic',
    source: 'Virtual football max: even dominant teams rarely exceed ~3 goals/match',
  },
  DEFAULT_AVG_SCORED: {
    value: 1.3, min: 0.8, max: 1.8,
    unit: 'goals/match',
    description: 'Default average goals scored when no form data available (should match VIRTUAL_AVG_GOALS)',
    calibrationStatus: 'arbitrary',
    source: 'Fallback when team has no match history',
  },
  DEFAULT_AVG_CONCEDED: {
    value: 1.1, min: 0.7, max: 1.5,
    unit: 'goals/match',
    description: 'Default average goals conceded when no form data available',
    calibrationStatus: 'arbitrary',
    source: 'Fallback when team has no match history (lower than scored → slight home advantage)',
  },
  DEFAULT_MOMENTUM: {
    value: 50, min: 30, max: 70,
    unit: 'score',
    description: 'Default momentum score when no form data available (neutral = 50)',
    calibrationStatus: 'heuristic',
    source: 'Neutral midpoint of 0-100 momentum scale',
  },
  DEF_PENALTY_SELF: {
    value: 0.5, min: 0.3, max: 0.7,
    unit: 'ratio',
    description: 'Fraction of defense penalty applied to own lambda (self-correction)',
    calibrationStatus: 'arbitrary',
    source: 'Defense weakness hurts your own scoring by 50% of the penalty',
  },
  DEF_PENALTY_CROSS: {
    value: 0.3, min: 0.1, max: 0.5,
    unit: 'ratio',
    description: 'Fraction of defense penalty applied to opponent lambda (cross-benefit)',
    calibrationStatus: 'arbitrary',
    source: 'Defense weakness boosts opponent scoring by 30% of the penalty',
  },
  H2H_BIAS_DIVISOR: {
    value: 200, min: 100, max: 400,
    unit: 'divisor',
    description: 'Divisor for H2H homeTeamBias → lambda adjustment (200 → ±0.15 range)',
    calibrationStatus: 'arbitrary',
    source: 'Scales H2H bias percentage to lambda adjustment',
  },
  FORM_AGREEMENT_THRESHOLD: {
    value: 15, min: 5, max: 30,
    unit: 'points',
    description: 'Momentum score difference threshold for form agreement (15-point gap needed)',
    calibrationStatus: 'arbitrary',
    source: 'How much momentum difference indicates form agreement with odds',
  },
  H2H_AGREEMENT_THRESHOLD: {
    value: 20, min: 10, max: 40,
    unit: 'points',
    description: 'H2H homeTeamBias threshold for H2H agreement (20-point bias needed)',
    calibrationStatus: 'arbitrary',
    source: 'How much H2H bias indicates agreement with odds favorite',
  },
  VIRT_REDIST_HIGH: {
    value: 0.70, min: 0.50, max: 0.90,
    unit: 'ratio',
    description: 'Probability reduction ratio for 3-3 scores in virtual redistribution',
    calibrationStatus: 'heuristic',
    source: '3-3 is very rare in virtual football; 70% of probability redistributed',
  },
  VIRT_REDIST_LOW: {
    value: 0.40, min: 0.20, max: 0.60,
    unit: 'ratio',
    description: 'Probability reduction ratio for 3-2/3-1 scores in virtual redistribution',
    calibrationStatus: 'heuristic',
    source: '3-2, 3-1 less rare; 40% of probability redistributed',
  },
  HALF_TIME_FACTOR: {
    value: 0.46, min: 0.35, max: 0.55,
    unit: 'ratio',
    description: 'Lambda scaling factor for half-time score prediction (46% of goals in 1st half)',
    calibrationStatus: 'arbitrary',
    source: 'Football stats: ~46% of goals scored in first half on average',
  },
  NEW_SEASON_BOOST: {
    value: 0.22, min: 0.10, max: 0.35,
    unit: 'goals/match',
    description: 'Lambda boost for favorite in new season mode (no historical data)',
    calibrationStatus: 'arbitrary',
    source: 'Compensates for lack of form data at season start',
  },
  NEW_SEASON_LAMBDA_MAX: {
    value: 3.0, min: 2.5, max: 3.5,
    unit: 'goals/match',
    description: 'Lambda ceiling for new season boost (prevents runaway with boost added)',
    calibrationStatus: 'heuristic',
    source: 'Same as LAMBDA_MAX + margin for new season boost',
  },
  CONF_FLOOR: {
    value: 25, min: 15, max: 35,
    unit: '%',
    description: 'Absolute confidence floor (never predict below 25% confidence)',
    calibrationStatus: 'heuristic',
    source: 'Even with no data, 25% floor prevents meaningless predictions',
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
