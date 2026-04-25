# Workspace 页布局四点修复 (A+B+C+D)

**日期：** 2026-04-25
**范围：** `apps/web` 工作区页面 conversation 模式下的四个布局痛点。
**关联截图：** `landing.png` / `workspace.png`（用户提供）。

| 编号 | 痛点 | 本 spec 是否处理 |
|---|---|---|
| A | 右侧方案区太窄、大量留白 | 是 |
| B | 顶部 header + 说明文案太占高度 | 是 |
| C | 聊天气泡（尤其用户消息）过宽、缺对话感 | 是 |
| D | 双拖拽条（中分条 + 底部拖条）显得笨重/工具化 | 是 |

---

## 1. 现状归因

`apps/web/pages/index.vue:463-607` + `apps/web/assets/css/main.css:926-1177` 共同构成 workspace shell。问题分别落在：

- **A** —— `pages/index.vue:548-597` 在 `is-conversation` 状态下无条件渲染左 / 中分条 / 右 / 底部拖条。`main.css:1102` 默认 `--main-grid-left: 54%` 让右栏永远占 ~46%，即使没有 plan / 报错。
- **B** —— `pages/index.vue:484-486` 在 conversation 模式仍渲染 `<p class="page-topbar-copy">输入目的地…</p>`，加上 `main.css:946-953` 的 `margin-bottom: 18px / padding-bottom: 18px / border-bottom: 1px solid var(--border)`，topbar 总高 ≈ 92px。
- **C** —— `apps/web/components/ChatPanel.vue:140-174` 给所有气泡 `max-width: 85%`，背景色 + 渐变充满整个 chat 列。chat 列拉宽到 ~700–800px 时，单条用户消息能拉到 ~660px，远超舒适阅读宽度，丧失对话感。
- **D** —— 中分条 `main.css:1145-1167` 默认就有一个白底 + border + shadow 的"grip pill"，并非 hover 才出现 → 视觉重；底部 `panel-resize-handle`（`main.css:1064-1096`）让 conversation 区可以纵向拖拽，但 `is-conversation` 已经 `height: 100dvh; overflow: hidden`，纵向拖拽对最终用户没有真实价值，只让界面像后台系统。

## 2. 设计目标

- **A**：右栏（含中分条）只在 `currentPlan` 存在时渲染；默认分栏比 `54/46 → 42/58`。
- **B**：conversation 模式下隐藏 tagline，`page-topbar` 收紧到 ≤ 56px。Landing 模式保持现状（tagline 是 landing 上下文的有用引导）。
- **C**：`bubble` 的 `max-width: 85%` 改为按内容类型给具体像素上限：用户 520px、助手 640px、system 仍占满。
- **D**：删掉底部纵向 resize handle 与配套 state；中分条默认隐藏 grip pill，仅 hover/拖动时显现。

四点彼此正交，不互相依赖；可以一次改完，但 PR 内可分四个 commit 便于回滚。

## 3. 规格

### 3.1 痛点 A — 右栏按 `hasPlanArtifact` 自适应

**新增 computed：**
```ts
// pages/index.vue
const hasPlanArtifact = computed(() => Boolean(currentPlan.value))
```
`errorMessage` 不计入 artifact —— 错误信息留在 chat 流，不撑起右栏。

**模板：** `<button class="main-grid-divider">`、第二个 `<div class="main-grid-panel">`（PlanningPreview 容器）一起包在 `<template v-if="hasPlanArtifact">` 里。底部 `panel-resize-handle` 由痛点 D 直接删掉，无需在此条件渲染。

**CSS：**
- `--main-grid-left` 默认值 `54% → 42%`（`main.css:1102`）。
- `.main-grid` 上加修饰类 `is-single-panel`（由 `!hasPlanArtifact` 触发）：
  ```css
  .main-grid.is-single-panel .main-grid-panel-primary { flex: 1 1 100%; }
  ```
- v1 不加挂载过渡，硬切。

**错误态：** `PlanningPreview` 内部错误卡片渲染逻辑保留（用于"plan 已存在但局部刷新失败"罕见场景），但"用户提交 → planner 直接失败 → 没有任何 plan"路径下右栏不渲染，错误信息走 `chatStore.setRequestError` 进 chat 流（已有逻辑，沿用）。

**持久化：** `leftPanelWidth` 仍写入 sessionStorage；下次会话有 plan 时复用。`mainSectionHeight` 由痛点 D 删除。

### 3.2 痛点 B — Conversation topbar 收紧

**模板（`pages/index.vue:484-486`）：**
```vue
<!-- 现状：tagline 在 conversation 模式仍显示 -->
<p v-else class="page-topbar-copy">输入目的地…</p>

<!-- 改为：仅 landing 显示 tagline；conversation 不渲染 -->
<p v-if="isLanding" class="page-topbar-copy">输入目的地…</p>
```
breadcrumb（`page-breadcrumb`）保持原有 `v-if="breadcrumbDestination"`，与 tagline 互斥不变。

**CSS（`main.css:946-980`）：** 在 conversation 状态下专门收紧：
```css
.page-shell.is-conversation .page-topbar {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom-color: var(--border-subtle-2);
}
.page-shell.is-conversation .compact-brand {
  font-size: 16px;
}
.page-shell.is-conversation .compact-brand::before {
  width: 20px; height: 20px; border-radius: 6px;
}
```
- 期望 conversation topbar 总高 ≈ 52–56px（landing 不变 ≈ 92px）。
- `border-subtle-2` 是更淡的分隔色（已存在于 token 里）；如不存在则用 `var(--border)` + `opacity: 0.6` 实现。

### 3.3 痛点 C — 气泡宽度与对话感

**CSS（`ChatPanel.vue:140-174`）：**
```css
.bubble { max-width: min(640px, 85%); }   /* 替代当前 max-width: 85% */
.bubble-user { max-width: min(520px, 85%); }
.bubble-assistant { max-width: min(640px, 85%); }
.bubble-system { max-width: 100%; }       /* 不变 */

.conversation-list { gap: 14px; }          /* 12 → 14，节奏更松 */
```
`min(<px>, 85%)` 保证：
- 大屏（chat 列宽 ≈ 700px）下，用户气泡封顶 520px、助手气泡封顶 640px，自然回落到对话气泡尺度。
- 窄屏（chat 列 < ~610px）退化到 85%，与现有移动端体验一致；`@media (max-width: 640px)` 下的 `bubble { max-width: 94% }` 不变。

不加头像位、不动气泡背景渐变（保持品牌识别）。

### 3.4 痛点 D — 拖条减负

**删除底部纵向 resize handle 及其 state：**
- 模板：移除 `pages/index.vue:599-604` 的 `<button class="panel-resize-handle">`。
- 脚本：删除 `mainSectionRef`、`mainSectionHeight`、`mainSectionStyle`、`isResizingMainSection`、`startMainSectionResize`、`availableMainSectionHeight`、`clampMainSectionHeight`，以及 `clamp` 中只为它服务的部分（`syncPanelLayoutBounds` 内对 `mainSectionHeight` 的处理）。`MAIN_SECTION_MIN_HEIGHT` 常量删除。
- sessionStorage：`PANEL_LAYOUT_STORAGE_KEY` 写入对象只保留 `leftPanelWidth`；读取时若发现旧 key 含 `mainSectionHeight` 直接忽略（不报错、不删 key，旧版本兼容）。
- `<div ref="mainSectionRef" class="resizable-panel resizable-panel-main">` 退化为 `<section class="main-section">`，CSS 只保留 `flex: 1; min-height: 0; padding-bottom: 18px;`，删除 `.resizable-panel` 相关定位以及 `.resizable-panel.is-resizing` 系列高亮。
- `.panel-resize-handle` 整组 CSS（`main.css:1064-1096`）删除。

**中分条隐藏 grip pill：**
```css
/* main.css:1145-1167 改为 */
.main-grid-divider-grip {
  /* 默认隐藏 */
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out);
  /* 其余定位不变 */
}
.main-grid-divider:hover .main-grid-divider-grip,
.main-grid-divider.is-resizing .main-grid-divider-grip {
  opacity: 1;
}
.main-grid-divider-track {
  background: var(--border-subtle-2);   /* 默认更淡 */
}
```
中分条触发区宽度（`flex: 0 0 20px`）保留，保证拖动手感；视觉只剩一根淡线，hover 才呼出 grip + 亮色。

### 3.5 ReAct 顶部条 / Clarify / MaxIter 卡片

`ReactProgressBar` / `ClarifyCard` / `MaxIterCard`（`pages/index.vue:527-546`）位置不动；与 A/B/C/D 四点正交。

## 4. 验收标准

1. **A — 未生成方案**（首次 conversation 或仅报错）：
   - DOM 中无 `.main-grid-panel:not(.main-grid-panel-primary)`、无 `.main-grid-divider`。
   - chat 区域横向占满 `main-grid`，无 ~46% 宽空白。
2. **A — 生成成功**：右栏挂载，默认 chat ≈ 42% / plan ≈ 58%；用户已拖动过则尊重 sessionStorage。
3. **A — 报错（无 plan）**：右栏不出现；错误信息出现在 chat 流。
4. **B — Conversation topbar**：高度 ≤ 56px，无 tagline；landing 模式 topbar 与现状一致（含 tagline、~92px）。
5. **C — 气泡**：在 1440px 视口下用户气泡视觉宽度 ≤ 520px、助手气泡 ≤ 640px、system 气泡仍占满；640px 以下窄屏不回归。
6. **D — 底部拖条**：DOM 中不存在 `.panel-resize-handle`；脚本中无 `mainSectionHeight` / `startMainSectionResize` 等符号。
7. **D — 中分条**：默认无 grip pill 视觉；hover/拖动时 grip 呼出且 track 变蓝。
8. **D — 持久化兼容**：旧 sessionStorage 中含 `mainSectionHeight` 字段时，应用应能正常启动（忽略字段，不抛错）。
9. **移动端**（≤ 980px，main.css:2382 起）：双栏 → 纵向堆叠；topbar 不回归；拖条不出现。
10. `pnpm build:web` 通过；浏览器人工验收：landing → 提交 → ReAct 流 → plan 落位 → 拖动分栏 → 报错重试，全程无视觉/交互回归。

## 5. 涉及文件

- `apps/web/pages/index.vue` —— `hasPlanArtifact` computed；模板用 `v-if` 包右栏组；删底部 resize handle 及配套 ref/state/handler；tagline 改 `v-if="isLanding"`。
- `apps/web/assets/css/main.css` —— `--main-grid-left` 默认值 42%；`.main-grid.is-single-panel` 单栏样式；conversation topbar 收紧；中分条 grip 默认隐藏；`.panel-resize-handle` 及 `.resizable-panel`/`.resizable-panel-main` 系列样式删除（`main-section` 接管最简定位）。
- `apps/web/components/ChatPanel.vue` —— `.bubble` / `.bubble-user` / `.bubble-assistant` 的 `max-width`；`.conversation-list` 的 `gap`。
- `apps/web/components/PlanningPreview.vue` —— 不改。
- `apps/web/stores/chat.ts` / `apps/web/stores/workspace.ts` —— 不改。

## 6. 不做

- 不改 chat 气泡的背景渐变 / 圆角形状。
- 不为助手消息加头像位。
- 不调整 ReAct progress bar / Clarify / MaxIter 卡片的位置。
- 不动 PlanningPreview 内部错误态渲染逻辑。
- 不为单栏 ↔ 双栏切换加挂载过渡（v1 硬切）。
