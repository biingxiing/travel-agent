# Gap Closure Roadmap：从高完成度 MVP 到生产级 AI 旅行 Agent

> 本文是 master roadmap，覆盖 5 个里程碑（M0–M4）。每个里程碑达到 "可独立验收 + 可发布" 的程度后，再为该里程碑单独写 implementation plan（按项目 `docs/superpowers/plans/` 惯例）逐 Task 落地。

**Goal:** 在不重写架构的前提下，依次解决 2026 年生产级 travel agent 的 6 项基础线缺口（真实数据、Observability、并发安全、视觉化、长期记忆、信任外显），让本项目从 demo-grade MVP 演进到能上线收用户的产品。

**Non-Goals:**
- 不做 booking 闭环（合规/PCI 成本远超 MVP 预算，先做 affiliate 跳转即可）
- 不重写编排层（不切 LangGraph/Mastra；现有 `react-loop.ts` 设计已经足够好，只补外围设施）
- 不做多语种 i18n（靠 LLM 已足够，国际化 UI 暂不投入）

---

## 当前位置（事实清单）

| 维度 | 状态 | 论据 |
|---|---|---|
| 多 agent 编排 | ✅ 真有 | `apps/api/src/agents/react-loop.ts` 5 阶段 AsyncGenerator |
| ReAct 收敛判据 | ✅ 真有（独特优势） | `scoring.ts:259-264` `isConverged` |
| SSE 14 事件契约 | ✅ 工业级 | `packages/shared/src/events.ts:47-99` discriminatedUnion |
| 真实数据接入 | ❌ **占位** | `registry/bootstrap.ts:18-56` 三个 handler 全部 `note: 'Handled by LLM'` —— **信任炸弹** |
| LLM Observability | ❌ 全无 | `llm/client.ts:27` 裸 OpenAI client，无 trace/重试/计费 |
| Session 并发安全 | ❌ race | `session/store.ts:7` 全局 Map + 异步 PG upsert，无锁 |
| 跨会话记忆 | ❌ 全无 | `SessionStateSchema` 仅单 session；`extractor` 每次从空抽 brief |
| 交互地图 | ❌ | `plan.ts:9-14` schema 已有 lat/lng（可选）但 generator 不填、前端不画 |
| 多用户/协作 | ❌ | `auth/config.ts` 单 username/password |
| 多模态输入 | ❌ | `ChatRequestSchema` 仅 text |
| 评分/收敛闭环 | ✅ 真有 | `evaluator.ts:21-30` rule + critic 加权 |

---

## 整体演进路径

```
M0  Triage（1 天）        删占位 skill / 修关键 race / critic fallback
                          └─ 让现状不再"骗用户"
M1  Real Data（2 周）     Duffel + Google Places 替换 3 个 no-op skill
                          └─ 让 plan 里的航班、酒店、POI 是真的
M2  Observability（4 天）  Langfuse trace + eval 回归集 baseline
                          └─ 让后续 prompt/model 改动可度量
M3  Map & Trust UI（1 周） generator 强约束 lat/lng + 前端 PlanMap 组件
                          └─ 把"信任"从 score 数字升级为视觉验证
M4  Memory（1 周）         user_profile 表 + extractor 消费跨会话偏好
                          └─ 把 single-shot 工具升级为"懂你的助手"
```

每个里程碑都可单独发布、独立给用户带价值、且都解决 gap 报告里点名的具体风险。

---

## M0 — Triage（1 天，必须先做）

**动机：** 当前 3 个内置 skill 是 placeholder，但仍出现在 `GET /api/registry`，会让 LLM 调用一个返回 `{ note: 'Handled by LLM' }` 的工具——LLM 看到 note 后被引导继续幻觉。同一时间 `critic.ts` 失败时返回全 0 分，污染 combined score；同 session 并发 POST 会互相覆盖。这三件事都是 5–50 行代码能改好的高 ROI 修复。

**变更点：**
- `apps/api/src/registry/bootstrap.ts:6-56`
  - 删掉三个 `install(...)` 调用（或在 `SkillManifest` 加 `hidden: true` 字段，bootstrap 阶段跳过注册到 registry list）
  - 保留 `SKILL_DIRS` 加载分支不动
- `apps/api/src/agents/critic.ts:58-61`
  - LLM 失败时**不要**返回 `qualityScore=0`；改为 `qualityScore: rule.scoreRaw`（沿用规则分），同时 emit 一个 `critic_failed` 事件让前端可以告知用户"这一轮没拿到 LLM 评审，仅按规则评分"
  - 需要 `events.ts` 新增 `critic_failed` 事件 variant（保持向后兼容，前端 `useChatStream.ts` 老版本忽略未知事件即可）
- `apps/api/src/session/store.ts:11-17`
  - 在 `persist()` 外层加一个 per-session 串行队列（`Map<sessionId, Promise<void>>`），保证同一 session 的写入按到达顺序排队；这是 P1.5 修，非完整事务，但能消掉 90% 的 race，给 M2 之后的 PG-first 改造争取时间
- `apps/api/src/routes/sessions.ts`
  - `POST /:id/messages` 与 `POST /:id/continue` 进入前先调 `sessionStore.updateRunId()` 抢占；当前已有抢占语义但未拒绝旧请求——让旧请求 emit 一个 `cancelled` 事件并立即结束，而不是继续静默写入

**验收标准：**
- `GET /api/registry` 不再返回 itinerary/budget/poi 三个 placeholder
- 单 session 并发 10 个 POST，最终 `messages` 数 == 10、`currentPlan` 是最后一个完成的 run 的产物（写测试 `apps/api/src/session/store.race.test.ts`）
- LLM critic 主动失败（mock 抛错）时，`combined.qualityScore` 等于 `combined.ruleScore`，不再为 0
- `pnpm -r test` 全绿，`pnpm smoke:planner:ui` 通过

**估时：** 1 个工作日。

---

## M1 — Real Data（2 周，最高 impact）

**动机：** Top 5 改进项第 1 名。当前 `prefetch.ts` 调外部 `flyai` skill（如果配了 `SKILL_DIRS`），否则直接 fallback 空上下文，generator 全靠 LLM 编。这是产品上线前必须解决的最大缺口。

**设计决策：**
- **数据源选择：** 航班 + 酒店走 **Duffel**（onboarding 1 天，REST API 现代，支持沙箱）；POI 走 **Google Places (New)**（免费层 500 次/天/类别够 MVP，覆盖全球、有 lat/lng/photos/reviews）；签证/天气延后。
- **接入形态：** 走现有 `SkillManifest` 接口（`apps/api/src/registry/types.ts`）+ `execFile` 模式可以保留，但本里程碑直接用 in-process handler 接 Duffel/Places SDK，省一次进程启动延迟。等 M5 之后再考虑统一切到 MCP。
- **缓存层：** Duffel/Places 都有调用配额，用 `apps/api/src/lib/skill-cache.ts`（新增）做 key=`(skill, normalizedArgs)` 的 LRU + TTL，命中即跳过外部调用。MVP 用 in-memory，后续可换 Redis。
- **降级：** 任何外部调用失败 → emit 一个 `skill_degraded` 事件（events.ts 新增），且 prefetch 仍向下传一个空但**带显式 `degraded: true` 标记**的 context，generator 看到 `degraded` 必须在 plan 的 `disclaimer` 里说"航班/酒店为示例，请以实时查询为准"，而不是装作有数据。

**变更点：**
- `apps/api/src/registry/bootstrap.ts` 重写：注册 3 个真实 skill
  - `flights.search` (Duffel `offer-requests`)
  - `lodging.search` (Duffel stays)
  - `places.search` (Google Places nearbySearch / textSearch)
- `apps/api/src/lib/skill-cache.ts` [NEW]
- `apps/api/src/agents/prefetch.ts` 改造调用入口：从 "外部 skill 优先" 改为 "内置 skill 优先 + 外部 SKILL_DIRS 仍可覆盖"
- `packages/shared/src/events.ts` 新增 `skill_degraded` 与 `skill_cache_hit` 事件
- `packages/shared/src/plan.ts:9-14`：`location.lat/lng` 由可选改为**当 type∈{attraction, lodging} 时必填**（用 zod refine 表达）
- `apps/api/.env.example`：加 `DUFFEL_API_KEY`、`GOOGLE_PLACES_API_KEY`、`SKILL_CACHE_TTL_MS`

**验收标准：**
- 给定 brief="北京 → 大阪 5 天 2 人"，`prefetch` 调用回的 flights 中至少 3 个航班号能在 Duffel 沙箱里反查到
- generator 输出的 `dailyPlans[].items` 中 `type='attraction'` 项 100% 有 lat/lng（zod 强校验通过）
- 任意一个外部 API 主动 mock 抛错 → 前端收到 `skill_degraded` 事件，最终 plan 的 disclaimer 包含降级说明，且 `currentPlan` 仍能落地（不是 500）
- 新增 `apps/api/tests/integration/m1-real-data.test.ts` 全绿
- 在工作站手动跑一次完整 flow，目测 5 个景点的 lat/lng 在 Google Maps 上落点合理

**估时：** Duffel 接入 4 天 + Places 接入 2 天 + cache + degrade 路径 2 天 + 测试 + 调 prompt 让 generator 真用上 prefetch 数据 4 天 = ~2 周。

**风险：**
- Duffel/Places 实际 schema 可能与文档有 drift，预留 1 天调试
- LLM 看到 prefetch context 不一定真用，需要在 generator 系统提示里强约束 "你必须只从 prefetch.flights 里挑航班，不准编新的"——这条 prompt 改好了等于做完一半

---

## M2 — Observability & Eval Baseline（4 天）

**动机：** M1 落地后，每改一次 prompt 都要回归测试，否则 quality 会飘。**没有 trace 和 baseline，M3 之后所有迭代都是盲飞。** Top 5 改进项第 2 名（impact 高、effort S）。

**设计决策：**
- **平台选 Langfuse**（自托管 Docker 一份就行；Helicone 是代理模式更轻但要改 base URL，对 OpenAI-compatible custom endpoint 有兼容性风险）
- **Trace 层级：** 一次 ReAct loop = 一个 root trace；extractor / prefetch / generator / evaluator / critic 各为 child span；每次 `llm.chat.completions.create` 是 leaf span
- **Eval 集：** 在 `apps/api/tests/eval/cases/` 下放 ~20 个 brief（覆盖国内/国际、家庭/独自、长/短行程），每个 case 跑完后断言：rule score ≥ 80、必需 categories 齐全、外部 API 调用次数 ≤ 阈值。这是 GitHub Actions 上的回归门禁

**变更点：**
- `apps/api/src/llm/client.ts:27` 包一层 Langfuse OpenAI wrapper
- `apps/api/src/agents/react-loop.ts` 在每个阶段开始/结束打 span（用 `trace.startSpan()`）
- `apps/api/src/lib/observability.ts` [NEW] 集中管理 trace / metric / 结构化日志
- `apps/api/tests/eval/` [NEW] 离线 eval 框架（基于 vitest，跑慢一点没关系）
- `package.json` 新增 `pnpm eval:planner` script
- `.github/workflows/eval.yml` [NEW] PR 时跑一遍 eval，分数低于 baseline 的 PR 自动评论

**验收标准：**
- 一次完整请求在 Langfuse 后台展示为单个嵌套 trace，每层 latency / token / cost 可见
- `pnpm eval:planner` 跑完 20 个 case 给出一份 markdown 报告（pass/fail + 平均分 + 与上一次 baseline 的 delta）
- baseline 入库到 `apps/api/tests/eval/baseline.json`，M3 起每个 PR 都有数字对比

**估时：** Langfuse self-host + wrapper 1 天；trace 注入 1 天；eval 集 + 框架 1.5 天；CI 0.5 天 = 4 天。

---

## M3 — Map & Trust UI（1 周）

**动机：** Top 5 第 4 名。`plan.ts` 已有 lat/lng，前端却只渲染文本。把"信任"从一个 score 数字升级为可视化验证（用户能直接看到"这个酒店在车站旁边"），是从 demo 跳到产品的关键观感升级。也是 Mindtrip / Gemini Travel 的护城河之一。

**设计决策：**
- **地图选 MapLibre GL + OpenStreetMap tiles**（不要 Mapbox：免费层窄、域名锁；不要 Leaflet：3D / pitch / 矢量样式弱）。OSM tiles 用 [maptiler.com](https://maptiler.com) 免费 100k requests/月够 MVP
- **交互：** 左侧 chat、中间 plan 时间线、右侧 map（响应式断点：< 1280 px map 收成抽屉）。点击 plan item → map 飞到该点 + 弹卡片；hover plan item → map marker 高亮
- **信任外显：** 在每个 day card 顶部展示这一天的 rule score + critic 主要 issue（来自 `evaluator` 已有数据），不是隐藏在 score number 里。让用户看到"AI 知道自己在哪里不够好"

**变更点：**
- `apps/web/components/PlanMap.vue` [NEW]
- `apps/web/components/PlanningPreview.vue` 改造：增加右侧 map slot
- `apps/web/composables/usePlanMap.ts` [NEW] 管 map state、marker 同步、飞行动画
- `apps/web/pages/index.vue` 调整 grid 布局
- `apps/api/src/agents/generator.ts` 系统提示加 "lat/lng 必须填，不许编"，并在 `extractJsonCodeBlock` 后做 zod 强校验，不通过则 refine 再来一次（最多 2 次）
- 新增 `apps/web/components/__tests__/PlanMap.spec.ts`

**验收标准：**
- 一个 5 天行程的 plan，所有 attraction/lodging item 都在地图上落点；点 item → map 飞行；hover item → marker 闪
- 移动端 < 768 px 不渲染 map（避免性能问题），用一个"在大屏查看地图"提示
- generator 输出强校验：lat/lng 缺失或 (0,0) 异常值的 plan 不会进入 evaluator，自动 refine

**估时：** 1 周（map 集成 2 天 + 交互 2 天 + generator prompt 调优 + 校验 1 天 + 测试 + UI polish 2 天）。

---

## M4 — Long-term Memory（1 周）

**动机：** Top 5 第 5 名。当前 `extractor.ts:78-82` 每次从空抽 brief，用户每次会话都要重新说"我吃素 / 不爱坐火车 / 预算 2 万以内"。Layla / Mindtrip 都已经做这件事——Mindtrip 是基于 session 偏好，Layla 是"全程陪伴"。

**设计决策：**
- **形态：** 不上 Mem0/Zep（依赖增加、自托管复杂度高），自建一张 `user_profile` 表 + 一个 distill agent。MVP 阶段简单 KV 足矣，等 user 量起来再换通用记忆框架
- **更新时机：** 每次 session `status: completed` 时跑一次 distill（FAST_MODEL，便宜）：把这次的 brief + 用户最终 accept 的 plan 摘成 `~20 项 preference key/value`，merge 进 user_profile
- **使用时机：** `extractor.ts` 起手把 user_profile 当作 system 上下文喂入 LLM，brief 抽取出来后可被用户当前 session 的话覆盖（"这次想吃肉"覆盖 "通常吃素"）
- **隐私：** 用户可在 settings 页面查看/删除全部 profile，符合最小信任原则；未来上多用户时这就是 GDPR-friendly 的雏形

**变更点：**
- `packages/memory-pg/migrations/` 新增 `user_profile` 表（user_id PK、preferences jsonb、updated_at）
- `apps/api/src/persistence/pg.ts` 新增 `loadUserProfile` / `mergeUserProfile`
- `apps/api/src/agents/distill.ts` [NEW]
- `apps/api/src/agents/react-loop.ts` 在 session 转 completed 时触发 distill（fire-and-forget，不阻塞响应）
- `apps/api/src/agents/extractor.ts:78-82` 接受 `userProfile` 参数注入 system prompt
- `packages/shared/src/session.ts` 新增 `UserProfileSchema`
- 前端 `apps/web/pages/settings/profile.vue` [NEW]：列出当前 profile 字段，提供"忘记这条"按钮

**验收标准：**
- 用户第一次说"我吃素，不爱坐火车" → 完成一次行程 → 第二次新建 session 不再说，extractor 抽出的 brief 仍然带 vegetarian/avoid_train
- profile distill 在 session complete 后 5 秒内异步完成，不影响主流程 latency
- 用户在 settings/profile 删除一条 → 下一次 extractor 不再带

**估时：** schema + 持久化 1 天；distill agent + prompt 调 2 天；extractor 注入 + 全链路联调 1.5 天；前端 settings 1 天；测试 1.5 天 = 7 天。

---

## 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| Duffel/Places API 配额或停服 | M1 设计的 `degraded` 路径让系统降级到纯 LLM 模式，不致雪崩 | 关闭 `DUFFEL_API_KEY` 即回到 M0 状态 |
| Langfuse self-host 维护成本 | 评估 1 周后若太重可切 cloud 版（每月 ~$50） | wrapper 抽象在 `lib/observability.ts`，切换只改一处 |
| Map tiles 免费额度耗尽 | MapTiler 100k/月足以支持千 DAU；监控接近上限时切自建 OSM tile server | 移除 PlanMap 组件，functionality-loss only |
| 跨会话记忆引入隐私争议 | settings 页面给"忘记/导出"，符合 GDPR 雏形 | drop `user_profile` 表，extractor 退化即可 |
| 改 prompt 后 plan quality 下降 | M2 的 eval baseline 会在 PR 拦截 | 任何 PR 都能 git revert 单个 commit |

---

## 总结：1 个月内做完 M0–M2，2 个月内做完 M0–M4

**最小化路径（如果只能投 1 周）：** M0（1 天）+ M1 的 Google Places only（4 天，POI 比航班机酒更通用、配额更友好）。这一周做完后产品已经从"信任炸弹的 demo"变成"能给朋友试用的 alpha"。

**推荐路径（4 周）：** M0 → M1 → M2 → M3。结束时本项目在 12 维度对比矩阵里能从当前 3/12 提升到 ~7/12，对标 Wonderplan / GuideGeek 同档位，且独占"评分闭环 + 可观测 trace"两项市面上少见的差异化能力。

**头部追赶路径（8 周）：** 加上 M4，再单独立 plan 做"多用户协作"（替换 single-user auth → workspace 概念，预估 2 周），可以达到 ~10/12，距 Mindtrip 仅差预订闭环和多模态输入两项需要重投资的能力。

落地节奏建议：M0 这周内做掉，M1 下个 sprint 立单独 plan（按本仓库 `docs/superpowers/plans/<date>-m1-real-data.md` 模板细化到 Task 级别）启动。
