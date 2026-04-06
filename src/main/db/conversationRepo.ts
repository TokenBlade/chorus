import crypto from 'crypto'
import { getDb } from './db'
import type { ConversationRecord, ConversationProviderThread } from '../types/conversation'
import type { ProviderName } from '../types/provider'

export function createConversation(title: string): ConversationRecord {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, title, now, now)

  return { id, title, createdAt: now, updatedAt: now }
}

export function getConversation(id: string): ConversationRecord | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | { id: string; title: string; created_at: string; updated_at: string }
    | undefined

  if (!row) return undefined
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function listConversations(): ConversationRecord[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as {
    id: string
    title: string
    created_at: string
    updated_at: string
  }[]

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function updateConversationTitle(id: string, title: string): void {
  const db = getDb()
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, new Date().toISOString(), id)
}

export function touchConversation(id: string): void {
  const db = getDb()
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id)
}

export function getProviderThreads(conversationId: string): ConversationProviderThread[] {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM conversation_provider_threads WHERE conversation_id = ?'
  ).all(conversationId) as {
    id: string
    conversation_id: string
    provider: string
    thread_url: string | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    provider: row.provider as ProviderName,
    threadUrl: row.thread_url,
  }))
}

export function upsertProviderThread(
  conversationId: string,
  provider: ProviderName,
  threadUrl: string
): void {
  const db = getDb()
  const existing = db.prepare(
    'SELECT id FROM conversation_provider_threads WHERE conversation_id = ? AND provider = ?'
  ).get(conversationId, provider) as { id: string } | undefined

  if (existing) {
    db.prepare(
      'UPDATE conversation_provider_threads SET thread_url = ? WHERE id = ?'
    ).run(threadUrl, existing.id)
  } else {
    const id = crypto.randomUUID()
    db.prepare(
      'INSERT INTO conversation_provider_threads (id, conversation_id, provider, thread_url) VALUES (?, ?, ?, ?)'
    ).run(id, conversationId, provider, threadUrl)
  }
}
