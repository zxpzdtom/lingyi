import type { CSSProperties } from 'react'
import type { ThemeId } from './types'

export interface ThemeDefinition {
  name: string
  description: string
  dot: string
  page: string
  bg: string
  surface: string
  surface2: string
  text: string
  muted: string
  faint: string
  border: string
  border2: string
  accent: string
  accentInk: string
  accentSoft: string
  accentSoftInk: string
  accentGrad: string
  radius: string
  radiusSm: string
  radiusXs: string
  fontBody: string
  fontDisp: string
  logoRadius: string
  shadow: string
  glow: string
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  lucid: {
    name: 'Lucid',
    description: '干净中性',
    dot: '#4f5bd5',
    page: '#e8e6e1',
    bg: '#ffffff',
    surface: '#f6f6f7',
    surface2: '#eeeef0',
    text: '#1c1917',
    muted: '#79716b',
    faint: '#a9a29d',
    border: '#efedea',
    border2: '#e7e5e2',
    accent: '#4f5bd5',
    accentInk: '#ffffff',
    accentSoft: '#eceefe',
    accentSoftInk: '#4453c4',
    accentGrad: '#4f5bd5',
    radius: '12px',
    radiusSm: '10px',
    radiusXs: '6px',
    fontBody: '"Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontDisp: '"Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    logoRadius: '10px',
    shadow: '0 12px 30px rgba(0,0,0,.08),0 1px 0 rgba(255,255,255,.55) inset',
    glow: 'none',
  },
  halo: {
    name: 'Claude',
    description: '暖陶纸感',
    dot: '#b85c3f',
    page: '#efe9df',
    bg: '#fffaf3',
    surface: '#f7f0e7',
    surface2: '#efe5d9',
    text: '#2b241d',
    muted: '#74675b',
    faint: '#a09386',
    border: '#e9ded0',
    border2: '#dacbbc',
    accent: '#b85c3f',
    accentInk: '#fffaf3',
    accentSoft: '#f4e4d8',
    accentSoftInk: '#8c432d',
    accentGrad: 'linear-gradient(135deg,#c96b4e,#a94e32)',
    radius: '12px',
    radiusSm: '10px',
    radiusXs: '6px',
    fontBody: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontDisp: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    logoRadius: '10px',
    shadow: '0 18px 38px rgba(47,35,24,.13),0 2px 6px rgba(47,35,24,.07),0 1px 0 rgba(255,255,255,.62) inset',
    glow: '0 10px 22px rgba(184,92,63,.18)',
  },
  sage: {
    name: 'Sage',
    description: '暖纸友好',
    dot: '#5e7d59',
    page: '#f4f0e7',
    bg: '#fffdf8',
    surface: '#faf6ee',
    surface2: '#f1ece0',
    text: '#2c2820',
    muted: '#8a8172',
    faint: '#b4a994',
    border: '#efe9db',
    border2: '#e9e2d2',
    accent: '#5e7d59',
    accentInk: '#ffffff',
    accentSoft: '#e9f0e7',
    accentSoftInk: '#496845',
    accentGrad: '#5e7d59',
    radius: '12px',
    radiusSm: '10px',
    radiusXs: '6px',
    fontBody: '"Public Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontDisp: 'Newsreader, Georgia, serif',
    logoRadius: '50%',
    shadow: '0 12px 30px rgba(0,0,0,.07),0 1px 0 rgba(255,255,255,.5) inset',
    glow: 'none',
  },
}

export function themeVars(themeId: ThemeId) {
  const theme = THEMES[themeId]
  return {
    '--ly-page': theme.page,
    '--ly-bg': theme.bg,
    '--ly-surface': theme.surface,
    '--ly-surface-2': theme.surface2,
    '--ly-text': theme.text,
    '--ly-muted': theme.muted,
    '--ly-faint': theme.faint,
    '--ly-border': theme.border,
    '--ly-border-2': theme.border2,
    '--ly-accent': theme.accent,
    '--ly-accent-ink': theme.accentInk,
    '--ly-accent-soft': theme.accentSoft,
    '--ly-accent-soft-ink': theme.accentSoftInk,
    '--ly-accent-grad': theme.accentGrad,
    '--ly-radius': theme.radius,
    '--ly-radius-sm': theme.radiusSm,
    '--ly-radius-xs': theme.radiusXs,
    '--ly-font-body': theme.fontBody,
    '--ly-font-disp': theme.fontDisp,
    '--ly-logo-radius': theme.logoRadius,
    '--ly-theme-dot': theme.dot,
    '--ly-shadow': theme.shadow,
    '--ly-glow': theme.glow,
  } as CSSProperties
}
