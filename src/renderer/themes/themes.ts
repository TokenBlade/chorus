export type ThemeId = 'snowlight' | 'sandstone' | 'obsidian'

export type ThemeDefinition = {
  id: ThemeId
  name: string
  vars: Record<string, string>
}

// Map old theme IDs to new ones for localStorage migration
const LEGACY_IDS: Record<string, ThemeId> = {
  chatgpt: 'snowlight',
  claude: 'sandstone',
  gemini: 'obsidian',
  midnight: 'obsidian',
}

export function migrateLegacyThemeId(id: string): ThemeId {
  return LEGACY_IDS[id] || (id as ThemeId)
}

/**
 * Snowlight — clean white theme with green accent
 */
const snowlight: ThemeDefinition = {
  id: 'snowlight',
  name: 'Snowlight',
  vars: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f3f3f3',
    '--bg-surface': '#f7f7f8',
    '--bg-surface-alt': '#f0f0f1',
    '--bg-hover': '#2a2a2a',
    '--bg-active': '#343541',
    '--bg-input': '#ffffff',
    '--bg-button': '#10a37f',
    '--bg-button-hover': '#0e8c6d',
    '--bg-error': '#fef2f2',
    '--bg-code': '#f3f4f6',
    '--bg-code-block': '#1e1e1e',
    '--text-code-block': '#d4d4d4',
    '--bg-table-header': '#f3f4f6',
    '--bg-tab': '#f7f7f8',
    '--bg-tab-active': '#ffffff',
    '--bg-debug-btn': '#f3f4f6',
    '--bg-debug-btn-hover': '#e5e7eb',
    '--border-primary': '#e5e5e5',
    '--border-secondary': '#ececec',
    '--border-input': '#d1d5db',
    '--border-button': '#10a37f',
    '--border-error': '#ef4444',
    '--border-accent': '#10a37f',
    '--text-primary': '#0d0d0d',
    '--text-secondary': '#374151',
    '--text-tertiary': '#6b7280',
    '--text-muted': '#9ca3af',
    '--text-faint': '#b0b0b0',
    '--text-dim': '#d1d5db',
    '--text-heading': '#111827',
    '--text-link': '#10a37f',
    '--text-error': '#ef4444',
    '--text-accent': '#10a37f',
    '--text-on-button': '#ffffff',
    '--accent-color': '#10a37f',
    '--accent-streaming': '#10a37f',
    '--accent-live-bg': '#ecfdf5',
    '--accent-live-color': '#10a37f',
    '--accent-live-border': '#10a37f',
    '--star-color': '#f59e0b',
    '--sidebar-text': '#1a1a1a',
    '--sidebar-text-secondary': '#6b7280',
    '--sidebar-text-faint': '#9ca3af',
    '--sidebar-hover': '#e8e8e8',
    '--sidebar-active': '#dcdcdc',
    '--sidebar-border': '#e5e5e5',
    '--font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
}

/**
 * Sandstone — warm cream/ivory theme with terracotta accent
 */
const sandstone: ThemeDefinition = {
  id: 'sandstone',
  name: 'Sandstone',
  vars: {
    '--bg-primary': '#faf6f1',
    '--bg-secondary': '#f0ebe4',
    '--bg-surface': '#ffffff',
    '--bg-surface-alt': '#f5f1ec',
    '--bg-hover': '#eae4dc',
    '--bg-active': '#ddd6cc',
    '--bg-input': '#ffffff',
    '--bg-button': '#c96442',
    '--bg-button-hover': '#b55838',
    '--bg-error': '#fef2f2',
    '--bg-code': '#f5f1ec',
    '--bg-code-block': '#2b2520',
    '--text-code-block': '#d4d4d4',
    '--bg-table-header': '#f0ebe4',
    '--bg-tab': '#f0ebe4',
    '--bg-tab-active': '#ffffff',
    '--bg-debug-btn': '#eae4dc',
    '--bg-debug-btn-hover': '#ddd6cc',
    '--border-primary': '#e0d8ce',
    '--border-secondary': '#e8e0d6',
    '--border-input': '#d4cac0',
    '--border-button': '#c96442',
    '--border-error': '#ef4444',
    '--border-accent': '#c96442',
    '--text-primary': '#2b2520',
    '--text-secondary': '#4a4138',
    '--text-tertiary': '#6b6058',
    '--text-muted': '#9a8c80',
    '--text-faint': '#b8aa9e',
    '--text-dim': '#d4cac0',
    '--text-heading': '#1a1510',
    '--text-link': '#c96442',
    '--text-error': '#dc2626',
    '--text-accent': '#c96442',
    '--text-on-button': '#ffffff',
    '--accent-color': '#c96442',
    '--accent-streaming': '#c96442',
    '--accent-live-bg': '#fef7ed',
    '--accent-live-color': '#c96442',
    '--accent-live-border': '#c96442',
    '--star-color': '#f59e0b',
    '--sidebar-text': '#2b2520',
    '--sidebar-text-secondary': '#6b6058',
    '--sidebar-text-faint': '#9a8c80',
    '--sidebar-hover': '#e4ded6',
    '--sidebar-active': '#ddd6cc',
    '--sidebar-border': '#e0d8ce',
    '--font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
}

/**
 * Obsidian — deep black theme with blue accent
 */
const obsidian: ThemeDefinition = {
  id: 'obsidian',
  name: 'Obsidian',
  vars: {
    '--bg-primary': '#0e0e0e',
    '--bg-secondary': '#1e1f20',
    '--bg-surface': '#1e1f20',
    '--bg-surface-alt': '#161616',
    '--bg-hover': '#2c2d2e',
    '--bg-active': '#373838',
    '--bg-input': '#1e1f20',
    '--bg-button': '#4285f4',
    '--bg-button-hover': '#3275e4',
    '--bg-error': '#2a1010',
    '--bg-code': '#1e1f20',
    '--bg-code-block': '#161616',
    '--text-code-block': '#e3e3e3',
    '--bg-table-header': '#1e1f20',
    '--bg-tab': '#1e1f20',
    '--bg-tab-active': '#0e0e0e',
    '--bg-debug-btn': '#2c2d2e',
    '--bg-debug-btn-hover': '#373838',
    '--border-primary': '#333435',
    '--border-secondary': '#2a2b2c',
    '--border-input': '#444546',
    '--border-button': '#4285f4',
    '--border-error': '#e44',
    '--border-accent': '#4285f4',
    '--text-primary': '#e3e3e3',
    '--text-secondary': '#c4c7c5',
    '--text-tertiary': '#9aa0a6',
    '--text-muted': '#7c8288',
    '--text-faint': '#5f6368',
    '--text-dim': '#444746',
    '--text-heading': '#f1f3f1',
    '--text-link': '#8ab4f8',
    '--text-error': '#f28b82',
    '--text-accent': '#8ab4f8',
    '--text-on-button': '#ffffff',
    '--accent-color': '#4285f4',
    '--accent-streaming': '#8ab4f8',
    '--accent-live-bg': '#122040',
    '--accent-live-color': '#4285f4',
    '--accent-live-border': '#4285f4',
    '--star-color': '#f5a623',
    '--sidebar-text': '#c4c7c5',
    '--sidebar-text-secondary': '#7c8288',
    '--sidebar-text-faint': '#5f6368',
    '--sidebar-hover': '#2c2d2e',
    '--sidebar-active': '#373838',
    '--sidebar-border': '#333435',
    '--font-family': "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  snowlight,
  sandstone,
  obsidian,
}

export const themeList: ThemeDefinition[] = [snowlight, sandstone, obsidian]

export const DEFAULT_THEME: ThemeId = 'obsidian'

/**
 * Apply a theme's CSS variables to the document root.
 */
export function applyTheme(themeId: ThemeId): void {
  const theme = themes[themeId]
  if (!theme) return
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value)
  }
}
