export type ProviderName =
  | 'chatgpt' | 'claude' | 'gemini'
  | 'deepseek' | 'moonshot' | 'zai'

export type ProviderStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'timeout'
  | 'failed'

export type UserRating = 'good' | 'bad' | null

export type ProviderResult = {
  id: string
  queryId: string
  provider: ProviderName
  status: ProviderStatus
  startedAt?: string
  finishedAt?: string
  latencyMs?: number
  contentText?: string
  conversationUrl?: string
  errorMessage?: string
  userRating?: UserRating
  viewed?: boolean
}

export const ALL_PROVIDERS: { id: ProviderName; label: string; url: string; color: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com', color: '#10a37f' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai', color: '#c96442' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', color: '#4285f4' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com', color: '#5b6ef7' },
  { id: 'moonshot', label: 'Moonshot AI', url: 'https://kimi.com', color: '#6c5ce7' },
  { id: 'zai', label: 'Z.AI', url: 'https://chat.z.ai', color: '#e17055' },
]
