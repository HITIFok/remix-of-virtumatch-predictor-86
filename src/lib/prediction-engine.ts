// ============================================
// MOTEUR DE PRÉDICTION POISSON AVANCÉ v2.0
// Algorithme basé sur Grid Search + Distribution de Poisson
// v2.0: Utilise teamStats, forme, H2H, IA, redistribution virtuelle
// ============================================

export interface MatchInput {
  id?: string;
  home: string;
  away: string;
  league: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  newSeasonMode?: boolean;
}

export interface TeamStats {
  name: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string[];
  avgGoalsScored: number;
  avgGoalsConceded: number;
  winRate: number;
  homeWinRate?: number;
  awayWinRate?: number;
}

export interface HistoricalResult {
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  round: number;
  league: string;
}

export interface AIPrediction {
  scoreHome: number;
  scoreAway: number;
  confidence: number;
  reasoning: string;
  isAntiTrap: boolean;
  firstHalfGoal: boolean;
  tendency: string;
  dangerLevel: "safe" | "moderate" | "trap";
  topScores: { score: string; probability: number }[];
  bttsProb: number;
  over25Prob: number;
  firstHalfScore: string;
  systemHome?: string;
  systemAway?: string;
  possessionHome?: number;
  possessionAway?: number;
}

export interface MatchResult {
  id: string;
  home: string;
  away: string;
  league: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  winner1X2: string;
  firstHalfGoalProb: number;
  expectedGoals: number;
  goalsHome: number;
  goalsAway: number;
  scoreHome: number;
  scoreAway: number;
  exactScore: string;
  probGG: number;
  probGN: number;
  ggResult: string;
  totalGoals: number;
  parity: string;
  overUnder15: string;
  overUnder25: string;
  overUnder35: string;
  timestamp: number;
  aiConfidence: number;
  aiReasoning: string;
  isAntiTrap: boolean;
  firstHalfGoal: boolean;
  tendency: string;
  dangerLevel: "safe" | "moderate" | "trap";
  topScores: { score: string; probability: number }[];
  bttsProb: number;
  over25Prob: number;
  firstHalfScore: string;
  systemHome: string;
  systemAway: string;
  possessionHome: number;
  possessionAway: number;
  homeForm: string;
  awayForm: string;
  homeAdvantage: number;
  rankingDiff: number;
  predictedOutcome: string;
  lambdaHome: number;
  lambdaAway: number;
  favorite: '1' | 'X' | '2';
  favoriteProb: number;
  isTrueTrap: boolean;
  isFalseTrap: boolean;
  isTrueDraw: boolean;
  isFalseDraw: boolean;
  isDomination: boolean;
  alternativeScore?: string;
  situation: string;
}

let idCounter = 0;

// ============================================
// ÉTAPE 1 — CONVERSION DES COTES EN PROBABILITÉS 1X2
// ============================================
function convertOddsToProbabilities(oddHome: number, oddDraw: number, oddAway: number): {
  pH: number; pD: number; pA: number;
  favorite: '1' | 'X' | '2';
  favoriteProb: number;
} {
  const invH = 1 / oddHome;
  const invD = 1 / oddDraw;
  const invA = 1 / oddAway;
  const total = invH + invD + invA;

  const pH = invH / total;
  const pD = invD / total;
  const pA = invA / total;

  let favorite: '1' | 'X' | '2';
  let favoriteProb: number;

  if (pH >= pD && pH >= pA) {
    favorite = '1';
    favoriteProb = pH;
  } else if (pA >= pD) {
    favorite = '2';
    favoriteProb = pA;
  } else {
    favorite = 'X';
    favoriteProb = pD;
  }

  return { pH, pD, pA, favorite, favoriteProb };
}

// ============================================
// ÉTAPE 2 — DISTRIBUTION DE POISSON
// ============================================

const factorialCache: number[] = [1, 1, 2, 6, 24, 120, 720, 5040];
function factorial(n: number): number {
  if (n < factorialCache.length) return factorialCache[n];
  let r = factorialCache[factorialCache.length - 1];
  for (let i = factorialCache.length; i <= n; i++) {
    r *= i;
    factorialCache.push(r);
  }
  return r;
}

function poisson(lambda: number, k: number): number {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

// ============================================
// ÉTAPE 3 — ESTIMATION DES LAMBDAS (GRID SEARCH)
// ============================================

function calculate1X2FromLambdas(lambdaH: number, lambdaA: number): { pH: number; pD: number; pA: number } {
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const p = poisson(lambdaH, h) * poisson(lambdaA, a);
      if (h > a) pH += p;
      else if (h < a) pA += p;
      else pD += p;
    }
  }
  return { pH, pD, pA };
}

function gridSearchLambdas(
  targetPH: number, targetPD: number, targetPA: number
): { lambdaH: number; lambdaA: number; error: number } {
  const minLambda = 0.5;
  const maxLambda = 3.0;
  const step = 0.05;

  let bestLambdaH = 1.5;
  let bestLambdaA = 1.2;
  let bestError = Infinity;

  for (let lambdaH = minLambda; lambdaH <= maxLambda; lambdaH += step) {
    for (let lambdaA = minLambda; lambdaA <= maxLambda; lambdaA += step) {
      const { pH, pD, pA } = calculate1X2FromLambdas(lambdaH, lambdaA);
      const error = Math.pow(pH - targetPH, 2) +
                    Math.pow(pD - targetPD, 2) +
                    Math.pow(pA - targetPA, 2);

      if (error < bestError) {
        bestError = error;
        bestLambdaH = lambdaH;
        bestLambdaA = lambdaA;
      }
    }
  }

  return {
    lambdaH: Math.round(bestLambdaH * 100) / 100,
    lambdaA: Math.round(bestLambdaA * 100) / 100,
    error: bestError
  };
}

// ============================================
// NOUVEAU — EXTRACTION FORME & H2H
// ============================================

interface TeamForm {
  formScores: string[];   // derniers résultats ["V","N","D"...]
  avgScored: number;      // buts marqués/match récent
  avgConceded: number;    // buts encaissés/match récent
  momentumScore: number;  // 0-100 (pondéré: V=3,N=1,D=0, décroissant)
  goalsBalance: number;   // buts marqués - encaissés récents
}

const FORM_WEIGHTS = [1.5, 1.3, 1.2, 1.1, 1.0];
const FORM_POINTS: Record<string, number> = { V: 3, N: 1, D: 0 };

/**
 * Extrait la forme récente d'une équipe à partir des résultats historiques.
 * Cherche les 5 derniers matchs de l'équipe (domicile ou extérieur).
 */
function extractTeamForm(
  results: HistoricalResult[],
  teamName: string
): TeamForm {
  const teamLower = teamName.toLowerCase().trim();
  const matches: { scored: number; conceded: number; result: string }[] = [];

  // Parcourir les résultats du plus récent au plus ancien
  for (let i = results.length - 1; i >= 0 && matches.length < 5; i--) {
    const r = results[i];
    const rHome = r.home.toLowerCase().trim();
    const rAway = r.away.toLowerCase().trim();

    if (rHome === teamLower) {
      const res = r.scoreHome > r.scoreAway ? "V" : r.scoreHome < r.scoreAway ? "D" : "N";
      matches.push({ scored: r.scoreHome, conceded: r.scoreAway, result: res });
    } else if (rAway === teamLower) {
      const res = r.scoreAway > r.scoreHome ? "V" : r.scoreAway < r.scoreHome ? "D" : "N";
      matches.push({ scored: r.scoreAway, conceded: r.scoreHome, result: res });
    }
  }

  if (matches.length === 0) {
    return { formScores: [], avgScored: 1.3, avgConceded: 1.1, momentumScore: 50, goalsBalance: 0 };
  }

  const formScores = matches.map(m => m.result);
  const avgScored = matches.reduce((s, m) => s + m.scored, 0) / matches.length;
  const avgConceded = matches.reduce((s, m) => s + m.conceded, 0) / matches.length;

  // Momentum pondéré (matchs récents comptent plus)
  let earnedPoints = 0;
  let maxPoints = 0;
  for (let i = 0; i < matches.length; i++) {
    const w = FORM_WEIGHTS[i] || 1.0;
    earnedPoints += (FORM_POINTS[matches[i].result] || 0) * w;
    maxPoints += 3 * w;
  }
  const momentumScore = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 50;
  const goalsBalance = avgScored - avgConceded;

  return { formScores, avgScored, avgConceded, momentumScore, goalsBalance };
}

interface H2HData {
  totalMatches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  avgTotalGoals: number;
  homeTeamBias: number;  // positif = home dominant, négatif = away dominant
}

/**
 * Extrait les confrontations directes entre deux équipes.
 */
function extractH2H(
  results: HistoricalResult[],
  home: string,
  away: string
): H2HData {
  const hLower = home.toLowerCase().trim();
  const aLower = away.toLowerCase().trim();
  const h2hMatches: { homeGoals: number; awayGoals: number; isHomeTeam: boolean }[] = [];

  for (const r of results) {
    const rHome = r.home.toLowerCase().trim();
    const rAway = r.away.toLowerCase().trim();

    // Match direct entre les deux équipes
    if ((rHome === hLower && rAway === aLower)) {
      h2hMatches.push({ homeGoals: r.scoreHome, awayGoals: r.scoreAway, isHomeTeam: true });
    } else if ((rHome === aLower && rAway === hLower)) {
      h2hMatches.push({ homeGoals: r.scoreAway, awayGoals: r.scoreHome, isHomeTeam: false });
    }
  }

  if (h2hMatches.length === 0) {
    return {
      totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0,
      avgHomeGoals: 0, avgAwayGoals: 0, avgTotalGoals: 0, homeTeamBias: 0
    };
  }

  let homeWins = 0, draws = 0, awayWins = 0;
  let totalHomeGoals = 0, totalAwayGoals = 0;

  for (const m of h2hMatches) {
    totalHomeGoals += m.homeGoals;
    totalAwayGoals += m.awayGoals;
    if (m.homeGoals > m.awayGoals) homeWins++;
    else if (m.homeGoals < m.awayGoals) awayWins++;
    else draws++;
  }

  const n = h2hMatches.length;
  // homeTeamBias: positif = l'équipe home (dans le match à prédire) domine en H2H
  const homeTeamBias = ((homeWins - awayWins) / n) * 100;

  return {
    totalMatches: n,
    homeWins,
    draws,
    awayWins,
    avgHomeGoals: Math.round((totalHomeGoals / n) * 100) / 100,
    avgAwayGoals: Math.round((totalAwayGoals / n) * 100) / 100,
    avgTotalGoals: Math.round(((totalHomeGoals + totalAwayGoals) / n) * 100) / 100,
    homeTeamBias: Math.round(homeTeamBias),
  };
}

// ============================================
// NOUVEAU — AJUSTEMENT DES LAMBDAS
// ============================================

// Moyenne virtuelle de buts par équipe par match
const VIRTUAL_AVG_GOALS = 1.3;

/**
 * Ajuste les lambdas en utilisant les statistiques des équipes (classement).
 * Utilise les ratios attaque/défense par rapport à la moyenne virtuelle.
 */
function adjustLambdasWithStats(
  lambdaH: number,
  lambdaA: number,
  teamStats: Map<string, TeamStats> | undefined,
  home: string,
  away: string
): { lambdaH: number; lambdaA: number; hasData: boolean } {
  if (!teamStats) return { lambdaH, lambdaA, hasData: false };

  const homeStats = teamStats.get(home) || findTeamStats(teamStats, home);
  const awayStats = teamStats.get(away) || findTeamStats(teamStats, away);

  if (!homeStats && !awayStats) return { lambdaH, lambdaA, hasData: false };

  let adjustedH = lambdaH;
  let adjustedA = lambdaA;

  // Ajustement attaque/défense pour l'équipe home
  if (homeStats && homeStats.played >= 3) {
    const attackStrength = homeStats.avgGoalsScored / VIRTUAL_AVG_GOALS;
    const defenseWeakness = homeStats.avgGoalsConceded / VIRTUAL_AVG_GOALS;

    // Force d'attaque home: augmente lambdaH
    // Faiblesse défensive home: augmente lambdaA (adversaire marque plus)
    adjustedH = adjustedH * 0.70 + adjustedH * attackStrength * 0.20 + (lambdaA * defenseWeakness) * 0.10;
  }

  // Ajustement attaque/défense pour l'équipe away
  if (awayStats && awayStats.played >= 3) {
    const attackStrength = awayStats.avgGoalsScored / VIRTUAL_AVG_GOALS;
    const defenseWeakness = awayStats.avgGoalsConceded / VIRTUAL_AVG_GOALS;

    adjustedA = adjustedA * 0.70 + adjustedA * attackStrength * 0.20 + (lambdaH * defenseWeakness) * 0.10;
  }

  // Clamp aux bornes réalistes du football virtuel
  return {
    lambdaH: clamp(adjustedH, 0.3, 2.8),
    lambdaA: clamp(adjustedA, 0.3, 2.8),
    hasData: true,
  };
}

/**
 * Ajuste les lambdas en utilisant la forme récente et le H2H.
 */
function adjustLambdasWithHistory(
  lambdaH: number,
  lambdaA: number,
  homeForm: TeamForm,
  awayForm: TeamForm,
  h2h: H2HData
): { lambdaH: number; lambdaA: number; formAgreement: number; h2hAgreement: number } {
  let adjustedH = lambdaH;
  let adjustedA = lambdaA;

  // ── Ajustement forme récente ──
  // Si une équipe marque plus que la moyenne virtuelle, booster son lambda
  // Si elle encaisse plus, booster le lambda adverse
  if (homeForm.formScores.length >= 3) {
    const attackBoost = (homeForm.avgScored - VIRTUAL_AVG_GOALS) * 0.15;
    const defensePenalty = (homeForm.avgConceded - VIRTUAL_AVG_GOALS) * 0.10;
    adjustedH += attackBoost - defensePenalty * 0.5;
    adjustedA += defensePenalty * 0.3;
  }

  if (awayForm.formScores.length >= 3) {
    const attackBoost = (awayForm.avgScored - VIRTUAL_AVG_GOALS) * 0.15;
    const defensePenalty = (awayForm.avgConceded - VIRTUAL_AVG_GOALS) * 0.10;
    adjustedA += attackBoost - defensePenalty * 0.5;
    adjustedH += defensePenalty * 0.3;
  }

  // ── Ajustement momentum (forme pondérée) ──
  // Équipe en bonne forme = léger boost, mauvaise forme = léger malus
  if (homeForm.formScores.length >= 3) {
    const momentumBoost = (homeForm.momentumScore - 50) / 500; // -0.10 à +0.10
    adjustedH += momentumBoost;
  }
  if (awayForm.formScores.length >= 3) {
    const momentumBoost = (awayForm.momentumScore - 50) / 500;
    adjustedA += momentumBoost;
  }

  // ── Ajustement H2H ──
  // Si l'équipe home domine historiquement, léger boost
  if (h2h.totalMatches >= 2) {
    const h2hBoost = h2h.homeTeamBias / 200; // -0.15 à +0.15
    adjustedH += h2hBoost * 0.5;
    adjustedA -= h2hBoost * 0.3;
  }

  // Calculer l'accord entre forme et favori
  const formAgreement = (homeForm.momentumScore > awayForm.momentumScore + 15) ? 1
    : (awayForm.momentumScore > homeForm.momentumScore + 15) ? -1 : 0;

  const h2hAgreement = h2h.totalMatches >= 2
    ? (h2h.homeTeamBias > 20 ? 1 : h2h.homeTeamBias < -20 ? -1 : 0)
    : 0;

  return {
    lambdaH: clamp(adjustedH, 0.3, 2.8),
    lambdaA: clamp(adjustedA, 0.3, 2.8),
    formAgreement,
    h2hAgreement,
  };
}

// ============================================
// NOUVEAU — FUSION IA / MATHS
// ============================================

interface ScoreMatrix {
  score: string;
  h: number;
  a: number;
  prob: number;
  outcome: '1' | 'X' | '2';
}

/**
 * Fusionne la prédiction IA avec la matrice mathématique.
 * Si l'IA donne un score spécifique, on le booste dans la matrice.
 * Blend: 65% maths + 35% IA (les maths sont plus fiables en virtuel).
 */
function blendWithAI(
  scoreMatrix: ScoreMatrix[],
  aiPrediction: AIPrediction | undefined,
  favorite: '1' | 'X' | '2'
): { matrix: ScoreMatrix[]; aiAgreement: number } {
  if (!aiPrediction || aiPrediction.scoreHome === undefined) {
    return { matrix: scoreMatrix, aiAgreement: 0 };
  }

  const aiScore = `${aiPrediction.scoreHome}-${aiPrediction.scoreAway}`;
  const aiOutcome = aiPrediction.scoreHome > aiPrediction.scoreAway ? '1'
    : aiPrediction.scoreHome < aiPrediction.scoreAway ? '2' : 'X';

  // L'IA est-elle d'accord avec le favori des cotes ?
  const aiAgreement = aiOutcome === favorite ? 1 : -1;

  // Trouver le score prédit par l'IA dans la matrice
  const aiEntry = scoreMatrix.find(s => s.score === aiScore);

  // Boost: augmenter la probabilité du score IA de 35% et réduire les autres
  const AI_WEIGHT = 0.35;
  const boosted = scoreMatrix.map(s => {
    if (s.score === aiScore) {
      return { ...s, prob: s.prob * (1 + AI_WEIGHT) };
    }
    // Réduire proportionnellement
    return { ...s, prob: s.prob * (1 - AI_WEIGHT * s.prob) };
  });

  // Renormaliser
  const total = boosted.reduce((sum, s) => sum + s.prob, 0);
  const normalized = boosted.map(s => ({ ...s, prob: s.prob / total }));

  // Retrier
  return { matrix: normalized.sort((a, b) => b.prob - a.prob), aiAgreement };
}

// ============================================
// NOUVEAU — REDISTRIBUTION FOOTBALL VIRTUEL
// ============================================

/**
 * En football virtuel, les scores 4+ sont extrêmement rares (<3%).
 * On élimine les scores irréalistes et on redistribue leur probabilité
 * vers les scores les plus probables du football virtuel.
 *
 * Distribution typique virtuelle:
 *   0-0 (18%), 1-0 (15%), 0-1 (13%), 1-1 (14%),
 *   2-0 (10%), 0-2 (8%), 2-1 (9%), 1-2 (7%),
 *   2-2 (3%), 3-0 (1.5%), 0-3 (1%), 3-1 (0.5%)
 */
function redistributeForVirtualFootball(scoreMatrix: ScoreMatrix[]): ScoreMatrix[] {
  const VIRTUAL_CAP = 3; // Max 3 buts par équipe

  // Scores "réalistes" en virtuel (priorité de redistribution)
  const priorityScores = new Set([
    "0-0", "1-0", "0-1", "1-1", "2-0", "0-2", "2-1", "1-2", "2-2", "3-0", "0-3", "3-1", "1-3"
  ]);

  let excess = 0;
  const adjusted = scoreMatrix.map(s => {
    if (s.h > VIRTUAL_CAP || s.a > VIRTUAL_CAP) {
      // Score irréaliste: éliminer complètement
      excess += s.prob;
      return { ...s, prob: 0 };
    }
    if (s.h === VIRTUAL_CAP && s.a === VIRTUAL_CAP) {
      // 3-3 est très rare: réduire de 70%
      const reduction = s.prob * 0.70;
      excess += reduction;
      return { ...s, prob: s.prob - reduction };
    }
    if ((s.h === VIRTUAL_CAP && s.a >= 2) || (s.a === VIRTUAL_CAP && s.h >= 2)) {
      // 3-2, 3-1, etc.: réduire de 40%
      const reduction = s.prob * 0.40;
      excess += reduction;
      return { ...s, prob: s.prob - reduction };
    }
    return s;
  });

  if (excess <= 0) {
    return adjusted.sort((a, b) => b.prob - a.prob);
  }

  // Redistribuer l'excédent vers les scores réalistes, proportionnellement
  // avec un bonus pour les scores les plus fréquents en virtuel
  const realistic = adjusted.filter(s => s.prob > 0 && priorityScores.has(s.score));
  const realisticTotal = realistic.reduce((sum, s) => sum + s.prob, 0);

  if (realisticTotal > 0) {
    // Bonus pour les scores les plus fréquents (0-0, 1-0, 1-1, 2-0, 2-1)
    const topVirtualBonus: Record<string, number> = {
      "0-0": 1.15, "1-0": 1.12, "0-1": 1.10, "1-1": 1.12,
      "2-0": 1.08, "0-2": 1.05, "2-1": 1.06, "1-2": 1.04,
    };

    // Calculer les poids de redistribution
    const weightedTotal = realistic.reduce((sum, s) => {
      const bonus = topVirtualBonus[s.score] || 1.0;
      return sum + (s.prob / realisticTotal) * bonus;
    }, 0);

    const redistributed = adjusted.map(s => {
      if (s.prob > 0 && priorityScores.has(s.score)) {
        const bonus = topVirtualBonus[s.score] || 1.0;
        const share = (s.prob / realisticTotal) * bonus / weightedTotal;
        return { ...s, prob: s.prob + excess * share };
      }
      return s;
    });

    // Renormaliser pour garantir somme = 1
    const newTotal = redistributed.reduce((sum, s) => sum + s.prob, 0);
    return redistributed
      .map(s => ({ ...s, prob: s.prob / newTotal }))
      .sort((a, b) => b.prob - a.prob);
  }

  return adjusted.sort((a, b) => b.prob - a.prob);
}

// ============================================
// MATRICE DES SCORES
// ============================================

function generateScoreMatrix(lambdaH: number, lambdaA: number): ScoreMatrix[] {
  const scores: ScoreMatrix[] = [];
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const prob = poisson(lambdaH, h) * poisson(lambdaA, a);
      const outcome: '1' | 'X' | '2' = h > a ? '1' : h < a ? '2' : 'X';
      scores.push({ score: `${h}-${a}`, h, a, prob, outcome });
    }
  }
  return scores.sort((a, b) => b.prob - a.prob);
}

// ============================================
// SCORE PRINCIPAL & DÉTECTION DE PIÈGE
// ============================================

function determineMainScore(
  scoreMatrix: ScoreMatrix[],
  favorite: '1' | 'X' | '2',
  favoriteProb: number
): {
  mainScore: ScoreMatrix;
  alternativeScore?: ScoreMatrix;
  isTrueTrap: boolean;
  isAntiTrap: boolean;
} {
  const topScore = scoreMatrix[0];
  let mainScore = topScore;
  let alternativeScore: ScoreMatrix | undefined;
  let isTrueTrap = false;
  let isAntiTrap = false;

  if (topScore.outcome !== favorite) {
    isTrueTrap = true;
    const filteredScores = scoreMatrix.filter(s => s.outcome === favorite);
    if (filteredScores.length > 0) {
      mainScore = filteredScores[0];
      isAntiTrap = true;
    }
  }

  const secondScore = scoreMatrix[1];
  if (secondScore && secondScore.prob > topScore.prob * 0.85) {
    alternativeScore = secondScore;
  }

  return { mainScore, alternativeScore, isTrueTrap, isAntiTrap };
}

// ============================================
// DÉTECTIONS SPÉCIALES (améliorée avec données)
// ============================================

interface SpecialDetections {
  isTrueTrap: boolean;
  isFalseTrap: boolean;
  isTrueDraw: boolean;
  isFalseDraw: boolean;
  isDomination: boolean;
  antiTrapAlerts: number;
}

function detectSpecialSituations(
  pH: number,
  pD: number,
  pA: number,
  favorite: '1' | 'X' | '2',
  scoreOutcome: '1' | 'X' | '2',
  isTrueTrap: boolean,
  formAgreement: number,
  h2hAgreement: number,
  aiAgreement: number,
  homeForm: TeamForm,
  awayForm: TeamForm,
  homeStats: TeamStats | undefined,
  awayStats: TeamStats | undefined,
): SpecialDetections {
  const probs = [
    { outcome: '1' as const, prob: pH },
    { outcome: 'X' as const, prob: pD },
    { outcome: '2' as const, prob: pA }
  ].sort((a, b) => b.prob - a.prob);

  const firstProb = probs[0].prob;
  const secondProb = probs[1].prob;
  const delta = firstProb - secondProb;

  const isFalseTrap = !isTrueTrap && firstProb > 0.55 && secondProb > 0.35;
  const isTrueDraw = favorite === 'X' && scoreOutcome === 'X';
  const isFalseDraw = favorite === 'X' && scoreOutcome !== 'X';
  const isDomination = delta > 0.40;

  // Compteur d'alertes anti-trap multi-sources
  let antiTrapAlerts = 0;

  // Alerte A: favori aux cotes mais forme défavorable
  const favoriteIsHome = favorite === '1';
  const favForm = favoriteIsHome ? homeForm : awayForm;
  const unfavForm = favoriteIsHome ? awayForm : homeForm;
  if (favForm.formScores.length >= 3 && unfavForm.formScores.length >= 3) {
    if (favForm.momentumScore < 35 && unfavForm.momentumScore > 55) antiTrapAlerts++;
  }

  // Alerte B: favori aux cotes mais attaque faible
  const favStats = favoriteIsHome ? homeStats : awayStats;
  if (favStats && favStats.played >= 3 && favStats.avgGoalsScored < 0.9) antiTrapAlerts++;

  // Alerte C: favori aux cotes mais H2H défavorable
  if (favoriteIsHome && h2hAgreement < 0) antiTrapAlerts++;
  if (!favoriteIsHome && h2hAgreement > 0) antiTrapAlerts++;

  // Alerte D: classement écarté mais cotes serrées
  if (homeStats && awayStats && homeStats.played >= 3 && awayStats.played >= 3) {
    const rankDiff = Math.abs(homeStats.position - awayStats.position);
    if (rankDiff >= 5 && delta < 0.10) antiTrapAlerts++;
  }

  // Alerte E: IA en désaccord avec le favori
  if (aiAgreement < 0) antiTrapAlerts++;

  return {
    isTrueTrap,
    isFalseTrap,
    isTrueDraw,
    isFalseDraw,
    isDomination,
    antiTrapAlerts,
  };
}

// ============================================
// NOUVEAU — CONFIANCE MULTI-FACTEURS
// ============================================

function calculateMultiFactorConfidence(
  favoriteProb: number,
  formAgreement: number,
  h2hAgreement: number,
  aiAgreement: number,
  homeForm: TeamForm,
  awayForm: TeamForm,
  hasStatsData: boolean,
  detections: SpecialDetections,
): number {
  // Base: probabilité implicite du favori, mais plafonnée pour le virtuel
  // En virtuel, l'aléa est plus fort → confiance plus conservatrice
  let confidence = Math.min(favoriteProb * 85, 68); // Max base ~68% (au lieu de 95)

  // Bonus: les données statistiques confirment le favori
  if (formAgreement !== 0 && hasStatsData) {
    confidence += formAgreement * 4;
  }

  // Bonus: H2H confirme
  if (h2hAgreement !== 0) {
    confidence += h2hAgreement * 3;
  }

  // Bonus: IA confirme
  if (aiAgreement !== 0) {
    confidence += aiAgreement * 4;
  }

  // Bonus: données disponibles (plus de données = légère augmentation)
  const dataRichness = Math.min(homeForm.formScores.length, 5) + Math.min(awayForm.formScores.length, 5);
  if (dataRichness >= 6) confidence += 2;
  else if (dataRichness >= 3) confidence += 1;

  // Pénalité: alertes anti-trap (plus sévère)
  confidence -= detections.antiTrapAlerts * 5;

  // Pénalité: cotes très serrées (match incertain)
  const oddsGap = favoriteProb - Math.max(0, 1 - favoriteProb * 2);
  if (oddsGap < 0.05) confidence -= 10;
  else if (oddsGap < 0.10) confidence -= 5;

  // Pénalité: pas de données du tout
  if (!hasStatsData && homeForm.formScores.length === 0) {
    confidence -= 8;
  }

  // Pénalité: piège détecté
  if (detections.isTrueTrap) confidence -= 12;
  if (detections.isFalseTrap) confidence -= 5;

  // Plafond virtuel: jamais plus de 82% (incertitude inhérente au virtuel)
  // Plancher: 25% minimum
  return clamp(Math.round(confidence), 25, 82);
}

// ============================================
// SCORE MI-TEMPS
// ============================================

function calculateHalfTimeScore(lambdaH: number, lambdaA: number): string {
  const lambdaHT_H = lambdaH * 0.46;
  const lambdaHT_A = lambdaA * 0.46;

  let bestHTScore = "0-0";
  let bestHTProb = 0;

  for (let h = 0; h <= 3; h++) {
    for (let a = 0; a <= 3; a++) {
      const prob = poisson(lambdaHT_H, h) * poisson(lambdaHT_A, a);
      if (prob > bestHTProb) {
        bestHTProb = prob;
        bestHTScore = `${h}-${a}`;
      }
    }
  }

  return bestHTScore;
}

// ============================================
// MARCHÉS ADDITIONNELS
// ============================================

function calculateAdditionalMarkets(scoreMatrix: ScoreMatrix[], mainScore: ScoreMatrix): {
  ggResult: string;
  probGG: number;
  overUnder25: string;
  probOver25: number;
  parity: string;
} {
  const probGG = scoreMatrix
    .filter(s => s.h >= 1 && s.a >= 1)
    .reduce((sum, s) => sum + s.prob, 0);

  const ggResult = probGG > 0.5 ? "Oui (GG)" : "Non (NG)";

  const probOver25 = scoreMatrix
    .filter(s => s.h + s.a >= 3)
    .reduce((sum, s) => sum + s.prob, 0);

  const overUnder25 = probOver25 > 0.5 ? "Over 2.5" : "Under 2.5";

  const totalGoals = mainScore.h + mainScore.a;
  const parity = totalGoals % 2 === 0 ? "Pair" : "Impair";

  return { ggResult, probGG, overUnder25, probOver25, parity };
}

// ============================================
// UTILITAIRES
// ============================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findTeamStats(statsMap: Map<string, TeamStats>, name: string): TeamStats | undefined {
  // Recherche exacte d'abord
  const exact = statsMap.get(name);
  if (exact) return exact;

  // Recherche insensible à la casse
  const nameLower = name.toLowerCase().trim();
  const keys = Array.from(statsMap.keys());
  for (const key of keys) {
    if (key.toLowerCase().trim() === nameLower) return statsMap.get(key);
  }

  // Recherche partielle (pour les noms légèrement différents)
  for (const key of keys) {
    if (key.toLowerCase().includes(nameLower) || nameLower.includes(key.toLowerCase())) {
      return statsMap.get(key);
    }
  }

  return undefined;
}

// ============================================
// ANALYSE PRINCIPALE v2.0
// ============================================

export function analyzeMatch(
  input: MatchInput,
  aiPrediction?: AIPrediction,
  teamStats?: Map<string, TeamStats>,
  historicalResults?: HistoricalResult[]
): MatchResult {
  const { home, away, league, oddHome, oddDraw, oddAway, newSeasonMode } = input;

  // ==========================================
  // ÉTAPE 1: Conversion des cotes en probabilités
  // ==========================================
  const { pH, pD, pA, favorite, favoriteProb } = convertOddsToProbabilities(oddHome, oddDraw, oddAway);

  // ==========================================
  // ÉTAPE 2: Grid Search pour les lambdas de base
  // ==========================================
  let { lambdaH, lambdaA } = gridSearchLambdas(pH, pD, pA);

  // Mode Nouvelle Saison: boost pour le favori
  if (newSeasonMode) {
    if (favorite === '1') lambdaH = Math.min(3.0, lambdaH + 0.22);
    else if (favorite === '2') lambdaA = Math.min(3.0, lambdaA + 0.22);
  }

  // ==========================================
  // ÉTAPE 3: Extraction des données contextuelles
  // ==========================================
  const homeForm = historicalResults ? extractTeamForm(historicalResults, home) : { formScores: [] as string[], avgScored: 1.3, avgConceded: 1.1, momentumScore: 50, goalsBalance: 0 };
  const awayForm = historicalResults ? extractTeamForm(historicalResults, away) : { formScores: [] as string[], avgScored: 1.3, avgConceded: 1.1, momentumScore: 50, goalsBalance: 0 };
  const h2h = historicalResults ? extractH2H(historicalResults, home, away) : { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0, avgHomeGoals: 0, avgAwayGoals: 0, avgTotalGoals: 0, homeTeamBias: 0 };

  const homeStats = teamStats ? (teamStats.get(home) || findTeamStats(teamStats, home)) : undefined;
  const awayStats = teamStats ? (teamStats.get(away) || findTeamStats(teamStats, away)) : undefined;

  // ==========================================
  // ÉTAPE 4: Ajustement des lambdas avec les stats d'équipe
  // ==========================================
  const statsAdj = adjustLambdasWithStats(lambdaH, lambdaA, teamStats, home, away);
  lambdaH = statsAdj.lambdaH;
  lambdaA = statsAdj.lambdaA;

  // ==========================================
  // ÉTAPE 5: Ajustement des lambdas avec forme + H2H
  // ==========================================
  const histAdj = adjustLambdasWithHistory(lambdaH, lambdaA, homeForm, awayForm, h2h);
  lambdaH = histAdj.lambdaH;
  lambdaA = histAdj.lambdaA;

  // ==========================================
  // ÉTAPE 6: Matrice des scores
  // ==========================================
  let scoreMatrix = generateScoreMatrix(lambdaH, lambdaA);

  // ==========================================
  // ÉTAPE 7: Fusion avec prédiction IA (si disponible)
  // ==========================================
  const { matrix: blendedMatrix, aiAgreement } = blendWithAI(scoreMatrix, aiPrediction, favorite);
  scoreMatrix = blendedMatrix;

  // ==========================================
  // ÉTAPE 8: Redistribution football virtuel
  // ==========================================
  scoreMatrix = redistributeForVirtualFootball(scoreMatrix);

  // ==========================================
  // ÉTAPE 9: Score principal & détection piège
  // ==========================================
  const { mainScore, alternativeScore, isTrueTrap, isAntiTrap } = determineMainScore(
    scoreMatrix, favorite, favoriteProb
  );

  // ==========================================
  // ÉTAPE 10: Détections spéciales (améliorées)
  // ==========================================
  const detections = detectSpecialSituations(
    pH, pD, pA, favorite, mainScore.outcome, isTrueTrap,
    histAdj.formAgreement, histAdj.h2hAgreement, aiAgreement,
    homeForm, awayForm, homeStats, awayStats
  );

  // ==========================================
  // ÉTAPE 11: Score mi-temps
  // ==========================================
  const firstHalfScore = calculateHalfTimeScore(lambdaH, lambdaA);

  // ==========================================
  // ÉTAPE 12: Marchés additionnels
  // ==========================================
  const markets = calculateAdditionalMarkets(scoreMatrix, mainScore);

  // ==========================================
  // ÉTAPE 13: Confiance multi-facteurs
  // ==========================================
  const confidence = calculateMultiFactorConfidence(
    favoriteProb, histAdj.formAgreement, histAdj.h2hAgreement, aiAgreement,
    homeForm, awayForm, statsAdj.hasData, detections
  );

  // ==========================================
  // Génération du résultat
  // ==========================================
  const totalGoals = mainScore.h + mainScore.a;
  const winner1X2 = mainScore.outcome === '1'
    ? `1 — ${home}`
    : mainScore.outcome === '2'
      ? `2 — ${away}`
      : "X (Nul)";

  // Situation
  let situation = "";
  if (detections.isDomination) situation = "Domination";
  else if (detections.isTrueTrap) situation = "Vrai Piège";
  else if (detections.isFalseTrap) situation = "Faux Piège";
  else if (detections.isTrueDraw) situation = "Vrai Nul";
  else if (detections.isFalseDraw) situation = "Faux Nul";
  else situation = "Standard";

  // Si anti-trap alertes >= 2, override situation
  if (detections.antiTrapAlerts >= 3) situation = "Piège Fort";
  else if (detections.antiTrapAlerts >= 2 && situation === "Standard") situation = "Suspicion";

  // ── Raisonnement éducatif v3.0 ──
  // Explique POURQUOI ce score est prédit, pas juste des chiffres bruts
  const reasoningParts: string[] = [];

  // 1. Point de départ : ce que disent les cotes
  const favTeam = favorite === '1' ? home : favorite === '2' ? away : 'Nul';
  reasoningParts.push(`${favTeam} favori (${(favoriteProb * 100).toFixed(0)}%)`);

  // 2. Explication des lambdas en langage clair
  const totalXG = lambdaH + lambdaA;
  if (totalXG > 2.5) {
    reasoningParts.push(`Match ouvert (${totalXG.toFixed(1)} buts attendus)`);
  } else if (totalXG < 1.5) {
    reasoningParts.push(`Match fermé (${totalXG.toFixed(1)} buts attendus)`);
  } else {
    reasoningParts.push(`${totalXG.toFixed(1)} buts attendus`);
  }

  // 3. Forme récente — expliquer l'impact
  if (homeForm.formScores.length >= 3 && awayForm.formScores.length >= 3) {
    const homeMomentum = homeForm.momentumScore;
    const awayMomentum = awayForm.momentumScore;
    const diff = homeMomentum - awayMomentum;
    if (Math.abs(diff) > 25) {
      const dominant = diff > 0 ? home.substring(0, 8) : away.substring(0, 8);
      reasoningParts.push(`${dominant} en forte forme (${homeForm.formScores.join("")} vs ${awayForm.formScores.join("")})`);
    } else {
      reasoningParts.push(`Formes: ${home.substring(0, 8)} ${homeForm.formScores.join("")} (${homeMomentum}%) | ${away.substring(0, 8)} ${awayForm.formScores.join("")} (${awayMomentum}%)`);
    }
  }

  // 4. Stats d'attaque/défense (seulement si données valides)
  const homeHasValidStats = homeStats && homeStats.played >= 3 && homeStats.avgGoalsScored > 0;
  const awayHasValidStats = awayStats && awayStats.played >= 3 && awayStats.avgGoalsScored > 0;
  if (homeHasValidStats || awayHasValidStats) {
    const parts: string[] = [];
    if (homeHasValidStats) {
      const attLabel = homeStats!.avgGoalsScored > 1.5 ? "bonne attaque" : homeStats!.avgGoalsScored < 0.8 ? "attaque faible" : "attaque moyenne";
      parts.push(`${home.substring(0, 8)}: ${attLabel} (${homeStats!.avgGoalsScored.toFixed(1)} BM/mj)`);
    }
    if (awayHasValidStats) {
      const attLabel = awayStats!.avgGoalsScored > 1.5 ? "bonne attaque" : awayStats!.avgGoalsScored < 0.8 ? "attaque faible" : "attaque moyenne";
      parts.push(`${away.substring(0, 8)}: ${attLabel} (${awayStats!.avgGoalsScored.toFixed(1)} BM/mj)`);
    }
    reasoningParts.push(parts.join(" | "));
  }

  // 5. H2H — expliquer l'impact
  if (h2h.totalMatches >= 2) {
    if (Math.abs(h2h.homeTeamBias) > 30) {
      const h2hDominant = h2h.homeTeamBias > 0 ? home.substring(0, 8) : away.substring(0, 8);
      reasoningParts.push(`H2H: ${h2hDominant} domine (${h2h.homeWins}V/${h2h.draws}N/${h2h.awayWins}D en ${h2h.totalMatches} matchs)`);
    } else {
      reasoningParts.push(`H2H équilibré (${h2h.homeWins}V/${h2h.draws}N/${h2h.awayWins}D)`);
    }
  }

  // 6. Alertes anti-trap — expliquer le risque
  if (detections.antiTrapAlerts >= 3) {
    reasoningParts.push(`RISQUE ÉLEVÉ: ${detections.antiTrapAlerts}/5 alertes anti-trap`);
  } else if (detections.antiTrapAlerts >= 2) {
    reasoningParts.push(`Attention: ${detections.antiTrapAlerts}/5 alertes`);
  }
  if (detections.isTrueTrap) {
    reasoningParts.push(`Le score le plus probable (${mainScore.score}) contredit le favori des cotes`);
  }

  // 7. IA — mention si disponible
  if (aiPrediction) {
    const aiAgrees = (favorite === '1' && aiPrediction.scoreHome > aiPrediction.scoreAway)
      || (favorite === '2' && aiPrediction.scoreAway > aiPrediction.scoreHome)
      || (favorite === 'X' && aiPrediction.scoreHome === aiPrediction.scoreAway);
    reasoningParts.push(`IA suggère ${aiPrediction.scoreHome}-${aiPrediction.scoreAway} (${aiAgrees ? "confirme" : "contredit"} le favori)`);
  }

  // 8. Score alternative
  if (alternativeScore && alternativeScore.prob > mainScore.prob * 0.7) {
    reasoningParts.push(`Alternative crédible: ${alternativeScore.score} (${(alternativeScore.prob * 100).toFixed(1)}%)`);
  }

  const aiReasoning = reasoningParts.join(". ");

  // Danger level
  let dangerLevel: "safe" | "moderate" | "trap" = "safe";
  if (detections.isTrueTrap || detections.antiTrapAlerts >= 3) {
    dangerLevel = "trap";
  } else if (detections.isFalseTrap || detections.antiTrapAlerts >= 2 ||
             Math.abs(pH - pA) < 0.15 || pD > 0.3) {
    dangerLevel = "moderate";
  }

  // Top 5 scores
  const topScores = scoreMatrix.slice(0, 5).map(s => ({
    score: s.score,
    probability: Math.round(s.prob * 1000) / 1000
  }));

  const firstHalfGoal = firstHalfScore !== "0-0";
  const expectedGoals = lambdaH + lambdaA;

  // System home/away — basé sur les lambdas (buts attendus) plutôt que les stats brutes
  // Les lambdas intègrent déjà cotes + forme + H2H → plus représentatifs
  const systemHome = lambdaH > 1.5 ? "offensif" : lambdaH < 0.8 ? "défensif" : "équilibré";
  const systemAway = lambdaA > 1.5 ? "offensif" : lambdaA < 0.8 ? "défensif" : "équilibré";

  // Possession basée sur les probabilités 1X2 (toujours disponible, même sans stats)
  // Formule: 35 + 30*pH pour home, le reste pour away
  // Cela donne un écart de 0-30% reflétant la domination
  let possessionHome: number;
  let possessionAway: number;
  if (homeStats && awayStats && homeStats.played >= 3 && awayStats.played >= 3
      && homeStats.avgGoalsScored > 0 && awayStats.avgGoalsScored > 0) {
    // Si on a de vraies stats d'attaque, les utiliser
    const totalAttack = homeStats.avgGoalsScored + awayStats.avgGoalsScored;
    possessionHome = Math.round(35 + (homeStats.avgGoalsScored / totalAttack) * 30);
  } else {
    // Sinon, utiliser les probabilités implicites (plus fiable que des stats vides)
    possessionHome = Math.round(35 + pH * 30);
  }
  possessionAway = 100 - possessionHome;

  // Form strings
  const homeFormStr = homeForm.formScores.length > 0 ? homeForm.formScores.join("") : "N/A";
  const awayFormStr = awayForm.formScores.length > 0 ? awayForm.formScores.join("") : "N/A";

  // Ranking diff
  const rankingDiff = (homeStats?.position || 0) > 0 && (awayStats?.position || 0) > 0
    ? (awayStats!.position || 0) - (homeStats!.position || 0)
    : 0;

  // Home advantage
  const homeAdvantage = Math.round((pH - pA) * 100);

  const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `match-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${idCounter++}`;

  return {
    id: input.id || uniqueId,
    home,
    away,
    league,
    oddHome,
    oddDraw,
    oddAway,
    probHome: Math.round(pH * 1000) / 1000,
    probDraw: Math.round(pD * 1000) / 1000,
    probAway: Math.round(pA * 1000) / 1000,
    winner1X2,
    firstHalfGoalProb: firstHalfGoal ? 0.65 : 0.35,
    expectedGoals: Math.round(expectedGoals * 100) / 100,
    goalsHome: Math.round(lambdaH * 100) / 100,
    goalsAway: Math.round(lambdaA * 100) / 100,
    scoreHome: mainScore.h,
    scoreAway: mainScore.a,
    exactScore: mainScore.score,
    probGG: Math.round(markets.probGG * 1000) / 1000,
    probGN: Math.round((1 - markets.probGG) * 1000) / 1000,
    ggResult: markets.ggResult,
    totalGoals,
    parity: markets.parity,
    overUnder15: totalGoals > 1.5 ? "Over 1.5" : "Under 1.5",
    overUnder25: markets.overUnder25,
    overUnder35: totalGoals > 3.5 ? "Over 3.5" : "Under 3.5",
    timestamp: Date.now(),
    aiConfidence: confidence,
    aiReasoning,
    isAntiTrap,
    firstHalfGoal,
    tendency: detections.isDomination ? "Domination nette" : isTrueTrap ? "Piège détecté" : detections.antiTrapAlerts >= 2 ? "Match risqué" : "Match standard",
    dangerLevel,
    topScores,
    bttsProb: Math.round(markets.probGG * 1000) / 1000,
    over25Prob: Math.round(markets.probOver25 * 1000) / 1000,
    firstHalfScore,
    systemHome,
    systemAway,
    possessionHome,
    possessionAway,
    homeForm: homeFormStr,
    awayForm: awayFormStr,
    homeAdvantage,
    rankingDiff,
    predictedOutcome: isAntiTrap ? `Contre-pied: ${winner1X2}` : winner1X2,
    lambdaHome: lambdaH,
    lambdaAway: lambdaA,
    favorite,
    favoriteProb: Math.round(favoriteProb * 1000) / 1000,
    isTrueTrap: detections.isTrueTrap,
    isFalseTrap: detections.isFalseTrap,
    isTrueDraw: detections.isTrueDraw,
    isFalseDraw: detections.isFalseDraw,
    isDomination: detections.isDomination,
    alternativeScore: alternativeScore?.score,
    situation
  };
}

// ============================================
// HELPERS (inchangés)
// ============================================

export function buildTeamStatsMap(ranking: any[]): Map<string, TeamStats> {
  const map = new Map<string, TeamStats>();

  for (const team of ranking) {
    const stats: TeamStats = {
      name: team.team || team.name,
      position: team.position || 0,
      played: team.played || 0,
      won: team.won || 0,
      drawn: team.drawn || team.draw || 0,
      lost: team.lost || 0,
      goalsFor: team.goalsFor || 0,
      goalsAgainst: team.goalsAgainst || 0,
      points: team.points || 0,
      form: [],
      avgGoalsScored: team.played > 0 ? (team.goalsFor || 0) / team.played : 1.3,
      avgGoalsConceded: team.played > 0 ? (team.goalsAgainst || 0) / team.played : 1.1,
      winRate: team.played > 0 ? team.won / team.played : 0.5,
    };
    map.set(stats.name, stats);
  }

  return map;
}

export function prepareHistoricalResults(results: any[]): HistoricalResult[] {
  return results.map(r => ({
    home: r.home || r.homeTeam,
    away: r.away || r.awayTeam,
    scoreHome: r.scoreHome ?? r.homeScore ?? 0,
    scoreAway: r.scoreAway ?? r.awayScore ?? 0,
    round: r.round || r.matchday || 0,
    league: r.league || "Instant League",
  }));
}

// ============================================
// ÉVALUATION DE QUALITÉ DES PRÉDICTIONS
// ============================================

export interface PredictionQuality {
  isReliable: boolean;
  reliabilityScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  recommendation: 'strong' | 'moderate' | 'avoid';
  reason: string;
}

export function evaluatePredictionQuality(
  prediction: '1' | 'X' | '2',
  confidence: number
): PredictionQuality {
  let confidenceLevel: 'high' | 'medium' | 'low';
  if (confidence >= 70) {
    confidenceLevel = 'high';
  } else if (confidence >= 50) {
    confidenceLevel = 'medium';
  } else {
    confidenceLevel = 'low';
  }

  let reliabilityScore = confidence;

  if (prediction === '1') {
    reliabilityScore += 5;
  } else if (prediction === 'X') {
    if (confidence < 75) reliabilityScore -= 20;
  } else {
    reliabilityScore -= 5;
  }

  reliabilityScore = Math.max(0, Math.min(100, reliabilityScore));

  let isReliable = false;
  let recommendation: 'strong' | 'moderate' | 'avoid';
  let reason: string;

  if (confidenceLevel === 'high') {
    isReliable = true;
    recommendation = 'strong';
    reason = `Haute confiance (${confidence}%)`;
  } else if (confidenceLevel === 'medium' && prediction === '1') {
    isReliable = true;
    recommendation = 'moderate';
    reason = `Confiance moyenne (${confidence}%)`;
  } else {
    isReliable = false;
    recommendation = 'avoid';
    reason = `Confiance insuffisante (${confidence}%)`;
  }

  return {
    isReliable,
    reliabilityScore: Math.round(reliabilityScore),
    confidenceLevel,
    recommendation,
    reason
  };
}

export function filterReliablePredictions(
  predictions: Array<{
    prediction: '1' | 'X' | '2';
    confidence: number;
    home: string;
    away: string;
  }>
): Array<{
  home: string;
  away: string;
  prediction: '1' | 'X' | '2';
  confidence: number;
  quality: PredictionQuality;
}> {
  return predictions
    .map(p => ({
      ...p,
      quality: evaluatePredictionQuality(p.prediction, p.confidence)
    }))
    .filter(p => p.quality.isReliable)
    .sort((a, b) => b.quality.reliabilityScore - a.quality.reliabilityScore);
}