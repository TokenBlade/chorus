import { useState, useEffect } from 'react'
import ProviderCard from './ProviderCard'
import ProviderIcon from './ProviderIcon'

type ProviderResultData = {
  id: string
  provider: string
  status: string
  latencyMs?: number
  contentText?: string
  conversationUrl?: string
  errorMessage?: string
  userRating?: 'good' | 'bad' | null
}

type Props = {
  results: ProviderResultData[]
  onRegenerate?: (provider: string) => void
  onStartInThread?: (provider: string) => void
  inThreadProvider?: string | null
  autoCollapse?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#2d6',
  failed: '#e44',
  timeout: '#ea3',
  running: '#48f',
  pending: '#888',
}

// Symbols for exceptional states only — completed is silent
const STATUS_SYMBOLS: Record<string, string> = {
  failed: '\u2717',    // ✗
  timeout: '\u23f1',   // ⏱
  running: '\u25cf',   // ● (pulsing via CSS)
  pending: '\u25cb',   // ○
}

export default function TabbedResults({ results, onRegenerate, onStartInThread, inThreadProvider, autoCollapse }: Props) {
  const [activeTab, setActiveTab] = useState(0)
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)

  // userCollapsed === null means "follow autoCollapse"; non-null means user override
  const collapsed = userCollapsed !== null ? userCollapsed : !!autoCollapse

  const activeResult = results[activeTab]

  // Mark result as viewed when user switches tabs
  useEffect(() => {
    if (activeResult && activeResult.id && !activeResult.id.startsWith('pending-')) {
      window.electronAPI.markViewed(activeResult.id)
    }
  }, [activeResult?.id])

  function handleTabClick(i: number) {
    if (i === activeTab) {
      setUserCollapsed(!collapsed)
    } else {
      setActiveTab(i)
      setUserCollapsed(false)
    }
  }

  return (
    <div className="tabbed-results">
      <div className="tab-bar">
        {results.map((r, i) => (
          <button
            key={r.id}
            className={`tab-button ${i === activeTab ? 'active' : ''} ${i === activeTab && collapsed ? 'collapsed' : ''}`}
            onClick={() => handleTabClick(i)}
          >
            <ProviderIcon provider={r.provider} size={14} />
            <span className="tab-provider">{r.provider}</span>
            {STATUS_SYMBOLS[r.status] && (
              <span
                className={`tab-status ${r.status === 'running' ? 'pulsing' : ''}`}
                style={{ color: STATUS_COLORS[r.status] || '#888' }}
              >
                {STATUS_SYMBOLS[r.status]}
              </span>
            )}
            {r.latencyMs != null && (
              <span className="tab-latency">{(r.latencyMs / 1000).toFixed(1)}s</span>
            )}
          </button>
        ))}
      </div>
      <div
        className={`tab-content ${collapsed ? 'collapsed' : ''}`}
        onClick={collapsed ? () => setUserCollapsed(false) : undefined}
      >
        {activeResult && (
          <ProviderCard
            key={activeResult.id}
            result={activeResult}
            onRegenerate={onRegenerate}
            onStartInThread={onStartInThread}
            isInThread={inThreadProvider === activeResult.provider}
          />
        )}
      </div>
    </div>
  )
}
