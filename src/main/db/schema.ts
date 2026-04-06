import type Database from 'better-sqlite3'

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_provider_threads (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      thread_url TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      UNIQUE(conversation_id, provider)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      conversation_id TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
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

  // Migrations
  migrateQueries(db)
  migrateProviderResults(db)
}

function migrateQueries(db: Database.Database): void {
  // Check if queries table has conversation_id column
  const columns = db.pragma('table_info(queries)') as { name: string }[]
  const hasConversationId = columns.some((c) => c.name === 'conversation_id')

  if (!hasConversationId) {
    console.log('[Schema] Migrating queries table: adding conversation_id column')
    db.exec('ALTER TABLE queries ADD COLUMN conversation_id TEXT')
  }

  // Migrate orphaned queries (no conversation_id) into individual conversations
  const orphans = db.prepare(
    'SELECT id, prompt, created_at FROM queries WHERE conversation_id IS NULL'
  ).all() as { id: string; prompt: string; created_at: string }[]

  if (orphans.length > 0) {
    console.log(`[Schema] Migrating ${orphans.length} orphaned queries into conversations`)
    const crypto = require('crypto')

    const insertConv = db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    )
    const updateQuery = db.prepare(
      'UPDATE queries SET conversation_id = ? WHERE id = ?'
    )

    const migrate = db.transaction(() => {
      for (const q of orphans) {
        const convId = crypto.randomUUID()
        const title = q.prompt.slice(0, 60) + (q.prompt.length > 60 ? '...' : '')
        insertConv.run(convId, title, q.created_at, q.created_at)
        updateQuery.run(convId, q.id)
      }
    })
    migrate()
    console.log('[Schema] Migration complete')
  }
}

function migrateProviderResults(db: Database.Database): void {
  const columns = db.pragma('table_info(provider_results)') as { name: string }[]
  const colNames = columns.map((c) => c.name)

  if (!colNames.includes('user_rating')) {
    console.log('[Schema] Migrating provider_results: adding user_rating column')
    db.exec("ALTER TABLE provider_results ADD COLUMN user_rating TEXT DEFAULT NULL")
  }

  if (!colNames.includes('viewed')) {
    console.log('[Schema] Migrating provider_results: adding viewed column')
    db.exec("ALTER TABLE provider_results ADD COLUMN viewed INTEGER DEFAULT 0")
  }
}
