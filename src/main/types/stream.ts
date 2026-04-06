import type { ProviderName } from './provider'

export type StreamEvent =
  | { type: 'started'; queryId: string; provider: ProviderName }
  | { type: 'thinking-delta'; queryId: string; provider: ProviderName; text: string }
  | { type: 'delta'; queryId: string; provider: ProviderName; text: string }
  | {
      type: 'completed'
      queryId: string
      provider: ProviderName
      resultId: string
      text: string
      thinkingText?: string
      conversationUrl?: string
      latencyMs: number
      startedAt: string
      finishedAt: string
    }
  | {
      type: 'error'
      queryId: string
      provider: ProviderName
      error: string
      status: 'failed' | 'timeout'
      startedAt: string
      finishedAt: string
    }
  | { type: 'turn-complete'; queryId: string }
