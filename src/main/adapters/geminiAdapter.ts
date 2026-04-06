import type { Page } from 'playwright'
import { getPage } from '../services/browserSessionManager'
import type { LlmAdapter } from './baseAdapter'
import { waitUntil, waitForTextStability, htmlToMarkdown, pasteText } from './baseAdapter'

// ---------------------------------------------------------------------------
// Gemini DOM selectors (as of early 2026)
//
// Gemini uses a rich text editor for input. All selectors are Gemini-specific
// and not shared with Claude or ChatGPT adapters.
// ---------------------------------------------------------------------------

const SELECTORS = {
  // The prompt input area. Gemini uses a rich text editor (contenteditable)
  // or occasionally a plain textarea.
  inputArea: [
    '.ql-editor[contenteditable="true"]',              // primary: Quill editor
    'div[contenteditable="true"][role="textbox"]',     // fallback: ARIA textbox contenteditable
    'rich-textarea [contenteditable="true"]',          // fallback: custom element wrapper
    '[role="textbox"]',                                // fallback: any ARIA textbox
    'div[contenteditable="true"]',                     // fallback: any contenteditable
    'textarea',                                        // fallback: plain textarea
  ],

  // The send button. Gemini shows a send arrow button near the input.
  // The button only appears/becomes enabled after text is entered.
  sendButton: [
    'button[aria-label="Send message"]',               // primary: aria label
    'button[aria-label="Send"]',                       // shorter variant
    'button[aria-label*="Send"]',                      // partial match
    'button[aria-label="Submit"]',                     // alternative label
    'button[aria-label*="Submit"]',                    // partial match
    '.send-button',                                    // class-based
    'button.send-button',                              // class-based with tag
    'button[data-testid="send-button"]',               // test ID
  ],

  // The stop generation button (visible while Gemini is streaming).
  stopButton: [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]',
    'button:has(mat-icon):has-text("stop")',
  ],

  // Assistant response message blocks.
  // Gemini wraps model responses in message containers with specific attributes.
  responseBlocks: [
    'model-response message-content',                  // primary: Gemini's custom elements
    'model-response .markdown',                        // model response with markdown
    'model-response',                                  // bare model-response element
    '.model-response-text',                            // class-based fallback
    'message-content',                                 // custom element fallback
    '[data-message-author="model"]',                   // attribute-based
    '.response-container .markdown',                   // generic response container
  ],

  // Regenerate button on the last model response.
  regenerateButton: [
    'button[aria-label="Regenerate response"]',
    'button[aria-label="Regenerate"]',
    'button[aria-label="Retry"]',
    'button[aria-label*="regenerate"]',
    'button[aria-label*="retry"]',
    'button:has-text("Regenerate")',
  ],
} as const

// ---------------------------------------------------------------------------
// Helpers (Gemini-specific, same pattern as other adapters)
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
  throw new Error(`[GeminiAdapter] None of the selectors matched: ${selectors.join(', ')}`)
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
// Gemini Adapter
// ---------------------------------------------------------------------------

export function createGeminiAdapter(): LlmAdapter {
  function getGeminiPage(): Page {
    return getPage('gemini')
  }

  return {
    provider: 'gemini',

    async ensureReady(): Promise<void> {
      const page = getGeminiPage()
      const url = page.url()
      console.log(`[GeminiAdapter] ensureReady — current URL: ${url}`)

      // Check we are on gemini.google.com
      if (!url.includes('gemini.google.com')) {
        throw new Error(`[GeminiAdapter] Page is not on gemini.google.com: ${url}`)
      }

      // Dismiss common overlays (cookie consent, welcome dialogs)
      await this.dismissOverlays(page)

      // Wait for the input area to be visible
      try {
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[GeminiAdapter] Page is ready — input area found')
      } catch {
        const url = page.url()
        if (url.includes('/signin') || url.includes('accounts.google.com')) {
          throw new Error('[GeminiAdapter] Gemini requires Google login. Please log in manually.')
        }
        throw new Error('[GeminiAdapter] Could not find input area. The page may not be ready.')
      }
    },

    async dismissOverlays(page: Page): Promise<void> {
      // Gemini may show cookie consent, welcome tour, or policy dialogs.
      const dismissSelectors = [
        'button:has-text("Got it")',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Dismiss")',
        'button:has-text("No thanks")',
        'button:has-text("Skip")',
        'button:has-text("OK")',
        '[aria-label="Close"]',
        '[aria-label="Dismiss"]',
      ]

      for (const selector of dismissSelectors) {
        try {
          const btn = page.locator(selector).first()
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click()
            console.log(`[GeminiAdapter] Dismissed overlay with: ${selector}`)
            await new Promise((r) => setTimeout(r, 300))
          }
        } catch {
          // no overlay — fine
        }
      }
    },

    async sendPrompt(prompt: string): Promise<void> {
      const page = getGeminiPage()
      console.log(`[GeminiAdapter] sendPrompt — length: ${prompt.length} chars`)

      // Find the input area
      const inputLocator = await findFirst(page, SELECTORS.inputArea, 10000)

      // Click to focus
      await inputLocator.click()

      // Determine input type and use appropriate strategy
      const tagName = await inputLocator.evaluate((el) => el.tagName.toLowerCase())
      if (tagName === 'textarea') {
        await inputLocator.fill(prompt)
        console.log('[GeminiAdapter] Used fill() on textarea')
      } else {
        // For Gemini's Quill editor, use clipboard paste for reliability and speed
        await inputLocator.fill('')
        try {
          await page.evaluate((text) => {
            const el = document.querySelector('.ql-editor[contenteditable="true"]') ||
                       document.querySelector('[role="textbox"][contenteditable="true"]') ||
                       document.querySelector('[contenteditable="true"]')
            if (el) {
              el.innerHTML = `<p>${text.replace(/\n/g, '</p><p>')}</p>`
              el.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }, prompt)
          console.log('[GeminiAdapter] Used innerHTML injection on Quill editor')
        } catch {
          await pasteText(page, inputLocator, prompt)
          console.log('[GeminiAdapter] Fallback: used clipboard paste on contenteditable')
        }
      }

      // Wait for the UI to register input and enable the send button
      await new Promise((r) => setTimeout(r, 500))

      // Find and click the send button
      // The send button only appears after text is entered, so allow time
      let sent = false
      try {
        const sendBtn = await findFirst(page, SELECTORS.sendButton, 5000)
        await sendBtn.click()
        console.log('[GeminiAdapter] Send button clicked')
        sent = true
      } catch {
        console.log('[GeminiAdapter] Named send button not found, trying icon button near input')
      }

      // Fallback: find the send button by proximity to the input area
      // Gemini typically places it as the last enabled button near the input
      if (!sent) {
        try {
          // Look for any enabled button with an SVG icon that's near the input
          const iconBtn = await page.locator('.input-area-container button:not([disabled]), .input-buttons-wrapper button:not([disabled]), .input-wrapper button:not([disabled])').last()
          if (await iconBtn.isVisible({ timeout: 2000 })) {
            await iconBtn.click()
            console.log('[GeminiAdapter] Clicked icon button near input area')
            sent = true
          }
        } catch {
          // continue to Enter fallback
        }
      }

      // Last resort: Enter key on the focused input
      if (!sent) {
        console.log('[GeminiAdapter] Trying Enter key fallback')
        await inputLocator.click()
        await page.keyboard.press('Enter')
      }

      // Brief wait for the submission to register
      await new Promise((r) => setTimeout(r, 500))
      console.log('[GeminiAdapter] Prompt submitted')
    },

    async waitForCompletion(timeoutMs: number): Promise<void> {
      const page = getGeminiPage()
      console.log(`[GeminiAdapter] waitForCompletion — timeout: ${timeoutMs}ms`)

      let stopButtonSeen = false

      // Wait up to 10s for the stop button to appear
      try {
        await findFirst(page, SELECTORS.stopButton, 10000)
        stopButtonSeen = true
        console.log('[GeminiAdapter] Stop button detected — generation in progress')
      } catch {
        console.log('[GeminiAdapter] Stop button not detected — using text stability fallback')
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
        console.log('[GeminiAdapter] Stop button disappeared — generation likely complete')
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
        stopButtonSeen ? 10000 : timeoutMs,
        2000,
        500,
        'Gemini response text stability'
      )

      console.log('[GeminiAdapter] Completion detected')
    },

    async extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }> {
      const page = getGeminiPage()

      // Try each response block selector
      for (const selector of SELECTORS.responseBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            const lastBlock = blocks.last()
            const html = (await lastBlock.innerHTML()).trim()
            if (html.length > 0) {
              const text = htmlToMarkdown(html)
              console.log(`[GeminiAdapter] Extracted response (${text.length} chars) using selector: ${selector}`)
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

      throw new Error('[GeminiAdapter] Could not extract response text from any known selector')
    },

    async navigateToNewChat(): Promise<void> {
      const page = getGeminiPage()
      console.log('[GeminiAdapter] Navigating to new chat')
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await findFirst(page, SELECTORS.inputArea, 15000)
      console.log('[GeminiAdapter] New chat ready')
    },

    async navigateToThread(url: string): Promise<void> {
      const page = getGeminiPage()
      const currentUrl = page.url()
      if (currentUrl === url) {
        console.log('[GeminiAdapter] Already on target thread')
        return
      }
      console.log(`[GeminiAdapter] Navigating to thread: ${url}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[GeminiAdapter] Thread loaded')
      } catch (err) {
        console.warn(`[GeminiAdapter] Failed to load thread, falling back to new chat: ${err}`)
        await this.navigateToNewChat()
      }
    },

    async rateLastResponse(rating: 'good' | 'bad'): Promise<void> {
      const page = getGeminiPage()
      console.log(`[GeminiAdapter] Rating last response: ${rating}`)

      // Gemini shows thumbs-up/down buttons beneath model responses.
      const ratingSelectors = rating === 'good'
        ? [
            'button[aria-label="Good response"]',
            'button[aria-label="Thumbs up"]',
            'button[aria-label="Like"]',
            'button[aria-label*="good"]',
            'button[aria-label*="like"]',
          ]
        : [
            'button[aria-label="Bad response"]',
            'button[aria-label="Thumbs down"]',
            'button[aria-label="Dislike"]',
            'button[aria-label*="bad"]',
            'button[aria-label*="dislike"]',
          ]

      try {
        // Hover over last response to reveal action buttons
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
              console.log(`[GeminiAdapter] Clicked rating button: ${selector}`)
              return
            }
          } catch { /* try next */ }
        }

        console.warn('[GeminiAdapter] Rating button not found — rating not sent to portal')
      } catch (err) {
        console.warn(`[GeminiAdapter] Failed to rate on portal: ${err}`)
      }
    },

    async waitForResponseBlocks(timeoutMs = 15000): Promise<void> {
      const page = getGeminiPage()
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
        'Gemini response blocks to load'
      )
    },

    async clickRegenerate(): Promise<void> {
      const page = getGeminiPage()
      console.log('[GeminiAdapter] Clicking regenerate button')

      // Use page.evaluate to simulate hover (works even when window not focused)
      const hoverResult = await page.evaluate(() => {
        const responses = document.querySelectorAll('model-response')
        if (responses.length === 0) return 'no-responses'
        const lastResponse = responses[responses.length - 1]

        lastResponse.scrollIntoView({ block: 'end' })

        // Simulate hover events to trigger button rendering
        lastResponse.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        lastResponse.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

        const parent = lastResponse.parentElement
        if (parent) {
          parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
          parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        }

        return 'hovered'
      })

      if (hoverResult === 'no-responses') {
        throw new Error('[GeminiAdapter] No model responses found on page')
      }

      // Wait for action buttons to render
      await new Promise((r) => setTimeout(r, 800))

      // Strategy 1: Named selectors
      for (const selector of SELECTORS.regenerateButton) {
        try {
          const btn = page.locator(selector).last()
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click()
            console.log(`[GeminiAdapter] Clicked regenerate: ${selector}`)
            await new Promise((r) => setTimeout(r, 500))
            return
          }
        } catch { /* try next */ }
      }

      // Strategy 2: Scan visible buttons near the last response
      const found = await page.evaluate(() => {
        const responses = document.querySelectorAll('model-response')
        if (responses.length === 0) return { clicked: false, reason: 'no-responses' }
        const lastResponse = responses[responses.length - 1]

        // Search in the response and up to 2 parent levels
        const searchAreas = [lastResponse, lastResponse.parentElement, lastResponse.parentElement?.parentElement].filter(Boolean) as Element[]
        const seenBtns = new Set<Element>()
        const btnInfo: string[] = []

        for (const area of searchAreas) {
          const buttons = area.querySelectorAll('button')
          for (const btn of buttons) {
            if (seenBtns.has(btn)) continue
            seenBtns.add(btn)
            if (btn.offsetParent === null) continue // hidden

            const label = (btn.getAttribute('aria-label') || '').toLowerCase()
            const tooltip = (btn.getAttribute('mattooltip') || btn.getAttribute('data-tooltip') || '').toLowerCase()
            const text = (btn.textContent || '').trim().toLowerCase()

            btnInfo.push(`label="${label}" tooltip="${tooltip}" text="${text.slice(0, 30)}"`)

            if (label.includes('regen') || label.includes('retry') || label.includes('redo') ||
                label.includes('draft') || label.includes('rewrite') ||
                tooltip.includes('regen') || tooltip.includes('retry') || tooltip.includes('draft') ||
                text === 'regenerate' || text === 'retry' || text === 'regenerate draft' ||
                text.includes('regenerate')) {
              btn.click()
              return { clicked: true, via: `label="${label}" tooltip="${tooltip}" text="${text}"` }
            }
          }
        }

        // Try mat-icon elements
        for (const area of searchAreas) {
          const matIcons = area.querySelectorAll('mat-icon')
          for (const icon of matIcons) {
            const name = (icon.textContent || '').trim().toLowerCase()
            if (name === 'refresh' || name === 'autorenew' || name === 'replay' || name === 'redo' || name === 'restart_alt') {
              const btn = icon.closest('button')
              if (btn) {
                btn.click()
                return { clicked: true, via: `mat-icon="${name}"` }
              }
            }
          }
        }

        console.log('[GeminiAdapter] Buttons near response:', JSON.stringify(btnInfo))
        return { clicked: false, btnCount: seenBtns.size }
      })

      if (found.clicked) {
        console.log(`[GeminiAdapter] Clicked regenerate via scan: ${(found as { via: string }).via}`)
        await new Promise((r) => setTimeout(r, 500))
        return
      }

      console.warn(`[GeminiAdapter] ${(found as { btnCount?: number }).btnCount ?? 0} buttons found near response but none matched regenerate`)
      throw new Error('[GeminiAdapter] Regenerate button not found')
    },
  } as LlmAdapter & { dismissOverlays(page: Page): Promise<void> }
}
