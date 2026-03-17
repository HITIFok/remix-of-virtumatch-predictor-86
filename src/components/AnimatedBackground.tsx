import { useEffect, useState } from 'react';

export default function AnimatedBackground() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden animated-multicolor">
      {/* Orbes colorés - Positions fixes pour être toujours visibles */}
      <div className="absolute inset-0">
        {/* Fire orb - Orange - Coin supérieur gauche */}
        <div 
          className="orb orb-fire animate-orb-1" 
          style={{ top: '-100px', left: '-100px' }}
        />
        
        {/* Ice orb - Cyan - Coin supérieur droit */}
        <div 
          className="orb orb-ice animate-orb-2" 
          style={{ top: '10%', right: '-80px' }}
        />
        
        {/* Gold orb - Centre-bas */}
        <div 
          className="orb orb-gold animate-orb-3" 
          style={{ bottom: '20%', left: '30%' }}
        />
        
        {/* Purple orb - Centre */}
        <div 
          className="orb orb-purple animate-orb-4" 
          style={{ top: '40%', left: '50%' }}
        />
        
        {/* Green orb - Coin inférieur droit */}
        {!isMobile && (
          <div 
            className="orb orb-green animate-orb-5" 
            style={{ bottom: '-50px', right: '-50px' }}
          />
        )}
        
        {/* Pink orb - Gauche */}
        <div 
          className="orb orb-pink animate-orb-6" 
          style={{ top: '60%', left: '-60px' }}
        />
      </div>

      {/* Particules flottantes - Nombre réduit sur mobile */}
      <div className="particles-3d">
        {[...Array(isMobile ? 6 : 10)].map((_, i) => (
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
    </div>
  );
}
