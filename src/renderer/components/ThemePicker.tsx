import { useState, useEffect, useRef } from 'react'
import { themeList, applyTheme, DEFAULT_THEME, migrateLegacyThemeId } from '../themes/themes'
import type { ThemeId } from '../themes/themes'
import { useLang } from '../i18n/LangContext'
import { ts } from '../i18n/translations'
import type { ThemeId as TId } from '../themes/themes'

function themeName(lang: 'en' | 'zh', id: TId): string {
  return ts(lang, `theme.${id}` as any)
}

const STORAGE_KEY = 'parallel-llm-theme'

export default function ThemePicker() {
  const [current, setCurrent] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? migrateLegacyThemeId(saved) : DEFAULT_THEME
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyTheme(current)
  }, [current])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function select(id: ThemeId) {
    setCurrent(id)
    localStorage.setItem(STORAGE_KEY, id)
    setOpen(false)
  }

  const { lang } = useLang()
  const currentTheme = themeList.find((t) => t.id === current)

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className="theme-picker-btn"
        onClick={() => setOpen((o) => !o)}
        title={ts(lang, 'theme.change')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <span>{currentTheme ? themeName(lang, currentTheme.id) : ''}</span>
      </button>
      {open && (
        <div className="theme-dropdown">
          {themeList.map((t) => (
            <button
              key={t.id}
              className={`theme-option ${t.id === current ? 'active' : ''}`}
              onClick={() => select(t.id)}
            >
              <span
                className="theme-swatch"
                style={{
                  background: `linear-gradient(135deg, ${t.vars['--bg-primary']} 50%, ${t.vars['--accent-color']} 50%)`,
                }}
              />
              <span>{themeName(lang, t.id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
