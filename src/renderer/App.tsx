import { useState, useRef, useEffect } from 'react'
import QueryInput from './components/QueryInput'
import InThreadInput from './components/InThreadInput'
import TabbedResults from './components/TabbedResults'
import HistoryList from './components/HistoryList'
import ThemePicker from './components/ThemePicker'
import LlmSelector from './components/LlmSelector'
import { applyTheme, DEFAULT_THEME, migrateLegacyThemeId } from './themes/themes'
import type { ThemeId } from './themes/themes'
import { useLang } from './i18n/LangContext'
import { ts } from './i18n/translations'

type ProviderResultData = {
  id: string
  provider: string
  status: string
  latencyMs?: number
  contentText?: string
  thinkingText?: string
  conversationUrl?: string
  errorMessage?: string
  userRating?: 'good' | 'bad' | null
}

type TurnData = {
  queryId: string
  prompt: string
  createdAt: string
  results: ProviderResultData[]
}

type ConversationMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

type ConversationData = {
  conversation: ConversationMeta
  turns: TurnData[]
}



type StreamEvent =
  | { type: 'started'; queryId: string; provider: string }
  | { type: 'thinking-delta'; queryId: string; provider: string; text: string }
  | { type: 'delta'; queryId: string; provider: string; text: string }
  | { type: 'completed'; queryId: string; provider: string; resultId: string; text: string; thinkingText?: string; conversationUrl?: string; latencyMs: number }
  | { type: 'error'; queryId: string; provider: string; error: string; status: 'failed' | 'timeout' }
  | { type: 'turn-complete'; queryId: string }

declare global {
  interface Window {
    electronAPI: {
      createConversation: (title?: string) => Promise<{ success: boolean; data?: ConversationMeta; error?: string }>
      listConversations: () => Promise<{ success: boolean; data?: ConversationMeta[]; error?: string }>
      getConversationDetails: (conversationId: string) => Promise<{ success: boolean; data?: ConversationData; error?: string }>
      sendMessageInConversation: (conversationId: string, prompt: string, providers?: string[]) => Promise<{ success: boolean; data?: { queryId: string; prompt: string; createdAt: string }; error?: string }>
      renameConversation: (conversationId: string, title: string) => Promise<{ success: boolean; error?: string }>
      hideConversation: (conversationId: string) => Promise<{ success: boolean; error?: string }>
      initializeProvider: (provider: string) => Promise<{ success: boolean; error?: string }>
      saveProviderRating: (input: { providerResultId: string; score: number; tags: string[]; note?: string }) => Promise<{ success: boolean; error?: string }>
      onProviderStreamEvent: (callback: (data: StreamEvent) => void) => void
      removeProviderStreamListeners: () => void
      saveUserRating: (resultId: string, rating: 'good' | 'bad' | null) => Promise<{ success: boolean; error?: string }>
      markViewed: (resultId: string) => Promise<{ success: boolean }>
      sendSingleProviderMessage: (conversationId: string, prompt: string, provider: string) => Promise<{ success: boolean; data?: { queryId: string; prompt: string; createdAt: string }; error?: string }>
      regenerateProvider: (queryId: string, provider: string, conversationId: string) => Promise<{ success: boolean; error?: string }>
      rateOnProvider: (provider: string, rating: 'good' | 'bad') => Promise<{ success: boolean; error?: string }>
      openExternal: (url: string) => Promise<void>
    }
  }
}

function CollapsiblePrompt({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [isLong, setIsLong] = useState(false)
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)

  // Only collapse prompts that exceed 6 lines; short prompts stay fully visible.
  const collapsed = userCollapsed !== null ? userCollapsed : isLong

  useEffect(() => {
    if (ref.current) {
      const lineHeight = parseFloat(getComputedStyle(ref.current).lineHeight) || 20
      setIsLong(ref.current.scrollHeight > lineHeight * 10 + 2)
    }
  }, [text])

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    await navigator.clipboard.writeText(text)
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 1500)
  }

  const className = [
    'turn-prompt-text',
    isLong ? 'collapsible' : '',
    collapsed ? 'collapsed' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <div
        ref={ref}
        className={className}
        onClick={isLong ? () => setUserCollapsed(!collapsed) : undefined}
      >
        {text}
      </div>
      <div className="turn-prompt-actions">
        <button className={`action-btn ${copyFeedback ? 'active' : ''}`} onClick={handleCopy} title="Copy">
          {copyFeedback ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          )}
        </button>
      </div>
    </>
  )
}

const PROVIDERS_STORAGE_KEY = 'parallel-llm-last-providers'

function getLastUsedProviders(): string[] {
  try {
    const saved = localStorage.getItem(PROVIDERS_STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function saveLastUsedProviders(providers: string[]): void {
  localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(providers))
}

function App() {
  const { lang, setLang } = useLang()
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversationData, setConversationData] = useState<ConversationData | null>(null)
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [inThreadProvider, setInThreadProvider] = useState<string | null>(null)
  const [inThreadDrafts, setInThreadDrafts] = useState<Record<string, string>>({})
  const [selectedProviders, setSelectedProviders] = useState<string[]>(getLastUsedProviders)
  const [lockedProviders, setLockedProviders] = useState<string[] | null>(null)
  const turnsEndRef = useRef<HTMLDivElement>(null)
  const queryToConvRef = useRef<Map<string, { conversationId: string; providers: string[] }>>(new Map())
  const activeConvIdRef = useRef(activeConversationId)
  activeConvIdRef.current = activeConversationId
  const busy = busyConversationId !== null && busyConversationId === activeConversationId

  useEffect(() => {
    const raw = localStorage.getItem('parallel-llm-theme')
    const saved = raw ? migrateLegacyThemeId(raw) : DEFAULT_THEME
    applyTheme(saved)
  }, [])

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversationData?.turns.length])

  useEffect(() => {
    function handleStreamEvent(event: StreamEvent) {
      const queryInfo = queryToConvRef.current.get(event.queryId)
      const eventConvId = queryInfo?.conversationId
      setConversationData((prev) => {
        if (!prev) return prev
        if (eventConvId && eventConvId !== prev.conversation.id) return prev
        return {
          ...prev,
          turns: prev.turns.map((turn) => {
            if (turn.queryId !== event.queryId) return turn
            // Ensure all expected providers have placeholder results in the correct order
            let results = turn.results
            if (queryInfo && results.length < queryInfo.providers.length) {
              const existingProviders = new Set(results.map((r) => r.provider))
              const full: ProviderResultData[] = queryInfo.providers.map((p) =>
                existingProviders.has(p)
                  ? results.find((r) => r.provider === p)!
                  : { id: `pending-${p}`, provider: p, status: 'pending' }
              )
              results = full
            }
            if (event.type === 'started') {
              return { ...turn, results: results.map((r) => r.provider === event.provider ? { ...r, status: 'running' } : r) }
            }
            if (event.type === 'thinking-delta') {
              return { ...turn, results: results.map((r) => r.provider === event.provider ? { ...r, thinkingText: event.text } : r) }
            }
            if (event.type === 'delta') {
              return { ...turn, results: results.map((r) => r.provider === event.provider ? { ...r, contentText: event.text } : r) }
            }
            if (event.type === 'completed') {
              return { ...turn, results: results.map((r) => r.provider === event.provider ? { ...r, id: event.resultId, status: 'completed', contentText: event.text, thinkingText: event.thinkingText, conversationUrl: event.conversationUrl, latencyMs: event.latencyMs, errorMessage: undefined } : r) }
            }
            if (event.type === 'error') {
              return { ...turn, results: results.map((r) => r.provider === event.provider ? { ...r, status: event.status, errorMessage: event.error } : r) }
            }
            return { ...turn, results }
          }),
        }
      })
      if (event.type === 'turn-complete') {
        setBusyConversationId((prev) => prev === eventConvId ? null : prev)
        setInThreadProvider((prev) => eventConvId === activeConvIdRef.current ? null : prev)
        setHistoryRefreshKey((k) => k + 1)
        queryToConvRef.current.delete(event.queryId)
      }
    }
    window.electronAPI.onProviderStreamEvent(handleStreamEvent)
    return () => { window.electronAPI.removeProviderStreamListeners() }
  }, [])

  async function handleSubmit(prompt: string) {
    setError('')
    const providers = lockedProviders || selectedProviders
    if (!lockedProviders) {
      setLockedProviders([...selectedProviders])
      saveLastUsedProviders(selectedProviders)
    }
    try {
      let convId = activeConversationId
      if (!convId) {
        const createRes = await window.electronAPI.createConversation()
        if (!createRes.success || !createRes.data) { setError(createRes.error || 'Failed to create conversation'); return }
        convId = createRes.data.id
        setActiveConversationId(convId)
        setConversationData({ conversation: createRes.data, turns: [] })
        setHistoryRefreshKey((k) => k + 1)
      }
      setBusyConversationId(convId)
      const res = await window.electronAPI.sendMessageInConversation(convId, prompt, providers)
      if (res.success && res.data) {
        queryToConvRef.current.set(res.data.queryId, { conversationId: convId, providers })
        const pendingTurn: TurnData = { queryId: res.data.queryId, prompt: res.data.prompt, createdAt: res.data.createdAt, results: providers.map((provider) => ({ id: `pending-${provider}`, provider, status: 'pending' })) }
        setConversationData((prev) => prev ? { ...prev, turns: [...prev.turns, pendingTurn] } : prev)
      } else { setError(res.error || 'Unknown error'); setBusyConversationId(null) }
    } catch (err) { setError(String(err)); setBusyConversationId(null) }
  }

  async function handleSelectConversation(conversationId: string) {
    setError(''); setInThreadProvider(null); setActiveConversationId(conversationId)
    try {
      const res = await window.electronAPI.getConversationDetails(conversationId)
      if (res.success && res.data) {
        setConversationData(res.data)
        const firstTurn = res.data.turns[0]
        if (firstTurn) { const providers = firstTurn.results.map((r) => r.provider); setLockedProviders(providers); setSelectedProviders(providers) }
      } else { setError(res.error || 'Failed to load conversation') }
    } catch (err) { setError(String(err)) }
  }

  async function handleRenameConversation(conversationId: string, title: string): Promise<boolean> {
    setError('')
    try {
      const trimmed = title.trim()
      if (!trimmed) return false

      const res = await window.electronAPI.renameConversation(conversationId, trimmed)
      if (!res.success) {
        setError(res.error || 'Failed to rename conversation')
        return false
      }

      setConversationData((prev) => {
        if (!prev || prev.conversation.id !== conversationId) return prev
        return {
          ...prev,
          conversation: { ...prev.conversation, title: trimmed },
        }
      })
      setHistoryRefreshKey((k) => k + 1)
      return true
    } catch (err) {
      setError(String(err))
      return false
    }
  }

  async function handleRemoveConversation(conversationId: string): Promise<boolean> {
    setError('')
    try {
      const res = await window.electronAPI.hideConversation(conversationId)
      if (!res.success) {
        setError(res.error || 'Failed to remove conversation from sidebar')
        return false
      }

      if (activeConversationId === conversationId) {
        handleNewChat()
      }
      setHistoryRefreshKey((k) => k + 1)
      return true
    } catch (err) {
      setError(String(err))
      return false
    }
  }

  function handleNewChat() {
    setActiveConversationId(null); setConversationData(null); setInThreadProvider(null)
    setInThreadDrafts({}); setLockedProviders(null); setSelectedProviders(getLastUsedProviders()); setError('')
  }

  async function handleInThreadSubmit(prompt: string) {
    if (!activeConversationId || !inThreadProvider) return
    setBusyConversationId(activeConversationId); setError(''); setInThreadDrafts((prev) => ({ ...prev, [inThreadProvider]: '' }))
    try {
      const res = await window.electronAPI.sendSingleProviderMessage(activeConversationId, prompt, inThreadProvider)
      if (res.success && res.data) {
        queryToConvRef.current.set(res.data.queryId, { conversationId: activeConversationId, providers: [inThreadProvider] })
        const pendingTurn: TurnData = { queryId: res.data.queryId, prompt: res.data.prompt, createdAt: res.data.createdAt, results: [{ id: `pending-${inThreadProvider}`, provider: inThreadProvider, status: 'pending' }] }
        setConversationData((prev) => prev ? { ...prev, turns: [...prev.turns, pendingTurn] } : prev)
      } else { setError(res.error || 'Unknown error'); setBusyConversationId(null) }
    } catch (err) { setError(String(err)); setBusyConversationId(null) }
  }

  return (
    <div className="app-layout">
      {sidebarCollapsed && (
        <button className="sidebar-open-btn" onClick={() => setSidebarCollapsed(false)} title={ts(lang, 'sidebar.open')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
      )}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-top-row">
          <button className="new-chat-sidebar-btn" onClick={handleNewChat} title={ts(lang, 'sidebar.newChat')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button
              className="lang-toggle"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              title={lang === 'en' ? '切换中文' : 'Switch to English'}
            >
              {lang === 'en' ? '文' : 'En'}
            </button>
            <ThemePicker />
            <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(true)} title={ts(lang, 'sidebar.close')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            </button>
          </div>
        </div>
        <HistoryList
          onSelect={handleSelectConversation}
          onRename={handleRenameConversation}
          onRemove={handleRemoveConversation}
          selectedConversationId={activeConversationId}
          refreshKey={historyRefreshKey}
          busyConversationId={busyConversationId}
        />
      </aside>

      <main className="main-content">
        {error && <div className="error-box">{error}</div>}

        {conversationData && conversationData.turns.length > 0 ? (
          <>
            <div className="conversation-thread">
              {conversationData.turns.map((turn, turnIndex) => {
                const isLastTurn = turnIndex === conversationData.turns.length - 1
                return (
                  <div key={turn.queryId} className="turn-block">
                    <div className="turn-prompt">
                      <span className="turn-role">{ts(lang, 'turn.you')}</span>
                      {turn.results.length === 1 && (
                        <span className="turn-target">{ts(lang, 'turn.to')} {turn.results[0].provider}</span>
                      )}
                      <span className="turn-time">{new Date(turn.createdAt).toLocaleTimeString()}</span>
                      <CollapsiblePrompt text={turn.prompt} />
                    </div>
                    <TabbedResults
                      results={turn.results}
                      autoCollapse={!isLastTurn}
                      onStartInThread={(provider) => setInThreadProvider((prev) => prev === provider ? null : provider)}
                      inThreadProvider={inThreadProvider}
                      onRegenerate={isLastTurn ? (provider) => {
                        if (!activeConversationId) return
                        queryToConvRef.current.set(turn.queryId, { conversationId: activeConversationId, providers: turn.results.map((r) => r.provider) })
                        setConversationData((prev) => {
                          if (!prev) return prev
                          return { ...prev, turns: prev.turns.map((t) => {
                            if (t.queryId !== turn.queryId) return t
                            const pendingResult = { id: `pending-${provider}`, provider, status: 'pending' as const, contentText: undefined, errorMessage: undefined, latencyMs: undefined, conversationUrl: undefined, userRating: undefined as 'good' | 'bad' | null | undefined }
                            return { ...t, results: [...t.results.filter((r) => r.provider !== provider), pendingResult] }
                          }) }
                        })
                        window.electronAPI.regenerateProvider(turn.queryId, provider, activeConversationId)
                      } : undefined}
                    />
                  </div>
                )
              })}
              <div ref={turnsEndRef} />
            </div>
            {inThreadProvider ? (
              <InThreadInput provider={inThreadProvider} onSubmit={handleInThreadSubmit} disabled={busy}
                draft={inThreadDrafts[inThreadProvider] || ''}
                onDraftChange={(text) => setInThreadDrafts((prev) => ({ ...prev, [inThreadProvider!]: text }))}
                onDeactivate={() => setInThreadProvider(null)} />
            ) : (
              <QueryInput onSubmit={handleSubmit} disabled={busy} busy={busy} />
            )}
          </>
        ) : (
          <div className="welcome-view">
            <h1>{ts(lang, 'app.title')}</h1>
            {!busy && (
              <>
                <p className="welcome-subtitle">{ts(lang, 'app.subtitle')}</p>
                <LlmSelector selectedProviders={selectedProviders} onProvidersChange={setSelectedProviders} disabled={busy} />
              </>
            )}
            <QueryInput onSubmit={handleSubmit} disabled={busy || selectedProviders.length === 0} busy={busy} />
          </div>
        )}

      </main>
    </div>
  )
}

export default App
