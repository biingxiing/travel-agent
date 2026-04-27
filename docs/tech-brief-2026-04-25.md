# Travel Agent — 技术架构汇报

> 日期：2026-04-25  
> 范围：前后端框架、请求与行程规划全链路、核心文件索引、当前阶段问题与改造进展

---

## 1. 项目总览

pnpm monorepo，三个工作区：

| 工作区 | 角色 | 运行时 |
|---|---|---|
| `apps/web` | Nuxt 3 前端（Vue 3 + Pinia + Tailwind） | Node.js / 浏览器 |
| `apps/api` | Hono API（SSE + ReAct 规划引擎） | Node.js |
| `packages/shared` | 共享 Zod schema + 纯函数 | 两端共用 |
| `packages/memory-pg` | PostgreSQL 迁移脚本 | 构建/部署 |

---

## 2. 技术栈

### 后端（`apps/api`）

- **框架**：[Hono](https://hono.dev)（轻量 TypeScript Web 框架，支持原生 SSE）
- **LLM 客户端**：OpenAI-compatible SDK（`apps/api/src/llm/client.ts`）；两个模型角色：
  - `FAST_MODEL`（`LLM_MODEL_FAST`，默认 `codex-mini-latest`）：extractor、clarifier、critic
  - `PLANNER_MODEL`（`LLM_MODEL_PLANNER`，默认 `gpt-5.4`）：generator
- **认证**：单用户签名 HttpOnly Cookie（`iron-session` 风格），`AUTH_USERNAME` / `AUTH_PASSWORD` 环境变量
- **外部技能**：flyai CLI（`@fly-ai/flyai-cli`，飞猪旅行 MCP），通过 `execFile` 以子进程方式调用

### 前端（`apps/web`）

- **框架**：Nuxt 3（Vue 3 Composition API，SSR）
- **状态管理**：Pinia（`stores/chat.ts`、`stores/workspace.ts`、`stores/auth.ts`）
- **SSE 消费**：纯原生 Fetch + ReadableStream（`composables/useChatStream.ts`）
- **持久化**：`sessionStorage`（刷新保留草稿/对话/方案；登录跳转前保存，跳转后恢复）

### 共享（`packages/shared`）

- `plan.ts`：`PlanSchema`（行程 JSON 格式）
- `events.ts`：`ChatStreamEventSchema`（14 种 SSE 事件联合类型）
- `brief.ts`：`TripBriefSchema`（用户需求结构）
- `scoring.ts`：`scorePlan()`（纯函数，规则评分，无 LLM）
- `chat.ts`、`session.ts`、`evaluation.ts`：消息/会话/评估类型

---

## 3. 环境拓扑

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│  Vue 3 页面  ←→  Pinia Store  ←→  useChatStream (SSE/Fetch)│
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE (同源)
              ┌────────────▼────────────┐
              │  Nuxt Server (port 3000) │  ← 仅开发模式
              │  /server/api/[...path].ts│     (Nitro 反向代理)
              └────────────┬────────────┘
                           │ 转发到 127.0.0.1:3001
              ┌────────────▼────────────┐
              │  Hono API (port 3001)   │
              │  CORS + Auth + SSE      │
              └────────────┬────────────┘
                    ┌──────┴──────┐
                    │             │
         ┌──────────▼──┐   ┌──────▼──────────┐
         │  LLM API    │   │  flyai CLI       │
         │ (OpenAI-compat)│ │ (execFile子进程) │
         │ fast/planner│   │ Fliggy MCP       │
         └─────────────┘   └──────────────────┘
                    │
         ┌──────────▼──────────┐
         │  PostgreSQL (Neon)   │  ← 可选，DATABASE_URL 控制
         │  sessions 表 (JSONB) │
         └─────────────────────┘
```

**生产模式（Docker Compose）**：Caddy 监听 `:8080` 作为单一入口；  
`/api/*` → API 容器；`/` → Web 容器；同源，HttpOnly Cookie 无需 CORS 特殊处理。

---

## 4. 核心文件索引

### 入口与路由

| 文件 | 职责 |
|---|---|
| `apps/api/src/index.ts` | Hono 应用初始化、CORS、路由挂载、DB 迁移、registry 启动 |
| `apps/api/src/routes/sessions.ts` | REST CRUD + `POST /:id/messages`（SSE）+ `POST /:id/continue` |
| `apps/api/src/routes/auth.ts` | login / logout / `auth/me` |
| `apps/web/server/api/[...path].ts` | Nitro 反向代理（仅开发） |
| `apps/web/pages/index.vue` | 主工作台页面（ChatPanel + PlanningPreview） |
| `apps/web/pages/login.vue` | 登录页，sessionStorage 保存草稿跨跳转 |

### ReAct 规划引擎

| 文件 | 职责 |
|---|---|
| `apps/api/src/agents/react-loop.ts` | 总编排器，状态机驱动六阶段生成器 |
| `apps/api/src/agents/extractor.ts` | 用户意图 → `TripBrief`（FAST_MODEL，JSON mode） |
| `apps/api/src/agents/prefetch.ts` | 调 flyai 预取真实交通/酒店/景点数据 |
| `apps/api/src/agents/generator.ts` | 生成初稿行程（Phase A 工具调用 + Phase B 流式输出） |
| `apps/api/src/agents/evaluator.ts` | 规则评分 + LLM 打分合并 |
| `apps/api/src/agents/critic.ts` | PLANNER_MODEL 逐 item 审查，输出 `itemIssues`/`globalIssues` |
| `apps/api/src/agents/clarifier.ts` | 生成缺失信息问题（FAST_MODEL） |

### 基础设施

| 文件 | 职责 |
|---|---|
| `apps/api/src/session/store.ts` | 双层存储：in-memory Map（主）+ PG 异步镜像 |
| `apps/api/src/persistence/pg.ts` | PG Pool + upsert/load/delete |
| `apps/api/src/auth/middleware.ts` | Cookie 验证，向 Hono context 注入 userId |
| `apps/api/src/registry/bootstrap.ts` | 安装内置 skill（itinerary/budget/poi）+ 加载 `SKILL_DIRS` 外部 skill |
| `apps/api/src/registry/load-dir-skills.ts` | 解析 `SKILL.md` + `execFile` handler 工厂 |
| `apps/api/src/llm/client.ts` | OpenAI SDK 初始化，模型常量 |

### 前端状态

| 文件 | 职责 |
|---|---|
| `apps/web/composables/useChatStream.ts` | SSE 客户端：Fetch + ReadableStream 解析，`onEvent` 回调 |
| `apps/web/stores/chat.ts` | 对话状态、SSE 事件分发（`handleStreamEvent`），sessionStorage 持久化 |
| `apps/web/stores/workspace.ts` | 当前 session/plan/score 状态 |
| `apps/web/stores/auth.ts` | 登录态，未认证自动重定向 |
| `apps/web/composables/useTripHistory.ts` | 历史会话列表，计算 title/destination |

### 数据契约

| 文件 | 职责 |
|---|---|
| `packages/shared/src/events.ts` | 14 种 SSE 事件联合类型（前后端强类型对齐）|
| `packages/shared/src/brief.ts` | `TripBriefSchema`，extractor 和 prefetch 共用 |
| `packages/shared/src/plan.ts` | `PlanSchema`，generator 输出和前端渲染共用 |
| `packages/shared/src/scoring.ts` | `scorePlan()` — 评分纯函数（无 LLM） |

---

## 5. 一次完整请求与行程规划的链路

### 5.1 前端发起（Browser）

```
用户在 PromptComposer.vue 输入 "从北京去顺德玩8天" → 按发送
  ↓
useChatStore.beginPlanning(content)
  - phase = "planning"
  - 用户消息气泡推入 messages[]
  - 空 assistant 占位气泡推入（等待 token 填充）
  - sessionStorage 持久化
  ↓
useChatStream.sendMessage(content, handlers)
  - 若 sessionId 为空 → POST /api/sessions 创建 session，取 session.id
  - POST /api/sessions/:id/messages  { content: "从北京去顺德玩8天" }
  - 开启 ReadableStream 消费 SSE
```

### 5.2 网络传输层

**开发**：浏览器 → `localhost:3000/api/sessions/:id/messages`  
→ Nitro proxy（`/server/api/[...path].ts`）逐字节转发，保留 Cookie header  
→ `127.0.0.1:3001/api/sessions/:id/messages`

**生产**：浏览器 → `http://host:8080/api/sessions/:id/messages`  
→ Caddy 直接路由到 API 容器，Cookie 同源无跨域问题

### 5.3 API 接入层（`routes/sessions.ts`）

```
authMiddleware → 验证签名 Cookie → 取 userId
zValidator 验证请求体 { content: string (min 1) }
sessionStore.get(id, userId)           // 读内存 Map，fallback 读 PG
sessionStore.appendMessage(...)        // 追加 user 消息，写内存 + PG
sessionStore.updateRunId(id)           // 生成新 runId UUID，写入 session.lastRunId
                                       // 旧并发请求检测到 runId 不匹配时自动退出（preemption）
streamSSE(c, handler)                  // HTTP 响应切换为 text/event-stream
→ 立即发送 { type: 'session', sessionId, messageId: runId }
→ 启动 runReactLoop(session, runId)
```

### 5.4 ReAct 规划循环（`agents/react-loop.ts`）

每阶段产出 SSE 事件，实时推送到前端。

#### Phase 0 — Extractor
```
yield { type: 'agent_step', agent: 'extractor', status: 'thinking' }
  ↓
extractBrief(messages, existingBrief)
  LLM 调用（FAST_MODEL, temperature=0, json_object）
  输入：existingBrief + userMessages
  输出：{ brief: TripBrief, intent, changedFields }
  失败时 regex fallback 兜底
  ↓
brief = { destination:"顺德", originCity:"北京", days:8, travelers:1, ... }
session.brief = brief

如果 brief 不完整（无 destination 或 days=0）：
  generateClarification() → yield { type:'clarify_needed', question, reason }
  return  ← stream 结束，等用户回复
```

#### Phase 0.5 — 日期澄清（如缺少 travelDates）
```
同上，reason: 'missing_dates'
```

#### Phase 1 — Prefetch + 初稿生成
```
prefetchFlyaiContext(brief, sessionId)
  ├─ 缓存命中 → 直接返回（key = sessionId:sha1(dest+days+originCity+travelers+dates)）
  └─ 缓存未命中，并行发起（当前实现）：
      ├─ execFile('flyai', ['search-flight', '--origin','北京','--destination','顺德','--dep-date','...'])
      ├─ execFile('flyai', ['search-hotel', '--dest-name','顺德','--check-in-date','...','--check-out-date','...'])
      └─ execFile('flyai', ['search-poi', '--city-name','顺德'])
  每路成功 → 返回 "真实XX数据 (flyai ...):\n<JSON>" 字符串
  flyai 体验模式下：机票价格真实；酒店/景点价格打码（¥3xx）
  ↓
runInitial(brief, messages, prefetched)  ← 两阶段

  Phase A（非流式 Tool Loop，最多 4 轮）：
    LLM（PLANNER_MODEL）输入：
      system: SYSTEM_PROMPT_INITIAL（规划规范）
      system: prefetch 结果（多条）
      user:   TripBrief JSON
      user:   历史对话
      tools:  skillRegistry 中所有 skill 的 function definition（含 flyai）
    tool_choice: 'auto' → LLM 可再主动调用 flyai 补查
    循环直到无 tool_call 或达到轮次上限

  Phase B（流式生成）：
    相同消息 + Phase A 的 tool 调用结果
    tool_choice: 'none'（禁止再调 tool，只出文本）
    stream: true → 逐 delta 推送：
      NL 文字（如"正在为你规划…"）→ yield { type:'token', delta }
      遇到 ```json 标记后停止 token 推送
    完整响应中提取 ```json...``` 代码块
    PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
      normalizePlan 修正：pace 中文→英文枚举、item.type 中文→英文枚举、
                          estimatedBudget.breakdown 对象→数组 等
    yield { type:'plan', plan }
    yield { type:'done', messageId }

session.currentPlan = initial
session.iterationCount = 1
```

#### Phase 2 — ReAct 优化循环（最多 `EVAL_MAX_ITER` 轮，默认 10）

```
while (iterationCount ≤ maxIter):
  1. evaluate(currentPlan, brief)
      ├─ scorePlan(plan)  ← 纯函数，规则打分
      │    检查每个 transport item 是否有航班号/车次、票价
      │    检查每个 lodging item 是否有酒店名、单晚价格
      │    检查 attraction item 是否有开放时间、门票、时长
      │    返回 {overall, transport, lodging, attraction} 各维度分数
      └─ criticReview(plan, brief)  ← LLM 调用（PLANNER_MODEL）
           逐 item 输出 itemIssues（suggestedAction: rewrite/call_flyai/replace/reorder）
           输出 globalIssues、blockers、qualityScore

     combined.overall = ruleWeight * ruleScore + llmWeight * llmScore
     converged = ruleScore.overall ≥ EVAL_THRESHOLD
                 && requiredCategories 全有分

  2. yield { type:'score', overall, transport, lodging, attraction, iteration, converged }

  3. 若 blockers：yield { type:'clarify_needed' }，return

  4. 若 converged：yield { type:'done', converged:true }，return

  5. 若 iterationCount ≥ maxIter：
     yield { type:'max_iter_reached', currentScore, plan }，return

  6. runRefine(currentPlan, report, brief)
      LLM（PLANNER_MODEL）：
        system: SYSTEM_PROMPT_REFINE（只改问题项，不重写整体）
        user:   CurrentPlan + EvaluationReport (itemIssues + globalIssues)
      Phase A: tool loop（可再调 flyai 拿真实数据）
      提取 JSON → PlanSchema.parse → return refined plan
      ↓
  7. session.currentPlan = refined
     yield { type:'plan', plan: refined }
     iterationCount++
```

#### Phase 2 后（finally 块）

```
若有 NL token 积累 → sessionStore.appendMessage(id, {role:'assistant', content})
sessionStore.save(session)
  ├─ memory.set(id, state)
  └─ 若 DATABASE_URL 设置 → upsertSession(state) → Neon PG JSONB 更新
```

### 5.5 前端 SSE 消费（`useChatStream` + `useChatStore`）

```
ReadableStream reader → 按 \n\n 分割 SSE block → 取 data: 行 → JSON.parse

→ chatStore.handleStreamEvent(event):

  session          → workspaceStore.sessionId = event.sessionId
  agent_step       → agentStatus 文字更新（"正在理解需求…" / "正在生成行程…" 等）
  token            → pendingAssistantText += delta
                     → assistant 气泡内容实时更新
  plan             → workspaceStore.currentPlan = plan
                     → chatStore.plan = plan
                     → PlanningPreview 重渲染
  score            → workspaceStore.currentScore、displayScore 更新
  iteration_progress → iteration/maxIterations/loopStatus 更新（进度条）
  clarify_needed   → awaitingClarify 弹出 → ClarifyCard 显示问题
  max_iter_reached → canContinue = true → 允许用户触发 /continue
  done             → loopStatus = null，若 converged → workspace.status = 'converged'
  error            → phase = 'error'，errorMessage 展示
```

---

## 6. 数据契约（前后端强类型对齐）

`packages/shared/src/events.ts` 定义 14 种事件，API emit 和前端 handler 均引用同一类型：

| 事件类型 | 触发时机 | 关键字段 |
|---|---|---|
| `session` | SSE 建立瞬间 | sessionId, messageId |
| `agent_step` | 每个 agent 开始 | agent, status |
| `token` | generator 流式输出 | delta |
| `plan` | 初稿完成 / 每轮 refine 后 | plan (PlanSchema) |
| `plan_partial` | 流式解析中（部分行程） | plan |
| `score` | 每轮评估后 | overall/transport/lodging/attraction/iteration |
| `iteration_progress` | refine 轮次开始 | iteration/maxIterations/currentScore/targetScore |
| `clarify_needed` | 缺信息 / blocker | question, reason, defaultSuggestion? |
| `max_iter_reached` | 达到最大轮次 | currentScore, plan |
| `done` | 正常结束 | messageId, converged? |
| `error` | 异常 | code, message |
| `item_options` | 多选方案（保留） | selections |
| `followup` | 跟进问（保留） | question |

---

## 7. 持久化机制

### 会话状态（`SessionState`）

```
memory Map  ←→  Neon PostgreSQL
               sessions 表
               ├─ brief       JSONB   (TripBrief)
               ├─ messages    JSONB   (Message[])
               ├─ current_plan JSONB  (Plan | null)
               ├─ current_score JSONB (ItineraryScoreSummary | null)
               └─ status / iteration_count / last_run_id / ...
```

读取优先内存（热路径），冷启动时从 PG 加载。  
`DATABASE_URL` 未设置时退化为纯内存（重启丢失）。

### 前端草稿（`sessionStorage`）

跨登录跳转保留：对话消息、draft 文本、phase、plan 快照。  
刷新页面保留；关闭 Tab 清除。

### Prefetch 缓存

进程内 `Map`，key = `sessionId:sha1(dest+days+originCity+travelers+dates)`。  
同会话多轮 refine 不重复调 flyai（brief 稳定后 hash 不变）。  
进程重启清空。

---

## 8. 当前阶段问题与改造进展

### 已确认的三层根因（影响行程数据质量）

| 问题 | 原因 | 影响 |
|---|---|---|
| 酒店/火车价格打码（`¥3xx`/`7xx`） | flyai **体验模式**，未配置 `FLYAI_API_KEY` | 行程里的酒店/交通价格只有占位符 |
| 国内交通只查机票，不查火车 | `prefetch.ts` 只有 `search-flight`，无 `search-train` | 高铁出行无真实车次和票价 |
| 多目的地第二城无数据 | brief 只有单 `destination` 字段；prefetch 不处理中途城市 | 顺德→珠海、珠海酒店/POI 等完全没有 flyai 数据 |

### 升级 flyai 正式模式（立即可做，5 分钟）

```bash
# 1. 前往 https://flyai.open.fliggy.com/ 申请 API Key
# 2. 在 apps/api/.env 添加：
FLYAI_API_KEY=<key>
FLYAI_SIGN_SECRET=<secret>   # 如果平台提供
# 3. 重启 API
# 验证：flyai search-hotel --dest-name 北京 --check-in-date 2026-05-02 --check-out-date 2026-05-03
#  → price 字段不再是 ¥xxx 占位符即成功
```

### 多目的地 + 补查火车（当前阶段改造，进行中）

**Schema 改造方向**（已决策）：`destination: string` → `destinations: string[]`，zod preprocess 兼容旧数据。  
**影响文件**：`packages/shared/src/brief.ts`、`plan.ts`、`extractor.ts`、`react-loop.ts`、`prefetch.ts`、`generator.ts`、前端 composables/pages、所有 `*.test.ts`。  
**prefetch 新逻辑**：  
- 为每对相邻城市（含 origin→第一城、末城→origin）**同时** `search-flight` + `search-train`  
- 为每个目的地 `search-hotel` + `search-poi`  
- 单目的地含 origin：6 个并行任务；N 个目的地：`(N+1)×2 + N×2` 个任务

---

## 9. 测试覆盖现状

| 套件 | 测试文件 | 关键断言 |
|---|---|---|
| shared | `plan.test.ts`、`brief.test.ts` | Schema 解析、normalizer |
| extractor | `extractor.test.ts` | 单目的地解析、originCity 合并 |
| generator | `generator.test.ts` | JSON 提取、pace/type 归一化 |
| evaluator/critic | `evaluator.test.ts`、`critic.test.ts` | 评分合并、converged 判断 |
| prefetch | `prefetch.test.ts` | 任务数、cache hit |
| react-loop | `react-loop.test.ts` | 缺 destination 触发 clarify；正常流程 |

运行全套：`pnpm -r test`  
多目的地改造完成后，约 30 处 `destination: "X"` 断言需改为 `destinations: ["X"]`。
