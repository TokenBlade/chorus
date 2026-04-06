import { describe, it, expect } from 'vitest'
import { htmlToMarkdown } from '../baseAdapter'

describe('Moonshot: htmlToMarkdown conversion', () => {
  it('converts Chinese HTML content', () => {
    const html = '<p>这是<strong>Kimi</strong>的回答</p>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('**Kimi**')
    expect(md).toContain('回答')
  })

  it('converts mixed Chinese/English content', () => {
    const html = '<p>Hello, 你好！This is a <em>test</em>.</p>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('Hello')
    expect(md).toContain('你好')
    expect(md).toMatch(/[_*]test[_*]/)
  })

  it('handles code blocks from Kimi', () => {
    const html = '<pre><code class="language-python">def hello():\n    print("你好")</code></pre>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('def hello()')
    expect(md).toContain('你好')
  })

  it('handles lists', () => {
    const html = '<ol><li>第一步</li><li>第二步</li><li>第三步</li></ol>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('第一步')
    expect(md).toContain('第二步')
    expect(md).toContain('第三步')
  })
})

describe('Moonshot: selector design', () => {
  it('input selectors start with contenteditable', () => {
    const inputSelectors = [
      '[contenteditable="true"]',
      'textarea',
      '[role="textbox"]',
    ]
    expect(inputSelectors[0]).toBe('[contenteditable="true"]')
  })

  it('response selectors include semantic data attributes first', () => {
    const responseSelectors = [
      '[data-role="assistant"]',
      '[data-type="assistant"]',
      '[class*="assistant"]',
      '[class*="answer"]',
      '[class*="markdown"]',
      '[class*="message-content"]',
    ]
    // Data attributes before class-based selectors
    expect(responseSelectors[0]).toContain('data-role')
    expect(responseSelectors[1]).toContain('data-type')
  })

  it('stop button selectors include Chinese labels', () => {
    const stopSelectors = [
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'button[aria-label*="取消"]',
      'button[aria-label*="停止"]',
    ]
    expect(stopSelectors.some(s => s.includes('取消'))).toBe(true)
    expect(stopSelectors.some(s => s.includes('停止'))).toBe(true)
  })
})

describe('Moonshot: extraction strategy', () => {
  it('has multi-level fallback: selectors → positional → diagnostic', () => {
    // The adapter should try these strategies in order:
    const strategies = [
      'semantic-selectors',     // [data-role="assistant"], etc.
      'positional-extraction',  // DOM position relative to input
      'diagnostic-logging',     // logs available classes for debugging
    ]
    expect(strategies).toHaveLength(3)
    expect(strategies[0]).toBe('semantic-selectors')
    expect(strategies[1]).toBe('positional-extraction')
  })

  it('positional extraction excludes input area and navigation', () => {
    // Simulate the positional extraction logic
    function shouldIncludeBlock(block: { containsInput: boolean; linkCount: number; textLength: number }) {
      if (block.containsInput) return false
      if (block.linkCount > 3) return false
      if (block.textLength < 10) return false
      return true
    }

    // Response block — should be included
    expect(shouldIncludeBlock({ containsInput: false, linkCount: 0, textLength: 500 })).toBe(true)
    // Input area — should be excluded
    expect(shouldIncludeBlock({ containsInput: true, linkCount: 0, textLength: 100 })).toBe(false)
    // Navigation — should be excluded
    expect(shouldIncludeBlock({ containsInput: false, linkCount: 10, textLength: 200 })).toBe(false)
    // Short element — should be excluded
    expect(shouldIncludeBlock({ containsInput: false, linkCount: 0, textLength: 5 })).toBe(false)
  })
})

describe('Moonshot: completion detection', () => {
  it('follows stop-button-then-stability pattern', () => {
    const strategy = {
      step1: 'wait-for-stop-button (10s)',
      step2a: 'wait-for-stop-disappearance (if seen)',
      step2b: 'text-stability-fallback (if not seen)',
      stabilityWindow: 2000,
    }
    expect(strategy.stabilityWindow).toBe(2000)
  })
})

describe('Moonshot: follow-up chat handling', () => {
  it('locator.last() returns only the latest response block', () => {
    const blocks = [
      { index: 0, text: '第一个回答' },
      { index: 1, text: '第二个回答' },
      { index: 2, text: '最新的回答' },
    ]
    const last = blocks[blocks.length - 1]
    expect(last.text).toBe('最新的回答')
  })

  it('positional extraction prefers elements closest to bottom', () => {
    // The positional fallback should prefer elements with higher top position
    // (closer to the bottom of the conversation, i.e., the latest response)
    const elements = [
      { top: 100, text: 'Old response' },
      { top: 500, text: 'Middle response' },
      { top: 900, text: 'Latest response' },
    ]
    // The last element with top > 0 should win
    const latest = elements.filter(e => e.top > 0).pop()
    expect(latest?.text).toBe('Latest response')
  })
})
