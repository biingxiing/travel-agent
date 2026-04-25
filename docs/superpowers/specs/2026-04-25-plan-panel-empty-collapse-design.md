# 痛点 A 修复：右栏按 plan artifact 自适应

**日期：** 2026-04-25
**范围：** 仅修复 `apps/web` 工作区页面在 conversation 模式下，右侧"旅行方案"面板在 **没有 plan / 加载中 / 报错** 时仍占据 ~46% 屏宽、出现大量留白的问题。
**不在本次范围：** topbar 高度、聊天气泡宽度、双拖条工具化感。

---

## 1. 问题归因

`apps/web/pages/index.vue:548-597` 的 `main-grid` 在 `is-conversation` 状态下无条件渲染左右两栏 + 中分条 + 底部纵向 resize handle。`apps/web/assets/css/main.css:1101-1117` 设定默认 `--main-grid-left: 54%`，右栏拿到剩余 ~46%。

后果：
- 即便 `currentPlan === null`、planner 还没出方案、或刚刚报错，右栏依然占着屏幕。
- 错误态 (`PlanningPreview` 内部) 渲染成一张体积很小的红色卡片，被放进一个本应承载完整行程的大面板里 → 视觉上"几乎全是留白"。
- 中分条和底部拖条都是为"双栏存在"服务的；右栏空时它们也跟着空转。

## 2. 设计目标

- **没有 plan artifact 时，右栏不渲染；chat 占满主区域。**
- **错误信息从右栏迁移到 chat 流**，避免错误态独占大面板。
- **有 plan 时**，右栏出现，并把默认分栏比从 `54/46` 调到 `42/58`（把更多空间让给最终产物）。
- 切换在视觉上接受硬挂载/卸载（v1 不做过渡）；上线后若觉得生硬，再补 polish。

## 3. 规格

### 3.1 单一信号：`hasPlanArtifact`

在 `apps/web/pages/index.vue` 新增：

```ts
const hasPlanArtifact = computed(() => Boolean(currentPlan.value))
```

`currentPlan` 已经从 `workspaceStore` 解构。`errorMessage` **不计入** artifact —— 错误态不应让右栏存在。

### 3.2 模板：右栏 + 中分条 + 拖条按 `hasPlanArtifact` 渲染

`apps/web/pages/index.vue` 模板内：

- `<div class="main-grid-panel main-grid-panel-primary">` 始终存在（chat 永远在）。
- `<button class="main-grid-divider" …>`、第二个 `<div class="main-grid-panel">`（PlanningPreview 容器）、以及 `<button class="panel-resize-handle" …>` 三者一起包在 `<template v-if="hasPlanArtifact">` 里。

### 3.3 CSS：单栏 / 双栏切换

`apps/web/assets/css/main.css`:

- 保留 `.main-grid` 的 flex 布局；不改成 grid。
- 默认 `--main-grid-left` 由 `54%` 改为 `42%`（仅影响有 plan 时的初始比例；用户拖动后的覆盖值仍由 sessionStorage 持久化生效，`MAIN_SPLIT_MIN_LEFT_PX` / `MAIN_SPLIT_MIN_RIGHT_PX` 不变）。
- 在 `.main-grid` 上加修饰类 `is-single-panel`，由模板根据 `!hasPlanArtifact` 条件挂载。CSS：
  ```css
  .main-grid.is-single-panel .main-grid-panel-primary { flex: 1 1 100%; }
  ```
  这样单栏时 chat 自然占满；双栏时回到 `flex: 0 0 var(--main-grid-left)` 行为。
- v1 不加挂载过渡（Vue `<Transition>` 包住 flex 布局里的三个 sibling 不直观；而且本痛点的核心是"消除空白"，不是"动效"）。如果上线后体感生硬，再加 polish。

### 3.4 错误态迁移

当前 `PlanningPreview.vue` 在 `phase === 'error'` 或有 `errorMessage` 时渲染一个红色错误卡。本次：

- 该错误卡渲染逻辑保留**给 `currentPlan` 存在但局部刷新失败**的场景（极端少数）。
- 但路径"用户提交 → planner 直接失败 → 没有任何 plan"下，右栏不渲染；错误信息已经通过 `chatStore.setRequestError` 进入 chat 流（系统消息气泡 / inline 错误条），无需右栏额外承载。
- 因此 `PlanningPreview` 不需要改实现，只是它**不会再被挂载**到无 plan 的错误流里 —— 由父级控制。

### 3.5 ReAct loop 顶部条与 clarify / max-iter 卡片

这三块（`ReactProgressBar` / `ClarifyCard` / `MaxIterCard`）目前在 `main-grid` 之外渲染（见 `pages/index.vue:527-546`）。本次**不动它们**。它们继续在主区上方按需出现，与单栏 / 双栏切换正交。

### 3.6 持久化

`PANEL_LAYOUT_STORAGE_KEY` 仍然记录 `leftPanelWidth` / `mainSectionHeight`，但当 `hasPlanArtifact === false` 时，不消费 `leftPanelWidth`（因为没有右栏）。`mainSectionHeight` 不受影响。

## 4. 验收标准

1. **未生成方案时**（首次 conversation 或刚报错）：
   - DOM 中不存在 `.main-grid-panel:not(.main-grid-panel-primary)`、`.main-grid-divider`、`.panel-resize-handle`。
   - chat 区域横向占满 `main-grid` 容器；不出现 ~46% 宽的空白。
2. **生成成功后** `currentPlan` 落位的同时，右栏直接挂载，默认 chat ≈ 42% / plan ≈ 58%（用户已拖动过则尊重 sessionStorage 里的值）。
3. **报错后**（无 plan）：右栏不出现；错误信息出现在 chat 流。
4. **拖动中分条** 仍可调节比例并写入 sessionStorage；下次进入有 plan 的会话时复用。
5. 移动端断点（≤ 980px，main.css:2382 起）行为与现状一致：双栏退化为纵向堆叠，divider/handle 隐藏；本次改动不应回归。
6. `pnpm build:web` 通过。

## 5. 涉及文件

- `apps/web/pages/index.vue` —— 新增 `hasPlanArtifact` computed；模板用 `v-if` 包住右栏三件套；右栏外加 `<Transition>`。
- `apps/web/assets/css/main.css` —— `.main-grid` 改 grid，`--main-grid-left` 默认改为 `42%`，新增过渡用类（如 `.plan-panel-enter-from` 等）。
- `apps/web/components/PlanningPreview.vue` —— 不改。
- `apps/web/stores/chat.ts` / `apps/web/stores/workspace.ts` —— 不改。

## 6. 不做

- 不调整 topbar 高度 / tagline。
- 不改聊天气泡 max-width 或对齐。
- 不撤销中分条或底部拖条（两者仅在右栏不渲染时随之消失，不动它们的存在性）。
- 不改 `PlanningPreview` 内部错误态渲染逻辑。
