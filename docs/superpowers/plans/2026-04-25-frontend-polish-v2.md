# Frontend Polish v2 (Linear/Vercel-grade, ReAct-aware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersedes:** `docs/superpowers/plans/2026-04-24-frontend-polish.md`. That plan was written assuming a multi-version plan model (`planOptions[]` / `activeVersionNo` / `style chip`) and a "dedupe repeated assistant messages" rule. Both are obsolete — the project has since been refactored to a **single-plan + ReAct iteration** architecture. This v2 reflects current reality.

**Goal:** Polish the Nuxt 3 travel-planning frontend to a Linear/Vercel-grade product bar — refined typography, Lucide icons, motion system, Reka UI primitives, consistent state components, redesigned Hero / workspace / Plan artifact / POI cards — **and** add three ReAct-specific surfaces (ReactProgressBar / ClarifyCard / MaxIterCard).

**Architecture:** Layered build-up — (1) foundation (deps, CSS tokens, motion, Toast), (2) horizontal infrastructure (pure utilities, Reka UI wrappers, state components), (3) ReAct loop UI (three cards), (4) surface redesigns per-page, (5) motion/a11y/responsive polish. Each task is self-contained and committed independently.

**Tech Stack:** Nuxt 3 · Vue 3 · Pinia · Reka UI · Lucide icons · motion-v · vue-sonner · Vitest (utilities) · Playwright (e2e).

**Spec reference:** `docs/superpowers/specs/2026-04-24-frontend-polish-design.md` (updated 2026-04-25 to v2)

---

## Conventions

- **Package manager**: `pnpm` workspace; commands target `@travel-agent/web`
- **Types**: all shared types come from `@travel-agent/shared`, not `@travel-agent/domain` (that package no longer exists)
- **Build verification**: `pnpm build:web` after major component changes
- **Unit tests**: Vitest (configured for `apps/web` in Task 1)
- **Visual verification for Vue components**: start `pnpm dev:web` and use Playwright MCP (`mcp__plugin_playwright_playwright__*`). Do NOT claim a UI task is done without visual verification
- **Commit style**: `feat:` / `fix:` / `refactor:` / `chore:` English prefix
- **Branch**: work happens on whatever branch the user has checked out (currently `main`)
- **Never** skip hooks, force-push, or commit secrets
- **One commit per task** (and optionally one inside the task if it makes a clean TDD boundary)

---

## File Structure Overview

```
apps/web/
├── package.json                               ← Task 1 (deps)
├── vitest.config.ts                           ← Task 1 (new)
├── nuxt.config.ts                             ← Task 1 (transpile)
├── app.vue                                    ← Task 4 (mount Toaster)
├── assets/css/main.css                        ← Task 2 (tokens)
├── plugins/
│   └── toast.client.ts                        ← Task 4 (new)
├── composables/
│   ├── useMotion.ts                           ← Task 3 (new)
│   ├── useMotion.test.ts                      ← Task 3 (new)
│   └── useTripHistory.ts                      ← Task 6 (modify)
├── utils/
│   ├── poi-visual.ts                          ← Task 5 (new)
│   ├── poi-visual.test.ts                     ← Task 5 (new)
│   ├── destination-color.ts                   ← Task 6 (new)
│   ├── destination-color.test.ts              ← Task 6 (new)
│   ├── relative-time.ts                       ← Task 7 (new)
│   └── relative-time.test.ts                  ← Task 7 (new)
├── components/
│   ├── ui/
│   │   ├── Toaster.vue                        ← Task 4
│   │   ├── Tooltip.vue                        ← Task 8
│   │   ├── DropdownMenu.vue                   ← Task 9
│   │   ├── Dialog.vue                         ← Task 10
│   │   └── ScrollArea.vue                     ← Task 11
│   ├── states/
│   │   ├── EmptyState.vue                     ← Task 12
│   │   ├── LoadingSkeleton.vue                ← Task 13
│   │   ├── ErrorState.vue                     ← Task 14
│   │   └── StreamingBubble.vue                ← Task 15
│   ├── react/
│   │   ├── ReactProgressBar.vue               ← Task 16
│   │   ├── ClarifyCard.vue                    ← Task 17
│   │   └── MaxIterCard.vue                    ← Task 18
│   ├── AuthLoginCard.vue                      ← Task 20
│   ├── ChatPanel.vue                          ← Task 23
│   ├── HeroPlannerCard.vue                    ← Task 21
│   ├── PlanningPreview.vue                    ← Tasks 24, 25
│   └── TripHistoryGrid.vue                    ← Task 22
└── pages/index.vue                            ← Tasks 19, 26
```

28 tasks total (no dedupe, no Tabs wrapper — both removed vs v1).

---

## Phase 1 · Foundation (Tasks 1–4)

### Task 1: Install dependencies & configure Vitest

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/nuxt.config.ts`
- Create: `apps/web/vitest.config.ts`
- Modify: `package.json` (repo root — test script)

- [x] **Step 1: Install runtime dependencies**

```bash
pnpm --filter @travel-agent/web add reka-ui lucide-vue-next motion-v vue-sonner
```
Expected: dependencies added to `apps/web/package.json`, lockfile updated.

- [x] **Step 2: Install dev dependencies**

```bash
pnpm --filter @travel-agent/web add -D vitest
```

Note: Do NOT add `@vitest/coverage-v8` here — the repo root already has it as a dev dep; at the workspace level, it's hoisted.

- [x] **Step 3: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['utils/**/*.test.ts', 'composables/**/*.test.ts', 'stores/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
```

- [x] **Step 4: Add test scripts**

In `apps/web/package.json`, under `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

In repo-root `package.json`'s `"scripts"`:
```json
"test:web": "pnpm --filter @travel-agent/web test"
```

- [x] **Step 5: Update `nuxt.config.ts` to transpile motion-v**

Add `build: { transpile: ['motion-v'] }` to the config object (merge with existing fields; do not remove anything). Keep all existing head/modules/runtimeConfig blocks.

- [x] **Step 6: Smoke-test vitest**

```bash
pnpm --filter @travel-agent/web test
```
Expected: `Test Files: 0 · Tests: 0 (passWithNoTests)`, exit 0.

- [x] **Step 7: Verify build still passes**

```bash
pnpm build:web
```
Expected: Nuxt build completes without errors.

- [x] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/nuxt.config.ts package.json pnpm-lock.yaml
git commit -m "feat(web): install reka-ui, lucide, motion-v, vue-sonner and configure vitest"
```

---

### Task 2: Extend design tokens in main.css

**Files:**
- Modify: `apps/web/assets/css/main.css` (the `:root` block; then append utilities at EOF)

- [x] **Step 1: Add display type scale tokens**

Inside the existing `:root { ... }` block, **after** the `/* Type */` section and **before** `/* Radii */`, insert:

```css
  /* Type scale (display + body hierarchy) */
  --type-display-xl-size:     clamp(44px, 5.5vw, 64px);
  --type-display-xl-tracking: -0.03em;
  --type-display-lg-size:     clamp(32px, 3.8vw, 44px);
  --type-display-lg-tracking: -0.025em;
  --type-display-md-size:     30px;
  --type-display-md-tracking: -0.02em;
  --type-heading-size:        20px;
  --type-heading-tracking:    -0.01em;
  --type-subhead-size:        16px;
  --type-body-lg-size:        15px;
  --type-body-size:           14px;
  --type-body-sm-size:        13px;
  --type-caption-size:        12px;
  --type-mono-xs-size:        11px;
  --type-mono-xs-tracking:    0.08em;
```

- [x] **Step 2: Add new surface/shadow/gradient tokens**

In the same `:root`, **after** the existing `--shadow-brand` line, add:

```css
  /* Elevated surfaces + named gradients */
  --border-subtle-2:   #F8F9FB;
  --bg-glass:          rgba(255, 255, 255, 0.92);
  --shadow-artifact:   0 20px 60px rgba(17, 24, 39, 0.10);
  --shadow-card-hover: 0 8px 24px rgba(17, 24, 39, 0.08);

  --gradient-brand: linear-gradient(135deg, #7B5BFF 0%, #4F7CFF 100%);
  --gradient-aurora-soft:
    radial-gradient(600px 240px at 15% 10%, rgba(123, 91, 255, 0.12), transparent 60%),
    radial-gradient(500px 220px at 85% 80%, rgba(79, 124, 255, 0.10), transparent 60%);
  --gradient-grid-mesh:
    linear-gradient(rgba(17, 24, 39, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(17, 24, 39, 0.04) 1px, transparent 1px);

  --gradient-poi-hotel:   linear-gradient(135deg, #A78BFA, #7C3AED);
  --gradient-poi-food:    linear-gradient(135deg, #FCA5A5, #DC2626);
  --gradient-poi-poi:     linear-gradient(135deg, #6EE7B7, #059669);
  --gradient-poi-transit: linear-gradient(135deg, #93C5FD, #2563EB);
```

Note: the existing `--brand-gradient` token stays (existing consumers); `--gradient-brand` is a new alias with the same value.

- [x] **Step 3: Fix focus-visible + add utility classes**

Find the existing `:focus-visible` rule (currently around lines 153-157). Change `outline-offset: 2px;` to `outline-offset: -1px;`.

Then at the very end of the file, append:

```css
/* ───────────────────────────────────────────────────────────────────────────
   Utility primitives added during frontend-polish v2
   ─────────────────────────────────────────────────────────────────────────── */

.currency-unit {
  font-size: 0.72em;
  color: var(--text-muted);
  font-weight: 500;
  margin-right: 2px;
}

.tabular { font-variant-numeric: tabular-nums; }
```

- [x] **Step 4: Verify build succeeds**

```bash
pnpm build:web
```
Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add apps/web/assets/css/main.css
git commit -m "feat(web): extend CSS tokens (display scale, gradients, artifact shadow, utility classes)"
```

---

### Task 3: Motion primitives composable (TDD)

**Files:**
- Create: `apps/web/composables/useMotion.ts`
- Create: `apps/web/composables/useMotion.test.ts`

- [x] **Step 1: Write the failing test**

Create `apps/web/composables/useMotion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { motionPresets } from './useMotion'

describe('motionPresets', () => {
  it('exposes five named presets', () => {
    expect(Object.keys(motionPresets).sort()).toEqual([
      'fadeIn', 'ghostPulse', 'listStagger', 'pop', 'slideUp',
    ])
  })

  it('fadeIn lasts 240ms', () => {
    expect(motionPresets.fadeIn.transition?.duration).toBe(0.24)
  })

  it('slideUp moves from y:8 to y:0', () => {
    expect(motionPresets.slideUp.initial).toMatchObject({ y: 8, opacity: 0 })
    expect(motionPresets.slideUp.animate).toMatchObject({ y: 0, opacity: 1 })
  })

  it('pop scales from 0.96 to 1', () => {
    expect(motionPresets.pop.initial).toMatchObject({ scale: 0.96, opacity: 0 })
    expect(motionPresets.pop.animate).toMatchObject({ scale: 1, opacity: 1 })
  })

  it('listStagger declares a 40ms child delay', () => {
    expect(motionPresets.listStagger.staggerChildren).toBe(0.04)
  })

  it('ghostPulse loops indefinitely at 1.6s', () => {
    expect(motionPresets.ghostPulse.transition?.duration).toBe(1.6)
    expect(motionPresets.ghostPulse.transition?.repeat).toBe(Infinity)
  })
})
```

- [x] **Step 2: Run test — FAIL**

```bash
pnpm --filter @travel-agent/web test composables/useMotion.test.ts
```
Expected: FAIL with "Cannot find module './useMotion'".

- [x] **Step 3: Implement `useMotion.ts`**

```ts
// Named motion presets used across the app. Values are expressed in the
// format expected by motion-v (`initial` / `animate` / `transition`).

const easeOut = [0.2, 0.7, 0.25, 1] as const

export const motionPresets = {
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.24, ease: 'easeOut' as const },
  },
  slideUp: {
    initial: { y: 8, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { duration: 0.32, ease: easeOut },
  },
  pop: {
    initial: { scale: 0.96, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: { duration: 0.2, ease: easeOut },
  },
  listStagger: {
    staggerChildren: 0.04,
  },
  ghostPulse: {
    animate: { opacity: [0.6, 1, 0.6] },
    transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' as const },
  },
} as const

export type MotionPresetName = keyof typeof motionPresets
```

- [x] **Step 4: Run test — PASS**

```bash
pnpm --filter @travel-agent/web test composables/useMotion.test.ts
```
Expected: 6 tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/web/composables/useMotion.ts apps/web/composables/useMotion.test.ts
git commit -m "feat(web): add motion presets (fadeIn, slideUp, pop, listStagger, ghostPulse)"
```

---

### Task 4: Toast plugin (vue-sonner)

**Files:**
- Create: `apps/web/plugins/toast.client.ts`
- Create: `apps/web/components/ui/Toaster.vue`
- Modify: `apps/web/app.vue`

- [x] **Step 1: Create the Toaster wrapper**

`apps/web/components/ui/Toaster.vue`:

```vue
<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'
</script>

<template>
  <Toaster
    position="top-right"
    :duration="2000"
    :close-button="false"
    theme="light"
    :toast-options="{
      style: {
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        borderRadius: 'var(--r-sm)',
        boxShadow: 'var(--shadow-card)',
        fontFamily: 'var(--font-body)',
        fontSize: '13px',
      },
    }"
  />
</template>
```

- [x] **Step 2: Create the `$toast` plugin**

`apps/web/plugins/toast.client.ts`:

```ts
import { toast } from 'vue-sonner'

export default defineNuxtPlugin(() => ({
  provide: {
    toast: {
      success: (message: string) => toast.success(message),
      error:   (message: string) => toast.error(message),
      info:    (message: string) => toast(message),
    },
  },
}))
```

- [x] **Step 3: Mount `<Toaster />` in app.vue**

Read current `apps/web/app.vue` first. If it's `<NuxtPage />` (or a similar single-line template), replace with:

```vue
<script setup lang="ts">
import Toaster from '~/components/ui/Toaster.vue'
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Toaster />
</template>
```

If it already has structure, add `<Toaster />` just before the closing `</template>`.

- [x] **Step 4: Verify build**

```bash
pnpm build:web
```
Expected: no errors, vue-sonner bundled.

- [x] **Step 5: Commit**

```bash
git add apps/web/plugins/toast.client.ts apps/web/components/ui/Toaster.vue apps/web/app.vue
git commit -m "feat(web): wire vue-sonner Toaster with \$toast plugin"
```

---

## Phase 2 · Utilities (Tasks 5–7)

### Task 5: POI visual utility (TDD)

**Files:**
- Create: `apps/web/utils/poi-visual.ts`
- Create: `apps/web/utils/poi-visual.test.ts`

- [x] **Step 1: Write the failing test**

`apps/web/utils/poi-visual.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { poiVisualForType } from './poi-visual'

describe('poiVisualForType', () => {
  it('returns the hotel gradient for lodging', () => {
    expect(poiVisualForType('lodging')).toEqual({
      gradient: 'var(--gradient-poi-hotel)',
      icon: 'bed',
    })
  })

  it('returns the food gradient for meal', () => {
    expect(poiVisualForType('meal')).toEqual({
      gradient: 'var(--gradient-poi-food)',
      icon: 'utensils-crossed',
    })
  })

  it('returns the POI gradient for attraction', () => {
    expect(poiVisualForType('attraction')).toEqual({
      gradient: 'var(--gradient-poi-poi)',
      icon: 'mountain',
    })
  })

  it('returns the transit gradient for transport', () => {
    expect(poiVisualForType('transport')).toEqual({
      gradient: 'var(--gradient-poi-transit)',
      icon: 'tram-front',
    })
  })

  it('returns POI gradient + compass for activity', () => {
    expect(poiVisualForType('activity')).toEqual({
      gradient: 'var(--gradient-poi-poi)',
      icon: 'compass',
    })
  })

  it('returns a neutral grey gradient + sticky-note for note', () => {
    const v = poiVisualForType('note')
    expect(v.icon).toBe('sticky-note')
    expect(v.gradient).toMatch(/linear-gradient/)
    expect(v.gradient).not.toMatch(/var\(--gradient-poi-/)
  })

  it('falls back to attraction for unknown types', () => {
    expect(poiVisualForType('xyz').gradient).toBe('var(--gradient-poi-poi)')
    expect(poiVisualForType('xyz').icon).toBe('mountain')
  })

  it('accepts undefined/null and returns fallback', () => {
    expect(poiVisualForType(undefined).icon).toBe('mountain')
    expect(poiVisualForType(null).icon).toBe('mountain')
  })
})
```

- [x] **Step 2: Run — FAIL**

```bash
pnpm --filter @travel-agent/web test utils/poi-visual.test.ts
```

- [x] **Step 3: Implement**

```ts
export interface PoiVisual {
  gradient: string
  icon: string
}

const CANONICAL: Record<string, PoiVisual> = {
  lodging:    { gradient: 'var(--gradient-poi-hotel)',   icon: 'bed' },
  meal:       { gradient: 'var(--gradient-poi-food)',    icon: 'utensils-crossed' },
  attraction: { gradient: 'var(--gradient-poi-poi)',     icon: 'mountain' },
  transport:  { gradient: 'var(--gradient-poi-transit)', icon: 'tram-front' },
  activity:   { gradient: 'var(--gradient-poi-poi)',     icon: 'compass' },
  note:       { gradient: 'linear-gradient(135deg, #D1D5DB, #6B7280)', icon: 'sticky-note' },
}

const FALLBACK: PoiVisual = CANONICAL.attraction

export function poiVisualForType(type: string | undefined | null): PoiVisual {
  if (!type) return FALLBACK
  return CANONICAL[type] ?? FALLBACK
}
```

- [x] **Step 4: Run — PASS**

Expected: 8 tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/web/utils/poi-visual.ts apps/web/utils/poi-visual.test.ts
git commit -m "feat(web): add poi-visual util mapping PlanItem.type to gradient + Lucide icon"
```

---

### Task 6: Destination color utility + wire into useTripHistory (TDD)

**Files:**
- Create: `apps/web/utils/destination-color.ts`
- Create: `apps/web/utils/destination-color.test.ts`
- Modify: `apps/web/composables/useTripHistory.ts` (delegate `coverForDestination` to the new util)

- [x] **Step 1: Write the failing test**

`apps/web/utils/destination-color.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { destinationColor } from './destination-color'

describe('destinationColor', () => {
  it('returns the Japan gradient for 京都', () => {
    expect(destinationColor('京都')).toMatch(/F9A8D4/)
  })
  it('returns the same Japan gradient for 东京 / 大阪 / 奈良', () => {
    const kyoto = destinationColor('京都')
    expect(destinationColor('东京')).toBe(kyoto)
    expect(destinationColor('大阪')).toBe(kyoto)
    expect(destinationColor('奈良')).toBe(kyoto)
  })
  it('returns the North-China gradient for 北京 / 西安 / 敦煌', () => {
    const bj = destinationColor('北京')
    expect(bj).toMatch(/FCD34D/)
    expect(destinationColor('西安')).toBe(bj)
    expect(destinationColor('敦煌')).toBe(bj)
  })
  it('returns the Hokkaido gradient for 北海道 / 札幌', () => {
    const hk = destinationColor('北海道')
    expect(hk).toMatch(/86EFAC/)
    expect(destinationColor('札幌')).toBe(hk)
  })
  it('returns the Jiangnan gradient for 杭州 / 苏州 / 上海', () => {
    const hz = destinationColor('杭州')
    expect(hz).toMatch(/C7D2FE/)
    expect(destinationColor('苏州')).toBe(hz)
    expect(destinationColor('上海')).toBe(hz)
  })
  it('returns the Europe gradient for 巴黎 / 伦敦 / 阿姆斯特丹', () => {
    const paris = destinationColor('巴黎')
    expect(paris).toMatch(/DDD6FE/)
    expect(destinationColor('伦敦')).toBe(paris)
    expect(destinationColor('阿姆斯特丹')).toBe(paris)
  })
  it('returns the SEA gradient for 清迈 / 曼谷 / 巴厘岛', () => {
    const cm = destinationColor('清迈')
    expect(cm).toMatch(/FDBA74/)
    expect(destinationColor('曼谷')).toBe(cm)
    expect(destinationColor('巴厘岛')).toBe(cm)
  })
  it('falls back to the brand gradient for unknown destinations', () => {
    expect(destinationColor('火星')).toMatch(/7B5BFF/)
    expect(destinationColor('')).toMatch(/7B5BFF/)
    expect(destinationColor(undefined)).toMatch(/7B5BFF/)
  })
})
```

- [x] **Step 2: Run — FAIL**

- [x] **Step 3: Implement**

```ts
interface DestinationBand {
  match: RegExp
  gradient: string
}

const BANDS: DestinationBand[] = [
  { match: /京都|奈良|东京|大阪|冲绳|横滨/, gradient: 'linear-gradient(135deg, #F9A8D4 0%, #EC4899 60%, #BE185D 100%)' },
  { match: /北海道|札幌|函馆|小樽/, gradient: 'linear-gradient(135deg, #86EFAC 0%, #10B981 60%, #047857 100%)' },
  { match: /北京|西安|敦煌|大同|太原/, gradient: 'linear-gradient(135deg, #FCD34D 0%, #F59E0B 60%, #B45309 100%)' },
  { match: /杭州|苏州|上海|南京|乌镇/, gradient: 'linear-gradient(135deg, #C7D2FE 0%, #818CF8 60%, #6366F1 100%)' },
  { match: /巴黎|伦敦|阿姆斯特丹|罗马|巴塞罗那|马德里|柏林|维也纳|布拉格|冰岛/, gradient: 'linear-gradient(135deg, #DDD6FE 0%, #A78BFA 60%, #7C3AED 100%)' },
  { match: /清迈|曼谷|巴厘岛|胡志明|河内|吉隆坡|新加坡|普吉|芽庄/, gradient: 'linear-gradient(135deg, #FDBA74 0%, #F97316 60%, #C2410C 100%)' },
]

const FALLBACK = 'linear-gradient(135deg, #7B5BFF 0%, #4F7CFF 100%)'

export function destinationColor(destination: string | undefined | null): string {
  if (!destination) return FALLBACK
  for (const band of BANDS) {
    if (band.match.test(destination)) return band.gradient
  }
  return FALLBACK
}
```

- [x] **Step 4: Run — PASS** (8 tests)

- [x] **Step 5: Delegate `coverForDestination` in `useTripHistory.ts`**

Open `apps/web/composables/useTripHistory.ts`. Find:
- `const COVER_PALETTES: string[] = [ ... ]` (~lines 16-25)
- `function hashString(...)` (~lines 62-69)
- `export function coverForDestination(destination: string): string { ... }` (~lines 71-75)

Replace all three with:

```ts
import { destinationColor } from '~/utils/destination-color'

export const coverForDestination = destinationColor
```

Also ensure the import is hoisted to the top of the file alongside the other imports.

- [x] **Step 6: Verify build + test**

```bash
pnpm build:web
pnpm --filter @travel-agent/web test
```
Expected: both pass. `TripHistoryGrid` still renders (it just uses the new semantic mapping).

- [x] **Step 7: Commit**

```bash
git add apps/web/utils/destination-color.ts apps/web/utils/destination-color.test.ts apps/web/composables/useTripHistory.ts
git commit -m "feat(web): add destination-color util with semantic mapping; delegate coverForDestination"
```

---

### Task 7: Relative time utility (TDD)

**Files:**
- Create: `apps/web/utils/relative-time.ts`
- Create: `apps/web/utils/relative-time.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { relativeTime } from './relative-time'

const now = new Date('2026-04-24T12:00:00Z').getTime()

describe('relativeTime', () => {
  it('returns "刚刚" for times within 30 seconds', () => {
    expect(relativeTime(new Date(now - 5_000), now)).toBe('刚刚')
    expect(relativeTime(new Date(now - 30_000), now)).toBe('刚刚')
  })
  it('returns "N 分钟前" for minutes', () => {
    expect(relativeTime(new Date(now - 2 * 60_000), now)).toBe('2 分钟前')
    expect(relativeTime(new Date(now - 59 * 60_000), now)).toBe('59 分钟前')
  })
  it('returns "N 小时前" for hours', () => {
    expect(relativeTime(new Date(now - 3 * 3600_000), now)).toBe('3 小时前')
    expect(relativeTime(new Date(now - 23 * 3600_000), now)).toBe('23 小时前')
  })
  it('returns "N 天前" up to 7 days', () => {
    expect(relativeTime(new Date(now - 2 * 86400_000), now)).toBe('2 天前')
    expect(relativeTime(new Date(now - 7 * 86400_000), now)).toBe('7 天前')
  })
  it('returns mm-dd for anything older than 7 days', () => {
    const older = new Date('2026-04-01T12:00:00Z').getTime()
    const result = relativeTime(older, now)
    expect(result).toMatch(/^\d{2}-\d{2}$/)
  })
  it('accepts ISO strings', () => {
    expect(relativeTime('2026-04-24T11:58:00Z', now)).toBe('2 分钟前')
  })
  it('returns empty string for invalid input', () => {
    expect(relativeTime('not-a-date', now)).toBe('')
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime(undefined, now)).toBe('')
  })
})
```

- [x] **Step 2: Run — FAIL**

- [x] **Step 3: Implement**

```ts
export function relativeTime(
  input: Date | string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (input == null) return ''
  const date = input instanceof Date ? input : new Date(input)
  const ms = date.getTime()
  if (Number.isNaN(ms)) return ''

  const diffSec = Math.max(0, Math.floor((now - ms) / 1000))
  if (diffSec < 31) return '刚刚'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`

  const diffDay = Math.floor(diffHr / 24)
  if (diffDay <= 7) return `${diffDay} 天前`

  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}
```

- [x] **Step 4: Run — PASS** (7 tests)

- [x] **Step 5: Commit**

```bash
git add apps/web/utils/relative-time.ts apps/web/utils/relative-time.test.ts
git commit -m "feat(web): add relative-time util (刚刚 / N 分钟/小时/天前 / mm-dd)"
```

---

## Phase 3 · UI Primitives (Tasks 8–11)

### Task 8: Tooltip wrapper

**Files:**
- Create: `apps/web/components/ui/Tooltip.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
import {
  TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipProvider,
} from 'reka-ui'

defineProps<{
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  delay?: number
}>()
</script>

<template>
  <TooltipProvider :delay-duration="delay ?? 150">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side ?? 'top'"
          :side-offset="6"
          class="tooltip-content"
        >
          {{ label }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style scoped>
.tooltip-content {
  padding: 5px 9px;
  background: var(--text);
  color: var(--text-inverse);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.02em;
  border-radius: var(--r-xs);
  box-shadow: var(--shadow-lift);
  animation: tooltip-in 160ms var(--ease-out);
  user-select: none;
  z-index: 50;
}

@keyframes tooltip-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .tooltip-content { animation: none; }
}
</style>
```

- [x] **Step 2: Verify build**

```bash
pnpm build:web
```

- [x] **Step 3: Commit**

```bash
git add apps/web/components/ui/Tooltip.vue
git commit -m "feat(web/ui): Tooltip wrapper (Reka UI)"
```

---

### Task 9: DropdownMenu wrapper

**Files:**
- Create: `apps/web/components/ui/DropdownMenu.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent,
} from 'reka-ui'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent :side-offset="6" align="end" class="dm-content">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<script lang="ts">
export { DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui'
</script>

<style scoped>
.dm-content {
  min-width: 200px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lift);
  animation: dm-in 200ms var(--ease-out);
  z-index: 50;
}

.dm-content :deep([data-reka-dropdown-menu-item]) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text);
  border-radius: var(--r-xs);
  cursor: pointer;
  outline: none;
  transition: background-color var(--dur-fast) var(--ease-out);
}
.dm-content :deep([data-reka-dropdown-menu-item][data-highlighted]) {
  background: var(--bg-subtle);
}
.dm-content :deep([data-reka-dropdown-menu-item].is-danger) {
  color: var(--accent-danger);
}
.dm-content :deep([data-reka-dropdown-menu-item].is-danger[data-highlighted]) {
  background: var(--accent-danger-soft);
}
.dm-content :deep([data-reka-dropdown-menu-separator]) {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 2px;
}

@keyframes dm-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dm-content { animation: none; }
}
</style>
```

- [x] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/ui/DropdownMenu.vue
git commit -m "feat(web/ui): DropdownMenu wrapper (Reka UI) with item/separator re-exports"
```

---

### Task 10: Dialog wrapper

**Files:**
- Create: `apps/web/components/ui/Dialog.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
import {
  DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent,
  DialogTitle, DialogDescription,
} from 'reka-ui'

defineProps<{
  open?: boolean
  title?: string
  description?: string
}>()

defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => $emit('update:open', v)">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="dg-overlay" />
      <DialogContent class="dg-content">
        <DialogTitle v-if="title" class="dg-title">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="dg-desc">{{ description }}</DialogDescription>
        <slot />
        <div v-if="$slots.actions" class="dg-actions">
          <slot name="actions" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script lang="ts">
export { DialogClose } from 'reka-ui'
</script>

<style scoped>
.dg-overlay {
  position: fixed; inset: 0;
  background: rgba(17, 24, 39, 0.36);
  backdrop-filter: blur(4px);
  z-index: 50;
  animation: dg-fade 180ms var(--ease-out);
}

.dg-content {
  position: fixed; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: min(90vw, 440px);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-artifact);
  padding: 24px;
  z-index: 51;
  animation: dg-in 200ms var(--ease-out);
}

.dg-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--type-heading-size);
  font-weight: 600;
  letter-spacing: var(--type-heading-tracking);
  color: var(--text);
}
.dg-desc {
  margin: 0 0 16px;
  color: var(--text-muted);
  font-size: var(--type-body-size);
  line-height: 1.55;
}
.dg-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 20px;
}

@keyframes dg-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dg-in {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dg-overlay, .dg-content { animation: none; }
}
</style>
```

- [x] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/ui/Dialog.vue
git commit -m "feat(web/ui): Dialog wrapper (Reka UI) with title/description/actions slots"
```

---

### Task 11: ScrollArea wrapper

**Files:**
- Create: `apps/web/components/ui/ScrollArea.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
import {
  ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar,
  ScrollAreaThumb, ScrollAreaCorner,
} from 'reka-ui'

defineProps<{ maxHeight?: string }>()
</script>

<template>
  <ScrollAreaRoot class="sa-root" :style="{ maxHeight }">
    <ScrollAreaViewport class="sa-viewport">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar orientation="vertical" class="sa-scrollbar">
      <ScrollAreaThumb class="sa-thumb" />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

<style scoped>
.sa-root {
  width: 100%; height: 100%;
  overflow: hidden; position: relative;
}
.sa-viewport { width: 100%; height: 100%; }
.sa-scrollbar {
  display: flex;
  user-select: none; touch-action: none;
  padding: 2px;
  background: transparent;
  transition: background-color 160ms var(--ease-out);
  width: 10px;
}
.sa-scrollbar:hover { background: var(--bg-subtle); }
.sa-thumb {
  flex: 1;
  background: var(--border-strong);
  border-radius: 999px;
  transition: background-color 160ms var(--ease-out);
}
.sa-thumb:hover { background: var(--text-subtle); }
</style>
```

- [x] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/ui/ScrollArea.vue
git commit -m "feat(web/ui): ScrollArea wrapper (Reka UI) with styled scrollbar"
```

---

## Phase 4 · State Components (Tasks 12–15)

### Task 12: EmptyState

**Files:**
- Create: `apps/web/components/states/EmptyState.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

defineProps<{
  icon: LucideIcon
  title: string
  hint?: string
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">
      <component :is="icon" :size="32" :stroke-width="1.5" />
    </div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty-hint">{{ hint }}</p>
    <slot name="action" />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 40px 24px; text-align: center;
  color: var(--text-muted);
}
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--bg-subtle); color: var(--text-subtle);
  margin-bottom: 6px;
}
.empty-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-body-size);
  font-weight: 600;
  color: var(--text);
}
.empty-hint {
  margin: 0;
  font-size: var(--type-body-sm-size);
  line-height: 1.55;
  max-width: 38ch;
}
</style>
```

- [x] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/states/EmptyState.vue
git commit -m "feat(web/states): EmptyState component (Lucide icon + title + hint + action slot)"
```

---

### Task 13: LoadingSkeleton

**Files:**
- Create: `apps/web/components/states/LoadingSkeleton.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
defineProps<{
  variant: 'plan' | 'chat' | 'history' | 'generic'
}>()
</script>

<template>
  <div class="skel-root" :data-variant="variant">
    <template v-if="variant === 'plan'">
      <div class="skel-bar skel-w-60 skel-h-7" />
      <div class="skel-row">
        <div class="skel-block" />
        <div class="skel-block" />
        <div class="skel-block" />
        <div class="skel-block" />
      </div>
      <div class="skel-bar skel-w-40" />
      <div class="skel-card" />
      <div class="skel-card" />
    </template>
    <template v-else-if="variant === 'chat'">
      <div class="skel-bubble skel-bubble-left" />
      <div class="skel-bubble skel-bubble-right" />
      <div class="skel-bubble skel-bubble-left" />
    </template>
    <template v-else-if="variant === 'history'">
      <div class="skel-grid">
        <div class="skel-hist" v-for="i in 3" :key="i" />
      </div>
    </template>
    <template v-else>
      <div class="skel-bar skel-w-60" />
      <div class="skel-bar skel-w-80" />
      <div class="skel-bar skel-w-50" />
    </template>
  </div>
</template>

<style scoped>
.skel-root { display: flex; flex-direction: column; gap: 10px; padding: 4px; }

.skel-bar, .skel-block, .skel-card, .skel-bubble, .skel-hist {
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  animation: skel-pulse 1.6s var(--ease-out) infinite;
}

.skel-bar { height: 12px; }
.skel-bar.skel-h-7 { height: 28px; }
.skel-w-40 { width: 40%; }
.skel-w-50 { width: 50%; }
.skel-w-60 { width: 60%; }
.skel-w-80 { width: 80%; }

.skel-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.skel-block { height: 56px; border-radius: 10px; }
.skel-card { height: 72px; }

.skel-bubble { height: 44px; width: 70%; border-radius: 12px; }
.skel-bubble-right { align-self: flex-end; }
.skel-bubble-left { align-self: flex-start; }

.skel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.skel-hist { height: 160px; }

@keyframes skel-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .skel-bar, .skel-block, .skel-card, .skel-bubble, .skel-hist {
    animation: none; opacity: 0.8;
  }
}
</style>
```

- [x] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/states/LoadingSkeleton.vue
git commit -m "feat(web/states): LoadingSkeleton (plan/chat/history/generic variants)"
```

---

### Task 14: ErrorState

**Files:**
- Create: `apps/web/components/states/ErrorState.vue`

- [x] **Step 1: Implement**

```vue
<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

defineProps<{
  title: string
  detail?: string
  retryLabel?: string
}>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="error-state" role="alert">
    <div class="error-icon">
      <AlertCircle :size="32" :stroke-width="1.5" />
    </div>
    <p class="error-title">{{ title }}</p>
    <p v-if="detail" class="error-detail">{{ detail }}</p>
    <button
      v-if="$attrs.onRetry || retryLabel"
      type="button"
      class="error-retry"
      @click="$emit('retry')"
    >
      {{ retryLabel ?? '重试' }}
    </button>
  </div>
</template>

<style scoped>
.error-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 36px 22px; text-align: center;
  background: var(--accent-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: var(--r-md);
  color: #991B1B;
}
.error-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: 12px;
  background: rgba(239, 68, 68, 0.14);
  color: var(--accent-danger);
  margin-bottom: 4px;
}
.error-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-body-size);
  font-weight: 600;
  color: #7F1D1D;
}
.error-detail {
  margin: 0;
  font-size: var(--type-body-sm-size);
  line-height: 1.55;
  max-width: 42ch;
  color: #991B1B;
}
.error-retry {
  margin-top: 10px;
  appearance: none;
  border: 1px solid rgba(239, 68, 68, 0.32);
  background: var(--bg-elevated);
  color: var(--accent-danger);
  padding: 7px 16px;
  border-radius: var(--r-sm);
  font-family: var(--font-display);
  font-size: var(--type-body-sm-size);
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.error-retry:hover { background: var(--accent-danger-soft); border-color: var(--accent-danger); }
</style>
```

- [x] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/states/ErrorState.vue
git commit -m "feat(web/states): ErrorState component (AlertCircle + retry)"
```

---

### Task 15: StreamingBubble (ReAct-aware)

**Files:**
- Create: `apps/web/components/states/StreamingBubble.vue`

Accepts an optional `loopStatus: 'evaluating' | 'refining' | null` and optional `iteration/maxIterations`. When present, the status text switches to the ReAct-specific messaging.

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  status: string
  steps?: string[]
  loopStatus?: 'evaluating' | 'refining' | null
  iteration?: number
  maxIterations?: number
}>()

const effectiveStatus = computed(() => {
  if (props.loopStatus === 'evaluating') return 'AI 正在评估当前方案…'
  if (props.loopStatus === 'refining' && props.iteration && props.maxIterations) {
    return `第 ${props.iteration} / ${props.maxIterations} 轮优化中…`
  }
  return props.status
})
</script>

<template>
  <article class="streaming-bubble">
    <div class="streaming-row">
      <Sparkles :size="16" :stroke-width="1.75" class="streaming-icon" />
      <span class="streaming-status">{{ effectiveStatus }}</span>
    </div>
    <ul v-if="steps?.length" class="streaming-steps">
      <li v-for="step in steps" :key="step">{{ step }}</li>
    </ul>
  </article>
</template>

<style scoped>
.streaming-bubble {
  align-self: flex-start;
  max-width: 85%;
  padding: 11px 14px;
  border: 1px solid var(--brand-blue-border);
  border-left: 3px solid var(--brand-blue);
  border-radius: var(--r-md) var(--r-md) var(--r-md) 2px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
  animation: streaming-pulse 1.6s ease-in-out infinite;
}
.streaming-row {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: var(--type-body-sm-size);
}
.streaming-icon {
  animation: sparkle-spin 3.2s linear infinite;
  color: var(--brand-blue);
}
.streaming-status { color: var(--brand-blue-deep); font-weight: 500; }
.streaming-steps {
  margin: 10px 0 0;
  padding-left: 18px;
  list-style: none;
  display: flex; flex-direction: column; gap: 4px;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
}
.streaming-steps li { position: relative; line-height: 1.5; }
.streaming-steps li::before {
  content: "•"; position: absolute; left: -14px; top: 0;
  color: var(--brand-blue); font-weight: 700;
}

@keyframes streaming-pulse {
  0%, 100% { background: var(--brand-blue-soft); }
  50%      { background: rgba(79, 124, 255, 0.14); }
}
@keyframes sparkle-spin {
  from { transform: rotate(0deg); } to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .streaming-bubble, .streaming-icon { animation: none; }
}
</style>
```

- [ ] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/states/StreamingBubble.vue
git commit -m "feat(web/states): StreamingBubble with Sparkles + ReAct loopStatus support"
```

---

## Phase 5 · ReAct Loop UI (Tasks 16–18)

### Task 16: `ReactProgressBar.vue`

**Files:**
- Create: `apps/web/components/react/ReactProgressBar.vue`

Replaces the inline `.react-progress` block currently in `pages/index.vue`.

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  loopStatus: 'evaluating' | 'refining'
  iteration: number
  maxIterations: number
  displayScore: number | null
  targetScore: number
}>()

const label = computed(() => {
  if (props.loopStatus === 'evaluating') return 'AI 正在评估当前方案…'
  return `第 ${props.iteration} / ${props.maxIterations} 轮优化中`
})

const progressPct = computed(() => {
  if (props.displayScore == null || props.targetScore <= 0) return 0
  return Math.min(100, (props.displayScore / props.targetScore) * 100)
})

const reached = computed(() =>
  props.displayScore != null && props.displayScore >= props.targetScore,
)
</script>

<template>
  <div class="react-progress" :class="{ 'is-reached': reached }" role="status" aria-live="polite">
    <div class="react-progress-head">
      <span class="react-progress-label">
        <Sparkles :size="14" :stroke-width="1.75" />
        {{ label }}
      </span>
      <span v-if="displayScore !== null" class="react-progress-score tabular">
        {{ displayScore }} <span class="currency-unit">/ {{ targetScore }}</span>
      </span>
    </div>
    <div class="react-progress-bar">
      <div class="react-progress-fill" :style="{ width: `${progressPct}%` }" />
    </div>
  </div>
</template>

<style scoped>
.react-progress {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-left: 3px solid var(--brand-purple);
  border-radius: var(--r-md);
  padding: 12px 16px;
  display: flex; flex-direction: column; gap: 10px;
  box-shadow: var(--shadow-sm);
  animation: react-pulse 1.6s ease-in-out infinite;
}
.react-progress.is-reached { animation: none; border-left-color: var(--accent-success); }

.react-progress-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.react-progress-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-display);
  font-size: var(--type-body-sm-size);
  color: var(--text);
  font-weight: 600;
}
.react-progress-label :deep(svg) { color: var(--brand-purple); }

.react-progress-score {
  font-family: var(--font-mono);
  font-size: var(--type-body-sm-size);
  color: var(--brand-purple);
  font-weight: 600;
}

.react-progress-bar {
  height: 6px; border-radius: 999px;
  background: var(--brand-purple-soft);
  overflow: hidden;
}
.react-progress-fill {
  height: 100%; border-radius: 999px;
  background: var(--gradient-brand);
  transition: width 300ms var(--ease-out);
  box-shadow: 0 0 10px rgba(79, 124, 255, 0.3);
}
.react-progress.is-reached .react-progress-fill {
  background: linear-gradient(135deg, var(--accent-success), #059669);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
}

@keyframes react-pulse {
  0%, 100% { box-shadow: var(--shadow-sm); }
  50%      { box-shadow: 0 0 0 3px rgba(123, 91, 255, 0.12), var(--shadow-sm); }
}
@media (prefers-reduced-motion: reduce) {
  .react-progress { animation: none; }
  .react-progress-fill { transition: none; }
}
</style>
```

- [ ] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/react/ReactProgressBar.vue
git commit -m "feat(web/react): ReactProgressBar with Sparkles + gradient fill + reached state"
```

---

### Task 17: `ClarifyCard.vue`

**Files:**
- Create: `apps/web/components/react/ClarifyCard.vue`

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import { MessageCircleQuestion } from 'lucide-vue-next'

defineProps<{
  question: string
  reason?: string
}>()
</script>

<template>
  <div class="clarify-card" role="dialog" aria-live="polite">
    <p class="clarify-kicker">
      <MessageCircleQuestion :size="14" :stroke-width="1.75" />
      需要补充信息
    </p>
    <p class="clarify-question">"{{ question }}"</p>
    <p class="clarify-hint">
      {{ reason || '在下方对话框中回复，方案会继续生成。' }}
    </p>
  </div>
</template>

<style scoped>
.clarify-card {
  background: var(--brand-blue-soft);
  border: 1px solid var(--brand-blue-border);
  border-left: 3px solid var(--brand-blue);
  border-radius: var(--r-md);
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
  animation: clarify-in 320ms var(--ease-out);
}
.clarify-kicker {
  margin: 0;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  color: var(--brand-blue-deep);
  text-transform: uppercase;
}
.clarify-question {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}
.clarify-hint {
  margin: 0;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
  line-height: 1.55;
}

@keyframes clarify-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .clarify-card { animation: none; }
}
</style>
```

- [ ] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/react/ClarifyCard.vue
git commit -m "feat(web/react): ClarifyCard for LLM clarification requests"
```

---

### Task 18: `MaxIterCard.vue`

**Files:**
- Create: `apps/web/components/react/MaxIterCard.vue`

- [ ] **Step 1: Implement**

```vue
<script setup lang="ts">
import { Flag, ArrowRight } from 'lucide-vue-next'

defineProps<{
  maxIterations: number
  currentScore: number
  targetScore: number
}>()

defineEmits<{ continue: [] }>()
</script>

<template>
  <div class="maxiter-card">
    <div class="maxiter-icon">
      <Flag :size="18" :stroke-width="1.75" />
    </div>
    <div class="maxiter-body">
      <p class="maxiter-title">已优化 {{ maxIterations }} 轮</p>
      <p class="maxiter-meta">
        当前 <b class="tabular">{{ currentScore }}</b> 分（目标
        <b class="tabular">{{ targetScore }}</b>），是否继续优化？
      </p>
    </div>
    <button type="button" class="maxiter-cta" @click="$emit('continue')">
      继续优化
      <ArrowRight :size="14" :stroke-width="1.75" />
    </button>
  </div>
</template>

<style scoped>
.maxiter-card {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--accent-warn-soft);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--r-md);
  animation: maxiter-in 320ms var(--ease-out);
}
.maxiter-icon {
  width: 40px; height: 40px;
  border-radius: var(--r-md);
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.14);
  color: #B45309;
}
.maxiter-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  color: #7C2D12;
  letter-spacing: -0.01em;
}
.maxiter-meta {
  margin: 2px 0 0;
  font-size: var(--type-body-sm-size);
  color: #92400E;
  line-height: 1.5;
}
.maxiter-cta {
  appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  border: 0;
  border-radius: var(--r-sm);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--type-body-sm-size);
  cursor: pointer;
  box-shadow: var(--shadow-brand);
  transition: box-shadow var(--dur-fast) var(--ease-out);
}
.maxiter-cta:hover { box-shadow: 0 12px 28px rgba(79, 124, 255, 0.32); }

@keyframes maxiter-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .maxiter-card { animation: none; }
}
@media (max-width: 640px) {
  .maxiter-card { grid-template-columns: 1fr; gap: 8px; text-align: left; }
  .maxiter-cta { justify-self: start; }
}
</style>
```

- [ ] **Step 2: Verify build + commit**

```bash
pnpm build:web
git add apps/web/components/react/MaxIterCard.vue
git commit -m "feat(web/react): MaxIterCard with continue-optimization CTA"
```

---

## Phase 6 · Surface Redesigns (Tasks 19–25)

### Task 19: Topbar breadcrumb + user DropdownMenu + Toast replacement

**Files:**
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Add imports to `<script setup>`**

```ts
import DropdownMenu, { DropdownMenuItem, DropdownMenuSeparator } from '~/components/ui/DropdownMenu.vue'
import { ChevronDown, User, History, Settings, LogOut } from 'lucide-vue-next'
```

Also add (near `const route = useRoute()`):
```ts
const { $toast } = useNuxtApp()
```

- [ ] **Step 2: Compute breadcrumb parts**

Near the other computeds:
```ts
const breadcrumbDestination = computed(() => currentPlan.value?.destination || '')
```

- [ ] **Step 3: Replace the topbar block**

Find `<header class="page-topbar">...</header>` in the template. Replace entirely with:

```html
<header class="page-topbar">
  <div class="page-topbar-brand">
    <button
      type="button"
      class="compact-brand"
      aria-label="回到首页"
      @click="returnToLanding"
    >
      旅行规划助手
    </button>
    <div v-if="breadcrumbDestination" class="page-breadcrumb">
      <span>规划</span>
      <span class="page-breadcrumb-sep">/</span>
      <span class="page-breadcrumb-current">{{ breadcrumbDestination }}</span>
    </div>
    <p v-else class="page-topbar-copy">
      输入目的地、天数、预算和偏好，我会生成可继续追问的旅行方案。
    </p>
  </div>

  <div class="page-topbar-actions">
    <DropdownMenu>
      <template #trigger>
        <button type="button" class="page-user-chip">
          {{ username }}
          <ChevronDown :size="14" :stroke-width="1.75" />
        </button>
      </template>
      <DropdownMenuItem @select="() => {}">
        <User :size="14" :stroke-width="1.5" />
        账号信息
      </DropdownMenuItem>
      <DropdownMenuItem @select="returnToLanding">
        <History :size="14" :stroke-width="1.5" />
        规划历史
      </DropdownMenuItem>
      <DropdownMenuItem @select="() => {}">
        <Settings :size="14" :stroke-width="1.5" />
        偏好设置
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="is-danger" @select="submitLogout">
        <LogOut :size="14" :stroke-width="1.5" />
        {{ logoutPending ? '退出中…' : '退出登录' }}
      </DropdownMenuItem>
    </DropdownMenu>
  </div>
</header>
```

- [ ] **Step 4: Replace page banners with Toast watchers**

Delete these template blocks:
```html
<p v-if="pageNotice" class="page-auth-notice">...</p>
<p v-else-if="authErrorMessage" class="page-auth-error">...</p>
```

Add in `<script setup>` (at top-level, after `pageNotice` computed):
```ts
watch(pageNotice, (msg) => { if (msg) $toast.info(msg) })
watch(authErrorMessage, (msg) => { if (msg) $toast.error(msg) })
```

- [ ] **Step 5: Add breadcrumb + user-chip scoped styles**

Append to the scoped `<style>` block in `pages/index.vue`:

```css
.page-breadcrumb {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-mono);
  font-size: var(--type-caption-size);
  color: var(--text-subtle);
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.page-breadcrumb-sep { color: var(--text-subtle); opacity: 0.6; }
.page-breadcrumb-current { color: var(--text); font-weight: 600; }

.page-user-chip {
  appearance: none;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 5px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: var(--type-body-sm-size);
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.page-user-chip:hover { border-color: var(--border-strong); }
.page-user-chip::before {
  content: "";
  display: inline-block;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: var(--gradient-brand);
}
```

- [ ] **Step 6: Verify build + visual**

```bash
pnpm build:web
```

Dev server + Playwright MCP: log in, confirm topbar has user-chip with ChevronDown; click to see DropdownMenu with 4 items. Navigate with `?login=1` and confirm a Toast appears top-right (not a page banner).

- [ ] **Step 7: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web/topbar): breadcrumb + DropdownMenu user menu; Toast replaces page banners"
```

---

### Task 20: AuthLoginCard — value props + password Eye/EyeOff

**Files:**
- Modify: `apps/web/components/AuthLoginCard.vue`

- [ ] **Step 1: Add Lucide + Tooltip imports**

Top of `<script setup>`:
```ts
import { Sparkles, GitBranch, Download, Eye, EyeOff } from 'lucide-vue-next'
import Tooltip from '~/components/ui/Tooltip.vue'
```

- [ ] **Step 2: Replace the hero-pane bullet list**

Find `<ul class="auth-helper-list">...</ul>`. Replace entirely with:

```html
<ul class="auth-value-props">
  <li>
    <div class="auth-vp-icon"><Sparkles :size="18" :stroke-width="1.5" /></div>
    <div>
      <strong>AI 生成 3 套方案</strong>
      <small>不再反复 try & error</small>
    </div>
  </li>
  <li>
    <div class="auth-vp-icon"><GitBranch :size="18" :stroke-width="1.5" /></div>
    <div>
      <strong>可继续追问与迭代</strong>
      <small>每次修改都保留版本</small>
    </div>
  </li>
  <li>
    <div class="auth-vp-icon"><Download :size="18" :stroke-width="1.5" /></div>
    <div>
      <strong>随时继续上次的规划</strong>
      <small>不会丢</small>
    </div>
  </li>
</ul>
```

- [ ] **Step 3: Replace the password inline button**

Find `<button class="auth-inline-button">...</button>` inside `.auth-password-wrap`. Replace with:

```html
<Tooltip :label="showPassword ? '隐藏密码' : '显示密码'">
  <button
    type="button"
    class="auth-inline-icon-button"
    :disabled="loading"
    :aria-label="showPassword ? '隐藏密码' : '显示密码'"
    @click="showPassword = !showPassword"
  >
    <component :is="showPassword ? EyeOff : Eye" :size="16" :stroke-width="1.5" />
  </button>
</Tooltip>
```

(Assumes `showPassword` ref exists. If not, add `const showPassword = ref(false)` and bind the input `:type="showPassword ? 'text' : 'password'"`.)

- [ ] **Step 4: Add new styles at the end of the scoped `<style>`**

```css
.auth-value-props {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}
.auth-value-props li {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 12px;
  align-items: start;
}
.auth-vp-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
}
.auth-value-props strong {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--type-body-size);
  color: var(--text);
}
.auth-value-props small {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--type-body-sm-size);
  line-height: 1.5;
}

.auth-inline-icon-button {
  position: absolute;
  top: 50%; right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.auth-inline-icon-button:hover:not(:disabled) {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
}
.auth-inline-icon-button:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 5: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: `/login` shows 3 value-prop rows with purple icon tiles; Eye/EyeOff tooltip works on password field.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/AuthLoginCard.vue
git commit -m "feat(web/auth): value props with Lucide icons + Eye/EyeOff password toggle"
```

---

### Task 21: HeroPlannerCard — complete redesign

**Files:**
- Modify: `apps/web/components/HeroPlannerCard.vue`

**Note:** This is the largest single-component change. Keep existing emits. The whole origin/destination/date/prefs UI is replaced by a single Hero + composer — those detailed controls are not used by the current landing flow.

- [ ] **Step 1: Read current emit shape**

Check the top of the file. Confirm: `defineEmits<{ submit: [value: string] }>()` and `loading?: boolean` prop. Keep these.

- [ ] **Step 2: Add Lucide imports**

Top of `<script setup>`:
```ts
import { Sparkles, MapPin, Calendar, DollarSign, ArrowRight } from 'lucide-vue-next'
```

- [ ] **Step 3: Replace `<script setup>` body (except emit/props declarations)**

Between `defineProps` / `defineEmits` and the end of `<script setup>`, replace everything with:

```ts
const draftPrompt = ref('')
const presets = [
  { label: '杭州 · 3 天 · 美食拍照', value: '杭州 3 天 2 人，预算 3000，侧重美食和拍照' },
  { label: '北海道 · 7 天 · 冬季滑雪', value: '北海道 7 天 2 人，预算 15000，冬季滑雪为主' },
  { label: '东京 · 5 天 · 动漫之旅', value: '东京 5 天 1 人，预算 10000，动漫主题' },
  { label: '西班牙 · 10 天 · 深度', value: '西班牙 10 天 2 人，预算 30000，深度文化之旅' },
]

function submitPrompt() {
  const value = draftPrompt.value.trim()
  if (!value || props.loading) return
  emit('submit', value)
}

function applyPreset(value: string) {
  draftPrompt.value = value
}
```

- [ ] **Step 4: Replace the `<template>` block**

```html
<template>
  <section class="hero-shell">
    <div class="hero">
      <div class="hero-kicker">
        <span class="hero-dot" />
        <span>AI TRAVEL PLANNER</span>
      </div>

      <h1 class="hero-title">
        规划一次
        <br />
        <span class="hero-title-accent">称心的旅行</span>
      </h1>

      <p class="hero-sub">
        告诉我目的地、天数和预算 —— 我会用 ReAct 循环反复优化，一路带着你一起打磨。
      </p>

      <div class="hero-composer">
        <textarea
          v-model="draftPrompt"
          class="hero-composer-input"
          placeholder="说说你的出行需求：目的地 / 天数 / 人数 / 预算 / 偏好…"
          rows="2"
          :disabled="loading"
          @keydown.enter.exact.prevent="submitPrompt"
        />
        <div class="hero-composer-row">
          <div class="hero-tags">
            <span class="hero-tag"><MapPin :size="14" :stroke-width="1.5" />从 北京</span>
            <span class="hero-tag"><Calendar :size="14" :stroke-width="1.5" />5 天</span>
            <span class="hero-tag"><DollarSign :size="14" :stroke-width="1.5" />¥ 5,000</span>
          </div>
          <button
            type="button"
            class="hero-submit"
            :disabled="loading || !draftPrompt.trim()"
            @click="submitPrompt"
          >
            {{ loading ? '规划中…' : '开始规划' }}
            <ArrowRight :size="16" :stroke-width="1.75" />
          </button>
        </div>
      </div>

      <div class="hero-presets">
        <button
          v-for="preset in presets"
          :key="preset.label"
          type="button"
          class="hero-preset"
          @click="applyPreset(preset.value)"
        >
          <Sparkles :size="14" :stroke-width="1.5" />
          {{ preset.label }}
        </button>
      </div>
    </div>
  </section>
</template>
```

- [ ] **Step 5: Replace the entire `<style scoped>` block**

```css
<style scoped>
.hero-shell { margin-bottom: 14px; }

.hero {
  position: relative;
  padding: 56px 32px 44px;
  text-align: center;
  background:
    var(--gradient-aurora-soft),
    linear-gradient(180deg, transparent 0%, var(--bg-subtle) 100%);
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  overflow: hidden;
}

.hero::before {
  content: ""; position: absolute; inset: 0;
  background-image: var(--gradient-grid-mesh);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%);
  pointer-events: none;
}

.hero-kicker {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
  border: 1px solid var(--brand-blue-border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
}
.hero-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--brand-blue);
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.18);
}

.hero-title {
  position: relative; z-index: 1;
  margin: 20px 0 12px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--type-display-xl-size);
  letter-spacing: var(--type-display-xl-tracking);
  line-height: 1.08;
  color: var(--text);
}
.hero-title-accent {
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero-sub {
  position: relative; z-index: 1;
  margin: 0 auto 28px;
  max-width: 46ch;
  color: var(--text-muted);
  font-size: var(--type-body-lg-size);
  line-height: 1.55;
}

.hero-composer {
  position: relative; z-index: 1;
  max-width: 680px;
  margin: 0 auto;
  padding: 16px 18px 14px;
  background: var(--bg-glass);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-artifact);
  text-align: left;
}
.hero-composer-input {
  width: 100%;
  resize: none;
  border: 0; outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--type-body-lg-size);
  line-height: 1.55;
  min-height: 48px;
}
.hero-composer-input::placeholder { color: var(--text-subtle); }
.hero-composer-input:disabled { cursor: not-allowed; opacity: 0.7; }

.hero-composer-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.hero-tags { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.hero-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px;
  font-size: var(--type-caption-size);
  color: var(--text-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
}
.hero-tag :deep(svg) { color: var(--text-subtle); }

.hero-submit {
  appearance: none;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  border: 0; border-radius: var(--r-sm);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--type-body-size);
  cursor: pointer;
  box-shadow: var(--shadow-brand);
  transition: box-shadow var(--dur-fast) var(--ease-out);
  white-space: nowrap;
}
.hero-submit:hover:not(:disabled) { box-shadow: 0 12px 28px rgba(79, 124, 255, 0.32); }
.hero-submit:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: var(--shadow-sm); }

.hero-presets {
  position: relative; z-index: 1;
  margin-top: 24px;
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
}
.hero-preset {
  appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.hero-preset :deep(svg) { color: var(--brand-blue); }
.hero-preset:hover {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
  background: var(--brand-blue-soft);
}

@media (max-width: 640px) {
  .hero { padding: 36px 20px 28px; }
  .hero-title { font-size: clamp(32px, 8vw, 44px); }
  .hero-composer-row { flex-direction: column; align-items: stretch; }
  .hero-submit { justify-content: center; }
}
</style>
```

- [ ] **Step 6: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: `/` shows aurora hero, gradient-text title, glass composer, 4 preset pills.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/HeroPlannerCard.vue
git commit -m "feat(web/landing): redesign HeroPlannerCard with aurora Hero + glass composer + presets"
```

---

### Task 22: TripHistoryGrid — color bands + meta + EmptyState

**Files:**
- Modify: `apps/web/components/TripHistoryGrid.vue`

- [ ] **Step 1: Add imports**

Top of `<script setup>`:
```ts
import { Clock, Footprints, Compass } from 'lucide-vue-next'
import EmptyState from '~/components/states/EmptyState.vue'
import { relativeTime } from '~/utils/relative-time'
import { destinationColor } from '~/utils/destination-color'
```

- [ ] **Step 2: Replace the section header**

Find `<header class="trip-history-head">...</header>` (around line 40). Replace with:

```html
<header class="history-head">
  <h2 class="history-head-title">继续之前的规划</h2>
  <span v-if="entries.length" class="history-head-meta">
    RECENT · {{ entries.length }}
  </span>
</header>
```

- [ ] **Step 3: Replace the empty-state div**

Find `<div v-if="entries.length === 0" class="trip-history-empty">...</div>`. Replace with:

```html
<EmptyState
  v-if="entries.length === 0"
  :icon="Compass"
  title="还没有规划过的行程"
  hint="从上方的 Hero 里描述你的第一次出行需求吧。"
/>
```

- [ ] **Step 4: Replace the cards grid**

Find `<div v-else class="trip-history-grid">...</div>`. Replace with:

```html
<div v-else class="history-grid">
  <article
    v-for="entry in entries"
    :key="entry.sessionId"
    class="history-card"
    role="button"
    tabindex="0"
    @click="onSelect(entry)"
    @keydown.enter.prevent="onSelect(entry)"
    @keydown.space.prevent="onSelect(entry)"
  >
    <div
      class="history-band"
      :style="{ background: destinationColor(entry.destination || entry.title) }"
    />
    <div class="history-body">
      <div class="history-title-row">
        <strong class="history-dest">
          {{ entry.destination || entry.title }}
          <span v-if="entry.days" class="history-dest-meta">· {{ entry.days }} 天</span>
        </strong>
        <button
          type="button"
          class="history-remove"
          aria-label="删除该线路"
          @click.stop="onRemove(entry)"
        >×</button>
      </div>
      <div class="history-meta">
        <span class="history-meta-item">
          <Clock :size="12" :stroke-width="1.5" />
          {{ relativeTime(entry.updatedAt) }}
        </span>
        <span v-if="entry.poiCount" class="history-meta-item">
          <Footprints :size="12" :stroke-width="1.5" />
          {{ entry.poiCount }} 个安排
        </span>
      </div>
    </div>
  </article>
</div>
```

- [ ] **Step 5: Replace scoped styles**

Replace the entire `<style scoped>...</style>` with:

```css
<style scoped>
.trip-history { display: flex; flex-direction: column; gap: 14px; }

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 2px;
}
.history-head-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  letter-spacing: var(--type-heading-tracking);
  color: var(--text);
}
.history-head-meta {
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  color: var(--text-subtle);
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.history-card {
  display: flex; flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.history-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-card-hover);
  border-color: var(--border-strong);
}
.history-card:focus-visible {
  outline: 2px solid var(--brand-blue);
  outline-offset: -1px;
}

.history-band {
  height: 64px;
  position: relative;
}
.history-band::after {
  content: ""; position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 20% 80%, rgba(255,255,255,0.25), transparent 40%),
    radial-gradient(circle at 80% 20%, rgba(255,255,255,0.2), transparent 40%);
}

.history-body {
  padding: 14px 16px 16px;
  display: flex; flex-direction: column; gap: 8px;
}

.history-title-row {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
}

.history-dest {
  font-family: var(--font-display);
  font-size: var(--type-body-lg-size);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}
.history-dest-meta {
  color: var(--text-muted);
  font-weight: 500;
  margin-left: 4px;
}

.history-remove {
  appearance: none;
  border: 0; background: transparent;
  color: var(--text-subtle);
  font-size: 18px; line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--r-xs);
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.history-remove:hover { color: var(--accent-danger); background: var(--accent-danger-soft); }

.history-meta {
  display: flex; gap: 12px;
  font-size: var(--type-caption-size);
  color: var(--text-muted);
}
.history-meta-item {
  display: inline-flex; align-items: center; gap: 4px;
}
.history-meta-item :deep(svg) { color: var(--text-subtle); }

@media (max-width: 640px) {
  .history-grid { grid-template-columns: 1fr; }
}
</style>
```

- [ ] **Step 6: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: `/` with at least 1 history entry should show a card with destination color band + Clock / Footprints meta row.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/TripHistoryGrid.vue
git commit -m "feat(web/landing): TripHistoryGrid with destination color bands + icon meta + EmptyState"
```

---

### Task 23: ChatPanel — ScrollArea + StreamingBubble (ReAct-aware)

**Files:**
- Modify: `apps/web/components/ChatPanel.vue`

- [ ] **Step 1: Add imports**

Top of `<script setup>`:
```ts
import ScrollArea from '~/components/ui/ScrollArea.vue'
import StreamingBubble from '~/components/states/StreamingBubble.vue'
import { useChatStore } from '~/stores/chat'
import { storeToRefs } from 'pinia'
```

- [ ] **Step 2: Read loopStatus-related fields from the chat store**

In the same `<script setup>`, add:
```ts
const chatStore = useChatStore()
const { loopStatus, iteration, maxIterations } = storeToRefs(chatStore)
```

- [ ] **Step 3: Replace the conversation list**

Find `<div class="conversation-list">...</div>`. Replace with:

```html
<ScrollArea class="conversation-list">
  <article
    v-for="(message, index) in messages"
    :key="message.id"
    v-show="message.content.trim()"
    class="bubble"
    :class="`bubble-${message.role}`"
    :style="{ animationDelay: `${Math.min(index * 60, 480)}ms` }"
  >
    <p class="bubble-content">{{ message.content }}</p>
  </article>

  <StreamingBubble
    v-if="phase === 'planning'"
    :status="agentStatus"
    :steps="streamSteps"
    :loop-status="loopStatus"
    :iteration="iteration"
    :max-iterations="maxIterations"
  />
</ScrollArea>
```

Remove the old `<article v-if="phase === 'planning'" class="bubble bubble-assistant bubble-progress">...</article>` block.

- [ ] **Step 4: Soften the composer separator**

Find the existing `.conversation-composer` rule in scoped style. Change:
```css
border-top: 1px solid var(--border);
```
to:
```css
border-top: 1px solid var(--border-subtle-2);
```

- [ ] **Step 5: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: Submit a prompt. Observe:
- ScrollArea has a thin custom scrollbar appearing on the right when overflowing
- The streaming state shows the new StreamingBubble with Sparkles icon
- When `loopStatus` is `refining`, the bubble text says "第 N / M 轮优化中…" instead of `agentStatus`

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ChatPanel.vue
git commit -m "feat(web/chat): ScrollArea + ReAct-aware StreamingBubble"
```

---

### Task 24: PlanningPreview — Plan Hero slab + 4 stat cards

**Files:**
- Modify: `apps/web/components/PlanningPreview.vue` (only the plan header/summary section — not the whole file)

- [ ] **Step 1: Locate the plan-header block**

Open `apps/web/components/PlanningPreview.vue`. Find the block that currently renders the plan title and budget (likely starts with `<div class="plan-header-card">` or similar — search for `displayTitle`). Note its location.

- [ ] **Step 2: Add imports**

Top of `<script setup>`:
```ts
import { Calendar, DollarSign, Users, Award } from 'lucide-vue-next'
```

- [ ] **Step 3: Add computed values for the 4 stats**

Below the existing computeds:
```ts
const statDays = computed(() => currentPlan.value?.days ?? 0)
const statBudget = computed(() => currentPlan.value?.estimatedBudget?.amount ?? 0)
const statCurrency = computed(() => currentPlan.value?.estimatedBudget?.currency ?? 'CNY')
const statTravelers = computed(() => currentPlan.value?.travelers ?? 1)
const statScore = computed(() => {
  return currentScore.value?.overall ?? itineraryScore.value?.total ?? null
})
```

- [ ] **Step 4: Replace the plan-header block with the new Plan Hero slab**

Replace the existing header block (the one rendering `displayTitle` + budget/copy button) with:

```html
<section v-if="currentPlan" class="plan-hero-slab">
  <h2 class="plan-hero-title">{{ displayTitle }}</h2>
  <p v-if="displaySubtitle" class="plan-hero-sub">{{ displaySubtitle }}</p>

  <div class="plan-stats">
    <div class="plan-stat">
      <span class="plan-stat-label"><Calendar :size="12" :stroke-width="1.5" />DAYS</span>
      <span class="plan-stat-value tabular">
        {{ statDays }}<span class="currency-unit" style="margin-left: 3px;">天</span>
      </span>
    </div>
    <div class="plan-stat">
      <span class="plan-stat-label"><DollarSign :size="12" :stroke-width="1.5" />BUDGET</span>
      <span class="plan-stat-value tabular">
        <span class="currency-unit">{{ statCurrency === 'CNY' ? '¥' : statCurrency }}</span>{{ statBudget.toLocaleString() }}
      </span>
    </div>
    <div class="plan-stat">
      <span class="plan-stat-label"><Users :size="12" :stroke-width="1.5" />PEOPLE</span>
      <span class="plan-stat-value tabular">{{ statTravelers }}</span>
    </div>
    <div class="plan-stat">
      <span class="plan-stat-label"><Award :size="12" :stroke-width="1.5" />SCORE</span>
      <span class="plan-stat-value tabular">
        {{ statScore ?? '—' }}<span class="currency-unit" style="margin-left: 3px;">/ 100</span>
      </span>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Add Plan Hero styles**

At the end of the scoped `<style>`:

```css
.plan-hero-slab {
  position: relative;
  overflow: hidden;
  padding: 18px 20px 20px;
  margin-bottom: 14px;
  background: var(--gradient-aurora-soft), var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.plan-hero-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--type-display-lg-size);
  font-weight: 700;
  letter-spacing: var(--type-display-lg-tracking);
  line-height: 1.15;
  color: var(--text);
}
.plan-hero-sub {
  margin: 0;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
  line-height: 1.55;
}

.plan-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}
.plan-stat {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.plan-stat-label {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-subtle);
}
.plan-stat-label :deep(svg) { color: var(--text-subtle); }
.plan-stat-value {
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}

@media (max-width: 640px) {
  .plan-stats { grid-template-columns: repeat(2, 1fr); }
}
```

- [ ] **Step 6: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: with a plan loaded, the right panel's top shows Aurora hero slab with display-lg title + subtitle + 4 stat cards with Lucide icons.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/PlanningPreview.vue
git commit -m "feat(web/plan): Plan Hero slab with 4 stat cards (Days/Budget/People/Score)"
```

---

### Task 25: PlanningPreview — Day timeline + POI card

**Files:**
- Modify: `apps/web/components/PlanningPreview.vue` (day timeline section only)

- [ ] **Step 1: Add imports**

Merge into existing `<script setup>` imports:
```ts
import { Bed, UtensilsCrossed, Mountain, TramFront, Compass, StickyNote, Map as MapIcon, Replace, Info } from 'lucide-vue-next'
import { poiVisualForType } from '~/utils/poi-visual'
import Tooltip from '~/components/ui/Tooltip.vue'
```

- [ ] **Step 2: Add icon map and helpers**

```ts
const POI_ICON_COMPONENTS: Record<string, unknown> = {
  bed: Bed,
  'utensils-crossed': UtensilsCrossed,
  mountain: Mountain,
  'tram-front': TramFront,
  compass: Compass,
  'sticky-note': StickyNote,
}
function poiIconComponent(type: string | undefined) {
  const visual = poiVisualForType(type)
  return POI_ICON_COMPONENTS[visual.icon] ?? Mountain
}
function poiGradient(type: string | undefined) {
  return poiVisualForType(type).gradient
}
```

- [ ] **Step 3: Replace the Day list block**

Find the existing Day rendering loop (where `activeDailyPlans` is mapped into `.result-day-card` elements). Replace the entire section with:

```html
<section v-if="activeDailyPlans.length" class="plan-days">
  <article
    v-for="day in activeDailyPlans"
    :key="day.day"
    class="plan-day"
  >
    <header class="day-head">
      <div class="day-num">D{{ day.day }}</div>
      <div class="day-title-row">
        <strong class="day-title">{{ day.theme || `Day ${day.day}` }}</strong>
      </div>
    </header>

    <div class="day-items">
      <article
        v-for="(item, idx) in day.items"
        :key="`${day.day}-${idx}`"
        class="poi-card"
      >
        <div class="poi-thumb" :style="{ background: poiGradient(item.type) }">
          <component :is="poiIconComponent(item.type)" :size="22" :stroke-width="1.5" />
        </div>
        <div class="poi-body">
          <strong class="poi-title">{{ item.title }}</strong>
          <div class="poi-meta">
            <span v-if="item.description" class="poi-desc">{{ item.description }}</span>
          </div>
        </div>
        <div class="poi-right">
          <span v-if="item.time" class="poi-time tabular">{{ item.time }}</span>
          <span v-if="item.estimatedCost" class="poi-cost tabular">
            <span class="currency-unit">{{ (item.estimatedCost.currency || 'CNY') === 'CNY' ? '¥' : item.estimatedCost.currency }}</span>{{ item.estimatedCost.amount.toLocaleString() }}
          </span>
        </div>
        <div class="poi-actions">
          <Tooltip label="在地图上查看">
            <button type="button" class="poi-action" aria-label="在地图上查看"><MapIcon :size="14" :stroke-width="1.5" /></button>
          </Tooltip>
          <Tooltip label="替换">
            <button type="button" class="poi-action" aria-label="替换"><Replace :size="14" :stroke-width="1.5" /></button>
          </Tooltip>
          <Tooltip label="详情">
            <button type="button" class="poi-action" aria-label="详情"><Info :size="14" :stroke-width="1.5" /></button>
          </Tooltip>
        </div>
      </article>
    </div>
  </article>
</section>
```

- [ ] **Step 4: Append Day timeline + POI card styles**

```css
.plan-days { display: flex; flex-direction: column; gap: 18px; }

.plan-day { position: relative; }

.day-head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 4px 8px;
}
.day-num {
  width: 30px; height: 30px;
  border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  font-family: var(--font-mono);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.04em;
  box-shadow: var(--shadow-brand);
}
.day-title-row { display: flex; flex-direction: column; gap: 2px; }
.day-title {
  font-family: var(--font-display);
  font-size: var(--type-body-lg-size);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.day-items {
  display: flex; flex-direction: column; gap: 8px;
  position: relative;
  padding-left: 14px;
  margin-left: 14px;
  border-left: 1px solid var(--border);
}

.poi-card {
  position: relative;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.poi-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-card-hover);
  border-color: var(--border-strong);
}
.poi-card::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 50%;
  width: 14px; height: 1px;
  background: var(--border);
}

.poi-thumb {
  width: 56px; height: 56px;
  border-radius: var(--r-sm);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-inverse);
  position: relative;
  overflow: hidden;
}

.poi-body { min-width: 0; }
.poi-title {
  display: block;
  font-family: var(--font-display);
  font-size: var(--type-body-size);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: 4px;
  color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.poi-meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
}
.poi-desc {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.poi-right {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 3px;
}
.poi-time {
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  color: var(--text-subtle);
}
.poi-cost {
  font-family: var(--font-display);
  font-size: var(--type-body-size);
  font-weight: 600;
  color: var(--text);
}

.poi-actions {
  position: absolute;
  right: 10px; bottom: 10px;
  display: inline-flex; gap: 4px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  pointer-events: none;
}
.poi-card:hover .poi-actions {
  opacity: 1; transform: translateY(0);
  pointer-events: auto;
}
.poi-action {
  appearance: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.poi-action:hover { border-color: var(--brand-blue); color: var(--brand-blue); }

@media (max-width: 640px) {
  .poi-card { grid-template-columns: 44px 1fr; gap: 10px; }
  .poi-right {
    grid-column: 1 / -1;
    flex-direction: row;
    justify-content: space-between;
  }
  .poi-actions {
    position: static; opacity: 1; transform: none; pointer-events: auto;
    margin-top: 6px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .poi-card { transition: none; }
  .poi-actions { transition: none; }
}
```

- [ ] **Step 5: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: load a plan. Each day shows a "D1"/"D2" gradient badge + theme; POI cards have gradient thumbnail matching the type; hover reveals 3 ghost action buttons with tooltips.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/PlanningPreview.vue
git commit -m "feat(web/plan): Day timeline with gradient-badge POI cards + hover actions"
```

---

## Phase 7 · Integrate ReAct Cards + Motion + Polish (Tasks 26–28)

### Task 26: Replace inline ReAct markup in pages/index.vue

**Files:**
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Add imports**

```ts
import ReactProgressBar from '~/components/react/ReactProgressBar.vue'
import ClarifyCard from '~/components/react/ClarifyCard.vue'
import MaxIterCard from '~/components/react/MaxIterCard.vue'
```

- [ ] **Step 2: Replace `.react-progress` / `.clarify-card` / `.continue-card` blocks in the template**

Find the three existing `<div v-if="loopStatus" class="react-progress">...`, `<div v-if="awaitingClarify" class="clarify-card">...`, and `<div v-if="canContinue && maxIterReached" class="continue-card">...` blocks. Replace all three with:

```html
<!-- ReAct loop UI (mutually exclusive) -->
<ReactProgressBar
  v-if="loopStatus"
  :loop-status="loopStatus"
  :iteration="iteration"
  :max-iterations="maxIterations"
  :display-score="displayScore"
  :target-score="targetScore"
/>
<ClarifyCard
  v-else-if="awaitingClarify"
  :question="awaitingClarify.question"
  :reason="awaitingClarify.reason"
/>
<MaxIterCard
  v-else-if="canContinue && maxIterReached"
  :max-iterations="maxIterations"
  :current-score="maxIterReached.currentScore"
  :target-score="targetScore"
  @continue="onContinue"
/>
```

The three cards are now mutually exclusive via `v-else-if`.

- [ ] **Step 3: Remove the obsolete scoped styles**

From `pages/index.vue`'s scoped `<style>` block, delete the rules for:
- `.react-progress`, `.react-progress-head`, `.react-progress-label`, `.react-progress-score`, `.react-progress-bar`, and any pseudo-elements on them
- `.clarify-card`, `.clarify-kicker`, `.clarify-question`, `.clarify-hint`
- `.continue-card`, `.continue-card-text`, `.continue-card-title`, `.continue-card-meta`, `.continue-button`

The styles now live inside each component.

- [ ] **Step 4: Ensure `onContinue` still exists**

Verify there's an existing `function onContinue()` in `<script setup>`. If not, add:

```ts
function onContinue() {
  void stream.continueOptimization({
    onEvent: (event) => chatStore.handleStreamEvent(event),
    onError: (err) => chatStore.setRequestError(String(err)),
  })
}
```

- [ ] **Step 5: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: trigger a planning request. Confirm the ReactProgressBar appears during evaluation/refinement. For clarify testing, you may need a question-producing prompt; use manual console to set `chatStore.awaitingClarify = { question: 'test', reason: 'test' }` to visual-check the card.

- [ ] **Step 6: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "refactor(web/react): extract ReactProgressBar / ClarifyCard / MaxIterCard components"
```

---

### Task 27: Apply motion presets to lists

**Files:**
- Modify: `apps/web/components/ChatPanel.vue`
- Modify: `apps/web/components/TripHistoryGrid.vue`
- Modify: `apps/web/components/PlanningPreview.vue`

- [ ] **Step 1: ChatPanel — Motion slideUp**

In `ChatPanel.vue`'s script, add `import { Motion } from 'motion-v'`.

Replace the `<article v-for="(message, index) in messages" ...>` with:

```html
<Motion
  v-for="(message, index) in messages"
  :key="message.id"
  tag="article"
  v-show="message.content.trim()"
  :initial="{ y: 8, opacity: 0 }"
  :animate="{ y: 0, opacity: 1 }"
  :transition="{ duration: 0.32, ease: [0.2, 0.7, 0.25, 1], delay: Math.min(index * 0.04, 0.24) }"
  class="bubble"
  :class="`bubble-${message.role}`"
>
  <p class="bubble-content">{{ message.content }}</p>
</Motion>
```

Remove the old `animation-delay` style binding and any `animation: bubble-in` CSS rule.

- [ ] **Step 2: TripHistoryGrid — stagger cards**

Import Motion and wrap `<article class="history-card">` the same way with per-index delay. Remove the old CSS entrance animation if any.

- [ ] **Step 3: PlanningPreview — animate day + POI**

Import Motion. Wrap `<article class="plan-day">` in Motion (fadeIn, no delay). Wrap each `<article class="poi-card">` in Motion with slideUp + `delay: idx * 0.04`.

- [ ] **Step 4: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: refresh landing and workspace. Bubbles, history cards, and POI cards should fade-slide in with a staggered cascade.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ChatPanel.vue apps/web/components/TripHistoryGrid.vue apps/web/components/PlanningPreview.vue
git commit -m "feat(web): apply motion-v slideUp + stagger to chat/history/POI lists"
```

---

### Task 28: A11y + reduced-motion + responsive validation

**Files:**
- Possibly minor updates across any touched component

- [ ] **Step 1: Run existing Playwright smoke tests**

```bash
pnpm smoke:auth:ui
pnpm smoke:planner:ui
pnpm smoke:planner:states
pnpm smoke:restore:ui
```
Any failure due to changed text (e.g. the logout button moved into a menu) → update the test's selectors to use `getByRole('menuitem', { name: '退出登录' })` etc.

- [ ] **Step 2: A11y sweep via Playwright MCP**

Dev server + navigate `/` and `/login`. Use `browser_snapshot` to inspect:
- Every icon-only button has either `aria-label` or is wrapped in a `<Tooltip>`
- No duplicate `role="button"` nesting
- Focus-visible outlines appear correctly

Fix issues inline where found.

- [ ] **Step 3: Reduced-motion check**

```ts
browser_evaluate(() => {
  document.documentElement.style.cssText +=
    '; * { animation-duration: 0ms !important; transition-duration: 0ms !important; }'
})
```
Reload. Layout must remain correct with no jumps; all motion-v components degrade to static state.

- [ ] **Step 4: Responsive sweep**

```ts
browser_resize(980, 900); // tablet
browser_take_screenshot({ filename: 'bp-980-landing.png', type: 'png', fullPage: true });
browser_resize(640, 800); // mobile
browser_take_screenshot({ filename: 'bp-640-landing.png', type: 'png', fullPage: true });
```
Confirm:
- Workspace split panels collapse to single column at 980
- History grid single column at 640
- POI cards reflow (thumb + body stays; right row wraps underneath)
- Plan stats collapse to 2-column at 640
- MaxIterCard CTA moves to its own row at 640

Apply targeted `@media` tweaks to offending components if needed.

- [ ] **Step 5: Final build + smoke**

```bash
pnpm build:web
pnpm --filter @travel-agent/web test
pnpm smoke:planner:ui
```

All should pass.

- [ ] **Step 6: Commit (optional — only if fixes were applied)**

```bash
git add -u
git commit -m "chore(web): a11y + reduced-motion + responsive validation fixes"
```

---

## Self-Review (already done during plan writing)

**Spec coverage** — each section in the v2 spec maps to tasks:
- ✅ §1.1 type scale → Task 2 (tokens), used in Tasks 20-25
- ✅ §1.2 colors/gradients → Task 2
- ✅ §1.3 motion → Task 3, applied Task 27
- ✅ §1.4 icons → Task 1 (lucide install), used throughout
- ✅ §1.5 micro-details (focus-visible) → Task 2
- ✅ §2 Reka UI wrappers (4 total, no Tabs) → Tasks 8-11
- ✅ §2 Toast → Task 4, wired in Task 19
- ✅ §3 state components → Tasks 12-15
- ✅ §4.1 login → Task 20
- ✅ §4.2 Hero → Task 21
- ✅ §4.3 history → Task 22
- ✅ §4.4 topbar + ChatPanel → Tasks 19, 23
- ✅ §4.5 Plan Artifact + POI card → Tasks 24, 25
- ✅ §4.6 ReAct surfaces (3 cards) → Tasks 16-18, wired Task 26
- ✅ §5.3 POI visual → Task 5
- ✅ §6 phases → Phase structure here mirrors exactly

**Placeholder scan**: No TBD/TODO/"handle edge cases"/"similar to Task N" anywhere.

**Type consistency**:
- `motionPresets` (Task 3 defines) — Task 27 uses raw Motion props (fine — presets are reference only)
- `poiVisualForType` / `PoiVisual` (Task 5) → Task 25 uses
- `destinationColor` (Task 6) → Task 22 uses
- `relativeTime` (Task 7) → Task 22 uses
- `DropdownMenu` + `DropdownMenuItem` + `DropdownMenuSeparator` (Task 9) → Task 19 uses
- `ReactProgressBar` / `ClarifyCard` / `MaxIterCard` (Tasks 16-18) → Task 26 wires
- ReAct chat store fields (`loopStatus` / `iteration` / `maxIterations` / `awaitingClarify` / `maxIterReached` / `canContinue`) — verified against actual `stores/chat.ts`

**Obsolete from v1 removed**:
- Chat dedupe task (no longer needed — no repeated messages in ReAct)
- Tabs wrapper (no version switching)
- `@travel-agent/domain` imports (package removed)
- `usePlannerApi` references (removed)
- "style chip" / "version chips" (no version concept)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-frontend-polish-v2.md`. Dispatching via `superpowers:subagent-driven-development`: implementer → spec reviewer → code quality reviewer per task, fresh subagent each time.
