// ============================================
// PHASE 4 — CODE ANALYSIS & 18 QUESTIONS
// Deep code audit answering all Phase 4 questions
// with maximum rigor, even without Neon data
// ============================================

import { analyzeMatch, type MatchInput } from '../src/lib/prediction-engine';
import { getConfig, validateCoefficients, COEFFICIENT_DEFINITIONS } from '../src/lib/prediction-config';
import {
  MODEL_VERSION,
  FEATURE_VERSION,
  CONFIG_VERSION,
  CALIBRATION_VERSION,
  DATASET_VERSION,
} from '../src/lib/feature-snapshot';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const OUTPUT_DIR = path.join(__dirname, '..', 'download');

// ═══════════════════════════════════════════════════════════════════
// PREDICTION ENGINE BEHAVIOR ANALYSIS
// ═══════════════════════════════════════════════════════════════════

interface EngineBehaviorResult {
  input: { home: string; away: string; oddHome: number; oddDraw: number; oddAway: number };
  output: {
    probHome: number; probDraw: number; probAway: number;
    winner: string; confidence: number;
    expectedGoals: number;
  };
  oddsImplied: { probHome: number; probDraw: number; probAway: number; winner: string };
  divergence: { home: number; draw: number; away: number; maxDivergence: number };
}

function analyzeEngineBehavior(): EngineBehaviorResult[] {
  const cfg = getConfig();
  const results: EngineBehaviorResult[] = [];

  // Test a representative set of odds combinations
  const testCases = [
    // Heavy home favorite
    { home: 'Team A', away: 'Team B', oddHome: 1.30, oddDraw: 5.00, oddAway: 9.00 },
    // Moderate home favorite
    { home: 'Team C', away: 'Team D', oddHome: 1.80, oddDraw: 3.50, oddAway: 4.50 },
    // Balanced match
    { home: 'Team E', away: 'Team F', oddHome: 2.50, oddDraw: 3.20, oddAway: 2.80 },
    // Slight away favorite
    { home: 'Team G', away: 'Team H', oddHome: 3.00, oddDraw: 3.30, oddAway: 2.30 },
    // Heavy away favorite
    { home: 'Team I', away: 'Team J', oddHome: 7.00, oddDraw: 4.50, oddAway: 1.40 },
    // Draw-heavy
    { home: 'Team K', away: 'Team L', oddHome: 2.80, oddDraw: 2.80, oddAway: 2.80 },
    // Very close odds (anti-trap zone)
    { home: 'Team M', away: 'Team N', oddHome: 2.40, oddDraw: 3.10, oddAway: 2.90 },
    // Virtual football typical
    { home: 'Team O', away: 'Team P', oddHome: 1.90, oddDraw: 3.30, oddAway: 4.00 },
    // Extreme home favorite
    { home: 'Team Q', away: 'Team R', oddHome: 1.10, oddDraw: 7.00, oddAway: 15.00 },
    // Cup match (uncertain)
    { home: 'Team S', away: 'Team T', oddHome: 2.20, oddDraw: 3.00, oddAway: 3.30 },
  ];

  for (const tc of testCases) {
    try {
      const result = analyzeMatch({
        home: tc.home, away: tc.away, league: 'Virtual Test',
        oddHome: tc.oddHome, oddDraw: tc.oddDraw, oddAway: tc.oddAway,
      });

      // Odds-implied probabilities
      const invH = 1 / tc.oddHome, invD = 1 / tc.oddDraw, invA = 1 / tc.oddAway;
      const total = invH + invD + invA;
      const oddsH = invH / total, oddsD = invD / total, oddsA = invA / total;
      const oddsWinner = oddsH >= oddsD && oddsH >= oddsA ? '1' : oddsA >= oddsD ? '2' : 'X';

      results.push({
        input: tc,
        output: {
          probHome: result.probHome, probDraw: result.probDraw, probAway: result.probAway,
          winner: result.winner1X2.substring(0, 1),
          confidence: result.aiConfidence,
          expectedGoals: result.expectedGoals,
        },
        oddsImplied: { probHome: oddsH, probDraw: oddsD, probAway: oddsA, winner: oddsWinner },
        divergence: {
          home: result.probHome - oddsH,
          draw: result.probDraw - oddsD,
          away: result.probAway - oddsA,
          maxDivergence: Math.max(Math.abs(result.probHome - oddsH), Math.abs(result.probDraw - oddsD), Math.abs(result.probAway - oddsA)),
        },
      });
    } catch (err: any) {
      console.error(`Error for ${tc.home} vs ${tc.away}: ${err.message}`);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// ABLATION: Run engine with/without features
// ═══════════════════════════════════════════════════════════════════

interface AblationComparison {
  input: { oddHome: number; oddDraw: number; oddAway: number };
  fullModel: { probHome: number; probDraw: number; probAway: number; winner: string };
  oddsOnly: { probHome: number; probDraw: number; probAway: number; winner: string };
  divergence: number; // How much the model diverges from raw odds
  aiWeightImpact: number; // Estimated AI contribution
}

function analyzeAblationOnOdds(): AblationComparison[] {
  const results: AblationComparison[] = [];
  const testCases = [
    { oddHome: 1.50, oddDraw: 4.00, oddAway: 6.00 },
    { oddHome: 2.00, oddDraw: 3.30, oddAway: 3.80 },
    { oddHome: 2.50, oddDraw: 3.20, oddAway: 2.80 },
    { oddHome: 1.80, oddDraw: 3.50, oddAway: 4.50 },
    { oddHome: 3.00, oddDraw: 3.30, oddAway: 2.30 },
    { oddHome: 1.30, oddDraw: 5.00, oddAway: 9.00 },
    { oddHome: 2.80, oddDraw: 2.80, oddAway: 2.80 },
    { oddHome: 2.20, oddDraw: 3.00, oddAway: 3.30 },
  ];

  for (const tc of testCases) {
    // Full model (no form, no H2H, no AI — just odds + Poisson)
    const fullResult = analyzeMatch({
      home: 'Home', away: 'Away', league: 'Test',
      oddHome: tc.oddHome, oddDraw: tc.oddDraw, oddAway: tc.oddAway,
    });

    // Odds-only
    const invH = 1 / tc.oddHome, invD = 1 / tc.oddDraw, invA = 1 / tc.oddAway;
    const total = invH + invD + invA;
    const oddsH = invH / total, oddsD = invD / total, oddsA = invA / total;

    const divergence = Math.max(
      Math.abs(fullResult.probHome - oddsH),
      Math.abs(fullResult.probDraw - oddsD),
      Math.abs(fullResult.probAway - oddsA)
    );

    results.push({
      input: tc,
      fullModel: {
        probHome: fullResult.probHome, probDraw: fullResult.probDraw, probAway: fullResult.probAway,
        winner: fullResult.winner1X2.substring(0, 1),
      },
      oddsOnly: {
        probHome: oddsH, probDraw: oddsD, probAway: oddsA,
        winner: oddsH >= oddsD && oddsH >= oddsA ? '1' : oddsA >= oddsD ? '2' : 'X',
      },
      divergence,
      aiWeightImpact: divergence * 0.35, // rough estimate
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// 18 QUESTIONS
// ═══════════════════════════════════════════════════════════════════

function answerQuestions(
  behaviorResults: EngineBehaviorResult[],
  ablationResults: AblationComparison[],
  hasNeonData: boolean
): { question: string; answer: string; evidence: string; confidence: 'high' | 'medium' | 'low' }[] {
  const cfg = getConfig();
  const answers: { question: string; answer: string; evidence: string; confidence: 'high' | 'medium' | 'low' }[] = [];

  // Q1: Combien de prédictions historiques sont réellement exploitables ?
  answers.push({
    question: 'Q1: Combien de prédictions historiques sont réellement exploitables ?',
    answer: hasNeonData ? 'Déterminé par les données Neon (voir REAL_BACKTEST_RESULTS.json)' : '0 — Aucune prédiction historique n\'est accessible sans connexion Neon',
    evidence: 'NEON_DATABASE_URL n\'est pas configurée dans l\'environnement local. Les prédictions existent uniquement dans la base Neon PostgreSQL, inaccessible depuis l\'environnement d\'analyse.',
    confidence: 'high',
  });

  // Q2: Combien disposent d'un snapshot complet ?
  answers.push({
    question: 'Q2: Combien disposent d\'un snapshot complet ?',
    answer: '0 (sans accès Neon). Même avec accès Neon: vraisemblablement 0 ou très peu, car la migration 006 vient d\'être créée en Phase 3 et les snapshots ne sont peuplés que pour les nouvelles prédictions.',
    evidence: 'La migration 006_feature_snapshot.sql ajoute les colonnes feature_snapshot, model_version, etc. comme NULLABLE. Les prédictions existantes auront feature_snapshot = NULL et provenance_status = \'UNKNOWN\'. Seules les prédictions créées APRÈS la migration et APRÈS l\'activation du snapshot auront des données.',
    confidence: 'high',
  });

  // Q3: Combien sont seulement exploitables en Odds-only ?
  answers.push({
    question: 'Q3: Combien sont seulement exploitables en Odds-only ?',
    answer: 'Toutes les prédictions vérifiées avec odds sont exploitables en Odds-only. Les odds sont RECORDED dans la table predictions (odd_home, odd_draw, odd_away). C\'est la seule source historique sûre.',
    evidence: 'La table predictions contient odd_home, odd_draw, odd_away (DECIMAL(6,2)), prob_home, prob_draw, prob_away (DECIMAL(5,2)), et actual_outcome. Ces colonnes existent depuis la création de la table et sont toujours peuplées.',
    confidence: 'high',
  });

  // Q4: Le modèle VirtuMatch bat-il les baselines sur TEST ?
  const avgDivergence = ablationResults.length > 0 ? ablationResults.reduce((s, r) => s + r.divergence, 0) / ablationResults.length : 0;
  answers.push({
    question: 'Q4: Le modèle VirtuMatch bat-il les baselines sur TEST ?',
    answer: hasNeonData ? 'Nécessite l\'analyse des données Neon' : 'NON DÉTERMINABLE sans données réelles. Le modèle diverge en moyenne de ' + (avgDivergence * 100).toFixed(1) + '% des odds normalisées (analyse sur ' + ablationResults.length + ' combinaisons d\'odds). Cette divergence peut être bénéfique ou nuisible — seul un backtest empirique peut trancher.',
    evidence: `Analyse du moteur sur ${ablationResults.length} combinaisons d'odds: divergence moyenne = ${avgDivergence.toFixed(4)}, max = ${Math.max(...ablationResults.map(r => r.divergence)).toFixed(4)}. Le modèle modifie les probabilités odds-implied via Poisson grid search, redistribution virtuelle, et (quand disponible) form/H2H/AI. Sans données historiques, impossible de déterminer si ces modifications améliorent ou dégradent la précision.`,
    confidence: 'low',
  });

  // Q5: Le modèle est-il correctement calibré ?
  answers.push({
    question: 'Q5: Le modèle est-il correctement calibré ?',
    answer: 'PROBABLEMENT PAS. La confidence est une heuristique additive (25-82%), PAS une probabilité calibrée. Les probabilités prob_home/prob_draw/prob_away sont des sorties du Poisson blend, pas des probabilités calibrées au sens statistique.',
    evidence: 'calculateMultiFactorConfidence() construit la confiance comme: base (max 68%) + formAgreement bonus + h2hAgreement bonus + aiAgreement bonus - odds gap penalties - anti-trap penalties, clampé à [25, 82]. C\'est un score heuristique, pas une probabilité. Aucune calibration (Platt/isotonic) n\'a été entraînée. ECE et MCE ne peuvent être calculés sans données empiriques.',
    confidence: 'medium',
  });

  // Q6: Quelle est l'incertitude des métriques ?
  answers.push({
    question: 'Q6: Quelle est l\'incertitude des métriques ?',
    answer: 'INCONNU sans données empiriques. Les intervalles de confiance bootstrap nécessitent N ≥ 30 prédictions vérifiées. Avec N = 0, aucune métrique n\'a d\'intervalle de confiance.',
    evidence: 'Le framework de bootstrap est implémenté (2000 resamples, 95% CI). Il produira des intervalles dès que des données seront disponibles. La largeur des intervalles dépendra de N: pour N=100, CI typiquement ±5-10%; pour N=30, ±10-15%.',
    confidence: 'high',
  });

  // Q7: L'AI améliore-t-elle réellement les performances ?
  answers.push({
    question: 'Q7: L\'AI améliore-t-elle réellement les performances ?',
    answer: 'NON DÉTERMINABLE empiriquement. Théoriquement: AI_WEIGHT=0.35 est ARBITRAIRE (aucune base empirique). L\'AI (Groq LLM) peut déjà intégrer les mêmes informations que les odds, créant un potentiel double comptage.',
    evidence: `AI_WEIGHT=0.35 (calibrationStatus: 'arbitrary'). Le blendWithAI() mélange la matrice Poisson avec les probabilités AI: si AI_WEIGHT=0.35, alors 35% du résultat vient de l'AI. Si l'IA est corrélée avec les odds (ce qui est probable car l'IA reçoit les odds en contexte), cette contribution peut être redondante. L'ablation WITHOUT_AI nécessite des données empiriques.`,
    confidence: 'medium',
  });

  // Q8: H2H améliore-t-il réellement les performances ?
  answers.push({
    question: 'Q8: H2H améliore-t-il réellement les performances ?',
    answer: 'NON DÉTERMINABLE empiriquement. H2H utilise H2H_HOME_BOOST=0.5 et H2H_AWAY_PENALTY=0.3, tous deux ARBITRAIRE. L\'impact est limité aux matchs avec historique entre les deux équipes.',
    evidence: `H2H_HOME_BOOST=0.5 (calibrationStatus: 'arbitrary'), H2H_AWAY_PENALTY=0.3 (calibrationStatus: 'arbitrary'). L'ajustement lambda via H2H est: homeTeamBias / H2H_BIAS_DIVISOR (200), donc ±0.15 lambda max. En football virtuel, les confrontations directes sont rares → H2H a souvent 0 matchs → aucun impact. Même quand des données H2H existent, l'ajustement est faible (±0.15 sur un lambda typique de 0.5-2.5).`,
    confidence: 'medium',
  });

  // Q9: Form améliore-t-elle réellement les performances ?
  answers.push({
    question: 'Q9: Form améliore-t-elle réellement les performances ?',
    answer: 'NON DÉTERMINABLE empiriquement. FORM_ATTACK_BOOST=0.15 et FORM_DEFENSE_PENALTY=0.10 sont ARBITRAIRE. De plus, form et momentum partagent les mêmes données sous-jacentes (double comptage).',
    evidence: `FORM_ATTACK_BOOST=0.15 (calibrationStatus: 'arbitrary'), FORM_DEFENSE_PENALTY=0.10 (calibrationStatus: 'arbitrary'). L'ajustement form: lambda += (avgScored - VIRTUAL_AVG_GOALS) * FORM_ATTACK_BOOST. Pour VIRTUAL_AVG_GOALS=1.3, une équipe marquant 2.0 buts/match reçoit +0.105 lambda. Mais momentum (dérivé des mêmes résultats) ajoute un SECOND ajustement via MOMENTUM_SCALE=500. Les mêmes matchs récents sont comptés deux fois.`,
    confidence: 'medium',
  });

  // Q10: Momentum apporte-t-il une information indépendante ?
  answers.push({
    question: 'Q10: Momentum apporte-t-il une information indépendante ?',
    answer: 'NON. Momentum est une fonction déterministe de form. Momentum = (weightedPoints / maxPoints) × 100, où weightedPoints sont les mêmes résultats de form avec les mêmes FORM_WEIGHTS. Momentum n\'ajoute AUCUNE information qui n\'est pas déjà dans form.',
    evidence: 'Dans prediction-engine.ts: extractTeamForm() calcule formScores ET momentumScore à partir des mêmes 5 derniers matchs. Les FORM_WEIGHTS [1.5, 1.3, 1.2, 1.1, 1.0] sont utilisées pour les deux. Momentum ajuste lambda via (momentumScore - 50) / MOMENTUM_SCALE, et form ajuste via (avgScored - VIRTUAL_AVG_GOALS) * FORM_ATTACK_BOOST. C\'est un double comptage avéré.',
    confidence: 'high',
  });

  // Q11: Anti-trap apporte-t-il une information indépendante ?
  answers.push({
    question: 'Q11: Anti-trap apporte-t-il une information indépendante ?',
    answer: 'PARTIELLEMENT. L\'anti-trap détecte une configuration spécifique (forte différence de ranking + odds trop serrées) qui n\'est PAS capturée par les autres features. Cependant, l\'anti-trap dépend du ranking (UNKNOWN sans snapshot) et des odds (RECORDED).',
    evidence: 'Anti-trap se déclenche quand: (1) rankDiff >= ANTI_TRAP_RANK_DIFF (5 positions), ET (2) delta < ANTI_TRAP_DELTA_THRESHOLD (0.10). Cette combinaison est unique. L\'impact est sur la confidence (pénalité -5 à -15), pas sur les probabilités directement. L\'information est indépendante des odds seuls, MAIS dépend du ranking qui est UNKNOWN pour les anciennes prédictions.',
    confidence: 'medium',
  });

  // Q12: Stats apporte-t-il une information indépendante ?
  answers.push({
    question: 'Q12: Stats apporte-t-il une information indépendante ?',
    answer: 'THÉORIQUEMENT OUI, mais avec un risque de double comptage avec les odds. Les stats d\'équipe (avgGoalsScored, avgGoalsConceded, position) contiennent des informations que les odds ne capturent pas toujours. Cependant, STAT_BASE_WEIGHT=0.70 signifie que 70% de l\'ajustement vient des odds, et les 30% restants (attack + defense) peuvent partiellement chevaucher les odds.',
    evidence: `adjustLambdasWithStats() calcule: lambda_new = STAT_BASE_WEIGHT * lambda_odds + STAT_ATTACK_WEIGHT * attackAdj + STAT_DEF_WEIGHT * defenseAdj. Avec STAT_BASE_WEIGHT=0.70, les odds dominent. attackStrength = avgGoalsScored / VIRTUAL_AVG_GOALS. Si les odds reflètent déjà la force d'attaque (ce qui est typique), alors attackStrength est redondant avec la composante odds de lambda. Le degré de redondance dépend de l'efficacité du marché des odds.`,
    confidence: 'medium',
  });

  // Q13: Existe-t-il des signes de double comptage ?
  answers.push({
    question: 'Q13: Existe-t-il des signes de double comptage ?',
    answer: 'OUI — 6 chemins identifiés, dont 2 HIGH severity: (1) form→momentum (même donnée, deux ajustements), (2) AI→odds (l\'IA peut intégrer les odds qui sont déjà dans le modèle).',
    evidence: 'Voir DOUBLE_COUNTING_AUDIT.md pour l\'analyse détaillée. Les chemins critiques sont: form→momentum (HIGH): momentumScore est calculé à partir des mêmes matchs que formScores, puis utilisé pour un second ajustement lambda. AI→odds (HIGH): l\'IA reçoit les odds en contexte, puis son output est blended à 35%, potentiellement sur-pondérant l\'information odds. odds→stats (MEDIUM): STAT_BASE_WEIGHT=0.70 utilise les odds comme base, mais les odds ont déjà déterminé les lambdas via grid search.',
    confidence: 'high',
  });

  // Q14: Existe-t-il une fuite de données ?
  answers.push({
    question: 'Q14: Existe-t-il une fuite de données ?',
    answer: 'AUCUNE DÉTECTÉE dans le code actuel. Les fonctions de reconstruction temporelle (getFormAtTimestamp, getH2HAtTimestamp, getStatsAtTimestamp) filtrent strictement les données avant predictionTimestamp. Cependant, SANS snapshot, la fuite ne peut être EXCLUE pour les anciennes prédictions (provenance UNKNOWN ≠ SAFE).',
    evidence: 'Leakage gate: timestamps_consistent=true, no_future_features=true (aucune violation temporelle dans le code). Les fonctions temporelles utilisent rTs < predictionTimestamp (strictement inférieur). Le risque principal est l\'utilisation de getCurrentForm() au lieu de getFormAtTimestamp() dans les anciennes prédictions — sans snapshot, nous ne pouvons pas vérifier quelle fonction a été utilisée.',
    confidence: 'medium',
  });

  // Q15: Les anciennes prédictions peuvent-elles être utilisées pour valider le full model ?
  answers.push({
    question: 'Q15: Les anciennes prédictions peuvent-elles être utilisées pour valider le full model ?',
    answer: 'NON. Les anciennes prédictions (sans feature_snapshot) ont toutes les features Form/H2H/Stats/AI/Anti-trap classées UNKNOWN. On ne peut PAS prouver qu\'elles n\'utilisent pas de données futures. UNKNOWN ≠ SAFE.',
    answer: 'NON. Les anciennes prédictions n\'ont pas de feature_snapshot. Toutes les features au-delà des odds sont UNKNOWN. On ne peut PAS prouver l\'absence de fuite de données. Règle: UNKNOWN n\'est jamais SAFE par défaut.',
    evidence: 'Migration 006: UPDATE predictions SET provenance_status = \'UNKNOWN\' WHERE feature_snapshot IS NULL. Pour les anciennes prédictions: Form=UNKNOWN, H2H=UNKNOWN, Stats=UNKNOWN, AI=UNKNOWN, Anti-trap=UNKNOWN, Momentum=UNKNOWN. Seuls les odds sont RECORDED. Le full model ne peut être validé qu\'avec des prédictions ayant un snapshot valide.',
    confidence: 'high',
  });

  // Q16: Les nouvelles prédictions peuvent-elles être validées scientifiquement ?
  answers.push({
    question: 'Q16: Les nouvelles prédictions peuvent-elles être validées scientifiquement grâce aux snapshots ?',
    answer: 'OUI, en principe. Si feature_snapshot est peuplé avec toutes les features, leur timestamp, leur source, et leur valeur, alors chaque prédiction est reproductible et auditable. Il faut suffisamment de nouvelles prédictions (≥ 100) pour une validation statistique significative.',
    evidence: 'feature-snapshot.ts crée un snapshot versionné avec: schema_version, prediction_timestamp, features (odds, form, h2h, stats, ai, anti_trap avec valeurs + provenance + timestamps), coefficients (copie complète), config_hash. computeSnapshotHash() garantit la reproductibilité. Il suffit d\'accumuler assez de prédictions avec snapshots pour lancer le backtest B.',
    confidence: 'high',
  });

  // Q17: Quelle partie du système est réellement validée aujourd'hui ?
  answers.push({
    question: 'Q17: Quelle partie du système est réellement validée aujourd\'hui ?',
    answer: 'Seul le framework de validation est validé (code, tests, structure). AUCUNE partie du modèle de prédiction n\'est empiriquement validée. Les coefficients sont heuristic/arbitrary. Le pipeline Poisson n\'a pas été testé contre des résultats réels.',
    evidence: 'Les 40 coefficients: 15 arbitrary, 25 heuristic, 0 empirically_calibrated. Le pipeline 13 étapes n\'a été testé que sur des données synthétiques. Les tests (938 API + 48 frontend) valident la logique et la sécurité, pas la performance prédictive. La conservation STAT_BASE + STAT_ATTACK + STAT_DEF = 1.0 est vérifiée, mais les valeurs individuelles ne sont pas calibrées.',
    confidence: 'high',
  });

  // Q18: Quelle partie reste non validée ?
  answers.push({
    question: 'Q18: Quelle partie reste non validée ?',
    answer: 'TOUT le modèle prédictif: (1) les 40 coefficients (15 arbitrary, 25 heuristic), (2) le pipeline Poisson 13 étapes, (3) AI_WEIGHT=0.35, (4) VIRTUAL_AVG_GOALS=1.3, (5) la calibration, (6) l\'absence de fuite de données pour les anciennes prédictions, (7) l\'indépendance des features, (8) l\'utilité de chaque composant vs odds-only.',
    evidence: 'Arbitrary coefficients: VIRTUAL_AVG_GOALS, FORM_ATTACK_BOOST, FORM_DEFENSE_PENALTY, H2H_HOME_BOOST, H2H_AWAY_PENALTY, AI_WEIGHT, DEFAULT_AVG_SCORED, DEFAULT_AVG_CONCEDED, DEF_PENALTY_SELF, DEF_PENALTY_CROSS, H2H_BIAS_DIVISOR, FORM_AGREEMENT_THRESHOLD, H2H_AGREEMENT_THRESHOLD, HALF_TIME_FACTOR, NEW_SEASON_BOOST, ODDS_GAP_MODERATE. Aucun n\'a été calibré sur des données empiriques.',
    confidence: 'high',
  });

  return answers;
}

// ═══════════════════════════════════════════════════════════════════
// COEFFICIENT AUDIT
// ═══════════════════════════════════════════════════════════════════

function auditCoefficients(): {
  total: number;
  arbitrary: { name: string; value: number; description: string }[];
  heuristic: { name: string; value: number; description: string }[];
  empirical: { name: string; value: number; description: string }[];
} {
  const arbitrary: { name: string; value: number; description: string }[] = [];
  const heuristic: { name: string; value: number; description: string }[] = [];
  const empirical: { name: string; value: number; description: string }[] = [];

  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    const entry = { name, value: def.value, description: def.description };
    if (def.calibrationStatus === 'arbitrary') arbitrary.push(entry);
    else if (def.calibrationStatus === 'heuristic') heuristic.push(entry);
    else if (def.calibrationStatus === 'empirical') empirical.push(entry);
  }

  return {
    total: Object.keys(COEFFICIENT_DEFINITIONS).length,
    arbitrary,
    heuristic,
    empirical,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('═'.repeat(70));
  console.log('PHASE 4 — CODE ANALYSIS & 18 QUESTIONS');
  console.log('═'.repeat(70));
  console.log('');

  // 1. Engine behavior analysis
  console.log('[1] Analyzing prediction engine behavior...');
  const behaviorResults = analyzeEngineBehavior();
  console.log(`  Analyzed ${behaviorResults.length} odds combinations`);
  
  const avgDivergence = behaviorResults.reduce((s, r) => s + r.divergence.maxDivergence, 0) / behaviorResults.length;
  const maxDivergence = Math.max(...behaviorResults.map(r => r.divergence.maxDivergence));
  console.log(`  Average divergence from odds: ${(avgDivergence * 100).toFixed(2)}%`);
  console.log(`  Max divergence from odds: ${(maxDivergence * 100).toFixed(2)}%`);
  
  // Check for prediction reversals (model predicts opposite of odds)
  const reversals = behaviorResults.filter(r => r.output.winner !== r.oddsImplied.winner);
  console.log(`  Prediction reversals vs odds: ${reversals.length} / ${behaviorResults.length}`);

  // 2. Ablation analysis
  console.log('\n[2] Analyzing ablation (full model vs odds-only)...');
  const ablationResults = analyzeAblationOnOdds();
  console.log(`  Analyzed ${ablationResults.length} odds combinations`);
  
  const avgAbDivergence = ablationResults.reduce((s, r) => s + r.divergence, 0) / ablationResults.length;
  console.log(`  Average model-odds divergence: ${(avgAbDivergence * 100).toFixed(2)}%`);

  // 3. Coefficient audit
  console.log('\n[3] Auditing coefficients...');
  const coeffAudit = auditCoefficients();
  console.log(`  Total: ${coeffAudit.total}`);
  console.log(`  Arbitrary (NO empirical basis): ${coeffAudit.arbitrary.length}`);
  console.log(`  Heuristic (reasonable but uncalibrated): ${coeffAudit.heuristic.length}`);
  console.log(`  Empirically calibrated: ${coeffAudit.empirical.length}`);

  // 4. Answer 18 questions
  console.log('\n[4] Answering 18 questions...');
  const answers = answerQuestions(behaviorResults, ablationResults, false);
  for (const a of answers) {
    console.log(`  ${a.question}`);
    console.log(`    Answer: ${a.answer.substring(0, 80)}...`);
    console.log(`    Confidence: ${a.confidence}`);
  }

  // 5. Generate comprehensive report
  console.log('\n[5] Generating comprehensive reports...');
  
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── 18 QUESTIONS REPORT ──
  const questionsReport = generateQuestionsReport(answers, behaviorResults, ablationResults, coeffAudit);
  fs.writeFileSync(path.join(DOCS_DIR, 'EIGHTEEN_QUESTIONS.md'), questionsReport);
  console.log('  ✓ EIGHTEEN_QUESTIONS.md');

  // ── ENGINE BEHAVIOR REPORT ──
  const engineReport = generateEngineBehaviorReport(behaviorResults, ablationResults);
  fs.writeFileSync(path.join(DOCS_DIR, 'ENGINE_BEHAVIOR_ANALYSIS.md'), engineReport);
  console.log('  ✓ ENGINE_BEHAVIOR_ANALYSIS.md');

  // ── COEFFICIENT AUDIT REPORT ──
  const coeffReport = generateCoefficientAuditReport(coeffAudit);
  fs.writeFileSync(path.join(DOCS_DIR, 'COEFFICIENT_CALIBRATION_AUDIT.md'), coeffReport);
  console.log('  ✓ COEFFICIENT_CALIBRATION_AUDIT.md');

  // ── JSON results ──
  const jsonResults = {
    engine_behavior: behaviorResults,
    ablation_analysis: ablationResults,
    coefficient_audit: {
      total: coeffAudit.total,
      arbitrary_count: coeffAudit.arbitrary.length,
      heuristic_count: coeffAudit.heuristic.length,
      empirical_count: coeffAudit.empirical.length,
      arbitrary_coefficients: coeffAudit.arbitrary,
    },
    eighteen_questions: answers.map(a => ({
      question: a.question,
      answer: a.answer,
      confidence: a.confidence,
    })),
    meta: {
      date: new Date().toISOString(),
      model_version: MODEL_VERSION,
      feature_version: FEATURE_VERSION,
    },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'PHASE4_ANALYSIS.json'), JSON.stringify(jsonResults, null, 2));
  console.log('  ✓ PHASE4_ANALYSIS.json');

  console.log('\n' + '═'.repeat(70));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATORS
// ═══════════════════════════════════════════════════════════════════

function generateQuestionsReport(
  answers: { question: string; answer: string; evidence: string; confidence: string }[],
  behavior: EngineBehaviorResult[],
  ablation: AblationComparison[],
  coeffAudit: ReturnType<typeof auditCoefficients>
): string {
  const L: string[] = [];
  L.push('# 18 QUESTIONS — Phase 4 Answers');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push(`Model: VirtuMatch Predictor v${MODEL_VERSION}`);
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Methodology');
  L.push('');
  L.push('Each question is answered with:');
  L.push('- A direct answer (never evasive)');
  L.push('- Supporting evidence (code references, coefficient values, analysis results)');
  L.push('- A confidence level (high/medium/low) reflecting the strength of the evidence');
  L.push('');
  L.push('> **CRITICAL**: Where data is insufficient, "NON DÉTERMINABLE" is stated honestly.');
  L.push('> UNKNOWN is never converted to SAFE.');
  L.push('> "framework implemented" is never converted to "model scientifically validated".');
  L.push('');

  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    L.push(`## ${a.question}`);
    L.push('');
    L.push(`**Answer** [confidence: ${a.confidence}]:`);
    L.push('');
    L.push(a.answer);
    L.push('');
    L.push('**Evidence**:');
    L.push('');
    L.push(a.evidence);
    L.push('');
    L.push('---');
    L.push('');
  }

  // Summary
  L.push('## SUMMARY');
  L.push('');
  L.push('| # | Confidence | Key Finding |');
  L.push('|---|------------|------------|');
  const summaries = [
    'Q1-Q3: 0 prédictions exploitables sans Neon',
    'Q4: Performance vs baselines NON DÉTERMINABLE',
    'Q5: Modèle probablement MAL calibré (heuristic confidence)',
    'Q6: Incertitude INCONNUE (N=0)',
    'Q7: AI improvement NON DÉTERMINABLE (AI_WEIGHT arbitrary)',
    'Q8: H2H improvement NON DÉTERMINABLE (coefficients arbitrary)',
    'Q9: Form improvement NON DÉTERMINABLE (double comptage form→momentum)',
    'Q10: Momentum PAS indépendant (dérivé de form)',
    'Q11: Anti-trap PARTIELLEMENT indépendant',
    'Q12: Stats PARTIELLEMENT indépendant (risque double comptage avec odds)',
    'Q13: Double comptage CONFIRMÉ (6 chemins, 2 HIGH)',
    'Q14: Pas de fuite détectée dans le code, mais UNKNOWN sans snapshot',
    'Q15: Anciennes prédictions NON utilisables pour full model',
    'Q16: Nouvelles prédictions THÉORIQUEMENT validables via snapshots',
    'Q17: SEUL le framework est validé, pas le modèle',
    'Q18: TOUT le modèle prédictif reste non validé',
  ];
  for (let i = 0; i < summaries.length; i++) {
    const a = answers[i];
    L.push(`| ${i + 1} | ${a.confidence} | ${summaries[i]} |`);
  }
  L.push('');

  return L.join('\n');
}

function generateEngineBehaviorReport(
  behavior: EngineBehaviorResult[],
  ablation: AblationComparison[]
): string {
  const L: string[] = [];
  L.push('# ENGINE BEHAVIOR ANALYSIS — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push('## 1. Model vs Odds Divergence');
  L.push('');
  L.push('How much does the VirtuMatch model modify odds-implied probabilities?');
  L.push('');
  L.push('| Odds (H/D/A) | Model (H/D/A) | Odds Winner | Model Winner | Max Divergence |');
  L.push('|--------------|---------------|-------------|-------------|----------------|');
  for (const r of behavior) {
    L.push(`| ${r.input.oddHome}/${r.input.oddDraw}/${r.input.oddAway} | ${(r.output.probHome * 100).toFixed(1)}/${(r.output.probDraw * 100).toFixed(1)}/${(r.output.probAway * 100).toFixed(1)}% | ${r.oddsImplied.winner} | ${r.output.winner} | ${(r.divergence.maxDivergence * 100).toFixed(2)}% |`);
  }
  L.push('');

  const avgDiv = behavior.reduce((s, r) => s + r.divergence.maxDivergence, 0) / behavior.length;
  const reversals = behavior.filter(r => r.output.winner !== r.oddsImplied.winner);
  L.push(`**Average divergence**: ${(avgDiv * 100).toFixed(2)}%`);
  L.push(`**Prediction reversals**: ${reversals.length} / ${behavior.length}`);
  L.push('');

  L.push('## 2. Divergence Direction Analysis');
  L.push('');
  L.push('When the model diverges from odds, which direction does it tend?');
  L.push('');
  const homeBias = behavior.reduce((s, r) => s + r.divergence.home, 0) / behavior.length;
  const drawBias = behavior.reduce((s, r) => s + r.divergence.draw, 0) / behavior.length;
  const awayBias = behavior.reduce((s, r) => s + r.divergence.away, 0) / behavior.length;
  L.push(`- Home probability: average shift = ${(homeBias * 100).toFixed(2)}% (${homeBias > 0 ? 'model boosts home' : 'model reduces home'})`);
  L.push(`- Draw probability: average shift = ${(drawBias * 100).toFixed(2)}% (${drawBias > 0 ? 'model boosts draws' : 'model reduces draws'})`);
  L.push(`- Away probability: average shift = ${(awayBias * 100).toFixed(2)}% (${awayBias > 0 ? 'model boosts away' : 'model reduces away'})`);
  L.push('');

  L.push('## 3. Confidence Analysis');
  L.push('');
  L.push('| Odds | Model Confidence | Expected Goals |');
  L.push('|------|----------------|---------------|');
  for (const r of behavior) {
    L.push(`| ${r.input.oddHome}/${r.input.oddDraw}/${r.input.oddAway} | ${r.output.confidence}% | ${r.output.expectedGoals.toFixed(2)} |`);
  }
  L.push('');

  const avgConf = behavior.reduce((s, r) => s + r.output.confidence, 0) / behavior.length;
  L.push(`**Average confidence**: ${avgConf.toFixed(1)}%`);
  L.push(`**Confidence range**: ${Math.min(...behavior.map(r => r.output.confidence))}% - ${Math.max(...behavior.map(r => r.output.confidence))}%`);
  L.push('');
  L.push('**Note**: Confidence is a heuristic score (25-82%), NOT a calibrated probability.');
  L.push('Using it as a probability in LogLoss/Brier calculations would be incorrect.');
  L.push('');

  return L.join('\n');
}

function generateCoefficientAuditReport(coeffAudit: ReturnType<typeof auditCoefficients>): string {
  const L: string[] = [];
  L.push('# COEFFICIENT CALIBRATION AUDIT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(`- **Total coefficients**: ${coeffAudit.total}`);
  L.push(`- **Arbitrary** (NO empirical basis — priority for calibration): ${coeffAudit.arbitrary.length}`);
  L.push(`- **Heuristic** (reasonable but uncalibrated): ${coeffAudit.heuristic.length}`);
  L.push(`- **Empirically calibrated**: ${coeffAudit.empirical.length}`);
  L.push('');
  L.push('> **0 coefficients are empirically calibrated.**');
  L.push('> The entire model is based on assumptions and heuristics, not data.');
  L.push('');

  L.push('## Arbitrary Coefficients (CRITICAL — Priority 1 for Calibration)');
  L.push('');
  L.push('| Coefficient | Value | Description |');
  L.push('|-------------|-------|-------------|');
  for (const c of coeffAudit.arbitrary) {
    L.push(`| ${c.name} | ${c.value} | ${c.description.substring(0, 80)} |`);
  }
  L.push('');

  L.push('## Heuristic Coefficients (Priority 2 for Calibration)');
  L.push('');
  L.push('| Coefficient | Value | Description |');
  L.push('|-------------|-------|-------------|');
  for (const c of coeffAudit.heuristic) {
    L.push(`| ${c.name} | ${c.value} | ${c.description.substring(0, 80)} |`);
  }
  L.push('');

  L.push('## Empirically Calibrated Coefficients');
  L.push('');
  if (coeffAudit.empirical.length === 0) {
    L.push('*None. No coefficient has been calibrated on empirical data.*');
  } else {
    L.push('| Coefficient | Value | Description |');
    L.push('|-------------|-------|-------------|');
    for (const c of coeffAudit.empirical) {
      L.push(`| ${c.name} | ${c.value} | ${c.description} |`);
    }
  }
  L.push('');

  L.push('## Calibration Recommendations');
  L.push('');
  L.push('### Phase 5 — After sufficient data collection:');
  L.push('');
  L.push('1. **VIRTUAL_AVG_GOALS** (current: 1.3): Calibrate on actual virtual football goal averages. This is THE most impactful coefficient.');
  L.push('2. **AI_WEIGHT** (current: 0.35): Sweep on VALIDATION set. If ablation shows no improvement vs odds-only, consider reducing to 0.10-0.20.');
  L.push('3. **FORM_ATTACK_BOOST / FORM_DEFENSE_PENALTY** (current: 0.15/0.10): Calibrate on historical form vs outcome correlation.');
  L.push('4. **H2H_HOME_BOOST / H2H_AWAY_PENALTY** (current: 0.5/0.3): Validate H2H contribution via ablation.');
  L.push('5. **Momentum**: Consider REMOVING as independent feature (it is derived from form — double counting).');
  L.push('');

  return L.join('\n');
}

// ═══════════════════════════════════════════════════════════════════

main().catch(err => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
