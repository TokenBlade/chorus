import type { Page } from 'playwright'
import { clipboard } from 'electron'
import { getPage } from '../services/browserSessionManager'
import type { LlmAdapter } from './baseAdapter'
import { waitUntil, waitForTextStability, htmlToMarkdown, pasteText, withClipboardLock } from './baseAdapter'

// ---------------------------------------------------------------------------
// Moonshot/Kimi DOM selectors (kimi.com, as of early 2026)
//
// Kimi is a React app with hashed CSS class names. We rely on:
//   - Structural selectors (contenteditable, role attributes)
//   - Data attributes where available
//   - Positional fallbacks (last message block in conversation area)
//
// The adapter discovers the response element at runtime using multiple
// strategies, logging what it finds for iterative selector refinement.
// ---------------------------------------------------------------------------

const SELECTORS = {
  inputArea: [
    '.chat-input-editor[contenteditable="true"]',      // primary: Kimi lexical editor
    '[data-lexical-editor="true"].chat-input-editor',  // lexical editor variant
    'div[role="textbox"][contenteditable="true"].chat-input-editor',
    '[contenteditable="true"]',                         // primary: contenteditable div
    'textarea',                                         // fallback: textarea
    '[role="textbox"]',                                 // fallback: ARIA textbox
  ],

  overlayCloseButton: [
    'button[aria-label*="Close"]',
    'button[aria-label*="close"]',
    'button[aria-label*="关闭"]',
    'button:has-text("Close")',
    'button:has-text("关闭")',
    'button:has-text("Done")',
    'button:has-text("完成")',
  ],

  blockingOverlay: [
    '.image-main',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="lightbox"]',
    '[class*="modal"]',
    '[class*="viewer"]',
  ],

  stopButton: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="取消"]',                        // Chinese: cancel
    'button[aria-label*="停止"]',                        // Chinese: stop
  ],

  // Kimi response blocks — try content selectors first, then structural.
  // [class*="markdown"] must come before [class*="assistant"] because Kimi's Vue.js
  // UI has many elements with "assistant" in class (avatar wrappers, action buttons)
  // that match but contain UI chrome, not response content.
  responseBlocks: [
    '[data-role="assistant"]',                          // data-role attribute
    '[data-type="assistant"]',                          // data-type attribute
    '[class*="markdown"]',                              // markdown-rendered content (primary)
    '[class*="answer"]',                                // class containing "answer"
    '[class*="message-content"]',                       // message content wrapper
    '[class*="assistant"]',                             // class containing "assistant" (last: broad)
  ],

  // Thinking/search blocks
  thinkingBlocks: [
    'details',                                          // collapsible details elements
    '[class*="thinking"]',                              // class containing "thinking"
    '[class*="search"]',                                // search/tool-call blocks
    '[data-type="thinking"]',                           // data attribute
    '[aria-expanded]',                                  // expandable sections
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
      // try next
    }
  }
  throw new Error(`[MoonshotAdapter] None of the selectors matched: ${selectors.join(', ')}`)
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

async function dismissOverlays(page: Page): Promise<void> {
  let dismissed = false

  for (const selector of SELECTORS.overlayCloseButton) {
    try {
      const btn = page.locator(selector).first()
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click({ timeout: 1000 })
        dismissed = true
        console.log(`[MoonshotAdapter] Dismissed overlay with: ${selector}`)
        await new Promise((r) => setTimeout(r, 250))
      }
    } catch {
      // try next selector
    }
  }

  for (const selector of SELECTORS.blockingOverlay) {
    try {
      const overlay = page.locator(selector).first()
      if (await overlay.isVisible({ timeout: 300 })) {
        await page.keyboard.press('Escape').catch(() => {})
        dismissed = true
        console.log(`[MoonshotAdapter] Sent Escape to dismiss blocking overlay: ${selector}`)
        await new Promise((r) => setTimeout(r, 250))
        break
      }
    } catch {
      // try next selector
    }
  }

  if (dismissed) {
    await new Promise((r) => setTimeout(r, 300))
  }
}

/**
 * Fallback response extraction: find the last substantial text block
 * in the conversation area by DOM position, excluding input/nav elements.
 * Works regardless of class names.
 */
async function extractResponseByPosition(page: Page): Promise<string> {
  return page.evaluate(() => {
    const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea')
    if (!input) return ''

    // Walk up from input to find the conversation scroll container
    let container = input.parentElement
    while (container && container !== document.body) {
      // Look for a scrollable container with substantial height
      if (container.scrollHeight > 500 && container.clientWidth > 300) {
        break
      }
      container = container.parentElement
    }
    if (!container || container === document.body) return ''

    // Get all block-level elements in the container
    const blocks = container.querySelectorAll('div, article, section, p')
    let bestBlock: Element | null = null
    let bestLen = 0

    // Skip blocks inside the input's immediate container (placeholder text, buttons, etc.)
    const inputParent = input.parentElement
    for (const block of blocks) {
      // Skip input area, its ancestors, and siblings in the input container
      if (input.contains(block) || block.contains(input)) continue
      if (inputParent && inputParent !== container && inputParent.contains(block)) continue
      // Skip invisible elements
      if ((block as HTMLElement).offsetParent === null) continue
      // Skip nav-heavy elements
      const links = block.querySelectorAll('a[href]')
      if (links.length > 3) continue

      const text = (block.innerText || '').trim()
      if (text.length < 10) continue

      // Check this is a "leaf" — doesn't contain another large block
      let isLeaf = true
      for (const child of block.querySelectorAll('div, article, section')) {
        if ((child.innerText || '').trim().length > text.length * 0.8) {
          isLeaf = false
          break
        }
      }

      // Among leaf blocks, prefer the LARGEST visible one (not bottom-most,
      // to avoid picking up input placeholder text like "Ask away. Pics work too.")
      if (isLeaf && text.length > bestLen) {
        const rect = (block as HTMLElement).getBoundingClientRect()
        if (rect.top > 0) {
          bestBlock = block
          bestLen = text.length
        }
      }
    }

    if (!bestBlock) return ''

    // Walk up from bestBlock to find the message container
    // (the highest ancestor that doesn't contain the input area)
    let msgContainer = bestBlock as HTMLElement
    let node = msgContainer.parentElement
    while (node && node !== container && node !== document.body) {
      if (input && node.contains(input)) break
      msgContainer = node
      node = node.parentElement
    }
    return msgContainer.innerHTML
  })
}

// ---------------------------------------------------------------------------
// Moonshot/Kimi Adapter
// ---------------------------------------------------------------------------

export function createMoonshotAdapter(): LlmAdapter {
  function getMoonshotPage(): Page {
    return getPage('moonshot')
  }

  return {
    provider: 'moonshot',

    async ensureReady(): Promise<void> {
      const page = getMoonshotPage()
      const url = page.url()
      console.log(`[MoonshotAdapter] ensureReady — current URL: ${url}`)

      if (!url.includes('kimi.') && !url.includes('moonshot')) {
        throw new Error(`[MoonshotAdapter] Page is not on Kimi: ${url}`)
      }

      try {
        await dismissOverlays(page)
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[MoonshotAdapter] Page is ready — input area found')
      } catch {
        throw new Error('[MoonshotAdapter] Could not find input area. Kimi may require login.')
      }
    },

    async sendPrompt(prompt: string): Promise<void> {
      const page = getMoonshotPage()
      console.log(`[MoonshotAdapter] sendPrompt — length: ${prompt.length} chars`)

      await dismissOverlays(page)
      const inputLocator = await findFirst(page, SELECTORS.inputArea, 10000)
      await pasteText(page, inputLocator, prompt)

      await new Promise((r) => setTimeout(r, 300))
      await page.keyboard.press('Enter')

      await new Promise((r) => setTimeout(r, 500))
      console.log('[MoonshotAdapter] Prompt submitted')
    },

    async waitForCompletion(timeoutMs: number): Promise<void> {
      const page = getMoonshotPage()
      console.log(`[MoonshotAdapter] waitForCompletion — timeout: ${timeoutMs}ms`)

      let stopButtonSeen = false

      try {
        await findFirst(page, SELECTORS.stopButton, 10000)
        stopButtonSeen = true
        console.log('[MoonshotAdapter] Stop button detected — generation in progress')
      } catch {
        console.log('[MoonshotAdapter] Stop button not detected — using text stability fallback')
      }

      if (stopButtonSeen) {
        await waitUntil(
          async () => {
            const btn = await findFirstOptional(page, SELECTORS.stopButton, 500)
            return btn === null
          },
          timeoutMs,
          1000,
          'stop button disappearance'
        )
        console.log('[MoonshotAdapter] Stop button disappeared')

        // Kimi tool calls (search, code execution) cause the stop button to
        // disappear between phases and reappear for each new generation phase.
        // Re-check several times to avoid declaring completion prematurely.
        for (let recheck = 0; recheck < 5; recheck++) {
          await new Promise((r) => setTimeout(r, 2000))
          const btn = await findFirstOptional(page, SELECTORS.stopButton, 1000)
          if (btn) {
            console.log(`[MoonshotAdapter] Stop button reappeared (tool call phase ${recheck + 1}) — waiting again`)
            await waitUntil(
              async () => {
                const b = await findFirstOptional(page, SELECTORS.stopButton, 500)
                return b === null
              },
              timeoutMs,
              1000,
              `stop button disappearance (tool call phase ${recheck + 1})`
            )
            console.log(`[MoonshotAdapter] Stop button disappeared again (phase ${recheck + 1})`)
          } else {
            console.log(`[MoonshotAdapter] Stop button stayed gone after ${recheck + 1} recheck(s)`)
            break
          }
        }

        // Wait for Kimi's Copy button to appear (signals response is ready)
        try {
          await page.locator('svg[name="Copy"]').last().waitFor({ state: 'visible', timeout: 10000 })
          console.log('[MoonshotAdapter] Copy button visible — response ready')
        } catch {
          console.log('[MoonshotAdapter] Copy button not found — proceeding anyway')
        }
        await new Promise((r) => setTimeout(r, 1000))
      }

      // Final: text stability
      await waitForTextStability(
        async () => {
          try {
            return await this.extractLatestResponse().then((r) => r.text)
          } catch {
            return ''
          }
        },
        stopButtonSeen ? 15000 : timeoutMs,
        3000,
        500,
        'Moonshot response text stability'
      )

      console.log('[MoonshotAdapter] Completion detected')
    },

    async extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }> {
      const page = getMoonshotPage()

      // Strategy 0: Click Kimi's Copy button and read clipboard.
      // This bypasses all DOM selector and timing issues — Kimi's own copy logic
      // produces markdown with proper $...$ math delimiters.
      //
      // GUARD: Only use clipboard extraction when generation is NOT in progress.
      // During polling, the stop button is visible and:
      //  (a) copying would capture incomplete content
      //  (b) clipboard ops race with other adapters' pasteText() (shared OS clipboard)
      const isGenerating = await findFirstOptional(page, SELECTORS.stopButton, 300)
      if (!isGenerating) {
        try {
          const copiedText = await withClipboardLock(async () => {
            const copyBtn = page.locator('svg[name="Copy"]').last()
            if (await copyBtn.count() > 0) {
              const savedClipboard = clipboard.readText()
              clipboard.writeText('')
              await copyBtn.locator('..').click()
              await new Promise((r) => setTimeout(r, 500))
              const text = clipboard.readText().trim()
              clipboard.writeText(savedClipboard)
              return text
            }
            return ''
          })
          if (copiedText.length > 10) {
            console.log(`[MoonshotAdapter] Extracted response via clipboard (${copiedText.length} chars)`)
            return { text: copiedText, conversationUrl: page.url() }
          }
        } catch (e) {
          console.log(`[MoonshotAdapter] Clipboard extraction failed: ${e}`)
        }
      }

      // Strategy 1: Try semantic/class-based selectors (fallback)
      for (const selector of SELECTORS.responseBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            const html = (await page.evaluate((sel) => {
              const all = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
              if (all.length === 0) return ''
              const last = all[all.length - 1]
              if (all.length === 1) return last.innerHTML

              const parent = last.parentElement
              if (parent) {
                const inputArea = document.querySelector('[contenteditable="true"]')
                  || document.querySelector('textarea')
                if (!inputArea || !parent.contains(inputArea)) {
                  return parent.innerHTML
                }
              }
              return last.innerHTML
            }, selector)).trim()
            if (html.length > 0) {
              const text = htmlToMarkdown(html)
              if (text.length > 5) {
                console.log(`[MoonshotAdapter] Extracted response (${text.length} chars) using selector: ${selector}`)
                return { text, conversationUrl: page.url() }
              }
            }
          }
        } catch {
          // try next
        }
      }

      throw new Error('[MoonshotAdapter] Could not extract response text')
    },

    async getPhaseContent() {
      const page = getMoonshotPage()

      let thinking = ''
      let response = ''

      // Extract thinking from details/thinking blocks
      for (const selector of SELECTORS.thinkingBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            const text = (await blocks.last().innerText()).trim()
            if (text.length > thinking.length) {
              thinking = text
            }
          }
        } catch {
          // try next
        }
      }

      // Extract response
      try {
        const result = await this.extractLatestResponse()
        response = result.text
      } catch {
        // no response yet
      }

      return { thinking, response }
    },

    async isGenerating() {
      const page = getMoonshotPage()
      const btn = await findFirstOptional(page, SELECTORS.stopButton, 500)
      return btn !== null
    },

    async navigateToNewChat(): Promise<void> {
      const page = getMoonshotPage()
      console.log('[MoonshotAdapter] Navigating to new chat')
      await page.goto('https://kimi.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await findFirst(page, SELECTORS.inputArea, 15000)
      console.log('[MoonshotAdapter] New chat ready')
    },

    async navigateToThread(url: string): Promise<void> {
      const page = getMoonshotPage()
      const currentUrl = page.url()
      if (currentUrl === url) {
        console.log('[MoonshotAdapter] Already on target thread')
        return
      }
      console.log(`[MoonshotAdapter] Navigating to thread: ${url}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[MoonshotAdapter] Thread loaded')
      } catch (err) {
        console.warn(`[MoonshotAdapter] Failed to load thread, falling back to new chat: ${err}`)
        await this.navigateToNewChat()
      }
    },

    async rateLastResponse(): Promise<void> {
      throw new Error('Rating not yet supported for Moonshot AI')
    },

    async waitForResponseBlocks(timeoutMs = 15000): Promise<void> {
      const page = getMoonshotPage()
      await waitUntil(
        async () => {
          for (const selector of SELECTORS.responseBlocks) {
            const count = await page.locator(selector).count()
            if (count > 0) return true
          }
          // Also check positional fallback
          const html = await extractResponseByPosition(page)
          return html.length > 0
        },
        timeoutMs,
        500,
        'Moonshot response blocks to load'
      )
    },

    async clickRegenerate(): Promise<void> {
      throw new Error('Regeneration not yet supported for Moonshot AI')
    },
  }
}
