export interface MatchInput {
  id?: string;
  home: string;
  away: string;
  league: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
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
}

let idCounter = 0;

// Generate all common virtual football scores with estimated probabilities
function generateScoreDistribution(probHome: number, probDraw: number, probAway: number) {
  const scores: { score: string; h: number; a: number; prob: number }[] = [];
  const lambda_h = 1.2 + probHome * 1.5; // expected home goals
  const lambda_a = 0.8 + probAway * 1.5; // expected away goals

  // Poisson-like distribution for scores 0-0 to 4-4
  for (let h = 0; h <= 4; h++) {
    for (let a = 0; a <= 4; a++) {
      const prob_h = (Math.pow(lambda_h, h) * Math.exp(-lambda_h)) / factorial(h);
      const prob_a = (Math.pow(lambda_a, a) * Math.exp(-lambda_a)) / factorial(a);
      const prob = prob_h * prob_a;
      scores.push({ score: `${h}-${a}`, h, a, prob });
    }
  }

  // Normalize
  const totalProb = scores.reduce((s, x) => s + x.prob, 0);
  scores.forEach(s => s.prob = s.prob / totalProb);

  return scores.sort((a, b) => b.prob - a.prob);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function analyzeMatch(input: MatchInput, aiPrediction?: AIPrediction): MatchResult {
  const { home, away, league, oddHome, oddDraw, oddAway } = input;

  // Step 1: Normalized implied probabilities (remove bookmaker margin)
  const invHome = 1 / oddHome;
  const invDraw = 1 / oddDraw;
  const invAway = 1 / oddAway;
  const total = invHome + invDraw + invAway;

  const probHome = invHome / total;
  const probDraw = invDraw / total;
  const probAway = invAway / total;

  let scoreHome: number;
  let scoreAway: number;
  let aiConfidence = 0;
  let aiReasoning = "";
  let isAntiTrap = false;
  let firstHalfGoal = false;
  let tendency = "";
  let dangerLevel: "safe" | "moderate" | "trap" = "safe";
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
    // Fallback: Poisson-based score distribution with anti-trap logic
    const scoresDist = generateScoreDistribution(probHome, probDraw, probAway);

    // Best score (highest probability)
    let bestScore = scoresDist[0];
    const bestProb = bestScore.prob;

    // Identify outsider: team with higher odds
    const isHomeUnderdog = oddHome > oddAway;

    // Calculate outsider and draw cumulative probabilities
    let probOutsider = 0;
    let probNul = 0;
    const outsiderScores: typeof scoresDist = [];
    const nulScores: typeof scoresDist = [];

    for (const s of scoresDist) {
      if (s.h === s.a) {
        probNul += s.prob;
        nulScores.push(s);
      } else if ((isHomeUnderdog && s.h > s.a) || (!isHomeUnderdog && s.a > s.h)) {
        probOutsider += s.prob;
        outsiderScores.push(s);
      }
    }

    // Anti-trap: if best score prob > 15% AND outsider+nul > 35%, switch to best alternative
    if (bestProb > 0.15 && (probOutsider + probNul) > 0.35) {
      const alternatives = [...outsiderScores, ...nulScores].sort((a, b) => b.prob - a.prob);
      if (alternatives.length > 0) {
        bestScore = alternatives[0];
        isAntiTrap = true;
        dangerLevel = "trap";
        tendency = "Piège détecté — bascule sur alternative";
      }
    } else if (Math.abs(oddHome - oddAway) < 0.8 && probDraw > 0.28) {
      // Tight match → moderate risk
      dangerLevel = "moderate";
      tendency = "Match serré — nul probable";
      // Check if a draw score is close to best
      if (nulScores.length > 0 && nulScores[0].prob > bestProb * 0.7) {
        bestScore = nulScores[0];
      }
    } else {
      dangerLevel = "safe";
      tendency = probHome > probAway ? "Domination domicile" : "Domination extérieur";
    }

    // Estimate tactical systems from odds
    systemHome = probHome > 0.45 ? "offensif" : probHome < 0.30 ? "défensif" : "équilibré";
    systemAway = probAway > 0.45 ? "offensif" : probAway < 0.30 ? "défensif" : "équilibré";
    possessionHome = Math.round(40 + probHome * 30);
    possessionAway = Math.round(40 + probAway * 30);

    scoreHome = bestScore.h;
    scoreAway = bestScore.a;
    aiConfidence = bestScore.prob;

    // Top 3 scores
    topScores = scoresDist.slice(0, 3).map(s => ({ score: s.score, probability: Math.round(s.prob * 1000) / 1000 }));

    // BTTS probability
    bttsProb = scoresDist.filter(s => s.h > 0 && s.a > 0).reduce((sum, s) => sum + s.prob, 0);

    // Over 2.5 probability
    over25Prob = scoresDist.filter(s => s.h + s.a > 2).reduce((sum, s) => sum + s.prob, 0);

    // First half estimation
    const totalGoalsEst = scoreHome + scoreAway;
    firstHalfGoal = totalGoalsEst >= 2 || (probHome + probAway) / 2 > 0.45;
    firstHalfScore = firstHalfGoal
      ? (scoreHome > scoreAway ? "1-0" : scoreAway > scoreHome ? "0-1" : "0-0")
      : "0-0";
  }

  // Derived results from chosen score
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
  const probGG = probHome * probAway;
  const probGN = 1 - probGG;

  const parity = totalGoals % 2 === 0 ? "Pair" : "Impair";
  const overUnder15 = totalGoals > 1.5 ? "Over 1.5" : "Under 1.5";
  const overUnder25 = totalGoals > 2.5 ? "Over 2.5" : "Under 2.5";
  const overUnder35 = totalGoals > 3.5 ? "Over 3.5" : "Under 3.5";

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
    aiConfidence, aiReasoning, isAntiTrap, firstHalfGoal,
    tendency, dangerLevel, topScores, bttsProb: Math.round(bttsProb * 1000) / 1000,
    over25Prob: Math.round(over25Prob * 1000) / 1000, firstHalfScore,
    systemHome, systemAway, possessionHome, possessionAway,
  };
}
