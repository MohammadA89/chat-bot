interface IconProps {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconSparkles = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 7c0 2.8 2.2 5 5 5-2.8 0-5 2.2-5 5 0-2.8-2.2-5-5-5 2.8 0 5-2.2 5-5Z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPlus = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconSearch = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)

export const IconMessage = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
  </svg>
)

export const IconTrash = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    <path d="M10 11v5M14 11v5" />
  </svg>
)

export const IconPencil = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14 6 4 4" />
  </svg>
)

export const IconSettings = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
)

export const IconSend = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
)

export const IconStop = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
)

export const IconCopy = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15a2 2 0 0 1-1-1.7V6a2 2 0 0 1 2-2h7.3A2 2 0 0 1 15 5" />
  </svg>
)

export const IconCheck = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
)

export const IconRefresh = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 5v6h-6" />
  </svg>
)

export const IconChevronDown = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const IconChevronLeft = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m15 6-6 6 6 6" />
  </svg>
)

export const IconArrowDown = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
)

export const IconSidebar = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M15 4v16" />
  </svg>
)

export const IconSun = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const IconMoon = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />
  </svg>
)

export const IconKey = ({ size = 26, className }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={1.6}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 20 3M17 6l2.5 2.5M14 9l2 2" />
  </svg>
)

export const IconAlert = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.3" />
  </svg>
)

export const IconInfo = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16.5V11M12 7.7v.3" />
  </svg>
)

export const IconEye = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const IconEyeOff = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.5 8.2A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.4-.6" />
    <path d="M10 10a3 3 0 0 0 4 4M3 3l18 18" />
  </svg>
)

export const IconBrain = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 3A2.8 2.8 0 0 0 7 5.5 2.8 2.8 0 0 0 5 8a2.8 2.8 0 0 0 .6 1.8A2.8 2.8 0 0 0 5 12a2.8 2.8 0 0 0 1.4 2.4A2.8 2.8 0 0 0 9 18.5c.9 0 1.7-.4 2.2-1V4.5A2.6 2.6 0 0 0 9.5 3Z" />
    <path d="M14.5 3A2.8 2.8 0 0 1 17 5.5 2.8 2.8 0 0 1 19 8a2.8 2.8 0 0 1-.6 1.8A2.8 2.8 0 0 1 19 12a2.8 2.8 0 0 1-1.4 2.4A2.8 2.8 0 0 1 15 18.5c-.9 0-1.7-.4-2.2-1V4.5A2.6 2.6 0 0 1 14.5 3Z" />
  </svg>
)

export const IconLogout = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </svg>
)

export const IconCode = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m9 17-5-5 5-5M15 7l5 5-5 5" />
  </svg>
)

export const IconBook = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5Z" />
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19v4H6.5A2.5 2.5 0 0 1 4 19.5Z" />
  </svg>
)

export const IconPen = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 19h8" />
    <path d="M4 17.5 14.5 7a2.5 2.5 0 0 1 3.5 3.5L7.5 21 3 22Z" />
  </svg>
)

export const IconBulb = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .9 1.6h5.2c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3Z" />
  </svg>
)

export const IconX = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconPin = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 3h5l-.7 5.2 2.7 2.6H7.5l2.7-2.6L9.5 3Z" />
    <path d="M12 10.8V21" />
  </svg>
)

export const IconPinFilled = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 3h5l-.7 5.2 2.7 2.6H7.5l2.7-2.6L9.5 3Z" fill="currentColor" />
    <path d="M12 10.8V21" />
  </svg>
)

export const IconFolder = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h7A1.5 1.5 0 0 1 19 9.7v7.8A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z" />
  </svg>
)

export const IconFolderPlus = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h7A1.5 1.5 0 0 1 19 9.7v7.8A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z" />
    <path d="M11 12.5h4M13 10.5v4" />
  </svg>
)

export const IconFile = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7l-4-4Z" />
    <path d="M14 3v4h4" />
  </svg>
)

export const IconDots = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </svg>
)

export const IconWrench = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M15.5 3.5a5 5 0 0 0-6.2 6.2L3.8 15.2a2 2 0 0 0 2.8 2.8l5.5-5.5a5 5 0 0 0 6.2-6.2l-3 3-2.5-.6-.6-2.5 3-3Z" />
  </svg>
)

export const IconUser = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
)

export const IconLayers = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
    <path d="m4 12.5 8 4.5 8-4.5" />
  </svg>
)

/* ------------------------- workspace / IDE surface ------------------------ */

export const IconTerminal = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </svg>
)

export const IconGitBranch = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="6.5" cy="5.5" r="2.5" />
    <circle cx="6.5" cy="18.5" r="2.5" />
    <circle cx="17.5" cy="8.5" r="2.5" />
    <path d="M6.5 8v8M17.5 11v.5a4 4 0 0 1-4 4h-3" />
  </svg>
)

export const IconGitCommit = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M3 12h5.8M15.2 12H21" />
  </svg>
)

export const IconDiff = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7 4v6M4 7h6M4 17h6M14 7h6M17 14v6M14 17h6" />
  </svg>
)

export const IconPlay = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
  </svg>
)

export const IconShield = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

export const IconChevronRight = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m9 5 7 7-7 7" />
  </svg>
)

export const IconExternal = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
  </svg>
)

export const IconGithub = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9 19c-4 1.2-4-2.2-5.5-2.7M15 21v-3.4c0-1 .1-1.4-.5-2 2.4-.3 4.5-1.2 4.5-5a3.9 3.9 0 0 0-1.1-2.7 3.6 3.6 0 0 0-.1-2.7s-.9-.3-3 1.1a10.2 10.2 0 0 0-5.5 0C7.2 3.9 6.3 4.2 6.3 4.2a3.6 3.6 0 0 0-.1 2.7A3.9 3.9 0 0 0 5 9.6c0 3.8 2.1 4.7 4.5 5-.6.6-.6 1.2-.5 2V21" />
  </svg>
)

export const IconPanel = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9 4v16" />
  </svg>
)

export const IconFileCode = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="m10.5 12.5-1.5 1.5 1.5 1.5M13.5 12.5l1.5 1.5-1.5 1.5" />
  </svg>
)

export const IconFolderOpen = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v1" />
    <path d="M3.6 10h16.8l-2 8.5a1.5 1.5 0 0 1-1.5 1.2H5.9a1.5 1.5 0 0 1-1.5-1.2L3.6 10Z" />
  </svg>
)

export const IconImage = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
    <path d="m14 15 1.8-1.8a2 2 0 0 1 2.8 0L20 14.5" />
  </svg>
)
