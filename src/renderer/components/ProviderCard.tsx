import { useState } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import ProviderIcon from './ProviderIcon'
import { useLang } from '../i18n/LangContext'
import { ts } from '../i18n/translations'
import { getProviderLabel } from '../utils/providerLabels'

type UserRating = 'good' | 'bad' | null

type ProviderResultData = {
  id: string
  provider: string
  status: string
  latencyMs?: number
  contentText?: string
  conversationUrl?: string
  errorMessage?: string
  userRating?: UserRating
}

type Props = {
  result: ProviderResultData
  onRegenerate?: (provider: string) => void
  onStartInThread?: (provider: string) => void
  isInThread?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#2d6',
  failed: '#e44',
  timeout: '#ea3',
  running: '#48f',
  pending: '#888',
}

function StreamingIndicator({ status }: { status: string }) {
  const { lang } = useLang()
  if (status === 'pending') {
    return <div className="streaming-indicator">{ts(lang, 'status.waiting')}</div>
  }
  if (status === 'running') {
    return <div className="streaming-indicator generating">{ts(lang, 'status.generating')}</div>
  }
  return null
}

// Happy face icon
function HappyFaceIcon({ filled }: { filled: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
}

// Sad face icon
function SadFaceIcon({ filled }: { filled: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
}

function ActionBar({ result, onRegenerate, onStartInThread, isInThread }: { result: ProviderResultData; onRegenerate?: (provider: string) => void; onStartInThread?: (provider: string) => void; isInThread?: boolean }) {
  const { lang } = useLang()
  const [rating, setRating] = useState<UserRating>(result.userRating ?? null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  async function handleCopy() {
    if (result.contentText) {
      await navigator.clipboard.writeText(result.contentText)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 1500)
    }
  }

  async function handleRate(value: 'good' | 'bad') {
    const newRating = rating === value ? null : value
    setRating(newRating)
    await window.electronAPI.saveUserRating(result.id, newRating)
  }

  return (
    <div className="action-bar">
      {result.conversationUrl && (
        <div className="provider-url-wrapper">
          <a
            className="provider-url"
            href={result.conversationUrl}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.openExternal(result.conversationUrl!)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            {result.conversationUrl}
          </a>
          {contextMenu && (
            <>
              <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
              <div
                className="context-menu"
                style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
              >
                <button
                  className="context-menu-item"
                  onClick={() => {
                    navigator.clipboard.writeText(result.conversationUrl!)
                    setContextMenu(null)
                  }}
                >
                  {ts(lang, 'action.copyLink')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="action-buttons">
        {onStartInThread && (
          <button
            className={`action-btn ${isInThread ? 'active' : ''}`}
            onClick={() => onStartInThread(result.provider)}
            title={ts(lang, 'action.chat')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/></svg>
          </button>
        )}
        <button
          className={`action-btn ${copyFeedback ? 'active' : ''}`}
          onClick={handleCopy}
          title={ts(lang, 'action.copy')}
        >
          {copyFeedback ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          )}
        </button>
        <button
          className={`action-btn ${rating === 'good' ? 'active' : ''}`}
          onClick={() => handleRate('good')}
          title={ts(lang, 'action.good')}
        >
          <HappyFaceIcon filled={rating === 'good'} />
        </button>
        <button
          className={`action-btn ${rating === 'bad' ? 'active' : ''}`}
          onClick={() => handleRate('bad')}
          title={ts(lang, 'action.bad')}
        >
          <SadFaceIcon filled={rating === 'bad'} />
        </button>
        {/* Regenerate button hidden — see docs/debugging-log.md Issue 4 */}
      </div>
    </div>
  )
}

export default function ProviderCard({ result, onRegenerate, onStartInThread, isInThread }: Props) {
  const { lang } = useLang()
  return (
    <div className={`provider-card status-${result.status}`}>
      <div className="provider-header">
        <ProviderIcon provider={result.provider} size={16} />
        <strong>{getProviderLabel(result.provider, lang)}</strong>
        {result.status !== 'completed' && (
          <span style={{ color: STATUS_COLORS[result.status] || '#888', fontWeight: 600 }}>
            {result.status === 'failed' ? '\u2717' : result.status === 'timeout' ? '\u23f1' : result.status}
          </span>
        )}
        {result.latencyMs != null && (
          <span className="latency">{(result.latencyMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      <StreamingIndicator status={result.status} />

      {result.thinkingText && (
        <details className="thinking-block">
          <summary className="thinking-summary">
            {ts(lang, 'status.thinking')}
          </summary>
          <div className="thinking-text">
            <MarkdownRenderer content={result.thinkingText} />
          </div>
        </details>
      )}

      {result.contentText && (
        <div className="provider-text">
          <MarkdownRenderer content={result.contentText} />
        </div>
      )}

      {result.errorMessage && (
        <div className="provider-error">{result.errorMessage}</div>
      )}

      {result.status === 'completed' && (
        <ActionBar result={result} onRegenerate={onRegenerate} onStartInThread={onStartInThread} isInThread={isInThread} />
      )}
    </div>
  )
}
