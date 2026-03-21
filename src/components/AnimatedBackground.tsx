import { useEffect, useState } from 'react';

export default function AnimatedBackground() {
  const [isMobile, setIsMobile] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    const checkReducedMotion = () => {
      setPrefersReducedMotion(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    };
    
    checkMobile();
    checkReducedMotion();
    
    window.addEventListener('resize', checkMobile);
    
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', checkReducedMotion);
    
    return () => {
      window.removeEventListener('resize', checkMobile);
      motionQuery.removeEventListener('change', checkReducedMotion);
    };
  }, []);

  // Désactive les animations sur mobile ou si l'utilisateur préfère
  const disableAnimations = isMobile || prefersReducedMotion;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden animated-multicolor">
      {/* Orbes colorés - Réduits sur mobile */}
      <div className="absolute inset-0">
        {/* Fire orb - Orange - Coin supérieur gauche */}
        <div 
          className={`orb orb-fire ${!disableAnimations ? 'animate-orb-1' : ''}`} 
          style={{ top: '-100px', left: '-100px' }}
        />
        
        {/* Ice orb - Cyan - Coin supérieur droit */}
        <div 
          className={`orb orb-ice ${!disableAnimations ? 'animate-orb-2' : ''}`} 
          style={{ top: '10%', right: '-80px' }}
        />
        
        {/* Gold orb - Centre-bas - Seulement sur desktop */}
        {!isMobile && (
          <div 
            className={`orb orb-gold ${!disableAnimations ? 'animate-orb-3' : ''}`} 
            style={{ bottom: '20%', left: '30%' }}
          />
        )}
        
        {/* Purple orb - Centre - Seulement sur desktop */}
        {!isMobile && (
          <div 
            className={`orb orb-purple ${!disableAnimations ? 'animate-orb-4' : ''}`} 
            style={{ top: '40%', left: '50%' }}
          />
        )}
        
        {/* Pink orb - Gauche */}
        <div 
          className={`orb orb-pink ${!disableAnimations ? 'animate-orb-6' : ''}`} 
          style={{ top: '60%', left: '-60px' }}
        />
      </div>

      {/* Particules flottantes - Seulement sur desktop et si animations autorisées */}
      {!disableAnimations && (
        <div className="particles-3d">
          {[...Array(10)].map((_, i) => (
            <div
              key={i}
              className="particle-3d"
              style={{
                left: `${10 + (i * 8)}%`,
                animationDelay: `${i * 2}s`,
                animationDuration: `${18 + (i % 3) * 4}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
