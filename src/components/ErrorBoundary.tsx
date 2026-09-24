import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  isChunkError: boolean;
}

/**
 * Detect stale dynamic import errors caused by new deployments.
 * When Vite rebuilds, chunk hashes change (e.g. Shop-CB7WAUzm.js → Shop-NEW_HASH.js).
 * If the browser/SW still has the old index.js cached, it references chunks that
 * no longer exist on the server → 404. The only reliable fix is a full page reload.
 */
function isStaleChunkError(error: Error): boolean {
  const msg = error?.message || "";
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error in dynamically imported module")
  );
}

// Track reload attempts to prevent infinite reload loops
const CHUNK_RELOAD_KEY = "virtumatch_chunk_reload_ts";
const MAX_CHUNK_RELOADS = 2;

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isChunkError: isStaleChunkError(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Auto-recovery for stale chunk errors: force a hard reload
    // This fetches fresh index.html → fresh entry chunk → fresh lazy chunks
    if (isStaleChunkError(error)) {
      const lastReload = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      const reloadCount = lastReload ? parseInt(lastReload, 10) : 0;

      if (reloadCount < MAX_CHUNK_RELOADS) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(reloadCount + 1));
        // Small delay to let error log propagate, then hard reload
        setTimeout(() => window.location.reload(), 150);
      }
    }
  }

  handleReset = () => {
    // For chunk errors, "Réessayer" should reload the page
    if (this.state.isChunkError) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: undefined, isChunkError: false });
  };

  handleGoHome = () => {
    // Clear reload counter on explicit navigation
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 -z-10 animated-multicolor" />
          <div className="container-responsive relative z-10 text-center px-4">
            <div className="card-premium p-8 sm:p-12 max-w-md mx-auto">
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
                  <AlertTriangle className="text-destructive" size={36} />
                </div>
              </div>
              <h1 className="mb-3 text-2xl font-display font-black text-gradient-fire">
                Oups !
              </h1>
              <p className="mb-2 text-sm font-display text-foreground font-bold">
                {this.state.isChunkError
                  ? "Mise à jour de l'application en cours"
                  : "Une erreur inattendue s'est produite"}
              </p>
              <p className="mb-6 text-xs text-muted-foreground">
                {this.state.isChunkError
                  ? "Une nouvelle version est disponible. Rechargez la page pour l'obtenir."
                  : this.state.error?.message || "Veuillez réessayer ou retourner à l'accueil."}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={this.handleReset}
                  variant="outline"
                  className="font-display tracking-wider"
                >
                  <RotateCcw size={14} className="mr-1" /> Recharger
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  className="bg-gradient-fire text-primary-foreground font-display tracking-wider"
                >
                  Retour à l'accueil
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
