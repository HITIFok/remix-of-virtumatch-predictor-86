import { useEffect, useState } from 'react';

export default function AnimatedBackground() {
  const [particleCount, setParticleCount] = useState(12);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Détecter si mobile et ajuster les performances
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // Moins de particules sur mobile pour de meilleures performances
      setParticleCount(mobile ? 8 : 15);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden animated-multicolor">
      {/* Orbes animés multicolores - moins d'orbes sur mobile */}
      <div className="absolute inset-0">
        {/* Fire orb - Orange */}
        <div className="orb orb-fire animate-orb-1" />
        
        {/* Ice orb - Cyan */}
        <div className="orb orb-ice animate-orb-2" />
        
        {/* Gold orb */}
        <div className="orb orb-gold animate-orb-3" />
        
        {/* Purple orb */}
        <div className="orb orb-purple animate-orb-4" />
        
        {/* Green orb - caché sur mobile */}
        {!isMobile && (
          <div className="orb orb-green animate-orb-5" />
        )}
        
        {/* Pink orb */}
        <div className="orb orb-pink animate-orb-6" />
        
        {/* Orbes secondaires - seulement sur desktop */}
        {!isMobile && (
          <>
            <div className="orb orb-cyan animate-orb-1" style={{ animationDelay: '-12s', animationDirection: 'reverse' }} />
            <div className="orb orb-orange animate-orb-3" style={{ animationDelay: '-8s' }} />
          </>
        )}
      </div>

      {/* Particules flottantes - nombre adaptatif */}
      <div className="particles-3d">
        {[...Array(particleCount)].map((_, i) => (
          <div
            key={i}
            className="particle-3d"
            style={{
              left: `${(i / particleCount) * 100}%`,
              animationDelay: `${(i * 1.5) % 20}s`,
              animationDuration: `${15 + (i % 5) * 3}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
