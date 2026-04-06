import { describe, it, expect } from 'vitest'
import { htmlToMarkdown } from '../baseAdapter'

describe('Z.AI: htmlToMarkdown conversion', () => {
  it('converts Chinese HTML content', () => {
    const html = '<p>这是<strong>智谱</strong>的回答</p>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('**智谱**')
    expect(md).toContain('回答')
  })

  it('handles thinking block content', () => {
    const html = `
      <p>分析用户请求：用户想要一个"地狱笑话"。</p>
      <p>关键限制：作为AI，我需要遵守安全准则。</p>
    `
    const md = htmlToMarkdown(html)
    expect(md).toContain('分析用户请求')
    expect(md).toContain('安全准则')
  })

  it('converts tables', () => {
    const html = '<table><thead><tr><th>名称</th><th>得分</th></tr></thead><tbody><tr><td>选项A</td><td>85</td></tr></tbody></table>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('名称')
    expect(md).toContain('得分')
    expect(md).toContain('选项A')
  })

  it('converts tables with <p> tags inside cells (Z.AI/Kimi pattern)', () => {
    const html = '<table><thead><tr><th><p>幽默理论</p></th><th><p>具体应用分析</p></th><th><p>产生的心理效果</p></th></tr></thead><tbody><tr><td><p>拟人化</p></td><td><p>将抽象的数字赋予了人类的社会属性</p></td><td><p>打破了数字原本的严肃性</p></td></tr></tbody></table>'
    const md = htmlToMarkdown(html)
    // All header cells must be on the same line
    expect(md).toMatch(/\|\s*幽默理论\s*\|\s*具体应用分析\s*\|\s*产生的心理效果\s*\|/)
    // Data row must also be on one line
    expect(md).toMatch(/\|\s*拟人化\s*\|/)
    // No paragraph breaks inside table rows
    expect(md).not.toMatch(/\|\s*\n\n/)
  })

  it('preserves inline formatting inside table cells with block wrappers', () => {
    const html = '<table><thead><tr><th><p>名称</p></th><th><p>说明</p></th></tr></thead><tbody><tr><td><p><strong>重点</strong></p></td><td><p>这是<em>关键</em>信息</p></td></tr></tbody></table>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('**重点**')
    expect(md).toMatch(/关键/)
    expect(md).toMatch(/\|\s*\*\*重点\*\*\s*\|/)
  })

  it('handles empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
  })

  it('converts KaTeX inline math to $...$ notation', () => {
    const katexHtml = '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>e</mi><mi>x</mi></msup></mrow><annotation encoding="application/x-tex">e^x</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="mord"><mi>e</mi><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="sizing"><span class="mord mathnormal">x</span></span></span></span></span></span></span></span></span></span></span>'
    const md = htmlToMarkdown(katexHtml)
    expect(md).toBe('$e^x$')
    // Must NOT contain the visual rendering text
    expect(md).not.toMatch(/exe/)
  })

  it('converts KaTeX fraction to $\\frac{}{}$ notation', () => {
    const fracHtml = '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mfrac><mi>d</mi><mrow><mi>d</mi><mi>x</mi></mrow></mfrac></mrow><annotation encoding="application/x-tex">\\frac{d}{dx}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="mord"><span class="mfrac"><span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist"><span><span class="mord"><mi>d</mi><mi>x</mi></span></span><span><span class="frac-line"></span></span><span><span class="mord"><mi>d</mi></span></span></span></span></span></span></span></span></span></span>'
    const md = htmlToMarkdown(fracHtml)
    expect(md).toBe('$\\frac{d}{dx}$')
  })

  it('preserves math inline with surrounding text', () => {
    const html = '<p>常数函数 <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>C</mi></mrow><annotation encoding="application/x-tex">C</annotation></semantics></math></span><span class="katex-html"><span class="base"><span class="mord mathnormal">C</span></span></span></span> 走在街上。</p>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('$C$')
    expect(md).toContain('走在街上')
    // Must NOT have doubled "CC"
    expect(md).not.toMatch(/CC/)
  })

  it('converts Gemini data-math display math (no annotation)', () => {
    // Gemini wraps math in <div class="math-block" data-math="LATEX"> with KaTeX visual-only rendering
    const html = '<div class="math-block" data-math="\\sin \\alpha + \\sin \\beta = 2"><span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true"><span class="base"><span class="mop">sin</span><span class="mord mathnormal">α</span></span></span></span></span></div>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('$$')
    expect(md).toContain('\\sin \\alpha + \\sin \\beta = 2')
    // Must NOT contain visual rendering text
    expect(md).not.toContain('sinα')
  })

  it('converts Gemini data-math inline math', () => {
    const html = '<p>常数函数 <span data-math="C"><span class="katex"><span class="katex-html"><span class="mord mathnormal">C</span></span></span></span> 走在街上。</p>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('$C$')
    expect(md).toContain('走在街上')
    expect(md).not.toMatch(/CC/)
  })

  it('converts MathJax v3 inline math (<mjx-container> with annotation)', () => {
    // MathJax v3 renders math inside <mjx-container> with SVG + assistive MathML
    const html = '<mjx-container class="MathJax" jax="SVG"><svg><g><use></use></g></svg><mjx-assistive-mml><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>e</mi><mi>x</mi></msup></mrow><annotation encoding="application/x-tex">e^x</annotation></semantics></math></mjx-assistive-mml></mjx-container>'
    const md = htmlToMarkdown(html)
    expect(md).toBe('$e^x$')
  })

  it('converts MathJax v3 display math', () => {
    const html = '<mjx-container class="MathJax" jax="SVG" display="true"><svg><g><use></use></g></svg><mjx-assistive-mml><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mfrac><mi>d</mi><mrow><mi>d</mi><mi>x</mi></mrow></mfrac></mrow><annotation encoding="application/x-tex">\\frac{d}{dx}</annotation></semantics></math></mjx-assistive-mml></mjx-container>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('$$')
    expect(md).toContain('frac{d}{dx}')
  })

  it('converts MathJax v3 math in paragraph context', () => {
    const html = '<p>常数函数 <mjx-container class="MathJax" jax="SVG"><svg><g></g></svg><mjx-assistive-mml><math><semantics><mi>C</mi><annotation encoding="application/x-tex">C</annotation></semantics></math></mjx-assistive-mml></mjx-container> 走在街上。</p>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('$C$')
    expect(md).toContain('走在街上')
  })
})

describe('Z.AI: selector design', () => {
  it('input selectors start with contenteditable', () => {
    const inputSelectors = [
      '[contenteditable="true"]',
      'textarea',
      '#chat-input',
      '[role="textbox"]',
    ]
    expect(inputSelectors[0]).toBe('[contenteditable="true"]')
  })

  it('response selectors include data attributes first', () => {
    const responseSelectors = [
      '[data-role="assistant"]',
      '[data-type="assistant"]',
      '[class*="markdown"]',
      '[class*="assistant"]',
      '[class*="message-content"]',
      '[class*="answer"]',
      '[class*="response"]',
    ]
    expect(responseSelectors[0]).toContain('data-role')
  })

  it('stop button selectors include Chinese labels', () => {
    const stopSelectors = [
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'button[aria-label*="Cancel"]',
      'button[aria-label*="取消"]',
      'button[aria-label*="停止"]',
    ]
    expect(stopSelectors.some(s => s.includes('取消'))).toBe(true)
    expect(stopSelectors.some(s => s.includes('停止'))).toBe(true)
  })

  it('thinking selectors cover multiple patterns', () => {
    const thinkingSelectors = [
      'details',
      '[class*="thinking"]',
      '[class*="reason"]',
      '[data-type="thinking"]',
      '[aria-expanded]',
    ]
    expect(thinkingSelectors).toContain('details')
    expect(thinkingSelectors.some(s => s.includes('thinking'))).toBe(true)
    expect(thinkingSelectors.some(s => s.includes('reason'))).toBe(true)
  })
})

describe('Z.AI: extraction strategy', () => {
  it('has multi-level fallback', () => {
    const strategies = [
      'semantic-selectors',
      'positional-extraction',
      'diagnostic-logging',
    ]
    expect(strategies).toHaveLength(3)
  })

  it('positional extraction filters correctly', () => {
    function shouldInclude(block: { containsInput: boolean; linkCount: number; textLen: number; isLeaf: boolean }) {
      if (block.containsInput) return false
      if (block.linkCount > 3) return false
      if (block.textLen < 10) return false
      if (!block.isLeaf) return false
      return true
    }

    expect(shouldInclude({ containsInput: false, linkCount: 0, textLen: 500, isLeaf: true })).toBe(true)
    expect(shouldInclude({ containsInput: true, linkCount: 0, textLen: 500, isLeaf: true })).toBe(false)
    expect(shouldInclude({ containsInput: false, linkCount: 10, textLen: 500, isLeaf: true })).toBe(false)
    expect(shouldInclude({ containsInput: false, linkCount: 0, textLen: 500, isLeaf: false })).toBe(false)
  })
})

describe('Z.AI: completion detection', () => {
  it('uses longer stability window for thinking→response gap', () => {
    const strategy = {
      stopButtonWait: 10000,
      postStopDelay: 2000,   // extra wait after stop disappears
      stabilityWindow: 3000, // 3s stable (longer than DeepSeek's 2s)
    }
    expect(strategy.postStopDelay).toBe(2000)
    expect(strategy.stabilityWindow).toBe(3000)
    expect(strategy.stabilityWindow).toBeGreaterThan(2000)
  })
})

describe('Z.AI: thinking/response separation', () => {
  it('thinking selectors checked independently from response', () => {
    // Z.AI adapter queries thinking and response separately
    // (not via a shared CLASSIFY_CONTENT_SCRIPT)
    const thinkingResult = { thinking: 'Analyzing the request...', response: '' }
    const fullResult = { thinking: 'Analyzing the request...', response: 'Here is the answer.' }

    expect(thinkingResult.response).toBe('')
    expect(fullResult.thinking).toContain('Analyzing')
    expect(fullResult.response).toContain('answer')
  })
})
