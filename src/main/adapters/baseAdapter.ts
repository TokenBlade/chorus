import type { Page, Locator } from 'playwright'
import { clipboard } from 'electron'
import type { ProviderName } from '../types/provider'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

// Enable GFM features: tables, strikethrough, task lists
turndown.use(gfm)

// Extract LaTeX from data-math attribute (Gemini pattern).
// Gemini wraps math in <div class="math-block" data-math="LATEX"> with KaTeX inside,
// but omits the <annotation> element. The data-math attribute is the only LaTeX source.
turndown.addRule('dataMathAttribute', {
  filter(node) {
    return !!(node as HTMLElement).getAttribute?.('data-math')
  },
  replacement(_content, node) {
    const el = node as HTMLElement
    const latex = el.getAttribute('data-math') || ''
    if (!latex) return _content
    if (el.classList?.contains('math-block') || el.querySelector?.('.katex-display')) {
      return `\n$$${latex}$$\n`
    }
    return `$${latex}$`
  },
})

// Handle entire KaTeX containers at once — extract LaTeX from the annotation element,
// skip both the MathML tree and the visual rendering spans.
// The annotation element is in the MathML namespace so its nodeName is lowercase
// "annotation", not "ANNOTATION". Matching at the .katex container level avoids this
// issue and prevents any child content from leaking through.
turndown.addRule('katexContainer', {
  filter(node) {
    const el = node as HTMLElement
    if (!el.classList) return false
    return el.classList.contains('katex') || el.classList.contains('katex-display')
  },
  replacement(_content, node) {
    const el = node as HTMLElement
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
    if (!annotation) return _content
    const latex = annotation.textContent || ''
    if (el.classList.contains('katex-display')) return `\n$$\n${latex}\n$$\n`
    return `$${latex}$`
  },
})

// Fallback: match annotation elements directly (e.g., KaTeX used without .katex wrapper).
// nodeName is lowercase "annotation" in MathML namespace.
turndown.addRule('katexMath', {
  filter(node) {
    return node.nodeName.toLowerCase() === 'annotation'
      && node.getAttribute('encoding') === 'application/x-tex'
  },
  replacement(_content, node) {
    const latex = node.textContent || ''
    const mathContainer = node.closest?.('.katex-display') || node.closest?.('[data-math-style="display"]')
    if (mathContainer) return `$$\n${latex}\n$$`
    return `$${latex}$`
  },
})

// Skip the visual KaTeX rendering spans — safety net in case katexContainer doesn't match
turndown.addRule('katexSkipRendering', {
  filter(node) {
    const el = node as HTMLElement
    if (el.classList?.contains('katex-html')) return true
    if (el.classList?.contains('katex-mathml')) return true
    return false
  },
  replacement() {
    return ''
  },
})

// Handle MathJax v3 containers (<mjx-container>) — used by Gemini, Moonshot, and others.
// MathJax v3 renders math as SVG or CSS with custom elements (<mjx-math>, <mjx-c>, etc.)
// whose text content is empty (characters rendered via CSS ::before pseudo-elements).
// The LaTeX source lives in <mjx-assistive-mml> > <math> > <annotation encoding="application/x-tex">.
turndown.addRule('mathjaxV3Container', {
  filter(node) {
    return node.nodeName.toLowerCase() === 'mjx-container'
  },
  replacement(_content, node) {
    const el = node as HTMLElement
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
    if (!annotation) return _content
    const latex = annotation.textContent || ''
    const isDisplay = el.getAttribute('display') === 'true' || el.getAttribute('display') === 'block'
    return isDisplay ? `\n$$\n${latex}\n$$\n` : `$${latex}$`
  },
})

// Handle <math> MathML elements directly — extract LaTeX from annotation if present,
// otherwise suppress to prevent garbled MathML element text from leaking through.
turndown.addRule('mathmlElement', {
  filter(node) {
    return node.nodeName.toLowerCase() === 'math'
  },
  replacement(_content, node) {
    const el = node as HTMLElement
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
    if (annotation) {
      const latex = annotation.textContent || ''
      const isDisplay = el.getAttribute('display') === 'block'
      return isDisplay ? `\n$$\n${latex}\n$$\n` : `$${latex}$`
    }
    // No annotation — preserve Turndown's text conversion of MathML
    // (may be garbled like "ex" for e^x, but better than losing math entirely)
    return _content
  },
})

// Handle MathJax v2 containers (.MathJax class) and script tags with LaTeX
turndown.addRule('mathjaxMath', {
  filter(node) {
    const el = node as HTMLElement
    if (el.classList?.contains('MathJax') || el.getAttribute('data-mathml')) return true
    if (node.nodeName === 'SCRIPT' && el.getAttribute('type')?.includes('math/tex')) return true
    return false
  },
  replacement(_content, node) {
    if (node.nodeName === 'SCRIPT') {
      const latex = node.textContent || ''
      const type = node.getAttribute('type') || ''
      if (type.includes('display')) return `$$\n${latex}\n$$`
      return `$${latex}$`
    }
    // For .MathJax containers, try to find annotation
    const el = node as HTMLElement
    const annotation = el.querySelector?.('annotation[encoding="application/x-tex"]')
    if (annotation) {
      const latex = annotation.textContent || ''
      return `$${latex}$`
    }
    return ''
  },
})

// Strip <style> tags — their CSS text content leaks into output
turndown.addRule('stripStyle', {
  filter: 'style',
  replacement() {
    return ''
  },
})

// Strip <script> tags — but let mathjaxMath rule handle math/tex scripts
turndown.addRule('stripScript', {
  filter(node) {
    if (node.nodeName !== 'SCRIPT') return false
    const type = (node as HTMLElement).getAttribute('type') || ''
    if (type.includes('math/tex')) return false
    return true
  },
  replacement() {
    return ''
  },
})

// Strip <iframe> elements (Claude artifacts sometimes render in iframes)
turndown.addRule('stripIframe', {
  filter: 'iframe',
  replacement() {
    return ''
  },
})

// Strip SVG elements (icons, decorations)
turndown.addRule('stripSvg', {
  filter: 'svg',
  replacement() {
    return ''
  },
})

// Strip interactive UI buttons that are part of portal chrome, not content.
// These include copy buttons, "visualize", "show_widget", expand/collapse, etc.
turndown.addRule('stripUiButtons', {
  filter(node) {
    if (node.nodeName !== 'BUTTON') return false
    const el = node as HTMLElement
    // Buttons with aria-labels that indicate UI actions
    const label = el.getAttribute('aria-label') || ''
    if (/copy|expand|collapse|visualize|widget|download|share|retry|edit/i.test(label)) return true
    // Buttons with very short text that are likely icon buttons
    const text = (el.textContent || '').trim()
    if (text.length <= 2 && el.querySelector('svg')) return true
    return false
  },
  replacement() {
    return ''
  },
})

/**
 * Pre-process HTML before Turndown conversion.
 * Removes non-content elements that Turndown doesn't handle well.
 */
function sanitizeHtml(html: string): string {
  // Extract LaTeX from MathJax v3 containers BEFORE stripping SVGs.
  // MathJax v3 renders math as SVG inside <mjx-container>. The LaTeX source lives in
  // <annotation encoding="application/x-tex"> inside <mjx-assistive-mml>.
  // Replace the entire container with $latex$ or $$latex$$ to preserve math.
  let cleaned = html.replace(/<mjx-container\b[^>]*>([\s\S]*?)<\/mjx-container>/gi, (match, inner) => {
    const annot = inner.match(/<annotation[^>]*encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/i)
    if (annot) {
      const latex = annot[1].trim()
      const isDisplay = /display\s*=\s*["'](?:true|block)["']/i.test(match)
      return isDisplay ? `\n$$${latex}$$\n` : `$${latex}$`
    }
    return match
  })
  // Remove <style> blocks (including content) that may survive as text
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '')
  // Remove <script> blocks — but preserve <script type="math/tex"> (MathJax v2 LaTeX source)
  cleaned = cleaned.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs) => {
    if (/type\s*=\s*["']math\/tex/i.test(attrs)) return match
    return ''
  })
  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')
  // Remove <svg> blocks (icons, decorations — math SVGs already extracted above)
  cleaned = cleaned.replace(/<svg[\s\S]*?<\/svg>/gi, '')
  // Remove <iframe> blocks
  cleaned = cleaned.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  // Flatten block-level elements inside table cells to prevent broken table markdown.
  // Some sites (Z.AI, Kimi) wrap cell content in <p>/<div> tags, which causes
  // Turndown to insert paragraph breaks that split table rows across lines.
  // Only strips block-level wrappers — preserves inline formatting (strong, em, code, a).
  cleaned = cleaned.replace(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tag, attrs, inner) => {
    const flat = inner
      .replace(/<\/?(p|div)[^>]*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return `<${tag}${attrs}>${flat}</${tag}>`
  })
  return cleaned
}

/**
 * Post-process markdown to remove known UI artifact patterns
 * that survive HTML sanitization (e.g., Claude's artifact widget triggers).
 */
function cleanMarkdown(md: string): string {
  let cleaned = md
  // Remove Claude artifact widget patterns:
  // "V\n\nvisualize show_widget" or "V\n\nvisualize"
  // These appear as collapsed chevron + action labels from Claude's UI
  cleaned = cleaned.replace(/\nV\n\nvisualize\s+show_widget\b/g, '')
  cleaned = cleaned.replace(/\nV\n\nvisualize\b/g, '')
  // Also handle variant with extra whitespace or at start of text
  cleaned = cleaned.replace(/^V\n\nvisualize\s+show_widget\b/g, '')
  cleaned = cleaned.replace(/^V\n\nvisualize\b/g, '')
  // Collapse 3+ consecutive blank lines into 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.trim()
}

/**
 * Convert HTML (from LLM portal DOM) back to markdown.
 * Preserves headings, bold, code blocks, math equations, etc.
 * Strips UI chrome (style tags, buttons, SVGs, scripts) that leak from portal UIs.
 */
export function htmlToMarkdown(html: string): string {
  // Diagnostic: always log raw HTML length and a snippet.
  // This is essential for identifying what math format Gemini/Moonshot use.
  const cleaned = sanitizeHtml(html)
  const md = turndown.turndown(cleaned).trim()
  return cleanMarkdown(md)
}

export interface LlmAdapter {
  provider: ProviderName
  ensureReady(): Promise<void>
  sendPrompt(prompt: string): Promise<void>
  waitForCompletion(timeoutMs: number): Promise<void>
  extractLatestResponse(): Promise<{ text: string; conversationUrl?: string }>
  navigateToNewChat(): Promise<void>
  navigateToThread(url: string): Promise<void>
  rateLastResponse(rating: 'good' | 'bad'): Promise<void>
  waitForResponseBlocks(timeoutMs?: number): Promise<void>
  clickRegenerate(): Promise<void>

  // Optional: for adapters that support thinking/reasoning separation.
  // Returns the current thinking and response text as separate fields.
  getPhaseContent?(): Promise<{ thinking: string; response: string }>
  // Optional: returns true if the model is still generating (stop button
  // visible or input disabled). Used as a binary completion signal.
  isGenerating?(): Promise<boolean>
}

export function hasThinkingSupport(adapter: LlmAdapter): adapter is LlmAdapter & Required<Pick<LlmAdapter, 'getPhaseContent' | 'isGenerating'>> {
  return typeof adapter.getPhaseContent === 'function' && typeof adapter.isGenerating === 'function'
}

/**
 * Shared page.evaluate script for thinking-capable adapters.
 * Classifies the latest assistant response into thinking and response phases
 * using DOM structure (not CSS selectors or text thresholds).
 *
 * Call as: page.evaluate(`${CLASSIFY_CONTENT_SCRIPT}(beforeText, inputSelector)`)
 *
 * Key structural signals:
 *   - <details> elements → thinking (collapsible reasoning)
 *   - Leaf-level matching: filters out parent containers that wrap both old
 *     and new content, keeping only the most specific new element
 */
export const CLASSIFY_CONTENT_SCRIPT = `
(function(beforeText, inputSel) {
  var input = null;
  var sels = inputSel.split(',');
  for (var i = 0; i < sels.length; i++) {
    input = document.querySelector(sels[i].trim());
    if (input) break;
  }

  // Find the main content area (scrollable ancestor of input)
  var area = input ? input.parentElement : document.body;
  while (area && area !== document.body) {
    if (area.scrollHeight > 500 && area.clientWidth > 400) break;
    area = area.parentElement;
  }
  if (!area) area = document.body;

  // Pass 1: collect all elements with "new" text (not in before-snapshot)
  var allCandidates = area.querySelectorAll('div, article, section');
  var matches = [];
  for (var i = 0; i < allCandidates.length; i++) {
    var el = allCandidates[i];
    if (input && (el.contains(input) || input.contains(el))) continue;
    if (el.offsetParent === null && el !== document.body) continue;
    var links = el.querySelectorAll('a[href]');
    var text = (el.innerText || '').trim();
    if (links.length > 3 && links.length > text.split('\\n').length) continue;
    if (text.length < 5) continue;
    if (!beforeText.includes(text)) {
      matches.push(el);
    }
  }

  if (matches.length === 0) return { thinking: '', response: '', responseHtml: '' };

  // Pass 2: filter to leaf-level matches only.
  // Remove any element that is an ancestor of another match.
  // This prevents picking the entire conversation container on follow-ups.
  var leaves = [];
  for (var i = 0; i < matches.length; i++) {
    var isAncestor = false;
    for (var j = 0; j < matches.length; j++) {
      if (i !== j && matches[i].contains(matches[j])) {
        isAncestor = true;
        break;
      }
    }
    if (!isAncestor) leaves.push(matches[i]);
  }

  // Pass 3: among leaves, pick the largest as the turn container
  var turnContainer = null;
  var turnLen = 0;
  for (var i = 0; i < leaves.length; i++) {
    var text = (leaves[i].innerText || '').trim();
    if (text.length > turnLen) {
      turnLen = text.length;
      turnContainer = leaves[i];
    }
  }

  if (!turnContainer) return { thinking: '', response: '', responseHtml: '' };

  // Pass 4: classify children into thinking vs response.
  // Structural signals for "thinking" blocks:
  //   - <details> elements (collapsible reasoning)
  //   - Elements with aria-expanded, data-state="collapsed"
  //   - Elements whose class/role contains "think", "reason", "search", "tool"
  var thinking = '';
  var responseHtml = '';
  var responseText = '';
  var children = turnContainer.children;

  function isThinkingBlock(el) {
    if (el.tagName === 'DETAILS' || el.querySelector('details')) return true;
    if (el.getAttribute('aria-expanded') === 'false') return true;
    if (el.getAttribute('data-state') === 'collapsed') return true;
    var cls = (el.className || '').toLowerCase();
    var role = (el.getAttribute('role') || '').toLowerCase();
    var dataType = (el.getAttribute('data-type') || '').toLowerCase();
    var markers = ['think', 'reason', 'search', 'tool-call', 'chain-of-thought'];
    for (var m = 0; m < markers.length; m++) {
      if (cls.indexOf(markers[m]) !== -1 || role.indexOf(markers[m]) !== -1 || dataType.indexOf(markers[m]) !== -1) return true;
    }
    return false;
  }

  var hasThinkingBlocks = false;
  for (var i = 0; i < children.length; i++) {
    if (isThinkingBlock(children[i])) { hasThinkingBlocks = true; break; }
  }

  if (hasThinkingBlocks && children.length > 1) {
    // Multiple children with at least one thinking block:
    // thinking blocks → thinking, rest → response
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (isThinkingBlock(child)) {
        thinking += (child.innerText || '') + '\\n';
      } else {
        var t = (child.innerText || '').trim();
        if (t.length > responseText.length) {
          responseText = t;
          responseHtml = child.innerHTML;
        }
      }
    }
  } else {
    // No structural separation — entire content is response
    responseText = (turnContainer.innerText || '').trim();
    responseHtml = turnContainer.innerHTML;
  }

  return {
    thinking: thinking.trim(),
    response: responseText.trim(),
    responseHtml: responseHtml,
  };
})
`

/**
 * Global clipboard mutex — the OS clipboard is a shared resource. Without
 * serialization, concurrent adapters (e.g., Moonshot's extractLatestResponse
 * clicking a Copy button while Claude's sendPrompt pastes text) race on
 * read/write, causing cross-contamination (one adapter's content pasted into
 * another adapter's input).
 */
let _clipboardLockChain = Promise.resolve()

export async function withClipboardLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void
  const prev = _clipboardLockChain
  _clipboardLockChain = new Promise<void>((resolve) => { release = resolve })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * Helper: paste text into a contenteditable or textarea input via the system
 * clipboard. This is more reliable than `pressSequentially` for multi-line text
 * because `pressSequentially` sends `\n` as Enter keystrokes, which chat UIs
 * interpret as "submit message" rather than "new line".
 *
 * Saves and restores the user's clipboard contents.
 * Acquires the global clipboard lock to prevent cross-adapter contamination.
 */
export async function pasteText(page: Page, locator: Locator, text: string): Promise<void> {
  await withClipboardLock(async () => {
    const saved = clipboard.readText()
    try {
      clipboard.writeText(text)
      await locator.waitFor({ state: 'visible', timeout: 5000 })
      await locator.scrollIntoViewIfNeeded().catch(() => {})
      try {
        await locator.click({ timeout: 1500 })
      } catch (err) {
        console.warn('[baseAdapter] locator.click() failed during pasteText; falling back to programmatic focus:', err)
        try {
          await locator.focus()
        } catch {
          // Some rich editors reject Locator.focus() when a wrapper owns focus.
        }
        await locator.evaluate((node) => {
          const el = node as HTMLElement
          el.focus()

          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const len = el.value.length
            el.setSelectionRange(len, len)
            return
          }

          if (el.isContentEditable) {
            const selection = window.getSelection()
            const range = document.createRange()
            range.selectNodeContents(el)
            range.collapse(false)
            selection?.removeAllRanges()
            selection?.addRange(range)
          }
        })
      }
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.press(`${modifier}+a`)
      await page.keyboard.press(`${modifier}+v`)
      await new Promise((r) => setTimeout(r, 200))
    } finally {
      clipboard.writeText(saved)
    }
  })
}

/**
 * Helper: wait until a condition returns true, polling at an interval.
 * Throws if the condition is not met within timeoutMs.
 */
export async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  pollMs = 500,
  label = 'condition'
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`[waitUntil] Timed out waiting for ${label} after ${timeoutMs}ms`)
}

/**
 * Helper: wait until the text content of the latest response stabilizes
 * (stops changing for `stableMs` milliseconds).
 */
export async function waitForTextStability(
  getTextFn: () => Promise<string>,
  timeoutMs: number,
  stableMs = 2000,
  pollMs = 500,
  label = 'text stability'
): Promise<void> {
  const start = Date.now()
  let lastText = ''
  let lastChangeTime = Date.now()

  while (Date.now() - start < timeoutMs) {
    const currentText = await getTextFn()
    if (currentText !== lastText) {
      lastText = currentText
      lastChangeTime = Date.now()
    } else if (Date.now() - lastChangeTime >= stableMs) {
      return
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`[waitForTextStability] Timed out waiting for ${label} after ${timeoutMs}ms`)
}

/**
 * Generic stop-button-based completion detection, matching the proven pattern
 * from the ChatGPT/Claude/Gemini adapters.
 *
 * Strategy:
 * 1. Wait up to 10s for a stop/loading indicator to appear (generation started)
 * 2. If found, poll until it disappears (generation complete) + 1s buffer
 * 3. Final text stability check (short timeout)
 * 4. If stop button never appears, fall back to text stability with full timeout
 *
 * @param page       Playwright Page
 * @param stopSels   CSS selectors for stop/generating indicators
 * @param getTextFn  Function to get current response text
 * @param timeoutMs  Overall timeout budget
 * @param label      Adapter name for logging
 */
export async function waitForCompletionWithStopButton(
  page: { locator: (sel: string) => { count: () => Promise<number> }; waitForSelector: (sel: string, opts: { timeout: number }) => Promise<unknown> },
  stopSels: string[],
  getTextFn: () => Promise<string>,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const stopSelector = stopSels.join(', ')
  let stopButtonSeen = false

  // Phase 1: Wait for stop button to appear (confirms generation started)
  try {
    await page.waitForSelector(stopSelector, { timeout: Math.min(10000, timeoutMs) })
    stopButtonSeen = true
    console.log(`[${label}] Stop button appeared — generation in progress`)
  } catch {
    console.log(`[${label}] Stop button not found — using text stability fallback`)
  }

  if (stopButtonSeen) {
    // Phase 2: Wait for stop button to disappear (generation complete)
    while (Date.now() < deadline) {
      const count = await page.locator(stopSelector).count()
      if (count === 0) {
        console.log(`[${label}] Stop button disappeared — generation complete`)
        break
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    // Brief buffer for final DOM updates
    await new Promise((r) => setTimeout(r, 1000))
  }

  // Phase 3: Final text stability check
  const stabilityTimeout = stopButtonSeen
    ? Math.min(10000, deadline - Date.now())   // short check if we saw the button
    : Math.max(0, deadline - Date.now())        // full budget as fallback
  if (stabilityTimeout > 0) {
    try {
      await waitForTextStability(getTextFn, stabilityTimeout)
    } catch {
      console.log(`[${label}] Text stability timeout — proceeding with extraction`)
    }
  }
}
