export default function AnimatedBackground() {
  return (
    <>
      {/* Main animated background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Base dark gradient */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a1a 50%, #0a0f1a 100%)',
          }}
        />
        
        {/* Animated mesh gradient - Higher opacity */}
        <div className="absolute inset-0">
          {/* Fire orb - Orange/Red */}
          <div 
            className="absolute w-[600px] h-[600px] rounded-full animate-orb-1"
            style={{
              background: 'radial-gradient(circle, rgba(255,107,53,0.7) 0%, rgba(255,60,60,0.4) 40%, transparent 70%)',
              filter: 'blur(60px)',
            }}
          />
          
          {/* Ice orb - Cyan/Blue */}
          <div 
            className="absolute w-[500px] h-[500px] rounded-full animate-orb-2"
            style={{
              background: 'radial-gradient(circle, rgba(56,189,248,0.7) 0%, rgba(34,211,238,0.4) 40%, transparent 70%)',
              filter: 'blur(50px)',
            }}
          />
          
          {/* Gold orb - Yellow/Orange */}
          <div 
            className="absolute w-[450px] h-[450px] rounded-full animate-orb-3"
            style={{
              background: 'radial-gradient(circle, rgba(251,191,36,0.6) 0%, rgba(245,158,11,0.3) 40%, transparent 70%)',
              filter: 'blur(45px)',
            }}
          />
          
          {/* Purple orb - Violet */}
          <div 
            className="absolute w-[400px] h-[400px] rounded-full animate-orb-4"
            style={{
              background: 'radial-gradient(circle, rgba(168,85,247,0.6) 0%, rgba(139,92,246,0.3) 40%, transparent 70%)',
              filter: 'blur(40px)',
            }}
          />
          
          {/* Green orb - Emerald */}
          <div 
            className="absolute w-[350px] h-[350px] rounded-full animate-orb-5"
            style={{
              background: 'radial-gradient(circle, rgba(34,197,94,0.5) 0%, rgba(16,185,129,0.25) 40%, transparent 70%)',
              filter: 'blur(35px)',
            }}
          />
          
          {/* Pink orb - Rose */}
          <div 
            className="absolute w-[300px] h-[300px] rounded-full animate-orb-6"
            style={{
              background: 'radial-gradient(circle, rgba(236,72,153,0.5) 0%, rgba(244,63,94,0.25) 40%, transparent 70%)',
              filter: 'blur(30px)',
            }}
          />

          {/* Additional cyan orb for more coverage */}
          <div 
            className="absolute w-[400px] h-[400px] rounded-full animate-orb-1"
            style={{
              background: 'radial-gradient(circle, rgba(6,182,212,0.5) 0%, rgba(14,165,233,0.25) 40%, transparent 70%)',
              filter: 'blur(45px)',
              animationDelay: '-12s',
              animationDirection: 'reverse',
            }}
          />

          {/* Additional orange orb */}
          <div 
            className="absolute w-[350px] h-[350px] rounded-full animate-orb-3"
            style={{
              background: 'radial-gradient(circle, rgba(249,115,22,0.5) 0%, rgba(234,88,12,0.25) 40%, transparent 70%)',
              filter: 'blur(40px)',
              animationDelay: '-8s',
            }}
          />
        </div>

        {/* 3D Grid effect - More visible */}
        <div className="absolute inset-0 opacity-20">
          <div 
            className="absolute inset-0 animate-grid"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,107,53,0.15) 1px, transparent 1px),
                linear-gradient(90deg, rgba(56,189,248,0.15) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
              transform: 'perspective(500px) rotateX(60deg)',
              transformOrigin: 'center top',
            }}
          />
        </div>

        {/* Floating particles - More vibrant */}
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

        {/* Subtle vignette - less dark */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.3) 100%)',
          }}
        />
      </div>
    </>
  );
}
