import { useState, useRef, useEffect } from 'react'
import ProviderIcon from './ProviderIcon'
import { useLang } from '../i18n/LangContext'
import { ts, tf } from '../i18n/translations'
import { getProviderLabel } from '../utils/providerLabels'

export const PROVIDER_IDS = [
  'chatgpt', 'claude', 'gemini', 'deepseek', 'moonshot', 'zai',
] as const

const MAX_PROVIDERS = 6

type Props = {
  selectedProviders: string[]
  onProvidersChange: (providers: string[]) => void
  disabled?: boolean
}

export default function LlmSelector({ selectedProviders, onProvidersChange, disabled }: Props) {
  const { lang } = useLang()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const availableProviders = PROVIDER_IDS.filter(
    (id) => !selectedProviders.includes(id)
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [dropdownOpen])

  function addProvider(id: string) {
    onProvidersChange([...selectedProviders, id])
    setDropdownOpen(false)
    window.electronAPI.initializeProvider(id)
  }

  function removeProvider(id: string) {
    onProvidersChange(selectedProviders.filter((p) => p !== id))
  }

  function handleDragStart(index: number) { setDragIndex(index) }
  function handleDragOver(e: React.DragEvent, index: number) { e.preventDefault(); setDropTarget(index) }
  function handleDrop(index: number) {
    if (dragIndex === null || dragIndex === index) { setDragIndex(null); setDropTarget(null); return }
    const newList = [...selectedProviders]
    const [moved] = newList.splice(dragIndex, 1)
    newList.splice(index, 0, moved)
    onProvidersChange(newList)
    setDragIndex(null); setDropTarget(null)
  }
  function handleDragEnd() { setDragIndex(null); setDropTarget(null) }

  return (
    <div className={`llm-selector ${disabled ? 'disabled' : ''}`}>
      {selectedProviders.map((id, index) => (
        <div
          key={id}
          className={`llm-chip ${dragIndex === index ? 'dragging' : ''} ${dropTarget === index ? 'drop-target' : ''}`}
          draggable={!disabled}
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={() => handleDrop(index)}
          onDragEnd={handleDragEnd}
        >
          <ProviderIcon provider={id} size={14} />
          <span className="llm-chip-label">{getProviderLabel(id, lang)}</span>
          {!disabled && (
            <button className="llm-chip-remove" onClick={() => removeProvider(id)}
              title={tf(lang, 'llm.removeTitle', getProviderLabel(id, lang))}>
              &times;
            </button>
          )}
        </div>
      ))}

      {selectedProviders.length < MAX_PROVIDERS && availableProviders.length > 0 && !disabled && (
        <div className="llm-add-wrapper" ref={dropdownRef}>
          <button className="llm-add-btn" onClick={() => setDropdownOpen((o) => !o)} title={ts(lang, 'llm.addTitle')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {selectedProviders.length === 0 && !dropdownOpen && (
            <span className="llm-add-hint">{ts(lang, 'llm.addHint')}</span>
          )}
          {dropdownOpen && (
            <div className="llm-dropdown">
              {availableProviders.map((id) => (
                <button key={id} className="llm-dropdown-item" onClick={() => addProvider(id)}>
                  <ProviderIcon provider={id} size={16} />
                  <span>{getProviderLabel(id, lang)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
