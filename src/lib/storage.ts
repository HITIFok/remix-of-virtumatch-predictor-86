import { supabase } from "@/integrations/supabase/client";
import { config } from "@/config/env";
import type { MatchResult } from "./prediction-engine";

const ACCESS_KEY = "virtuxxs_access";
const ADMIN_SESSION_KEY = "virtuxxs_admin_session";
const SETTINGS_KEY = "virtuxxs_settings";

// Session admin expirée (timestamp) - stockée dans localStorage pour validation côté client
// La vérification réelle est faite côté DB via RPC verify_admin_password
const ADMIN_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24h en ms

// Détecte si on est dans un environnement Capacitor (APK)
// En APK, window.location.origin = 'https://localhost' ou 'capacitor://localhost'
function isCapacitorApp(): boolean {
  if (typeof window === 'undefined') return false;
  const origin = window.location.origin;
  return origin === 'https://localhost' || origin === 'capacitor://localhost' || origin === 'http://localhost';
}

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

export async function saveToHistory(result: MatchResult): Promise<{ success: boolean; error?: string }> {
  const deviceId = getDeviceId();

  if (!deviceId) {
    return { success: false, error: 'Device ID non disponible' };
  }

  // Déterminer la prédiction (1, X, ou 2)
  const prediction = result.winner1X2.startsWith('1') ? '1' : result.winner1X2.startsWith('2') ? '2' : 'X';
  // aiConfidence is already a percentage (0-100), don't multiply again
  const confidence = Math.round(result.aiConfidence);

  const insertData = {
    // Colonnes principales (normalisées - un seul alias)
    home_team: result.home,
    away_team: result.away,
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
    // Scores (colonnes canoniques uniquement)
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
  };

  const { data, error } = await supabase.from("predictions").insert(insertData).select();

  if (error) {
    console.error('saveToHistory - Erreur:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function clearHistory() {
  const deviceId = getDeviceId();
  if (!deviceId) {
    console.error('clearHistory - device_id est null, suppression annulée');
    return;
  }
  await supabase.from("predictions").delete().eq("device_id", deviceId);
}

// --- Premium Access (server-validated) ---
// Local cache for quick UI checks, but server-side validation available.
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

// Quick client-side check (can be tampered, use verifyPremium() for sensitive ops)
export function isPremium(): boolean {
  return getAccess() !== null;
}

// Server-side premium validation (tamper-proof)
// Web → API Route Vercel (service_role)
// APK → Supabase RPC (CORS compatible avec Capacitor)
export async function verifyPremium(): Promise<boolean> {
  try {
    const deviceId = getDeviceId();
    if (!deviceId) return false;

    if (isCapacitorApp()) {
      // APK : utiliser Supabase RPC (CORS OK avec Capacitor)
      const { data, error } = await supabase.rpc('check_premium_status', {
        p_device_id: deviceId,
      });
      if (error || !data) {
        clearAccess();
        return false;
      }
      return data === true;
    } else {
      // Web : utiliser l'API Route Vercel (service_role)
      const res = await fetch(config.api.checkPremium, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) { clearAccess(); return false; }
      const data = await res.json();
      if (!data.premium) { clearAccess(); return false; }
      return true;
    }
  } catch {
    return false;
  }
}

export function clearAccess() {
  localStorage.removeItem(ACCESS_KEY);
}

// --- Admin (server-verified) ---
// Web → API Route Vercel avec service_role + token HMAC (sécurisé)
// APK → Supabase RPC verify_admin_password (CORS compatible avec Capacitor)

export function isAdmin(): boolean {
  const raw = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    if (!session.expiresAt) {
      const expiresAt = parseInt(raw, 10);
      if (isNaN(expiresAt) || Date.now() > expiresAt) {
        localStorage.removeItem(ADMIN_SESSION_KEY);
        return false;
      }
      return true;
    }
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function loginAdminSupabase(password: string): Promise<{ success: boolean; message: string }> {
  try {
    if (isCapacitorApp()) {
      // ═══ APK : Supabase RPC direct (CORS compatible) ═══
      const { data, error } = await supabase
        .rpc('verify_admin_password', { input_password: password });

      if (error) {
        return { success: false, message: `Erreur: ${error.message}` };
      }

      if (data === true) {
        // Session sans token HMAC (pas de backend Vercel dans l'APK)
        const session = {
          expiresAt: Date.now() + ADMIN_SESSION_DURATION,
          verifiedAt: new Date().toISOString(),
        };
        localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
        return { success: true, message: 'Connexion admin réussie' };
      }

      return { success: false, message: 'Mot de passe incorrect' };
    } else {
      // ═══ Web : API Route Vercel (service_role + HMAC token) ═══
      const res = await fetch(config.api.adminLogin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        return { success: false, message: `Erreur serveur (HTTP ${res.status})` };
      }

      const data = await res.json();

      if (!data.success) {
        return { success: false, message: data.error || 'Mot de passe incorrect' };
      }

      if (data.token) {
        const session = {
          token: data.token,
          expiresAt: Date.now() + (data.expiresIn || ADMIN_SESSION_DURATION),
          verifiedAt: new Date().toISOString(),
        };
        localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
        return { success: true, message: 'Connexion admin réussie' };
      }

      return { success: false, message: 'Réponse serveur invalide' };
    }
  } catch (err: any) {
    console.error('[loginAdmin] Exception:', err);
    return { success: false, message: `Erreur de connexion: ${err.message}` };
  }
}

// Validate admin session
// Web → vérifie le token HMAC via API Route Vercel
// APK → vérifie l'expiration locale (pas de token HMAC dans l'APK)
export async function verifyAdminSession(): Promise<boolean> {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);

    // Web : vérifier le token HMAC côté serveur
    if (!isCapacitorApp() && session?.token) {
      try {
        const res = await fetch(config.api.adminVerify, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: session.token }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid) return true;
        }
      } catch {
        // API indisponible → fallback local
      }
    }

    // APK ou fallback : vérifier l'expiration locale
    if (!session?.expiresAt) return false;
    return Date.now() <= session.expiresAt;
  } catch {
    return false;
  }
}

// Legacy function for backwards compatibility
export async function loginAdmin(password: string): Promise<boolean> {
  const result = await loginAdminSupabase(password);
  return result.success;
}

export function logoutAdmin() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
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

export async function saveGeneratedCode(gc: GeneratedCode): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase
    .from("access_codes")
    .insert({
      code: gc.code,
      duration_days: gc.durationDays,
      used: false,
    })
    .select()
    .single();

  if (error) {
    console.error("Erreur saveGeneratedCode:", error);
    return { success: false, message: error.message };
  }
  return { success: true, message: "Code sauvegardé" };
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

export async function validateCode(inputCode: string): Promise<{ valid: boolean; days: number; message: string }> {
  try {
    const deviceId = getDeviceId();

    // Mise à jour atomique : marquer comme utilisé UNIQUEMENT si non utilisé (race condition proof)
    const { data, error } = await supabase
      .from("access_codes")
      .update({
        used: true,
        used_at: new Date().toISOString(),
        used_by_device: deviceId
      })
      .eq("code", inputCode)
      .eq("used", false)
      .select("id, duration_days")
      .single();

    if (error) {
      console.error("Erreur Supabase validateCode:", error);
      return { valid: false, days: 0, message: `Erreur de connexion: ${error.message}` };
    }

    if (!data) {
      return { valid: false, days: 0, message: "Code invalide, introuvable ou déjà utilisé" };
    }

    return { valid: true, days: data.duration_days, message: `Code valide! ${data.duration_days} jours d'accès` };
  } catch (err: any) {
    console.error("Exception validateCode:", err);
    return { valid: false, days: 0, message: `Exception: ${err.message}` };
  }
}

// Suppression d'un code premium
// Web → API Route Vercel (vérifie le token HMAC + service_role)
// APK → Supabase RPC admin_delete_access_code (CORS compatible)
export async function deleteGeneratedCode(codeId: string): Promise<boolean> {
  try {
    if (isCapacitorApp()) {
      // APK : Supabase RPC direct
      const { data, error } = await supabase
        .rpc("admin_delete_access_code", { p_code_id: codeId });

      if (error) {
        console.error("Erreur suppression code:", error);
        return false;
      }
      return data === true;
    } else {
      // Web : API Route Vercel avec token HMAC
      const raw = localStorage.getItem(ADMIN_SESSION_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw);
      const token = session?.token;
      if (!token) return false;

      const res = await fetch(config.api.adminDeleteCode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, codeId }),
      });

      if (!res.ok) return false;
      const data = await res.json();
      return data.success === true;
    }
  } catch (err: any) {
    console.error('[deleteCode] Exception:', err);
    return false;
  }
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
