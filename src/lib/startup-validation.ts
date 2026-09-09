// Phase J — Coefficient Validation at Startup
// This module is imported by the app entry point to validate coefficients at boot.
// In production, invalid coefficients cause a hard failure.
// In development, they produce warnings only.

import { validateCoefficients, getArbitraryCount, getCalibrationPriorities } from './prediction-config';

const PHASE = '[Phase J:startup-validation]';

/**
 * Validate all prediction coefficients at application startup.
 * MUST be called once during initialization.
 *
 * - Production: invalid coefficients → hard failure (process.exit)
 * - Development: invalid coefficients → console.error (warnings only)
 * - Always: logs calibration priorities for arbitrary coefficients
 */
export function validateCoefficientsAtStartup(): void {
  const result = validateCoefficients();
  const isProduction = process.env.NODE_ENV === 'production';

  if (!result.valid) {
    console.error(`${PHASE} COEFFICIENT VALIDATION FAILED:`);
    for (const err of result.errors) {
      console.error(`  ✗ ${err}`);
    }
    if (isProduction) {
      console.error(`${PHASE} Hard failure in production — exiting`);
      process.exit(1);
    } else {
      console.error(`${PHASE} Continuing in development (would be fatal in production)`);
    }
  } else {
    console.info(`${PHASE} All coefficients valid ✓`);
  }

  // Always log warnings (arbitrary coefficients)
  if (result.warnings.length > 0) {
    const arbitraryCount = getArbitraryCount();
    console.warn(`${PHASE} ${arbitraryCount} arbitrary coefficients need calibration:`);
    const priorities = getCalibrationPriorities();
    for (const { name, def } of priorities.slice(0, arbitraryCount)) {
      console.warn(`  → ${name} = ${def.value} (${def.calibrationStatus}, bounds [${def.min}, ${def.max}])`);
    }
  }
}
