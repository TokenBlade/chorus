import type { BrowserContext, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { ProviderName } from '../types/provider'
import { ALL_PROVIDERS } from '../types/provider'

// Use require() to avoid electron-vite bundling issues (same pattern as better-sqlite3)
const { chromium } = require('playwright')

const PROVIDER_URLS: Record<ProviderName, string> = Object.fromEntries(
  ALL_PROVIDERS.map((p) => [p.id, p.url])
) as Record<ProviderName, string>

// Single shared browser context — all providers share one browser window as tabs.
// Cookies/localStorage are domain-scoped, so login sessions don't interfere.
let sharedContext: BrowserContext | null = null

// Serialization lock: when a launch is in progress, concurrent callers await this
// promise instead of trying to launch a second browser (which would fail with
// "Failed to create a ProcessSingleton for your profile directory").
let contextLaunchPromise: Promise<BrowserContext> | null = null

const pages: Partial<Record<ProviderName, Page>> = {}

// Per-provider locks to prevent concurrent operations on the same tab.
// When a provider is locked, subsequent operations wait for the lock to release.
const providerLocks: Partial<Record<ProviderName, Promise<void>>> = {}

/**
 * Acquire an exclusive lock for a provider. Returns a release function.
 * While locked, other callers of acquireProviderLock() for the same provider
 * will wait until the lock is released.
 */
export async function acquireProviderLock(provider: ProviderName): Promise<() => void> {
  // Wait for any existing lock on this provider
  while (providerLocks[provider]) {
    await providerLocks[provider]
  }

  // Create a new lock
  let releaseFn: () => void
  providerLocks[provider] = new Promise<void>((resolve) => {
    releaseFn = () => {
      delete providerLocks[provider]
      resolve()
    }
  })

  return releaseFn!
}

function getProfileDir(): string {
  return path.join(app.getAppPath(), 'profiles', 'shared')
}

function cleanStaleLock(profileDir: string): void {
  const lockFile = path.join(profileDir, 'SingletonLock')
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile)
      console.log('[BrowserSession] Removed stale SingletonLock')
    }
  } catch (err) {
    console.warn('[BrowserSession] Could not remove SingletonLock:', err)
  }
}

/**
 * Check if the existing browser context is still usable.
 * The browser process may have crashed or been killed externally.
 */
async function isContextAlive(): Promise<boolean> {
  if (!sharedContext) return false
  try {
    // Attempt a lightweight operation — if browser is dead this will throw
    await sharedContext.pages()
    return true
  } catch {
    return false
  }
}

async function ensureContext(): Promise<BrowserContext> {
  // If we have a context, verify it's still alive
  if (sharedContext) {
    if (await isContextAlive()) return sharedContext
    // Browser crashed — reset state and relaunch
    console.warn('[BrowserSession] Browser context is dead, relaunching...')
    sharedContext = null
    contextLaunchPromise = null
    for (const key of Object.keys(pages) as ProviderName[]) {
      delete pages[key]
    }
  }

  // If another caller is already launching, wait for that instead of launching again
  if (contextLaunchPromise) {
    return contextLaunchPromise
  }

  contextLaunchPromise = (async () => {
    const profileDir = getProfileDir()
    cleanStaleLock(profileDir)
    console.log(`[BrowserSession] Launching shared browser with profile: ${profileDir}`)

    sharedContext = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    })

    console.log('[BrowserSession] Shared browser launched')
    return sharedContext
  })()

  try {
    return await contextLaunchPromise
  } finally {
    contextLaunchPromise = null
  }
}

async function openTab(provider: ProviderName): Promise<Page> {
  const context = await ensureContext()
  const url = PROVIDER_URLS[provider]

  console.log(`[BrowserSession] Opening tab for ${provider}: ${url}`)

  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

  pages[provider] = page
  console.log(`[BrowserSession] ${provider} tab ready`)
  return page
}

export async function initializeProvider(provider: ProviderName): Promise<void> {
  const existing = pages[provider]
  if (existing && !existing.isClosed()) {
    console.log(`[BrowserSession] ${provider} already initialized, skipping`)
    return
  }
  // Tab was closed or never opened — (re)open it
  if (existing) {
    console.log(`[BrowserSession] ${provider} tab was closed, reopening`)
    delete pages[provider]
  }
  await openTab(provider)
}

/**
 * Get the page for a provider, automatically reopening the tab if it was closed.
 */
export async function ensurePage(provider: ProviderName): Promise<Page> {
  const existing = pages[provider]
  if (existing && !existing.isClosed()) {
    return existing
  }
  // Tab was closed or never opened — (re)open it
  console.log(`[BrowserSession] ${provider} tab not available, reopening`)
  delete pages[provider]
  return openTab(provider)
}

/**
 * Get the page synchronously (for adapters that store the page reference at creation).
 * Throws if the tab doesn't exist. Prefer ensurePage() for resilient access.
 */
export function getPage(provider: ProviderName): Page {
  const page = pages[provider]
  if (!page || page.isClosed()) {
    throw new Error(`[BrowserSession] No active tab for ${provider}. Call initializeProvider() first.`)
  }
  return page
}

export function isInitialized(provider: ProviderName): boolean {
  const page = pages[provider]
  return !!page && !page.isClosed()
}

export async function closeAll(): Promise<void> {
  console.log('[BrowserSession] Closing shared browser...')
  contextLaunchPromise = null

  if (sharedContext) {
    try {
      await sharedContext.close()
      console.log('[BrowserSession] Shared browser closed')
    } catch (err) {
      console.error('[BrowserSession] Error closing shared browser:', err)
    }
    sharedContext = null
  }

  // Clear all page references
  for (const key of Object.keys(pages) as ProviderName[]) {
    delete pages[key]
  }

  console.log('[BrowserSession] All sessions cleaned up')
}
