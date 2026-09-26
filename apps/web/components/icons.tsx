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

// Product UI. File-type glyphs stand in for previews until the worker renders real thumbnails.

/** An assembly: parts stacked on each other. */
export const AssemblyIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M8 1.8 13.5 4.9v6.2L8 14.2 2.5 11.1V4.9z" />
    <path d="M2.5 4.9 8 8l5.5-3.1M8 8v6.2" />
  </svg>
);

/** A single part: a block with a hole. */
export const PartIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <rect x="2.5" y="4" width="11" height="8" rx="1" />
    <circle cx="8" cy="8" r="1.8" />
  </svg>
);

/** A drawing sheet with a title block. */
export const DrawingIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <rect x="2" y="2.5" width="12" height="11" rx="1" />
    <path d="M9 13.5v-3h5M5 5.5h3.5v3.5H5z" />
  </svg>
);

export const FileIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M4 1.8h5l3 3v9.4H4z" />
    <path d="M9 1.8v3h3" />
  </svg>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M8 2.2v8M4.8 7.2 8 10.4l3.2-3.2M2.8 13.3h10.4" />
  </svg>
);

export const StarIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="m8 1.9 1.8 3.9 4.2.4-3.2 2.8 1 4.1L8 11l-3.8 2.1 1-4.1L2 6.2l4.2-.4L8 1.9Z" />
  </svg>
);

export const ForkIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <circle cx="4.5" cy="3.2" r="1.4" />
    <circle cx="11.5" cy="3.2" r="1.4" />
    <circle cx="8" cy="12.8" r="1.4" />
    <path d="M4.5 4.6v1.2c0 1.2 1 2.2 2.2 2.2h2.6c1.2 0 2.2-1 2.2-2.2V4.6M8 8v3.4" />
  </svg>
);

export const PlusIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const SettingsIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" />
  </svg>
);

/** A release: a tag. */
export const TagIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M2 2.5h5.3l6.2 6.2-4.8 4.8L2.5 7.3z" />
    <circle cx="5.2" cy="5.7" r=".9" />
  </svg>
);

/** A release request: a branch flowing into main. */
export const MergeIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="12.5" r="1.5" />
    <path d="M4.5 5v6M4.5 5c0 3 3.5 4 7 6" />
  </svg>
);

export const HistoryIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6" />
    <path d="M8 5v3.2l2 1.3" />
  </svg>
);

export const LogOutIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M6.5 2.5H3.5v11h3M10 5l3 3-3 3M13 8H6.5" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg className={className} {...base}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </svg>
);
