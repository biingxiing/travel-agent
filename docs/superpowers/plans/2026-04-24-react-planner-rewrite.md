# ReAct Planner Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有"一次性单轮生成 + 多版本对比"的旅行规划后端，重写为统一 session 上的 ReAct（Reason+Act）循环：每轮"评估—修补"直到三个核心维度（交通/住宿/景点）规则分都 ≥ 90，最多 10 轮，未达标时让用户决定是否继续。

**Architecture:**
- 单一会话模型：每个 session 永远只持有最新一版 plan + 最新评分 + 状态机。彻底删除 `/api/trips` 多方案对比、`packages/domain`、`collab/`。
- ReAct 主循环（`apps/api/src/agents/react-loop.ts`）编排：extractor → generator(initial, stream) → loop[evaluator → generator.refine]。
- Evaluator 由"规则评分（移植自前端 scoring.ts）+ LLM critic（FAST_MODEL，json_object 输出）"加权组成，权重通过 `EVAL_RULE_WEIGHT` 可配。
- Critic 既能识别软质量问题（重复/节奏失衡），也能识别 blocker（缺出发城市等关键信息），blocker 通过 `clarify_needed` 事件让前端直接问用户。
- flyai skill 是真实数据源（已验证可用），通过 `SKILL_DIRS` 加载；调超时从 15s 调到 60s 可配。

**Tech Stack:** pnpm monorepo、Hono、@hono/streaming SSE、OpenAI SDK、zod、PostgreSQL（可选）、vitest（新增）、Nuxt 3、Pinia。

---

## File Structure

```
packages/shared/src/
  scoring.ts             [NEW]    规则评分（从 web/utils 移过来，前后端共用）
  brief.ts               [NEW]    TripBrief schema
  session.ts             [NEW]    统一 Session schema + status enum
  evaluation.ts          [NEW]    EvaluationReport / CriticReport schema
  events.ts              [MODIFY] 追加 6 个 ReAct SSE 事件
  index.ts               [MODIFY] 导出新模块
  chat.ts                [MODIFY] MessageSchema 扩 'tool' role（critic 内部用）

apps/api/src/
  index.ts               [MODIFY] 只挂载 auth + sessions + registry
  config/eval.ts         [NEW]    evaluator/loop 的 env 配置
  agents/
    extractor.ts         [NEW]    messages → TripBrief
    critic.ts            [NEW]    plan → CriticReport（FAST_MODEL）
    evaluator.ts         [NEW]    rule + LLM 加权
    generator.ts         [NEW]    initial（流式）+ refine（一次性）
    react-loop.ts        [NEW]    主编排
    planner.ts           [DELETE] 老入口
  session/
    store.ts             [NEW]    统一 Session 内存 + 持久化
    index.ts             [DELETE] 老入口
  persistence/pg.ts      [REWRITE] 单 sessions 表
  registry/load-dir-skills.ts [MODIFY] timeout 可配，默认 60s
  routes/
    sessions.ts          [NEW]    唯一业务路由
    chat.ts              [DELETE]
    trips.ts             [DELETE]
    collab.ts            [DELETE]
    registry.ts          [MODIFY] 只保留 GET
  collab/                [DELETE]

packages/domain/         [DELETE 整包]

apps/web/
  composables/
    useChatStream.ts     [REWRITE] 调 /api/sessions/:id/messages
    usePlannerApi.ts     [DELETE]
  stores/
    workspace.ts         [SIMPLIFY] 砍掉所有 planOptions/PlanType
    chat.ts              [MODIFY] 新增 iteration/score/status 字段
  utils/scoring.ts       [SIMPLIFY] re-export from shared
  pages/index.vue        [MODIFY] 进度条 + 继续按钮
  middleware/auth.global.ts [VERIFY] 未登录跳 /login（现状已有则保留）

apps/api/vitest.config.ts [NEW] 单元测试配置
packages/shared/vitest.config.ts [NEW]
```

---

## Phase 1: 共享基础设施（不破坏旧流程）

### Task 1: 给 packages/shared 和 apps/api 接入 vitest

**Files:**
- Create: `packages/shared/vitest.config.ts`
- Create: `apps/api/vitest.config.ts`
- Modify: `packages/shared/package.json`（加 devDependency 与 script）
- Modify: `apps/api/package.json`（加 devDependency 与 script）

- [ ] **Step 1: 安装 vitest**

```bash
pnpm add -D -w vitest @vitest/coverage-v8
pnpm add -D --filter @travel-agent/shared vitest
pnpm add -D --filter @travel-agent/api vitest
```

- [ ] **Step 2: 写 packages/shared/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: 写 apps/api/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: [],
  },
})
```

- [ ] **Step 4: 在两个 package.json 加 script**

`packages/shared/package.json` scripts 段加：
```json
"test": "vitest run",
"test:watch": "vitest"
```
`apps/api/package.json` 同样加。

- [ ] **Step 5: 写一个 dummy 通过测试，验证 toolchain**

Create `packages/shared/src/__sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('vitest sanity', () => {
  it('passes', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 6: 跑测试验证**

```bash
pnpm --filter @travel-agent/shared test
pnpm --filter @travel-agent/api test
```
Expected: 1 passing test in shared, 0 tests in api（也通过）。

- [ ] **Step 7: 删 dummy + commit**

```bash
rm packages/shared/src/__sanity.test.ts
git add -A
git commit -m "chore: add vitest to shared and api packages"
```

---

### Task 2: 把 scoring 移到 packages/shared（前后端共用）

**Files:**
- Create: `packages/shared/src/scoring.ts`
- Create: `packages/shared/src/scoring.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/utils/scoring.ts`（变 re-export）

- [ ] **Step 1: 写测试 packages/shared/src/scoring.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { scorePlan, gradeFromScore } from './scoring.js'
import type { Plan } from './plan.js'

const minimalPlan: Plan = {
  title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
  preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [],
  disclaimer: 'x',
}

describe('scoring', () => {
  it('gradeFromScore returns excellent for 90+', () => {
    expect(gradeFromScore(90)).toBe('excellent')
    expect(gradeFromScore(70)).toBe('good')
    expect(gradeFromScore(50)).toBe('fair')
    expect(gradeFromScore(0)).toBe('poor')
    expect(gradeFromScore(null)).toBe('none')
  })

  it('returns null categories when items absent', () => {
    const s = scorePlan(minimalPlan)
    expect(s.transport.score).toBeNull()
    expect(s.lodging.score).toBeNull()
    expect(s.attraction.score).toBeNull()
  })

  it('full transport item scores 100', () => {
    const plan: Plan = {
      ...minimalPlan,
      dailyPlans: [{
        day: 1, items: [{
          time: '09:00', type: 'transport',
          title: 'CA1234 北京大兴机场→上海浦东机场',
          description: '经济舱 ¥890，提前 2 小时到达办理值机和托运',
          tips: ['提前预订更便宜'],
        }],
      }],
    }
    const s = scorePlan(plan)
    expect(s.transport.score).toBe(100)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter @travel-agent/shared test
```
Expected: FAIL（找不到 scoring module）。

- [ ] **Step 3: 复制 apps/web/utils/scoring.ts 到 packages/shared/src/scoring.ts**

完整复制源码，但做 3 个修改：
1. 顶部 import 换成 `import type { Plan, PlanItem } from './plan.js'`
2. 删掉对 `item.desc` 的兼容（前端旧字段，后端没有）
3. 删掉 `gradeColor / gradeLabel`（纯 UI 函数，留前端）
4. 导出常量 `REQUIRED_CATEGORIES = ['transport','lodging','attraction'] as const`、`DEFAULT_THRESHOLD = 90`

完整文件内容：

```ts
import type { Plan, PlanItem } from './plan.js'

export type Grade = 'excellent' | 'good' | 'fair' | 'poor' | 'none'

export interface ScoreCheck {
  label: string
  points: number
  maxPoints: number
  found: boolean
}

export interface ItemScore {
  title: string
  type: string
  score: number
  checks: ScoreCheck[]
  grade: Grade
}

export interface CategoryScore {
  score: number | null
  count: number
  items: ItemScore[]
  grade: Grade
}

export interface CoverageScore {
  score: number
  daysWithTransport: number
  daysWithLodging: number
  daysWithAttractions: number
  totalDays: number
}

export interface ItineraryScore {
  overall: number
  grade: Grade
  transport: CategoryScore
  lodging: CategoryScore
  attraction: CategoryScore
  meal: CategoryScore
  coverage: CoverageScore
  suggestions: string[]
}

export const REQUIRED_CATEGORIES = ['transport', 'lodging', 'attraction'] as const
export const DEFAULT_THRESHOLD = 90

export function gradeFromScore(score: number | null): Grade {
  if (score === null) return 'none'
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'fair'
  return 'poor'
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

function itemText(item: PlanItem): string {
  const parts: string[] = [item.title]
  if (item.description) parts.push(item.description)
  if (Array.isArray(item.tips)) parts.push(...item.tips)
  return parts.join(' ')
}

function chk(label: string, found: boolean, maxPoints: number): ScoreCheck {
  return { label, found, points: found ? maxPoints : 0, maxPoints }
}

function avgScore(items: ItemScore[]): number | null {
  if (items.length === 0) return null
  return Math.round(items.reduce((s, i) => s + i.score, 0) / items.length)
}

function buildCategory(items: ItemScore[]): CategoryScore {
  const score = avgScore(items)
  return { score, count: items.length, items, grade: gradeFromScore(score) }
}

function scoreTransportItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const checks: ScoreCheck[] = [
    chk('航班 / 车次号', anyMatch(t, [
      /\b[A-Z]{2}\d{3,4}\b/,
      /\b[GDZKTYJ]\d{2,4}次?\b/i,
      /航班号|车次|班次/,
    ]), 35),
    chk('出发 / 到达站点', anyMatch(t, [
      /机场|Airport|航站楼|T[123]/,
      /高铁站|火车站|动车站/,
      /\S+站[，。\s]/,
      /\S+机场/,
    ]), 20),
    chk('出发 / 到达时间',
      (!!item.time && item.time !== '') || anyMatch(t, [/\d{1,2}:\d{2}/]),
      20),
    chk('舱位 / 座位类型', anyMatch(t, [
      /经济舱|商务舱|头等舱|公务舱/,
      /二等座|一等座|商务座/,
      /软卧|硬卧|硬座|软座/,
    ]), 15),
    chk('预订 / 出行提示',
      (Array.isArray(item.tips) && item.tips.length > 0) ||
        anyMatch(t, [/提前|预订|购票|值机|托运|行李额/]),
      10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

function scoreLodgingItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const checks: ScoreCheck[] = [
    chk('具体房型', anyMatch(t, [
      /大床房|双床房|标准间|单人间|三人间|家庭房/,
      /豪华|行政|套房|海景|山景|城景|花园|湖景|阁楼/,
      /King|Queen|Twin|Suite|Deluxe|Superior|Standard/i,
    ]), 30),
    chk('入住 / 退房时间', anyMatch(t, [
      /入住.{0,8}\d{1,2}:\d{2}/,
      /退房.{0,8}\d{1,2}:\d{2}/,
      /\d{1,2}:\d{2}.{0,8}(入住|退房)/,
      /check.?in|check.?out/i,
    ]), 20),
    chk('每晚价格',
      !!item.estimatedCost ||
        anyMatch(t, [/\d+\s*元?\/晚|每晚\s*\d+|¥\s*\d+|\$\d+/, /房费|住宿费/]),
      20),
    chk('地址 / 位置',
      !!item.location ||
        anyMatch(t, [/路|街道|区.{0,2}号|步行\d+分钟/, /地址|位于|靠近|附近/]),
      20),
    chk('设施 / 须知', anyMatch(t, [
      /含早餐|免费早餐|早餐/,
      /停车|WiFi|泳池|健身|SPA/i,
      /预订|取消政策|订房须知/,
    ]), 10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

function scoreAttractionItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const descLen = (item.description ?? '').length
  const checks: ScoreCheck[] = [
    chk('开放时间', anyMatch(t, [
      /开放时间|营业时间|开门时间/,
      /全天开放|24小时开放/,
      /\d{1,2}:\d{2}\s*[-~至到]\s*\d{1,2}:\d{2}/,
      /每(天|日)\s*\d{1,2}:\d{2}/,
    ]), 25),
    chk('门票信息', anyMatch(t, [
      /门票|票价|入场费|景区票/,
      /免费(入场|参观|开放)|无需(门票|购票)/,
      /\d+\s*元.{0,4}(票|门票)/,
      /凭票入场|凭证入场/,
    ]), 25),
    chk('建议游览时长',
      !!item.durationMinutes ||
        anyMatch(t, [/\d+\s*小时/, /半天|全天/, /建议(游览|参观|停留)/, /参观时间|游览时间/]),
      20),
    chk('景点具体内容',
      descLen >= 40 ||
        anyMatch(t, [/推荐|必看|必去|特色|亮点|重点景点/, /代表性|知名|著名|标志性/]),
      20),
    chk('游玩贴士',
      (Array.isArray(item.tips) && item.tips.length > 0) ||
        anyMatch(t, [/建议|注意|避免|旺季|淡季|人多|拥挤|提前|预约|拍照/]),
      10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

function scoreMealItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const checks: ScoreCheck[] = [
    chk('特色菜品', anyMatch(t, [
      /推荐|必点|招牌|特色菜|代表菜/,
      /[^\s，。]{2,6}(饭|面|汤|锅|串|饺|粥|饼|糕|虾|蟹|鱼)/,
    ]), 30),
    chk('人均价格',
      !!item.estimatedCost ||
        anyMatch(t, [/人均|消费|价格|费用/, /\d+\s*元\s*(\/人|左右|起)/]),
      25),
    chk('餐厅位置',
      !!item.location || anyMatch(t, [/路|街|区.{0,2}号/, /位于|地址|靠近/]),
      20),
    chk('预订建议', anyMatch(t, [/预订|预约|排队|需要提前|建议预约/]), 15),
    chk('用餐贴士',
      (Array.isArray(item.tips) && item.tips.length > 0) ||
        anyMatch(t, [/营业时间|开门|打烊|高峰|等位|人气/]),
      10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

export function scorePlan(plan: Plan): ItineraryScore {
  const allItems = plan.dailyPlans.flatMap((d) => d.items)
  const transportScores = allItems.filter((i) => i.type === 'transport').map(scoreTransportItem)
  const lodgingScores = allItems.filter((i) => i.type === 'lodging').map(scoreLodgingItem)
  const attractionScores = allItems
    .filter((i) => i.type === 'attraction' || i.type === 'activity')
    .map(scoreAttractionItem)
  const mealScores = allItems.filter((i) => i.type === 'meal').map(scoreMealItem)

  const transport = buildCategory(transportScores)
  const lodging = buildCategory(lodgingScores)
  const attraction = buildCategory(attractionScores)
  const meal = buildCategory(mealScores)

  const totalDays = plan.days
  const daysWithTransport = plan.dailyPlans.filter((d) =>
    d.items.some((i) => i.type === 'transport')).length
  const daysWithLodging = plan.dailyPlans.filter((d) =>
    d.items.some((i) => i.type === 'lodging')).length
  const daysWithAttractions = plan.dailyPlans.filter((d) =>
    d.items.filter((i) => i.type === 'attraction' || i.type === 'activity').length >= 2).length
  const coverageScore = totalDays === 0 ? 0 : Math.round(
    (daysWithTransport / totalDays) * 33 +
    (daysWithLodging / totalDays) * 33 +
    (daysWithAttractions / totalDays) * 34,
  )
  const coverage: CoverageScore = {
    score: coverageScore, daysWithTransport, daysWithLodging, daysWithAttractions, totalDays,
  }

  let coverageWeight = 0.15
  let weightedSum = 0
  const catWeights = [
    { score: transport.score, weight: 0.30 },
    { score: lodging.score, weight: 0.30 },
    { score: attraction.score, weight: 0.25 },
  ]
  for (const { score, weight } of catWeights) {
    if (score !== null) weightedSum += score * weight
    else coverageWeight += weight
  }
  weightedSum += coverageScore * coverageWeight
  const overall = Math.round(weightedSum)

  const suggestions: string[] = []
  if (transport.score === null) suggestions.push('行程中未包含交通安排，建议添加航班或火车具体信息')
  else if (transport.score < 60) suggestions.push('交通信息较简略，建议补充具体航班 / 车次号、舱位类型和乘车站点')
  if (lodging.score === null) suggestions.push('行程中未包含住宿安排，建议添加酒店名称和具体房型')
  else if (lodging.score < 60) suggestions.push('住宿信息较简略，建议补充具体房型、入住退房时间及每晚价格')
  if (attraction.score === null) suggestions.push('行程中未检测到景点活动，建议添加具体游览项目')
  else if (attraction.score < 60) suggestions.push('景点信息较简略，建议补充开放时间、门票价格和建议游览时长')
  if (coverageScore < 60 && suggestions.length < 3)
    suggestions.push('部分天数缺少交通或住宿安排，建议检查每日行程完整性')

  return { overall, grade: gradeFromScore(overall), transport, lodging, attraction, meal, coverage, suggestions }
}

export function isConverged(score: ItineraryScore, threshold = DEFAULT_THRESHOLD): boolean {
  return REQUIRED_CATEGORIES.every((cat) => {
    const s = score[cat].score
    return s !== null && s >= threshold
  })
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/shared test
```
Expected: PASS (3 tests)。

- [ ] **Step 5: 在 packages/shared/src/index.ts 导出**

加一行：
```ts
export * from './scoring.js'
```

- [ ] **Step 6: 改 apps/web/utils/scoring.ts 为 re-export**

整个文件替换为：
```ts
export {
  scorePlan, gradeFromScore, isConverged,
  REQUIRED_CATEGORIES, DEFAULT_THRESHOLD,
} from '@travel-agent/shared'
export type {
  Grade, ScoreCheck, ItemScore, CategoryScore, CoverageScore, ItineraryScore,
} from '@travel-agent/shared'

import type { Grade } from '@travel-agent/shared'

export function gradeColor(g: Grade): string {
  const map: Record<Grade, string> = {
    excellent: '#10b981', good: '#6366f1', fair: '#f59e0b',
    poor: '#ef4444', none: '#d1d5db',
  }
  return map[g]
}

export function gradeLabel(g: Grade): string {
  const map: Record<Grade, string> = {
    excellent: '优秀', good: '良好', fair: '一般', poor: '欠缺', none: 'N/A',
  }
  return map[g]
}

import type { Plan } from '~/types/itinerary'
import type { Plan as SharedPlan } from '@travel-agent/shared'
import { scorePlan as sharedScorePlan } from '@travel-agent/shared'

export function scorePlanCompat(plan: Plan): ItineraryScore {
  return sharedScorePlan(plan as unknown as SharedPlan)
}
```

注：保留 `buildItemScoreMap` 不动（继续在 web 侧），用 `scorePlanCompat` 桥接前端旧 Plan 类型差异。

- [ ] **Step 7: 跑前端 build 验证不破坏**

```bash
pnpm --filter @travel-agent/web build
```
Expected: 成功。

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/web/utils/scoring.ts
git commit -m "refactor: move scoring logic to shared package"
```

---

### Task 3: 加 TripBrief schema 到 shared

**Files:**
- Create: `packages/shared/src/brief.ts`
- Create: `packages/shared/src/brief.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写测试**

`packages/shared/src/brief.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { TripBriefSchema, isBriefMinimallyComplete, mergeBrief } from './brief.js'

describe('TripBrief', () => {
  it('parses minimal brief', () => {
    const b = TripBriefSchema.parse({ destination: '北京', days: 3 })
    expect(b.travelers).toBe(1)
    expect(b.preferences).toEqual([])
  })

  it('isBriefMinimallyComplete requires destination + days', () => {
    expect(isBriefMinimallyComplete({ destination: '', days: 0 })).toBe(false)
    expect(isBriefMinimallyComplete({ destination: '北京', days: 0 })).toBe(false)
    expect(isBriefMinimallyComplete({ destination: '北京', days: 3 })).toBe(true)
  })

  it('mergeBrief overlays new fields, keeps old non-overwritten', () => {
    const a = TripBriefSchema.parse({ destination: '北京', days: 3, originCity: '上海' })
    const b = mergeBrief(a, { days: 5 })
    expect(b.destination).toBe('北京')
    expect(b.originCity).toBe('上海')
    expect(b.days).toBe(5)
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/shared test brief
```
Expected: FAIL（找不到 brief module）。

- [ ] **Step 3: 实现 packages/shared/src/brief.ts**

```ts
import { z } from 'zod'

export const TripBriefSchema = z.object({
  destination: z.string(),
  days: z.number().int().nonnegative(),
  originCity: z.string().optional(),
  travelers: z.number().int().positive().default(1),
  travelDates: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  budget: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().default('CNY'),
  }).optional(),
  preferences: z.array(z.string()).default([]),
  pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
  notes: z.string().optional(),
})

export type TripBrief = z.infer<typeof TripBriefSchema>

export function isBriefMinimallyComplete(b: Partial<TripBrief>): boolean {
  return !!b.destination && !!b.days && b.days > 0
}

export function mergeBrief(prev: TripBrief, patch: Partial<TripBrief>): TripBrief {
  return TripBriefSchema.parse({ ...prev, ...patch })
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/shared test brief
```
Expected: 3 PASS。

- [ ] **Step 5: 在 index.ts 导出**

加 `export * from './brief.js'`

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add TripBrief schema with merge helper"
```

---

### Task 4: 加 EvaluationReport / CriticReport schema

**Files:**
- Create: `packages/shared/src/evaluation.ts`
- Create: `packages/shared/src/evaluation.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写测试**

`packages/shared/src/evaluation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CriticReportSchema, BlockerTypeEnum } from './evaluation.js'

describe('CriticReport', () => {
  it('parses a complete critic report', () => {
    const r = CriticReportSchema.parse({
      qualityScore: 75,
      blockers: [{ type: 'missing_origin', message: '请告诉我从哪里出发' }],
      itemIssues: [{
        dayNum: 1, itemIndex: 0, severity: 'high', category: 'transport',
        problem: '缺少航班号', suggestedAction: 'call_flyai_flight',
      }],
      globalIssues: ['第 1 天和第 3 天景点重复'],
    })
    expect(r.blockers).toHaveLength(1)
  })

  it('rejects unknown blocker type', () => {
    expect(() => CriticReportSchema.parse({
      qualityScore: 75, blockers: [{ type: 'unknown', message: 'x' }],
      itemIssues: [], globalIssues: [],
    })).toThrow()
  })

  it('coerces missing arrays to []', () => {
    const r = CriticReportSchema.parse({ qualityScore: 0 })
    expect(r.blockers).toEqual([])
    expect(r.itemIssues).toEqual([])
    expect(r.globalIssues).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/shared test evaluation
```
Expected: FAIL。

- [ ] **Step 3: 实现 packages/shared/src/evaluation.ts**

```ts
import { z } from 'zod'

export const BlockerTypeEnum = z.enum([
  'missing_origin', 'missing_destination', 'missing_days',
  'missing_dates', 'missing_budget', 'unclear_preference', 'other',
])
export type BlockerType = z.infer<typeof BlockerTypeEnum>

export const SuggestedActionEnum = z.enum([
  'call_flyai_flight', 'call_flyai_train', 'call_flyai_hotel',
  'call_flyai_poi', 'rewrite_description', 'replace_item', 'reorder',
])
export type SuggestedAction = z.infer<typeof SuggestedActionEnum>

export const ItemIssueSchema = z.object({
  dayNum: z.number().int().positive(),
  itemIndex: z.number().int().nonnegative(),
  severity: z.enum(['high', 'medium', 'low']),
  category: z.enum(['transport', 'lodging', 'attraction', 'meal', 'coherence']),
  problem: z.string(),
  suggestedAction: SuggestedActionEnum,
  hints: z.record(z.string(), z.unknown()).optional(),
})
export type ItemIssue = z.infer<typeof ItemIssueSchema>

export const CriticReportSchema = z.object({
  qualityScore: z.number().min(0).max(100),
  blockers: z.array(z.object({
    type: BlockerTypeEnum,
    message: z.string(),
  })).default([]),
  itemIssues: z.array(ItemIssueSchema).default([]),
  globalIssues: z.array(z.string()).default([]),
})
export type CriticReport = z.infer<typeof CriticReportSchema>

export interface CombinedScore {
  overall: number
  transport: number | null
  lodging: number | null
  attraction: number | null
}

export interface EvaluationReport {
  ruleScore: import('./scoring.js').ItineraryScore
  llmScore: number
  combined: CombinedScore
  blockers: CriticReport['blockers']
  itemIssues: CriticReport['itemIssues']
  globalIssues: string[]
  converged: boolean
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/shared test evaluation
```
Expected: 3 PASS。

- [ ] **Step 5: 导出 + commit**

`packages/shared/src/index.ts` 加 `export * from './evaluation.js'`。

```bash
git add packages/shared
git commit -m "feat(shared): add CriticReport and EvaluationReport schemas"
```

---

### Task 5: 加 Session schema 到 shared

**Files:**
- Create: `packages/shared/src/session.ts`
- Create: `packages/shared/src/session.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写测试**

`packages/shared/src/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SessionStatusEnum, SessionStateSchema } from './session.js'

describe('SessionState', () => {
  it('accepts all valid statuses', () => {
    for (const s of ['draft','planning','refining','awaiting_user','converged','error']) {
      expect(SessionStatusEnum.parse(s)).toBe(s)
    }
  })

  it('parses minimal session', () => {
    const s = SessionStateSchema.parse({
      id: 'sess-1', userId: 'u-1', messages: [], status: 'draft',
      iterationCount: 0, createdAt: 1, updatedAt: 1,
    })
    expect(s.brief).toBeNull()
    expect(s.currentPlan).toBeNull()
    expect(s.currentScore).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/shared test session
```
Expected: FAIL。

- [ ] **Step 3: 实现 packages/shared/src/session.ts**

```ts
import { z } from 'zod'
import { MessageSchema } from './chat.js'
import { TripBriefSchema } from './brief.js'
import { PlanSchema } from './plan.js'

export const SessionStatusEnum = z.enum([
  'draft', 'planning', 'refining', 'awaiting_user', 'converged', 'error',
])
export type SessionStatus = z.infer<typeof SessionStatusEnum>

export const ItineraryScoreSummarySchema = z.object({
  overall: z.number(),
  transport: z.number().nullable(),
  lodging: z.number().nullable(),
  attraction: z.number().nullable(),
  iteration: z.number().int().nonnegative(),
})
export type ItineraryScoreSummary = z.infer<typeof ItineraryScoreSummarySchema>

export const SessionStateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().nullable().default(null),
  brief: TripBriefSchema.nullable().default(null),
  messages: z.array(MessageSchema).default([]),
  currentPlan: PlanSchema.nullable().default(null),
  currentScore: ItineraryScoreSummarySchema.nullable().default(null),
  status: SessionStatusEnum,
  iterationCount: z.number().int().nonnegative().default(0),
  lastRunId: z.string().nullable().default(null),
  pendingClarification: z.string().nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SessionState = z.infer<typeof SessionStateSchema>
```

- [ ] **Step 4: 跑测试验证通过 + 导出 + commit**

```bash
pnpm --filter @travel-agent/shared test session
```
然后在 `packages/shared/src/index.ts` 加 `export * from './session.js'`。

```bash
git add packages/shared
git commit -m "feat(shared): add unified Session state schema"
```

---

### Task 6: 扩展 events.ts 加 ReAct 事件

**Files:**
- Modify: `packages/shared/src/events.ts`
- Create: `packages/shared/src/events.test.ts`

- [ ] **Step 1: 写测试**

`packages/shared/src/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ChatStreamEventSchema } from './events.js'

describe('ChatStreamEvent', () => {
  it('parses iteration_progress', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'iteration_progress',
      iteration: 3, maxIterations: 10,
      currentScore: 78, targetScore: 90,
      status: 'refining',
    })
    expect(e.type).toBe('iteration_progress')
  })

  it('parses score', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'score', overall: 88, transport: 90, lodging: 85, attraction: 92,
      iteration: 4, converged: false,
    })
    expect(e.type).toBe('score')
  })

  it('parses clarify_needed', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'clarify_needed', question: '从哪出发？', reason: 'missing_origin',
    })
    expect(e.type).toBe('clarify_needed')
  })

  it('parses max_iter_reached', () => {
    const e = ChatStreamEventSchema.parse({
      type: 'max_iter_reached', currentScore: 87,
      plan: { title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
        preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [],
        disclaimer: 'x' },
    })
    expect(e.type).toBe('max_iter_reached')
  })
})
```

- [ ] **Step 2: 修改 packages/shared/src/events.ts**

在 `ChatStreamEventSchema` 的 `discriminatedUnion` 中追加新事件，并扩展 `agent_step` 的 status：

完整新文件：
```ts
import { z } from 'zod'
import { PlanSchema } from './plan.js'
import { BlockerTypeEnum } from './evaluation.js'

export const FollowupFieldEnum = z.enum([
  'destination', 'days', 'travelers', 'budget', 'preferences', 'pace',
])
export type FollowupField = z.infer<typeof FollowupFieldEnum>

export const FollowupEventSchema = z.object({
  type: z.literal('followup'),
  field: FollowupFieldEnum,
  question: z.string(),
  options: z.array(z.string()).min(1),
  multiSelect: z.boolean().default(false),
})
export type FollowupEvent = z.infer<typeof FollowupEventSchema>

export const ItemOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  patch: z.object({
    description: z.string().optional(),
    time: z.string().optional(),
    estimatedCost: z.object({ amount: z.number(), currency: z.string() }).optional(),
  }),
})
export type ItemOption = z.infer<typeof ItemOptionSchema>

export const ItemSelectionSchema = z.object({
  dayNum: z.number(),
  itemIndex: z.number(),
  itemTitle: z.string(),
  itemType: z.enum(['transport', 'lodging']),
  question: z.string(),
  options: z.array(ItemOptionSchema).min(1),
})
export type ItemSelection = z.infer<typeof ItemSelectionSchema>

export const ItemOptionsEventSchema = z.object({
  type: z.literal('item_options'),
  selections: z.array(ItemSelectionSchema),
})
export type ItemOptionsEvent = z.infer<typeof ItemOptionsEventSchema>

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: z.string(), messageId: z.string() }),
  z.object({
    type: z.literal('agent_step'),
    agent: z.string(),
    skill: z.string().optional(),
    status: z.enum([
      'thinking', 'start', 'done', 'error',
      'evaluating', 'refining',
    ]),
    input: z.any().optional(),
    output: z.any().optional(),
  }),
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({ type: z.literal('plan_partial'), plan: PlanSchema.deepPartial() }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  FollowupEventSchema,
  ItemOptionsEventSchema,
  z.object({
    type: z.literal('iteration_progress'),
    iteration: z.number().int().positive(),
    maxIterations: z.number().int().positive(),
    currentScore: z.number(),
    targetScore: z.number(),
    status: z.enum(['evaluating', 'refining']),
  }),
  z.object({
    type: z.literal('score'),
    overall: z.number(),
    transport: z.number().nullable(),
    lodging: z.number().nullable(),
    attraction: z.number().nullable(),
    iteration: z.number().int().nonnegative(),
    converged: z.boolean(),
  }),
  z.object({
    type: z.literal('clarify_needed'),
    question: z.string(),
    reason: BlockerTypeEnum,
  }),
  z.object({
    type: z.literal('max_iter_reached'),
    currentScore: z.number(),
    plan: PlanSchema,
  }),
  z.object({
    type: z.literal('done'),
    messageId: z.string(),
    converged: z.boolean().optional(),
    usage: z.object({ prompt: z.number(), completion: z.number() }).optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>
```

- [ ] **Step 3: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/shared test events
```
Expected: 4 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add ReAct loop SSE events"
```

---

## Phase 2: 后端基础设施（与旧并行，不破坏）

### Task 7: 把 skill 调超时改成可配，默认 60s

**Files:**
- Modify: `apps/api/src/registry/load-dir-skills.ts`
- Create: `apps/api/src/registry/load-dir-skills.test.ts`

- [ ] **Step 1: 写测试**

`apps/api/src/registry/load-dir-skills.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('skill exec timeout config', () => {
  let original: string | undefined
  beforeEach(() => { original = process.env.SKILL_EXEC_TIMEOUT_MS })
  afterEach(() => {
    if (original === undefined) delete process.env.SKILL_EXEC_TIMEOUT_MS
    else process.env.SKILL_EXEC_TIMEOUT_MS = original
  })

  it('reads default 60000 when env unset', async () => {
    delete process.env.SKILL_EXEC_TIMEOUT_MS
    const mod = await import('./load-dir-skills.js?t=' + Date.now())
    expect((mod as any).getSkillTimeoutMs()).toBe(60000)
  })

  it('reads value from env', async () => {
    process.env.SKILL_EXEC_TIMEOUT_MS = '120000'
    const mod = await import('./load-dir-skills.js?t=' + Date.now())
    expect((mod as any).getSkillTimeoutMs()).toBe(120000)
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test load-dir
```
Expected: FAIL（找不到 getSkillTimeoutMs）。

- [ ] **Step 3: 修改 apps/api/src/registry/load-dir-skills.ts**

在文件顶部添加：
```ts
export function getSkillTimeoutMs(): number {
  const raw = process.env.SKILL_EXEC_TIMEOUT_MS
  if (!raw) return 60000
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 60000
}
```
把 `handler` 里的 `timeout: 15000` 替换为 `timeout: getSkillTimeoutMs()`。

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test load-dir
```
Expected: 2 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/registry
git commit -m "feat(api): make skill exec timeout configurable, default 60s"
```

---

### Task 8: 加 evaluator/loop 的 env 配置模块

**Files:**
- Create: `apps/api/src/config/eval.ts`
- Create: `apps/api/src/config/eval.test.ts`
- Modify: `.env.example`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: 写测试**

`apps/api/src/config/eval.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const KEYS = ['EVAL_RULE_WEIGHT','EVAL_THRESHOLD','EVAL_MAX_ITER','EVAL_REQUIRED_CATEGORIES']

describe('eval config', () => {
  let saved: Record<string, string|undefined> = {}
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k] })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults', async () => {
    for (const k of KEYS) delete process.env[k]
    const cfg = await import('./eval.js?t=' + Date.now()).then((m) => (m as any).getEvalConfig())
    expect(cfg.ruleWeight).toBe(0.7)
    expect(cfg.threshold).toBe(90)
    expect(cfg.maxIter).toBe(10)
    expect(cfg.requiredCategories).toEqual(['transport','lodging','attraction'])
  })

  it('reads from env', async () => {
    process.env.EVAL_RULE_WEIGHT = '0.5'
    process.env.EVAL_THRESHOLD = '85'
    process.env.EVAL_MAX_ITER = '5'
    process.env.EVAL_REQUIRED_CATEGORIES = 'transport,attraction'
    const cfg = await import('./eval.js?t=' + Date.now()).then((m) => (m as any).getEvalConfig())
    expect(cfg.ruleWeight).toBe(0.5)
    expect(cfg.threshold).toBe(85)
    expect(cfg.maxIter).toBe(5)
    expect(cfg.requiredCategories).toEqual(['transport','attraction'])
  })

  it('clamps ruleWeight to [0,1]', async () => {
    process.env.EVAL_RULE_WEIGHT = '1.5'
    const cfg = await import('./eval.js?t=' + Date.now()).then((m) => (m as any).getEvalConfig())
    expect(cfg.ruleWeight).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test eval
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/config/eval.ts**

```ts
import { REQUIRED_CATEGORIES, DEFAULT_THRESHOLD } from '@travel-agent/shared'

export interface EvalConfig {
  ruleWeight: number       // 0..1
  llmWeight: number        // 1 - ruleWeight
  threshold: number
  maxIter: number
  requiredCategories: ReadonlyArray<'transport' | 'lodging' | 'attraction'>
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function getEvalConfig(): EvalConfig {
  const ruleRaw = parseFloat(process.env.EVAL_RULE_WEIGHT ?? '0.7')
  const ruleWeight = clamp(Number.isFinite(ruleRaw) ? ruleRaw : 0.7, 0, 1)
  const threshold = parseInt(process.env.EVAL_THRESHOLD ?? String(DEFAULT_THRESHOLD), 10) || DEFAULT_THRESHOLD
  const maxIter = parseInt(process.env.EVAL_MAX_ITER ?? '10', 10) || 10

  const allowed = new Set(['transport', 'lodging', 'attraction'])
  const raw = process.env.EVAL_REQUIRED_CATEGORIES
  let requiredCategories: ReadonlyArray<'transport' | 'lodging' | 'attraction'>
  if (raw) {
    const parsed = raw.split(',').map((s) => s.trim()).filter((s) => allowed.has(s))
    requiredCategories = (parsed.length > 0 ? parsed : REQUIRED_CATEGORIES) as ReadonlyArray<'transport' | 'lodging' | 'attraction'>
  } else {
    requiredCategories = REQUIRED_CATEGORIES
  }

  return { ruleWeight, llmWeight: 1 - ruleWeight, threshold, maxIter, requiredCategories }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test eval
```
Expected: 3 PASS。

- [ ] **Step 5: 更新 .env.example 文件**

`apps/api/.env.example` 末尾追加：
```
# ReAct loop config
EVAL_RULE_WEIGHT=0.7
EVAL_THRESHOLD=90
EVAL_MAX_ITER=10
EVAL_REQUIRED_CATEGORIES=transport,lodging,attraction
SKILL_EXEC_TIMEOUT_MS=60000
```
根目录 `.env.example` 同样追加。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config .env.example apps/api/.env.example
git commit -m "feat(api): add ReAct loop env config module"
```

---

### Task 9: 重写 persistence/pg.ts 为单 sessions 表

**Files:**
- Rewrite: `apps/api/src/persistence/pg.ts`
- Modify: `packages/memory-pg/src/migration.sql`（如果存在；不存在就 inline 一个 schema）
- Create: `apps/api/src/persistence/pg.test.ts`（仅在 DATABASE_URL 设了时跑）

- [ ] **Step 1: 检查 packages/memory-pg 现状**

```bash
ls packages/memory-pg/src/ && cat packages/memory-pg/src/migration.sql 2>/dev/null | head -40
```

- [ ] **Step 2: 改 packages/memory-pg/src/migration.sql 为新 schema**

替换为：
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id              uuid PRIMARY KEY,
  user_id         text NOT NULL,
  title           text,
  brief           jsonb,
  messages        jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_plan    jsonb,
  current_score   jsonb,
  status          text NOT NULL DEFAULT 'draft',
  iteration_count int  NOT NULL DEFAULT 0,
  last_run_id     text,
  pending_clarification text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_updated_idx
  ON sessions (user_id, updated_at DESC);

DROP TABLE IF EXISTS trip_sessions;
```

- [ ] **Step 3: 重写 apps/api/src/persistence/pg.ts**

完整替换为：
```ts
import { travelMemoryPgMigrationSql } from '@travel-agent/memory-pg'
import type { SessionState } from '@travel-agent/shared'
import { SessionStateSchema } from '@travel-agent/shared'
import pg from 'pg'

const { Pool } = pg
type PgPool = InstanceType<typeof Pool>

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || ''

let pool: PgPool | null = null
let migrationPromise: Promise<void> | null = null

export function isDatabaseEnabled(): boolean {
  return Boolean(DATABASE_URL)
}

function getPool(): PgPool {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    })
  }
  return pool
}

export async function runDatabaseMigrations(): Promise<void> {
  if (!isDatabaseEnabled()) return
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const client = await getPool().connect()
      try { await client.query(travelMemoryPgMigrationSql) }
      finally { client.release() }
    })()
  }
  await migrationPromise
}

interface SessionRow {
  id: string
  user_id: string
  title: string | null
  brief: unknown
  messages: unknown
  current_plan: unknown
  current_score: unknown
  status: string
  iteration_count: number
  last_run_id: string | null
  pending_clarification: string | null
  created_at: Date
  updated_at: Date
}

function rowToState(row: SessionRow): SessionState {
  return SessionStateSchema.parse({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    brief: row.brief ?? null,
    messages: row.messages ?? [],
    currentPlan: row.current_plan ?? null,
    currentScore: row.current_score ?? null,
    status: row.status,
    iterationCount: row.iteration_count,
    lastRunId: row.last_run_id,
    pendingClarification: row.pending_clarification,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  })
}

export async function loadSession(id: string): Promise<SessionState | null> {
  const r = await getPool().query<SessionRow>(`SELECT * FROM sessions WHERE id = $1`, [id])
  return r.rows[0] ? rowToState(r.rows[0]) : null
}

export async function listSessionsForUser(userId: string, limit = 50): Promise<SessionState[]> {
  const r = await getPool().query<SessionRow>(
    `SELECT * FROM sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [userId, limit],
  )
  return r.rows.map(rowToState)
}

export async function upsertSession(state: SessionState): Promise<void> {
  await getPool().query(
    `INSERT INTO sessions (
       id, user_id, title, brief, messages, current_plan, current_score,
       status, iteration_count, last_run_id, pending_clarification,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
       $8, $9, $10, $11, to_timestamp($12/1000.0), to_timestamp($13/1000.0)
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       brief = EXCLUDED.brief,
       messages = EXCLUDED.messages,
       current_plan = EXCLUDED.current_plan,
       current_score = EXCLUDED.current_score,
       status = EXCLUDED.status,
       iteration_count = EXCLUDED.iteration_count,
       last_run_id = EXCLUDED.last_run_id,
       pending_clarification = EXCLUDED.pending_clarification,
       updated_at = EXCLUDED.updated_at`,
    [
      state.id, state.userId, state.title,
      state.brief === null ? null : JSON.stringify(state.brief),
      JSON.stringify(state.messages),
      state.currentPlan === null ? null : JSON.stringify(state.currentPlan),
      state.currentScore === null ? null : JSON.stringify(state.currentScore),
      state.status, state.iterationCount, state.lastRunId, state.pendingClarification,
      state.createdAt, state.updatedAt,
    ],
  )
}

export async function deleteSession(id: string, userId: string): Promise<boolean> {
  const r = await getPool().query(
    `DELETE FROM sessions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return (r.rowCount ?? 0) > 0
}
```

- [ ] **Step 4: 不写真实 PG 集成测试（CI 没有 DB）**

只跑现有 build：
```bash
pnpm --filter @travel-agent/api build
```
Expected: 成功（注意：旧 `apps/api/src/routes/trips.ts` 此时还引用 `loadRestoreSnapshot/saveRestoreSnapshot`，会编译失败）。

- [ ] **Step 5: 临时桥接以保编译通过**

旧的 `trips.ts` 我们后面会删，但目前先桥接：在 `pg.ts` 末尾加：
```ts
// Backwards-compat shims for legacy routes/trips.ts; will be deleted in cleanup phase.
export async function loadRestoreSnapshot(_sessionId: string): Promise<unknown | null> { return null }
export async function saveRestoreSnapshot(_sessionId: string, payload: unknown): Promise<unknown> { return payload }
```

- [ ] **Step 6: 跑 build**

```bash
pnpm --filter @travel-agent/api build
```
Expected: 成功。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/persistence packages/memory-pg
git commit -m "refactor(api): rewrite persistence layer to single sessions table"
```

---

## Phase 3: ReAct agents（新文件，与旧 planner 并行）

### Task 10: Brief Extractor agent

**Files:**
- Create: `apps/api/src/agents/extractor.ts`
- Create: `apps/api/src/agents/extractor.test.ts`

- [ ] **Step 1: 写测试（mock LLM）**

`apps/api/src/agents/extractor.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: {
    chat: { completions: { create: vi.fn() } },
  },
  FAST_MODEL: 'fake-fast',
  PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
import { extractBrief } from './extractor.js'

describe('extractor', () => {
  it('parses destination and days from message', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destination: '北京', days: 3, travelers: 2 },
        intent: 'new', changedFields: ['destination','days','travelers'],
      })}}],
    })
    const res = await extractBrief([
      { role: 'user', content: '我想去北京玩 3 天，两个人', timestamp: 1 }
    ], null)
    expect(res.brief.destination).toBe('北京')
    expect(res.brief.days).toBe(3)
    expect(res.brief.travelers).toBe(2)
    expect(res.intent).toBe('new')
  })

  it('merges with existing brief', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        brief: { destination: '北京', days: 3, originCity: '上海' },
        intent: 'clarify-answer', changedFields: ['originCity'],
      })}}],
    })
    const res = await extractBrief(
      [{ role: 'user', content: '从上海出发', timestamp: 2 }],
      { destination: '北京', days: 3, travelers: 1, preferences: [] },
    )
    expect(res.brief.originCity).toBe('上海')
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test extractor
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/agents/extractor.ts**

```ts
import { z } from 'zod'
import { llm, FAST_MODEL } from '../llm/client.js'
import { TripBriefSchema, type TripBrief } from '@travel-agent/shared'
import type { Message } from '@travel-agent/shared'
import type OpenAI from 'openai'

const IntentEnum = z.enum(['new', 'refine', 'clarify-answer', 'continue'])
export type ExtractIntent = z.infer<typeof IntentEnum>

const ExtractorOutputSchema = z.object({
  brief: TripBriefSchema.partial(),
  intent: IntentEnum,
  changedFields: z.array(z.string()).default([]),
})
export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>

const SYSTEM_PROMPT = `你是旅行需求抽取器。读取用户对话历史和现有 TripBrief（可能为 null），抽取/合并出最新的 TripBrief，并判定本次消息的意图。

输出 JSON（仅输出一个对象，不要 markdown）：
{
  "brief": {
    "destination": "...", "days": 数字, "originCity": "...",
    "travelers": 数字, "preferences": ["..."], "pace": "relaxed|balanced|packed",
    "budget": { "amount": 数字, "currency": "CNY" },
    "travelDates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "notes": "..."
  },
  "intent": "new" | "refine" | "clarify-answer" | "continue",
  "changedFields": ["destination", ...]
}

意图判定规则：
- 用户说"去 X 玩 N 天"等首次描述行程 → "new"
- 用户回答之前问过的问题（如"从上海出发"）→ "clarify-answer"
- 用户在已有行程上说"换酒店"、"加一天" → "refine"
- 用户说"继续优化"、"再来一轮" → "continue"

合并规则：保留 existingBrief 里 user 没改的字段；user 改的字段以新值覆盖。`

export async function extractBrief(
  messages: Message[],
  existingBrief: TripBrief | null,
): Promise<{ brief: TripBrief; intent: ExtractIntent; changedFields: string[] }> {
  const userInput = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n')

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `existingBrief:\n${JSON.stringify(existingBrief)}\n\nuserMessages:\n${userInput}`,
    },
  ]

  const resp = await llm.chat.completions.create({
    model: FAST_MODEL,
    messages: llmMessages,
    temperature: 0,
    response_format: { type: 'json_object' },
  })

  const content = resp.choices[0]?.message?.content ?? '{}'
  const parsed = ExtractorOutputSchema.parse(JSON.parse(content))

  // Merge partial with existing, then strict-validate
  const merged = {
    ...(existingBrief ?? {}),
    ...parsed.brief,
    travelers: parsed.brief.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? existingBrief?.preferences ?? [],
    destination: parsed.brief.destination ?? existingBrief?.destination ?? '',
    days: parsed.brief.days ?? existingBrief?.days ?? 0,
  }
  const brief = TripBriefSchema.parse(merged)

  return { brief, intent: parsed.intent, changedFields: parsed.changedFields }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test extractor
```
Expected: 2 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/extractor.ts apps/api/src/agents/extractor.test.ts
git commit -m "feat(api): add brief extractor agent"
```

---

### Task 11: Critic agent (LLM)

**Files:**
- Create: `apps/api/src/agents/critic.ts`
- Create: `apps/api/src/agents/critic.test.ts`

- [ ] **Step 1: 写测试**

`apps/api/src/agents/critic.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: vi.fn() } } },
  FAST_MODEL: 'fake-fast', PLANNER_MODEL: 'fake-plan',
}))

import { llm } from '../llm/client.js'
import { criticReview } from './critic.js'
import type { Plan } from '@travel-agent/shared'

const samplePlan: Plan = {
  title: 'Beijing 3D', destination: '北京', days: 3, travelers: 1,
  pace: 'balanced', preferences: [], dailyPlans: [
    { day: 1, items: [{ type: 'transport', title: '高铁前往', description: '从上海乘高铁' }] },
    { day: 1, items: [] }, { day: 1, items: [] },
  ], tips: [], disclaimer: 'x',
}

describe('critic', () => {
  it('parses critic JSON', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        qualityScore: 60,
        blockers: [{ type: 'missing_origin', message: '请告诉我出发城市' }],
        itemIssues: [{ dayNum: 1, itemIndex: 0, severity: 'high',
          category: 'transport', problem: '缺车次号', suggestedAction: 'call_flyai_train' }],
        globalIssues: ['节奏过紧'],
      })}}],
    })
    const r = await criticReview(samplePlan, { destination: '北京', days: 3, travelers: 1, preferences: [] })
    expect(r.qualityScore).toBe(60)
    expect(r.blockers).toHaveLength(1)
    expect(r.itemIssues[0].suggestedAction).toBe('call_flyai_train')
  })

  it('gracefully degrades on bad JSON', async () => {
    ;(llm.chat.completions.create as any).mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    })
    const r = await criticReview(samplePlan, { destination: '北京', days: 3, travelers: 1, preferences: [] })
    expect(r.qualityScore).toBe(0)
    expect(r.blockers).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test critic
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/agents/critic.ts**

```ts
import { llm, FAST_MODEL } from '../llm/client.js'
import { CriticReportSchema, type CriticReport, type Plan, type TripBrief } from '@travel-agent/shared'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `你是旅行行程评审员。读取一份 Plan 和 TripBrief，按以下维度判断问题：

【blocker】（关键信息缺失，必须先问用户才能继续）：
- missing_origin：跨城旅行但缺出发城市
- missing_dates：缺具体日期但行程依赖（如查航班/酒店）
- missing_budget：用户未给预算且行程档次模糊
- unclear_preference：偏好（美食/文化/户外）模糊导致景点选择无依据
- other：其他必须澄清的关键信息

【itemIssue】（具体某一天某一项的问题）：
- transport 类：缺航班/车次号 → call_flyai_flight 或 call_flyai_train
- lodging 类：缺具体酒店/房型 → call_flyai_hotel
- attraction 类：描述空泛（缺开放时间/门票/时长）→ rewrite_description
- 重复或不合理 → replace_item
- 顺序不顺路 → reorder
severity: high (评分 < 50) | medium (50-79) | low (≥80)

【globalIssue】（全局问题）：景点重复、节奏失衡、主题割裂等。

输出 JSON（仅一个对象，无 markdown）：
{
  "qualityScore": 0-100,
  "blockers": [{ "type": "...", "message": "中文问句" }],
  "itemIssues": [{
    "dayNum": 数字, "itemIndex": 数字, "severity": "high|medium|low",
    "category": "transport|lodging|attraction|meal|coherence",
    "problem": "...", "suggestedAction": "...",
    "hints": { /* 可选：调 flyai 时的参数提示 */ }
  }],
  "globalIssues": ["..."]
}`

const FALLBACK: CriticReport = {
  qualityScore: 0, blockers: [], itemIssues: [], globalIssues: [],
}

export async function criticReview(plan: Plan, brief: TripBrief): Promise<CriticReport> {
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `TripBrief:\n${JSON.stringify(brief)}\n\nPlan:\n${JSON.stringify(plan)}`,
    },
  ]

  let resp
  try {
    resp = await llm.chat.completions.create({
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    })
  } catch (err) {
    console.warn('[Critic] LLM call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const raw = resp.choices[0]?.message?.content ?? '{}'
  try {
    return CriticReportSchema.parse(JSON.parse(raw))
  } catch (err) {
    console.warn('[Critic] Parse failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test critic
```
Expected: 2 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/critic.ts apps/api/src/agents/critic.test.ts
git commit -m "feat(api): add LLM critic agent"
```

---

### Task 12: Evaluator (rule + LLM 加权)

**Files:**
- Create: `apps/api/src/agents/evaluator.ts`
- Create: `apps/api/src/agents/evaluator.test.ts`

- [ ] **Step 1: 写测试**

`apps/api/src/agents/evaluator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('./critic.js', () => ({
  criticReview: vi.fn(),
}))

vi.mock('../config/eval.js', () => ({
  getEvalConfig: () => ({
    ruleWeight: 0.7, llmWeight: 0.3, threshold: 90, maxIter: 10,
    requiredCategories: ['transport', 'lodging', 'attraction'],
  }),
}))

import { evaluate } from './evaluator.js'
import { criticReview } from './critic.js'
import type { Plan, TripBrief } from '@travel-agent/shared'

const fullTransport = (s: number, n: number) => Array.from({ length: n }, () => ({
  time: '09:00', type: 'transport' as const, title: 'CA1234 北京大兴机场→上海浦东机场',
  description: '经济舱 ¥890，提前 2 小时到达办理值机和托运',
  tips: ['提前预订更便宜'],
}))

describe('evaluate', () => {
  it('combines rule and LLM scores', async () => {
    ;(criticReview as any).mockResolvedValue({
      qualityScore: 50, blockers: [], itemIssues: [], globalIssues: [],
    })
    const plan: Plan = {
      title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: fullTransport(100, 1) }],
      tips: [], disclaimer: 'x',
    }
    const brief: TripBrief = { destination: 'd', days: 1, travelers: 1, preferences: [] }
    const r = await evaluate(plan, brief)
    // ruleScore.transport.score = 100, ruleScore.overall depends on coverage too
    // combined.transport = 100 (no LLM per-cat); use rule only for cats
    expect(r.combined.transport).toBe(100)
    expect(r.llmScore).toBe(50)
    // overall = 0.7 * ruleScore.overall + 0.3 * 50
  })

  it('marks converged when all required cats >= 90 by rule', async () => {
    ;(criticReview as any).mockResolvedValue({
      qualityScore: 0, blockers: [], itemIssues: [], globalIssues: [],
    })
    const plan: Plan = {
      title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [
        ...fullTransport(100, 1),
        { type: 'lodging', title: '北京饭店 大床房', description: '入住 14:00 后，每晚 ¥800，地址：王府井大街 33 号，含早餐', estimatedCost: { amount: 800, currency: 'CNY' } },
        { type: 'attraction', title: '故宫博物院', description: '开放时间 08:30-17:00，门票 ¥60/人，建议游览 3 小时，明清两代皇宫，必看', tips: ['提前预约'] },
        { type: 'attraction', title: '天安门', description: '开放时间 05:00-22:00，免费开放，建议游览 1 小时，世界最大城市广场之一，地标', tips: ['人多'] },
      ] }],
      tips: [], disclaimer: 'x',
    }
    const brief: TripBrief = { destination: 'd', days: 1, travelers: 1, preferences: [] }
    const r = await evaluate(plan, brief)
    expect(r.converged).toBe(true)
  })

  it('passes blockers from critic', async () => {
    ;(criticReview as any).mockResolvedValue({
      qualityScore: 60, blockers: [{ type: 'missing_origin', message: '?' }],
      itemIssues: [], globalIssues: [],
    })
    const plan: Plan = {
      title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x',
    }
    const r = await evaluate(plan, { destination: 'd', days: 1, travelers: 1, preferences: [] })
    expect(r.blockers).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test evaluator
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/agents/evaluator.ts**

```ts
import { scorePlan, isConverged, type Plan, type TripBrief, type EvaluationReport } from '@travel-agent/shared'
import { criticReview } from './critic.js'
import { getEvalConfig } from '../config/eval.js'

export async function evaluate(plan: Plan, brief: TripBrief): Promise<EvaluationReport> {
  const cfg = getEvalConfig()
  const ruleScore = scorePlan(plan)
  const critic = await criticReview(plan, brief)
  const llmScore = critic.qualityScore

  const overallCombined = Math.round(cfg.ruleWeight * ruleScore.overall + cfg.llmWeight * llmScore)

  const combined = {
    overall: overallCombined,
    transport: ruleScore.transport.score,
    lodging: ruleScore.lodging.score,
    attraction: ruleScore.attraction.score,
  }

  // 收敛判据：用 rule 分（可重现可调试）
  const converged = isConverged(ruleScore, cfg.threshold) &&
    cfg.requiredCategories.every((cat) => ruleScore[cat].score !== null)

  return {
    ruleScore, llmScore, combined,
    blockers: critic.blockers,
    itemIssues: critic.itemIssues,
    globalIssues: critic.globalIssues,
    converged,
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test evaluator
```
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/evaluator.ts apps/api/src/agents/evaluator.test.ts
git commit -m "feat(api): add evaluator combining rule and LLM scores"
```

---

### Task 13: Generator agent（initial 流式 + refine 一次性）

**Files:**
- Create: `apps/api/src/agents/generator.ts`
- Create: `apps/api/src/agents/generator.test.ts`

- [ ] **Step 1: 写测试（覆盖 prompt 拼接和 plan 解析）**

`apps/api/src/agents/generator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const createMock = vi.fn()
vi.mock('../llm/client.js', () => ({
  llm: { chat: { completions: { create: createMock } } },
  FAST_MODEL: 'fake-fast', PLANNER_MODEL: 'fake-plan',
}))

vi.mock('../registry/skill-registry.js', () => ({
  skillRegistry: {
    list: () => [{
      name: 'flyai', version: '1', description: 'flight/hotel',
      parameters: { command: { type: 'string', description: 'sub', required: true } },
    }],
    invoke: vi.fn(async () => '{"items":[]}'),
  },
}))

import { runRefine } from './generator.js'
import type { Plan, EvaluationReport, TripBrief } from '@travel-agent/shared'

describe('generator.runRefine', () => {
  it('returns improved plan from JSON output', async () => {
    const newPlan: Plan = {
      title: 't', destination: '北京', days: 1, travelers: 1, pace: 'balanced',
      preferences: [], dailyPlans: [{ day: 1, items: [
        { type: 'transport', title: 'CA1234' },
      ] }], tips: [], disclaimer: 'x',
    }
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n' + JSON.stringify(newPlan) + '\n```', tool_calls: [] } }],
    })
    const original: Plan = { ...newPlan, dailyPlans: [{ day: 1, items: [] }] }
    const report: EvaluationReport = {
      ruleScore: { overall: 0, grade: 'poor', transport: { score: 0, count: 0, items: [], grade: 'poor' },
        lodging: { score: null, count: 0, items: [], grade: 'none' },
        attraction: { score: null, count: 0, items: [], grade: 'none' },
        meal: { score: null, count: 0, items: [], grade: 'none' },
        coverage: { score: 0, daysWithTransport: 0, daysWithLodging: 0, daysWithAttractions: 0, totalDays: 1 },
        suggestions: [] },
      llmScore: 0,
      combined: { overall: 0, transport: 0, lodging: null, attraction: null },
      blockers: [], itemIssues: [], globalIssues: [], converged: false,
    }
    const brief: TripBrief = { destination: '北京', days: 1, travelers: 1, preferences: [] }
    const out = await runRefine(original, report, brief)
    expect(out.dailyPlans[0].items).toHaveLength(1)
    expect(out.dailyPlans[0].items[0].title).toBe('CA1234')
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test generator
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/agents/generator.ts**

```ts
import { randomUUID } from 'crypto'
import { llm, PLANNER_MODEL } from '../llm/client.js'
import { skillRegistry } from '../registry/skill-registry.js'
import { PlanSchema, type Plan, type Message, type ChatStreamEvent, type EvaluationReport, type TripBrief } from '@travel-agent/shared'
import type OpenAI from 'openai'
import type { SkillManifest } from '../registry/types.js'

const MAX_SKILL_ROUNDS = 4

const SYSTEM_PROMPT_INITIAL = `你是专业旅行规划师。基于 TripBrief 和对话生成完整 JSON 行程。

要求：
- 信息充足：先用 1-2 句自然语言告诉用户你在规划，然后另起一行输出 \`\`\`json 代码块
- 信息不足：只用自然语言追问，不输出 JSON
- 行程每天至少 3 个活动，包括交通/住宿/景点
- 跨城交通：必须调用 flyai skill，传 command="search-flight" 或 "search-train" + origin + destination + depDate
- 住宿：必须调用 flyai skill 传 command="search-hotel" + destName + checkInDate + checkOutDate
- POI / 景点：可以调 flyai 传 command="search-poi"
- 拿到 flyai 真实结果后，把航班号/酒店名/房型/价格 直接写到对应 PlanItem 的 description
- 景点 description 必须包含：开放时间(09:00-17:00 或全天)、门票(¥60/人 或 免费)、建议游览时长(2 小时)
- 输出 JSON 严格符合 PlanSchema：title/destination/days/travelers/pace/dailyPlans/estimatedBudget/tips/disclaimer
`

const SYSTEM_PROMPT_REFINE = `你是旅行行程修补师。根据 critic 报告，**只修补**问题项，**不要重写整个行程**。

要求：
- 输入是当前行程和评估报告
- 对每个 itemIssue：
  - suggestedAction = call_flyai_flight/train/hotel/poi → 调用 flyai skill 拿真实数据，再改 description
  - rewrite_description → 直接重写该 item.description（补开放时间/门票/时长 等）
  - replace_item → 替换为更合理的 item
  - reorder → 调整顺序
- 对 globalIssues：在合理范围内调整（如换景点）
- 输出**完整 plan JSON**（保留未改的部分），仅一个 \`\`\`json 代码块
`

function buildSkillTools(): OpenAI.Chat.ChatCompletionTool[] {
  return skillRegistry.list().map((m: SkillManifest) => ({
    type: 'function',
    function: {
      name: m.name,
      description: m.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(m.parameters ?? {}).map(([k, p]) =>
          [k, { type: p.type, description: p.description }])),
        required: Object.entries(m.parameters ?? {}).filter(([, p]) => p.required).map(([k]) => k),
        additionalProperties: false,
      },
    },
  }))
}

function extractJsonCodeBlock(content: string): string | null {
  const m = content.match(/```json\s*([\s\S]*?)\s*```/)
  return m?.[1] ?? null
}

async function runWithToolLoop(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[],
): Promise<{ content: string; messages: OpenAI.Chat.ChatCompletionMessageParam[] }> {
  let current = [...messages]
  for (let i = 0; i < MAX_SKILL_ROUNDS; i++) {
    const resp = await llm.chat.completions.create({
      model: PLANNER_MODEL, messages: current, tools, tool_choice: 'auto',
      temperature: 0.3, stream: false,
    })
    const msg = resp.choices[0]?.message
    if (!msg) return { content: '', messages: current }
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) return { content: typeof msg.content === 'string' ? msg.content : '', messages: current }
    current.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
    for (const c of calls) {
      let out: string
      try {
        const args = c.function.arguments ? JSON.parse(c.function.arguments) : {}
        out = await skillRegistry.invoke(c.function.name, args as Record<string, unknown>)
      } catch (err) {
        out = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }
      current.push({ role: 'tool', tool_call_id: c.id, content: out })
    }
  }
  return { content: '', messages: current }
}

export async function* runInitial(
  brief: TripBrief, messages: Message[],
): AsyncGenerator<ChatStreamEvent, Plan | null, void> {
  const messageId = randomUUID()
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT_INITIAL },
    { role: 'user', content: `TripBrief:\n${JSON.stringify(brief)}` },
    ...messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
      role: m.role as 'user' | 'assistant', content: m.content,
    })),
  ]

  const tools = buildSkillTools()

  // Phase A: tool round (non-streaming) to gather real flyai data
  const prepared = await runWithToolLoop(llmMessages, tools)

  // Phase B: stream final NL + JSON
  const stream = await llm.chat.completions.create({
    model: PLANNER_MODEL,
    messages: [...prepared.messages, { role: 'system', content: '现在请基于上述 tool 结果生成最终行程，输出 NL + ```json 代码块。' }],
    tools, tool_choice: 'none',
    stream: true, stream_options: { include_usage: true }, temperature: 0.7,
  })

  let full = ''
  let nlBuf = ''
  let inJson = false
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (!delta) continue
    full += delta
    if (!inJson) {
      nlBuf += delta
      const start = nlBuf.indexOf('```json')
      if (start !== -1) {
        inJson = true
        const nlPart = nlBuf.slice(0, start).trimEnd()
        if (nlPart) yield { type: 'token', delta: nlPart }
        nlBuf = ''
      } else {
        const safe = nlBuf.length > 7 ? nlBuf.length - 7 : 0
        if (safe > 0) {
          yield { type: 'token', delta: nlBuf.slice(0, safe) }
          nlBuf = nlBuf.slice(safe)
        }
      }
    }
  }
  if (!inJson && nlBuf.trim()) yield { type: 'token', delta: nlBuf }

  const json = extractJsonCodeBlock(full)
  if (!json) {
    // No JSON → it's a clarification / refusal NL response
    yield { type: 'done', messageId }
    return null
  }
  try {
    const plan = PlanSchema.parse(JSON.parse(json))
    yield { type: 'plan', plan }
    yield { type: 'done', messageId }
    return plan
  } catch (err) {
    yield { type: 'error', code: 'PLAN_PARSE_FAILED', message: err instanceof Error ? err.message : String(err) }
    return null
  }
}

export async function runRefine(
  current: Plan, report: EvaluationReport, brief: TripBrief,
): Promise<Plan> {
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT_REFINE },
    { role: 'user', content: [
      `TripBrief:\n${JSON.stringify(brief)}`,
      `\nCurrentPlan:\n${JSON.stringify(current)}`,
      `\nEvaluationReport:\n${JSON.stringify({
        combined: report.combined,
        itemIssues: report.itemIssues,
        globalIssues: report.globalIssues,
      })}`,
    ].join('\n') },
  ]
  const tools = buildSkillTools()
  const prepared = await runWithToolLoop(llmMessages, tools)
  const json = extractJsonCodeBlock(prepared.content) ?? prepared.content
  try {
    return PlanSchema.parse(JSON.parse(json))
  } catch (err) {
    console.warn('[Generator.refine] Parse failed, returning original:', err)
    return current
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test generator
```
Expected: 1 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/generator.ts apps/api/src/agents/generator.test.ts
git commit -m "feat(api): add generator agent (initial stream + refine)"
```

---

### Task 14: ReAct loop orchestrator

**Files:**
- Create: `apps/api/src/agents/react-loop.ts`
- Create: `apps/api/src/agents/react-loop.test.ts`

- [ ] **Step 1: 写测试**

`apps/api/src/agents/react-loop.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('./extractor.js', () => ({ extractBrief: vi.fn() }))
vi.mock('./evaluator.js', () => ({ evaluate: vi.fn() }))
vi.mock('./generator.js', () => ({
  runInitial: vi.fn(),
  runRefine: vi.fn(),
}))
vi.mock('../config/eval.js', () => ({
  getEvalConfig: () => ({
    ruleWeight: 0.7, llmWeight: 0.3, threshold: 90, maxIter: 3,
    requiredCategories: ['transport','lodging','attraction'],
  }),
}))

import { runReactLoop } from './react-loop.js'
import { extractBrief } from './extractor.js'
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
import type { SessionState, Plan } from '@travel-agent/shared'

const samplePlan: Plan = {
  title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced',
  preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x',
}

function emptyReport(converged = false, blockers: any[] = []) {
  return {
    ruleScore: { overall: 80, grade: 'good',
      transport: { score: converged ? 95 : 80, count: 1, items: [], grade: 'good' },
      lodging: { score: converged ? 95 : 80, count: 1, items: [], grade: 'good' },
      attraction: { score: converged ? 95 : 80, count: 2, items: [], grade: 'good' },
      meal: { score: null, count: 0, items: [], grade: 'none' },
      coverage: { score: 80, daysWithTransport: 1, daysWithLodging: 1, daysWithAttractions: 1, totalDays: 1 },
      suggestions: [],
    },
    llmScore: 80,
    combined: { overall: 80, transport: converged ? 95 : 80, lodging: converged ? 95 : 80, attraction: converged ? 95 : 80 },
    blockers, itemIssues: [], globalIssues: [],
    converged,
  }
}

async function collect(gen: AsyncGenerator<any>) {
  const events: any[] = []
  for await (const e of gen) events.push(e)
  return events
}

describe('runReactLoop', () => {
  function baseSession(): SessionState {
    return {
      id: 's1', userId: 'u1', title: null, brief: null,
      messages: [{ role: 'user', content: '北京 3 天', timestamp: 1 }],
      currentPlan: null, currentScore: null, status: 'draft',
      iterationCount: 0, lastRunId: 'r1', pendingClarification: null,
      createdAt: 1, updatedAt: 1,
    }
  }

  it('clarify if extractor returns incomplete brief', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destination: '', days: 0, travelers: 1, preferences: [] },
      intent: 'new', changedFields: [],
    })
    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))
    expect(events.some((e) => e.type === 'clarify_needed')).toBe(true)
  })

  it('runs initial generation then converges immediately', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destination: 'd', days: 1, travelers: 1, preferences: [] },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () {
      yield { type: 'token', delta: '生成中' }
      yield { type: 'plan', plan: samplePlan }
      yield { type: 'done', messageId: 'm1' }
      return samplePlan
    })
    ;(evaluate as any).mockResolvedValue(emptyReport(true))
    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))
    expect(events.some((e) => e.type === 'plan')).toBe(true)
    expect(events.some((e) => e.type === 'score' && e.converged)).toBe(true)
    expect(session.status).toBe('converged')
  })

  it('hits max iter, emits max_iter_reached', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destination: 'd', days: 1, travelers: 1, preferences: [] },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () { yield { type: 'plan', plan: samplePlan }; return samplePlan })
    ;(evaluate as any).mockResolvedValue(emptyReport(false))
    ;(runRefine as any).mockResolvedValue(samplePlan)
    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))
    const last = events.findLast((e: any) => e.type === 'max_iter_reached')
    expect(last).toBeDefined()
    expect(session.status).toBe('awaiting_user')
  })

  it('aborts when runId mismatches', async () => {
    const session = baseSession()
    ;(extractBrief as any).mockResolvedValue({
      brief: { destination: 'd', days: 1, travelers: 1, preferences: [] },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () { yield { type: 'plan', plan: samplePlan }; return samplePlan })
    ;(evaluate as any).mockImplementation(async () => {
      session.lastRunId = 'r2'  // simulate concurrent new request
      return emptyReport(false)
    })
    const events = await collect(runReactLoop(session, 'r1'))
    expect(events.find((e: any) => e.type === 'plan')).toBeDefined()
    // After mismatch, refine should NOT run; max_iter_reached should NOT emit
    expect(events.find((e: any) => e.type === 'max_iter_reached')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test react-loop
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/agents/react-loop.ts**

```ts
import { randomUUID } from 'crypto'
import { extractBrief } from './extractor.js'
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
import { getEvalConfig } from '../config/eval.js'
import { isBriefMinimallyComplete, type SessionState, type ChatStreamEvent, type ItineraryScoreSummary } from '@travel-agent/shared'

function summarize(report: Awaited<ReturnType<typeof evaluate>>, iteration: number): ItineraryScoreSummary {
  return {
    overall: report.combined.overall,
    transport: report.combined.transport,
    lodging: report.combined.lodging,
    attraction: report.combined.attraction,
    iteration,
  }
}

function isCancelled(session: SessionState, runId: string): boolean {
  return session.lastRunId !== runId
}

export async function* runReactLoop(
  session: SessionState, runId: string,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const cfg = getEvalConfig()

  // Phase 0: Extract brief
  yield { type: 'agent_step', agent: 'extractor', status: 'thinking' }
  const ext = await extractBrief(session.messages, session.brief)
  session.brief = ext.brief

  if (!isBriefMinimallyComplete(ext.brief)) {
    session.status = 'awaiting_user'
    session.pendingClarification = !ext.brief.destination
      ? '请告诉我目的地是哪里？'
      : '请告诉我打算玩几天？'
    yield {
      type: 'clarify_needed',
      question: session.pendingClarification,
      reason: !ext.brief.destination ? 'missing_destination' : 'missing_days',
    }
    return
  }

  if (isCancelled(session, runId)) return

  // Phase 1: Initial (only if no current plan, or intent === 'new')
  if (!session.currentPlan || ext.intent === 'new') {
    session.status = 'planning'
    session.iterationCount = 0
    let initial = null as Awaited<ReturnType<ReturnType<typeof runInitial>['next']>>['value']
    const gen = runInitial(ext.brief, session.messages)
    while (true) {
      const r = await gen.next()
      if (r.value && typeof r.value === 'object' && 'type' in r.value) {
        yield r.value as ChatStreamEvent
      }
      if (r.done) { initial = r.value as any; break }
    }
    if (!initial) return  // clarification or error
    session.currentPlan = initial
    session.iterationCount = 1
  }

  // Phase 2: ReAct loop
  session.status = 'refining'
  while (session.iterationCount <= cfg.maxIter) {
    if (isCancelled(session, runId)) return

    yield { type: 'agent_step', agent: 'evaluator', status: 'evaluating' }
    const report = await evaluate(session.currentPlan!, ext.brief)
    if (isCancelled(session, runId)) return

    const summary = summarize(report, session.iterationCount)
    session.currentScore = summary
    yield {
      type: 'score',
      overall: summary.overall,
      transport: summary.transport,
      lodging: summary.lodging,
      attraction: summary.attraction,
      iteration: session.iterationCount,
      converged: report.converged,
    }

    if (report.blockers.length > 0) {
      const b = report.blockers[0]
      session.status = 'awaiting_user'
      session.pendingClarification = b.message
      yield { type: 'clarify_needed', question: b.message, reason: b.type }
      return
    }

    if (report.converged) {
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      return
    }

    if (session.iterationCount >= cfg.maxIter) {
      session.status = 'awaiting_user'
      yield {
        type: 'max_iter_reached',
        currentScore: summary.overall,
        plan: session.currentPlan!,
      }
      return
    }

    // Refine
    session.iterationCount++
    yield {
      type: 'iteration_progress',
      iteration: session.iterationCount,
      maxIterations: cfg.maxIter,
      currentScore: summary.overall,
      targetScore: cfg.threshold,
      status: 'refining',
    }
    yield { type: 'agent_step', agent: 'generator', status: 'refining' }
    const refined = await runRefine(session.currentPlan!, report, ext.brief)
    if (isCancelled(session, runId)) return
    session.currentPlan = refined
    yield { type: 'plan', plan: refined }
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test react-loop
```
Expected: 4 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/react-loop.ts apps/api/src/agents/react-loop.test.ts
git commit -m "feat(api): add ReAct loop orchestrator"
```

---

## Phase 4: 路由 + session 存储重写

### Task 15: 新 session store（内存 + DB 双写）

**Files:**
- Create: `apps/api/src/session/store.ts`
- Create: `apps/api/src/session/store.test.ts`

- [ ] **Step 1: 写测试（仅内存路径）**

`apps/api/src/session/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sessionStore } from './store.js'

describe('sessionStore (memory)', () => {
  it('creates and reads', async () => {
    const s = await sessionStore.create('user-1')
    const got = await sessionStore.get(s.id, 'user-1')
    expect(got?.id).toBe(s.id)
    expect(got?.userId).toBe('user-1')
    expect(got?.status).toBe('draft')
  })

  it('returns null when foreign user reads', async () => {
    const s = await sessionStore.create('user-2')
    const got = await sessionStore.get(s.id, 'other')
    expect(got).toBeNull()
  })

  it('appends messages', async () => {
    const s = await sessionStore.create('user-3')
    await sessionStore.appendMessage(s.id, { role: 'user', content: 'hi', timestamp: 1 })
    const got = await sessionStore.get(s.id, 'user-3')
    expect(got?.messages).toHaveLength(1)
  })

  it('lists by user, newest first', async () => {
    const a = await sessionStore.create('user-list')
    await new Promise((r) => setTimeout(r, 5))
    const b = await sessionStore.create('user-list')
    const list = await sessionStore.listByUser('user-list')
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test session/store
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/session/store.ts**

```ts
import { randomUUID } from 'crypto'
import { SessionStateSchema, type SessionState, type Message } from '@travel-agent/shared'
import {
  isDatabaseEnabled, loadSession, listSessionsForUser, upsertSession, deleteSession,
} from '../persistence/pg.js'

const memory = new Map<string, SessionState>()

function nowMs() { return Date.now() }

async function persist(state: SessionState): Promise<void> {
  memory.set(state.id, state)
  if (isDatabaseEnabled()) {
    try { await upsertSession(state) }
    catch (err) { console.error('[sessionStore] DB upsert failed:', err) }
  }
}

async function fetch(id: string): Promise<SessionState | null> {
  const cached = memory.get(id)
  if (cached) return cached
  if (!isDatabaseEnabled()) return null
  try {
    const loaded = await loadSession(id)
    if (loaded) memory.set(loaded.id, loaded)
    return loaded
  } catch (err) {
    console.error('[sessionStore] DB load failed:', err)
    return null
  }
}

export const sessionStore = {
  async create(userId: string): Promise<SessionState> {
    const state = SessionStateSchema.parse({
      id: randomUUID(), userId, status: 'draft',
      iterationCount: 0, createdAt: nowMs(), updatedAt: nowMs(),
    })
    await persist(state)
    return state
  },

  async get(id: string, userId: string): Promise<SessionState | null> {
    const s = await fetch(id)
    if (!s || s.userId !== userId) return null
    return s
  },

  async appendMessage(id: string, message: Message): Promise<SessionState | null> {
    const s = memory.get(id) ?? await fetch(id)
    if (!s) return null
    s.messages.push(message)
    s.updatedAt = nowMs()
    await persist(s)
    return s
  },

  async save(state: SessionState): Promise<void> {
    state.updatedAt = nowMs()
    await persist(state)
  },

  async listByUser(userId: string, limit = 50): Promise<SessionState[]> {
    if (isDatabaseEnabled()) {
      try { return await listSessionsForUser(userId, limit) }
      catch (err) { console.error('[sessionStore] DB list failed:', err) }
    }
    return Array.from(memory.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const s = await fetch(id)
    if (!s || s.userId !== userId) return false
    memory.delete(id)
    if (isDatabaseEnabled()) {
      try { return await deleteSession(id, userId) }
      catch (err) { console.error('[sessionStore] DB delete failed:', err); return true }
    }
    return true
  },

  async updateRunId(id: string): Promise<string | null> {
    const s = memory.get(id) ?? await fetch(id)
    if (!s) return null
    s.lastRunId = randomUUID()
    s.updatedAt = nowMs()
    await persist(s)
    return s.lastRunId
  },
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test session/store
```
Expected: 4 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/session/store.ts apps/api/src/session/store.test.ts
git commit -m "feat(api): add unified session store with memory+DB backing"
```

---

### Task 16: 新 sessions 路由

**Files:**
- Create: `apps/api/src/routes/sessions.ts`
- Create: `apps/api/src/routes/sessions.test.ts`

- [ ] **Step 1: 写测试（用 Hono 的 fetch 接口直接打）**

`apps/api/src/routes/sessions.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../auth/middleware.js', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('userId', 'u-test'); await next() },
}))
vi.mock('../agents/react-loop.js', () => ({
  runReactLoop: async function* () {
    yield { type: 'plan', plan: { title: 't', destination: 'd', days: 1, travelers: 1, pace: 'balanced', preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x' } }
    yield { type: 'done', messageId: 'm-1' }
  },
}))

import { sessionsRouter } from './sessions.js'

describe('sessions router', () => {
  it('POST /sessions creates a new session', async () => {
    const res = await sessionsRouter.fetch(new Request('http://x/sessions', { method: 'POST' }))
    const body = await res.json() as any
    expect(res.status).toBe(201)
    expect(body.session.userId).toBe('u-test')
    expect(body.session.status).toBe('draft')
  })

  it('GET /sessions lists user sessions', async () => {
    await sessionsRouter.fetch(new Request('http://x/sessions', { method: 'POST' }))
    const res = await sessionsRouter.fetch(new Request('http://x/sessions'))
    const body = await res.json() as any
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  it('GET /sessions/:id returns 404 when not found', async () => {
    const res = await sessionsRouter.fetch(new Request('http://x/sessions/no-such'))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试看失败**

```bash
pnpm --filter @travel-agent/api test routes/sessions
```
Expected: FAIL。

- [ ] **Step 3: 实现 apps/api/src/routes/sessions.ts**

```ts
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../auth/middleware.js'
import { sessionStore } from '../session/store.js'
import { runReactLoop } from '../agents/react-loop.js'
import type { ChatStreamEvent } from '@travel-agent/shared'

export const sessionsRouter = new Hono()
sessionsRouter.use('*', authMiddleware)

const SendMessageSchema = z.object({ content: z.string().min(1) })

function getUserId(c: any): string {
  const id = c.get('userId') as string | undefined
  if (!id) throw new Error('userId missing from context')
  return id
}

sessionsRouter.post('/', async (c) => {
  const userId = getUserId(c)
  const session = await sessionStore.create(userId)
  return c.json({ session }, 201)
})

sessionsRouter.get('/', async (c) => {
  const userId = getUserId(c)
  const sessions = await sessionStore.listByUser(userId)
  return c.json({ sessions })
})

sessionsRouter.get('/:id', async (c) => {
  const userId = getUserId(c)
  const session = await sessionStore.get(c.req.param('id'), userId)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json({ session })
})

sessionsRouter.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const ok = await sessionStore.delete(c.req.param('id'), userId)
  if (!ok) return c.json({ error: 'Session not found' }, 404)
  return c.json({ ok: true })
})

sessionsRouter.post('/:id/messages', zValidator('json', SendMessageSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const session = await sessionStore.get(id, userId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const { content } = c.req.valid('json')
  await sessionStore.appendMessage(id, { role: 'user', content, timestamp: Date.now() })
  const runId = await sessionStore.updateRunId(id)
  if (!runId) return c.json({ error: 'Session vanished' }, 500)

  const fresh = await sessionStore.get(id, userId)
  if (!fresh) return c.json({ error: 'Session vanished' }, 500)

  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    let assistantContent = ''
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      for await (const ev of runReactLoop(fresh, runId)) {
        await send(ev)
        if (ev.type === 'token') assistantContent += ev.delta
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
    } finally {
      if (assistantContent) {
        await sessionStore.appendMessage(id, {
          role: 'assistant', content: assistantContent, timestamp: Date.now(),
        })
      }
      await sessionStore.save(fresh)
    }
  })
})

sessionsRouter.post('/:id/continue', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const session = await sessionStore.get(id, userId)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  if (session.status !== 'awaiting_user') {
    return c.json({ error: 'Session not in awaiting_user state' }, 409)
  }

  // Reset iteration counter to allow another batch of EVAL_MAX_ITER rounds
  session.iterationCount = 0
  session.status = 'refining'
  await sessionStore.save(session)
  const runId = await sessionStore.updateRunId(id)
  if (!runId) return c.json({ error: 'Session vanished' }, 500)
  const fresh = await sessionStore.get(id, userId)
  if (!fresh) return c.json({ error: 'Session vanished' }, 500)

  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      for await (const ev of runReactLoop(fresh, runId)) await send(ev)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
    } finally {
      await sessionStore.save(fresh)
    }
  })
})
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter @travel-agent/api test routes/sessions
```
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sessions.ts apps/api/src/routes/sessions.test.ts
git commit -m "feat(api): add unified sessions router with SSE messages endpoint"
```

---

### Task 17: 把新路由挂到 index.ts，registry 路由保留只读

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/registry.ts`

- [ ] **Step 1: 改 routes/registry.ts**

Read 现有内容，删除 DELETE 端点，只保留 GET。完整文件：
```ts
import { Hono } from 'hono'
import { skillRegistry } from '../registry/skill-registry.js'
import { agentRegistry } from '../registry/agent-registry.js'

export const registryRouter = new Hono()

registryRouter.get('/skills', (c) => c.json({ skills: skillRegistry.list() }))
registryRouter.get('/agents', (c) => c.json({ agents: agentRegistry.list() }))
```

- [ ] **Step 2: 改 apps/api/src/index.ts**

把 chatRouter / tripsRouter import 删掉，改挂 sessionsRouter。完整新文件：
```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { assertAuthConfig } from './auth/config.js'
import { authRouter } from './routes/auth.js'
import { sessionsRouter } from './routes/sessions.js'
import { registryRouter } from './routes/registry.js'
import { runDatabaseMigrations } from './persistence/pg.js'
import { bootstrapRegistry } from './registry/bootstrap.js'

const app = new Hono()
const configuredCorsOrigin = process.env.CORS_ORIGIN

function resolveCorsOrigin(origin?: string) {
  if (!origin) return configuredCorsOrigin ?? 'http://localhost:3000'
  if (configuredCorsOrigin && origin === configuredCorsOrigin) return origin
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin
  return configuredCorsOrigin ?? 'http://localhost:3000'
}

app.use('*', logger())
app.use('*', cors({
  origin: (origin) => resolveCorsOrigin(origin),
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

app.route('/api', authRouter)
app.route('/api/sessions', sessionsRouter)
app.route('/api/registry', registryRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

assertAuthConfig()
bootstrapRegistry()
await runDatabaseMigrations()

const port = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001', 10)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 API server running at http://localhost:${info.port}`)
})

export default app
```

注意：authMiddleware 在 sessionsRouter 内部已挂，不再全局挂。`/api/registry` 是否要 auth？根据原设计是要的，但 registry 是查 skill/agent，公开看也无妨。这里**保持不需要 auth**（运维查看）。

- [ ] **Step 3: 跑 build 验证**

```bash
pnpm --filter @travel-agent/api build
```
Expected: 成功（旧 routes/chat、trips 此时还在但没被 import，不影响 build）。

- [ ] **Step 4: 启动 dev 验证 health**

```bash
pnpm dev:api &
sleep 4
curl -s http://localhost:3001/health
kill %1
```
Expected: `{"status":"ok"}`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/routes/registry.ts
git commit -m "feat(api): mount sessions router, drop /api/chat and /api/trips wiring"
```

---

## Phase 5: 前端切换

### Task 18: 重写 useChatStream 用新接口

**Files:**
- Rewrite: `apps/web/composables/useChatStream.ts`

- [ ] **Step 1: 看现状**

```bash
cat apps/web/composables/useChatStream.ts
```

- [ ] **Step 2: 重写完整文件**

完整新内容：
```ts
import { useApiBase } from './useApiBase'
import type { ChatStreamEvent } from '@travel-agent/shared'

export interface ChatStreamHandlers {
  onEvent: (event: ChatStreamEvent) => void
  onClose?: () => void
  onError?: (err: unknown) => void
}

export interface ChatStreamSession {
  ensureSessionId: () => Promise<string>
  sendMessage: (content: string, handlers: ChatStreamHandlers) => Promise<void>
  continueOptimization: (handlers: ChatStreamHandlers) => Promise<void>
  setSessionId: (id: string | null) => void
  getSessionId: () => string | null
}

export function useChatStream(initialSessionId: string | null = null): ChatStreamSession {
  const apiBase = useApiBase()
  let sessionId: string | null = initialSessionId

  async function createSession(): Promise<string> {
    const r = await fetch(`${apiBase}/sessions`, {
      method: 'POST', credentials: 'include',
    })
    if (!r.ok) throw new Error(`Create session failed: ${r.status}`)
    const body = await r.json() as { session: { id: string } }
    sessionId = body.session.id
    return sessionId
  }

  async function ensureSessionId(): Promise<string> {
    return sessionId ?? await createSession()
  }

  async function streamRequest(url: string, init: RequestInit, handlers: ChatStreamHandlers) {
    let resp: Response
    try {
      resp = await fetch(url, { ...init, credentials: 'include' })
    } catch (err) { handlers.onError?.(err); return }
    if (!resp.ok || !resp.body) {
      handlers.onError?.(new Error(`HTTP ${resp.status}`))
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const json = dataLine.slice(5).trim()
          try {
            handlers.onEvent(JSON.parse(json) as ChatStreamEvent)
          } catch (err) { console.warn('[chatStream] parse failed', err) }
        }
      }
      handlers.onClose?.()
    } catch (err) { handlers.onError?.(err) }
  }

  async function sendMessage(content: string, handlers: ChatStreamHandlers) {
    const id = await ensureSessionId()
    await streamRequest(`${apiBase}/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }, handlers)
  }

  async function continueOptimization(handlers: ChatStreamHandlers) {
    const id = await ensureSessionId()
    await streamRequest(`${apiBase}/sessions/${id}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, handlers)
  }

  return {
    ensureSessionId, sendMessage, continueOptimization,
    setSessionId: (id) => { sessionId = id },
    getSessionId: () => sessionId,
  }
}
```

- [ ] **Step 3: build 验证**

```bash
pnpm --filter @travel-agent/web build
```

注意：由于 `usePlannerApi` 还存在但已不被新 chat 路径使用，`workspace.ts` 也还在用旧的，预期会有 lint 警告但不应破坏 build。如果 build fail 是因 `usePlannerApi` 引入的 schema 不存在，先临时删 `usePlannerApi.ts` 内容（next task 会彻底删）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/composables/useChatStream.ts
git commit -m "feat(web): rewrite chat stream client to use unified sessions API"
```

---

### Task 19: 简化 chat store 加 ReAct 状态字段

**Files:**
- Modify: `apps/web/stores/chat.ts`

- [ ] **Step 1: 看现状**

```bash
cat apps/web/stores/chat.ts
```

- [ ] **Step 2: 给 state 加新字段（仅 ReAct 瞬态 UI 字段；plan/score 主体由 workspace 持有）**

在 state 部分添加：
```ts
iteration: 0,
maxIterations: 10,
displayScore: null as number | null,    // 进度环展示用，与 workspace.currentScore 同步
targetScore: 90,
loopStatus: null as 'evaluating' | 'refining' | null,
awaitingClarify: null as { question: string; reason: string } | null,
maxIterReached: null as { currentScore: number } | null,
canContinue: false,
```

新增 action `handleStreamEvent(event: ChatStreamEvent)` —— 涉及 plan/score 的部分通过 workspace store 写入：
```ts
import type { ChatStreamEvent, ItineraryScoreSummary } from '@travel-agent/shared'
import { useWorkspaceStore } from './workspace'

// in actions:
handleStreamEvent(event: ChatStreamEvent) {
  const ws = useWorkspaceStore()
  switch (event.type) {
    case 'session':
      ws.sessionId = event.sessionId
      break
    case 'iteration_progress':
      this.iteration = event.iteration
      this.maxIterations = event.maxIterations
      this.displayScore = event.currentScore
      this.targetScore = event.targetScore
      this.loopStatus = event.status
      break
    case 'score': {
      const summary: ItineraryScoreSummary = {
        overall: event.overall,
        transport: event.transport,
        lodging: event.lodging,
        attraction: event.attraction,
        iteration: event.iteration,
      }
      ws.currentScore = summary
      this.displayScore = event.overall
      break
    }
    case 'plan':
      ws.currentPlan = event.plan
      this.awaitingClarify = null
      this.maxIterReached = null
      break
    case 'clarify_needed':
      this.awaitingClarify = { question: event.question, reason: event.reason }
      this.canContinue = false
      ws.status = 'awaiting_user'
      break
    case 'max_iter_reached':
      this.maxIterReached = { currentScore: event.currentScore }
      this.canContinue = true
      ws.status = 'awaiting_user'
      break
    case 'done':
      this.loopStatus = null
      if (event.converged) {
        this.canContinue = false
        ws.status = 'converged'
      }
      break
  }
}
```

- [ ] **Step 3: build 验证**

```bash
pnpm --filter @travel-agent/web build
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/stores/chat.ts
git commit -m "feat(web): add ReAct loop state to chat store"
```

---

### Task 20: 简化 workspace store（砍掉多版本）

**Files:**
- Modify: `apps/web/stores/workspace.ts`

- [ ] **Step 1: 看现状的 state**

```bash
cat apps/web/stores/workspace.ts | head -80
```

- [ ] **Step 2: 删除多方案字段，只保留 session 上下文**

新 state：
```ts
state: () => ({
  sessionId: null as string | null,
  brief: null as TripBrief | null,
  currentPlan: null as Plan | null,
  currentScore: null as ItineraryScoreSummary | null,
  status: 'draft' as SessionStatus,
}),
```

砍掉的字段：`activePlanVersionId`, `briefRevisionNo`, `planOptions`, `activePlanOptionId`, `activePlanType`, `guideHighlights`, `lastUserIntent`, `restoreSource`, `title`。

砍掉的 actions：`applyPlannerResponse`, `seedFromLegacyPlan`, `setActivePlanOption`, `setActiveVersion`, `buildSessionRestorePayload`, `shouldSyncSessionPayload`。

新 actions：`hydrateFromSession(session: SessionState)`, `reset()`。

- [ ] **Step 3: 检查并改 hydrateFromSessionStorage 兼容（可选，可直接删）**

`persistState` / `hydrateFromSessionStorage` 改为只持久化 `sessionId`：
```ts
persistState() {
  if (this.sessionId) sessionStorage.setItem('ta_sessionId', this.sessionId)
},
hydrateFromSessionStorage() {
  this.sessionId = sessionStorage.getItem('ta_sessionId')
},
```

- [ ] **Step 4: 找消费者**

```bash
grep -rn "useWorkspaceStore" apps/web/ | grep -v node_modules
```

每个使用旧字段（`planOptions` / `activePlanOptionId` 等）的组件，都要改成只读 `currentPlan`。可能涉及：
- `apps/web/pages/index.vue`
- `apps/web/components/PlanningPreview.vue`
- `apps/web/components/HeroPlannerCard.vue`

修改原则：把所有 `workspace.planOptions[active].plan` 替换为 `workspace.currentPlan`。

- [ ] **Step 5: build 验证**

```bash
pnpm --filter @travel-agent/web build
```
Expected: 成功（如失败按报错逐个修组件 reference）。

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "refactor(web): simplify workspace store, drop multi-plan options"
```

---

### Task 21: pages/index.vue 加进度条 + 继续按钮

**Files:**
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: 看现状**

```bash
sed -n '1,80p' apps/web/pages/index.vue
```

- [ ] **Step 2: 在 ChatPanel 区域上方插入进度组件**

Pseudocode 改动 (按现有结构调整):
```vue
<template>
  <!-- ... -->

  <!-- ReAct progress bar -->
  <div v-if="chat.loopStatus" class="react-progress">
    <span>{{ chat.loopStatus === 'evaluating' ? 'AI 正在评估...' : `第 ${chat.iteration} / ${chat.maxIterations} 轮优化中` }}</span>
    <span v-if="chat.displayScore !== null">
      {{ chat.displayScore }} / {{ chat.targetScore }}
    </span>
    <progress :value="chat.displayScore ?? 0" :max="chat.targetScore"></progress>
  </div>

  <!-- Clarify question -->
  <div v-if="chat.awaitingClarify" class="clarify-card">
    <p>{{ chat.awaitingClarify.question }}</p>
  </div>

  <!-- Continue button -->
  <div v-if="chat.canContinue && chat.maxIterReached" class="continue-card">
    <p>已优化 10 轮，当前 {{ chat.maxIterReached.currentScore }} 分（目标 90）</p>
    <button @click="onContinue">继续优化</button>
  </div>

  <!-- ... existing ChatPanel etc ... -->
</template>

<script setup lang="ts">
import { useChatStore } from '~/stores/chat'
import { useWorkspaceStore } from '~/stores/workspace'
import { useChatStream } from '~/composables/useChatStream'

const chat = useChatStore()
const workspace = useWorkspaceStore()
const stream = useChatStream(workspace.sessionId)

async function onContinue() {
  await stream.continueOptimization({
    onEvent: (e) => chat.handleStreamEvent(e),
  })
}
</script>

<style scoped>
.react-progress { padding: 12px; background: var(--bg-elevated); border-radius: 8px; margin-bottom: 12px; }
.react-progress progress { width: 100%; }
.clarify-card { background: #fff8e1; padding: 12px; border-radius: 8px; margin: 8px 0; }
.continue-card button { background: var(--brand-purple); color: white; padding: 8px 16px; border-radius: 6px; }
</style>
```

注意：实际改动要根据现有 `pages/index.vue` 的结构嵌入到合适位置；以上是骨架。如果现有 chat 调用是通过 ChatPanel emit，可在 setup 里挂同样的 handler。

- [ ] **Step 3: build + dev 启动验证**

```bash
pnpm --filter @travel-agent/web build
pnpm dev &
sleep 8
echo "在浏览器打开 http://localhost:3000 用真实账号登录后发起一次规划，观察："
echo " - 初版生成（流式 NL + plan）"
echo " - 评分面板出现，分数数字会变"
echo " - 进度条显示 'N / 10 轮优化中'"
echo " - 收敛或 10 轮终止"
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web): add ReAct progress, clarify, and continue UI"
```

---

## Phase 6: 清理旧代码

### Task 22: 删除老 API 文件

**Files:**
- Delete: `apps/api/src/routes/chat.ts`
- Delete: `apps/api/src/routes/trips.ts`
- Delete: `apps/api/src/routes/collab.ts`
- Delete: `apps/api/src/collab/` (整个目录)
- Delete: `apps/api/src/agents/planner.ts`
- Delete: `apps/api/src/session/index.ts`
- Modify: `apps/api/src/persistence/pg.ts` (删除桥接 shim)

- [ ] **Step 1: 全文 grep 确认这些文件无引用**

```bash
cd /Users/bill/travel-agent
grep -rn "from.*routes/chat" apps/api/src/ packages/
grep -rn "from.*routes/trips" apps/api/src/ packages/
grep -rn "from.*routes/collab" apps/api/src/ packages/
grep -rn "from.*agents/planner" apps/api/src/ packages/
grep -rn "from.*session/index" apps/api/src/ packages/
grep -rn "loadRestoreSnapshot\|saveRestoreSnapshot" apps/api/src/
```
Expected: 0 hit（如有 hit 必须先改）。

- [ ] **Step 2: 物理删除**

```bash
rm apps/api/src/routes/chat.ts
rm apps/api/src/routes/trips.ts
rm apps/api/src/routes/collab.ts
rm -rf apps/api/src/collab
rm apps/api/src/agents/planner.ts
rm apps/api/src/session/index.ts
```

- [ ] **Step 3: 删 pg.ts 末尾的桥接 shim**

打开 `apps/api/src/persistence/pg.ts`，删除：
```ts
// Backwards-compat shims for legacy routes/trips.ts; will be deleted in cleanup phase.
export async function loadRestoreSnapshot(_sessionId: string): Promise<unknown | null> { return null }
export async function saveRestoreSnapshot(_sessionId: string, payload: unknown): Promise<unknown> { return payload }
```

- [ ] **Step 4: build 验证**

```bash
pnpm --filter @travel-agent/api build
```
Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "chore(api): remove legacy chat/trips/collab routes and old planner"
```

---

### Task 23: 删除前端 usePlannerApi

**Files:**
- Delete: `apps/web/composables/usePlannerApi.ts`
- Modify: 任何 import 它的文件

- [ ] **Step 1: 找引用**

```bash
grep -rn "usePlannerApi" apps/web/ | grep -v node_modules
```

- [ ] **Step 2: 移除引用**

任何 `import { usePlannerApi } from '~/composables/usePlannerApi'` 都改为：
- 如果该处需要发消息：用 `useChatStream` 的 `sendMessage`
- 如果该处需要加载 session：用 `fetch(\`${useApiBase()}/sessions/\${id}\`)`

- [ ] **Step 3: 删除文件**

```bash
rm apps/web/composables/usePlannerApi.ts
```

- [ ] **Step 4: build 验证**

```bash
pnpm --filter @travel-agent/web build
```

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "chore(web): remove legacy usePlannerApi"
```

---

### Task 24: 删除 packages/domain 整包

**Files:**
- Delete: `packages/domain/` 整包
- Modify: `packages/memory-pg/` 如果引用了 domain
- Modify: `apps/api/package.json`、`apps/web/package.json`、`pnpm-workspace.yaml` 等

- [ ] **Step 1: 找所有 domain 引用**

```bash
grep -rn "@travel-agent/domain" apps/ packages/ --include="*.ts" --include="*.vue" --include="package.json" | grep -v node_modules
```
Expected: 应该已经没有运行时代码引用（只剩 package.json 的 dependency 声明）。如有运行时引用，需要先迁移类型到 shared。

- [ ] **Step 2: 删 dependencies**

```bash
pnpm remove --filter @travel-agent/api @travel-agent/domain || true
pnpm remove --filter @travel-agent/web @travel-agent/domain || true
pnpm remove --filter @travel-agent/memory-pg @travel-agent/domain || true
```

- [ ] **Step 3: 删包**

```bash
rm -rf packages/domain
```

- [ ] **Step 4: 跑 pnpm install 重建 lockfile**

```bash
pnpm install
```

- [ ] **Step 5: build 全栈验证**

```bash
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete @travel-agent/domain package"
```

---

### Task 25: 端到端冒烟测试 + 最终验收

**Files:**
- 无新文件，纯验证

- [ ] **Step 1: 启动 API + web**

```bash
pnpm dev
```

- [ ] **Step 2: 验证未登录跳转**

打开浏览器无痕访问 `http://localhost:3000` → Expected: 自动跳 `/login`（如未跳，确认 `apps/web/middleware/auth.global.ts` 是否存在，如无则用 `apps/web/middleware/` 加一个：
```ts
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const auth = useAuthStore()
  await auth.refresh()
  if (!auth.user) return navigateTo('/login')
})
```
）

- [ ] **Step 3: 完整流程测试**

登录后，输入：
> 我想去北京玩 3 天，从上海出发，2 个人

验证：
- [ ] 流式输出 NL + plan
- [ ] 出现 score 面板
- [ ] 出现 "1 / 10 轮优化中" 进度
- [ ] 浏览器 Network 看到至少 2 次 plan 事件（说明在迭代）
- [ ] 多轮后要么收敛（converged: true），要么 10 轮后弹 "继续优化" 按钮

- [ ] **Step 4: 验证 clarify 流**

新会话输入：
> 我想去玩

预期：
- [ ] 出现 clarify_needed 事件
- [ ] 前端显示问句"请告诉我目的地是哪里？"

- [ ] **Step 5: 验证 continue**

如果第 3 步 10 轮未收敛，点"继续优化" → 验证 SSE 又开了一次，并且 iteration 重置为 1。

- [ ] **Step 6: 验证 history**

刷新页面（或换浏览器），验证 `GET /api/sessions` 列出之前的会话。

- [ ] **Step 7: 验证日志清晰**

后端 console 应能看到：
```
[Planner][LLM][...] start stage=...
[SkillRegistry] Invoking skill: flyai args={"command":"search-flight",...}
[SkillRegistry] Skill completed: flyai (xxxx ms)
```
确认 flyai 真的被调用，且 timeout > 15s 不再触发。

- [ ] **Step 8: Final commit + tag**

```bash
git add -A
git commit --allow-empty -m "test: react planner E2E smoke pass"
git tag react-planner-v1
```

---

## 完成标准（Definition of Done）

- [ ] `pnpm test` 全绿（API + shared）
- [ ] `pnpm build` 全栈通过
- [ ] `/api/sessions/:id/messages` SSE 能完整跑通"初版 → 评估 → 修补"循环
- [ ] 真实输入"北京 3 天上海出发 2 人"在 ≤10 轮内 transport/lodging/attraction 三类规则分都 ≥ 90，或 10 轮后正确弹 max_iter_reached
- [ ] 缺关键信息（目的地/天数/出发地）正确通过 clarify_needed 事件追问
- [ ] 旧路由 (`/api/chat`、`/api/trips/*`、`/api/collab/*`) 全部 404
- [ ] `packages/domain` 已删除，仓库无引用残留
- [ ] flyai skill 被实际调用并填充航班号/酒店名/房型到 PlanItem
- [ ] 未登录访问任何受保护路由都跳转 /login
