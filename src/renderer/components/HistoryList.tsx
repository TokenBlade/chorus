import { useState, useEffect } from 'react'
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
  onNewChat: () => void
  selectedConversationId: string | null
  refreshKey: number
  busyConversationId?: string | null
}

export default function HistoryList({ onSelect, onNewChat, selectedConversationId, refreshKey, busyConversationId }: Props) {
  const { lang } = useLang()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])

  useEffect(() => {
    window.electronAPI.listConversations().then((res) => {
      if (res.success && res.data) {
        setConversations(res.data)
      }
    })
  }, [refreshKey])

  return (
    <div className="history-list">
      {conversations.length === 0 ? (
        <div className="history-empty">{ts(lang, 'sidebar.noConversations')}</div>
      ) : (
        <div className="history-items">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`history-item ${c.id === selectedConversationId ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="history-item-prompt">
                {c.id === busyConversationId && <span className="history-busy-dot" />}
                {c.title}
              </div>
              <div className="history-item-time">
                {new Date(c.updatedAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
