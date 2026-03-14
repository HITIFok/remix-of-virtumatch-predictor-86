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
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) return [];

  return data.map(row => ({
    id: row.id,
    home: row.home,
    away: row.away,
    league: "",
    oddHome: Number(row.odd_home),
    oddDraw: Number(row.odd_draw),
    oddAway: Number(row.odd_away),
    probHome: Number(row.prob_home),
    probDraw: Number(row.prob_draw),
    probAway: Number(row.prob_away),
    winner1X2: row.winner_1x2,
    firstHalfGoalProb: Number(row.first_half_goal_prob),
    expectedGoals: Number(row.expected_goals),
    goalsHome: Number(row.goals_home),
    goalsAway: Number(row.goals_away),
    scoreHome: row.score_home,
    scoreAway: row.score_away,
    exactScore: row.exact_score,
    probGG: Number(row.prob_gg),
    probGN: Number(row.prob_gn),
    ggResult: row.gg_result,
    totalGoals: row.total_goals,
    parity: row.parity,
    overUnder15: row.over_under_15,
    overUnder25: row.over_under_25,
    overUnder35: row.over_under_35,
    timestamp: new Date(row.created_at).getTime(),
    aiConfidence: 0,
    aiReasoning: "",
    isAntiTrap: false,
    firstHalfGoal: false,
    tendency: "",
    dangerLevel: "safe" as const,
    topScores: [],
    bttsProb: 0,
    over25Prob: 0,
    firstHalfScore: "0-0",
    systemHome: "équilibré",
    systemAway: "équilibré",
    possessionHome: 50,
    possessionAway: 50,
  }));
}

export async function saveToHistory(result: MatchResult) {
  const deviceId = getDeviceId();
  await supabase.from("predictions").insert({
    home: result.home,
    away: result.away,
    odd_home: result.oddHome,
    odd_draw: result.oddDraw,
    odd_away: result.oddAway,
    prob_home: result.probHome,
    prob_draw: result.probDraw,
    prob_away: result.probAway,
    winner_1x2: result.winner1X2,
    first_half_goal_prob: result.firstHalfGoalProb,
    expected_goals: result.expectedGoals,
    goals_home: result.goalsHome,
    goals_away: result.goalsAway,
    score_home: result.scoreHome,
    score_away: result.scoreAway,
    exact_score: result.exactScore,
    prob_gg: result.probGG,
    prob_gn: result.probGN,
    gg_result: result.ggResult,
    total_goals: result.totalGoals,
    parity: result.parity,
    over_under_15: result.overUnder15,
    over_under_25: result.overUnder25,
    over_under_35: result.overUnder35,
    device_id: deviceId,
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

// --- Admin ---
const ADMIN_PASSWORD = "REDACTED";

export function isAdmin(): boolean {
  return localStorage.getItem(ADMIN_KEY) === "true";
}

export function loginAdmin(password: string): boolean {
  if (password === ADMIN_PASSWORD) {
    localStorage.setItem(ADMIN_KEY, "true");
    return true;
  }
  return false;
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
  let code = "VXS-";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3) code += "-";
  }
  return code;
}

export async function validateCode(inputCode: string): Promise<{ valid: boolean; days: number }> {
  // Hardcoded premium code
  if (inputCode === "06072K26V") {
    return { valid: true, days: 30 };
  }
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
