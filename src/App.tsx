import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Loader2 } from "lucide-react";
import { DeviceIdRestorer } from "@/components/DeviceIdRestorer";
import EarlyAlertBanner from "@/components/EarlyAlertBanner";

const Index = lazy(() => import("./pages/Index"));
const LiveMatches = lazy(() => import("./pages/LiveMatches"));
const History = lazy(() => import("./pages/History"));
const Shop = lazy(() => import("./pages/Shop"));
const Guide = lazy(() => import("./pages/Guide"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const Admin = lazy(() => import("./pages/Admin"));
const NotFound = lazy(() => import("./pages/NotFound"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 -z-10 animated-multicolor" />
      <div className="relative z-10 text-center">
        <div className="relative inline-block mb-4">
          <Loader2 size={40} className="text-fire animate-spin" />
          <div className="absolute inset-0 blur-lg bg-fire/30 rounded-full" />
        </div>
        <p className="text-sm text-muted-foreground font-display tracking-wider">
          Chargement...
        </p>
      </div>
    </div>
  );
}

const App = () => (
  <ErrorBoundary>
    <DeviceIdRestorer>
      <TooltipProvider>
        <EarlyAlertBanner />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/live" element={<LiveMatches />} />
              <Route path="/history" element={<History />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/guide" element={<Guide />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </DeviceIdRestorer>
  </ErrorBoundary>
);

export default App;
