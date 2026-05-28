// ─────────────────────────────────────────────────────────────────────────────
// CORRECTIF storage.ts — loginAdminSupabase
// ─────────────────────────────────────────────────────────────────────────────
//
// PROBLÈME : la fonction actuelle appelle le RPC verify_admin_password directement
// puis stocke un simple { expiresAt, verifiedAt } dans localStorage.
// Ce format ne contient pas de token HMAC, donc Admin.tsx ne peut pas
// le renvoyer à verify-admin pour re-validation côté serveur.
//
// CORRECTION : appeler la Edge Function admin-login (qui fait déjà le bcrypt
// côté serveur ET retourne un token HMAC signé), puis stocker ce token
// dans la session localStorage.
//
// ─── REMPLACEMENT ────────────────────────────────────────────────────────────
// Remplacer la fonction loginAdminSupabase dans src/lib/storage.ts
// par le code ci-dessous (copier/coller en remplacement des lignes 248-275).
// ─────────────────────────────────────────────────────────────────────────────

export async function loginAdminSupabase(password: string): Promise<{ success: boolean; message: string }> {
  try {
    // Appel à la Edge Function admin-login :
    // - vérifie le mot de passe via RPC SECURITY DEFINER (bcrypt côté serveur)
    // - retourne un token HMAC-SHA256 signé valable 24h
    const { data, error } = await supabase.functions.invoke('admin-login', {
      body: { password },
    });

    if (error) {
      console.error('[loginAdmin] Edge Function error:', error);
      return { success: false, message: `Erreur réseau : ${error.message}` };
    }

    if (!data?.success) {
      return { success: false, message: data?.error ?? 'Mot de passe incorrect' };
    }

    // Stocker le token HMAC signé + expiration en localStorage
    // Le token sera renvoyé à verify-admin avant chaque mutation admin.
    const session = {
      token: data.token,                              // token HMAC signé par le serveur
      expiresAt: Date.now() + (data.expiresIn ?? ADMIN_SESSION_DURATION),
      verifiedAt: new Date().toISOString(),
    };
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));

    return { success: true, message: 'Connexion admin réussie' };
  } catch (err: any) {
    console.error('[loginAdmin] Exception:', err);
    return { success: false, message: `Exception : ${err.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTIF verifyAdminSession
// ─────────────────────────────────────────────────────────────────────────────
// Remplacer aussi verifyAdminSession (lignes 279-281) par :

export async function verifyAdminSession(): Promise<boolean> {
  // Délègue à la vérification serveur (même logique que dans Admin.tsx)
  try {
    const raw = localStorage.getItem('virtuxxs_admin_session');
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session?.token) return false;

    const { data, error } = await supabase.functions.invoke('verify-admin', {
      body: { token: session.token },
    });

    return !error && data?.valid === true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTE SUR CAPACITOR
// ─────────────────────────────────────────────────────────────────────────────
// La version précédente évitait les Edge Functions pour compatibilité Capacitor.
// Les Edge Functions Supabase sont des endpoints HTTPS standards — elles
// fonctionnent dans Capacitor via supabase.functions.invoke() tant que
// VITE_SUPABASE_URL est correctement défini dans .env.production et que
// le réseau de l'appareil Android atteint Supabase.
//
// Si l'app doit fonctionner OFFLINE (mode avion), conserver l'ancien RPC
// pour le check de connexion et utiliser verify-admin uniquement pour les
// mutations (génération/suppression de codes), qui nécessitent de toute
// façon une connexion réseau pour écrire en DB.
