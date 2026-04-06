import type { ProviderName } from './provider'

export type ConversationRecord = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type ConversationProviderThread = {
  id: string
  conversationId: string
  provider: ProviderName
  threadUrl: string | null
}
