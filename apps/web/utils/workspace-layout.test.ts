import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')
const mainCss = readFileSync(resolve(repoRoot, 'assets/css/main.css'), 'utf8')
const heroPlannerCard = readFileSync(resolve(repoRoot, 'components/HeroPlannerCard.vue'), 'utf8')
const indexPage = readFileSync(resolve(repoRoot, 'pages/index.vue'), 'utf8')

function extractBlock(source: string, selector: string) {
  const start = source.indexOf(selector)
  if (start === -1) return null

  const open = source.indexOf('{', start)
  if (open === -1) return null

  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, i + 1)
      }
    }
  }

  return null
}

describe('workspace conversation layout styles', () => {
  it('makes the conversation grid fill the remaining vertical space', () => {
    const block = extractBlock(mainCss, '.main-grid')
    expect(block).toBeTruthy()
    expect(block).toContain('flex: 1;')
  })

  it('forces conversation and result panels to inherit full parent height', () => {
    const block = extractBlock(
      mainCss,
      '.main-grid-panel > .conversation-shell,\n.main-grid-panel > .result-shell',
    )
    expect(block).toBeTruthy()
    expect(block).toContain('width: 100%;')
    expect(block).toContain('height: 100%;')
  })
})

describe('workspace landing layout styles', () => {
  it('removes desktop landing stack padding so the hero can touch the full vertical bounds', () => {
    const block = extractBlock(indexPage, '.landing-stack')
    expect(block).toBeTruthy()
    expect(block).toContain('padding: 0;')
  })

  it('makes the landing hero shell consume the remaining vertical space', () => {
    const block = extractBlock(heroPlannerCard, '.hero-shell')
    expect(block).toBeTruthy()
    expect(block).toContain('flex: 1;')
    expect(block).toContain('min-height: 0;')
    expect(block).toContain('display: flex;')
    expect(block).toContain('margin-bottom: 0;')
  })

  it('makes the landing hero panel stretch to the full shell height', () => {
    const block = extractBlock(heroPlannerCard, '.hero {')
    expect(block).toBeTruthy()
    expect(block).toContain('flex: 1;')
    expect(block).toContain('height: 100%;')
    expect(block).toContain('display: flex;')
    expect(block).toContain('justify-content: flex-start;')
  })
})
