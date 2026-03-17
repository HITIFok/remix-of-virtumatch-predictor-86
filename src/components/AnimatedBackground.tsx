export default function AnimatedBackground() {
  return (
    <>
      <div className="animated-bg" />
      <div className="particles">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="particle" />
        ))}
      </div>
    </>
  );
}
