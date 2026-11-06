export function HardHubLogo({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="14"
        fill="#202020"
        stroke="#333333"
        strokeWidth="2"
      />
      <circle cx="32" cy="32" r="19" stroke="#2A2A2A" strokeWidth="4.5" />
      <path
        d="M32 13A19 19 0 0 1 51 32"
        stroke="#10B981"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M51 32A19 19 0 0 1 19.5 46.3"
        stroke="#3B82F6"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M14.4 24.8A19 19 0 0 1 26.3 13.9"
        stroke="#F59E0B"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="32" r="11.5" stroke="#3B82F6" strokeOpacity="0.65" strokeWidth="3" />
      <circle cx="32" cy="32" r="4.5" fill="#10B981" />
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

