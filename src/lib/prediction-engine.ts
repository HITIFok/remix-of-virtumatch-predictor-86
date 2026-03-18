// ============================================
// MOTEUR DE PRÉDICTION POISSON AVANCÉ
// Algorithme basé sur Grid Search + Distribution de Poisson
// ============================================

export interface MatchInput {
  id?: string;
  home: string;
  away: string;
  league: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  newSeasonMode?: boolean; // Boost +0.22 pour le favori
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
  // Nouveaux champs pour l'algorithme avancé
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

/**
 * Convertit les cotes en probabilités normalisées (marge bookmaker retirée)
 */
function convertOddsToProbabilities(oddHome: number, oddDraw: number, oddAway: number): {
  pH: number;  // Probabilité victoire domicile
  pD: number;  // Probabilité nul
  pA: number;  // Probabilité victoire extérieur
  favorite: '1' | 'X' | '2';
  favoriteProb: number;
} {
  // Inverses des cotes
  const invH = 1 / oddHome;
  const invD = 1 / oddDraw;
  const invA = 1 / oddAway;
  
  // Somme totale (inclut la marge du bookmaker)
  const total = invH + invD + invA;
  
  // Normalisation pour retirer la marge
  const pH = invH / total;
  const pD = invD / total;
  const pA = invA / total;
  
  // Identifier le favori
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
// ÉTAPE 3 — DISTRIBUTION DE POISSON
// ============================================

/**
 * Calcule la factorielle (avec cache pour performance)
 */
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

/**
 * Distribution de Poisson: P(k | λ) = e^(-λ) × λ^k / k!
 */
function poisson(lambda: number, k: number): number {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

// ============================================
// ÉTAPE 2 — ESTIMATION DES LAMBDAS (GRID SEARCH)
// ============================================

/**
 * Calcule les probabilités 1X2 à partir des lambdas
 */
function calculate1X2FromLambdas(lambdaH: number, lambdaA: number): { pH: number; pD: number; pA: number } {
  let pH = 0, pD = 0, pA = 0;
  
  // Somme sur tous les scores possibles (0-0 à 10-10 pour précision)
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

/**
 * Grid Search pour trouver les meilleurs lambdas
 * Teste toutes les combinaisons entre 0.5 et 3.0 (pas de 0.05)
 */
function gridSearchLambdas(
  targetPH: number,
  targetPD: number,
  targetPA: number
): { lambdaH: number; lambdaA: number; error: number } {
  const minLambda = 0.5;
  const maxLambda = 3.0;
  const step = 0.05;
  
  let bestLambdaH = 1.5;
  let bestLambdaA = 1.2;
  let bestError = Infinity;
  
  // Grid search
  for (let lambdaH = minLambda; lambdaH <= maxLambda; lambdaH += step) {
    for (let lambdaA = minLambda; lambdaA <= maxLambda; lambdaA += step) {
      const { pH, pD, pA } = calculate1X2FromLambdas(lambdaH, lambdaA);
      
      // Erreur quadratique
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
// ÉTAPE 4 — MATRICE DES SCORES 7×7
// ============================================

interface ScoreMatrix {
  score: string;
  h: number;
  a: number;
  prob: number;
  outcome: '1' | 'X' | '2';
}

/**
 * Génère la matrice 7×7 des scores possibles (0-0 à 6-6)
 */
function generateScoreMatrix(lambdaH: number, lambdaA: number): ScoreMatrix[] {
  const scores: ScoreMatrix[] = [];
  
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const prob = poisson(lambdaH, h) * poisson(lambdaA, a);
      const outcome: '1' | 'X' | '2' = h > a ? '1' : h < a ? '2' : 'X';
      
      scores.push({
        score: `${h}-${a}`,
        h,
        a,
        prob,
        outcome
      });
    }
  }
  
  // Trier par probabilité décroissante
  return scores.sort((a, b) => b.prob - a.prob);
}

// ============================================
// ÉTAPE 5 — SCORE PRINCIPAL & DÉTECTION DE PIÈGE
// ============================================

/**
 * Détermine le score principal avec détection de piège
 */
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
  
  // Vérifier la cohérence avec le favori
  if (topScore.outcome !== favorite) {
    // VRAI PIÈGE: Le score le plus probable ne correspond pas au favori
    isTrueTrap = true;
    
    // Forcer un score qui respecte le favori
    const filteredScores = scoreMatrix.filter(s => s.outcome === favorite);
    if (filteredScores.length > 0) {
      mainScore = filteredScores[0];
      isAntiTrap = true;
    }
  }
  
  // Score alternatif si le 2ème a >85% de la proba du 1er
  const secondScore = scoreMatrix[1];
  if (secondScore && secondScore.prob > topScore.prob * 0.85) {
    alternativeScore = secondScore;
  }
  
  return { mainScore, alternativeScore, isTrueTrap, isAntiTrap };
}

// ============================================
// ÉTAPE 6 — DÉTECTIONS SPÉCIALES
// ============================================

interface SpecialDetections {
  isTrueTrap: boolean;
  isFalseTrap: boolean;
  isTrueDraw: boolean;
  isFalseDraw: boolean;
  isDomination: boolean;
}

/**
 * Détections spéciales basées sur les probabilités
 */
function detectSpecialSituations(
  pH: number,
  pD: number,
  pA: number,
  favorite: '1' | 'X' | '2',
  scoreOutcome: '1' | 'X' | '2',
  isTrueTrap: boolean
): SpecialDetections {
  const probs = [
    { outcome: '1' as const, prob: pH },
    { outcome: 'X' as const, prob: pD },
    { outcome: '2' as const, prob: pA }
  ].sort((a, b) => b.prob - a.prob);
  
  const firstProb = probs[0].prob;
  const secondProb = probs[1].prob;
  const delta = firstProb - secondProb;
  
  // Vrai Piège: déjà détecté
  // Faux Piège: P_favori > 55% ET surprise > 35% MAIS pas de vrai piège
  const isFalseTrap = !isTrueTrap && firstProb > 0.55 && secondProb > 0.35;
  
  // Vrai Nul: Favori = Nul ET score = nul ≤ 2-2
  const isTrueDraw = favorite === 'X' && scoreOutcome === 'X';
  
  // Faux Nul: Favori = Nul MAIS score ≠ nul
  const isFalseDraw = favorite === 'X' && scoreOutcome !== 'X';
  
  // Domination: Delta (P_favori - P_2ème) > 0.40
  const isDomination = delta > 0.40;
  
  return {
    isTrueTrap,
    isFalseTrap,
    isTrueDraw,
    isFalseDraw,
    isDomination
  };
}

// ============================================
// ÉTAPE 7 — SCORE MI-TEMPS
// ============================================

/**
 * Calcule le score de mi-temps
 * λ_HT = λ_FT × 0.46 (46% des buts en 1ère MT)
 */
function calculateHalfTimeScore(lambdaH: number, lambdaA: number): string {
  const lambdaHT_H = lambdaH * 0.46;
  const lambdaHT_A = lambdaA * 0.46;
  
  // Trouver le score MT le plus probable
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
// ÉTAPE 8 — MARCHÉS ADDITIONNELS
// ============================================

/**
 * Calcule les marchés additionnels
 */
function calculateAdditionalMarkets(scoreMatrix: ScoreMatrix[], mainScore: ScoreMatrix): {
  ggResult: string;
  probGG: number;
  overUnder25: string;
  probOver25: number;
  parity: string;
} {
  // GG/NG: P(h≥1, a≥1)
  const probGG = scoreMatrix
    .filter(s => s.h >= 1 && s.a >= 1)
    .reduce((sum, s) => sum + s.prob, 0);
  
  const ggResult = probGG > 0.5 ? "Oui (GG)" : "Non (NG)";
  
  // Over/Under 2.5: Total de buts
  const probOver25 = scoreMatrix
    .filter(s => s.h + s.a >= 3)
    .reduce((sum, s) => sum + s.prob, 0);
  
  const overUnder25 = probOver25 > 0.5 ? "Over 2.5" : "Under 2.5";
  
  // Pair/Impair
  const totalGoals = mainScore.h + mainScore.a;
  const parity = totalGoals % 2 === 0 ? "Pair" : "Impair";
  
  return {
    ggResult,
    probGG,
    overUnder25,
    probOver25,
    parity
  };
}

// ============================================
// ANALYSE PRINCIPALE
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
  // ÉTAPE 2: Grid Search pour les lambdas
  // ==========================================
  let { lambdaH, lambdaA } = gridSearchLambdas(pH, pD, pA);
  
  // Mode Nouvelle Saison: boost +0.22 pour le favori
  if (newSeasonMode) {
    if (favorite === '1') {
      lambdaH = Math.min(3.0, lambdaH + 0.22);
    } else if (favorite === '2') {
      lambdaA = Math.min(3.0, lambdaA + 0.22);
    }
  }
  
  // ==========================================
  // ÉTAPE 4: Matrice des scores 7×7
  // ==========================================
  const scoreMatrix = generateScoreMatrix(lambdaH, lambdaA);
  
  // ==========================================
  // ÉTAPE 5: Score principal & détection piège
  // ==========================================
  const { mainScore, alternativeScore, isTrueTrap, isAntiTrap } = determineMainScore(
    scoreMatrix,
    favorite,
    favoriteProb
  );
  
  // ==========================================
  // ÉTAPE 6: Détections spéciales
  // ==========================================
  const detections = detectSpecialSituations(
    pH, pD, pA,
    favorite,
    mainScore.outcome,
    isTrueTrap
  );
  
  // ==========================================
  // ÉTAPE 7: Score mi-temps
  // ==========================================
  const firstHalfScore = calculateHalfTimeScore(lambdaH, lambdaA);
  
  // ==========================================
  // ÉTAPE 8: Marchés additionnels
  // ==========================================
  const markets = calculateAdditionalMarkets(scoreMatrix, mainScore);
  
  // ==========================================
  // Génération du résultat
  // ==========================================
  const totalGoals = mainScore.h + mainScore.a;
  const winner1X2 = mainScore.outcome === '1' 
    ? `1 — ${home}` 
    : mainScore.outcome === '2' 
      ? `2 — ${away}` 
      : "X (Nul)";
  
  // Déterminer la situation
  let situation = "";
  if (detections.isDomination) {
    situation = "Domination";
  } else if (detections.isTrueTrap) {
    situation = "Vrai Piège ⚠️";
  } else if (detections.isFalseTrap) {
    situation = "Faux Piège";
  } else if (detections.isTrueDraw) {
    situation = "Vrai Nul";
  } else if (detections.isFalseDraw) {
    situation = "Faux Nul";
  } else {
    situation = "Standard";
  }
  
  // Raisonnement
  let aiReasoning = `Favori: ${favorite} (${(favoriteProb * 100).toFixed(1)}%) | λ: ${lambdaH}/${lambdaA}`;
  if (detections.isTrueTrap) {
    aiReasoning += " | PIÈGE DÉTECTÉ - Score forcé";
  }
  if (alternativeScore) {
    aiReasoning += ` | Alternative: ${alternativeScore.score}`;
  }
  
  // Danger level
  let dangerLevel: "safe" | "moderate" | "trap" = "safe";
  if (detections.isTrueTrap || detections.isFalseTrap) {
    dangerLevel = "trap";
  } else if (Math.abs(pH - pA) < 0.15 || pD > 0.3) {
    dangerLevel = "moderate";
  }
  
  // Confidence = probabilité du favori
  const confidence = Math.round(favoriteProb * 100);
  
  // Top 5 scores
  const topScores = scoreMatrix.slice(0, 5).map(s => ({
    score: s.score,
    probability: Math.round(s.prob * 1000) / 1000
  }));
  
  // First half goal prediction
  const firstHalfGoal = firstHalfScore !== "0-0";
  
  // Expected goals
  const expectedGoals = lambdaH + lambdaA;
  
  return {
    id: input.id || `match-${Date.now()}-${idCounter++}`,
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
    tendency: detections.isDomination ? "Domination nette" : isTrueTrap ? "Piège détecté" : "Match standard",
    dangerLevel,
    topScores,
    bttsProb: Math.round(markets.probGG * 1000) / 1000,
    over25Prob: Math.round(markets.probOver25 * 1000) / 1000,
    firstHalfScore,
    systemHome: pH > 0.5 ? "offensif" : pH < 0.3 ? "défensif" : "équilibré",
    systemAway: pA > 0.5 ? "offensif" : pA < 0.3 ? "défensif" : "équilibré",
    possessionHome: Math.round(40 + pH * 25),
    possessionAway: Math.round(60 - pH * 25),
    homeForm: "N/A",
    awayForm: "N/A",
    homeAdvantage: Math.round((pH - pA) * 100),
    rankingDiff: 0,
    predictedOutcome: isAntiTrap ? `Contre-pied: ${winner1X2}` : winner1X2,
    // Nouveaux champs
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
// HELPERS
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
  
  // Ajustement basé sur le type
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
