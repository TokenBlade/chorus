import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { getDb, closeDb } from './db/db'
import { closeAll, isInitialized, initializeProvider } from './services/browserSessionManager'
import { adapterFactories, runAllProvidersStreaming, runSingleProviderStreaming, regenerateProviderStreaming } from './services/orchestrator'
import { createQuery, listQueriesByConversation } from './db/queryRepo'
import { createFullProviderResult, listResultsByQuery, updateProviderResult, deleteResultsByQueryAndProvider } from './db/resultRepo'
import { saveRating, getRatingForResult } from './db/ratingRepo'
import {
  createConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
  touchConversation,
  getProviderThreads,
  upsertProviderThread,
} from './db/conversationRepo'
import type { ProviderName } from './types/provider'
import type { StreamEvent } from './types/stream'

let mainWindow: BrowserWindow | null = null

function sendStreamEvent(event: StreamEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('provider-stream-event', event)
  }
}

/**
 * Create an onEvent callback that persists results to DB and forwards to renderer.
 * Shared by all streaming IPC handlers to avoid duplication.
 */
function createStreamHandler(queryId: string, conversationId: string): (event: StreamEvent) => void {
  return (event: StreamEvent) => {
    if (event.type === 'completed') {
      const saved = createFullProviderResult({
        queryId,
        provider: event.provider,
        status: 'completed',
        startedAt: event.startedAt,
        finishedAt: event.finishedAt,
        latencyMs: event.latencyMs,
        contentText: event.text,
        conversationUrl: event.conversationUrl,
        errorMessage: undefined,
      })
      sendStreamEvent({ ...event, resultId: saved.id })
      if (event.conversationUrl) {
        upsertProviderThread(conversationId, event.provider, event.conversationUrl)
      }
    } else if (event.type === 'error') {
      createFullProviderResult({
        queryId,
        provider: event.provider,
        status: event.status,
        startedAt: event.startedAt,
        finishedAt: event.finishedAt,
        latencyMs: 0,
        contentText: undefined,
        conversationUrl: undefined,
        errorMessage: event.error,
      })
      sendStreamEvent(event)
    } else if (event.type === 'turn-complete') {
      touchConversation(conversationId)
      sendStreamEvent(event)
    } else {
      sendStreamEvent(event)
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  // --- Create a new conversation ---
  ipcMain.handle('create-conversation', async (_event, title?: string) => {
    try {
      const conv = createConversation(title || 'New Chat')
      console.log(`[IPC] Created conversation ${conv.id}: "${conv.title}"`)
      return { success: true, data: conv }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[IPC] create-conversation failed:', message)
      return { success: false, error: message }
    }
  })

  // --- List all conversations ---
  ipcMain.handle('list-conversations', async () => {
    try {
      const conversations = listConversations()
      return { success: true, data: conversations }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[IPC] list-conversations failed:', message)
      return { success: false, error: message }
    }
  })

  // --- Get full conversation details (all turns + results + ratings) ---
  ipcMain.handle('get-conversation-details', async (_event, conversationId: string) => {
    try {
      const conv = getConversation(conversationId)
      if (!conv) {
        return { success: false, error: `Conversation ${conversationId} not found` }
      }

      const queries = listQueriesByConversation(conversationId)
      const turns = queries.map((q) => {
        const results = listResultsByQuery(q.id)
        const resultsWithRatings = results.map((r) => {
          const rating = getRatingForResult(r.id)
          return {
            id: r.id,
            provider: r.provider,
            status: r.status,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            latencyMs: r.latencyMs,
            contentText: r.contentText,
            conversationUrl: r.conversationUrl,
            errorMessage: r.errorMessage,
            rating: rating
              ? { score: rating.score, tags: rating.tags, note: rating.note, createdAt: rating.createdAt }
              : undefined,
          }
        })
        return {
          queryId: q.id,
          prompt: q.prompt,
          createdAt: q.createdAt,
          results: resultsWithRatings,
        }
      })

      return {
        success: true,
        data: {
          conversation: conv,
          turns,
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[IPC] get-conversation-details failed:', message)
      return { success: false, error: message }
    }
  })

  // --- Send a message within a conversation (streaming) ---
  ipcMain.handle('send-message-in-conversation', async (_event, conversationId: string, prompt: string, providers?: string[]) => {
    try {
      // Look up conversation
      const conv = getConversation(conversationId)
      if (!conv) {
        return { success: false, error: `Conversation ${conversationId} not found` }
      }

      // Get existing provider thread URLs
      const threads = getProviderThreads(conversationId)
      const threadMap = new Map<ProviderName, string | null>()
      for (const t of threads) {
        threadMap.set(t.provider, t.threadUrl)
      }

      // Create query record
      const query = createQuery(prompt, conversationId)
      console.log(`[IPC] Created query ${query.id} in conversation ${conversationId}`)

      // Auto-set title from first prompt if still default
      if (conv.title === 'New Chat') {
        const title = prompt.slice(0, 60) + (prompt.length > 60 ? '...' : '')
        updateConversationTitle(conversationId, title)
      }

      // Providers must be explicitly selected — no hardcoded defaults
      const activeProviders = (providers ?? []) as ProviderName[]
      if (activeProviders.length === 0) {
        return { success: false, error: 'No providers selected' }
      }

      const onEvent = createStreamHandler(query.id, conversationId)

      // Fire off streaming orchestrator in background (not awaited)
      runAllProvidersStreaming(prompt, threadMap, activeProviders, query.id, onEvent).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[IPC] Streaming orchestrator failed:', message)
        // Notify renderer so it doesn't hang on a spinner forever
        sendStreamEvent({ type: 'turn-complete', queryId: query.id })
      })

      // Return immediately with queryId
      return {
        success: true,
        data: {
          queryId: query.id,
          prompt: query.prompt,
          createdAt: query.createdAt,
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[IPC] send-message-in-conversation failed:', message)
      return { success: false, error: message }
    }
  })

  // --- Send a message to a single provider (in-thread follow-up) ---
  ipcMain.handle('send-single-provider-message', async (_event, conversationId: string, prompt: string, provider: string) => {
    try {
      const conv = getConversation(conversationId)
      if (!conv) return { success: false, error: 'Conversation not found' }

      const threads = getProviderThreads(conversationId)
      const thread = threads.find((t) => t.provider === provider)
      const threadUrl = thread?.threadUrl ?? null

      const query = createQuery(prompt, conversationId)
      console.log(`[IPC] In-thread message to ${provider}: query ${query.id}`)

      const onEvent = createStreamHandler(query.id, conversationId)

      runSingleProviderStreaming(
        provider as ProviderName, prompt, threadUrl, query.id, onEvent
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] send-single-provider-message failed: ${message}`)
        sendStreamEvent({ type: 'turn-complete', queryId: query.id })
      })

      return {
        success: true,
        data: { queryId: query.id, prompt: query.prompt, createdAt: query.createdAt },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // --- Rename a conversation ---
  ipcMain.handle('rename-conversation', async (_event, conversationId: string, title: string) => {
    try {
      updateConversationTitle(conversationId, title)
      console.log(`[IPC] Renamed conversation ${conversationId} to "${title}"`)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[IPC] rename-conversation failed:', message)
      return { success: false, error: message }
    }
  })

  // --- Save or update a rating for a provider result ---
  ipcMain.handle('save-provider-rating', async (_event, input: {
    providerResultId: string
    score: number
    tags: string[]
    note?: string
  }) => {
    try {
      const rating = saveRating(input)
      console.log(`[IPC] Saved rating for result ${input.providerResultId}: score=${input.score}`)
      return { success: true, data: rating }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[IPC] save-provider-rating failed:', message)
      return { success: false, error: message }
    }
  })

  // --- Save user rating (good/bad) for a provider result ---
  ipcMain.handle('save-user-rating', async (_event, resultId: string, rating: 'good' | 'bad' | null) => {
    try {
      updateProviderResult(resultId, { userRating: rating })
      console.log(`[IPC] Saved user rating for result ${resultId}: ${rating}`)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // --- Mark a provider result as viewed ---
  ipcMain.handle('mark-viewed', async (_event, resultId: string) => {
    try {
      updateProviderResult(resultId, { viewed: true })
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // --- Rate on the LLM portal (passthrough mode) ---
  ipcMain.handle('rate-on-provider', async (_event, provider: string, rating: 'good' | 'bad') => {
    try {
      const providerName = provider as ProviderName
      if (!isInitialized(providerName)) {
        return { success: false, error: `${provider} session not initialized` }
      }
      const factory = adapterFactories[providerName]
      if (!factory) return { success: false, error: `Unknown provider: ${provider}` }
      const adapter = factory()
      await adapter.rateLastResponse(rating)
      console.log(`[IPC] Rated ${rating} on ${provider} portal`)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[IPC] rate-on-provider failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // --- Regenerate a single provider for an existing query ---
  ipcMain.handle('regenerate-provider', async (_event, queryId: string, provider: string, conversationId: string) => {
    try {
      // Get the thread URL for this provider in this conversation
      const threads = getProviderThreads(conversationId)
      const thread = threads.find((t) => t.provider === provider)
      const threadUrl = thread?.threadUrl ?? null

      // Delete old results for this provider before regenerating
      deleteResultsByQueryAndProvider(queryId, provider)

      const onEvent = createStreamHandler(queryId, conversationId)

      regenerateProviderStreaming(
        provider as ProviderName, threadUrl, queryId, onEvent
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] regenerate-provider failed: ${message}`)
        sendStreamEvent({ type: 'turn-complete', queryId })
      })

      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // --- Initialize a provider's browser session on demand ---
  ipcMain.handle('initialize-provider', async (_event, provider: string) => {
    try {
      await initializeProvider(provider as ProviderName)
      console.log(`[IPC] Initialized provider: ${provider}`)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] initialize-provider failed for ${provider}:`, message)
      return { success: false, error: message }
    }
  })

  // --- Open external URL in default browser ---
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url)
  })

}

app.whenReady().then(async () => {
  getDb()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', async () => {
  await closeAll()
  closeDb()
})
