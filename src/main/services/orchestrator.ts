import type { LlmAdapter } from '../adapters/baseAdapter'
import { hasThinkingSupport } from '../adapters/baseAdapter'
import { createClaudeAdapter } from '../adapters/claudeAdapter'
import { createChatGPTAdapter } from '../adapters/chatgptAdapter'
import { createGeminiAdapter } from '../adapters/geminiAdapter'
import { createDeepSeekAdapter } from '../adapters/deepseekAdapter'
import { createMoonshotAdapter } from '../adapters/moonshotAdapter'
import { createZaiAdapter } from '../adapters/zaiAdapter'
import { ensurePage, acquireProviderLock } from '../services/browserSessionManager'
import type { ProviderName, ProviderStatus } from '../types/provider'
import type { StreamEvent } from '../types/stream'

const DEFAULT_TIMEOUT_MS = 600_000

export const adapterFactories: Record<ProviderName, () => LlmAdapter> = {
  chatgpt: createChatGPTAdapter,
  claude: createClaudeAdapter,
  gemini: createGeminiAdapter,
  deepseek: createDeepSeekAdapter,
  moonshot: createMoonshotAdapter,
  zai: createZaiAdapter,
}

export type OrchestratorProviderResult = {
  provider: ProviderName
  status: ProviderStatus
  startedAt: string
  finishedAt: string
  latencyMs: number
  contentText?: string
  conversationUrl?: string
  errorMessage?: string
}

export type OrchestratorResult = {
  results: OrchestratorProviderResult[]
}

const POLL_INTERVAL_MS = 500

/**
 * Shared streaming logic: poll for deltas while waiting for completion.
 * Returns the final extracted response. Handles completion timeout and
 * ensures the poll loop always terminates.
 */
async function streamWithPolling(
  adapter: LlmAdapter,
  queryId: string,
  onEvent: (event: StreamEvent) => void,
  timeoutMs: number,
  baselineText = ''
): Promise<{ text: string; thinkingText?: string; conversationUrl?: string }> {
  const provider = adapter.provider
  let completed = false
  let lastText = baselineText
  let lastThinking = ''
  const usePhases = hasThinkingSupport(adapter)

  const completionPromise = adapter.waitForCompletion(timeoutMs).then(
    () => { completed = true },
    (err) => {
      completed = true
      throw err
    }
  )

  const deadline = Date.now() + timeoutMs + 5000
  const pollLoop = (async () => {
    while (!completed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      if (completed) break
      try {
        if (usePhases) {
          const { thinking, response } = await adapter.getPhaseContent!()
          if (thinking && thinking !== lastThinking) {
            lastThinking = thinking
            onEvent({ type: 'thinking-delta', queryId, provider, text: thinking })
          }
          if (response && response !== lastText) {
            lastText = response
            onEvent({ type: 'delta', queryId, provider, text: response })
          }
        } else {
          const partial = await adapter.extractLatestResponse()
          if (partial.text && partial.text !== lastText) {
            lastText = partial.text
            onEvent({ type: 'delta', queryId, provider, text: partial.text })
          }
        }
      } catch {
        // DOM not ready yet or extraction failed — skip this tick
      }
    }
  })()

  await completionPromise
  await pollLoop

  // Final extraction — retry if the result is significantly shorter than what was
  // seen during streaming. Some sites (e.g., Kimi) re-render the DOM after streaming
  // completes, and the final content takes several seconds to appear with KaTeX math.
  let finalResponse = await adapter.extractLatestResponse().catch(
    () => ({ text: '', conversationUrl: undefined as string | undefined })
  )
  if (lastText.length > finalResponse.text.length * 1.5 && lastText.length > 50) {
    console.log(`[streamWithPolling] ${provider}: final extraction (${finalResponse.text.length} chars) shorter than streaming (${lastText.length} chars) — retrying`)
    for (let retry = 0; retry < 5; retry++) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const retryResponse = await adapter.extractLatestResponse()
        if (retryResponse.text.length > finalResponse.text.length) {
          finalResponse = retryResponse
        }
        if (finalResponse.text.length >= lastText.length * 0.8) break
      } catch { /* continue retrying */ }
    }
  }

  let thinkingText: string | undefined
  if (usePhases) {
    try {
      const { thinking } = await adapter.getPhaseContent!()
      if (thinking) thinkingText = thinking
    } catch { /* non-critical */ }
  }

  return { ...finalResponse, thinkingText }
}

async function runProviderStreaming(
  adapter: LlmAdapter,
  prompt: string,
  threadUrl: string | null,
  queryId: string,
  onEvent: (event: StreamEvent) => void,
  timeoutMs: number
): Promise<OrchestratorProviderResult> {
  const provider = adapter.provider

  // Acquire per-provider lock to prevent concurrent operations on the same browser tab
  const releaseLock = await acquireProviderLock(provider)

  const startedAt = new Date().toISOString()
  const startTime = Date.now()

  console.log(`[Orchestrator] ${provider} — starting streaming (threadUrl: ${threadUrl ?? 'new'})`)

  try {
    // Ensure the browser tab is open (reopens if user closed it)
    await ensurePage(provider)

    // Navigate to existing thread or start a new chat
    if (threadUrl) {
      await adapter.navigateToThread(threadUrl)
    } else {
      await adapter.navigateToNewChat()
    }

    await adapter.ensureReady()

    // Capture baseline text before sending so we don't emit old responses as deltas
    let baselineText = ''
    if (threadUrl) {
      try {
        const baseline = await adapter.extractLatestResponse()
        baselineText = baseline.text
      } catch { /* no existing response — fine */ }
    }

    await adapter.sendPrompt(prompt)

    onEvent({ type: 'started', queryId, provider })

    const response = await streamWithPolling(adapter, queryId, onEvent, timeoutMs, baselineText)
    const finishedAt = new Date().toISOString()
    const latencyMs = Date.now() - startTime

    console.log(`[Orchestrator] ${provider} — streaming complete (${latencyMs}ms, ${response.text.length} chars)`)

    onEvent({
      type: 'completed',
      queryId,
      provider,
      resultId: '',
      text: response.text,
      thinkingText: response.thinkingText,
      conversationUrl: response.conversationUrl,
      latencyMs,
      startedAt,
      finishedAt,
    })

    return {
      provider,
      status: 'completed',
      startedAt,
      finishedAt,
      latencyMs,
      contentText: response.text,
      conversationUrl: response.conversationUrl,
    }
  } catch (err) {
    const finishedAt = new Date().toISOString()
    const latencyMs = Date.now() - startTime
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = message.includes('Timed out')
    const status: 'failed' | 'timeout' = isTimeout ? 'timeout' : 'failed'

    console.error(`[Orchestrator] ${provider} — ${status} (${latencyMs}ms): ${message}`)

    onEvent({ type: 'error', queryId, provider, error: message, status, startedAt, finishedAt })

    return {
      provider,
      status,
      startedAt,
      finishedAt,
      latencyMs,
      errorMessage: message,
    }
  } finally {
    releaseLock()
  }
}

export async function runAllProvidersStreaming(
  prompt: string,
  providerThreads: Map<ProviderName, string | null>,
  providers: ProviderName[],
  queryId: string,
  onEvent: (event: StreamEvent) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<OrchestratorResult> {
  console.log(`[Orchestrator] Starting streaming — prompt: "${prompt.slice(0, 60)}..." providers: [${providers.join(', ')}]`)

  const adapters: LlmAdapter[] = providers.map((p) => adapterFactories[p]())

  const settled = await Promise.allSettled(
    adapters.map((adapter) => {
      const threadUrl = providerThreads.get(adapter.provider) ?? null
      return runProviderStreaming(adapter, prompt, threadUrl, queryId, onEvent, timeoutMs)
    })
  )

  const results: OrchestratorProviderResult[] = settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value
    }
    const provider = adapters[i].provider
    const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
    const now = new Date().toISOString()
    console.error(`[Orchestrator] ${provider} — unexpected rejection: ${message}`)
    onEvent({ type: 'error', queryId, provider, error: message, status: 'failed', startedAt: now, finishedAt: now })
    return {
      provider,
      status: 'failed' as ProviderStatus,
      startedAt: now,
      finishedAt: now,
      latencyMs: 0,
      errorMessage: message,
    }
  })

  // Emit turn-complete after all providers settle
  onEvent({ type: 'turn-complete', queryId })

  const successCount = results.filter((r) => r.status === 'completed').length
  console.log(`[Orchestrator] Streaming complete — ${successCount}/${results.length} succeeded`)

  return { results }
}

/**
 * Send a prompt to a single provider (in-thread follow-up).
 */
export async function runSingleProviderStreaming(
  provider: ProviderName,
  prompt: string,
  threadUrl: string | null,
  queryId: string,
  onEvent: (event: StreamEvent) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<OrchestratorProviderResult> {
  const adapter = adapterFactories[provider]()
  const result = await runProviderStreaming(adapter, prompt, threadUrl, queryId, onEvent, timeoutMs)
  onEvent({ type: 'turn-complete', queryId })
  return result
}

/**
 * Regenerate the last response for a single provider by clicking the portal's
 * native regenerate button (not by re-sending the prompt).
 */
export async function regenerateProviderStreaming(
  provider: ProviderName,
  threadUrl: string | null,
  queryId: string,
  onEvent: (event: StreamEvent) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<OrchestratorProviderResult> {
  const adapter = adapterFactories[provider]()

  // Acquire per-provider lock to prevent concurrent operations on the same browser tab
  const releaseLock = await acquireProviderLock(provider)

  const startedAt = new Date().toISOString()
  const startTime = Date.now()

  console.log(`[Orchestrator] Regenerating ${provider} for query ${queryId}`)

  try {
    // Ensure the browser tab is open (reopens if user closed it)
    await ensurePage(provider)

    // Navigate to the thread (the response we want to regenerate is the last one)
    if (threadUrl) {
      await adapter.navigateToThread(threadUrl)
    }

    await adapter.ensureReady()

    // Wait for response blocks to load (ensureReady only checks for the input area)
    await adapter.waitForResponseBlocks()

    // Click the portal's native regenerate button
    await adapter.clickRegenerate()

    onEvent({ type: 'started', queryId, provider })

    const response = await streamWithPolling(adapter, queryId, onEvent, timeoutMs)
    const finishedAt = new Date().toISOString()
    const latencyMs = Date.now() - startTime

    console.log(`[Orchestrator] ${provider} — regeneration complete (${latencyMs}ms)`)

    onEvent({
      type: 'completed',
      queryId,
      provider,
      resultId: '',
      text: response.text,
      thinkingText: response.thinkingText,
      conversationUrl: response.conversationUrl,
      latencyMs,
      startedAt,
      finishedAt,
    })

    return {
      provider,
      status: 'completed',
      startedAt,
      finishedAt,
      latencyMs,
      contentText: response.text,
      conversationUrl: response.conversationUrl,
    }
  } catch (err) {
    const finishedAt = new Date().toISOString()
    const latencyMs = Date.now() - startTime
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = message.includes('Timed out')
    const status: 'failed' | 'timeout' = isTimeout ? 'timeout' : 'failed'

    console.error(`[Orchestrator] ${provider} — regeneration ${status}: ${message}`)
    onEvent({ type: 'error', queryId, provider, error: message, status, startedAt, finishedAt })

    return { provider, status, startedAt, finishedAt, latencyMs, errorMessage: message }
  } finally {
    releaseLock()
  }
}
