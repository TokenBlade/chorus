/**
 * Dev-only script to verify the database layer works.
 * Run with: npx tsx scripts/verify-db.ts
 * Safe to delete once Phase 2 is confirmed working.
 */
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

const dbDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const dbPath = path.join(dbDir, 'app.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Import schema creation inline (can't use electron imports here)
db.exec(`
  CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS provider_results (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    finished_at TEXT,
    latency_ms INTEGER,
    content_text TEXT,
    conversation_url TEXT,
    error_message TEXT,
    FOREIGN KEY (query_id) REFERENCES queries(id)
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    provider_result_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    tags_json TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (provider_result_id) REFERENCES provider_results(id)
  )
`)

console.log('✓ Database created at:', dbPath)

// Verify tables exist
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
console.log('✓ Tables:', tables.map((t) => t.name).join(', '))

// Insert and fetch a test query
const testId = crypto.randomUUID()
const testPrompt = 'Hello from verify-db script'
const testTime = new Date().toISOString()

db.prepare('INSERT INTO queries (id, prompt, created_at) VALUES (?, ?, ?)').run(testId, testPrompt, testTime)
const row = db.prepare('SELECT * FROM queries WHERE id = ?').get(testId) as { id: string; prompt: string; created_at: string }
console.log('✓ Insert + fetch query:', row.id, '|', row.prompt)

// Insert a provider result
const resultId = crypto.randomUUID()
db.prepare('INSERT INTO provider_results (id, query_id, provider, status) VALUES (?, ?, ?, ?)').run(resultId, testId, 'claude', 'completed')
const resultRow = db.prepare('SELECT * FROM provider_results WHERE query_id = ?').get(testId) as { id: string; provider: string; status: string }
console.log('✓ Insert + fetch result:', resultRow.provider, '|', resultRow.status)

// Insert a rating
const ratingId = crypto.randomUUID()
db.prepare('INSERT INTO ratings (id, provider_result_id, score, tags_json, created_at) VALUES (?, ?, ?, ?, ?)').run(ratingId, resultId, 4, '["good","fast"]', testTime)
const ratingRow = db.prepare('SELECT * FROM ratings WHERE provider_result_id = ?').get(resultId) as { score: number; tags_json: string }
console.log('✓ Insert + fetch rating: score', ratingRow.score, '| tags', ratingRow.tags_json)

// Cleanup test data
db.prepare('DELETE FROM ratings WHERE id = ?').run(ratingId)
db.prepare('DELETE FROM provider_results WHERE id = ?').run(resultId)
db.prepare('DELETE FROM queries WHERE id = ?').run(testId)
console.log('✓ Test data cleaned up')

db.close()
console.log('\n✅ All database verifications passed!')
