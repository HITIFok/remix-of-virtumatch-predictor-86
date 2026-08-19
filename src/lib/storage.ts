import { config } from "@/config/env";
import type { MatchResult } from "./prediction-engine";
import { getDeviceId, getAuthHeaders } from "@/lib/device";

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
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${config.api.predictions}?device_id=${encodeURIComponent(deviceId)}`, {
      headers: authHeaders,
    });
    if (!res.ok) return [];
    const { predictions } = await res.json();

    if (!predictions || !Array.isArray(predictions)) return [];

    return predictions.map((row: any) => ({
      id: row.id,
      home: row.home || row.homeTeam,
      away: row.away || row.awayTeam,
      league: row.league || "Instant League",
      oddHome: Number(row.oddHome),
      oddDraw: Number(row.oddDraw),
      oddAway: Number(row.oddAway),
      probHome: Number(row.probHome),
      probDraw: Number(row.probDraw),
      probAway: Number(row.probAway),
      winner1X2: row.winner1x2 || (row.prediction === '1' ? `1 — ${row.home || row.homeTeam}` : row.prediction === '2' ? `2 — ${row.away || row.awayTeam}` : 'X (Nul)'),
      firstHalfGoalProb: Number(row.firstHalfGoalProb) || 0.5,
      expectedGoals: Number(row.expectedGoals) || 2.5,
      goalsHome: Number(row.expectedGoals) || 1.5,
      goalsAway: Number(row.expectedGoals) || 1,
      scoreHome: row.scoreHome ?? row.predictedHomeScore ?? 0,
      scoreAway: row.scoreAway ?? row.predictedAwayScore ?? 0,
      exactScore: row.exactScore || row.predictedScore || "0-0",
      probGG: Number(row.probGg) || 0.5,
      probGN: Number(row.probGn) || 0.5,
      ggResult: row.ggResult || (row.totalGoals && row.totalGoals > 0 ? "Oui (GG)" : "Non (NG)"),
      totalGoals: row.totalGoals || (row.scoreHome || 0) + (row.scoreAway || 0),
      parity: row.parity || ((row.totalGoals || 0) % 2 === 0 ? "Pair" : "Impair"),
      overUnder15: row.overUnder15 || ((row.totalGoals || 0) > 1.5 ? "Over 1.5" : "Under 1.5"),
      overUnder25: row.overUnder25 || ((row.totalGoals || 0) > 2.5 ? "Over 2.5" : "Under 2.5"),
      overUnder35: row.overUnder35 || ((row.totalGoals || 0) > 3.5 ? "Over 3.5" : "Under 3.5"),
      timestamp: new Date(row.createdAt).getTime(),
      aiConfidence: Number(row.confidence) / 100 || 0,
      aiReasoning: "",
      isAntiTrap: false,
      firstHalfGoal: false,
      tendency: "",
      dangerLevel: "safe" as const,
      topScores: [],
      bttsProb: Number(row.bttsProb || row.probGg) || 0.5,
      over25Prob: Number(row.over25Prob) || 0.5,
      firstHalfScore: "0-0",
      systemHome: "équilibré",
      systemAway: "équilibré",
      possessionHome: 50,
      possessionAway: 50,
      status: row.status,
      actualOutcome: row.actualOutcome,
      actualScore: row.actualScore,
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
    const authHeaders = await getAuthHeaders();
    const res = await fetch(config.api.predictions, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
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
    const authHeaders = await getAuthHeaders();
    await fetch(config.api.predictions, {
      method: 'DELETE',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
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
  serverExpiresAt?: string; // ISO date from server (authoritative)
}

export function getAccess(): AccessData | null {
  try {
    const data = localStorage.getItem(ACCESS_KEY);
    if (!data) return null;
    const access: AccessData = JSON.parse(data);
    // Check expiry: prefer server date, fallback to client timestamp
    const expiresAt = access.serverExpiresAt
      ? new Date(access.serverExpiresAt).getTime()
      : access.expiresAt;
    if (Date.now() > expiresAt) {
      localStorage.removeItem(ACCESS_KEY);
      return null;
    }
    return access;
  } catch { return null; }
}

export function setAccess(code: string, daysValid: number, serverExpiresAt?: string) {
  const now = Date.now();
  const access: AccessData = {
    code,
    activatedAt: now,
    expiresAt: serverExpiresAt
      ? new Date(serverExpiresAt).getTime()
      : now + daysValid * 24 * 60 * 60 * 1000,
  };
  if (serverExpiresAt) {
    access.serverExpiresAt = serverExpiresAt;
  }
  localStorage.setItem(ACCESS_KEY, JSON.stringify(access));
}

// Quick client-side check (can be tampered, use verifyPremium() for sensitive ops)
export function isPremium(): boolean {
  return getAccess() !== null;
}

// ═══ SÉCURISÉ : premium vérifié côté SERVEUR via API Route (Web ET APK) ═══
// Returns:
//   true  → server confirmed premium is active
//   false → server explicitly said premium is NOT active (localStorage cleaned)
//   'offline' → network error / server unreachable (don't clear localStorage!)
export async function verifyPremium(): Promise<boolean | 'offline'> {
  try {
    const deviceId = getDeviceId();
    if (!deviceId) return false;

    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${config.api.premiumActivate}?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'GET',
      headers: authHeaders,
    });

    // Server error (500, 502, etc.) → don't clear, treat as offline
    if (!res.ok) return 'offline';

    const data = await res.json();
    // Server explicitly says NOT premium → clear localStorage
    if (!data.premium) { clearAccess(); return false; }

    // Sync server expiry date if provided
    // This ALSO auto-restores access when localStorage was cleared (browser clears on close)
    if (data.expires_at) {
      const access = getAccess();
      if (access) {
        // localStorage has data — just sync the server expiry
        setAccess(access.code, 0, data.expires_at);
      } else {
        // localStorage is empty but server says premium is active!
        // Auto-restore access so the user doesn't need to re-enter their code
        // (happens when browser clears cookies/data on close)
        setAccess('server-restore', 0, data.expires_at);
      }
    }

    return true;
  } catch {
    // Network error → don't clear, treat as offline (grace period)
    return 'offline';
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
export async function validateCode(inputCode: string): Promise<{ valid: boolean; days: number; message: string; expiresAt?: string }> {
  try {
    const deviceId = getDeviceId();
    const authHeaders = await getAuthHeaders();

    const res = await fetch(config.api.premiumActivate, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
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

    return {
      valid: true,
      days: data.days || 0,
      message: data.message || `Code valide! ${data.days || 0} jours d'accès`,
      expiresAt: data.expires_at || undefined, // Server-calculated expiry (authoritative)
    };
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
