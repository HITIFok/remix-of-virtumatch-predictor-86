// API-side Prediction Coefficient Validation
// Mirrors src/lib/prediction-config.ts for health check use
// Provides validateCoefficients() and getArbitraryCount() without TypeScript dependency

/**
 * Coefficient definitions with bounds and calibration status.
 * MUST stay in sync with src/lib/prediction-config.ts COEFFICIENT_DEFINITIONS.
 */
const COEFFICIENT_DEFINITIONS = {
  // Lambda & Grid Search
  GRID_MIN_LAMBDA: { value: 0.5, min: 0.2, max: 1.0, calibrationStatus: 'heuristic' },
  GRID_MAX_LAMBDA: { value: 3.0, min: 2.0, max: 4.0, calibrationStatus: 'heuristic' },
  GRID_STEP: { value: 0.05, min: 0.01, max: 0.10, calibrationStatus: 'heuristic' },
  // Form & Momentum
  FORM_WEIGHT_0: { value: 1.5, min: 1.0, max: 2.0, calibrationStatus: 'heuristic' },
  FORM_WEIGHT_1: { value: 1.3, min: 1.0, max: 1.8, calibrationStatus: 'heuristic' },
  FORM_WEIGHT_2: { value: 1.2, min: 0.8, max: 1.5, calibrationStatus: 'heuristic' },
  FORM_WEIGHT_3: { value: 1.1, min: 0.7, max: 1.3, calibrationStatus: 'heuristic' },
  FORM_WEIGHT_4: { value: 1.0, min: 0.5, max: 1.2, calibrationStatus: 'heuristic' },
  // Virtual Football
  VIRTUAL_AVG_GOALS: { value: 1.3, min: 0.9, max: 1.8, calibrationStatus: 'arbitrary' },
  // Lambda Adjustment — Stats Split
  STAT_BASE_WEIGHT: { value: 0.70, min: 0.50, max: 0.85, calibrationStatus: 'heuristic' },
  STAT_ATTACK_WEIGHT: { value: 0.20, min: 0.10, max: 0.35, calibrationStatus: 'heuristic' },
  STAT_DEF_WEIGHT: { value: 0.10, min: 0.05, max: 0.20, calibrationStatus: 'heuristic' },
  // Form Adjustment
  FORM_ATTACK_BOOST: { value: 0.15, min: 0.05, max: 0.30, calibrationStatus: 'arbitrary' },
  FORM_DEFENSE_PENALTY: { value: 0.10, min: 0.05, max: 0.20, calibrationStatus: 'arbitrary' },
  // Momentum
  MOMENTUM_SCALE: { value: 500, min: 200, max: 1000, calibrationStatus: 'heuristic' },
  // H2H
  H2H_HOME_BOOST: { value: 0.5, min: 0.2, max: 0.8, calibrationStatus: 'arbitrary' },
  H2H_AWAY_PENALTY: { value: 0.3, min: 0.1, max: 0.6, calibrationStatus: 'arbitrary' },
  // AI Blend
  AI_WEIGHT: { value: 0.35, min: 0.10, max: 0.50, calibrationStatus: 'arbitrary' },
  // Virtual Redistribution
  VIRTUAL_CAP: { value: 3, min: 2, max: 4, calibrationStatus: 'heuristic' },
  // Confidence
  CONF_BASE_SCALE: { value: 85, min: 70, max: 100, calibrationStatus: 'heuristic' },
  CONF_MAX_BASE: { value: 68, min: 55, max: 80, calibrationStatus: 'heuristic' },
  CONF_CAP: { value: 82, min: 70, max: 90, calibrationStatus: 'heuristic' },
  // Phase W thresholds
  LAMBDA_MIN: { value: 0.3, min: 0.1, max: 0.5, calibrationStatus: 'heuristic' },
  LAMBDA_MAX: { value: 2.8, min: 2.0, max: 3.5, calibrationStatus: 'heuristic' },
  DEFAULT_AVG_SCORED: { value: 1.3, min: 0.8, max: 1.8, calibrationStatus: 'arbitrary' },
  DEFAULT_AVG_CONCEDED: { value: 1.1, min: 0.7, max: 1.5, calibrationStatus: 'arbitrary' },
  DEFAULT_MOMENTUM: { value: 50, min: 30, max: 70, calibrationStatus: 'heuristic' },
  DEF_PENALTY_SELF: { value: 0.5, min: 0.3, max: 0.7, calibrationStatus: 'arbitrary' },
  DEF_PENALTY_CROSS: { value: 0.3, min: 0.1, max: 0.5, calibrationStatus: 'arbitrary' },
  H2H_BIAS_DIVISOR: { value: 200, min: 100, max: 400, calibrationStatus: 'arbitrary' },
  FORM_AGREEMENT_THRESHOLD: { value: 15, min: 5, max: 30, calibrationStatus: 'arbitrary' },
  H2H_AGREEMENT_THRESHOLD: { value: 20, min: 10, max: 40, calibrationStatus: 'arbitrary' },
  VIRT_REDIST_HIGH: { value: 0.70, min: 0.50, max: 0.90, calibrationStatus: 'heuristic' },
  VIRT_REDIST_LOW: { value: 0.40, min: 0.20, max: 0.60, calibrationStatus: 'heuristic' },
  HALF_TIME_FACTOR: { value: 0.46, min: 0.35, max: 0.55, calibrationStatus: 'arbitrary' },
  NEW_SEASON_BOOST: { value: 0.22, min: 0.10, max: 0.35, calibrationStatus: 'arbitrary' },
  NEW_SEASON_LAMBDA_MAX: { value: 3.0, min: 2.5, max: 3.5, calibrationStatus: 'heuristic' },
  CONF_FLOOR: { value: 25, min: 15, max: 35, calibrationStatus: 'heuristic' },
  ANTI_TRAP_RANK_DIFF: { value: 5, min: 3, max: 10, calibrationStatus: 'heuristic' },
  ANTI_TRAP_DELTA_THRESHOLD: { value: 0.10, min: 0.05, max: 0.20, calibrationStatus: 'heuristic' },
  ODDS_GAP_SEVERE: { value: 0.05, min: 0.01, max: 0.10, calibrationStatus: 'heuristic' },
  ODDS_GAP_MODERATE: { value: 0.10, min: 0.05, max: 0.20, calibrationStatus: 'heuristic' },
};

/**
 * Build runtime config with env var overrides (VIRTUMATCH_COEF_*).
 */
function buildConfig() {
  const config = {};
  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    let value = def.value;
    const envKey = `VIRTUMATCH_COEF_${name}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal !== '') {
      const parsed = parseFloat(envVal);
      if (!isNaN(parsed)) {
        if (parsed < def.min || parsed > def.max) {
          value = Math.max(def.min, Math.min(def.max, parsed));
        } else {
          value = parsed;
        }
      }
    }
    config[name] = value;
  }
  return config;
}

let _config = null;

function getConfig() {
  if (!_config) _config = buildConfig();
  return _config;
}

/**
 * Validate all coefficients at startup.
 * Returns { valid, errors, warnings }.
 */
export function validateCoefficients(config) {
  const cfg = config || getConfig();
  const errors = [];
  const warnings = [];

  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    const value = cfg[name];
    if (value === undefined || value === null) {
      errors.push(`${name}: value is undefined`);
      continue;
    }
    if (value < def.min) {
      errors.push(`${name}: value ${value} < min ${def.min}`);
    }
    if (value > def.max) {
      errors.push(`${name}: value ${value} > max ${def.max}`);
    }
    if (def.calibrationStatus === 'arbitrary') {
      warnings.push(`${name}: coefficient is ARBITRARY (no empirical basis)`);
    }
  }

  // Conservation law: STAT weights must sum to 1.0
  const statSum = cfg.STAT_BASE_WEIGHT + cfg.STAT_ATTACK_WEIGHT + cfg.STAT_DEF_WEIGHT;
  if (Math.abs(statSum - 1.0) > 0.01) {
    errors.push(`STAT weight split must sum to 1.0 (got ${statSum.toFixed(3)})`);
  }

  // FORM_WEIGHTS must be monotonically decreasing
  const formWeights = [cfg.FORM_WEIGHT_0, cfg.FORM_WEIGHT_1, cfg.FORM_WEIGHT_2, cfg.FORM_WEIGHT_3, cfg.FORM_WEIGHT_4];
  for (let i = 1; i < formWeights.length; i++) {
    if (formWeights[i] >= formWeights[i - 1]) {
      errors.push(`FORM_WEIGHT_${i} (${formWeights[i]}) must be < FORM_WEIGHT_${i-1} (${formWeights[i-1]})`);
    }
  }

  // Lambda bounds
  if (cfg.GRID_MIN_LAMBDA >= cfg.GRID_MAX_LAMBDA) {
    errors.push(`GRID_MIN_LAMBDA (${cfg.GRID_MIN_LAMBDA}) must be < GRID_MAX_LAMBDA (${cfg.GRID_MAX_LAMBDA})`);
  }

  // Confidence bounds
  if (cfg.CONF_MAX_BASE >= cfg.CONF_CAP) {
    errors.push(`CONF_MAX_BASE (${cfg.CONF_MAX_BASE}) must be < CONF_CAP (${cfg.CONF_CAP})`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get the count of arbitrary coefficients (priority for calibration).
 */
export function getArbitraryCount() {
  return Object.values(COEFFICIENT_DEFINITIONS)
    .filter(d => d.calibrationStatus === 'arbitrary')
    .length;
}
