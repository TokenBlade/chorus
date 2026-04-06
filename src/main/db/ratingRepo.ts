import crypto from 'crypto'
import { getDb } from './db'
import type { RatingRecord } from '../types/rating'

type SaveRatingInput = Pick<RatingRecord, 'providerResultId' | 'score' | 'tags'> & {
  note?: string
}

export function saveRating(input: SaveRatingInput): RatingRecord {
  const db = getDb()
  const tagsJson = JSON.stringify(input.tags)
  const now = new Date().toISOString()

  // Upsert: if a rating already exists for this provider result, update it
  const existing = db.prepare(
    'SELECT id FROM ratings WHERE provider_result_id = ? LIMIT 1'
  ).get(input.providerResultId) as { id: string } | undefined

  if (existing) {
    db.prepare(
      'UPDATE ratings SET score = ?, tags_json = ?, note = ?, created_at = ? WHERE id = ?'
    ).run(input.score, tagsJson, input.note ?? null, now, existing.id)
    return { id: existing.id, providerResultId: input.providerResultId, score: input.score, tags: input.tags, note: input.note, createdAt: now }
  }

  const id = crypto.randomUUID()
  db.prepare(
    'INSERT INTO ratings (id, provider_result_id, score, tags_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, input.providerResultId, input.score, tagsJson, input.note ?? null, now)

  return { id, providerResultId: input.providerResultId, score: input.score, tags: input.tags, note: input.note, createdAt: now }
}

export function getRatingForResult(providerResultId: string): RatingRecord | undefined {
  const db = getDb()
  const row = db.prepare(
    'SELECT * FROM ratings WHERE provider_result_id = ? LIMIT 1'
  ).get(providerResultId) as {
    id: string
    provider_result_id: string
    score: number
    tags_json: string | null
    note: string | null
    created_at: string
  } | undefined

  if (!row) return undefined
  return {
    id: row.id,
    providerResultId: row.provider_result_id,
    score: row.score,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    note: row.note ?? undefined,
    createdAt: row.created_at,
  }
}

export function getRatingsForResult(providerResultId: string): RatingRecord[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM ratings WHERE provider_result_id = ? ORDER BY created_at DESC').all(providerResultId) as {
    id: string
    provider_result_id: string
    score: number
    tags_json: string | null
    note: string | null
    created_at: string
  }[]

  return rows.map((row) => ({
    id: row.id,
    providerResultId: row.provider_result_id,
    score: row.score,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    note: row.note ?? undefined,
    createdAt: row.created_at
  }))
}
