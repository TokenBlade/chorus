import type { Page } from 'playwright'
import { getPage } from '../services/browserSessionManager'
import type { LlmAdapter } from './baseAdapter'
import { waitUntil, waitForTextStability, htmlToMarkdown, pasteText } from './baseAdapter'

// ---------------------------------------------------------------------------
// ChatGPT DOM selectors (as of early 2026)
//
// ChatGPT uses a rich text editor (ProseMirror-based) for input.
// Selectors are ordered by reliability. All ChatGPT-specific — not shared
// with Claude or Gemini adapters.
// ---------------------------------------------------------------------------

const SELECTORS = {
  // The prompt input area. ChatGPT typically uses a contenteditable div
  // inside a form, or occasionally a <textarea> in older layouts.
  inputArea: [
    '#prompt-textarea',                                // primary: known stable ID
    'div[contenteditable="true"][id="prompt-textarea"]', // explicit contenteditable variant
    '[role="textbox"]',                                // fallback: ARIA textbox
    'div[contenteditable="true"]',                     // fallback: any contenteditable
    'textarea',                                        // fallback: plain textarea (older UI)
  ],

  // The send button. ChatGPT shows a send arrow button near the input.
  sendButton: [
    'button[data-testid="send-button"]',               // primary: test ID
    'button[aria-label="Send prompt"]',                // aria label variant
    'button[aria-label="Send"]',                       // shorter aria label
    'form button[type="submit"]',                      // fallback: submit button in form
    'button:has(svg path[d*="M15.192"])',              // fallback: send arrow icon path
  ],

  // The stop generation button (visible while ChatGPT is streaming).
  stopButton: [
    'button[data-testid="stop-button"]',               // primary: test ID
    'button[aria-label="Stop streaming"]',             // aria label
    'button[aria-label="Stop generating"]',            // aria label variant
    'button[aria-label="Stop"]',                       // short variant
  ],

  // Assistant response message blocks. ChatGPT wraps each assistant turn
  // in a container with data-message-author-role or similar attributes.
  responseBlocks: [
    '[data-message-author-role="assistant"]',          // primary: role attribute on message
    'div[data-message-id] .markdown',                  // message with markdown content
    '.agent-turn .markdown',                           // agent turn with markdown
    '[class*="markdown"]',                             // any markdown-rendered block
  ],

  // Regenerate button on the last assistant response.
  regenerateButton: [
    'button[data-testid="regenerate-turn-action-button"]',
    'button[aria-label="Regenerate"]',
    'button[aria-label="Regenerate response"]',
    'button[aria-label="Retry"]',
    'button:has-text("Regenerate")',
  ],
} as const

// ---------------------------------------------------------------------------
// Helpers (ChatGPT-specific, mirror pattern from Claude adapter)
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
  throw new Error(`[ChatGPTAdapter] None of the selectors matched: ${selectors.join(', ')}`)
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
// ChatGPT Adapter
// ---------------------------------------------------------------------------

export function createChatGPTAdapter(): LlmAdapter {
  function getChatGPTPage(): Page {
    return getPage('chatgpt')
  }

  return {
    provider: 'chatgpt',

    async ensureReady(): Promise<void> {
      const page = getChatGPTPage()
      const url = page.url()
      console.log(`[ChatGPTAdapter] ensureReady — current URL: ${url}`)

      // Check we are on chatgpt.com
      if (!url.includes('chatgpt.com')) {
        throw new Error(`[ChatGPTAdapter] Page is not on chatgpt.com: ${url}`)
      }

      // Dismiss common popups/overlays that may block interaction
      await this.dismissOverlays(page)

      // Wait for the input area to be visible
      try {
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[ChatGPTAdapter] Page is ready — input area found')
      } catch {
        const url = page.url()
        if (url.includes('/auth') || url.includes('login')) {
          throw new Error('[ChatGPTAdapter] ChatGPT requires login. Please log in manually.')
        }
        throw new Error('[ChatGPTAdapter] Could not find input area. The page may not be ready.')
      }
    },

    // Not part of LlmAdapter interface — internal helper
    async dismissOverlays(page: Page): Promise<void> {
      // ChatGPT sometimes shows modal dialogs, upgrade prompts, or cookie banners.
      // Try to dismiss them non-destructively.
      const dismissSelectors = [
        'button:has-text("Stay logged out")',
        'button:has-text("Dismiss")',
        'button:has-text("No thanks")',
        'button:has-text("Maybe later")',
        'button:has-text("Got it")',
        'button:has-text("OK")',
        '[aria-label="Close"]',
        '[aria-label="Dismiss"]',
      ]

      for (const selector of dismissSelectors) {
        try {
          const btn = page.locator(selector).first()
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click()
            console.log(`[ChatGPTAdapter] Dismissed overlay with: ${selector}`)
            await new Promise((r) => setTimeout(r, 300))
          }
        } catch {
          // no overlay to dismiss — fine
        }
      }
    },

    async sendPrompt(prompt: string): Promise<void> {
      const page = getChatGPTPage()
      console.log(`[ChatGPTAdapter] sendPrompt — length: ${prompt.length} chars`)

      // Find the input area
      const inputLocator = await findFirst(page, SELECTORS.inputArea, 10000)

      // Click to focus
      await inputLocator.click()

      // ChatGPT uses a ProseMirror contenteditable editor.
      // pressSequentially sends \n as Enter keystrokes which submits the message,
      // splitting multi-paragraph prompts. Use clipboard paste instead.
      const tagName = await inputLocator.evaluate((el) => el.tagName.toLowerCase())
      if (tagName === 'textarea') {
        await inputLocator.fill(prompt)
        console.log('[ChatGPTAdapter] Used fill() on textarea')
      } else {
        await pasteText(page, inputLocator, prompt)
        console.log('[ChatGPTAdapter] Used clipboard paste on contenteditable')
      }

      // Short pause to let the UI register the input
      await new Promise((r) => setTimeout(r, 300))

      // Find and click the send button
      try {
        const sendBtn = await findFirst(page, SELECTORS.sendButton, 5000)
        await sendBtn.click()
        console.log('[ChatGPTAdapter] Send button clicked')
      } catch {
        // Fallback: try pressing Enter (ChatGPT submits on Enter by default)
        console.log('[ChatGPTAdapter] Send button not found, trying Enter key')
        await page.keyboard.press('Enter')
      }

      // Brief wait for the submission to register
      await new Promise((r) => setTimeout(r, 500))
      console.log('[ChatGPTAdapter] Prompt submitted')
    },

    async waitForCompletion(timeoutMs: number): Promise<void> {
      const page = getChatGPTPage()
      console.log(`[ChatGPTAdapter] waitForCompletion — timeout: ${timeoutMs}ms`)

      // Strategy 1: Wait for the stop button to appear then disappear.
      // Strategy 2: If stop button never appears, use text stability.

      let stopButtonSeen = false

      // Wait up to 10s for the stop button to appear (generation starting)
      try {
        await findFirst(page, SELECTORS.stopButton, 10000)
        stopButtonSeen = true
        console.log('[ChatGPTAdapter] Stop button detected — generation in progress')
      } catch {
        console.log('[ChatGPTAdapter] Stop button not detected — using text stability fallback')
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
        console.log('[ChatGPTAdapter] Stop button disappeared — generation likely complete')
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
        stopButtonSeen ? 10000 : timeoutMs,
        2000,
        500,
        'ChatGPT response text stability'
      )

      console.log('[ChatGPTAdapter] Completion detected')
    },

    async extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }> {
      const page = getChatGPTPage()

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
              console.log(`[ChatGPTAdapter] Extracted response (${text.length} chars) using selector: ${selector}`)
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

      throw new Error('[ChatGPTAdapter] Could not extract response text from any known selector')
    },

    async navigateToNewChat(): Promise<void> {
      const page = getChatGPTPage()
      console.log('[ChatGPTAdapter] Navigating to new chat')
      await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await findFirst(page, SELECTORS.inputArea, 15000)
      console.log('[ChatGPTAdapter] New chat ready')
    },

    async navigateToThread(url: string): Promise<void> {
      const page = getChatGPTPage()
      const currentUrl = page.url()
      if (currentUrl === url) {
        console.log('[ChatGPTAdapter] Already on target thread')
        return
      }
      console.log(`[ChatGPTAdapter] Navigating to thread: ${url}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await findFirst(page, SELECTORS.inputArea, 15000)
        console.log('[ChatGPTAdapter] Thread loaded')
      } catch (err) {
        console.warn(`[ChatGPTAdapter] Failed to load thread, falling back to new chat: ${err}`)
        await this.navigateToNewChat()
      }
    },

    async rateLastResponse(rating: 'good' | 'bad'): Promise<void> {
      const page = getChatGPTPage()
      console.log(`[ChatGPTAdapter] Rating last response: ${rating}`)

      // ChatGPT shows thumbs-up/down buttons beneath each assistant message.
      const ratingSelectors = rating === 'good'
        ? [
            'button[aria-label="Good response"]',
            'button[aria-label="Thumbs up"]',
            'button[aria-label="Like"]',
            'button[data-testid="good-response-turn-action-button"]',
          ]
        : [
            'button[aria-label="Bad response"]',
            'button[aria-label="Thumbs down"]',
            'button[aria-label="Dislike"]',
            'button[data-testid="bad-response-turn-action-button"]',
          ]

      try {
        // Find the last assistant message and hover to ensure buttons are visible
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
              console.log(`[ChatGPTAdapter] Clicked rating button: ${selector}`)
              return
            }
          } catch { /* try next */ }
        }

        console.warn('[ChatGPTAdapter] Rating button not found — rating not sent to portal')
      } catch (err) {
        console.warn(`[ChatGPTAdapter] Failed to rate on portal: ${err}`)
      }
    },

    async waitForResponseBlocks(timeoutMs = 15000): Promise<void> {
      const page = getChatGPTPage()
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
        'ChatGPT response blocks to load'
      )
    },

    async clickRegenerate(): Promise<void> {
      const page = getChatGPTPage()
      console.log('[ChatGPTAdapter] Clicking regenerate button')

      // Step 1: Scroll to last assistant message and hover with Playwright (real mouse)
      for (const selector of SELECTORS.responseBlocks) {
        try {
          const blocks = page.locator(selector)
          const count = await blocks.count()
          if (count > 0) {
            await blocks.last().scrollIntoViewIfNeeded()
            await blocks.last().hover({ force: true })
            console.log(`[ChatGPTAdapter] Hovered over last response: ${selector} (${count} blocks)`)
            await new Promise((r) => setTimeout(r, 1000))
            break
          }
        } catch (err) {
          console.log(`[ChatGPTAdapter] Hover failed for ${selector}: ${err}`)
        }
      }

      // Step 2: Also try dispatchEvent as backup hover trigger
      await page.evaluate(() => {
        const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
        if (msgs.length === 0) return
        const lastMsg = msgs[msgs.length - 1]
        const article = lastMsg.closest('article') || lastMsg.closest('[data-message-id]') || lastMsg.parentElement
        if (article) {
          article.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
          article.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
          // Also try pointer events (React 17+ uses these)
          article.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
          article.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        }
      })
      await new Promise((r) => setTimeout(r, 800))

      // Step 3: Try named selectors
      for (const selector of SELECTORS.regenerateButton) {
        try {
          const btn = page.locator(selector).last()
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click()
            console.log(`[ChatGPTAdapter] Clicked regenerate: ${selector}`)
            await new Promise((r) => setTimeout(r, 500))
            return
          }
        } catch { /* try next */ }
      }

      // Step 4: Dump all visible buttons near response for debugging, and try to find regenerate
      const found = await page.evaluate(() => {
        // Find buttons near the last assistant message
        const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null
        const article = lastMsg?.closest('article') || lastMsg?.closest('[data-message-id]')
        const searchRoot = article?.parentElement?.parentElement || article?.parentElement || document.body

        const allBtns = Array.from(searchRoot.querySelectorAll('button'))
          .filter((b) => b.offsetParent !== null)

        const btnInfo: string[] = []
        for (const btn of allBtns) {
          const label = (btn.getAttribute('aria-label') || '')
          const testId = (btn.getAttribute('data-testid') || '')
          const text = (btn.textContent || '').trim()
          const cls = (btn.className || '')
          btnInfo.push(`aria="${label}" testId="${testId}" text="${text.slice(0, 40)}" class="${cls.slice(0, 60)}"`)

          const ll = label.toLowerCase()
          const tl = testId.toLowerCase()
          const tx = text.toLowerCase()
          if (ll.includes('regen') || ll.includes('retry') || ll.includes('redo') ||
              tl.includes('regen') || tl.includes('retry') ||
              tx === 'regenerate' || tx === 'retry') {
            btn.click()
            return { clicked: true, via: `aria="${label}" testId="${testId}"` }
          }
        }

        console.log('[ChatGPTAdapter] All buttons near response:', JSON.stringify(btnInfo))
        return { clicked: false, buttons: btnInfo }
      })

      if (found.clicked) {
        console.log(`[ChatGPTAdapter] Clicked regenerate: ${(found as { via: string }).via}`)
        return
      }

      // Step 5: ChatGPT hides Regenerate inside "More actions" menu — click it to open dropdown
      try {
        const moreBtn = page.locator('button[aria-label="More actions"]').last()
        if (await moreBtn.isVisible({ timeout: 1000 })) {
          await moreBtn.click()
          console.log('[ChatGPTAdapter] Opened "More actions" menu')
          await new Promise((r) => setTimeout(r, 500))

          // Look for Regenerate in the dropdown menu
          const menuSelectors = [
            '[role="menuitem"]:has-text("Try again")',
            '[role="menuitem"]:has-text("Regenerate")',
            '[role="menuitem"]:has-text("Retry")',
            'div:has-text("Try again")',
            'div:has-text("Regenerate")',
          ]
          for (const sel of menuSelectors) {
            try {
              const item = page.locator(sel).first()
              if (await item.isVisible({ timeout: 1000 })) {
                await item.click()
                console.log(`[ChatGPTAdapter] Clicked regenerate menu item: ${sel}`)
                await new Promise((r) => setTimeout(r, 500))
                return
              }
            } catch { /* try next */ }
          }

          // Fallback: scan menu items by text content
          const menuClicked = await page.evaluate(() => {
            const items = document.querySelectorAll('[role="menuitem"], [role="option"]')
            for (const item of items) {
              const text = (item.textContent || '').trim().toLowerCase()
              if (text.includes('regenerat') || text.includes('retry') || text.includes('try again') || text === 'redo') {
                (item as HTMLElement).click()
                return text
              }
            }
            // Also check generic clickable divs in popover
            const popover = document.querySelector('[data-radix-popper-content-wrapper], [role="menu"]')
            if (popover) {
              const divs = popover.querySelectorAll('div[role="menuitem"], div[tabindex]')
              for (const div of divs) {
                const text = (div.textContent || '').trim().toLowerCase()
                if (text.includes('regenerat') || text.includes('retry') || text.includes('try again')) {
                  (div as HTMLElement).click()
                  return text
                }
              }
            }
            return null
          })

          if (menuClicked) {
            console.log(`[ChatGPTAdapter] Clicked regenerate from menu: "${menuClicked}"`)
            return
          }

          // Dump menu contents for debugging
          const menuDump = await page.evaluate(() => {
            const items: string[] = []
            // Check all common menu/popover containers
            const containers = document.querySelectorAll(
              '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], ' +
              '[data-radix-menu-content], [class*="popover"], [class*="dropdown"], [class*="menu"]'
            )
            for (const c of containers) {
              if ((c as HTMLElement).offsetParent === null) continue
              const children = c.querySelectorAll('*')
              for (const child of children) {
                const text = (child.textContent || '').trim()
                if (text.length > 0 && text.length < 50) {
                  const tag = child.tagName.toLowerCase()
                  const role = child.getAttribute('role') || ''
                  items.push(`<${tag} role="${role}"> "${text}"`)
                }
              }
            }
            return items.slice(0, 30)
          })
          console.log('[ChatGPTAdapter] Menu contents:', JSON.stringify(menuDump))

          // Close the menu if we couldn't find regenerate
          await page.keyboard.press('Escape')
        }
      } catch (err) {
        console.warn(`[ChatGPTAdapter] More actions menu approach failed: ${err}`)
      }

      // Log what we found for debugging
      const buttons = (found as { buttons: string[] }).buttons || []
      console.warn(`[ChatGPTAdapter] ${buttons.length} buttons found. Samples: ${buttons.slice(-10).join(' | ')}`)
      throw new Error('[ChatGPTAdapter] Regenerate button not found')
    },
  } as LlmAdapter & { dismissOverlays(page: Page): Promise<void> }
}
