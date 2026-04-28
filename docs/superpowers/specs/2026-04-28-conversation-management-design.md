# 对话管理迭代设计文档

**日期：** 2026-04-28  
**状态：** 待实现

---

## 背景与问题

1. **无新建对话入口**：对话模式下只有点击品牌名才能回到落地页，不符合用户直觉。
2. **历史对话续聊上下文丢失**：`buildOrchestratorMessages` 将所有 user 消息拍平成单条字符串，LLM 看不到助手历史回复，也无法可靠利用 `stateContext`。extractor 在有 `existingBrief` 时把全部历史 user 消息拼合，导致 intent 易被误判为 `"new"`。

---

## 目标

- 任何时候都能一键新建对话
- 常驻侧边栏展示历史行程，支持快速切换
- 加载历史后发新消息 → LLM 在原方案基础上 refine，不重新规划

---

## 设计

### 一、前端布局重构

#### 布局结构

```
page-shell
├── Header（品牌名 + 面包屑 + 用户下拉）
└── page-body  [display: flex]
    ├── HistorySidebar (240px, 固定宽度)
    │   ├── "+ 新建行程" 按钮
    │   └── TripHistoryGrid (variant="list", :activeSessionId)
    └── page-main  [flex: 1]
        ├── isLanding=true  → HeroPlannerCard（居中）
        └── isLanding=false → ReactProgressBar / ClarifyCard / MaxIterCard
                             └── main-section
                                 └── main-grid
                                     ├── ChatPanel
                                     ├── divider
                                     └── PlanningPreview
```

#### 受影响文件

| 文件 | 改动 |
|---|---|
| `apps/web/pages/index.vue` | 增加 `.page-body` flex 容器；新增 `<aside class="history-sidebar">`；`TripHistoryGrid` 从 `landing-stack` 移入侧边栏；`returnToLanding` 重命名为 `startNewConversation` |
| `apps/web/components/TripHistoryGrid.vue` | 增加 `variant: "list" \| "grid"` prop（默认 `"grid"` 兼容原来落地页）；增加 `activeSessionId: string \| null` prop；`list` 模式改为单列垂直紧凑卡片（左侧 4px 色条替代顶部色带） |

#### "新建行程"按钮行为

```typescript
function startNewConversation() {
  chatStore.resetConversation()
  workspaceStore.reset()
  stream.setSessionId(null)
  workspaceStore.persistState()
}
```

#### 移动端

768px 以下侧边栏默认折叠，Header 左侧增加汉堡图标，点击展开 drawer。选中历史条目后自动关闭 drawer。

---

### 二、后端上下文修复

#### 2.1 `buildOrchestratorMessages`（`apps/api/src/agents/tools/index.ts`）

**改动**：`ORCHESTRATOR_SYSTEM_PROMPT` 保持不变（正在独立优化）。session state 从 user message 里移出，作为第二条 system message 注入；`session.messages` 中的 user + assistant 消息以标准多轮格式追加。

```typescript
export function buildOrchestratorMessages(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const stateContext = JSON.stringify({
    hasBrief: !!session.brief,
    brief: session.brief,
    hasCurrentPlan: !!session.currentPlan,
    currentPlan: session.currentPlan,
    currentScore: session.currentScore,
    language: session.language ?? 'zh',
    iterationCount: session.iterationCount,
    status: session.status,
    prefetchContextSize: session.prefetchContext?.length ?? 0,
  })

  const conversationHistory = session.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  return [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    { role: 'system', content: `Session state:\n${stateContext}` },
    ...conversationHistory,
  ]
}
```

#### 2.2 Extractor intent 修复（`apps/api/src/agents/extractor.ts`）

**问题**：`existingBrief` 不为 null 时，拼合全部历史 user 消息让 LLM 判断 intent，第一条消息拉低分类准确性。

**修复**：新增 `latestMessage` 字段；SYSTEM_PROMPT 说明 intent 由 `latestMessage` 决定，brief 合并用 `allMessages`。

```typescript
// extractor.ts — buildMessages
const allUserText = messages
  .filter(m => m.role === 'user')
  .map(m => m.content)
  .join('\n---\n')
const latestUserText = messages.filter(m => m.role === 'user').at(-1)?.content ?? allUserText

// LLM user message
{
  role: 'user',
  content: `existingBrief:\n${JSON.stringify(existingBrief)}\n\nallMessages:\n${allUserText}\n\nlatestMessage:\n${latestUserText}`,
}
```

SYSTEM_PROMPT 增加一行说明：
> Determine `intent` from `latestMessage` only. Use `allMessages` only for merging brief fields.

---

### 三、数据流

#### 新建对话
```
点击 "+ 新建行程"
  → startNewConversation() → stores 清空 → isLanding=true
  → 用户输入 → submitPrompt()
  → POST /api/sessions（创建新 session）
  → SSE 流开始
```

#### 加载历史 → 续聊
```
点击侧边栏历史条目
  → loadHistoryEntry(entry)
  → GET /api/sessions/:id → 完整 session（messages + brief + currentPlan）
  → workspaceStore.hydrateFromSession()
  → chatStore.hydrateFromSessionMessages()
  → stream.setSessionId(session.id)
  → 侧边栏高亮激活 session

用户发新消息
  → POST /api/sessions/:id/messages
  → sessionStore.appendMessage(user)
  → runReactLoop → buildOrchestratorMessages
      [system: 编排器指令]
      [system: stateContext（brief + currentPlan）]
      [...最近 20 条 user/assistant 历史]
  → 编排器感知 hasCurrentPlan=true + 完整对话历史
  → call_extractor(latestMessage) → intent="refine"
  → call_refiner → 流式输出修改方案
```

#### 侧边栏激活状态同步
```
workspaceStore.sessionId 变化 → TripHistoryGrid :activeSessionId 更新 → 对应卡片高亮
```

---

### 四、边界情况

| 情况 | 处理 |
|---|---|
| 加载历史时 session 在服务端丢失（内存重启 + 无 DB） | 捕获 404 → `$toast.error("该行程已失效")` → 从侧边栏删除该条目 |
| 续聊意图模糊 | `existingBrief` 不为 null 时 extractor 默认返回 `"refine"` |
| `session.messages` 超过 20 条 | `slice(-20)` 截断；brief + currentPlan 独立在 system message，不受截断影响 |
| 移动端侧边栏展开时选中历史 | 选中后自动关闭 drawer |
| 已完成的方案切换到其他历史 | 直接 `resetConversation()` + `loadHistoryEntry()`，无需二次确认（方案已持久化服务端） |
| 多条 system message 兼容性 | Sub2API 及主流 OpenAI-compatible 接口均支持多条 system message |

---

## 不在本次范围内

- `ORCHESTRATOR_SYSTEM_PROMPT` 优化（独立进行）
- Session 持久化到 Postgres（DATABASE_URL 功能已存在，单独配置）
- 对话重命名 / 搜索历史
- 方案导出 / 分享

---

## 受影响文件汇总

| 文件 | 类型 |
|---|---|
| `apps/web/pages/index.vue` | 前端 — 布局重构 |
| `apps/web/components/TripHistoryGrid.vue` | 前端 — 新增 variant/activeSessionId prop |
| `apps/api/src/agents/tools/index.ts` | 后端 — buildOrchestratorMessages 重写 |
| `apps/api/src/agents/extractor.ts` | 后端 — LLM message 结构 + SYSTEM_PROMPT 补充 |
| `apps/api/src/agents/react-loop.test.ts` | 测试 — 更新 messages 格式断言 |
