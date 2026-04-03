import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

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
          <h1 className="mb-3 text-5xl font-display font-black text-gradient-fire">404</h1>
          <p className="mb-2 text-lg font-display text-foreground font-bold">Page introuvable</p>
          <p className="mb-6 text-sm text-muted-foreground">
            La page que vous recherchez n'existe pas ou a été déplacée.
          </p>
          <Link to="/">
            <Button className="bg-gradient-fire text-primary-foreground font-display tracking-wider">
              Retour à l'accueil
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
