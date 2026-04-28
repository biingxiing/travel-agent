# Sub2API 接口使用说明

服务地址：`http://43.166.169.153:8080/v1`  
性质：ChatGPT 订阅 → OpenAI Responses API 的代理，对外暴露 OpenAI Chat Completions 兼容接口。
代码位置: /Users/bill/Documents/code/sub2api
---

## 可用模型

当前账号只有以下两个模型可用，其余模型请求均报错：

| 模型名 | 说明 |
|--------|------|
| `gpt-5.4` | 主力模型，推荐使用 |
| `gpt-5.4-2026-03-05` | 同模型的版本别名 |

> 其他模型（gpt-4o、gpt-4.1、gpt-4o-mini 等）会被服务端内部映射到 `gpt-5.1`，  
> 但当前 ChatGPT 账号无该模型权限，返回错误：  
> `"The 'gpt-5.1' model is not supported when using Codex with a ChatGPT account."`

---

## 关键限制

### 1. `stream: false` 不可用（服务端 bug）

Sub2API 内部始终以 SSE 流方式调用上游，再根据客户端参数决定是否缓冲。  
在缓冲路径（`stream: false`）中，`SupplementResponseOutput` 存在逻辑缺陷：  
当终端事件的 `output` 数组非空但不含 `output_text` 内容时，不会用累积的 delta 补全，  
导致 `choices[0].message.content` 字段缺失（响应体只有 `{"role":"assistant"}`）。

**结论：必须始终使用 `stream: true`，在客户端自行缓冲拼接内容。**

```bash
# ❌ 错误用法
curl .../chat/completions -d '{"stream": false, ...}'
# → choices[0].message = {"role": "assistant"}   # content 字段缺失

# ✅ 正确用法
curl -N .../chat/completions -d '{"stream": true, ...}'
# → SSE 流，delta.content 正常返回
```

### 2. `response_format` 参数无效

Sub2API 在 Chat Completions → Responses API 转换时不传递 `response_format`，  
Responses API 也不支持该参数，参数会被静默丢弃。

**结论：JSON 输出靠 system prompt 约束，不靠 `response_format`。**

```bash
# ❌ 无效，参数被丢弃
-d '{"response_format": {"type": "json_object"}, ...}'

# ✅ 有效，通过 prompt 约束
-d '{"messages": [{"role":"system","content":"只输出一个完整 JSON 对象"}], ...}'
```

---

## 支持的功能

| 功能 | 状态 | 备注 |
|------|------|------|
| streaming (`stream: true`) | ✅ 正常 | 必须用这个 |
| tools / function calling | ✅ 正常 | tool_calls 通过 SSE delta 返回 |
| system prompt | ✅ 正常 | |
| `temperature` | ✅ 正常 | 范围 0.0–2.0 |
| `max_tokens` | ✅ 正常 | 生效截断输出；`finish_reason` 固定返回 `stop`（而非 `length`） |
| `top_p` | ✅ 正常 | 正常透传，与 temperature 联合控制采样 |
| `user` | ✅ 透传 | 不报错，代理原样转发，无可见效果 |
| `stream_options.include_usage` | ✅ 正常 | 用量在最后一个 chunk 返回 |
| non-streaming (`stream: false`) | ❌ Bug | content 字段缺失 |
| `response_format` | ❌ 无效 | 被静默丢弃，改用 system prompt 约束 |
| `reasoning_effort` / `reasoning.effort` | ✅ 生效 | gpt-5.4 实测支持，上游会按强度做隐藏推理；`"minimal"` 规范化为 `"none"`。推理 token 被合并到 `completion_tokens`，未单独暴露 `reasoning_tokens` |
| `stop` | ❌ 无效 | 停止序列被静默忽略 |
| `frequency_penalty` | ❌ 无效 | 被静默忽略，Responses API 不支持此参数 |
| `presence_penalty` | ❌ 无效 | 被静默忽略，Responses API 不支持此参数 |
| `n` | ❌ 无效 | 始终只返回 1 个候选，多候选不支持 |
| `seed` | ❌ 无效 | 被静默忽略，相同 seed 不保证相同输出 |
| `logprobs` / `top_logprobs` | ❌ 无效 | 响应中不含 logprobs 字段 |
| `max_completion_tokens` | ❌ 无效 | 新版 API 字段，代理不识别，被忽略 |
| 大多数其他模型 | ❌ 无权限 | 仅 gpt-5.4 可用 |

---

## curl 完整示例

### 基础问答（流式）

```bash
curl -N http://43.166.169.153:8080/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "stream": true,
    "temperature": 0.7
  }'
```

### 要求 JSON 输出（通过 prompt 约束）

```bash
curl -N http://43.166.169.153:8080/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "system", "content": "只输出一个完整 JSON 对象，不含其他内容。"},
      {"role": "user",   "content": "生成一个包含 city 和 weather 字段的示例"}
    ],
    "stream": true,
    "temperature": 0.3
  }'
```

### 带 tools 的调用

```bash
curl -N http://43.166.169.153:8080/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [{"role": "user", "content": "查一下北京天气"}],
    "stream": true,
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取城市天气",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {"type": "string", "description": "城市名"}
          },
          "required": ["city"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

### 查询可用模型

```bash
curl http://43.166.169.153:8080/v1/models \
  -H "Authorization: Bearer <YOUR_API_KEY>" | python3 -m json.tool
```

---

## 在代码中使用（Node.js / OpenAI SDK）

```typescript
import OpenAI from 'openai'

const llm = new OpenAI({
  baseURL: 'http://43.166.169.153:8080/v1',
  apiKey: process.env.LLM_API_KEY,
})

// 始终用 stream: true，在客户端缓冲
const stream = await llm.chat.completions.create({
  model: 'gpt-5.4',
  messages: [
    { role: 'system', content: '只输出一个完整 JSON 对象。' },
    { role: 'user',   content: '...' },
  ],
  stream: true,
  stream_options: { include_usage: true },
  temperature: 0.4,
})

let content = ''
for await (const chunk of stream) {
  content += chunk.choices[0]?.delta?.content ?? ''
}
// content 现在是完整响应
```

---

## 环境变量配置

```env
LLM_BASE_URL=http://43.166.169.153:8080/v1
LLM_API_KEY=<your_key>
LLM_MODEL_PLANNER=gpt-5.4
LLM_MODEL_FAST=gpt-5.4
# 可选：思考强度（low | medium | high | xhigh）
LLM_REASONING_EFFORT=xhigh
```

> 目前 PLANNER 和 FAST 都只能用 `gpt-5.4`，账号暂无其他可用模型。
> 设置 `LLM_REASONING_EFFORT` 后，`apps/api/src/llm/logger.ts` 会把 `reasoning_effort` 自动注入到每次 `llm.chat.completions.create` 调用。  
> gpt-5.4 实测支持该参数（强度越高，隐藏推理 token 越多，但都被合并到 `completion_tokens`，未单独暴露 `reasoning_tokens`）。

---

## 启用思考强度（reasoning_effort）

### 直接在请求里传

```bash
curl -N http://43.166.169.153:8080/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [{"role": "user", "content": "9.9 和 9.11 哪个大？"}],
    "stream": true,
    "stream_options": {"include_usage": true},
    "reasoning_effort": "xhigh"
  }'
```

合法值：`"low"` | `"medium"` | `"high"` | `"xhigh"`（`"minimal"` 会被规范化为 `"none"` 丢弃）。

嵌套写法等效：`{"reasoning": {"effort": "xhigh"}}`。

### 在 Node.js / OpenAI SDK 里传

```typescript
const stream = await llm.chat.completions.create({
  model: 'gpt-5.4',
  messages: [...],
  stream: true,
  stream_options: { include_usage: true },
  reasoning_effort: 'xhigh' as any, // OpenAI SDK 类型只到 high，xhigh 需要 cast
})
```

### 验证是否生效

最后一个 chunk 的 `usage.reasoning_tokens` 没有单独暴露，但可以**通过 `completion_tokens` 的变化间接验证**——同一个简短问题，不同强度对比（实测 2026-04-28）：

| reasoning_effort | completion_tokens（"9.11 和 9.9 哪个数字大？只回复一个字" 实测） |
|---|---|
| 不传 | 5 |
| `low` | 120 |
| `high` | 156 |
| `xhigh` | 216 |

完成令牌随强度单调增长，差值即为隐藏的推理 token——证明上游确实按强度做了内部推理。

---

## 完整字段参考（Chat Completions 接口）

> 基于实测验证（2026-04-28），✅ = 正常生效，⚠️ = 接受但无明显效果，❌ = 无效/静默丢弃

| 字段 | 类型 | 枚举值 / 范围 | 状态 | 备注 |
|------|------|--------------|------|------|
| `model` | string | `gpt-5.4` \| `gpt-5.4-2026-03-05` | ✅ | 其他模型报权限错误 |
| `messages` | array | — | ✅ | |
| `messages[].role` | string | `system` \| `user` \| `assistant` \| `tool` | ✅ | |
| `messages[].content` | string | — | ✅ | |
| `messages[].tool_call_id` | string | — | ✅ | role=`tool` 时必填 |
| `messages[].tool_calls` | array | — | ✅ | role=`assistant` 时模型发起的调用 |
| `stream` | boolean | 只能 `true` | ✅ | `false` 有 bug |
| `stream_options.include_usage` | boolean | `true` \| `false` | ✅ | 最后一个 chunk 返回用量 |
| `temperature` | float | `0.0` – `2.0` | ✅ | |
| `max_tokens` | integer | `1` – 模型上限 | ✅ | 生效；但 `finish_reason` 固定返回 `stop` |
| `top_p` | float | `0.0` – `1.0` | ✅ | 正常透传 |
| `tools` | array | — | ✅ | |
| `tools[].type` | string | `function` | ✅ | 目前仅支持 `function` |
| `tools[].function.name` | string | — | ✅ | |
| `tools[].function.description` | string | — | ✅ | |
| `tools[].function.parameters` | object | JSON Schema | ✅ | |
| `tool_choice` | string \| object | `"none"` \| `"auto"` \| `"required"` \| `{"type":"function","function":{"name":"fn"}}` | ✅ | |
| `user` | string | — | ⚠️ | 不报错，无可见效果 |
| `reasoning_effort` | string | `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | ✅ | gpt-5.4 实测支持，强度越高隐藏推理 token 越多；`"minimal"` 规范化为 `"none"` |
| `reasoning.effort` | string | 同上 | ✅ | 嵌套写法，与 `reasoning_effort` 等效 |
| `stop` | string \| array | — | ❌ | 静默忽略 |
| `frequency_penalty` | float | `-2.0` – `2.0` | ❌ | Responses API 不支持，静默丢弃 |
| `presence_penalty` | float | `-2.0` – `2.0` | ❌ | Responses API 不支持，静默丢弃 |
| `n` | integer | `1`（仅有效值） | ❌ | 始终返回 1 个候选 |
| `seed` | integer | — | ❌ | 静默忽略，不保证复现 |
| `logprobs` | boolean | `true` \| `false` | ❌ | 响应中不含该字段 |
| `top_logprobs` | integer | `0` – `20` | ❌ | 同上 |
| `max_completion_tokens` | integer | — | ❌ | 新版字段，代理不识别，被忽略 |
| `response_format` | object | — | ❌ | 静默丢弃，用 system prompt 代替 |

---

## 内部字段说明

### `prompt_cache_key`

**不是**标准 OpenAI Chat Completions API 字段，**不需要**在客户端传递。

sub2api 底层通过 WebSocket 与 ChatGPT Responses API 通信。`prompt_cache_key` 是 sub2api 内部用于维持上游 WebSocket **会话粘连（sticky session）**的标识符——让同一个逻辑会话的多次请求路由到同一个上游连接。

```
客户端（你的代码）
  └─ HTTP POST /v1/chat/completions (stream: true, SSE)
       └─ sub2api 服务器
            └─ WebSocket → ChatGPT Responses API
```

如果请求 body 里带了 `prompt_cache_key`，sub2api 会用它作为会话 ID（优先级低于 `session_id` / `conversation_id` header，高于内容哈希兜底）。对普通 HTTP 调用方无需关心此字段。

---

## 调试 Tips

- 查看原始 SSE 流：`curl -N ... | cat`
- 验证某个模型是否可用：发一条简短消息，看是否返回 `"error"` 字段
- `completion_tokens > 0` 但 `content` 为空 → 触发了 `stream: false` bug，改用 `stream: true`
- `finish_reason` 始终为 `stop`，即使是 `max_tokens` 截断也是如此（代理行为）
