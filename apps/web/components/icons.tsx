type IconProps = { className?: string };

const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const WindowsIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M1 2.6 6.7 1.8v5.6H1zM7.4 1.7 15 .6v6.8H7.4zM1 8.1h5.7v5.6L1 12.9zM7.4 8.1H15v6.8l-7.6-1.1z" />
  </svg>
);

export const LockIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

export const CheckIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

export const FolderIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M1.8 4.2c0-.6.5-1 1-1h3.4l1.4 1.6h5.6c.6 0 1 .5 1 1v6.9c0 .6-.4 1-1 1H2.8c-.5 0-1-.4-1-1z" />
  </svg>
);

export const DriveIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <rect x="1.8" y="4" width="12.4" height="8" rx="1.5" />
    <path d="M4.5 9.5h.01M7 9.5h4.5" />
  </svg>
);

export const SyncIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5a5 5 0 0 0 9.4 1.5" />
    <path d="M3.4 2.6v2.6H6M12.6 13.4v-2.6H10" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </svg>
);

export const BranchIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-2 3-5.5 4" />
  </svg>
);

export const AlertIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M8 2.2 14.3 13H1.7z" />
    <path d="M8 6.5v3M8 11.3h.01" />
  </svg>
);
