/**
 * Komponen Maskot DVFLOW interaktif dengan Logo Meta Ads.
 *
 * Menggunakan Pure Vector SVG + CSS Keyframe Animations:
 * - 0 library eksternal, sangat ringan, 60fps halus, tajam di semua layar.
 * - Maskot kawaii "DVFLOW Buddy" melayang dan berinteraksi dengan logo Meta Ads.
 * - Efek kedipan mata, lambaian tangan, kilau partikel konversi data iklan.
 */
export function LoginMascot() {
  return (
    <div
      className="group relative mb-2 flex flex-col items-center justify-center select-none cursor-pointer"
      aria-hidden="true"
    >
      <style>{`
        @keyframes mascot-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-7px); }
        }
        @keyframes meta-orbit {
          0%, 100% { transform: translateY(0px) rotate(-3deg); }
          50% { transform: translateY(-11px) rotate(4deg); }
        }
        @keyframes mascot-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        @keyframes mascot-wave {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-14deg); }
          75% { transform: rotate(14deg); }
        }
        @keyframes data-sparkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.2) rotate(180deg); }
        }
        @keyframes meta-pulse-ring {
          0% { transform: scale(0.9); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 0.2; }
          100% { transform: scale(0.9); opacity: 0.6; }
        }
        .anim-mascot-float {
          animation: mascot-float 4.5s ease-in-out infinite;
        }
        .anim-meta-orbit {
          animation: meta-orbit 3.8s ease-in-out infinite;
        }
        .anim-eye-blink {
          transform-origin: center;
          animation: mascot-blink 4s ease-in-out infinite;
        }
        .anim-hand-wave {
          transform-origin: 48px 108px;
          animation: mascot-wave 2.8s ease-in-out infinite;
        }
        .anim-sparkle-1 {
          animation: data-sparkle 2.2s ease-in-out infinite;
        }
        .anim-sparkle-2 {
          animation: data-sparkle 2.8s ease-in-out 0.8s infinite;
        }
        .anim-sparkle-3 {
          animation: data-sparkle 2.5s ease-in-out 1.4s infinite;
        }
        .anim-meta-glow {
          animation: meta-pulse-ring 3s ease-in-out infinite;
        }
      `}</style>

      {/* Halo Glow di belakang maskot */}
      <div className="absolute -top-3 h-32 w-32 rounded-full bg-gradient-to-tr from-primary/15 via-[#0081FB]/15 to-transparent blur-2xl transition-all duration-500 group-hover:scale-125 group-hover:bg-primary/25" />

      <svg
        viewBox="0 0 200 150"
        className="relative h-28 w-40 drop-shadow-sm transition-transform duration-300 ease-out group-hover:scale-105"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradien Meta Ads Infinity */}
          <linearGradient id="metaGrad" x1="120" y1="20" x2="185" y2="65" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0064E0" />
            <stop offset="50%" stopColor="#0081FB" />
            <stop offset="100%" stopColor="#00C6FF" />
          </linearGradient>

          {/* Gradien Maskot Badan */}
          <linearGradient id="mascotBody" x1="40" y1="40" x2="130" y2="140" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#EEF2F9" />
          </linearGradient>

          {/* Gradien Maskot Telinga & Detail */}
          <linearGradient id="mascotAccent" x1="50" y1="30" x2="110" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#4F46F5" />
          </linearGradient>

          {/* Bayangan halus */}
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#1e293b" floodOpacity="0.1" />
          </filter>
        </defs>

        {/* 1. MASKOT UTAMA (Floating) */}
        <g className="anim-mascot-float">
          {/* Bayangan di lantai */}
          <ellipse cx="85" cy="142" rx="42" ry="6" fill="#cbd5e1" opacity="0.35" />

          {/* Telinga Kiri */}
          <path
            d="M58 48 C50 30, 60 18, 72 32 Z"
            fill="url(#mascotAccent)"
            stroke="#4338CA"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M62 44 C56 32, 63 25, 70 34 Z" fill="#F472B6" opacity="0.8" />

          {/* Telinga Kanan */}
          <path
            d="M112 48 C120 30, 110 18, 98 32 Z"
            fill="url(#mascotAccent)"
            stroke="#4338CA"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M108 44 C114 32, 107 25, 100 34 Z" fill="#F472B6" opacity="0.8" />

          {/* Antena Lampu DVFLOW */}
          <line x1="85" y1="35" x2="85" y2="22" stroke="#4F46F5" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="85" cy="19" r="4.5" fill="#38BDF8" className="anim-sparkle-1" />
          <circle cx="85" cy="19" r="2.5" fill="#FFFFFF" />

          {/* Kepala & Badan Maskot */}
          <rect
            x="48"
            y="36"
            width="74"
            height="70"
            rx="30"
            fill="url(#mascotBody)"
            stroke="#CBD5E1"
            strokeWidth="2.5"
            filter="url(#shadow)"
          />

          {/* Perut / Layar Dada */}
          <rect x="63" y="76" width="44" height="23" rx="10" fill="#F1F5F9" stroke="#E2E8F0" strokeWidth="1.5" />
          {/* Simbol Hati / Flow di dada */}
          <path
            d="M85 83 C82 80, 77 82, 78 86 C79 89, 85 92, 85 92 C85 92, 91 89, 92 86 C93 82, 88 80, 85 83 Z"
            fill="#4F46F5"
          />

          {/* Pipi Merona Kiri & Kanan */}
          <ellipse cx="61" cy="65" rx="5" ry="3" fill="#FDA4AF" opacity="0.85" />
          <ellipse cx="109" cy="65" rx="5" ry="3" fill="#FDA4AF" opacity="0.85" />

          {/* Mata Kawaii (dengan animasi berkedip) */}
          <g className="anim-eye-blink">
            {/* Mata Kiri */}
            <ellipse cx="71" cy="58" rx="5" ry="6.5" fill="#1E293B" />
            <circle cx="69" cy="56" r="2" fill="#FFFFFF" />
            <circle cx="73" cy="61" r="0.8" fill="#FFFFFF" />

            {/* Mata Kanan */}
            <ellipse cx="99" cy="58" rx="5" ry="6.5" fill="#1E293B" />
            <circle cx="97" cy="56" r="2" fill="#FFFFFF" />
            <circle cx="101" cy="61" r="0.8" fill="#FFFFFF" />
          </g>

          {/* Senyum Imut */}
          <path
            d="M80 66 Q85 71 90 66"
            stroke="#1E293B"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />

          {/* Tangan Kiri (Melambai menyapa user) */}
          <g className="anim-hand-wave">
            <path
              d="M48 80 C36 78, 30 68, 36 60 C40 56, 46 64, 49 72 Z"
              fill="url(#mascotBody)"
              stroke="#CBD5E1"
              strokeWidth="2"
            />
          </g>

          {/* Tangan Kanan (Terangkat ke arah logo Meta Ads) */}
          <path
            d="M120 78 C132 75, 142 66, 146 54 C148 50, 140 48, 134 56 C128 62, 122 70, 118 75 Z"
            fill="url(#mascotBody)"
            stroke="#CBD5E1"
            strokeWidth="2"
          />

          {/* Kaki Kiri & Kanan */}
          <rect x="62" y="103" width="16" height="8" rx="4" fill="#E2E8F0" />
          <rect x="92" y="103" width="16" height="8" rx="4" fill="#E2E8F0" />
        </g>

        {/* 2. LOGO META ADS (Melayang di samping atas kanan maskot) */}
        <g className="anim-meta-orbit" style={{ transformOrigin: '152px 40px' }}>
          {/* Glow Lingkaran Denyut di belakang Logo Meta */}
          <circle
            cx="153"
            cy="40"
            r="26"
            fill="#0081FB"
            opacity="0.15"
            className="anim-meta-glow"
          />

          {/* Tag "META ADS" Pill kecil mengambang */}
          <rect x="127" y="12" width="52" height="13" rx="6.5" fill="#0081FB" />
          <text
            x="153"
            y="21"
            fill="#FFFFFF"
            fontSize="7"
            fontWeight="bold"
            letterSpacing="0.5"
            textAnchor="middle"
            fontFamily="Inter, system-ui, sans-serif"
          >
            META ADS
          </text>

          {/* Official Meta Infinity Shape Ribbon */}
          {/* Loop Kiri */}
          <path
            d="M142.5 40 C142.5 33 137.5 28.5 132.5 28.5 C126.5 28.5 122 34 122 41 C122 48 126.5 53.5 132.5 53.5 C137.5 53.5 142.5 47 142.5 40 Z"
            fill="none"
            stroke="url(#metaGrad)"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Loop Kanan */}
          <path
            d="M163.5 40 C163.5 33 168.5 28.5 173.5 28.5 C179.5 28.5 184 34 184 41 C184 48 179.5 53.5 173.5 53.5 C168.5 53.5 163.5 47 163.5 40 Z"
            fill="none"
            stroke="url(#metaGrad)"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Silang Tengah Meta Ribbon */}
          <path
            d="M136 33.5 C141 38 165 47 170 33.5 M136 48.5 C141 44 165 35 170 48.5"
            fill="none"
            stroke="url(#metaGrad)"
            strokeWidth="5.5"
            strokeLinecap="round"
          />

          {/* Kilau Permukaan Meta Logo */}
          <circle cx="178" cy="34" r="1.8" fill="#FFFFFF" opacity="0.9" />
          <circle cx="128" cy="34" r="1.8" fill="#FFFFFF" opacity="0.9" />
        </g>

        {/* 3. PARTIKEL DATA & KILAU KONVERSI (Mengalir antara Meta Ads & Maskot) */}
        {/* Partikel 1: Bintang Kilau Emas */}
        <g className="anim-sparkle-1" transform="translate(136, 62)">
          <path d="M0 -4 L1.2 -1.2 L4 0 L1.2 1.2 L0 4 L-1.2 1.2 L-4 0 L-1.2 -1.2 Z" fill="#FBBF24" />
        </g>

        {/* Partikel 2: Kilau Biru Muda */}
        <g className="anim-sparkle-2" transform="translate(124, 46)">
          <path d="M0 -3 L0.9 -0.9 L3 0 L0.9 0.9 L0 3 L-0.9 0.9 L-3 0 L-0.9 -0.9 Z" fill="#38BDF8" />
        </g>

        {/* Partikel 3: Kilau Ungu Primary */}
        <g className="anim-sparkle-3" transform="translate(176, 68)">
          <path d="M0 -3.5 L1 -1 L3.5 0 L1 1 L0 3.5 L-1 1 L-3.5 0 L-1 -1 Z" fill="#818CF8" />
        </g>

        {/* Partikel 4: Titik Data Stream */}
        <circle cx="132" cy="74" r="1.5" fill="#60A5FA" opacity="0.7" className="anim-sparkle-1" />
        <circle cx="140" cy="78" r="1" fill="#F472B6" opacity="0.8" className="anim-sparkle-2" />
      </svg>
    </div>
  )
}
