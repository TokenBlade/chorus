import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { ts } from '../i18n/translations'

type ConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

type Props = {
  onSelect: (conversationId: string) => void
  onRename: (conversationId: string, title: string) => Promise<boolean>
  onRemove: (conversationId: string) => Promise<boolean>
  selectedConversationId: string | null
  refreshKey: number
  busyConversationId?: string | null
}

export default function HistoryList({
  onSelect,
  onRename,
  onRemove,
  selectedConversationId,
  refreshKey,
  busyConversationId,
}: Props) {
  const { lang } = useLang()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [savingRename, setSavingRename] = useState(false)
  const [removingConversationId, setRemovingConversationId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    window.electronAPI.listConversations().then((res) => {
      if (res.success && res.data) {
        setConversations(res.data)
      }
    })
  }, [refreshKey])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuConversationId(null)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuConversationId(null)
        if (!savingRename) {
          setEditingConversationId(null)
          setRenameDraft('')
        }
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [savingRename])

  useEffect(() => {
    if (editingConversationId) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [editingConversationId])

  function startRename(conversation: ConversationSummary) {
    setMenuConversationId(null)
    setEditingConversationId(conversation.id)
    setRenameDraft(conversation.title)
  }

  function cancelRename() {
    if (savingRename) return
    setEditingConversationId(null)
    setRenameDraft('')
  }

  async function submitRename(conversationId: string) {
    const trimmed = renameDraft.trim()
    if (!trimmed) {
      cancelRename()
      return
    }

    setSavingRename(true)
    const success = await onRename(conversationId, trimmed)
    setSavingRename(false)
    if (success) {
      setEditingConversationId(null)
      setRenameDraft('')
    }
  }

  async function handleRemove(conversationId: string) {
    setMenuConversationId(null)
    setRemovingConversationId(conversationId)
    const success = await onRemove(conversationId)
    setRemovingConversationId((prev) => (prev === conversationId ? null : prev))
    if (success && editingConversationId === conversationId) {
      setEditingConversationId(null)
      setRenameDraft('')
    }
  }

  return (
    <div className="history-list">
      {conversations.length === 0 ? (
        <div className="history-empty">{ts(lang, 'sidebar.noConversations')}</div>
      ) : (
        <div className="history-items">
          {conversations.map((conversation) => {
            const isActive = conversation.id === selectedConversationId
            const isEditing = conversation.id === editingConversationId
            const menuOpen = conversation.id === menuConversationId
            const isRemoving = conversation.id === removingConversationId

            return (
              <div
                key={conversation.id}
                className={`history-item-row ${isActive ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`}
              >
                {isEditing ? (
                  <div className="history-item history-item-editing">
                    <input
                      ref={renameInputRef}
                      className="history-rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      placeholder={ts(lang, 'sidebar.renamePlaceholder')}
                      maxLength={120}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void submitRename(conversation.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelRename()
                        }
                      }}
                    />
                    <div className="history-edit-actions">
                      <button
                        className="history-edit-btn"
                        onClick={() => void submitRename(conversation.id)}
                        disabled={savingRename}
                      >
                        {ts(lang, 'sidebar.renameSave')}
                      </button>
                      <button
                        className="history-edit-btn ghost"
                        onClick={cancelRename}
                        disabled={savingRename}
                      >
                        {ts(lang, 'sidebar.renameCancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`history-item ${isActive ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(conversation.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(conversation.id)
                      }
                    }}
                  >
                    <div className="history-item-main">
                      <div className="history-item-prompt">
                        {conversation.id === busyConversationId && <span className="history-busy-dot" />}
                        {conversation.title}
                      </div>
                      <div className="history-item-time">
                        {new Date(conversation.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="history-item-actions" ref={menuOpen ? menuRef : null}>
                      <button
                        className={`history-more-btn ${menuOpen ? 'visible' : ''}`}
                        title={ts(lang, 'sidebar.more')}
                        aria-label={ts(lang, 'sidebar.more')}
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuConversationId((prev) => (prev === conversation.id ? null : conversation.id))
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </button>
                      {menuOpen && (
                        <div className="history-item-menu" onClick={(e) => e.stopPropagation()}>
                          <button className="history-item-menu-action" onClick={() => startRename(conversation)}>
                            {ts(lang, 'sidebar.rename')}
                          </button>
                          <button
                            className="history-item-menu-action danger"
                            onClick={() => void handleRemove(conversation.id)}
                            disabled={isRemoving}
                          >
                            {ts(lang, 'sidebar.remove')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
