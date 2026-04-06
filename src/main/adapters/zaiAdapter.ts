import type { Page } from 'playwright'
import { getPage } from '../services/browserSessionManager'
import type { LlmAdapter } from './baseAdapter'
import { waitUntil, waitForTextStability, htmlToMarkdown } from './baseAdapter'

// ---------------------------------------------------------------------------
// Z.AI / Zhipu DOM selectors (chat.z.ai, as of early 2026)
//
// Z.AI (智谱) is a React app. It has a long "thinking/reasoning" phase
// before the actual response. Thinking is typically in a collapsible
// or structurally distinct block from the final response.
//
// The adapter uses semantic selectors first, then structural fallbacks.
// ---------------------------------------------------------------------------

const SELECTORS = {
  inputArea: [
    '[contenteditable="true"]',                         // primary: contenteditable
    'textarea',                                         // fallback: textarea
    '#chat-input',                                      // fallback: ID-based
    '[role="textbox"]',                                 // fallback: ARIA
  ],

  stopButton: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="Cancel"]',
    'button[aria-label*="取消"]',                        // Chinese: cancel
    'button[aria-label*="停止"]',                        // Chinese: stop
  ],

  // Z.AI response blocks — try role/data attributes, then class patterns
  responseBlocks: [
    '[data-role="assistant"]',                          // data-role attribute
    '[data-type="assistant"]',                          // data-type attribute
    '[class*="markdown"]',                              // markdown content
    '[class*="assistant"]',                             // assistant class
    '[class*="message-content"]',                       // message content
    '[class*="answer"]',                                // answer class
    '[class*="response"]',                              // response class
  ],

  // Z.AI thinking blocks — the reasoning/thinking phase
  thinkingBlocks: [
    'details',                                          // collapsible details
    '[class*="thinking"]',                              // thinking class
    '[class*="reason"]',                                // reasoning class
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
  throw new Error(`[ZaiAdapter] None of the selectors matched: ${selectors.join(', ')}`)
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

/**
 * Fallback: find the last substantial text block in the conversation area
 * by DOM position, excluding input/navigation. Selector-independent.
 */
async function extractResponseByPosition(page: Page): Promise<string> {
  return page.evaluate(() => {
    const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea')
    if (!input) return ''

    // Walk up from input to find the conversation scroll container
    let container = input.parentElement
    while (container && container !== document.body) {
      if (container.scrollHeight > 500 && container.clientWidth > 300) break
      container = container.parentElement
    }
    if (!container || container === document.body) return ''

    const blocks = container.querySelectorAll('div, article, section, p')
    let bestBlock: Element | null = null

    for (const block of blocks) {
      if (input.contains(block) || block.contains(input)) continue
      if ((block as HTMLElement).offsetParent === null) continue
      const links = block.querySelectorAll('a[href]')
      if (links.length > 3) continue
      const text = (block.innerText || '').trim()
      if (text.length < 10) continue

      // Check this is a leaf — doesn't contain another block with most of its text
      let isLeaf = true
      for (const child of block.querySelectorAll('div, article, section')) {
        if ((child.innerText || '').trim().length > text.length * 0.8) {
          isLeaf = false
          break
        }
      }

      if (isLeaf && text.length > 20) {
        const rect = (block as HTMLElement).getBoundingClientRect()
        if (rect.top > 0) {
          bestBlock = block
        }
      }
    }

    if (!bestBlock) return ''

    // Walk up from bestBlock to the message container
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
// Z.AI Adapter
// ---------------------------------------------------------------------------

export function createZaiAdapter(): LlmAdapter {
  function getZaiPage(): Page {
    return getPage('zai')
  }

  return {
    provider: 'zai',

    async ensureReady(): Promise<void> {
      const page = getZaiPage()
      const url = page.url()
      console.log(`[ZaiAdapter] ensureReady — current URL: ${url}`)

      if (!url.includes('z.ai') && !url.includes('chatglm') && !url.includes('zhipu')) {
        throw new Error(`[ZaiAdapter] Page is not on Z.AI: ${url}`)
      }

      // navigateToNewChat/navigateToThread already wait for the input area,
      // so use a short timeout here as a quick sanity check.
      try {
        await findFirst(page, SELECTORS.inputArea, 3000)
        console.log('[ZaiAdapter] Page is ready — input area found')
      } catch {
        throw new Error('[ZaiAdapter] Could not find input area. Z.AI may require login.')
      }
    },

    async sendPrompt(prompt: string): Promise<void> {
      const page = getZaiPage()
      console.log(`[ZaiAdapter] sendPrompt — length: ${prompt.length} chars`)

      // ensureReady() already confirmed the input area exists, so use a short timeout
      const inputLocator = await findFirst(page, SELECTORS.inputArea, 2000)
      await inputLocator.click()
      await inputLocator.fill(prompt)

      await new Promise((r) => setTimeout(r, 100))
      await page.keyboard.press('Enter')

      await new Promise((r) => setTimeout(r, 200))
      console.log('[ZaiAdapter] Prompt submitted')
    },

    async waitForCompletion(timeoutMs: number): Promise<void> {
      const page = getZaiPage()
      console.log(`[ZaiAdapter] waitForCompletion — timeout: ${timeoutMs}ms`)

      let stopButtonSeen = false

      try {
        await findFirst(page, SELECTORS.stopButton, 10000)
        stopButtonSeen = true
        console.log('[ZaiAdapter] Stop button detected — generation in progress')
      } catch {
        console.log('[ZaiAdapter] Stop button not detected — using text stability fallback')
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
        console.log('[ZaiAdapter] Stop button disappeared')
        // Z.AI has a long thinking phase — extra wait for actual response to render
        await new Promise((r) => setTimeout(r, 2000))
      }

      // Final: text stability with longer stable window for Z.AI's thinking→response gap.
      // Z.AI generates long responses that can pause >3s mid-stream (server processing),
      // so use a 5s stable window to avoid premature completion detection.
      await waitForTextStability(
        async () => {
          try {
            return await this.extractLatestResponse().then((r) => r.text)
          } catch {
            return ''
          }
        },
        stopButtonSeen ? 30000 : timeoutMs,
        5000, // 5s stable window (Z.AI long responses can pause mid-generation)
        500,
        'Z.AI response text stability'
      )

      console.log('[ZaiAdapter] Completion detected')
    },

    async extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }> {
      const page = getZaiPage()

      // Strategy 1: semantic/class-based selectors
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
                  // Avoid escalating to parent if it contains thinking blocks,
                  // which would mix thinking content into the response text.
                  const hasThinking = parent.querySelector(
                    'details, [class*="thinking"], [class*="reason"], [data-type="thinking"]'
                  )
                  if (!hasThinking) {
                    return parent.innerHTML
                  }
                }
              }
              return last.innerHTML
            }, selector)).trim()
            if (html.length > 0) {
              const text = htmlToMarkdown(html)
              if (text.length > 5) {
                console.log(`[ZaiAdapter] Extracted response (${text.length} chars) using selector: ${selector}`)
                return { text, conversationUrl: page.url() }
              }
            }
          }
        } catch {
          // try next
        }
      }

      // Strategy 2: positional extraction
      console.log('[ZaiAdapter] Selectors failed — trying positional extraction')
      const html = await extractResponseByPosition(page)
      if (html) {
        const text = htmlToMarkdown(html)
        if (text.length > 5) {
          console.log(`[ZaiAdapter] Extracted response via positional fallback (${text.length} chars)`)
          return { text, conversationUrl: page.url() }
        }
      }

      // Log diagnostic info
      const debugInfo = await page.evaluate(() => {
        const allClasses = new Set<string>()
        document.querySelectorAll('[class]').forEach((el) => {
          el.className.split(/\s+/).forEach((c) => {
            if (c.length > 3 && c.length < 40) allClasses.add(c)
          })
        })
        const relevant = [...allClasses].filter((c) =>
          /mark|mess|resp|answ|chat|cont|text|body|prose|articl|think|reason/i.test(c)
        ).slice(0, 20)
        return relevant
      })
      console.log(`[ZaiAdapter] Possibly relevant classes: ${debugInfo.join(', ')}`)

      throw new Error('[ZaiAdapter] Could not extract response text')
    },

    async getPhaseContent() {
      const page = getZaiPage()

      let thinking = ''
      let response = ''

      // Extract thinking
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
      const page = getZaiPage()
      const btn = await findFirstOptional(page, SELECTORS.stopButton, 500)
      return btn !== null
    },

    async navigateToNewChat(): Promise<void> {
      const page = getZaiPage()
      console.log('[ZaiAdapter] Navigating to new chat')
      await page.goto('https://chat.z.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await findFirst(page, SELECTORS.inputArea, 15000)
      console.log('[ZaiAdapter] New chat ready')
    },

    async navigateToThread(url: string): Promise<void> {
      const page = getZaiPage()
      const currentUrl = page.url()
      if (currentUrl === url) {
        console.log('[ZaiAdapter] Already on target thread')
        return
      }
      console.log(`[ZaiAdapter] Navigating to thread: ${url}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[ZaiAdapter] Thread loaded')
      } catch (err) {
        console.warn(`[ZaiAdapter] Failed to load thread, falling back to new chat: ${err}`)
        await this.navigateToNewChat()
      }
    },

    async rateLastResponse(): Promise<void> {
      throw new Error('Rating not yet supported for Z.AI')
    },

    async waitForResponseBlocks(timeoutMs = 15000): Promise<void> {
      const page = getZaiPage()
      await waitUntil(
        async () => {
          for (const selector of SELECTORS.responseBlocks) {
            const count = await page.locator(selector).count()
            if (count > 0) return true
          }
          const html = await extractResponseByPosition(page)
          return html.length > 0
        },
        timeoutMs,
        500,
        'Z.AI response blocks to load'
      )
    },

    async clickRegenerate(): Promise<void> {
      throw new Error('Regeneration not yet supported for Z.AI')
    },
  }
}
