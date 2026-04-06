import { useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { ts } from '../i18n/translations'

type Props = {
  onSubmit: (prompt: string) => void
  disabled: boolean
  busy?: boolean
}

export default function QueryInput({ onSubmit, disabled, busy }: Props) {
  const { lang } = useLang()
  const [prompt, setPrompt] = useState('')

  function handleSubmit() {
    const trimmed = prompt.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setPrompt('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    }
  }

  return (
    <div className="query-input">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        disabled={disabled}
        placeholder={ts(lang, 'input.placeholder')}
      />
      <div className="query-input-footer">
        <span className="hint">{ts(lang, 'input.hint')}</span>
        <button onClick={handleSubmit} disabled={disabled || !prompt.trim()}>
          {busy ? ts(lang, 'input.running') : ts(lang, 'input.send')}
        </button>
      </div>
    </div>
  )
}
