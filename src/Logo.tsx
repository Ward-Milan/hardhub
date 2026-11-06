export function HardHubLogo({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="hh-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#21201D" />
          <stop offset="100%" stopColor="#141311" />
        </linearGradient>
        <linearGradient id="hh-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.45" />
          <stop offset="50%" stopColor="#10B981" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="hh-front-ssd" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#323235" />
          <stop offset="100%" stopColor="#1C1C1E" />
        </linearGradient>
        <filter id="hh-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="-10"
            dy="16"
            stdDeviation="18"
            floodColor="#000000"
            floodOpacity="0.7"
          />
        </filter>
      </defs>

      {/* Squircle Background Canvas */}
      <rect width="1024" height="1024" rx="230" fill="url(#hh-bg)" />
      <rect
        x="16"
        y="16"
        width="992"
        height="992"
        rx="214"
        fill="none"
        stroke="url(#hh-rim)"
        strokeWidth="4"
      />

      {/* Back Storage Plate (Exact Hard Suite Dual-Plate Spec) */}
      <rect
        x="290"
        y="210"
        width="530"
        height="420"
        rx="70"
        fill="#242426"
        stroke="#3A3A3D"
        strokeWidth="8"
      />
      <circle cx="755" cy="275" r="14" fill="#10B981" />

      {/* Front Storage Plate (Exact Hard Suite Dual-Plate Spec) */}
      <rect
        x="200"
        y="380"
        width="530"
        height="420"
        rx="70"
        fill="url(#hh-front-ssd)"
        stroke="#454549"
        strokeWidth="8"
        filter="url(#hh-shadow)"
      />
      <circle cx="265" cy="445" r="12" fill="#3B82F6" />

      {/* Space Lens Donut Chart (Left) */}
      <path
        d="M 380 485 A 110 110 0 0 1 490 595 L 435 595 A 55 55 0 0 0 380 540 Z"
        fill="#10B981"
      />
      <path
        d="M 490 610 A 110 110 0 0 1 280 650 L 328 622 A 55 55 0 0 0 435 610 Z"
        fill="#3B82F6"
      />
      <path
        d="M 273 632 A 110 110 0 0 1 365 485 L 365 540 A 55 55 0 0 0 322 612 Z"
        fill="#F59E0B"
      />

      {/* Storage Capacity Bars (Right) */}
      <rect x="525" y="515" width="145" height="24" rx="8" fill="#141416" />
      <rect x="525" y="515" width="110" height="24" rx="8" fill="#3B82F6" />
      <rect x="525" y="565" width="145" height="24" rx="8" fill="#141416" />
      <rect x="525" y="565" width="85" height="24" rx="8" fill="#10B981" />
      <rect x="525" y="615" width="145" height="24" rx="8" fill="#141416" />
      <rect x="525" y="615" width="55" height="24" rx="8" fill="#F59E0B" />
    </svg>
  );
}

export function SdCardIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M7 3H14.5L19 7.5V19C19 20.1046 18.1046 21 17 21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 6.5V9.5M11.5 6.5V9.5M14.5 7.5V9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SsdIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M13 8.5L9.5 12.5H12.5L11 15.5L14.5 11.5H11.5L13 8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function HddIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="10.5" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="10.5" r="1.2" fill="currentColor" />
      <path
        d="M15.5 16.5L13.2 12.8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EjectSvgIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 5L4.5 14H19.5L12 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5 18.5H19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
