import { supabase } from "@/integrations/supabase/client";
import type { MatchResult } from "./prediction-engine";

const ACCESS_KEY = "virtuxxs_access";
const ADMIN_KEY = "virtuxxs_admin";
const SETTINGS_KEY = "virtuxxs_settings";

// Device ID for tracking predictions per device
function getDeviceId(): string {
  let id = localStorage.getItem("virtuxxs_device_id");
  if (!id) {
    id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("virtuxxs_device_id", id);
  }
  return id;
}

// --- History (Cloud DB) ---
export async function getHistory(): Promise<MatchResult[]> {
  const deviceId = getDeviceId();
  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) return [];

  // Filtrer par device_id si disponible, sinon retourner toutes les prédictions
  const filteredData = deviceId
    ? data.filter(row => row.device_id === deviceId || !row.device_id)
    : data;

  return filteredData.map(row => ({
    id: row.id,
    home: row.home || row.home_team,
    away: row.away || row.away_team,
    league: row.league || "Instant League",
    oddHome: Number(row.odd_home),
    oddDraw: Number(row.odd_draw),
    oddAway: Number(row.odd_away),
    probHome: Number(row.prob_home),
    probDraw: Number(row.prob_draw),
    probAway: Number(row.prob_away),
    winner1X2: row.winner_1x2 || (row.prediction === '1' ? `1 — ${row.home || row.home_team}` : row.prediction === '2' ? `2 — ${row.away || row.away_team}` : 'X (Nul)'),
    firstHalfGoalProb: Number(row.first_half_goal_prob) || 0.5,
    expectedGoals: Number(row.expected_goals) || 2.5,
    goalsHome: Number(row.goals_home) || 1.5,
    goalsAway: Number(row.goals_away) || 1,
    scoreHome: row.score_home ?? row.predicted_home_score ?? 0,
    scoreAway: row.score_away ?? row.predicted_away_score ?? 0,
    exactScore: row.exact_score || row.predicted_score || "0-0",
    probGG: Number(row.prob_gg) || 0.5,
    probGN: Number(row.prob_gn) || 0.5,
    ggResult: row.gg_result || (row.total_goals && row.total_goals > 0 ? "Oui (GG)" : "Non (NG)"),
    totalGoals: row.total_goals || (row.score_home || 0) + (row.score_away || 0),
    parity: row.parity || ((row.total_goals || 0) % 2 === 0 ? "Pair" : "Impair"),
    overUnder15: row.over_under_15 || ((row.total_goals || 0) > 1.5 ? "Over 1.5" : "Under 1.5"),
    overUnder25: row.over_under_25 || ((row.total_goals || 0) > 2.5 ? "Over 2.5" : "Under 2.5"),
    overUnder35: row.over_under_35 || ((row.total_goals || 0) > 3.5 ? "Over 3.5" : "Under 3.5"),
    timestamp: new Date(row.created_at).getTime(),
    aiConfidence: Number(row.confidence) / 100 || 0,
    aiReasoning: "",
    isAntiTrap: false,
    firstHalfGoal: false,
    tendency: "",
    dangerLevel: "safe" as const,
    topScores: [],
    bttsProb: Number(row.btts_prob || row.prob_gg) || 0.5,
    over25Prob: Number(row.over25_prob) || 0.5,
    firstHalfScore: "0-0",
    systemHome: "équilibré",
    systemAway: "équilibré",
    possessionHome: 50,
    possessionAway: 50,
    // Statut de vérification
    status: row.status,
    actualOutcome: row.actual_outcome,
    actualScore: row.actual_score,
  }));
}

export async function saveToHistory(result: MatchResult) {
  const deviceId = getDeviceId();

  // Déterminer la prédiction (1, X, ou 2)
  const prediction = result.winner1X2.startsWith('1') ? '1' : result.winner1X2.startsWith('2') ? '2' : 'X';
  const confidence = Math.round(result.aiConfidence * 100);

  await supabase.from("predictions").insert({
    // Colonnes principales
    home_team: result.home,
    away_team: result.away,
    home: result.home,
    away: result.away,
    league: result.league || "Instant League",
    // Cotes
    odd_home: result.oddHome,
    odd_draw: result.oddDraw,
    odd_away: result.oddAway,
    // Probabilités
    prob_home: result.probHome,
    prob_draw: result.probDraw,
    prob_away: result.probAway,
    // Prédiction
    prediction: prediction,
    confidence: confidence,
    winner_1x2: result.winner1X2,
    // Scores
    predicted_home_score: result.scoreHome,
    predicted_away_score: result.scoreAway,
    predicted_score: result.exactScore,
    score_home: result.scoreHome,
    score_away: result.scoreAway,
    exact_score: result.exactScore,
    // Autres données
    first_half_goal_prob: result.firstHalfGoalProb,
    expected_goals: result.expectedGoals,
    goals_home: result.goalsHome,
    goals_away: result.goalsAway,
    prob_gg: result.probGG,
    prob_gn: result.probGN,
    gg_result: result.ggResult,
    total_goals: result.totalGoals,
    parity: result.parity,
    over_under_15: result.overUnder15,
    over_under_25: result.overUnder25,
    over_under_35: result.overUnder35,
    // Métadonnées
    device_id: deviceId,
    status: 'pending',
  });
}

export async function clearHistory() {
  const deviceId = getDeviceId();
  await supabase.from("predictions").delete().eq("device_id", deviceId);
}

// --- Premium Access (localStorage for device-level, codes in Cloud) ---
export interface AccessData {
  code: string;
  activatedAt: number;
  expiresAt: number;
}

export function getAccess(): AccessData | null {
  try {
    const data = localStorage.getItem(ACCESS_KEY);
    if (!data) return null;
    const access: AccessData = JSON.parse(data);
    if (Date.now() > access.expiresAt) {
      localStorage.removeItem(ACCESS_KEY);
      return null;
    }
    return access;
  } catch { return null; }
}

export function setAccess(code: string, daysValid: number) {
  const now = Date.now();
  const access: AccessData = {
    code,
    activatedAt: now,
    expiresAt: now + daysValid * 24 * 60 * 60 * 1000,
  };
  localStorage.setItem(ACCESS_KEY, JSON.stringify(access));
}

export function isPremium(): boolean {
  return getAccess() !== null;
}

export function clearAccess() {
  localStorage.removeItem(ACCESS_KEY);
}

// --- Admin ---

export function isAdmin(): boolean {
  return localStorage.getItem(ADMIN_KEY) === "true";
}

export async function loginAdminSupabase(password: string): Promise<boolean> {
  // Check admin code from Supabase
  const { data, error } = await supabase
    .from("admin_settings")
    .select("setting_value")
    .eq("setting_key", "admin_code")
    .maybeSingle();

  if (error || !data) return false;

  if (password === data.setting_value) {
    localStorage.setItem(ADMIN_KEY, "true");
    return true;
  }
  return false;
}

// Legacy function for backwards compatibility (now uses Supabase)
export async function loginAdmin(password: string): Promise<boolean> {
  return loginAdminSupabase(password);
}

export function logoutAdmin() {
  localStorage.removeItem(ADMIN_KEY);
}

// --- Generated Codes (Cloud DB) ---
export interface GeneratedCode {
  id?: string;
  code: string;
  createdAt: number;
  durationDays: number;
  used: boolean;
  usedAt?: number;
}

export async function getGeneratedCodes(): Promise<GeneratedCode[]> {
  const { data, error } = await supabase
    .from("access_codes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map(row => ({
    id: row.id,
    code: row.code,
    createdAt: new Date(row.created_at).getTime(),
    durationDays: row.duration_days,
    used: row.used,
    usedAt: row.used_at ? new Date(row.used_at).getTime() : undefined,
  }));
}

export async function saveGeneratedCode(gc: GeneratedCode) {
  await supabase.from("access_codes").insert({
    code: gc.code,
    duration_days: gc.durationDays,
    used: false,
  });
}

export function generateRandomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "VRL-";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3) code += "-";
  }
  return code;
}

export async function validateCode(inputCode: string): Promise<{ valid: boolean; days: number }> {
  // Check generated codes in DB
  const { data, error } = await supabase
    .from("access_codes")
    .select("*")
    .eq("code", inputCode)
    .eq("used", false)
    .maybeSingle();

  if (error || !data) return { valid: false, days: 0 };

  const deviceId = getDeviceId();
  await supabase
    .from("access_codes")
    .update({ used: true, used_at: new Date().toISOString(), used_by_device: deviceId })
    .eq("id", data.id);

  return { valid: true, days: data.duration_days };
}

export async function deleteGeneratedCode(codeId: string): Promise<boolean> {
  const { error, count } = await supabase
    .from("access_codes")
    .delete()
    .eq("id", codeId);

  if (error) {
    console.error("Erreur suppression code:", error);
    return false;
  }
  
  return true;
}

// --- Settings (localStorage) ---
export interface AppSettings {
  accentColor: "fire" | "ice" | "gold" | "custom";
  customColor?: string;
}

export function getSettings(): AppSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    return data ? JSON.parse(data) : { accentColor: "fire" };
  } catch { return { accentColor: "fire" }; }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
