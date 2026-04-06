import type { Page } from 'playwright'
import { getPage } from '../services/browserSessionManager'
import type { LlmAdapter } from './baseAdapter'
import { waitUntil, waitForTextStability, htmlToMarkdown, pasteText } from './baseAdapter'

// ---------------------------------------------------------------------------
// Claude.ai DOM selectors (as of early 2026)
//
// These are intentionally kept in one place so they can be updated easily
// when Claude's UI changes. We prefer role/aria/attribute selectors over
// CSS class names because they are more stable across deployments.
// ---------------------------------------------------------------------------

const SELECTORS = {
  // The main content-editable input area where the user types prompts.
  // Claude uses a contenteditable div with role or a ProseMirror editor.
  inputArea: [
    'div[contenteditable="true"]',                     // primary: contenteditable div
    '[role="textbox"]',                                // fallback: ARIA textbox
    'fieldset div[contenteditable="true"]',            // fallback: within fieldset
  ],

  // The send/submit button. Claude shows an arrow button to send.
  sendButton: [
    'button[aria-label="Send Message"]',               // primary: aria label
    'button[aria-label="Send message"]',               // case variant
    'button[type="button"]:has(svg)',                   // fallback: button with svg icon near input
    'fieldset button:last-of-type',                     // fallback: last button in fieldset
  ],

  // The stop/cancel generation button (visible while Claude is generating).
  stopButton: [
    'button[aria-label="Stop Response"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop"]',
  ],

  // Individual response message blocks from the assistant.
  // Claude wraps each message in a container; we look for the last one.
  responseBlocks: [
    '[data-testid="chat-message-content"]',            // if test IDs are present
    '.font-claude-message',                            // Claude's message font class
    '[class*="message"] [class*="content"]',           // generic message content
    '[data-is-streaming]',                             // streaming indicator on message
  ],

  // Regenerate button on the last assistant response.
  regenerateButton: [
    'button[aria-label="Retry"]',
    'button[aria-label="Regenerate"]',
    'button[aria-label="Retry response"]',
    'button:has-text("Retry")',
    'button[data-testid="retry"]',
  ],
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findFirst(page: Page, selectors: readonly string[], timeoutMs = 5000): Promise<ReturnType<Page['locator']>> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first()
      await locator.waitFor({ state: 'visible', timeout: timeoutMs / selectors.length })
      return locator
    } catch {
      // try next selector
    }
  }
  throw new Error(`[ClaudeAdapter] None of the selectors matched: ${selectors.join(', ')}`)
}

async function findFirstOptional(page: Page, selectors: readonly string[], timeoutMs = 1000): Promise<ReturnType<Page['locator']> | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first()
      await locator.waitFor({ state: 'visible', timeout: timeoutMs / selectors.length })
      return locator
    } catch {
      // try next
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Claude Adapter
// ---------------------------------------------------------------------------

export function createClaudeAdapter(): LlmAdapter {
  function getClaudePage(): Page {
    return getPage('claude')
  }

  return {
    provider: 'claude',

    async ensureReady(): Promise<void> {
      const page = getClaudePage()
      const url = page.url()
      console.log(`[ClaudeAdapter] ensureReady — current URL: ${url}`)

      // Check we are on claude.ai
      if (!url.includes('claude.ai')) {
        throw new Error(`[ClaudeAdapter] Page is not on claude.ai: ${url}`)
      }

      // Dismiss any modal overlays (e.g. model picker, usage prompts) that block input
      try {
        const modal = page.locator('[data-state="open"].fixed.z-modal, [data-state="open"][class*="z-modal"]')
        if (await modal.count() > 0) {
          console.log('[ClaudeAdapter] Modal overlay detected — attempting to dismiss')
          // Try clicking a close/dismiss button inside the modal
          const closeBtn = modal.locator('button[aria-label="Close"], button:has-text("Close"), button:has-text("Dismiss"), button:has-text("Got it"), button:has-text("Continue")')
          if (await closeBtn.count() > 0) {
            await closeBtn.first().click()
            console.log('[ClaudeAdapter] Dismissed modal via button')
          } else {
            // Press Escape to dismiss
            await page.keyboard.press('Escape')
            console.log('[ClaudeAdapter] Dismissed modal via Escape')
          }
          await new Promise((r) => setTimeout(r, 500))
        }
      } catch (err) {
        console.warn('[ClaudeAdapter] Modal dismissal attempt failed:', err)
      }

      // Wait for the input area to be visible (proves page is loaded and interactive)
      try {
        await findFirst(page, SELECTORS.inputArea, 10000)
        console.log('[ClaudeAdapter] Page is ready — input area found')
      } catch {
        // Maybe we're on a login page or interstitial
        const bodyText = await page.locator('body').innerText().catch(() => '')
        if (/log\s*in|sign\s*in/i.test(bodyText)) {
          throw new Error('[ClaudeAdapter] Claude appears to require login. Please log in manually.')
        }
        throw new Error('[ClaudeAdapter] Could not find input area. The page may not be ready.')
      }
    },

    async sendPrompt(prompt: string): Promise<void> {
      const page = getClaudePage()
      console.log(`[ClaudeAdapter] sendPrompt — length: ${prompt.length} chars`)

      // Find the input area
      const inputLocator = await findFirst(page, SELECTORS.inputArea, 10000)

      // Use clipboard paste for contenteditable divs — pressSequentially sends \n
      // as Enter keystrokes, which submits the message and splits multi-paragraph prompts.
      await pasteText(page, inputLocator, prompt)

      // Short pause to let the UI register the input
      await new Promise((r) => setTimeout(r, 300))

      // Find and click the send button
      try {
        const sendBtn = await findFirst(page, SELECTORS.sendButton, 5000)
        await sendBtn.click()
        console.log('[ClaudeAdapter] Send button clicked')
      } catch {
        // Fallback: try pressing Enter
        console.log('[ClaudeAdapter] Send button not found, trying Enter key')
        await page.keyboard.press('Enter')
      }

      // Brief wait for the submission to register
      await new Promise((r) => setTimeout(r, 500))
      console.log('[ClaudeAdapter] Prompt submitted')
    },

    async waitForCompletion(timeoutMs: number): Promise<void> {
      const page = getClaudePage()
      console.log(`[ClaudeAdapter] waitForCompletion — timeout: ${timeoutMs}ms`)

      // Strategy 1: Wait for the stop button to appear (generation started),
      //             then disappear (generation finished).
      // Strategy 2: If stop button never appears, fall back to text stability.

      let stopButtonSeen = false

      // Wait up to 10s for the stop button to appear (generation starting)
      try {
        await findFirst(page, SELECTORS.stopButton, 10000)
        stopButtonSeen = true
        console.log('[ClaudeAdapter] Stop button detected — generation in progress')
      } catch {
        console.log('[ClaudeAdapter] Stop button not detected — using text stability fallback')
      }

      if (stopButtonSeen) {
        // Wait for the stop button to disappear (generation complete)
        await waitUntil(
          async () => {
            const btn = await findFirstOptional(page, SELECTORS.stopButton, 500)
            return btn === null
          },
          timeoutMs,
          1000,
          'stop button disappearance'
        )
        console.log('[ClaudeAdapter] Stop button disappeared — generation likely complete')
        // Extra stability wait after stop button disappears
        await new Promise((r) => setTimeout(r, 1000))
      }

      // Final check: wait for response text to stabilize
      await waitForTextStability(
        async () => {
          try {
            return await this.extractLatestResponse().then((r) => r.text)
          } catch {
            return ''
          }
        },
        stopButtonSeen ? 10000 : timeoutMs,  // shorter timeout if stop button already handled
        2000,
        500,
        'Claude response text stability'
      )

      console.log('[ClaudeAdapter] Completion detected')
    },

    async extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }> {
      const page = getClaudePage()

      // Try each response block selector to find message containers
      for (const selector of SELECTORS.responseBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            const lastBlock = blocks.last()
            const html = (await lastBlock.innerHTML()).trim()
            if (html.length > 0) {
              const text = htmlToMarkdown(html)
              console.log(`[ClaudeAdapter] Extracted response (${text.length} chars) using selector: ${selector}`)
              return {
                text,
                conversationUrl: page.url()
              }
            }
          }
        } catch {
          // try next selector
        }
      }

      // Broader fallback: look for the last substantial text block in the chat area
      // that is NOT the user's message. Claude typically has alternating user/assistant blocks.
      try {
        // Try to find all message-like containers and take the last one
        const allMessages = page.locator('[class*="message"]')
        const count = await allMessages.count()
        if (count > 0) {
          const lastMsg = allMessages.last()
          const html = (await lastMsg.innerHTML()).trim()
          if (html.length > 0) {
            const text = htmlToMarkdown(html)
            console.log(`[ClaudeAdapter] Extracted response via broad fallback (${text.length} chars)`)
            return { text, conversationUrl: page.url() }
          }
        }
      } catch {
        // exhausted fallbacks
      }

      throw new Error('[ClaudeAdapter] Could not extract response text from any known selector')
    },

    async navigateToNewChat(): Promise<void> {
      const page = getClaudePage()
      console.log('[ClaudeAdapter] Navigating to new chat')
      await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await findFirst(page, SELECTORS.inputArea, 15000)
      console.log('[ClaudeAdapter] New chat ready')
    },

    async navigateToThread(url: string): Promise<void> {
      const page = getClaudePage()
      const currentUrl = page.url()
      if (currentUrl === url) {
        console.log('[ClaudeAdapter] Already on target thread')
        return
      }
      console.log(`[ClaudeAdapter] Navigating to thread: ${url}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[ClaudeAdapter] Thread loaded')
      } catch (err) {
        console.warn(`[ClaudeAdapter] Failed to load thread, falling back to new chat: ${err}`)
        await this.navigateToNewChat()
      }
    },

    async rateLastResponse(rating: 'good' | 'bad'): Promise<void> {
      const page = getClaudePage()
      console.log(`[ClaudeAdapter] Rating last response: ${rating}`)

      // Claude shows thumbs-up/down buttons on hover over the last assistant message.
      // We need to hover over the last response block to reveal them, then click.
      const ratingSelectors = rating === 'good'
        ? [
            'button[aria-label="Thumbs up"]',
            'button[aria-label="Good response"]',
            'button[data-testid="good-response"]',
            'button:has(svg) [data-testid="thumbs-up"]',
          ]
        : [
            'button[aria-label="Thumbs down"]',
            'button[aria-label="Bad response"]',
            'button[data-testid="bad-response"]',
            'button:has(svg) [data-testid="thumbs-down"]',
          ]

      try {
        // Hover over the last response block to reveal action buttons
        for (const selector of SELECTORS.responseBlocks) {
          try {
            const blocks = page.locator(selector)
            const count = await blocks.count()
            if (count > 0) {
              await blocks.last().hover()
              await new Promise((r) => setTimeout(r, 500))
              break
            }
          } catch { /* try next */ }
        }

        // Find and click the rating button
        for (const selector of ratingSelectors) {
          try {
            const btn = page.locator(selector).last()
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click()
              console.log(`[ClaudeAdapter] Clicked rating button: ${selector}`)
              return
            }
          } catch { /* try next */ }
        }

        console.warn('[ClaudeAdapter] Rating button not found — rating not sent to portal')
      } catch (err) {
        console.warn(`[ClaudeAdapter] Failed to rate on portal: ${err}`)
      }
    },

    async waitForResponseBlocks(timeoutMs = 15000): Promise<void> {
      const page = getClaudePage()
      await waitUntil(
        async () => {
          for (const selector of SELECTORS.responseBlocks) {
            const count = await page.locator(selector).count()
            if (count > 0) return true
          }
          return false
        },
        timeoutMs,
        500,
        'Claude response blocks to load'
      )
    },

    async clickRegenerate(): Promise<void> {
      const page = getClaudePage()
      console.log('[ClaudeAdapter] Clicking regenerate button')

      // Hover over the last response to reveal action buttons
      for (const selector of SELECTORS.responseBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            await blocks.last().hover()
            await new Promise((r) => setTimeout(r, 500))
            break
          }
        } catch { /* try next */ }
      }

      // Click the regenerate button
      for (const selector of SELECTORS.regenerateButton) {
        try {
          const btn = page.locator(selector).last()
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click()
            console.log(`[ClaudeAdapter] Clicked regenerate: ${selector}`)
            await new Promise((r) => setTimeout(r, 500))
            return
          }
        } catch { /* try next */ }
      }

      throw new Error('[ClaudeAdapter] Regenerate button not found')
    },
  }
}
