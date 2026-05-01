import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')
const mainCss = readFileSync(resolve(repoRoot, 'assets/css/main.css'), 'utf8')
const heroPlannerCard = readFileSync(resolve(repoRoot, 'components/HeroPlannerCard.vue'), 'utf8')
const planningPreview = readFileSync(resolve(repoRoot, 'components/PlanningPreview.vue'), 'utf8')
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

describe('progressive results panel layout', () => {
  it('derives the plan-panel reveal signal from only the final plan signal', () => {
    expect(indexPage).toMatch(
      /const hasPlanArtifact = computed\(\(\) => Boolean\(chatPlan\.value\)\)/,
    )
  })

  it('keeps the main grid single-panel until that reveal signal becomes truthy', () => {
    expect(indexPage).toContain(`:class="{ 'is-single-panel': !hasPlanArtifact }"`)
    expect(indexPage).not.toContain(`:class="{ 'is-single-panel': !hasPlanArtifact && phase !== 'planning' }"`)
  })

  it('renders the divider and right panel only after the first final plan exists', () => {
    expect(indexPage).toContain('<template v-if="hasPlanArtifact">')
    expect(indexPage).not.toContain(`<template v-if="hasPlanArtifact || phase === 'planning'">`)
    expect(indexPage).toContain('class="main-grid-panel main-grid-panel-secondary"')
  })

  it('uses the final plan signal in initial generation close and error guards', () => {
    expect(indexPage).toContain(`?? (chatPlan.value ? '已为你生成最新方案，右侧可以查看完整行程。' : '')`)
    expect(indexPage).toContain('if (chatPlan.value) {')
  })

  it('uses the final plan signal in continue optimization close and error guards', () => {
    expect(indexPage).toContain('?? (chatPlan.value ? "已为你生成最新方案，右侧可以查看完整行程。" : "")')
    expect(indexPage).toContain('if (chatPlan.value) {')
  })

  it('uses a 46/54 split with a reveal animation for the secondary panel', () => {
    const gridBlock = extractBlock(mainCss, '.main-grid')
    const primaryBlock = extractBlock(mainCss, '.main-grid-panel-primary')
    const singlePanelBlock = extractBlock(mainCss, '.main-grid.is-single-panel .main-grid-panel-primary')
    const resizingPrimaryBlock = extractBlock(mainCss, 'body.is-panel-resizing .main-grid-panel-primary')
    const secondaryBlock = extractBlock(mainCss, '.main-grid-panel-secondary')

    expect(gridBlock).toBeTruthy()
    expect(gridBlock).toContain('--main-grid-left: 46%;')
    expect(indexPage).toContain('const leftPanelWidth = ref(46)')

    expect(primaryBlock).toBeTruthy()
    expect(primaryBlock).toContain('flex: 0 0 var(--main-grid-left);')
    expect(primaryBlock).toContain('transition: flex-basis 200ms var(--ease-out);')

    expect(singlePanelBlock).toBeTruthy()
    expect(singlePanelBlock).toContain('flex-basis: 100%;')

    expect(resizingPrimaryBlock).toBeTruthy()
    expect(resizingPrimaryBlock).toContain('transition: none;')

    expect(secondaryBlock).toBeTruthy()
    expect(secondaryBlock).toContain('animation: plan-panel-reveal 200ms var(--ease-out) both;')
    expect(mainCss).toContain('@keyframes plan-panel-reveal')
  })

  it('passes session.currentPlan into chat history hydration at both restore call sites', () => {
    const hydrateCallMatches = indexPage.match(
      /chatStore\.hydrateFromSessionMessages\(session\.messages,\s*session\.currentPlan\)/g,
    )

    expect(hydrateCallMatches).not.toBeNull()
    expect(hydrateCallMatches).toHaveLength(2)
  })

  it('keeps a mobile-only planning preview fallback before the first final plan exists', () => {
    expect(indexPage).toContain('<div v-if="!hasPlanArtifact && phase === \'planning\'" class="mobile-planning-preview">')

    const desktopBlock = extractBlock(mainCss, '.mobile-planning-preview')
    expect(desktopBlock).toBeTruthy()
    expect(desktopBlock).toContain('display: none;')

    const mobileBlock = extractBlock(mainCss, '@media (max-width: 980px)')
    expect(mobileBlock).toBeTruthy()
    expect(mobileBlock).toContain('.mobile-planning-preview {')
    expect(mobileBlock).toContain('display: block;')
  })

  it('forces planning skeleton in the mobile fallback even when partial plans exist', () => {
    expect(indexPage).toContain(':force-planning-skeleton="true"')
    expect(planningPreview).toContain('forcePlanningSkeleton?: boolean')
    expect(planningPreview).toContain('const shouldShowPlanBody = computed(() => Boolean(currentPlan.value) && !props.forcePlanningSkeleton)')
    expect(planningPreview).toContain('<div v-else-if="shouldShowPlanBody" class="itinerary-body">')
  })
})
