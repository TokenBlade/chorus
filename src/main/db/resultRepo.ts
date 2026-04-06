import crypto from 'crypto'
import { getDb } from './db'
import type { ProviderResult } from '../types/provider'

type CreateProviderResultInput = Pick<ProviderResult, 'queryId' | 'provider' | 'status'>

type CreateFullProviderResultInput = Omit<ProviderResult, 'id'>

type UpdateProviderResultPatch = Partial<
  Pick<ProviderResult, 'status' | 'startedAt' | 'finishedAt' | 'latencyMs' | 'contentText' | 'conversationUrl' | 'errorMessage' | 'userRating' | 'viewed'>
>

export function createProviderResult(input: CreateProviderResultInput): ProviderResult {
  const db = getDb()
  const id = crypto.randomUUID()

  db.prepare(
    'INSERT INTO provider_results (id, query_id, provider, status) VALUES (?, ?, ?, ?)'
  ).run(id, input.queryId, input.provider, input.status)

  return { id, ...input }
}

export function createFullProviderResult(input: CreateFullProviderResultInput): ProviderResult {
  const db = getDb()
  const id = crypto.randomUUID()

  db.prepare(
    `INSERT INTO provider_results (id, query_id, provider, status, started_at, finished_at, latency_ms, content_text, conversation_url, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.queryId, input.provider, input.status,
    input.startedAt ?? null, input.finishedAt ?? null, input.latencyMs ?? null,
    input.contentText ?? null, input.conversationUrl ?? null, input.errorMessage ?? null
  )

  return { id, ...input }
}

export function updateProviderResult(id: string, patch: UpdateProviderResultPatch): void {
  const db = getDb()
  const fields: string[] = []
  const values: unknown[] = []

  const columnMap: Record<string, string> = {
    status: 'status',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    latencyMs: 'latency_ms',
    contentText: 'content_text',
    conversationUrl: 'conversation_url',
    errorMessage: 'error_message',
    userRating: 'user_rating',
    viewed: 'viewed',
  }

  for (const [key, col] of Object.entries(columnMap)) {
    const val = (patch as Record<string, unknown>)[key]
    if (val !== undefined) {
      fields.push(`${col} = ?`)
      values.push(val)
    }
  }

  if (fields.length === 0) return

  values.push(id)
  db.prepare(`UPDATE provider_results SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteResultsByQueryAndProvider(queryId: string, provider: string): void {
  const db = getDb()
  db.prepare('DELETE FROM provider_results WHERE query_id = ? AND provider = ?').run(queryId, provider)
}

export function listResultsByQuery(queryId: string): ProviderResult[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM provider_results WHERE query_id = ?').all(queryId) as {
    id: string
    query_id: string
    provider: string
    status: string
    started_at: string | null
    finished_at: string | null
    latency_ms: number | null
    content_text: string | null
    conversation_url: string | null
    error_message: string | null
    user_rating: string | null
    viewed: number | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    queryId: row.query_id,
    provider: row.provider as ProviderResult['provider'],
    status: row.status as ProviderResult['status'],
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
    contentText: row.content_text ?? undefined,
    conversationUrl: row.conversation_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    userRating: (row.user_rating as ProviderResult['userRating']) ?? undefined,
    viewed: row.viewed === 1,
  }))
}
