
import React from 'react';

export const THEME_CONFIGS = {
  Dark: {
    bg: '#242424',
    surface: '#2f2f2f',
    textPrimary: '#ffffff',
    textSecondary: '#d1d5db',
    textMuted: '#9ca3af',
    border: 'rgba(255, 255, 255, 0.1)',
    skeletonBg: '#383838',
    cardBg: '#2f2f2f',
    toggleOffBg: 'rgba(255, 255, 255, 0.15)',
  },
  Grey: {
    bg: '#33373B',
    surface: '#3F4449',
    textPrimary: '#ffffff',
    textSecondary: '#E1E4E8',
    textMuted: '#AAB2BC',
    border: 'rgba(255, 255, 255, 0.12)',
    skeletonBg: '#4E545A',
    cardBg: '#3F4449',
    toggleOffBg: 'rgba(255, 255, 255, 0.18)',
  },
  Amoled: {
    bg: '#000000',
    surface: '#111111',
    textPrimary: '#ffffff',
    textSecondary: '#cccccc',
    textMuted: '#888888',
    border: 'rgba(255, 255, 255, 0.12)',
    skeletonBg: '#222222',
    cardBg: '#111111',
    toggleOffBg: 'rgba(255, 255, 255, 0.18)',
  },
  Blue: {
    bg: '#151F2E',
    surface: '#1E2C3F',
    textPrimary: '#ffffff',
    textSecondary: '#CBD7E6',
    textMuted: '#7E95AD',
    border: 'rgba(255, 255, 255, 0.1)',
    skeletonBg: '#2A3B52',
    cardBg: '#1E2C3F',
    toggleOffBg: 'rgba(255, 255, 255, 0.15)',
  },
  Light: {
    bg: '#E7E9EB',
    surface: '#ffffff',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    border: 'rgba(15, 23, 42, 0.1)',
    skeletonBg: '#D3D6DA',
    cardBg: '#ffffff',
    toggleOffBg: 'rgba(15, 23, 42, 0.18)',
  },
};

export const Icons = {
  Video: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
  ),
  Menu: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
  ),
  Plus: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
  ),
  X: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  ),
  Radio: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>
  ),
  Check: ({ size = 24, className = "", strokeWidth = 3 }: { size?: number; className?: string; strokeWidth?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="20 6 9 17 4 12"></polyline></svg>
  ),
  ChevronLeft: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="14 18 8 12 14 6"></polyline></svg>
  ),
  ChevronRight: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="10 18 16 12 10 6"></polyline></svg>
  ),
  ChevronDown: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="6 9 12 15 18 9"></polyline></svg>
  ),
  Settings: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
  ),
  Palette: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.7-.39 2.3-1.03.35-.37.6-.86.7-1.42.09-.53.22-1.05.6-1.47.52-.57 1.25-.82 2.05-.82 1.95 0 4.35-1.79 4.35-5.26C22 6.5 17.5 2 12 2z"></path></svg>
  ),
  LayoutDashboard: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
  ),
  Square: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg>
  ),
  Minus: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="5" x2="19" y1="12" y2="12"/></svg>
  ),
  Scale: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 20h10"/><path d="M10 4v16"/><path d="M14 4v16"/><path d="M2 8h20"/><path d="M2 16h20"/></svg>
  ),
  Play: ({ size = 32, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="9 6 18 12 9 18 9 6" strokeLinejoin="round" strokeLinecap="round" rx="2" ry="2"></polygon></svg>
  ),
  Trash: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
  ),
  Edit: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
  ),
  Paste: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
  ),
  Calendar: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
  ),
  UserGroup: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
  ),
  User: ({ size = 24, className = "", style }: { size?: number; className?: string, style?: React.CSSProperties }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
  ),
  Studio: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="5.5" r="3" />
      <circle cx="13.5" cy="5.5" r="3" />
      <rect x="3" y="10" width="14" height="9" rx="2" />
      <path d="m17 12 5-3v10l-5-3Z" />
    </svg>
  ),
  Verified: ({ color = '#60a5fa', size = 14, className = "" }: { color?: string; size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={`transition-colors duration-500 ${className}`} style={{ color }}><path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.7l-3.61.81.34 3.7L1 12l2.44 2.79-.34 3.69 3.61.82 1.89 3.2L12 21.04l3.4 1.46 1.89-3.2 3.61-.82-.34-3.69L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"></path></svg>
  ),
  UserBadge: ({ color = '#60a5fa', className = "" }: { color?: string; className?: string }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" className={`transition-colors duration-500 ${className}`}>
      <circle cx="12" cy="12" r="12" fill={color} />
      <g transform="scale(0.75) translate(4, 4.5)">
        <path d="M12 11c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4z" fill="var(--bg)" />
      </g>
    </svg>
  ),
  HD: () => (
    <span className="font-black text-[16px] tracking-tighter select-none leading-none">HD</span>
  ),
  FourK: () => (
    <span className="font-black text-[16px] tracking-tighter select-none leading-none">4K</span>
  ),
  AlertTriangle: ({ size = 20, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  ),
  DataIcon: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
  ),
  Anime: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 500 500"
      fill="currentColor"
      className={className}
    >
      <g transform="translate(0, 500) scale(0.1, -0.1)">
        <path d="M3165 4229 c-4 -6 18 -33 48 -60 35 -31 66 -71 84 -107 l28 -57 3 -342 3 -342 -38 -10 c-322 -85 -748 -172 -913 -187 -181 -16 -170 -83 25 -139 67 -20 109 -15 325 35 146 34 566 120 586 120 12 0 14 -123 14 -815 0 -481 -4 -815 -9 -815 -5 0 -76 18 -158 40 -195 53 -403 96 -555 115 -218 27 -251 21 -380 -66 -235 -160 -292 -359 -143 -505 119 -116 291 -162 569 -151 329 12 636 105 777 235 l57 53 144 -79 c78 -44 210 -116 292 -162 169 -94 226 -110 265 -71 24 24 25 40 10 112 -9 43 -22 63 -82 126 -81 85 -131 113 -407 224 l-165 66 -7 134 c-15 302 -28 886 -28 1234 l0 371 213 43 c239 49 317 77 317 113 -1 42 -46 76 -155 117 -67 25 -90 23 -180 -19 -52 -24 -160 -60 -180 -60 -4 0 -5 120 -3 268 4 221 8 275 22 314 10 26 24 52 32 59 25 20 16 36 -48 84 -128 95 -337 167 -363 124z m-592 -2700 c97 -14 243 -51 352 -89 141 -49 329 -121 338 -130 11 -10 -81 -84 -142 -115 -131 -66 -346 -121 -525 -134 -237 -17 -379 27 -468 144 -47 63 -50 103 -9 166 35 56 88 101 165 139 51 26 71 30 138 30 44 0 112 -5 151 -11z" />
        <path d="M1016 4168 c3 -13 15 -34 24 -48 50 -71 73 -276 51 -457 -7 -54 -37 -231 -66 -393 -119 -652 -155 -987 -155 -1443 0 -530 42 -787 167 -1030 49 -95 83 -130 122 -125 41 5 60 76 61 223 1 211 16 264 165 566 90 181 89 179 65 179 -13 0 -40 -28 -80 -82 -129 -176 -204 -268 -221 -273 -30 -10 -56 3 -68 33 -46 116 -62 331 -50 684 17 520 69 858 230 1498 89 352 88 335 22 438 -50 79 -223 252 -251 252 -20 0 -22 -4 -16 -22z" />
      </g>
    </svg>
  ),
  Hanime: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 500 500"
      fill="currentColor"
      className={className}
    >
      <g transform="translate(0, 500) scale(0.1, -0.1)">
        <path d="M3165 4229 c-4 -6 18 -33 48 -60 35 -31 66 -71 84 -107 l28 -57 3 -342 3 -342 -38 -10 c-322 -85 -748 -172 -913 -187 -181 -16 -170 -83 25 -139 67 -20 109 -15 325 35 146 34 566 120 586 120 12 0 14 -123 14 -815 0 -481 -4 -815 -9 -815 -5 0 -76 18 -158 40 -195 53 -403 96 -555 115 -218 27 -251 21 -380 -66 -235 -160 -292 -359 -143 -505 119 -116 291 -162 569 -151 329 12 636 105 777 235 l57 53 144 -79 c78 -44 210 -116 292 -162 169 -94 226 -110 265 -71 24 24 25 40 10 112 -9 43 -22 63 -82 126 -81 85 -131 113 -407 224 l-165 66 -7 134 c-15 302 -28 886 -28 1234 l0 371 213 43 c239 49 317 77 317 113 -1 42 -46 76 -155 117 -67 25 -90 23 -180 -19 -52 -24 -160 -60 -180 -60 -4 0 -5 120 -3 268 4 221 8 275 22 314 10 26 24 52 32 59 25 20 16 36 -48 84 -128 95 -337 167 -363 124z m-592 -2700 c97 -14 243 -51 352 -89 141 -49 329 -121 338 -130 11 -10 -81 -84 -142 -115 -131 -66 -346 -121 -525 -134 -237 -17 -379 27 -468 144 -47 63 -50 103 -9 166 35 56 88 101 165 139 51 26 71 30 138 30 44 0 112 -5 151 -11z" />
        <path d="M1016 4168 c3 -13 15 -34 24 -48 50 -71 73 -276 51 -457 -7 -54 -37 -231 -66 -393 -119 -652 -155 -987 -155 -1443 0 -530 42 -787 167 -1030 49 -95 83 -130 122 -125 41 5 60 76 61 223 1 211 16 264 165 566 90 181 89 179 65 179 -13 0 -40 -28 -80 -82 -129 -176 -204 -268 -221 -273 -30 -10 -56 3 -68 33 -46 116 -62 331 -50 684 17 520 69 858 230 1498 89 352 88 335 22 438 -50 79 -223 252 -251 252 -20 0 -22 -4 -16 -22z" />
      </g>
    </svg>
  ),
  Eye: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  Type: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
  ),
  Upload: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
  ),
  Download: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  ),
  SearchIcon: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <line x1="22" y1="22" x2="15" y2="15" />
    </svg>
  ),
  Instagram: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
  ),
  OnlyFans: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 400 400" fill="none" className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M137.5 75a125 125 0 1 0 125 125A125 125 0 0 0 137.5 75Zm0 162.5A37.5 37.5 0 1 1 175 200a37.45 37.45 0 0 1-37.5 37.5Z"
      />
      <path
        fill="currentColor"
        opacity="0.8"
        d="M278 168.75c31.76 9.14 69.25 0 69.25 0-10.88 47.5-45.38 77.25-95.13 80.87A124.73 124.73 0 0 1 137.5 325L175 205.81C213.55 83.3 233.31 75 324.73 75H387.5C377 121.25 340.81 156.58 278 168.75Z"
      />
    </svg>
  ),
  Coomer: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 400 400" fill="none" className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M137.5 75a125 125 0 1 0 125 125A125 125 0 0 0 137.5 75Zm0 162.5A37.5 37.5 0 1 1 175 200a37.45 37.45 0 0 1-37.5 37.5Z"
      />
      <path
        fill="currentColor"
        opacity="0.8"
        d="M278 168.75c31.76 9.14 69.25 0 69.25 0-10.88 47.5-45.38 77.25-95.13 80.87A124.73 124.73,0 0 1 137.5 325L175 205.81C213.55 83.3 233.31 75 324.73 75H387.5C377 121.25 340.81 156.58 278 168.75Z"
      />
    </svg>
  ),
  Fansly: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 600 600" fill="none" className={className}>
      {/* 1:1 Pixel-traced Fansly heart-lock with fully transparent central lens cutout */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 134.500 80.033 C 81.584 91.158, 41.026 132.995, 31.501 186.279 C 28.862 201.045, 29.802 227.910, 33.416 241 C 38.435 259.182, 45.456 273.820, 55.833 287.735 C 58.607 291.456, 111.193 344.762, 172.689 406.194 C 259.450 492.864, 285.508 518.343, 289 519.922 C 295.059 522.661, 304.920 522.673, 310.925 519.949 C 314.285 518.424, 335.534 497.794, 399.175 434.272 C 472.947 360.637, 483 350.244, 483 347.611 C 483 344.986, 474.714 336.322, 415.383 276.912 C 378.193 239.673, 347.931 208.795, 348.133 208.294 C 348.335 207.793, 360.216 195.898, 374.536 181.860 C 402.487 154.460, 406.719 151.254, 420.500 147.033 C 428.735 144.511, 444.489 143.992, 453.071 145.960 C 466.425 149.022, 481.882 159.044, 490.147 170 C 502.725 186.672, 506.414 209.688, 499.656 229.328 C 495.621 241.051, 491.727 246.279, 470.979 267.817 C 456.946 282.385, 452.016 288.136, 452.009 289.946 C 452.002 291.797, 457.031 297.444, 472.719 313.196 C 490.790 331.342, 493.833 334, 496.538 334 C 499.252 334, 502.258 331.344, 520.591 312.750 C 550.592 282.321, 559.423 268.292, 566.650 239.584 C 570.111 225.833, 571.012 201.791, 568.598 187.626 C 564.034 160.853, 552.358 137.632, 533.729 118.280 C 514.403 98.203, 492.491 85.899, 465.746 80.104 C 451.939 77.113, 426.079 77.109, 412.289 80.096 C 389.793 84.970, 369.094 94.901, 354.500 107.821 C 352.300 109.769, 308.083 153.468, 256.239 204.931 C 204.396 256.394, 161.622 298.621, 161.186 298.768 C 160.749 298.915, 148.453 286.990, 133.861 272.268 C 109.740 247.932, 106.998 244.819, 103.680 238 C 98.719 227.805, 97 220.343, 97 209 C 97 197.394, 98.723 190.150, 104.090 179.186 C 111.163 164.739, 127.133 151.389, 142.500 147.076 C 160.424 142.046, 180.397 144.796, 195.333 154.350 C 198.325 156.264, 209.541 166.418, 220.258 176.915 C 234.561 190.925, 240.377 196, 242.130 196 C 245.725 196, 287 154.504, 287 150.889 C 287 147.111, 247.774 108.609, 236 100.831 C 220.045 90.290, 205.067 83.857, 187.746 80.104 C 174.593 77.254, 147.886 77.219, 134.500 80.033 M 290.500 283.630 C 277.211 285.693, 265.015 291.986, 254.921 301.989 C 246.409 310.425, 242.339 316.945, 238.574 328.176 C 236.408 334.637, 236.002 337.646, 236.012 347.176 C 236.032 366.673, 241.085 379.088, 254.493 392.584 C 263.757 401.908, 274.694 408.030, 286.500 410.501 C 323.652 418.274, 359.153 392.686, 363.847 354.750 C 366.267 335.198, 359.518 316.284, 345.027 302 C 332.760 289.909, 319.740 284.169, 303.137 283.533 C 297.837 283.330, 292.150 283.374, 290.500 283.630 M 292.715 306.003 C 279.860 308.263, 267.301 317.927, 261.609 329.938 C 258.716 336.043, 258.500 337.265, 258.500 347.500 C 258.500 357.735, 258.716 358.957, 261.609 365.062 C 265.472 373.214, 273.065 380.977, 281.317 385.212 C 286.791 388.021, 288.666 388.433, 297.660 388.803 C 309.688 389.297, 314.900 387.918, 324.021 381.827 C 330.876 377.249, 337.039 369.312, 339.682 361.656 C 342.130 354.565, 342.097 341.320, 339.613 333.750 C 337.612 327.652, 336.963 327.235, 333 329.500 C 331.625 330.286, 328.278 330.945, 325.562 330.965 C 314.943 331.041, 308.512 321.719, 311.335 310.342 C 312.057 307.430, 311.900 307.142, 309.309 306.630 C 303.203 305.425, 297.278 305.201, 292.715 306.003"
      />
    </svg>
  ),
  GalleryIcon: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="9" cy="9" r="1.5"/>
      <path d="M19.5 16.5L15 12 7 19"/>
    </svg>
  ),
  MoreVertical: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
  ),
  MoreHorizontal: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
  ),
  ArrowUp: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
  ),
  Loader2: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
  ),
  Image: ({ size = 24, className = "" }: { size?: number; className?: string } = {}) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
  ),
  Grid: ({ size = 24, className = "" }: { size?: number; className?: string } = {}) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  Stream: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 14v1a7 7 0 0 0 14 0v-1" />
      <path d="M3 10h4v4H3z" fill="currentColor" stroke="none" />
      <path d="M17 10h4v4h-4z" fill="currentColor" stroke="none" />
      <path d="M12 2v9" />
      <path d="M8 7l4 4 4-4" />
    </svg>
  ),
  RotateCcw: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
  ),
  Refresh: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
  ),
  ExternalLink: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
  ),
  Link: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
  ),
  Database: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>
  ),
  Magnet: ({ className = "" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15Z"/>
      <path d="m5 8 4 4"/>
      <path d="m12 15 4 4"/>
    </svg>
  ),
  ArrowUpRight: ({ className = "" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 7h10v10"/>
      <path d="M7 17 17 7"/>
    </svg>
  ),
  Copy: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
    </svg>
  ),
  Globe: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  AdultPhotoSets: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="14" x="3" y="3" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m21 13-5-4-5 5-2-2-6 5" />
      <path d="M3 21h18" strokeWidth="2.5" />
    </svg>
  ),
  Viper: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 4l7 16 1-4 2-6 6-6" />
      <path d="M4 4h4" />
      <path d="M16 4h4" />
    </svg>
  ),
  Pause: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
  ),
  Pip: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <rect x="12" y="11" width="8" height="7" rx="1" fill="currentColor" fillOpacity="0.25" />
    </svg>
  ),
  Twitter: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 4l11.733 16h4.267l-11.733-16zM4 20l6.768-6.768m2.464-2.464L20 4" />
    </svg>
  ),
  FileText: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  Flame: ({ size = 24, className = "" }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>
    </svg>
  ),
};
