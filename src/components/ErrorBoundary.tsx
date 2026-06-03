import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleGoHome = () => {
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
                Une erreur inattendue s'est produite
              </p>
              <p className="mb-6 text-xs text-muted-foreground">
                {this.state.error?.message || "Veuillez réessayer ou retourner à l'accueil."}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={this.handleReset}
                  variant="outline"
                  className="font-display tracking-wider"
                >
                  <RotateCcw size={14} className="mr-1" /> Réessayer
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
