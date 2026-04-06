import type { Page } from 'playwright'
import { getPage } from '../services/browserSessionManager'
import type { LlmAdapter } from './baseAdapter'
import { waitUntil, waitForTextStability, htmlToMarkdown } from './baseAdapter'

// ---------------------------------------------------------------------------
// DeepSeek DOM selectors (chat.deepseek.com, as of early 2026)
//
// DeepSeek renders assistant responses in `.ds-markdown` blocks.
// Thinking/reasoning is in a collapsible <details> block (`.ds-thinking-content`
// or similar) that is a sibling of the markdown response.
// ---------------------------------------------------------------------------

const SELECTORS = {
  inputArea: [
    'textarea',                                         // primary: plain textarea
    '#chat-input',                                      // alternative ID
    '[contenteditable="true"]',                         // fallback: contenteditable
    '[role="textbox"]',                                 // fallback: ARIA textbox
  ],

  stopButton: [
    'button[class*="stop"]',                            // class-based stop button
    'button[aria-label*="Stop"]',                       // aria label
    'button[aria-label*="stop"]',                       // lowercase variant
    '[class*="ds-icon-stop"]',                          // DeepSeek icon class
  ],

  // Assistant response blocks — DeepSeek wraps markdown in .ds-markdown
  responseBlocks: [
    '.ds-markdown',                                     // primary: DeepSeek markdown class
    '[class*="ds-markdown"]',                           // variant with prefix
    '[class*="markdown-body"]',                         // fallback
    '[class*="message-content"] [class*="markdown"]',   // nested markdown in message
  ],

  // Thinking/reasoning blocks — DeepSeek uses <details> with specific classes
  thinkingBlocks: [
    'details[class*="thinking"]',                       // thinking-specific details
    'details[class*="reason"]',                         // reasoning-specific details
    'details',                                          // any details block near response
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
  throw new Error(`[DeepSeekAdapter] None of the selectors matched: ${selectors.join(', ')}`)
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
// DeepSeek Adapter
// ---------------------------------------------------------------------------

export function createDeepSeekAdapter(): LlmAdapter {
  function getDeepSeekPage(): Page {
    return getPage('deepseek')
  }

  return {
    provider: 'deepseek',

    async ensureReady(): Promise<void> {
      const page = getDeepSeekPage()
      const url = page.url()
      console.log(`[DeepSeekAdapter] ensureReady — current URL: ${url}`)

      if (!url.includes('deepseek.com') && !url.includes('chat.deepseek')) {
        throw new Error(`[DeepSeekAdapter] Page is not on DeepSeek: ${url}`)
      }

      try {
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[DeepSeekAdapter] Page is ready — input area found')
      } catch {
        throw new Error('[DeepSeekAdapter] Could not find input area. The page may not be ready or requires login.')
      }
    },

    async sendPrompt(prompt: string): Promise<void> {
      const page = getDeepSeekPage()
      console.log(`[DeepSeekAdapter] sendPrompt — length: ${prompt.length} chars`)

      const inputLocator = await findFirst(page, SELECTORS.inputArea, 10000)
      await inputLocator.click()
      await inputLocator.fill(prompt)

      await new Promise((r) => setTimeout(r, 300))
      await page.keyboard.press('Enter')

      await new Promise((r) => setTimeout(r, 500))
      console.log('[DeepSeekAdapter] Prompt submitted')
    },

    async waitForCompletion(timeoutMs: number): Promise<void> {
      const page = getDeepSeekPage()
      console.log(`[DeepSeekAdapter] waitForCompletion — timeout: ${timeoutMs}ms`)

      let stopButtonSeen = false

      // Wait for stop button to appear (generation starting)
      try {
        await findFirst(page, SELECTORS.stopButton, 10000)
        stopButtonSeen = true
        console.log('[DeepSeekAdapter] Stop button detected — generation in progress')
      } catch {
        console.log('[DeepSeekAdapter] Stop button not detected — using text stability fallback')
      }

      if (stopButtonSeen) {
        // Wait for stop button to disappear
        await waitUntil(
          async () => {
            const btn = await findFirstOptional(page, SELECTORS.stopButton, 500)
            return btn === null
          },
          timeoutMs,
          1000,
          'stop button disappearance'
        )
        console.log('[DeepSeekAdapter] Stop button disappeared')
        await new Promise((r) => setTimeout(r, 1000))
      }

      // Final: wait for response text to stabilize
      await waitForTextStability(
        async () => {
          try {
            return await this.extractLatestResponse().then((r) => r.text)
          } catch {
            return ''
          }
        },
        stopButtonSeen ? 10000 : timeoutMs,
        2000,
        500,
        'DeepSeek response text stability'
      )

      console.log('[DeepSeekAdapter] Completion detected')
    },

    async extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }> {
      const page = getDeepSeekPage()

      // Try each response block selector — get the LAST .ds-markdown block
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
              console.log(`[DeepSeekAdapter] Extracted response (${text.length} chars) using selector: ${selector}`)
              return { text, conversationUrl: page.url() }
            }
          }
        } catch {
          // try next selector
        }
      }

      throw new Error('[DeepSeekAdapter] Could not extract response text from any known selector')
    },

    // Thinking support via getPhaseContent
    async getPhaseContent() {
      const page = getDeepSeekPage()

      let thinking = ''
      let response = ''

      // Extract thinking from <details> blocks near the last response
      for (const selector of SELECTORS.thinkingBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            const lastThinking = blocks.last()
            thinking = (await lastThinking.innerText()).trim()
            break
          }
        } catch {
          // try next
        }
      }

      // Extract response from .ds-markdown
      for (const selector of SELECTORS.responseBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            response = (await blocks.last().innerText()).trim()
            break
          }
        } catch {
          // try next
        }
      }

      return { thinking, response }
    },

    async isGenerating() {
      const page = getDeepSeekPage()
      const btn = await findFirstOptional(page, SELECTORS.stopButton, 500)
      return btn !== null
    },

    async navigateToNewChat(): Promise<void> {
      const page = getDeepSeekPage()
      console.log('[DeepSeekAdapter] Navigating to new chat')
      await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await findFirst(page, SELECTORS.inputArea, 15000)
      console.log('[DeepSeekAdapter] New chat ready')
    },

    async navigateToThread(url: string): Promise<void> {
      const page = getDeepSeekPage()
      const currentUrl = page.url()
      if (currentUrl === url) {
        console.log('[DeepSeekAdapter] Already on target thread')
        return
      }
      console.log(`[DeepSeekAdapter] Navigating to thread: ${url}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[DeepSeekAdapter] Thread loaded')
      } catch (err) {
        console.warn(`[DeepSeekAdapter] Failed to load thread, falling back to new chat: ${err}`)
        await this.navigateToNewChat()
      }
    },

    async rateLastResponse(): Promise<void> {
      throw new Error('Rating not yet supported for DeepSeek')
    },

    async waitForResponseBlocks(timeoutMs = 15000): Promise<void> {
      const page = getDeepSeekPage()
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
        'DeepSeek response blocks to load'
      )
    },

    async clickRegenerate(): Promise<void> {
      throw new Error('Regeneration not yet supported for DeepSeek')
    },
  }
}
