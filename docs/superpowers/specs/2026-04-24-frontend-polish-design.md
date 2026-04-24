# Frontend Polish · Linear/Vercel-grade — Design Spec

**Date**: 2026-04-24
**Scope**: `apps/web` 全站（登录 / 落地 / 工作台 / 历史）
**Goal**: 把现在"能看"的页面打磨到 Linear / Vercel / Arc 级别的产品感

## 目标与非目标

### 目标
- 全站视觉语言统一到 Linear/Vercel 冷静极简方向
- 修复四个系统性短板：细节精度、信息层级、空/加载态、品牌识别
- 每个像素"像真产品"—— 对齐严格、排版刻度明确、动效一致、状态完备

### 非目标
- 不改底层数据流、SSE 协议、Pinia store 结构、路由
- 不改变工作台两栏 IA（对话 + 方案并排是对的）
- 不追求彩色 OTA 风（飞猪/携程那种）
- 不做 dark mode（后续可加，但不在本次范围内）

### 选型决定（已与用户确认）
- **策略**：方案 A（系统化打磨）+ 方案 C 精选片段（Landing Hero + Plan Artifact + POI 卡）
- **新依赖**：UI 组件库（Reka UI）、图标库（lucide-vue-next）、动效库（motion-v）、Toast（vue-sonner）
- **Aesthetic 基调**：Linear / Vercel / Arc

---

## 1. 设计语言

### 1.1 排版系统

保留现有 Inter + PingFang SC。在 heading-1/2/3 之上扩展 **display** 层级，**只给"产品时刻"使用**（Hero、Plan artifact 标题）：

| token | size | weight | tracking | 用途 |
|---|---|---|---|---|
| `--type-display-xl` | `clamp(44px, 5.5vw, 64px)` | 700 | `-0.03em` | 落地页 Hero 主标题 |
| `--type-display-lg` | `clamp(32px, 3.8vw, 44px)` | 700 | `-0.025em` | Plan Artifact 主标题 |
| `--type-display-md` | `30px` → 已有 `heading-1` 改名 | 700 | `-0.02em` | 模块头 |
| `--type-heading` | `20px` → 已有 `heading-2` | 600 | `-0.01em` | 卡片/面板标题 |
| `--type-subhead` | `16px` → 已有 `heading-3` | 600 | `0` | 小节标题 |
| `--type-body-lg` | `15px` | 400 | `0` | 阅读正文 |
| `--type-body` | `14px` | 400 | `0` | 默认正文（多数场景） |
| `--type-body-sm` | `13px` | 400 | `0` | 次要信息/描述 |
| `--type-caption` | `12px` | 500 | `0` | 辅助标签 |
| `--type-mono-xs` | `11px` | 500 | `0.08em` | kicker / 数据标签 |

**数字处理**：所有出现数字的元素（费用、版本号、评分、人数、天数、时间）统一使用 `font-variant-numeric: tabular-nums` 让列对齐。

**货币展示**：`¥ 5,000` 中的 `¥` 与 `/晚` 这类单位用 `.currency-unit` 类，小 2 号 + `var(--text-muted)`，与主数字脱开视觉重量。

**文本重量锚点**：在对话流、方案卡、POI 列表等密集文本区，必须存在至少 3 档视重（primary 600 / secondary 400 muted / tertiary mono-xs）才算通过。

### 1.2 颜色与表面

保留现有 `--bg / --bg-elevated / --bg-subtle`，新增：

| 新 token | 值 | 用途 |
|---|---|---|
| `--border-subtle-2` | `#F8F9FB` | 卡片内层分隔（比 `--border-subtle` 再淡一级） |
| `--bg-glass` | `rgba(255,255,255,0.92)` | Hero composer 玻璃态 |
| `--shadow-artifact` | `0 20px 60px rgba(17,24,39,0.10)` | Plan Artifact 的"工件感"阴影 |
| `--shadow-card-hover` | `0 8px 24px rgba(17,24,39,0.08)` | 卡片 hover 时的抬升阴影 |

**命名渐变**（替代散落的 linear-gradient 写法）：
| token | 值 | 用途 |
|---|---|---|
| `--gradient-brand` | `linear-gradient(135deg, #7B5BFF 0%, #4F7CFF 100%)` | CTA、品牌 logo、user bubble（已存在，沿用） |
| `--gradient-aurora-soft` | `radial-gradient(600px 240px at 15% 10%, rgba(123,91,255,0.12), transparent 60%), radial-gradient(500px 220px at 85% 80%, rgba(79,124,255,0.10), transparent 60%)` | Hero 背景 aurora |
| `--gradient-grid-mesh` | `linear-gradient(rgba(17,24,39,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(17,24,39,0.04) 1px, transparent 1px)` | Hero 网格底（background-size: 32px） |
| `--gradient-poi-hotel` | `linear-gradient(135deg, #A78BFA, #7C3AED)` | POI 类型占位图（lodging） |
| `--gradient-poi-food` | `linear-gradient(135deg, #FCA5A5, #DC2626)` | POI 类型占位图（meal） |
| `--gradient-poi-poi` | `linear-gradient(135deg, #6EE7B7, #059669)` | POI 类型占位图（attraction） |
| `--gradient-poi-transit` | `linear-gradient(135deg, #93C5FD, #2563EB)` | POI 类型占位图（transit） |

**间距刻度收敛**：现有 padding 散落在 `10 / 12 / 14 / 16 / 18 / 20 / 22` 之间，统一到 4 档：`12 / 16 / 20 / 24`。圆角 token 保留现状。

### 1.3 动效系统

引入 `motion-v`（Motion One 的 Vue 包装，约 3kb）。定义 5 条原语，放到 `apps/web/composables/useMotion.ts`：

| 原语 | 规格 | 使用场景 |
|---|---|---|
| `fadeIn` | `opacity 0→1, 240ms, ease-out` | 页面初次挂载、Toast 出现 |
| `slideUp` | `y:8→0 + opacity 0→1, 320ms, cubic-bezier(0.2,0.7,0.25,1)` | 气泡进入、卡片进入 |
| `pop` | `scale 0.96→1 + opacity 0→1, 200ms, cubic-bezier(0.2,0.7,0.25,1)` | Dialog/Menu 出现、按钮反馈 |
| `listStagger` | children delay 40ms | 列表初次渲染（History grid、Day timeline、POI 列表） |
| `ghostPulse` | `opacity 0.6↔1, 1.6s, infinite, ease-in-out` | streaming 气泡背景、骨架卡 |

**通用规则**：
- 按钮 hover **不做 transform**（无 translateY），只做 shadow + 背景色变化 —— 避免抖动感
- 卡片 hover 最多 `translateY(-1px)` + `var(--shadow-card-hover)`
- 所有进入动效必须在 `@media (prefers-reduced-motion: reduce)` 下退化为 opacity-only 或直接 none

### 1.4 图标系统

引入 `lucide-vue-next`。全站 4 档尺寸 `14 / 16 / 18 / 20`，默认 `stroke-width: 1.5`，active 态或重点展示处 `1.75`。

**禁止**：
- 写新 emoji 到界面（除了用户输入内容）
- 用 `::before` + `content` 做图形（现有的几处要替换，例如 `.hand-list li::before` 的 •、`.compact-brand::before` 的方块）

### 1.5 微细节清单

| 项目 | 规则 |
|---|---|
| `:focus-visible` | 保留现有 2px outline，但 `outline-offset` 改成 **负值** `-1px`，避免在圆角卡上越界 |
| hover lift | 上限 `translateY(-1px)`，不超过 |
| 中文文本 | `hyphens: auto` + `overflow-wrap: anywhere` |
| 截断 | 描述类文本统一使用 2 行 clamp（`-webkit-line-clamp: 2`） |
| 输入框 | 保持现有 focus 态（边框 brand-blue + `box-shadow 0 0 0 3px rgba(79,124,255,0.12)`） |
| 滚动条 | 用 Reka UI 的 ScrollArea 包装，避免系统滚动条样式不一致 |

---

## 2. 交互件（Reka UI 引入）

新目录 `apps/web/components/ui/`，每个文件都是一个简单的"我们自己的 wrapper"（暴露 props + slots），内部用 Reka UI 的 primitives：

| Wrapper | 底层 | 替换什么 |
|---|---|---|
| `DropdownMenu.vue` | `reka-ui` DropdownMenu | 顶部"退出登录" secondary button → 用户菜单（账号 / 历史 / 偏好 / 退出） |
| `Dialog.vue` | `reka-ui` Dialog | 新增：清空工作区确认、编辑行程 brief |
| `Tooltip.vue` | `reka-ui` Tooltip | 新增：所有 icon-only 按钮 |
| `Tabs.vue` | `reka-ui` Tabs | 当前 `.plan-option-chip` 横排切换（a11y 改善） |
| `ScrollArea.vue` | `reka-ui` ScrollArea | 对话流、方案区的 `overflow-y: auto`（样式化滚动条 + gutter 稳定） |

**Toast**：`vue-sonner`，在 `apps/web/plugins/toast.client.ts` 挂载，全局可用。替换掉现有所有 page-level banner（`.page-auth-notice` / `.page-auth-error` / `.auth-status-banner`）——除了 restoring 态（那是在业务流程里的，保留为 banner）。Toast 位置固定右上角，默认 2 秒消失。

**不引入**：完整的 shadcn-vue（过重）、整套 Radix（Reka UI 已经够）、自己写组件库（返工）。

---

## 3. 状态系统

新目录 `apps/web/components/states/`，把所有散落在业务组件里的空/载/错状态模板化：

### 3.1 组件

| 组件 | Props | 内容 |
|---|---|---|
| `EmptyState.vue` | `icon, title, hint?, action?` | Lucide icon 32px muted + title 14/600 + hint 13 muted + 可选 ghost CTA |
| `LoadingSkeleton.vue` | `variant: 'plan' \| 'chat' \| 'history' \| 'generic'` | 骨架卡，1.6s `ghostPulse` 背景 |
| `ErrorState.vue` | `title, detail?, onRetry?` | AlertCircle icon + 文案 + retry ghost button |
| `StreamingBubble.vue` | `status, steps[]` | `Sparkles` icon + agentStatus + `ghostPulse` 背景 + 渐进 step 列表 |

### 3.2 状态映射

| 场景 | 旧实现 | 新实现 |
|---|---|---|
| 历史页无记录 | 无处理（`TripHistoryGrid` 空数组时不展示） | `EmptyState`（Compass icon + "还没有规划过的行程" + "试试首页的示例 prompt"） |
| Plan 生成中 | `.bubble-progress` 三个点 + agentStatus 文本 | `StreamingBubble` 组件（Sparkles + status + ghostPulse）+ 右侧同时展示 `LoadingSkeleton variant="plan"` |
| Plan 失败 | `.bubble-system` + 错误文本 | `ErrorState`（右侧方案区展示）+ Toast（提示） |
| 登录成功/失败 | `.page-auth-notice` / `.page-auth-error` banner | Toast，除 restoring 态 |
| 恢复中 | restore banner | 保留，但精简（compact banner + Spinner icon） |

**不用 spinner**：Linear/Vercel 几乎看不到 spinner。我们全部用骨架卡 + `ghostPulse`。

---

## 4. 关键界面

### 4.1 登录页（`pages/login.vue` + `AuthLoginCard.vue`）

保留两栏 split。改动：
- 左 pane bullet list 改为 3 个 "value prop"（每个 icon + headline + helper）：
  - `Sparkles` · "AI 生成 3 套方案" · "不再反复 try & error"
  - `GitBranch` · "可继续追问与迭代" · "每次修改都保留版本"
  - `Download` · "随时继续上次的规划" · "不会丢"
- 右 pane 密码输入框：`.auth-inline-button` 文字按钮改为 `Eye` / `EyeOff` icon（Lucide），Tooltip 显示 "显示/隐藏"
- 顶部 `auth-brand-badge` 保留（已经够 clean）

### 4.2 落地页 Hero（`pages/index.vue` + `HeroPlannerCard.vue`）

**完全重做** `HeroPlannerCard`（改动最大的一块）：
- 外层 Hero 区 `padding: 48px 32px 40px`，背景 = `--gradient-aurora-soft` + `--gradient-grid-mesh`（mask 渐隐到边缘）
- `kicker` chip：`•AI TRAVEL PLANNER`（brand-blue-soft 底，mono-xs，带发光 dot）
- 主标题：`display-xl`，两行：
  - 行 1 "规划一次" 正常颜色
  - 行 2 "称心的旅行" 用 `--gradient-brand` 做 `-webkit-background-clip: text`
- 副标题：`body-lg muted`, max 46ch，居中
- **Hero Composer**：max 680px，圆角 16，背景 `--bg-glass` + `backdrop-filter: blur(8px)` + `--shadow-artifact`
  - Textarea 占位文本 "说说你的出行需求：目的地 / 天数 / 人数 / 预算 / 偏好…"
  - 下方 separator 后一行：左边是 3 个 quick tags（当前出发地 `MapPin` / 默认天数 `Calendar` / 默认预算 `DollarSign`，点击展开编辑），右边 "开始规划" primary 按钮（带 `ArrowRight` icon）
- **Preset pills** 行：4 个示例（保留现状，但换成"杭州 · 3 天 · 美食拍照"这种更产品化的写法，带 `Sparkles` icon）

### 4.3 History grid（`TripHistoryGrid.vue`）

- 加 section header "继续之前的规划" + 右侧 mono-xs meta "RECENT · N"
- 每张卡片新增 **顶部色彩带**（64px 高）：根据 destination 映射到色系（东亚樱粉、华北金黄、北海道青绿、东南亚珊瑚、欧洲薰衣草等，实现细节见 §5.3）
- 卡片 body：
  - dest + 天数 一行 display-md
  - meta 行：`Clock` icon + 相对时间、`DollarSign` icon + 预算
  - 底部 version chips（v1/v2/v3，active 态用 brand-blue-soft）
- hover：`translateY(-1px)` + `--shadow-card-hover` + 色带微弱饱和度提升

### 4.4 工作台

**Topbar 重构**（`pages/index.vue` 的 `<header class="page-topbar">`）：
- 左：compact-brand logo（保留现状，但尺寸调整为 22px square）+ 面包屑 "`规划 / <destination> / v<N> · <style>`"（mono font，brand 色重点字用加粗 + 主色）
- 右：DropdownMenu（avatar + username + `ChevronDown`），菜单项：账号信息 · 规划历史 · 清空工作区（Dialog 确认）· 退出登录

**Chat Panel**（`ChatPanel.vue`）：
- 保持气泡结构
- 去掉重复的"已基于你的修改生成新版方案..."—— 规则：在 `stores/chat.ts` 里做 dedupe，连续两条（或更多）**内容完全相同且 role 都是 assistant** 的消息折叠成一条，右上角加 "×N" 徽章（`--brand-blue-soft` 底 + mono-xs）；只要中间有一条 user 或 system 消息就重置计数
- `.bubble-progress` 换成 `StreamingBubble` 组件
- composer 底部的分隔线改为 `border-top: 1px solid var(--border-subtle-2)`（更淡）
- 滚动条换成 `ScrollArea` wrapper

### 4.5 Plan Artifact（`PlanningPreview.vue`，改动最多）

这是 **C 方案的"拍照时刻"**。按 artifact 思路重做：

```
┌─ Plan shell ────────────────────────────────────────┐
│ [Header]  旅行方案 🏆    [v1] [v2] [v3 · balanced]  │
│                                                      │
│ ┌─ Plan Hero slab ────────────────────────────────┐ │
│ │ ▲ aurora 渐变底                                  │ │
│ │ [balanced chip]  2 MIN AGO                       │ │
│ │ 京都 5 天 · 文化深度与轻松漫步  ← display-lg    │ │
│ │                                                  │ │
│ │ [DAYS] [BUDGET] [PEOPLE] [SCORE]  ← 4 stat 卡   │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ─ ScoreRing（保留，仅视觉微调）─                      │
│                                                      │
│ ─ 建议 list（保留，换 Lightbulb icon）─              │
│                                                      │
│ ─ Day Timeline ─                                     │
│ ┌ D1 抵达京都 · 祇园夜色  APR 28 · MON             │
│ │   ┌─ POI card ──────────────────────────┐        │
│ │   │ [渐变图] 新干线 · 东京 → 京都         │        │
│ │   │          NOZOMI 225 · 2h 15m         │        │
│ │   │                       10:30 → 12:45 │        │
│ │   │                           ¥ 680     │        │
│ │   └──────────────────────────────────────┘        │
│ │   ┌─ POI card (hotel) ...                         │
│ └ D2 ...                                            │
└──────────────────────────────────────────────────────┘
```

**具体规格**：

- **Plan Hero slab**：radius 14, padding `18px 20px 20px`, 背景组合 `--gradient-aurora-soft` + `--bg-subtle`
  - 上排：balanced chip（brand-purple 色）+ "2 MIN AGO"（mono-xs subtle）
  - 标题：display-lg
  - 4 stat cards：grid 4 列，每个卡片 `padding 10 12`, `bg-white`, border, radius 10
    - stat-label：mono-xs subtle 带 icon（Calendar / DollarSign / Users / Award）
    - stat-value：16/700 tabular-nums；单位（"天"/"¥"/"/100"）用 `.currency-unit` 小字

- **Score panel**：保留现状，但微调：
  - score ring 数字改成 display-md（当前 18px 太小）
  - 类别 bar 底色改为 `--border-subtle`
  - 建议 list 的警告 icon 换成 Lucide `AlertCircle`，颜色保留 warn

- **Day timeline**：
  - 新的 Day head：左 `DayNum` 徽章（28×28 radius 10，`--gradient-brand` 底，mono "D1" 白字）+ 右 title + 日期（"APR 28 · MON" mono-xs subtle）
  - POI 列表连线：`.ta-poi::after` 纵向 1px border 贯穿整个 Day，`::before` 从纵线伸出 14px 接到卡片
  - **POI card**（替换当前 `.result-day-item` 3 列 grid）：
    - 左：56×56 radius 10 渐变占位图，按 POI 类型映射 `--gradient-poi-*`，里面放对应 Lucide icon（Bed / UtensilsCrossed / Mountain / TramFront）
    - 中：标题 14/600 + meta 行（评分 tag + 亮点 tag + 描述）
    - 右：时间（mono-xs subtle "10:30 → 12:45"）+ 费用（14/600 tabular "¥ 680"，带小单位）
    - hover：lift 1px + shadow，右下角浮出 3 个 ghost button（Map / Replace / Info，都带 Tooltip）

### 4.6 Item Selector（`ItemSelector.vue`）

保留现状结构。微调：
- `.selector-option` 换成 Reka UI 的 RadioGroup（a11y 更好）
- 选中态的 `border-color` + 背景保留

---

## 5. Moments（来自方案 C）

### 5.1 Landing Hero
见 §4.2。本节不重复。

### 5.2 Plan Artifact
见 §4.5。本节不重复。

### 5.3 POI 渐变占位图（取代真实图片）

**决定**：不用真实 POI 图片（爬图/授权/CDN 存储都是坑）。改为**类型映射的彩色渐变块**。

实现：
```ts
// apps/web/utils/poi-visual.ts
const POI_GRADIENT: Record<string, string> = {
  lodging: 'var(--gradient-poi-hotel)',
  meal:    'var(--gradient-poi-food)',
  attraction: 'var(--gradient-poi-poi)',
  transit: 'var(--gradient-poi-transit)',
}
const POI_ICON: Record<string, string> = {
  lodging: 'lucide:bed',
  meal:    'lucide:utensils-crossed',
  attraction: 'lucide:mountain',
  transit: 'lucide:tram-front',
}
```

**目的地色带**（History 卡片顶部）：
```ts
// apps/web/utils/destination-color.ts
// 根据 destination 字符串 → 预定义色系之一
const DESTINATION_BANDS = [
  { match: /京都|奈良|东京|大阪/, gradient: 'linear-gradient(135deg, #F9A8D4, #BE185D)' },   // 日本 · 樱粉
  { match: /北京|西安|敦煌/, gradient: 'linear-gradient(135deg, #FCD34D, #B45309)' },        // 华北 · 金黄
  { match: /北海道|札幌/, gradient: 'linear-gradient(135deg, #86EFAC, #047857)' },            // 北海道 · 青绿
  { match: /杭州|苏州|上海/, gradient: 'linear-gradient(135deg, #C7D2FE, #6366F1)' },         // 江南 · 靛蓝
  { match: /巴黎|伦敦|阿姆斯特丹/, gradient: 'linear-gradient(135deg, #DDD6FE, #7C3AED)' },   // 欧洲 · 薰衣草
  { match: /清迈|曼谷|巴厘岛|胡志明/, gradient: 'linear-gradient(135deg, #FDBA74, #C2410C)' },// 东南亚 · 珊瑚
  // 默认 fallback: brand gradient
]
```

---

## 6. 实现分层（供后续 writing-plans 使用）

这是建议的切片顺序，方便后续拆成 phase：

**Phase 1 · 基础**（先做，不会白费力）
- 装依赖：`reka-ui` / `lucide-vue-next` / `motion-v` / `vue-sonner`
- 扩展 `assets/css/main.css`：新 token（display scale、gradient、shadow、border-subtle-2）+ utility（`.currency-unit`、`tabular-nums`）
- 建目录：`components/ui/*` / `components/states/*`
- 写 5 条 motion composable
- 配置 Toast plugin

**Phase 2 · 横向基础设施**（不绑定业务形态）
- 实现 `EmptyState` / `LoadingSkeleton` / `ErrorState` / `StreamingBubble` 四个状态组件
- 实现 `DropdownMenu` / `Dialog` / `Tooltip` / `Tabs` / `ScrollArea` 五个 UI wrapper
- 实现 `utils/poi-visual.ts` / `utils/destination-color.ts`

**Phase 3 · 表面改造（按页推进）**
- 3a · 登录页：AuthLoginCard value props + 密码 Eye icon
- 3b · Topbar：breadcrumb + DropdownMenu 用户菜单 + Toast 替掉 banner
- 3c · 落地页：HeroPlannerCard 重做 + preset pills 样式
- 3d · History grid：色带 + 卡片重排
- 3e · Chat Panel：重复消息折叠 + StreamingBubble 接入 + ScrollArea
- 3f · PlanningPreview：Plan Hero slab + 4 stat + Day timeline + POI card（最大一块）

**Phase 4 · 收尾**
- 全站走查：间距刻度收敛（12/16/20/24）、token 命名替换
- 动效接入：所有列表加 `listStagger`、气泡加 `slideUp`
- a11y：focus-visible 全站验证、Reka UI 组件 aria 检查
- Reduced motion：完整退化验证
- 响应式：980/640 断点逐页验证

---

## 7. 风险与注意事项

- **motion-v 与 Nuxt 3 SSR 兼容性**：首次接入需在 `nuxt.config.ts` 的 `build.transpile` 里加条目；动画相关组件用 `<ClientOnly>` 包一层更保险
- **lucide-vue-next 打包大小**：按需 tree-shake 没问题，但不要做 `import * as Lucide`，要一个个命名导入
- **Reka UI 的 Dialog/Menu Portal**：默认 mount 到 `body`，注意现有的 `position: fixed`/`z-index` 层级冲突
- **重复 assistant 消息折叠**：需要在 `stores/chat.ts` 里做 dedupe 逻辑，不能只在 UI 层处理（避免和 SSE event 时序打架）
- **Plan Hero "2 MIN AGO" 相对时间**：用现有 utility 或引入 `dayjs`（现在依赖里还没有，需确认）

---

## 8. 完成标准

设计完成的定义：
1. 四个系统性短板在视觉走查中都看不出问题（细节精度 / 信息层级 / 空载态 / 品牌识别）
2. 新同事第一次打开项目，看到的风格是一致的"Linear 风"，不会觉得哪一页特别跳
3. 所有 state（empty / loading / streaming / error）在 demo 脚本里都能触发并表现符合规范
4. 没有页面在 Chrome DevTools 里报 a11y warning
5. `prefers-reduced-motion: reduce` 下整站可用、无晃动
