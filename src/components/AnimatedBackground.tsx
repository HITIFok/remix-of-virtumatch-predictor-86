export default function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden animated-multicolor">
      {/* Orbes animés multicolores */}
      <div className="absolute inset-0">
        {/* Fire orb - Orange */}
        <div className="orb orb-fire animate-orb-1" />
        
        {/* Ice orb - Cyan */}
        <div className="orb orb-ice animate-orb-2" />
        
        {/* Gold orb */}
        <div className="orb orb-gold animate-orb-3" />
        
        {/* Purple orb */}
        <div className="orb orb-purple animate-orb-4" />
        
        {/* Green orb */}
        <div className="orb orb-green animate-orb-5" />
        
        {/* Pink orb */}
        <div className="orb orb-pink animate-orb-6" />
        
        {/* Cyan orb 2 */}
        <div className="orb orb-cyan animate-orb-1" style={{ animationDelay: '-12s', animationDirection: 'reverse' }} />
        
        {/* Orange orb 2 */}
        <div className="orb orb-orange animate-orb-3" style={{ animationDelay: '-8s' }} />
      </div>

      {/* Particules 3D flottantes */}
      <div className="particles-3d">
        {[...Array(25)].map((_, i) => (
          <div
            key={i}
            className="particle-3d"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 20}s`,
              animationDuration: `${15 + Math.random() * 15}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
