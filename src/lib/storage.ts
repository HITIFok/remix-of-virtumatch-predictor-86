import { config } from "@/config/env";
import type { MatchResult } from "./prediction-engine";
import { getDeviceId } from "@/lib/device";

const ACCESS_KEY = "virtuxxs_access";
const ADMIN_SESSION_KEY = "virtuxxs_admin_session";
const SETTINGS_KEY = "virtuxxs_settings";

const ADMIN_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24h en ms

// ─── History (Cloud DB) ───────────────────────────────────────────────────────

export async function getHistory(): Promise<MatchResult[]> {
  const deviceId = getDeviceId();

  // Si pas de deviceId, ne rien retourner (protection vie privée)
  if (!deviceId) {
    return [];
  }

  try {
    const res = await fetch(`${config.api.predictions}?device_id=${encodeURIComponent(deviceId)}`);
    if (!res.ok) return [];
    const { predictions } = await res.json();

    if (!predictions || !Array.isArray(predictions)) return [];

    return predictions.map((row: any) => ({
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
      status: row.status,
      actualOutcome: row.actual_outcome,
      actualScore: row.actual_score,
    }));
  } catch (err) {
    console.error('getHistory error:', err);
    return [];
  }
}

export async function saveToHistory(result: MatchResult): Promise<{ success: boolean; error?: string }> {
  const deviceId = getDeviceId();

  if (!deviceId) {
    return { success: false, error: 'Device ID non disponible' };
  }

  const prediction = result.winner1X2.startsWith('1') ? '1' : result.winner1X2.startsWith('2') ? '2' : 'X';
  const confidence = Math.round(result.aiConfidence);

  try {
    const res = await fetch(config.api.predictions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        home_team: result.home,
        away_team: result.away,
        league: result.league || 'Instant League',
        odd_home: result.oddHome,
        odd_draw: result.oddDraw,
        odd_away: result.oddAway,
        prob_home: result.probHome,
        prob_draw: result.probDraw,
        prob_away: result.probAway,
        prediction,
        confidence,
        winner_1x2: result.winner1X2,
        score_home: result.scoreHome,
        score_away: result.scoreAway,
        exact_score: result.exactScore,
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
        device_id: deviceId,
        home: result.home,
        away: result.away,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      if (res.status === 409 || errBody?.code === '23505') {
        return { success: false, error: 'Duplicate prediction' };
      }
      return { success: false, error: errBody?.error || `Erreur serveur (HTTP ${res.status})` };
    }

    return { success: true };
  } catch (err: any) {
    console.error('saveToHistory error:', err);
    return { success: false, error: err.message || 'Erreur d\'insertion' };
  }
}

export async function clearHistory() {
  const deviceId = getDeviceId();
  if (!deviceId) {
    console.error('clearHistory - device_id est null, suppression annulée');
    return;
  }
  try {
    await fetch(config.api.predictions, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });
  } catch (err) {
    console.error('clearHistory error:', err);
  }
}

// ─── Premium Access (server-validated via API Route) ────────────────────────────
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

// ═══ SÉCURISÉ : premium vérifié côté SERVEUR via API Route (Web ET APK) ═══
export async function verifyPremium(): Promise<boolean> {
  try {
    const deviceId = getDeviceId();
    if (!deviceId) return false;

    const res = await fetch(config.api.checkPremium, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
    if (!res.ok) { clearAccess(); return false; }
    const data = await res.json();
    if (!data.premium) { clearAccess(); return false; }
    return true;
  } catch {
    return false;
  }
}

export function clearAccess() {
  localStorage.removeItem(ACCESS_KEY);
}

// ─── Admin (server-verified via API Routes — Web ET APK) ─────────────────────────

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

// ═══ SÉCURISÉ : login admin TOUJOURS via API Route Vercel ═══
export async function loginAdminSupabase(password: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(config.api.adminLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      if (res.status === 429) {
        return { success: false, message: 'Trop de tentatives. Réessayez dans quelques minutes.' };
      }
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
  } catch (err: any) {
    console.error('[loginAdmin] Exception:', err);
    return { success: false, message: `Erreur de connexion: ${err.message}` };
  }
}

// ═══ SÉCURISÉ : vérification session admin TOUJOURS via API Route ═══
export async function verifyAdminSession(): Promise<boolean> {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session?.token) return false;
    if (Date.now() > (session.expiresAt || 0)) return false;

    const res = await fetch(config.api.adminVerify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.token }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.valid) return true;
    }

    // API indisponible → refuser l'accès (pas de fallback local)
    // Sécurité C1 : un fallback local permettrait à un attaquant de
    // créer un token fake dans localStorage et bloquer l'API
    localStorage.removeItem(ADMIN_SESSION_KEY);
    return false;
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

// ─── Generated Codes (Cloud DB — via API Route sécurisée) ─────────────────────────
export interface GeneratedCode {
  id?: string;
  code: string;
  createdAt: number;
  durationDays: number;
  used: boolean;
  usedAt?: number;
}

// ═══ SÉCURISÉ : lecture des codes via API Route (vérifie token admin) ═══
export async function getGeneratedCodes(): Promise<GeneratedCode[]> {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return [];
    const session = JSON.parse(raw);
    if (!session?.token) return [];

    const res = await fetch(config.api.adminCodes, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) return [];
    const data = await res.json();

    if (!data.success || !data.codes) return [];

    return data.codes.map((row: any) => ({
      id: row.id,
      code: row.code,
      createdAt: row.createdAt,
      durationDays: row.durationDays,
      used: row.used,
      usedAt: row.usedAt || undefined,
    }));
  } catch (err) {
    console.error('[getGeneratedCodes] Exception:', err);
    return [];
  }
}

// ═══ SÉCURISÉ : création de code via API Route (vérifie token admin) ═══
export async function saveGeneratedCode(gc: GeneratedCode): Promise<{ success: boolean; message: string }> {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return { success: false, message: 'Non autorisé' };
    const session = JSON.parse(raw);
    if (!session?.token) return { success: false, message: 'Non autorisé' };

    const res = await fetch(config.api.adminCodes, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: gc.code, durationDays: gc.durationDays }),
    });

    if (!res.ok) {
      return { success: false, message: `Erreur serveur (HTTP ${res.status})` };
    }

    const data = await res.json();

    if (!data.success) {
      return { success: false, message: data.error || 'Erreur lors de la sauvegarde' };
    }

    return { success: true, message: "Code sauvegardé" };
  } catch (err: any) {
    console.error('[saveGeneratedCode] Exception:', err);
    return { success: false, message: `Exception: ${err.message}` };
  }
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

// ═══ validateCode — activation d'un code utilisateur via API Route ═══
export async function validateCode(inputCode: string): Promise<{ valid: boolean; days: number; message: string }> {
  try {
    const deviceId = getDeviceId();

    const res = await fetch(config.api.premiumActivate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: inputCode, device_id: deviceId }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { valid: false, days: 0, message: errBody?.error || 'Code invalide, introuvable ou déjà utilisé' };
    }

    const data = await res.json();

    if (!data.valid) {
      return { valid: false, days: 0, message: data.message || 'Code invalide, introuvable ou déjà utilisé' };
    }

    return { valid: true, days: data.days || 0, message: data.message || `Code valide! ${data.days || 0} jours d'accès` };
  } catch (err: any) {
    console.error('Exception validateCode:', err);
    return { valid: false, days: 0, message: `Exception: ${err.message}` };
  }
}

// ═══ SÉCURISÉ : suppression de code TOUJOURS via API Route ═══
export async function deleteGeneratedCode(codeId: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session?.token) return false;

    const res = await fetch(config.api.adminDeleteCode, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`,
      },
      body: JSON.stringify({ codeId }),
    });

    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch (err: any) {
    console.error('[deleteCode] Exception:', err);
    return false;
  }
}

// ─── Settings (localStorage) ────────────────────────────────────────────────────
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
