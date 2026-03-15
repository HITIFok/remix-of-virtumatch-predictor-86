// Advanced ML-inspired Prediction Engine for Virtual Football
// Uses: historical results, rankings, odds analysis
// Calibrated with real Instant League data: 140 matches analyzed
// Historical: 45.7% home wins, 24.3% draws, 30.0% away wins
// Goals: avg 2.93/match, home 1.66, away 1.27

export interface MatchInput {
  id?: string;
  home: string;
  away: string;
  league: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
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
  form: string[]; // Last 5 results: "W", "D", "L"
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
  // Enhanced stats
  homeForm: string;
  awayForm: string;
  homeAdvantage: number;
  rankingDiff: number;
  predictedOutcome: string;
}

let idCounter = 0;

// ============================================
// HISTORICAL STATISTICS FROM INSTANT LEAGUE
// Based on 140 matches analyzed
// ============================================
const HISTORICAL_STATS = {
  totalMatches: 140,
  outcomes: {
    homeWin: 0.457,  // 45.7%
    draw: 0.243,     // 24.3%
    awayWin: 0.300,  // 30.0%
  },
  goals: {
    avgPerMatch: 2.93,
    avgHome: 1.66,
    avgAway: 1.27,
    homeAdvantage: 0.39, // avg home - avg away
  },
  // Score distribution from real data
  commonScores: [
    { score: '1-1', prob: 0.12 },
    { score: '2-1', prob: 0.10 },
    { score: '1-0', prob: 0.09 },
    { score: '2-0', prob: 0.08 },
    { score: '0-1', prob: 0.07 },
    { score: '1-2', prob: 0.07 },
    { score: '0-0', prob: 0.06 },
    { score: '2-2', prob: 0.05 },
    { score: '3-1', prob: 0.04 },
    { score: '3-0', prob: 0.04 },
  ]
};

// Calculate factorial for Poisson distribution
function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Poisson probability
function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// Calculate team form from recent results
function calculateTeamForm(teamName: string, results: HistoricalResult[]): string[] {
  const form: string[] = [];
  
  for (const result of results) {
    if (result.home === teamName) {
      if (result.scoreHome > result.scoreAway) form.push("W");
      else if (result.scoreHome < result.scoreAway) form.push("L");
      else form.push("D");
    } else if (result.away === teamName) {
      if (result.scoreAway > result.scoreHome) form.push("W");
      else if (result.scoreAway < result.scoreHome) form.push("L");
      else form.push("D");
    }
    if (form.length >= 5) break;
  }
  
  return form;
}

// Calculate average goals scored/conceded
function calculateGoalStats(teamName: string, results: HistoricalResult[]): { scored: number; conceded: number } {
  let scored = 0;
  let conceded = 0;
  let games = 0;
  
  for (const result of results) {
    if (result.home === teamName) {
      scored += result.scoreHome;
      conceded += result.scoreAway;
      games++;
    } else if (result.away === teamName) {
      scored += result.scoreAway;
      conceded += result.scoreHome;
      games++;
    }
    if (games >= 10) break;
  }
  
  return {
    scored: games > 0 ? scored / games : 1.3,
    conceded: games > 0 ? conceded / games : 1.1
  };
}

// Form strength calculation (0-1 scale)
function calculateFormStrength(form: string[]): number {
  if (form.length === 0) return 0.5;
  
  const weights = [0.3, 0.25, 0.2, 0.15, 0.1]; // Recent games weighted more
  let strength = 0;
  
  for (let i = 0; i < Math.min(form.length, 5); i++) {
    const result = form[i];
    const weight = weights[i] || 0.1;
    
    if (result === "W") strength += weight;
    else if (result === "D") strength += weight * 0.4;
    // L contributes 0
  }
  
  return Math.min(1, strength);
}

// Ranking-based adjustment
function calculateRankingAdjustment(homeRank: number, awayRank: number): number {
  const diff = awayRank - homeRank; // Positive = home team ranked higher
  // Normalize to -0.3 to +0.3 adjustment
  return Math.max(-0.3, Math.min(0.3, diff * 0.015));
}

// Detect potential trap matches based on odds patterns
function detectTrapPattern(oddHome: number, oddDraw: number, oddAway: number): {
  isTrap: boolean;
  dangerLevel: "safe" | "moderate" | "trap";
  reasoning: string;
} {
  const favorite = Math.min(oddHome, oddAway);
  const outsider = Math.max(oddHome, oddAway);
  const ratio = outsider / favorite;
  
  // Very high ratio with low draw odds = potential trap
  if (ratio > 8 && oddDraw < 5) {
    return {
      isTrap: true,
      dangerLevel: "trap",
      reasoning: `Cotes suspectes: ratio ${ratio.toFixed(1)}x avec nul à ${oddDraw}`
    };
  }
  
  // Balanced match with very low favorite odds
  if (favorite < 1.3 && Math.abs(oddHome - oddAway) < 0.5) {
    return {
      isTrap: true,
      dangerLevel: "trap",
      reasoning: "Favori trop sûr de lui — piège potentiel"
    };
  }
  
  // Moderate risk
  if (oddDraw < 3.5 && Math.abs(oddHome - oddAway) < 1) {
    return {
      isTrap: false,
      dangerLevel: "moderate",
      reasoning: "Match serré — nul probable"
    };
  }
  
  return {
    isTrap: false,
    dangerLevel: "safe",
    reasoning: "Configuration standard"
  };
}

// Generate score distribution with ML adjustments and historical calibration
function generateEnhancedScoreDistribution(
  probHome: number,
  probDraw: number,
  probAway: number,
  homeFormStrength: number,
  awayFormStrength: number,
  rankingAdjustment: number,
  homeGoalAvg: number,
  awayGoalAvg: number,
  homeConcededAvg: number,
  awayConcededAvg: number
) {
  const scores: { score: string; h: number; a: number; prob: number }[] = [];
  
  // Expected goals calculation with historical baseline
  // Use historical averages as fallback
  const baseHomeGoals = HISTORICAL_STATS.goals.avgHome; // 1.66
  const baseAwayGoals = HISTORICAL_STATS.goals.avgAway; // 1.27
  
  // Blend with provided stats (70% historical, 30% team-specific if available)
  let lambda_h = homeGoalAvg > 0 
    ? baseHomeGoals * 0.7 + ((homeGoalAvg + awayConcededAvg) / 2) * 0.3
    : baseHomeGoals;
  let lambda_a = awayGoalAvg > 0 
    ? baseAwayGoals * 0.7 + ((awayGoalAvg + homeConcededAvg) / 2) * 0.3
    : baseAwayGoals;
  
  // Adjust for probability and form
  const formDiff = homeFormStrength - awayFormStrength;
  lambda_h *= (1 + rankingAdjustment * 0.5 + formDiff * 0.2);
  lambda_a *= (1 - rankingAdjustment * 0.5 - formDiff * 0.2);
  
  // Adjust based on outcome probability
  if (probHome > 0.5) {
    lambda_h *= 1.15;
    lambda_a *= 0.9;
  } else if (probAway > 0.5) {
    lambda_h *= 0.9;
    lambda_a *= 1.15;
  }
  
  // Clamp to reasonable virtual football range
  lambda_h = Math.max(0.5, Math.min(3.5, lambda_h));
  lambda_a = Math.max(0.3, Math.min(3.0, lambda_a));
  
  // Generate all common scores
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const prob_h = poisson(lambda_h, h);
      const prob_a = poisson(lambda_a, a);
      
      let prob = prob_h * prob_a;
      
      // Boost common historical scores
      const scoreStr = `${h}-${a}`;
      const historicalScore = HISTORICAL_STATS.commonScores.find(s => s.score === scoreStr);
      if (historicalScore) {
        prob = prob * 0.7 + historicalScore.prob * 0.3;
      }
      
      // Boost draws for virtual football (24.3% historical)
      if (h === a) {
        prob *= (1 + probDraw * 0.5);
      }
      
      // Boost score based on 1X2 probability
      if (h > a) prob *= (1 + probHome * 0.3);
      else if (h < a) prob *= (1 + probAway * 0.3);
      
      scores.push({ score: scoreStr, h, a, prob });
    }
  }
  
  // Normalize
  const totalProb = scores.reduce((s, x) => s + x.prob, 0);
  scores.forEach(s => s.prob = s.prob / totalProb);
  
  return scores.sort((a, b) => b.prob - a.prob);
}

export function analyzeMatch(
  input: MatchInput,
  aiPrediction?: AIPrediction,
  teamStats?: Map<string, TeamStats>,
  historicalResults?: HistoricalResult[]
): MatchResult {
  const { home, away, league, oddHome, oddDraw, oddAway } = input;
  
  // Step 1: Normalized implied probabilities (remove bookmaker margin)
  const invHome = 1 / oddHome;
  const invDraw = 1 / oddDraw;
  const invAway = 1 / oddAway;
  const total = invHome + invDraw + invAway;
  
  let probHome = invHome / total;
  let probDraw = invDraw / total;
  let probAway = invAway / total;
  
  // Apply historical calibration (bookmaker odds + historical bias correction)
  // If odds suggest home win but historical shows home wins 45.7%, adjust slightly
  const historicalWeight = 0.15; // 15% weight to historical stats
  probHome = probHome * (1 - historicalWeight) + HISTORICAL_STATS.outcomes.homeWin * historicalWeight;
  probDraw = probDraw * (1 - historicalWeight) + HISTORICAL_STATS.outcomes.draw * historicalWeight;
  probAway = probAway * (1 - historicalWeight) + HISTORICAL_STATS.outcomes.awayWin * historicalWeight;
  
  // Re-normalize
  const calibratedTotal = probHome + probDraw + probAway;
  probHome /= calibratedTotal;
  probDraw /= calibratedTotal;
  probAway /= calibratedTotal;
  
  // Step 2: Get team statistics
  const homeStats = teamStats?.get(home);
  const awayStats = teamStats?.get(away);
  
  // Calculate form and goal stats
  const homeForm = historicalResults ? calculateTeamForm(home, historicalResults) : [];
  const awayForm = historicalResults ? calculateTeamForm(away, historicalResults) : [];
  
  const homeFormStrength = calculateFormStrength(homeForm);
  const awayFormStrength = calculateFormStrength(awayForm);
  
  const homeGoalStats = historicalResults ? calculateGoalStats(home, historicalResults) : { scored: 1.3, conceded: 1.1 };
  const awayGoalStats = historicalResults ? calculateGoalStats(away, historicalResults) : { scored: 1.2, conceded: 1.2 };
  
  // Step 3: Ranking adjustment
  let rankingAdjustment = 0;
  let rankingDiff = 0;
  if (homeStats && awayStats) {
    rankingDiff = awayStats.position - homeStats.position;
    rankingAdjustment = calculateRankingAdjustment(homeStats.position, awayStats.position);
    
    // Adjust probabilities based on ranking
    probHome = Math.max(0.1, Math.min(0.9, probHome + rankingAdjustment));
    probAway = Math.max(0.1, Math.min(0.9, probAway - rankingAdjustment));
    
    // Re-normalize
    const newTotal = probHome + probDraw + probAway;
    probHome /= newTotal;
    probDraw /= newTotal;
    probAway /= newTotal;
  }
  
  // Step 4: Adjust for form
  const formDiff = homeFormStrength - awayFormStrength;
  if (Math.abs(formDiff) > 0.2) {
    const formAdjust = formDiff * 0.1;
    probHome = Math.max(0.1, Math.min(0.9, probHome + formAdjust));
    probAway = Math.max(0.1, Math.min(0.9, probAway - formAdjust));
    
    const newTotal = probHome + probDraw + probAway;
    probHome /= newTotal;
    probDraw /= newTotal;
    probAway /= newTotal;
  }
  
  // Step 5: Detect trap patterns
  const trapAnalysis = detectTrapPattern(oddHome, oddDraw, oddAway);
  
  // Step 5.5: Calculate odds-based confidence
  // Higher confidence when odds strongly favor one outcome
  const maxProb = Math.max(probHome, probDraw, probAway);
  const minProb = Math.min(probHome, probDraw, probAway);
  const oddsConfidence = maxProb > 0.6 ? 'high' : maxProb > 0.4 ? 'medium' : 'low';
  
  let scoreHome: number;
  let scoreAway: number;
  let aiConfidence = 0;
  let aiReasoning = "";
  let isAntiTrap = false;
  let firstHalfGoal = false;
  let tendency = "";
  let dangerLevel: "safe" | "moderate" | "trap" = trapAnalysis.dangerLevel;
  let topScores: { score: string; probability: number }[] = [];
  let bttsProb = 0;
  let over25Prob = 0;
  let firstHalfScore = "0-0";
  let systemHome = "équilibré";
  let systemAway = "équilibré";
  let possessionHome = 50;
  let possessionAway = 50;
  
  if (aiPrediction) {
    scoreHome = aiPrediction.scoreHome;
    scoreAway = aiPrediction.scoreAway;
    aiConfidence = aiPrediction.confidence;
    aiReasoning = aiPrediction.reasoning;
    isAntiTrap = aiPrediction.isAntiTrap;
    firstHalfGoal = aiPrediction.firstHalfGoal;
    tendency = aiPrediction.tendency || "";
    dangerLevel = aiPrediction.dangerLevel || "safe";
    topScores = aiPrediction.topScores || [];
    bttsProb = aiPrediction.bttsProb || 0;
    over25Prob = aiPrediction.over25Prob || 0;
    firstHalfScore = aiPrediction.firstHalfScore || "0-0";
    systemHome = aiPrediction.systemHome || "équilibré";
    systemAway = aiPrediction.systemAway || "équilibré";
    possessionHome = aiPrediction.possessionHome || 50;
    possessionAway = aiPrediction.possessionAway || 50;
  } else {
    // Enhanced score distribution with ML adjustments
    const scoresDist = generateEnhancedScoreDistribution(
      probHome, probDraw, probAway,
      homeFormStrength, awayFormStrength,
      rankingAdjustment,
      homeGoalStats.scored, awayGoalStats.scored,
      homeGoalStats.conceded, awayGoalStats.conceded
    );
    
    // Best score
    let bestScore = scoresDist[0];
    
    // Anti-trap logic
    if (trapAnalysis.isTrap) {
      const outsiderScores = scoresDist.filter(s => 
        (oddHome > oddAway && s.h > s.a) || (oddAway > oddHome && s.a > s.h)
      );
      const drawScores = scoresDist.filter(s => s.h === s.a);
      
      const alternatives = [...outsiderScores, ...drawScores].sort((a, b) => b.prob - a.prob);
      if (alternatives.length > 0 && alternatives[0].prob > 0.08) {
        bestScore = alternatives[0];
        isAntiTrap = true;
        tendency = "Piège détecté — prédiction inversée";
      }
    } else if (dangerLevel === "moderate") {
      tendency = "Match équilibré — résultat incertain";
    } else {
      tendency = probHome > probAway 
        ? `Avantage ${home} (forme: ${homeFormStrength.toFixed(2)})`
        : probAway > probHome 
          ? `Avantage ${away} (forme: ${awayFormStrength.toFixed(2)})`
          : "Match équilibré";
    }
    
    aiReasoning = trapAnalysis.reasoning;
    if (homeStats && awayStats) {
      aiReasoning += ` | Rang: ${homeStats.position}e vs ${awayStats.position}e`;
    }
    aiReasoning += ` | Forme: ${homeForm.slice(0,3).join("") || "?"} vs ${awayForm.slice(0,3).join("") || "?"}`;
    
    scoreHome = bestScore.h;
    scoreAway = bestScore.a;
    aiConfidence = bestScore.prob;
    
    topScores = scoresDist.slice(0, 5).map(s => ({ 
      score: s.score, 
      probability: Math.round(s.prob * 1000) / 1000 
    }));
    
    bttsProb = scoresDist.filter(s => s.h > 0 && s.a > 0).reduce((sum, s) => sum + s.prob, 0);
    over25Prob = scoresDist.filter(s => s.h + s.a > 2).reduce((sum, s) => sum + s.prob, 0);
    
    // First half prediction
    firstHalfGoal = (scoreHome + scoreAway) >= 2 || (homeFormStrength + awayFormStrength) > 1.2;
    firstHalfScore = firstHalfGoal
      ? (scoreHome > scoreAway ? "1-0" : scoreAway > scoreHome ? "0-1" : "1-1")
      : "0-0";
    
    // Tactical systems
    systemHome = probHome > 0.5 ? "offensif" : probHome < 0.3 ? "défensif" : "équilibré";
    systemAway = probAway > 0.5 ? "offensif" : probAway < 0.3 ? "défensif" : "équilibré";
    
    possessionHome = Math.round(40 + probHome * 25 + homeFormStrength * 10);
    possessionAway = 100 - possessionHome;
  }
  
  // Derived results
  let winner1X2: string;
  if (scoreHome > scoreAway) winner1X2 = `1 — ${home}`;
  else if (scoreHome < scoreAway) winner1X2 = `2 — ${away}`;
  else winner1X2 = "X (Nul)";
  
  const totalGoals = scoreHome + scoreAway;
  const expectedGoals = 2 * (probHome + probAway);
  const goalsHome = expectedGoals * (probHome / (probHome + probAway));
  const goalsAway = expectedGoals * (probAway / (probHome + probAway));
  const firstHalfGoalProb = (probHome + probAway) / 2;
  
  const ggResult = scoreHome > 0 && scoreAway > 0 ? "Oui (GG)" : "Non (NG)";
  const probGG = Math.min(0.9, Math.max(0.1, probHome * probAway * 2));
  const probGN = 1 - probGG;
  
  const parity = totalGoals % 2 === 0 ? "Pair" : "Impair";
  const overUnder15 = totalGoals > 1.5 ? "Over 1.5" : "Under 1.5";
  const overUnder25 = totalGoals > 2.5 ? "Over 2.5" : "Under 2.5";
  const overUnder35 = totalGoals > 3.5 ? "Over 3.5" : "Under 3.5";
  
  // Predicted outcome description
  const predictedOutcome = isAntiTrap 
    ? `Contre-pied: ${winner1X2} (anti-piège)`
    : winner1X2;
  
  // Home advantage calculation
  const homeAdvantage = Math.round((probHome - probAway) * 100);
  
  return {
    id: input.id || `match-${Date.now()}-${idCounter++}`,
    home, away, league,
    oddHome, oddDraw, oddAway,
    probHome: Math.round(probHome * 1000) / 1000,
    probDraw: Math.round(probDraw * 1000) / 1000,
    probAway: Math.round(probAway * 1000) / 1000,
    winner1X2,
    firstHalfGoalProb: Math.round(firstHalfGoalProb * 1000) / 1000,
    expectedGoals: Math.round(expectedGoals * 100) / 100,
    goalsHome: Math.round(goalsHome * 100) / 100,
    goalsAway: Math.round(goalsAway * 100) / 100,
    scoreHome, scoreAway,
    exactScore: `${scoreHome} - ${scoreAway}`,
    probGG: Math.round(probGG * 1000) / 1000,
    probGN: Math.round(probGN * 1000) / 1000,
    ggResult, totalGoals, parity,
    overUnder15, overUnder25, overUnder35,
    timestamp: Date.now(),
    aiConfidence: Math.round(aiConfidence * 100) / 100,
    aiReasoning,
    isAntiTrap, firstHalfGoal,
    tendency, dangerLevel, topScores, 
    bttsProb: Math.round(bttsProb * 1000) / 1000,
    over25Prob: Math.round(over25Prob * 1000) / 1000, 
    firstHalfScore,
    systemHome, systemAway, possessionHome, possessionAway,
    homeForm: homeForm.slice(0, 5).join("-") || "N/A",
    awayForm: awayForm.slice(0, 5).join("-") || "N/A",
    homeAdvantage,
    rankingDiff,
    predictedOutcome,
  };
}

// Helper function to convert ranking data to TeamStats map
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

// Helper function to prepare historical results
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
