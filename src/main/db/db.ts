import type BetterSqlite3 from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { createTables } from './schema'

// Use require() to load native module — avoids electron-vite bundling issues
const Database: typeof BetterSqlite3 = require('better-sqlite3')

let db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (db) return db

  const dbDir = path.join(app.getPath('userData'), 'data')
  const dbPath = path.join(dbDir, 'app.db')
  fs.mkdirSync(dbDir, { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createTables(db)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
