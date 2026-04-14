import { useRef, useEffect } from 'react'
import { useLang } from '../i18n/LangContext'
import { ts, tf } from '../i18n/translations'
import ProviderIcon from './ProviderIcon'
import { getProviderLabel } from '../utils/providerLabels'

type Props = {
  provider: string
  onSubmit: (prompt: string) => void
  disabled: boolean
  draft: string
  onDraftChange: (text: string) => void
  onDeactivate: () => void
}

export default function InThreadInput({ provider, onSubmit, disabled, draft, onDraftChange, onDeactivate }: Props) {
  const { lang } = useLang()
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const providerLabel = getProviderLabel(provider, lang)

  useEffect(() => { textareaRef.current?.focus() }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onDeactivate()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onDeactivate])

  function handleSubmit() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
  }

  return (
    <div className={`in-thread-input provider-${provider}`} ref={containerRef}>
      <div className="in-thread-header">
        <span className="in-thread-indicator" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>{ts(lang, 'inThread.chattingWith')} <ProviderIcon provider={provider} size={14} /> <strong>{providerLabel}</strong></span>
      </div>
      <textarea ref={textareaRef} value={draft} onChange={(e) => onDraftChange(e.target.value)} onKeyDown={handleKeyDown} rows={3} disabled={disabled}
        placeholder={tf(lang, 'inThread.placeholder', providerLabel)} />
      <div className="in-thread-footer">
        <span className="hint">{ts(lang, 'input.hint')}</span>
        <button onClick={handleSubmit} disabled={disabled || !draft.trim()}>
          {disabled ? ts(lang, 'input.running') : tf(lang, 'inThread.sendTo', providerLabel)}
        </button>
      </div>
    </div>
  )
}
