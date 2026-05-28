interface FlagIconProps {
  countryCode: string;
  size?: number;
}

export default function FlagIcon({ countryCode, size = 20 }: FlagIconProps) {
  // Coupe d'Afrique - Carte de l'Afrique avec Madagascar
  if (countryCode === "africa") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        {/* Fond doré */}
        <rect width="50" height="45" fill="#FCD116" rx="2"/>
        {/* Cercle vert central */}
        <circle cx="25" cy="22" r="18" fill="#007A5E"/>
        {/* Carte de l'Afrique stylisée */}
        <path d="M25 6 L32 12 L35 18 L34 25 L38 32 L32 36 L28 34 L25 38 L22 34 L18 36 L12 32 L16 25 L15 18 L18 12 Z" fill="#FCD116"/>
        {/* Madagascar */}
        <ellipse cx="42" cy="32" rx="4" ry="6" fill="#FCD116"/>
        {/* Étoiles */}
        <circle cx="12" cy="10" r="2" fill="white"/>
        <circle cx="38" cy="10" r="2" fill="white"/>
        <circle cx="8" cy="22" r="1.5" fill="white"/>
        <circle cx="42" cy="22" r="1.5" fill="white"/>
      </svg>
    );
  }
  // Champions League - Logo avec cercle argenté et étoiles
  if (countryCode === "uefa") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        {/* Fond bleu nuit */}
        <rect width="50" height="45" fill="#0a1e3c" rx="2"/>
        {/* Cercle extérieur argenté */}
        <circle cx="25" cy="22" r="17" fill="none" stroke="#c0c0c0" strokeWidth="2"/>
        {/* Cercle intérieur */}
        <circle cx="25" cy="22" r="13" fill="none" stroke="#c0c0c0" strokeWidth="1.5"/>
        {/* Étoiles autour du cercle */}
        <polygon points="25,4 26,7 29,7 27,9 28,12 25,10 22,12 23,9 21,7 24,7" fill="#c0c0c0"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(18, 5)"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(-5, 5)"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(18, 18)"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(-5, 18)"/>
        <polygon points="25,38 26,41 29,41 27,43 28,46 25,44 22,46 23,43 21,41 24,41" fill="#c0c0c0"/>
        {/* Texte UCL stylisé */}
        <text x="25" y="26" textAnchor="middle" fill="#c0c0c0" fontSize="8" fontWeight="bold" fontFamily="sans-serif">UCL</text>
      </svg>
    );
  }
  // Coupe du monde - Trophée FIFA stylisé
  if (countryCode === "worldcup") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        {/* Fond bleu marine FIFA */}
        <rect width="50" height="45" fill="#0b2a5c" rx="2"/>
        {/* Lignes dorées décoratives */}
        <rect x="0" y="2" width="50" height="1" fill="#d4af37" opacity="0.5"/>
        <rect x="0" y="42" width="50" height="1" fill="#d4af37" opacity="0.5"/>
        {/* Trophée - Coupe */}
        <path d="M18 10 L18 20 Q18 26 25 28 Q32 26 32 20 L32 10" fill="none" stroke="#d4af37" strokeWidth="1.8"/>
        {/* Anses de la coupe */}
        <path d="M18 12 Q12 12 12 16 Q12 20 18 18" fill="none" stroke="#d4af37" strokeWidth="1.5"/>
        <path d="M32 12 Q38 12 38 16 Q38 20 32 18" fill="none" stroke="#d4af37" strokeWidth="1.5"/>
        {/* Base du trophée */}
        <rect x="22" y="28" width="6" height="3" fill="#d4af37" rx="0.5"/>
        <rect x="19" y="31" width="12" height="2.5" fill="#d4af37" rx="0.5"/>
        <rect x="21" y="33.5" width="8" height="2" fill="#d4af37" rx="0.5"/>
        {/* Globe terrestre stylisé au centre */}
        <circle cx="25" cy="18" r="5" fill="none" stroke="#d4af37" strokeWidth="1" opacity="0.6"/>
        <ellipse cx="25" cy="18" rx="2.5" ry="5" fill="none" stroke="#d4af37" strokeWidth="0.6" opacity="0.4"/>
        <line x1="20" y1="18" x2="30" y2="18" stroke="#d4af37" strokeWidth="0.6" opacity="0.4"/>
      </svg>
    );
  }
  // Angleterre
  if (countryCode === "gb-eng") {
    return (
      <svg width={size} height={size * 0.67} viewBox="0 0 60 40" className="inline-block">
        <rect width="60" height="40" fill="white"/>
        <rect x="24" width="12" height="40" fill="#CE1124"/>
        <rect y="14" width="60" height="12" fill="#CE1124"/>
        <rect x="26" width="8" height="40" fill="white"/>
        <rect y="16" width="60" height="8" fill="white"/>
      </svg>
    );
  }
  const flagColors: Record<string, [string, string, string?]> = {
    it: ["#009246", "#FFFFFF", "#CE2B37"],
    es: ["#AA151B", "#F1BF00", "#AA151B"],
    fr: ["#002395", "#FFFFFF", "#ED2939"],
    de: ["#000000", "#DD0000", "#FFCC00"],
    pt: ["#006600", "#FF0000", "#FFFF00"],
  };
  const colors = flagColors[countryCode] || ["#888", "#888", "#888"];
  return (
    <svg width={size} height={size * 0.67} viewBox="0 0 90 60" className="inline-block">
      {colors[2] ? (
        <>
          <rect width="90" height="20" fill={colors[0]}/>
          <rect y="20" width="90" height="20" fill={colors[1]}/>
          <rect y="40" width="90" height="20" fill={colors[2]}/>
        </>
      ) : (
        <rect width="90" height="60" fill={colors[0]}/>
      )}
    </svg>
  );
}
