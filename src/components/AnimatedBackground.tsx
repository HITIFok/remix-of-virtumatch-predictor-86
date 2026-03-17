export default function AnimatedBackground() {
  return (
    <>
      {/* Main animated background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-background" />
        
        {/* Animated mesh gradient */}
        <div className="absolute inset-0 opacity-60">
          {/* Fire orb */}
          <div 
            className="absolute w-[500px] h-[500px] rounded-full blur-[80px] animate-orb-1"
            style={{
              background: 'radial-gradient(circle, rgba(255,107,53,0.4) 0%, rgba(255,107,53,0.1) 50%, transparent 70%)',
            }}
          />
          
          {/* Ice orb */}
          <div 
            className="absolute w-[400px] h-[400px] rounded-full blur-[70px] animate-orb-2"
            style={{
              background: 'radial-gradient(circle, rgba(56,189,248,0.4) 0%, rgba(56,189,248,0.1) 50%, transparent 70%)',
            }}
          />
          
          {/* Gold orb */}
          <div 
            className="absolute w-[350px] h-[350px] rounded-full blur-[60px] animate-orb-3"
            style={{
              background: 'radial-gradient(circle, rgba(251,191,36,0.35) 0%, rgba(251,191,36,0.1) 50%, transparent 70%)',
            }}
          />
          
          {/* Purple orb */}
          <div 
            className="absolute w-[300px] h-[300px] rounded-full blur-[50px] animate-orb-4"
            style={{
              background: 'radial-gradient(circle, rgba(168,85,247,0.35) 0%, rgba(168,85,247,0.1) 50%, transparent 70%)',
            }}
          />
          
          {/* Green orb */}
          <div 
            className="absolute w-[250px] h-[250px] rounded-full blur-[45px] animate-orb-5"
            style={{
              background: 'radial-gradient(circle, rgba(34,197,94,0.3) 0%, rgba(34,197,94,0.1) 50%, transparent 70%)',
            }}
          />
          
          {/* Pink orb */}
          <div 
            className="absolute w-[200px] h-[200px] rounded-full blur-[40px] animate-orb-6"
            style={{
              background: 'radial-gradient(circle, rgba(236,72,153,0.3) 0%, rgba(236,72,153,0.1) 50%, transparent 70%)',
            }}
          />
        </div>

        {/* 3D Grid effect */}
        <div className="absolute inset-0 opacity-10">
          <div 
            className="absolute inset-0 animate-grid"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,107,53,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(56,189,248,0.1) 1px, transparent 1px)
              `,
              backgroundSize: '50px 50px',
              transform: 'perspective(500px) rotateX(60deg)',
              transformOrigin: 'center top',
            }}
          />
        </div>

        {/* Floating particles */}
        <div className="particles-3d">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="particle-3d"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 15}s`,
                animationDuration: `${15 + Math.random() * 10}s`,
              }}
            />
          ))}
        </div>

        {/* Vignette effect */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.4) 100%)',
          }}
        />
      </div>
    </>
  );
}
