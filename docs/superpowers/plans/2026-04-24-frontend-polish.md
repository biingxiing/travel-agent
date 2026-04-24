# Frontend Polish (Linear/Vercel-grade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the existing Nuxt 3 travel-planning frontend and polish it to a Linear/Vercel-grade product bar — refined typography, Lucide icons, motion system, Reka UI primitives, consistent state components, redesigned Hero / workspace / Plan artifact / POI cards.

**Architecture:** Three-layer build-up. Layer 1 = foundations (deps, CSS tokens, motion, Toast). Layer 2 = horizontal infrastructure (pure utilities, Reka UI wrappers, state components) — nothing touches business UI yet. Layer 3 = surface-by-surface redesign (login → topbar → landing → history → chat → plan), each surface committed independently. Final phase = motion/a11y/responsive polish.

**Tech Stack:** Nuxt 3 · Vue 3 · Pinia · Reka UI · Lucide icons · motion-v · vue-sonner · dayjs · Vitest (utilities/store) · Playwright (e2e).

**Spec reference:** `docs/superpowers/specs/2026-04-24-frontend-polish-design.md`

---

## Conventions

- **Package manager**: pnpm workspace, commands always target `@travel-agent/web`
- **Build verification**: `pnpm build:web` after major component changes
- **Type check**: `pnpm --filter @travel-agent/web exec nuxt typecheck` (or rely on build)
- **Unit tests**: Vitest (to be configured for `apps/web` in Task 1)
- **Visual verification for Vue components**: start `pnpm dev:web` and use Playwright MCP (`mcp__plugin_playwright_playwright__*`) to open `http://localhost:3000` — do NOT claim a UI task is done without visual verification
- **Commit style**: Follow existing Chinese prefix style (`优化…` / `提交部分功能`) or standard English (`feat:` / `fix:` / `refactor:`). Plan uses English `feat:`/`refactor:`/`chore:` for clarity — either is acceptable.
- **Never skip hooks**, never force-push, one commit per task

---

## File Structure Overview

```
apps/web/
├── package.json                         ← Task 1 (deps)
├── vitest.config.ts                     ← Task 1 (new)
├── nuxt.config.ts                       ← Task 1 (transpile + motion)
├── assets/css/main.css                  ← Task 2 (tokens)
├── plugins/
│   └── toast.client.ts                  ← Task 4 (new)
├── composables/
│   ├── useMotion.ts                     ← Task 3 (new)
│   └── useTripHistory.ts                ← Task 6 (modify; replace coverForDestination)
├── utils/
│   ├── poi-visual.ts                    ← Task 5 (new)
│   ├── poi-visual.test.ts               ← Task 5 (new)
│   ├── destination-color.ts             ← Task 6 (new)
│   ├── destination-color.test.ts        ← Task 6 (new)
│   ├── relative-time.ts                 ← Task 7 (new)
│   └── relative-time.test.ts            ← Task 7 (new)
├── components/
│   ├── ui/
│   │   ├── Tooltip.vue                  ← Task 8
│   │   ├── DropdownMenu.vue             ← Task 9
│   │   ├── Dialog.vue                   ← Task 10
│   │   ├── ScrollArea.vue               ← Task 11
│   │   └── Tabs.vue                     ← Task 12
│   ├── states/
│   │   ├── EmptyState.vue               ← Task 13
│   │   ├── LoadingSkeleton.vue          ← Task 14
│   │   ├── ErrorState.vue               ← Task 15
│   │   └── StreamingBubble.vue          ← Task 16
│   ├── AuthLoginCard.vue                ← Task 20
│   ├── ChatPanel.vue                    ← Task 23
│   ├── HeroPlannerCard.vue              ← Task 21
│   ├── PlanningPreview.vue              ← Tasks 24, 25
│   └── TripHistoryGrid.vue              ← Task 22
├── pages/index.vue                      ← Tasks 18, 19
├── stores/chat.ts                       ← Task 17 (dedupe)
└── stores/chat.test.ts                  ← Task 17 (new)
```

---

## Phase 1 · Foundation (Tasks 1–4)

### Task 1: Install dependencies & configure Vitest

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/nuxt.config.ts`
- Create: `apps/web/vitest.config.ts`
- Modify: `package.json` (repo root — add test script)

- [ ] **Step 1: Install runtime dependencies**

Run from repo root:
```bash
pnpm --filter @travel-agent/web add reka-ui lucide-vue-next motion-v vue-sonner dayjs
```
Expected: dependencies added to `apps/web/package.json`, lockfile updated, no errors.

- [ ] **Step 2: Install dev dependencies for Vitest**

Run:
```bash
pnpm --filter @travel-agent/web add -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['utils/**/*.test.ts', 'stores/**/*.test.ts', 'composables/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '~': new URL('.', import.meta.url).pathname,
    },
  },
})
```

- [ ] **Step 4: Add a `test` script to `apps/web/package.json`**

Under `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Add a root-level test script for convenience**

In repo-root `package.json`'s `"scripts"`, add a line:
```json
"test:web": "pnpm --filter @travel-agent/web test"
```

- [ ] **Step 6: Update `nuxt.config.ts` to transpile motion-v**

Replace the entire config with:
```ts
export default defineNuxtConfig({
  compatibilityDate: "2025-04-21",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  modules: ["@pinia/nuxt"],
  build: {
    transpile: ["motion-v"]
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || ""
    }
  },
  app: {
    head: {
      title: "旅行规划助手",
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1"
        },
        {
          name: "description",
          content: "Conversational travel planning MVP built with Nuxt 3."
        }
      ],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "preload",
          as: "style",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        }
      ]
    }
  }
})
```

- [ ] **Step 7: Verify vitest runs (passWithNoTests)**

```bash
pnpm --filter @travel-agent/web test
```
Expected: `Test Files: 0, Tests: 0 (all passed because passWithNoTests)`. Exit code 0.

- [ ] **Step 8: Verify build still passes**

```bash
pnpm build:web
```
Expected: Nuxt build completes without errors. Warnings acceptable.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/nuxt.config.ts package.json pnpm-lock.yaml
git commit -m "feat(web): install reka-ui, lucide, motion-v, vue-sonner, dayjs and configure vitest"
```

---

### Task 2: Extend design tokens in main.css

**Files:**
- Modify: `apps/web/assets/css/main.css:6-114` (the `:root` block)

- [ ] **Step 1: Add new type-scale tokens to `:root`**

Inside the existing `:root` block, **after** the `/* Type */` section and **before** `/* Radii */`, insert:

```css
  /* Type scale (display + body hierarchy) */
  --type-display-xl-size:    clamp(44px, 5.5vw, 64px);
  --type-display-xl-tracking: -0.03em;
  --type-display-lg-size:    clamp(32px, 3.8vw, 44px);
  --type-display-lg-tracking: -0.025em;
  --type-display-md-size:    30px;
  --type-display-md-tracking: -0.02em;
  --type-heading-size:       20px;
  --type-heading-tracking:   -0.01em;
  --type-subhead-size:       16px;
  --type-body-lg-size:       15px;
  --type-body-size:          14px;
  --type-body-sm-size:       13px;
  --type-caption-size:       12px;
  --type-mono-xs-size:       11px;
  --type-mono-xs-tracking:   0.08em;
```

- [ ] **Step 2: Add new surface / shadow / border tokens**

In the same `:root`, **after** the existing `--shadow-brand` line, add:

```css
  /* New surfaces */
  --border-subtle-2:   #F8F9FB;
  --bg-glass:          rgba(255, 255, 255, 0.92);
  --shadow-artifact:   0 20px 60px rgba(17, 24, 39, 0.10);
  --shadow-card-hover: 0 8px 24px rgba(17, 24, 39, 0.08);
```

- [ ] **Step 3: Add named gradients (replacing ad-hoc writes)**

In the same `:root`, **after** the shadow lines added in Step 2, add:

```css
  /* Named gradients */
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

Note: the existing `--brand-gradient` token stays (legacy consumers); the new `--gradient-brand` has the same value. Do NOT remove `--brand-gradient`.

- [ ] **Step 4: Add a `.currency-unit` utility class and update focus-visible**

At the end of the file (after the last `@media` block), append:

```css
/* ───────────────────────────────────────────────────────────────────────────
   Utility primitives added during frontend-polish pass
   ─────────────────────────────────────────────────────────────────────────── */

.currency-unit {
  font-size: 0.72em;
  color: var(--text-muted);
  font-weight: 500;
  margin-right: 2px;
}

.tabular { font-variant-numeric: tabular-nums; }
```

Then find the existing `:focus-visible` rule (currently at lines 153-157) and change `outline-offset: 2px;` to `outline-offset: -1px;`. The rule becomes:

```css
:focus-visible {
  outline: 2px solid var(--brand-blue);
  outline-offset: -1px;
  border-radius: 4px;
}
```

- [ ] **Step 5: Verify build succeeds**

```bash
pnpm build:web
```
Expected: no errors. CSS is bundled without warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/assets/css/main.css
git commit -m "feat(web): extend CSS tokens with display scale, named gradients, and utility classes"
```

---

### Task 3: Motion primitives composable

**Files:**
- Create: `apps/web/composables/useMotion.ts`
- Create: `apps/web/composables/useMotion.test.ts`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run the test — should FAIL**

```bash
pnpm --filter @travel-agent/web test composables/useMotion.test.ts
```
Expected: FAIL with "Cannot find module './useMotion'".

- [ ] **Step 3: Implement `useMotion.ts`**

Create `apps/web/composables/useMotion.ts`:

```ts
// Named motion presets used across the app. Values are expressed in the
// format expected by motion-v (`initial` / `animate` / `transition`).
// Import whichever preset you need; or import `motionPresets` and bind dynamically.

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

- [ ] **Step 4: Run the test — should PASS**

```bash
pnpm --filter @travel-agent/web test composables/useMotion.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/composables/useMotion.ts apps/web/composables/useMotion.test.ts
git commit -m "feat(web): add motion presets (fadeIn, slideUp, pop, listStagger, ghostPulse)"
```

---

### Task 4: Toast plugin (vue-sonner)

**Files:**
- Create: `apps/web/plugins/toast.client.ts`
- Create: `apps/web/components/ui/Toaster.vue`
- Modify: `apps/web/app.vue` (mount Toaster)

- [ ] **Step 1: Create the Toaster wrapper component**

Create `apps/web/components/ui/Toaster.vue`:

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

- [ ] **Step 2: Create a tiny wrapper to standardize toast usage**

Create `apps/web/plugins/toast.client.ts`:

```ts
import { toast } from 'vue-sonner'

// Re-export a narrowed API — keeps every call site consistent and makes
// future provider swaps trivial.
export default defineNuxtPlugin(() => {
  return {
    provide: {
      toast: {
        success: (message: string) => toast.success(message),
        error:   (message: string) => toast.error(message),
        info:    (message: string) => toast(message),
      },
    },
  }
})
```

- [ ] **Step 3: Mount the Toaster in `app.vue`**

Read current `apps/web/app.vue`:
```bash
cat apps/web/app.vue
```

If it currently contains only `<NuxtPage />` or similar, replace it with:

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

If it already contains more (e.g. a layout wrapper), add the `<Toaster />` line just before the closing `</template>`.

- [ ] **Step 4: Verify build**

```bash
pnpm build:web
```
Expected: no errors. `vue-sonner` is bundled.

- [ ] **Step 5: Smoke-verify Toast works via dev server + Playwright MCP**

In one terminal: `pnpm dev:web` (wait for "ready" line). Then from another session use Playwright MCP:
1. `browser_navigate` to `http://localhost:3000` (or `/login`)
2. `browser_evaluate` with `() => { const { $toast } = useNuxtApp(); $toast.success('hello'); return 'ok' }` — **this may fail** because `useNuxtApp` isn't available in evaluated browser scripts without the composition API context. As a workaround, just verify the `<Toaster />` element exists with `browser_snapshot`.

If `Toaster` root is in the DOM, plugin works. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/web/plugins/toast.client.ts apps/web/components/ui/Toaster.vue apps/web/app.vue
git commit -m "feat(web): wire vue-sonner Toaster with $toast plugin"
```

---

## Phase 2 · Utilities (Tasks 5–7)

### Task 5: POI visual utility

**Files:**
- Create: `apps/web/utils/poi-visual.ts`
- Create: `apps/web/utils/poi-visual.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/utils/poi-visual.test.ts`:

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

  it('returns the transit gradient for transit', () => {
    expect(poiVisualForType('transit')).toEqual({
      gradient: 'var(--gradient-poi-transit)',
      icon: 'tram-front',
    })
  })

  it('maps domain aliases (hotel→lodging, food→meal, poi→attraction)', () => {
    expect(poiVisualForType('hotel').icon).toBe('bed')
    expect(poiVisualForType('food').icon).toBe('utensils-crossed')
    expect(poiVisualForType('poi').icon).toBe('mountain')
  })

  it('falls back to POI for unknown types', () => {
    expect(poiVisualForType('unknown-xyz').gradient).toBe('var(--gradient-poi-poi)')
  })

  it('accepts undefined and returns fallback', () => {
    expect(poiVisualForType(undefined).gradient).toBe('var(--gradient-poi-poi)')
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @travel-agent/web test utils/poi-visual.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `poi-visual.ts`**

Create `apps/web/utils/poi-visual.ts`:

```ts
export interface PoiVisual {
  gradient: string
  icon: string
}

const CANONICAL: Record<string, PoiVisual> = {
  lodging:    { gradient: 'var(--gradient-poi-hotel)',   icon: 'bed' },
  meal:       { gradient: 'var(--gradient-poi-food)',    icon: 'utensils-crossed' },
  attraction: { gradient: 'var(--gradient-poi-poi)',     icon: 'mountain' },
  transit:    { gradient: 'var(--gradient-poi-transit)', icon: 'tram-front' },
}

const ALIASES: Record<string, keyof typeof CANONICAL> = {
  hotel:      'lodging',
  food:       'meal',
  poi:        'attraction',
  flight:     'transit',
  train:      'transit',
}

export function poiVisualForType(type: string | undefined | null): PoiVisual {
  if (!type) return CANONICAL.attraction
  const canonical = ALIASES[type] ?? type
  return CANONICAL[canonical] ?? CANONICAL.attraction
}
```

- [ ] **Step 4: Run test — PASS**

```bash
pnpm --filter @travel-agent/web test utils/poi-visual.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/utils/poi-visual.ts apps/web/utils/poi-visual.test.ts
git commit -m "feat(web): add poi-visual utility mapping POI types to gradient + icon"
```

---

### Task 6: Destination color utility (replaces existing `coverForDestination`)

**Files:**
- Create: `apps/web/utils/destination-color.ts`
- Create: `apps/web/utils/destination-color.test.ts`
- Modify: `apps/web/composables/useTripHistory.ts` (remove `coverForDestination`, re-export from utils for back-compat)

- [ ] **Step 1: Write the failing test**

Create `apps/web/utils/destination-color.test.ts`:

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

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @travel-agent/web test utils/destination-color.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `destination-color.ts`**

Create `apps/web/utils/destination-color.ts`:

```ts
interface DestinationBand {
  match: RegExp
  gradient: string
}

const BANDS: DestinationBand[] = [
  // Japan · 樱粉
  { match: /京都|奈良|东京|大阪|冲绳|横滨/, gradient: 'linear-gradient(135deg, #F9A8D4 0%, #EC4899 60%, #BE185D 100%)' },
  // Hokkaido · 青绿
  { match: /北海道|札幌|函馆|小樽/, gradient: 'linear-gradient(135deg, #86EFAC 0%, #10B981 60%, #047857 100%)' },
  // 华北 · 金黄
  { match: /北京|西安|敦煌|大同|太原/, gradient: 'linear-gradient(135deg, #FCD34D 0%, #F59E0B 60%, #B45309 100%)' },
  // 江南 · 靛蓝
  { match: /杭州|苏州|上海|南京|乌镇/, gradient: 'linear-gradient(135deg, #C7D2FE 0%, #818CF8 60%, #6366F1 100%)' },
  // 欧洲 · 薰衣草
  { match: /巴黎|伦敦|阿姆斯特丹|罗马|巴塞罗那|马德里|柏林|维也纳|布拉格|冰岛/, gradient: 'linear-gradient(135deg, #DDD6FE 0%, #A78BFA 60%, #7C3AED 100%)' },
  // 东南亚 · 珊瑚
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

- [ ] **Step 4: Run test — PASS**

```bash
pnpm --filter @travel-agent/web test utils/destination-color.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Refactor `useTripHistory.ts` to delegate to the new util**

Open `apps/web/composables/useTripHistory.ts`. Find the section starting at line 16 (`const COVER_PALETTES`) through the `coverForDestination` function (around line 70+), and the `hashString` helper if present.

Replace the `coverForDestination` implementation with a delegating stub. Specifically:
1. Delete the `COVER_PALETTES` array and any related helper (e.g. `hashString`).
2. Replace the `coverForDestination` function body with:

```ts
export { destinationColor as coverForDestination } from '~/utils/destination-color'
```

If the existing `coverForDestination` is exported at the bottom in a composable return, also update that spot to import from the util:

```ts
import { destinationColor } from '~/utils/destination-color'
// ... inside the composable return:
coverForDestination: destinationColor,
```

Pick whichever pattern matches the existing structure — the key is that **all callers continue to work** and the behaviour comes from `destination-color.ts`.

- [ ] **Step 6: Verify build still passes**

```bash
pnpm build:web
```
Expected: no errors. Components that previously called `coverForDestination` still work (they just use the new mapping).

- [ ] **Step 7: Commit**

```bash
git add apps/web/utils/destination-color.ts apps/web/utils/destination-color.test.ts apps/web/composables/useTripHistory.ts
git commit -m "feat(web): add destination-color util (semantic mapping) and replace coverForDestination"
```

---

### Task 7: Relative time utility

**Files:**
- Create: `apps/web/utils/relative-time.ts`
- Create: `apps/web/utils/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/utils/relative-time.test.ts`:

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
  it('returns absolute date for anything older than 7 days', () => {
    const older = new Date('2026-04-01T12:00:00Z')
    expect(relativeTime(older, now)).toMatch(/^04\/01$|^04-01$|^4\/1$|2026/)
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

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @travel-agent/web test utils/relative-time.test.ts
```

- [ ] **Step 3: Implement `relative-time.ts`**

Create `apps/web/utils/relative-time.ts`:

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

  // Older than a week — show mm-dd (compact)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}
```

- [ ] **Step 4: Run test — PASS**

```bash
pnpm --filter @travel-agent/web test utils/relative-time.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/utils/relative-time.ts apps/web/utils/relative-time.test.ts
git commit -m "feat(web): add relative-time util (刚刚 / N 分钟前 / N 小时前 / N 天前 / mm-dd)"
```

---

## Phase 3 · UI Primitives (Reka UI wrappers) (Tasks 8–12)

### Task 8: Tooltip wrapper

**Files:**
- Create: `apps/web/components/ui/Tooltip.vue`

- [ ] **Step 1: Implement `Tooltip.vue`**

```vue
<script setup lang="ts">
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
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
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .tooltip-content { animation: none; }
}
</style>
```

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/Tooltip.vue
git commit -m "feat(web/ui): Tooltip wrapper (Reka UI)"
```

---

### Task 9: DropdownMenu wrapper

**Files:**
- Create: `apps/web/components/ui/DropdownMenu.vue`

- [ ] **Step 1: Implement `DropdownMenu.vue`**

```vue
<script setup lang="ts">
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from 'reka-ui'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side-offset="6"
        align="end"
        class="dm-content"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<script lang="ts">
// Re-export item primitives so callers can use <DropdownMenu> and its children
// without importing Reka directly.
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

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/DropdownMenu.vue
git commit -m "feat(web/ui): DropdownMenu wrapper (Reka UI)"
```

---

### Task 10: Dialog wrapper

**Files:**
- Create: `apps/web/components/ui/Dialog.vue`

- [ ] **Step 1: Implement `Dialog.vue`**

```vue
<script setup lang="ts">
import {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'

defineProps<{
  open?: boolean
  title?: string
  description?: string
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()
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
        <DialogDescription v-if="description" class="dg-desc">
          {{ description }}
        </DialogDescription>
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
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.36);
  backdrop-filter: blur(4px);
  z-index: 50;
  animation: dg-fade 180ms var(--ease-out);
}

.dg-content {
  position: fixed;
  left: 50%;
  top: 50%;
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
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

@keyframes dg-fade {
  from { opacity: 0; } to { opacity: 1; }
}
@keyframes dg-in {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dg-overlay, .dg-content { animation: none; }
}
</style>
```

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/Dialog.vue
git commit -m "feat(web/ui): Dialog wrapper (Reka UI) with title/description/actions slots"
```

---

### Task 11: ScrollArea wrapper

**Files:**
- Create: `apps/web/components/ui/ScrollArea.vue`

- [ ] **Step 1: Implement `ScrollArea.vue`**

```vue
<script setup lang="ts">
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
} from 'reka-ui'

defineProps<{
  maxHeight?: string
}>()
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
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.sa-viewport {
  width: 100%;
  height: 100%;
}
.sa-scrollbar {
  display: flex;
  user-select: none;
  touch-action: none;
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
  position: relative;
  transition: background-color 160ms var(--ease-out);
}
.sa-thumb:hover { background: var(--text-subtle); }
</style>
```

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/ScrollArea.vue
git commit -m "feat(web/ui): ScrollArea wrapper (Reka UI) with styled scrollbar"
```

---

### Task 12: Tabs wrapper

**Files:**
- Create: `apps/web/components/ui/Tabs.vue`

- [ ] **Step 1: Implement `Tabs.vue`**

```vue
<script setup lang="ts">
import {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
} from 'reka-ui'

defineProps<{
  value: string
  tabs: Array<{ value: string; label: string; variant?: 'default' | 'active' }>
}>()

defineEmits<{
  'update:value': [value: string]
}>()
</script>

<template>
  <TabsRoot
    :model-value="value"
    @update:model-value="(v) => $emit('update:value', String(v))"
    class="tabs-root"
  >
    <TabsList class="tabs-list">
      <TabsTrigger
        v-for="tab in tabs"
        :key="tab.value"
        :value="tab.value"
        class="tabs-trigger"
      >
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent
      v-for="tab in tabs"
      :key="tab.value"
      :value="tab.value"
      class="tabs-content"
    >
      <slot :name="tab.value" />
    </TabsContent>
  </TabsRoot>
</template>

<style scoped>
.tabs-root { width: 100%; }
.tabs-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tabs-trigger {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 12px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--type-caption-size);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.tabs-trigger:hover { border-color: var(--brand-blue); color: var(--brand-blue); }
.tabs-trigger[data-state="active"] {
  border-color: var(--brand-blue);
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
}
.tabs-content { margin-top: 12px; }
</style>
```

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/Tabs.vue
git commit -m "feat(web/ui): Tabs wrapper (Reka UI) for plan-version switching"
```

---

## Phase 4 · State Components (Tasks 13–16)

### Task 13: EmptyState component

**Files:**
- Create: `apps/web/components/states/EmptyState.vue`

- [ ] **Step 1: Implement `EmptyState.vue`**

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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 40px 24px;
  text-align: center;
  color: var(--text-muted);
}
.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--bg-subtle);
  color: var(--text-subtle);
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

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/states/EmptyState.vue
git commit -m "feat(web/states): EmptyState component with Lucide icon + title + hint + action slot"
```

---

### Task 14: LoadingSkeleton component

**Files:**
- Create: `apps/web/components/states/LoadingSkeleton.vue`

- [ ] **Step 1: Implement `LoadingSkeleton.vue`**

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

.skel-bubble {
  height: 44px;
  width: 70%;
  border-radius: 12px;
}
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
    animation: none;
    opacity: 0.8;
  }
}
</style>
```

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/states/LoadingSkeleton.vue
git commit -m "feat(web/states): LoadingSkeleton with plan/chat/history/generic variants"
```

---

### Task 15: ErrorState component

**Files:**
- Create: `apps/web/components/states/ErrorState.vue`

- [ ] **Step 1: Implement `ErrorState.vue`**

```vue
<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

defineProps<{
  title: string
  detail?: string
  retryLabel?: string
}>()

defineEmits<{
  retry: []
}>()
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 36px 22px;
  text-align: center;
  background: var(--accent-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: var(--r-md);
  color: #991B1B;
}
.error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
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

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/states/ErrorState.vue
git commit -m "feat(web/states): ErrorState component with AlertCircle + retry"
```

---

### Task 16: StreamingBubble component

**Files:**
- Create: `apps/web/components/states/StreamingBubble.vue`

- [ ] **Step 1: Implement `StreamingBubble.vue`**

```vue
<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

defineProps<{
  status: string
  steps?: string[]
}>()
</script>

<template>
  <article class="streaming-bubble">
    <div class="streaming-row">
      <Sparkles :size="16" :stroke-width="1.75" class="streaming-icon" />
      <span class="streaming-status">{{ status }}</span>
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--type-body-sm-size);
}
.streaming-icon { animation: sparkle-spin 3.2s linear infinite; color: var(--brand-blue); }
.streaming-status { color: var(--brand-blue-deep); font-weight: 500; }
.streaming-steps {
  margin: 10px 0 0;
  padding-left: 18px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
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

- [ ] **Step 2: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/states/StreamingBubble.vue
git commit -m "feat(web/states): StreamingBubble with Sparkles icon + ghostPulse background"
```

---

## Phase 5 · Chat Store Dedupe (Task 17)

### Task 17: Deduplicate consecutive identical assistant messages

**Files:**
- Modify: `apps/web/stores/chat.ts` (add dedupe logic, new fields for occurrence count)
- Create: `apps/web/stores/chat.test.ts`
- Modify: `apps/web/types/itinerary.ts` (add optional `occurrences?: number` to `ChatMessage`)

- [ ] **Step 1: Extend `ChatMessage` type**

Open `apps/web/types/itinerary.ts` and locate the `ChatMessage` interface. Add a new optional field:

```ts
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  occurrences?: number
}
```

(Keep all other fields exactly as-is.)

- [ ] **Step 2: Write the failing test**

Create `apps/web/stores/chat.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from './chat'
import type { ChatMessage } from '~/types/itinerary'

function assistantBubble(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content }
}

describe('chat store · dedupe consecutive identical assistant messages', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('collapses two consecutive identical assistant bubbles into one with occurrences=2', () => {
    const store = useChatStore()
    store.messages = [
      assistantBubble('a1', '已基于你的修改生成新版方案，右侧可以切换版本和方案。'),
      assistantBubble('a2', '已基于你的修改生成新版方案，右侧可以切换版本和方案。'),
    ]
    store.dedupeAssistantRun()
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].occurrences).toBe(2)
    expect(store.messages[0].id).toBe('a1')
  })

  it('collapses three consecutive identical bubbles to occurrences=3', () => {
    const store = useChatStore()
    const msg = '已基于你的修改生成新版方案，右侧可以切换版本和方案。'
    store.messages = [
      assistantBubble('a1', msg),
      assistantBubble('a2', msg),
      assistantBubble('a3', msg),
    ]
    store.dedupeAssistantRun()
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].occurrences).toBe(3)
  })

  it('does not collapse when a user message separates the assistant messages', () => {
    const store = useChatStore()
    const msg = 'already generated a new version'
    store.messages = [
      assistantBubble('a1', msg),
      { id: 'u1', role: 'user', content: '继续' },
      assistantBubble('a2', msg),
    ]
    store.dedupeAssistantRun()
    expect(store.messages).toHaveLength(3)
    expect(store.messages[0].occurrences).toBeUndefined()
    expect(store.messages[2].occurrences).toBeUndefined()
  })

  it('does not collapse different assistant messages', () => {
    const store = useChatStore()
    store.messages = [
      assistantBubble('a1', 'msg A'),
      assistantBubble('a2', 'msg B'),
    ]
    store.dedupeAssistantRun()
    expect(store.messages).toHaveLength(2)
  })

  it('ignores whitespace differences', () => {
    const store = useChatStore()
    store.messages = [
      assistantBubble('a1', '  已生成新版方案  '),
      assistantBubble('a2', '已生成新版方案'),
    ]
    store.dedupeAssistantRun()
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].occurrences).toBe(2)
  })
})
```

- [ ] **Step 3: Run the test — FAIL**

```bash
pnpm --filter @travel-agent/web test stores/chat.test.ts
```
Expected: FAIL with "dedupeAssistantRun is not a function" (or similar).

- [ ] **Step 4: Add `dedupeAssistantRun` action to `chat.ts`**

Open `apps/web/stores/chat.ts`. In the `actions: { ... }` block (starts around line 141), add a new method **before** `resetConversation`:

```ts
    dedupeAssistantRun() {
      const next: ChatMessage[] = []
      let lastAsst: ChatMessage | null = null
      for (const m of this.messages) {
        if (m.role === 'assistant' && lastAsst && lastAsst.content.trim() === m.content.trim()) {
          lastAsst.occurrences = (lastAsst.occurrences ?? 1) + 1
          continue
        }
        next.push(m)
        lastAsst = m.role === 'assistant' ? m : null
      }
      this.messages = next
      this.persistState()
    },
```

- [ ] **Step 5: Run the test — PASS**

```bash
pnpm --filter @travel-agent/web test stores/chat.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 6: Call dedupe after `completePlannerResponse` so it runs automatically on every new planner response**

In `chat.ts`, locate the `completePlannerResponse` method (around line 317). At the end of its body, **before** `this.persistState()`, add a call:

```ts
      this.setAssistantContent(message)
      this.dedupeAssistantRun()
      this.persistState()
```

Re-run the test to confirm nothing regressed:
```bash
pnpm --filter @travel-agent/web test stores/chat.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/stores/chat.ts apps/web/stores/chat.test.ts apps/web/types/itinerary.ts
git commit -m "feat(web/chat): dedupe consecutive identical assistant messages (track occurrences)"
```

---

## Phase 6 · Surface Redesigns (Tasks 18–25)

### Task 18: Topbar — breadcrumb + user DropdownMenu

**Files:**
- Modify: `apps/web/pages/index.vue` (topbar section, ~lines 611-638 and scoped style)

- [ ] **Step 1: Add imports at top of `<script setup>`**

Find the existing `<script setup lang="ts">` block (line 1 of `pages/index.vue`). Immediately after the existing `import { storeToRefs } from "pinia"` line, add:

```ts
import DropdownMenu, { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenu.vue"
import { ChevronDown, User, History, Settings, LogOut } from "lucide-vue-next"
```

- [ ] **Step 2: Compute the breadcrumb**

Inside the same `<script setup>` block, near other computeds (after `isLanding`), add:

```ts
const breadcrumbParts = computed(() => {
  if (isLanding.value) return null
  const destination = workspaceStore.brief?.destination || "新方案"
  const version = workspaceStore.activeVersionNo ? `v${workspaceStore.activeVersionNo}` : ""
  const style = workspaceStore.activePlanOption?.type || ""
  return { destination, version, style }
})
```

- [ ] **Step 3: Replace the topbar markup**

Find the existing `<header class="page-topbar">...</header>` block in the `<template>`. Replace it entirely with:

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
        <div v-if="breadcrumbParts" class="page-breadcrumb">
          <span>规划</span>
          <span class="page-breadcrumb-sep">/</span>
          <span class="page-breadcrumb-current">{{ breadcrumbParts.destination }}</span>
          <template v-if="breadcrumbParts.version">
            <span class="page-breadcrumb-sep">/</span>
            <span class="page-breadcrumb-current">
              {{ breadcrumbParts.version }}
              <span v-if="breadcrumbParts.style" class="page-breadcrumb-style">
                · {{ breadcrumbParts.style }}
              </span>
            </span>
          </template>
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
            {{ logoutPending ? "退出中…" : "退出登录" }}
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
```

- [ ] **Step 4: Add breadcrumb styles to the scoped `<style>` block**

At the end of the existing scoped `<style>` block in `pages/index.vue`, add:

```css
.page-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: var(--type-caption-size);
  color: var(--text-subtle);
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.page-breadcrumb-sep { color: var(--text-subtle); opacity: 0.6; }
.page-breadcrumb-current { color: var(--text); font-weight: 600; }
.page-breadcrumb-style { color: var(--brand-blue-deep); font-weight: 500; }

.page-user-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--gradient-brand);
}
```

Also remove or update the existing `.page-user-chip` rule in `main.css` if it conflicts; if unclear, just keep the scoped override here — scoped wins.

- [ ] **Step 5: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 6: Visual verify via Playwright MCP**

Start dev server: `pnpm dev:web` (background). Then:
1. `browser_navigate` to `http://localhost:3000/login`, log in with admin credentials (check existing e2e tests for credentials)
2. `browser_navigate` to `http://localhost:3000`
3. `browser_take_screenshot` — confirm topbar shows brand + "admin" user chip with ChevronDown
4. `browser_click` the user chip — menu should appear with 4 items + separator before logout
5. Stop dev server

- [ ] **Step 7: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web/topbar): breadcrumb + Reka DropdownMenu user menu (replaces logout button)"
```

---

### Task 19: Replace page-level banners with Toast

**Files:**
- Modify: `apps/web/pages/index.vue` (remove `.page-auth-notice` / `.page-auth-error`, watch + toast)
- Modify: `apps/web/stores/auth.ts` (no change needed; existing errorMessage/status still used)

- [ ] **Step 1: Import `$toast` in `pages/index.vue`**

At the top of `<script setup>` add:
```ts
const { $toast } = useNuxtApp()
```

- [ ] **Step 2: Replace the page notice/error with watchers**

In `pages/index.vue`, find the current `<p v-if="pageNotice" class="page-auth-notice">` and `<p v-else-if="authErrorMessage" class="page-auth-error">` lines in the template. **Delete both entirely**.

Then in `<script setup>`, find the `pageNotice` computed. Keep it, but add a watcher just below the computed:

```ts
watch(pageNotice, (msg) => {
  if (msg) $toast.info(msg)
})

watch(authErrorMessage, (msg) => {
  if (msg) $toast.error(msg)
})
```

Note: add these watchers once (not inside `onMounted`) so they respond to every change.

- [ ] **Step 3: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 4: Visual verify**

Dev server + Playwright MCP:
1. Navigate to `/?login=1` — should see a success toast top-right (not a page banner)
2. `browser_take_screenshot`
3. Stop dev server

- [ ] **Step 5: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "refactor(web/topbar): replace page-level auth banners with Toast notifications"
```

---

### Task 20: AuthLoginCard — value props + password Eye/EyeOff

**Files:**
- Modify: `apps/web/components/AuthLoginCard.vue`

- [ ] **Step 1: Read the current file**

```bash
cat apps/web/components/AuthLoginCard.vue
```
Note the structure (hero pane + form pane). You will only modify the hero-pane bullet list and the password input's inline button.

- [ ] **Step 2: Add Lucide imports + Tooltip**

At the top of `<script setup>`, add:
```ts
import { Sparkles, GitBranch, Download, Eye, EyeOff } from 'lucide-vue-next'
import Tooltip from '~/components/ui/Tooltip.vue'
```

- [ ] **Step 3: Replace the auth-helper-list with value props**

Find the existing `<ul class="auth-helper-list">...</ul>` (or similar) in the template. Replace the entire list with:

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

- [ ] **Step 4: Replace the inline password button**

Find the existing `<button class="auth-inline-button">...</button>` inside the `.auth-password-wrap`. Replace with:

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

(Assumes `showPassword` ref already exists. If not, add `const showPassword = ref(false)` in `<script setup>` and bind the input's `:type` to `showPassword ? 'text' : 'password'`.)

- [ ] **Step 5: Add new styles at the end of the scoped `<style>`**

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
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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

- [ ] **Step 6: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 7: Visual verify via Playwright MCP at `/login`**

Start dev, navigate to `/login`, take screenshot. Verify: 3 value props on the left with purple icon tiles; password input has an Eye icon button on the right with tooltip "显示密码"/"隐藏密码". Stop dev.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/AuthLoginCard.vue
git commit -m "feat(web/auth): value props with Lucide icons + Eye/EyeOff password toggle"
```

---

### Task 21: HeroPlannerCard — complete redesign

**Files:**
- Modify: `apps/web/components/HeroPlannerCard.vue` (replace template + styles; keep existing script logic for origin/destination/preferences)

**Note:** This is the largest single-component change in the plan. Keep existing script state (origin, destination, dates, preferences, emitters) exactly as-is. Replace only the template and styles.

- [ ] **Step 1: Read the current file**

```bash
cat apps/web/components/HeroPlannerCard.vue
```
Confirm which refs and emits are exported. The plan below assumes: `origin`, `destination`, `startDate`, `endDate`, `preferences`, emit `submit`. Adjust bindings in the template if names differ.

- [ ] **Step 2: Add Lucide icon imports**

In the `<script setup>` block, add:
```ts
import { Sparkles, MapPin, Calendar, DollarSign, ArrowRight } from 'lucide-vue-next'
```

- [ ] **Step 3: Replace the `<template>` with the new Hero markup**

Replace the entire `<template>...</template>` with:

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
        告诉我目的地、天数和预算 —— 我会生成 3 套可切换的方案，并一路带着你一起打磨。
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
            <span class="hero-tag"><MapPin :size="14" :stroke-width="1.5" />{{ origin || '北京' }} → ?</span>
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

- [ ] **Step 4: Add/rewire reactive state for the composer**

Ensure `<script setup>` exports these refs (add if missing):

```ts
const draftPrompt = ref('')
const presets = [
  { label: '杭州 · 3 天 · 美食拍照', value: '杭州 3 天 2 人，预算 3000，侧重美食和拍照' },
  { label: '北海道 · 7 天 · 冬季滑雪', value: '北海道 7 天 2 人，预算 15000，冬季滑雪为主' },
  { label: '东京 · 5 天 · 动漫之旅', value: '东京 5 天 1 人，预算 10000，动漫主题' },
  { label: '西班牙 · 10 天 · 深度', value: '西班牙 10 天 2 人，预算 30000，深度文化之旅' },
]

const emit = defineEmits<{ submit: [value: string] }>()

function submitPrompt() {
  const value = draftPrompt.value.trim()
  if (!value || props.loading) return
  emit('submit', value)
}

function applyPreset(value: string) {
  draftPrompt.value = value
}
```

If `defineEmits` already exists at the top, merge instead of duplicating.

- [ ] **Step 5: Replace the `<style>` block with the new Hero styles**

Replace the entire `<style scoped>...</style>` with:

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
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--gradient-grid-mesh);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%);
  pointer-events: none;
}

.hero-kicker {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-blue);
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.18);
}

.hero-title {
  position: relative;
  z-index: 1;
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
  position: relative;
  z-index: 1;
  margin: 0 auto 28px;
  max-width: 46ch;
  color: var(--text-muted);
  font-size: var(--type-body-lg-size);
  line-height: 1.55;
}

.hero-composer {
  position: relative;
  z-index: 1;
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
  border: 0;
  outline: none;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.hero-tags { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.hero-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  border: 0;
  border-radius: var(--r-sm);
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
  position: relative;
  z-index: 1;
  margin-top: 24px;
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.hero-preset {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

- [ ] **Step 6: Remove obsolete refs/helpers**

If the original `HeroPlannerCard` has complex origin/date pickers that are no longer referenced by the new template, keep those refs in `<script>` for now (the parent `index.vue` may still emit events to them). If they're truly unused and not exported, delete them.

**Safe rule**: only remove refs/functions that are (a) not emitted, (b) not referenced in the new template, and (c) not in `defineExpose`.

- [ ] **Step 7: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 8: Visual verify via Playwright MCP**

Dev server + navigate to `/`. Take screenshot. Confirm:
- Aurora gradient background with grid mesh
- Big gradient-text title "称心的旅行"
- Glass composer with 3 tags + gradient "开始规划" button
- 4 preset pills below with sparkle icon

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/HeroPlannerCard.vue
git commit -m "feat(web/landing): redesign HeroPlannerCard with aurora Hero + glass composer + presets"
```

---

### Task 22: TripHistoryGrid — color bands + version chips + meta row

**Files:**
- Modify: `apps/web/components/TripHistoryGrid.vue`

- [ ] **Step 1: Read current file**

```bash
cat apps/web/components/TripHistoryGrid.vue
```

- [ ] **Step 2: Add imports**

Top of `<script setup>`:
```ts
import { Clock, DollarSign, Compass } from 'lucide-vue-next'
import EmptyState from '~/components/states/EmptyState.vue'
import { relativeTime } from '~/utils/relative-time'
import { destinationColor } from '~/utils/destination-color'
```

- [ ] **Step 3: Replace the empty-state markup**

Find the existing empty block (`<div v-if="entries.length === 0" class="trip-history-empty">...</div>`). Replace with:

```html
<EmptyState
  v-if="entries.length === 0"
  :icon="Compass"
  title="还没有规划过的行程"
  hint="从上方的 Hero 里描述你的第一次出行需求吧。"
/>
```

- [ ] **Step 4: Replace the grid markup**

Find the existing `<div v-else class="trip-history-grid">...</div>`. Replace with:

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
          <DollarSign :size="12" :stroke-width="1.5" />
          {{ entry.poiCount }} 个安排
        </span>
      </div>
    </div>
  </article>
</div>
```

Wrap the whole section with the `<section>` and its header (keep the existing `trip-history-head` block unchanged, but change `<h2>` text to "继续之前的规划" and add a meta counter chip).

Specifically update the header block:
```html
<header class="history-head">
  <h2 class="history-head-title">继续之前的规划</h2>
  <span v-if="entries.length" class="history-head-meta">
    RECENT · {{ entries.length }}
  </span>
</header>
```

- [ ] **Step 5: Replace the scoped styles**

Replace the entire `<style scoped>...</style>` block with:

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
  display: flex;
  flex-direction: column;
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
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 20% 80%, rgba(255,255,255,0.25), transparent 40%),
    radial-gradient(circle at 80% 20%, rgba(255,255,255,0.2), transparent 40%);
}

.history-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.history-dest-meta { color: var(--text-muted); font-weight: 500; margin-left: 4px; }

.history-remove {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-subtle);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--r-xs);
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.history-remove:hover { color: var(--accent-danger); background: var(--accent-danger-soft); }

.history-meta {
  display: flex;
  gap: 12px;
  font-size: var(--type-caption-size);
  color: var(--text-muted);
}
.history-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.history-meta-item :deep(svg) { color: var(--text-subtle); }

@media (max-width: 640px) {
  .history-grid { grid-template-columns: 1fr; }
}
</style>
```

- [ ] **Step 6: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 7: Visual verify**

Dev + Playwright MCP. Navigate to `/` (landing mode). Confirm:
- Section header "继续之前的规划" + "RECENT · N" mono meta
- Each card has a colorful band based on destination
- Meta row: Clock icon + relative time, DollarSign + count

(If no history entries exist, manually add one via localStorage in `browser_evaluate` to see the grid.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/TripHistoryGrid.vue
git commit -m "feat(web/landing): TripHistoryGrid with destination color bands + meta + EmptyState"
```

---

### Task 23: ChatPanel — StreamingBubble + ScrollArea + dedupe display

**Files:**
- Modify: `apps/web/components/ChatPanel.vue`

- [ ] **Step 1: Add imports**

Top of `<script setup>`:
```ts
import ScrollArea from '~/components/ui/ScrollArea.vue'
import StreamingBubble from '~/components/states/StreamingBubble.vue'
```

- [ ] **Step 2: Replace the conversation list with ScrollArea + updated bubble markup**

Replace the existing `<div class="conversation-list">...</div>` block with:

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
    <span v-if="message.occurrences && message.occurrences > 1" class="bubble-occurrences">
      ×{{ message.occurrences }}
    </span>
  </article>

  <StreamingBubble
    v-if="phase === 'planning'"
    :status="agentStatus"
    :steps="streamSteps"
  />
</ScrollArea>
```

Remove the old `.bubble-progress` block entirely.

- [ ] **Step 3: Add the occurrences badge style**

In the scoped `<style>`, add at the end:

```css
.bubble { position: relative; }
.bubble-occurrences {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 2px 8px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
  border: 1px solid var(--brand-blue-border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: 0.04em;
}

/* Tighter composer separator */
.conversation-composer {
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle-2);
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 5: Visual verify**

Dev + Playwright. Trigger a planning flow (submit prompt). Observe:
- Streaming bubble uses the new `StreamingBubble` (Sparkles icon + ghostPulse)
- After N responses, consecutive identical assistant messages collapse to one with "×N" badge
- ScrollArea shows custom scrollbar on the right when content overflows

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ChatPanel.vue
git commit -m "feat(web/chat): ScrollArea + StreamingBubble + occurrences badge on folded messages"
```

---

### Task 24: PlanningPreview — Plan Hero slab + 4 stat cards

**Files:**
- Modify: `apps/web/components/PlanningPreview.vue` (the header/summary section only)

**Note:** PlanningPreview is a 973-line file. Only modify the Plan header block (hero + summary). Day timeline is handled in Task 25.

- [ ] **Step 1: Read lines 1-80 of PlanningPreview to find the hero/summary block**

```bash
sed -n '1,80p' apps/web/components/PlanningPreview.vue
```
Identify the template section that renders the "方案摘要" header (probably a `.plan-header-card` or similar). Note its `<script>` computeds: `displayTitle`, `displaySubtitle`, `activeBudget`, etc. — these already exist and we will reuse them.

- [ ] **Step 2: Add imports**

Top of `<script setup>`:
```ts
import { Calendar, DollarSign, Users, Award, Lightbulb } from 'lucide-vue-next'
import { relativeTime } from '~/utils/relative-time'
```

- [ ] **Step 3: Compute the 4 stats**

Add in `<script setup>` (after existing computeds):

```ts
const statDays = computed(() => activePlanOption.value?.days.length ?? 0)
const statBudget = computed(() => activeBudget.value?.amount ?? 0)
const statCurrency = computed(() => activeBudget.value?.currency ?? 'CNY')
const statTravelers = computed(() => {
  const t = brief.value?.travelers
  return (t?.adults ?? 0) + (t?.children ?? 0) + (t?.seniors ?? 0) || 1
})
const statScore = computed(() => itineraryScore.value?.total ?? null)
const styleType = computed(() => activePlanOption.value?.type ?? '')
const restoredRelative = computed(() => (restoredAt.value ? relativeTime(restoredAt.value) : ''))
```

- [ ] **Step 4: Replace the plan header block in the template**

In the template, find the `.plan-header-card` (or equivalent — the top block with title + version chips). Replace it with:

```html
<section v-if="activePlanOption" class="plan-hero-slab">
  <div class="plan-hero-top">
    <span v-if="styleType" class="plan-style-chip">{{ styleType }}</span>
    <span v-if="restoredRelative" class="plan-meta">{{ restoredRelative.toUpperCase() }}</span>
  </div>

  <h2 class="plan-hero-title">{{ displayTitle }}</h2>
  <p v-if="displaySubtitle" class="plan-hero-sub">{{ displaySubtitle }}</p>

  <div class="plan-stats">
    <div class="plan-stat">
      <span class="plan-stat-label"><Calendar :size="12" :stroke-width="1.5" />DAYS</span>
      <span class="plan-stat-value tabular">
        {{ statDays }}<span class="currency-unit">天</span>
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
        {{ statScore ?? '—' }}<span class="currency-unit">/100</span>
      </span>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Add plan-hero styles at the end of scoped `<style>`**

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

.plan-hero-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.plan-style-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  background: var(--brand-purple-soft);
  color: var(--brand-purple);
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  border: 1px solid rgba(123, 91, 255, 0.28);
  border-radius: 999px;
}
.plan-meta {
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  color: var(--text-subtle);
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
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.plan-stat-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

- [ ] **Step 6: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 7: Visual verify**

Dev + Playwright. Trigger a plan (or restore one). Confirm in the right panel:
- Aurora hero slab with purple "balanced" chip and "N 小时前" meta
- Display-lg title
- 4 stat cards with Lucide icons, tabular numbers, mono labels

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/PlanningPreview.vue
git commit -m "feat(web/plan): Plan Hero slab with 4 stat cards (Days/Budget/People/Score)"
```

---

### Task 25: PlanningPreview — Day timeline + POI card redesign

**Files:**
- Modify: `apps/web/components/PlanningPreview.vue` (day timeline section)

- [ ] **Step 1: Add imports**

Top of `<script setup>` (merge with existing imports):
```ts
import { Bed, UtensilsCrossed, Mountain, TramFront, Map as MapIcon, Replace, Info } from 'lucide-vue-next'
import { poiVisualForType } from '~/utils/poi-visual'
import Tooltip from '~/components/ui/Tooltip.vue'
```

- [ ] **Step 2: Add helper for POI icon component**

In `<script setup>`:
```ts
const POI_ICON_COMPONENTS: Record<string, unknown> = {
  bed: Bed,
  'utensils-crossed': UtensilsCrossed,
  mountain: Mountain,
  'tram-front': TramFront,
}
function poiIconComponent(type: string | undefined) {
  const visual = poiVisualForType(type)
  return POI_ICON_COMPONENTS[visual.icon] ?? Mountain
}
function poiGradient(type: string | undefined) {
  return poiVisualForType(type).gradient
}
```

- [ ] **Step 3: Replace the Day timeline markup**

Find the existing `.result-day-card` (or similar) block that renders `activeDays`. Replace with:

```html
<section v-if="activeDays?.length" class="plan-days">
  <article
    v-for="day in activeDays"
    :key="day.dayNo"
    class="plan-day"
  >
    <header class="day-head">
      <div class="day-num">D{{ day.dayNo }}</div>
      <div class="day-title-row">
        <strong class="day-title">{{ day.summary || `Day ${day.dayNo}` }}</strong>
        <span v-if="day.date" class="day-date">{{ day.date }}</span>
      </div>
    </header>

    <div class="day-items">
      <article
        v-for="(item, idx) in day.items"
        :key="`${day.dayNo}-${idx}`"
        class="poi-card"
      >
        <div class="poi-thumb" :style="{ background: poiGradient(item.type) }">
          <component
            :is="poiIconComponent(item.type)"
            :size="22"
            :stroke-width="1.5"
          />
        </div>
        <div class="poi-body">
          <strong class="poi-title">{{ item.title }}</strong>
          <div class="poi-meta">
            <span v-if="item.details?.rating" class="poi-tag">★ {{ item.details.rating }}</span>
            <span v-for="tag in (item.details?.tags || []).slice(0, 2)" :key="tag" class="poi-tag">{{ tag }}</span>
            <span v-if="item.details?.description" class="poi-desc">{{ item.details.description }}</span>
          </div>
        </div>
        <div class="poi-right">
          <span v-if="item.startAt || item.endAt" class="poi-time tabular">
            {{ item.startAt }}<template v-if="item.endAt"> → {{ item.endAt }}</template>
          </span>
          <span v-if="item.amount != null" class="poi-cost tabular">
            <span class="currency-unit">{{ (item.currency || 'CNY') === 'CNY' ? '¥' : item.currency }}</span>{{ item.amount.toLocaleString() }}
          </span>
        </div>
        <div class="poi-actions">
          <Tooltip label="在地图上查看">
            <button type="button" class="poi-action"><MapIcon :size="14" :stroke-width="1.5" /></button>
          </Tooltip>
          <Tooltip label="替换">
            <button type="button" class="poi-action"><Replace :size="14" :stroke-width="1.5" /></button>
          </Tooltip>
          <Tooltip label="详情">
            <button type="button" class="poi-action"><Info :size="14" :stroke-width="1.5" /></button>
          </Tooltip>
        </div>
      </article>
    </div>
  </article>
</section>
```

- [ ] **Step 4: Add Day timeline + POI card styles**

Append to scoped `<style>`:

```css
.plan-days { display: flex; flex-direction: column; gap: 18px; }

.plan-day { position: relative; }

.day-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px 8px;
}
.day-num {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
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
.day-date {
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: 0.04em;
  color: var(--text-subtle);
}

.day-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  padding-left: 14px;
  margin-left: 14px;
  border-left: 1px solid var(--border);
}

.poi-card {
  position: relative;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  grid-template-rows: auto;
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
  width: 14px;
  height: 1px;
  background: var(--border);
}

.poi-thumb {
  width: 56px;
  height: 56px;
  border-radius: var(--r-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.poi-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
}
.poi-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
}
.poi-desc {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.poi-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
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
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  gap: 4px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  pointer-events: none;
}
.poi-card:hover .poi-actions {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.poi-action {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.poi-action:hover { border-color: var(--brand-blue); color: var(--brand-blue); }

@media (max-width: 640px) {
  .poi-card {
    grid-template-columns: 44px 1fr;
    gap: 10px;
  }
  .poi-right {
    grid-column: 1 / -1;
    flex-direction: row;
    justify-content: space-between;
  }
  .poi-actions { position: static; opacity: 1; transform: none; pointer-events: auto; margin-top: 6px; }
}

@media (prefers-reduced-motion: reduce) {
  .poi-card { transition: none; }
  .poi-actions { transition: none; }
}
```

- [ ] **Step 5: Verify build**

```bash
pnpm build:web
```

- [ ] **Step 6: Visual verify**

Dev + Playwright. Load an existing plan (via history or fresh submit). In the right panel, confirm:
- Each day has a "D1" gradient badge + title + optional date
- POI cards show colored thumbnail (hotel=purple, food=red, attraction=green, transit=blue)
- Hover a POI card → 3 ghost action buttons fade in at bottom-right
- Tabular numbers (cost/time) align cleanly

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/PlanningPreview.vue
git commit -m "feat(web/plan): Day timeline with gradient-badge POI cards + hover actions"
```

---

## Phase 7 · Polish (Tasks 26–28)

### Task 26: Apply motion presets across list renders

**Files:**
- Modify: `apps/web/components/ChatPanel.vue`
- Modify: `apps/web/components/TripHistoryGrid.vue`
- Modify: `apps/web/components/PlanningPreview.vue`

Rationale: Lists should feel alive. Use motion-v `<Motion>` with the presets from Task 3.

- [ ] **Step 1: ChatPanel — wrap bubbles in Motion slideUp**

In `ChatPanel.vue`'s `<template>`, wrap each `<article class="bubble">` iteration with `<Motion>` imported from `motion-v`:

Top of script: `import { Motion } from 'motion-v'`

In template, replace the `<article>...</article>` loop with:

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
  <span v-if="message.occurrences && message.occurrences > 1" class="bubble-occurrences">
    ×{{ message.occurrences }}
  </span>
</Motion>
```

Remove the old `animation-delay` inline style and the `animation: bubble-in ...` CSS — Motion handles it now.

- [ ] **Step 2: TripHistoryGrid — stagger cards**

Same pattern: wrap `<article class="history-card">` with `<Motion>` using the slideUp preset with per-index delay.

- [ ] **Step 3: PlanningPreview — animate day + POI entries**

Wrap `<article class="plan-day">` with Motion (fadeIn, no delay). Wrap each `.poi-card` with Motion using slideUp + stagger (delay `idx * 0.04`).

- [ ] **Step 4: Verify build + visual**

```bash
pnpm build:web
```

Dev + Playwright: refresh landing and workspace pages. Bubbles, history cards, POI cards should fade-slide in with a staggered cascade.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ChatPanel.vue apps/web/components/TripHistoryGrid.vue apps/web/components/PlanningPreview.vue
git commit -m "feat(web): apply motion-v slideUp + stagger to chat bubbles, history, and POI cards"
```

---

### Task 27: A11y pass + reduced-motion validation

**Files:**
- Modify: Any component with icon-only buttons missing `aria-label`
- Modify: Any interactive element without keyboard support

- [ ] **Step 1: Run the existing Playwright a11y smoke checks**

```bash
pnpm smoke:auth:ui
pnpm smoke:restore:ui
pnpm smoke:planner:states
```
Expected: all pass. If any fail due to changed text content (e.g. "退出登录" now inside a menu item instead of a button), update the test selectors to use roles.

- [ ] **Step 2: Manual a11y check via Playwright MCP**

Start dev, open `/`. Use `browser_snapshot` and inspect:
- All icon-only buttons have `aria-label` or sit inside a Tooltip with a label
- Headings form a proper outline (h1 on landing, h2 within cards, h3 within items)
- Focus-visible outlines are visible and not clipped

If any issues: add `aria-label="..."` or `role="button"` + `tabindex="0"` + keyboard handlers as needed.

- [ ] **Step 3: Reduced-motion validation**

In Playwright MCP:
```ts
browser_evaluate(`async () => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  return media.matches
}`)
```
Then force reduced motion in Chrome devtools emulation (if accessible via MCP extensions), or manually toggle system setting. Reload landing — all animations should stop (static opacity).

Alternatively, temporarily force it by injecting CSS in `browser_evaluate`:
```ts
document.documentElement.style.cssText += '; * { animation-duration: 0ms !important; transition-duration: 0ms !important; }'
```
and take a screenshot to verify layout is correct and nothing jumps.

- [ ] **Step 4: Commit any a11y fixes**

```bash
git add -u
git commit -m "chore(web/a11y): add aria-labels + keyboard handlers + reduced-motion verifications"
```

(If no changes are needed, skip this commit — not every task must produce one.)

---

### Task 28: Responsive breakpoint validation (980/640)

**Files:**
- Possible tweaks to any of: `main.css`, `HeroPlannerCard.vue`, `TripHistoryGrid.vue`, `PlanningPreview.vue`, `pages/index.vue`

- [ ] **Step 1: Playwright MCP — test 980px tablet breakpoint**

```ts
browser_resize(980, 900)
browser_navigate('http://localhost:3000')
browser_take_screenshot({ fullPage: true, type: 'png', filename: 'breakpoint-980-landing.png' })
browser_navigate('http://localhost:3000/login')
browser_take_screenshot({ fullPage: true, type: 'png', filename: 'breakpoint-980-login.png' })
```

Verify:
- Auth card collapses to single-column as expected
- Page topbar stays horizontal
- Workspace split panels remain readable

- [ ] **Step 2: Test 640px mobile breakpoint**

```ts
browser_resize(640, 800)
// Revisit landing + workspace + login
```

Verify:
- Hero composer row stacks vertically
- History grid is single column
- POI cards reflow to mobile layout (thumb + body + right row on new line)
- Plan stats collapse to 2 columns

- [ ] **Step 3: Fix any visual issues inline**

If a breakpoint has misalignment, add a targeted `@media` rule in the relevant component's scoped CSS.

- [ ] **Step 4: Final build + e2e smoke**

```bash
pnpm build:web
pnpm smoke:auth
pnpm smoke:planner
```

All expected to pass.

- [ ] **Step 5: Commit final polish**

```bash
git add -u
git commit -m "chore(web): responsive breakpoint validation + final polish fixes"
```

(Again — skip if no changes.)

---

## Self-Review (already done during plan writing)

**Spec coverage check:**
- ✅ §1 排版系统 → Task 2 (tokens) + applied across Tasks 20-25
- ✅ §1 颜色与表面 → Task 2 (new tokens)
- ✅ §1 动效系统 → Task 3 (motion primitives) + Task 26 (application)
- ✅ §1 图标系统 → Task 1 (install) + all component tasks use Lucide
- ✅ §1 微细节 → Task 2 (focus-visible), Task 27 (a11y)
- ✅ §2 Reka UI wrappers → Tasks 8-12
- ✅ §2 Toast → Task 4
- ✅ §3 State system → Tasks 13-16 + integrated in 22, 23
- ✅ §4.1 登录页 → Task 20
- ✅ §4.2 落地页 Hero → Task 21
- ✅ §4.3 History grid → Task 22
- ✅ §4.4 工作台 topbar + ChatPanel → Tasks 18, 19, 23 (+ dedupe in Task 17)
- ✅ §4.5 Plan Artifact → Tasks 24, 25
- ✅ §5.1 Landing Hero moment → Task 21
- ✅ §5.2 Plan Artifact moment → Tasks 24-25
- ✅ §5.3 POI gradient placeholders → Task 5 (util) + Task 25 (application)
- ✅ §6 Phase 分层 → This plan's phase structure mirrors the spec exactly

**Type/name consistency:**
- `motionPresets` named consistently (Task 3 defines, Task 26 uses indirectly via Motion props — note: Task 26 uses raw Motion props inline rather than referencing presets; acceptable simplification for v1)
- `poiVisualForType` / `PoiVisual` type consistent (Task 5 defines, Task 25 uses)
- `destinationColor` consistent (Task 6 defines, Task 22 uses)
- `relativeTime` consistent (Task 7 defines, Tasks 22, 24 use)
- `ChatMessage.occurrences` field consistent (Task 17 adds, Task 23 renders)
- `DropdownMenu` + `DropdownMenuItem` + `DropdownMenuSeparator` (Task 9 exports, Task 18 imports)

**Placeholder scan:** No TBD/TODO/"implement later"/"handle edge cases" anywhere. Every step contains executable content or exact code.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-frontend-polish.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because each task is self-contained and commit-boundaried.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
