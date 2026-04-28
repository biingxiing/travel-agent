import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const heroPlannerCardSource = readFileSync(
  fileURLToPath(new URL('../components/HeroPlannerCard.vue', import.meta.url)),
  'utf8',
)
const heroStyleBlock = heroPlannerCardSource.match(/^\s*\.hero\s*\{([\s\S]*?)^\}/m)?.[1] ?? ''
const heroComposerStyleBlock = heroPlannerCardSource.match(/^\s*\.hero-composer\s*\{([\s\S]*?)^\}/m)?.[1] ?? ''
const heroComposerInputStyleBlock = heroPlannerCardSource.match(/^\s*\.hero-composer-input\s*\{([\s\S]*?)^\}/m)?.[1] ?? ''

describe('HeroPlannerCard', () => {
  it('uses benefit-led subtitle copy on the landing hero', () => {
    expect(heroPlannerCardSource).toContain('我先给你一版能落地的行程')
    expect(heroPlannerCardSource).not.toContain('ReAct 循环')
  })

  it('anchors the hero content higher instead of vertically centering it', () => {
    expect(heroStyleBlock).toContain('justify-content: flex-start;')
    expect(heroStyleBlock).not.toContain('justify-content: center;')
  })

  it('removes the AI travel planner kicker and enlarges the prompt composer', () => {
    expect(heroPlannerCardSource).not.toContain('AI TRAVEL PLANNER')
    expect(heroComposerStyleBlock).toContain('width: min(100%, clamp(760px, 40vw, 920px));')
    expect(heroComposerInputStyleBlock).toContain('min-height: 72px;')
  })
})
