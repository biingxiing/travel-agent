# AI Travel Agent 面试准备材料

---

## 一、简历项目描述（30字以内精炼版）

> **AI 旅行规划 Agent**（个人项目）｜Node.js / Nuxt 3 / LLM
>
> 基于 ReAct 循环的多 Agent 旅行规划系统。后端用 Hono 驱动 LLM 编排引擎，前端用 Nuxt 3 实时流式展示行程。实现了 6 个专职子 Agent（意图提取 → 数据预取 → 行程生成 → 评估 → 精修 → 澄清），通过 SSE 将生成过程实时推送前端，支持多轮对话修改行程。Zod 定义的共享 Schema 保证 API 与前端类型安全。

---

## 二、项目完整介绍（面试开场 2–3 分钟）

### 2.1 项目背景

这是一个 AI 旅行规划助手，用户输入"我想去广东 5 天，2 个人，预算 3000 元"这样的自然语言，系统会自动规划出完整的多日行程，包括交通、住宿、景点、费用估算。整个规划过程对用户透明可见——前端实时流式显示 AI 思考和生成过程，而不是等待一个黑盒结果。

### 2.2 整体架构

项目是 `pnpm` monorepo，分三个包：

- `apps/api`：Hono（Node.js）提供 REST + SSE 接口，承载 AI 编排引擎
- `apps/web`：Nuxt 3（Vue 3）前端，消费 SSE 流，渲染结构化行程
- `packages/shared`：Zod schema 库，同时被 API 和 Web 引用，是类型安全的唯一来源

生产部署用 Docker Compose + Caddy，Caddy 作为同源入口反代前后端，避免跨域 cookie 问题。

### 2.3 核心技术：ReAct 循环多 Agent

AI 引擎（`react-loop.ts`）的核心思路是 **ReAct（Reasoning + Acting）循环**：

1. 编排者 LLM（Orchestrator）看到用户消息 + 当前 Session 状态，决定调用哪个工具
2. 工具执行后结果追加到对话历史，编排者再做下一步决策
3. 循环最多 10 轮，直到生成完成或用户发起新请求

6 个专职子 Agent 工具，按顺序串联：

| 工具名 | 职责 |
|--------|------|
| `call_extractor` | 解析用户消息 → 结构化 TripBrief（目的地、天数、人数、预算…） |
| `call_prefetch_context` | 预取目的地实时数据（天气、节假日、热门景点） |
| `call_generator` | 基于 Brief + 预取数据生成初版行程，流式推送 |
| `call_evaluator` | 评估行程质量，打分并指出问题 |
| `call_refiner` | 根据评估反馈精修行程 |
| `call_clarification` | 信息不足时向用户提问（目的地/预算/偏好） |

并发安全的工具（如 `call_extractor`）可以并行执行，其余串行，由 `tool-execution.ts` 的 `partitionToolCalls` 负责批次划分。

### 2.4 流式通信（SSE）

前端与后端通过 **Server-Sent Events** 通信，`packages/shared/src/events.ts` 定义了 14 种事件类型（Zod discriminated union），包括：

- `agent_step`：某个子 Agent 开始/结束/报错
- `token`：LLM 输出 token 增量
- `plan_partial` / `plan`：行程的局部/最终结果
- `followup`：AI 反问用户
- `item_options`：交通/住宿可选方案
- `done`：本轮结束，附带 token 用量

前端 `useChatStream.ts` 解码 SSE，`chat.ts` store 驱动 UI 状态机（`idle → planning → result / error`）。

### 2.5 工程亮点

**LLM 缓存优化**：每个 Agent 的第一条消息（system prompt）是编译期静态字符串，不含运行时插值，保证命中 OpenAI prefix cache，降低 token 开销。

**Session 持久化**：默认内存 Map 存储，设置 `DATABASE_URL` 后每次保存自动镜像到 Postgres，重启可恢复会话。

**Zod 共享 Schema**：`TripBriefSchema`、`PlanSchema`、`ChatStreamEventSchema` 等在 `packages/shared` 定义一次，API 和 Web 共用，类型错误在编译期暴露。

**认证**：单用户 signed HttpOnly cookie，`AUTH_USERNAME` / `AUTH_PASSWORD` 环境变量配置，API 启动时校验必填环境变量，缺失直接 throw 而不是静默失败。

---

## 三、和面试官聊项目——常见问题与回答思路

### Q1：为什么选 ReAct 循环而不是直接一次调用 LLM 生成行程？

> 一次调用的问题：上下文窗口有限，LLM 很难在单次请求里兼顾「理解意图 → 补全信息 → 查询实时数据 → 生成完整行程 → 评估质量」这多个步骤。ReAct 把这些职责拆给专职 Agent，每个 Agent 只做一件事，可以独立优化 prompt 和模型选型（比如 fast 模型做提取，大模型做生成），也方便在评估不通过时走重试/精修分支而不是重跑全流程。

### Q2：SSE 比 WebSocket 好在哪？这里为什么不用 WebSocket？

> 旅行规划是**单向流**：用户发消息，服务器持续推送生成进度，不需要双向实时通信。SSE 基于普通 HTTP，穿透代理/CDN 更简单，Caddy 无需额外配置；断线重连是浏览器原生支持的。WebSocket 在这个场景是杀鸡用牛刀。

### Q3：多 Agent 并发控制是怎么做的？

> 每个 `SubagentTool` 有 `isConcurrencySafe()` 方法。`tool-execution.ts` 的 `partitionToolCalls` 按顺序扫描工具调用列表，把连续的"并发安全"工具合并成一个批次用 `Promise.all` 执行，遇到非并发安全的工具就单独串行跑。目前 `call_extractor` 是并发安全的（只读 LLM 调用，结果写进 session），`call_generator` 不并发安全（流式写 session.currentPlan）。

### Q4：Zod 在这里起什么作用？和 TypeScript 类型有什么区别？

> TypeScript 类型只在编译期有效，运行时 LLM 的 JSON 输出可以是任意内容。Zod schema 做**运行时解析和验证**：比如 `TripBriefSchema` 里有 `preprocess` 处理旧字段兼容（`destination` → `destinations`），`budget.currency` 有默认值，`days` 必须是非负整数。这保证了 LLM 输出哪怕格式有小偏差也能被自动修正或明确报错，而不是带着 undefined 一路传下去。

### Q5：LLM 缓存优化具体怎么做的？

> OpenAI 的 prefix cache 对**静态前缀**生效。如果 system prompt 每次都注入"当前时间是 xxx""用户名是 yyy"，每次缓存 key 不同，就没有 cache hit。这里的规则是：每个 Agent 的 `messages[0]` 必须是 `const` 字符串，动态的 tripBrief、prefetch 数据放在后续的 user/system 消息里。编排者每轮刷新的 `buildStateContextMessage(session)` 也是最后追加而不是替换第一条，保持前缀稳定。

### Q6：如果让你改进这个项目，你会做什么？

> 几个方向可以聊：
> 1. **工具调用幂等性**：当前 generator 出错会让 LLM 重试，但没有状态 checkpointing，若 prefetch 已跑完再失败会重复 prefetch。可以给每个工具加幂等 key，失败时只重跑失败的步骤。
> 2. **流式行程的渐进渲染**：目前 `plan_partial` 事件已经有了，但前端还可以做「已知部分先渲染，剩余骨架占位」，用户体验更好。
> 3. **多用户 + Row-level locking**：CLAUDE.md 里自己承认了「No row locking yet」，高并发同一 session 有竞态。PG 可以加 `SELECT FOR UPDATE` 解决。
> 4. **可观测性**：目前靠 `loggedStream` 打日志，可以接 OpenTelemetry，对每个 Agent 的延迟、token 用量做 span 追踪。

### Q7：这个项目最难的地方是什么？

> 个人觉得最难的是 **Orchestrator 的 Prompt 工程**。LLM 要在 10 轮内稳定地按预期顺序调用工具——不能 skip prefetch 直接 generate，不能在 brief 没变时重复 extract，不能在 generator 报 idle error 时去调 clarifier。这要求工具描述里写清楚前置条件、跳过条件、错误时重试策略，而且这些约束是自然语言，LLM 不一定 100% 遵守。线上确实出现过 LLM 绕过 prefetch 的情况，靠在 generator 工具的入口检查 session.brief 存在性 + 工具描述里加强约束来修复的。

### Q8：前端和后端如何保证事件类型的一致性？

> `packages/shared/src/events.ts` 里用 Zod discriminated union（`ChatStreamEventSchema`）定义所有 14 种事件。API 用这个 schema 的类型 emit 事件，前端的 `useChatStream.ts` 接收后用同一个 schema 做 `safeParse`，非法事件直接 skip 而不是 crash。两端都 import 同一个 npm workspace 包，加一种新事件类型时 TypeScript 编译器会在没有处理该 case 的地方报错，不会有漏掉的分支。

---

## 四、技术栈速查（面试前复习用）

| 层 | 技术 | 关键点 |
|----|------|--------|
| API 框架 | Hono | 轻量 Web 框架，Edge-ready，typed middleware |
| LLM 客户端 | OpenAI SDK（兼容接口） | stream: true 强制，response_format 靠 prompt 控制 |
| 编排 | 自研 ReAct Loop | MAX_TURNS=10，lastRunId 实现抢占取消 |
| Schema | Zod | 运行时验证 + TypeScript 类型推导，shared package |
| 前端框架 | Nuxt 3（Vue 3） | SSR + Nitro proxy，避免 CORS |
| 状态管理 | Pinia | chat / workspace / auth 三个 store |
| 实时通信 | SSE | 14 种事件，240s idle timeout |
| 持久化 | In-memory Map + Postgres（可选） | DATABASE_URL 环境变量开关 |
| 认证 | signed HttpOnly cookie | 单用户，AUTH_COOKIE_SECRET ≥ 16 chars |
| 部署 | Docker Compose + Caddy | 同源入口，no CORS |
| 测试 | Vitest（colocated *.test.ts） | pnpm -r test 递归跑全套 |
| Monorepo | pnpm workspaces | apps/api, apps/web, packages/shared |
