import crypto from 'crypto'
import { getDb } from './db'
import type { QueryRecord } from '../types/query'

export function createQuery(prompt: string, conversationId?: string): QueryRecord {
  const db = getDb()
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  db.prepare(
    'INSERT INTO queries (id, prompt, created_at, conversation_id) VALUES (?, ?, ?, ?)'
  ).run(id, prompt, createdAt, conversationId ?? null)

  return { id, prompt, createdAt, conversationId }
}

export function getQuery(id: string): QueryRecord | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM queries WHERE id = ?').get(id) as
    | { id: string; prompt: string; created_at: string; conversation_id: string | null }
    | undefined

  if (!row) return undefined
  return {
    id: row.id,
    prompt: row.prompt,
    createdAt: row.created_at,
    conversationId: row.conversation_id ?? undefined,
  }
}

export function listQueries(): QueryRecord[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM queries ORDER BY created_at DESC').all() as {
    id: string
    prompt: string
    created_at: string
    conversation_id: string | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    createdAt: row.created_at,
    conversationId: row.conversation_id ?? undefined,
  }))
}

export function listQueriesByConversation(conversationId: string): QueryRecord[] {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM queries WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as {
    id: string
    prompt: string
    created_at: string
    conversation_id: string | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    createdAt: row.created_at,
    conversationId: row.conversation_id ?? undefined,
  }))
}
