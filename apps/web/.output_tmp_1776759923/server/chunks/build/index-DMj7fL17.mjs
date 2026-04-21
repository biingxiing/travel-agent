import { v as vueExports, s as serverRenderer_cjs_prodExports, b as useRuntimeConfig } from './server.mjs';
import { storeToRefs, defineStore } from 'pinia';
import '../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../routes/renderer.mjs';
import 'vue-bundle-renderer/runtime';
import 'vue/server-renderer';
import 'unhead/server';
import 'devalue';
import 'unhead/utils';
import 'vue';
import 'unhead/plugins';
import 'node:stream';

const _sfc_main$3 = /* @__PURE__ */ vueExports.defineComponent({
  __name: "ChatPanel",
  __ssrInlineRender: true,
  props: {
    messages: {},
    phase: {},
    agentStatus: {},
    streamSteps: {}
  },
  setup(__props) {
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<section${serverRenderer_cjs_prodExports.ssrRenderAttrs(vueExports.mergeProps({ class: "conversation-shell" }, _attrs))}><div class="panel-title"><div><p class="panel-kicker">Conversation</p><h2>\u5BF9\u8BDD\u6D41</h2></div><span class="panel-badge">Live</span></div><div class="conversation-list"><!--[-->`);
      serverRenderer_cjs_prodExports.ssrRenderList(__props.messages, (message) => {
        _push(`<article class="${serverRenderer_cjs_prodExports.ssrRenderClass([`bubble-${message.role}`, "bubble"])}"><p class="bubble-content">${serverRenderer_cjs_prodExports.ssrInterpolate(message.content)}</p></article>`);
      });
      _push(`<!--]-->`);
      if (__props.phase === "planning") {
        _push(`<article class="bubble bubble-assistant bubble-progress"><div class="progress-inline"><span class="stream-dot"></span><span class="stream-dot"></span><span class="stream-dot"></span><span>${serverRenderer_cjs_prodExports.ssrInterpolate(__props.agentStatus)}</span></div>`);
        if (__props.streamSteps.length) {
          _push(`<ul class="progress-list"><!--[-->`);
          serverRenderer_cjs_prodExports.ssrRenderList(__props.streamSteps, (step) => {
            _push(`<li>${serverRenderer_cjs_prodExports.ssrInterpolate(step)}</li>`);
          });
          _push(`<!--]--></ul>`);
        } else {
          _push(`<!---->`);
        }
        _push(`</article>`);
      } else {
        _push(`<!---->`);
      }
      _push(`</div></section>`);
    };
  }
});
const _sfc_setup$3 = _sfc_main$3.setup;
_sfc_main$3.setup = (props, ctx) => {
  const ssrContext = vueExports.useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("components/ChatPanel.vue");
  return _sfc_setup$3 ? _sfc_setup$3(props, ctx) : void 0;
};
const _sfc_main$2 = /* @__PURE__ */ vueExports.defineComponent({
  __name: "PlanningPreview",
  __ssrInlineRender: true,
  props: {
    plan: {},
    phase: {},
    agentStatus: {},
    errorMessage: {}
  },
  setup(__props) {
    function itemIcon(type) {
      if (type.includes("food") || type.includes("\u9910")) {
        return "\u{1F35C}";
      }
      if (type.includes("transport") || type.includes("\u4EA4\u901A") || type.includes("flight")) {
        return "\u{1F6EB}";
      }
      return "\u{1F4CD}";
    }
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<section${serverRenderer_cjs_prodExports.ssrRenderAttrs(vueExports.mergeProps({ class: "result-shell" }, _attrs))}><div class="panel-title"><div><p class="panel-kicker">Plan Output</p><h2>\u884C\u7A0B\u7ED3\u679C\u5361\u7247</h2></div><span class="${serverRenderer_cjs_prodExports.ssrRenderClass([{ active: __props.phase === "planning" }, "status-chip"])}">${serverRenderer_cjs_prodExports.ssrInterpolate(__props.phase === "planning" ? __props.agentStatus : "Ready")}</span></div>`);
      if (__props.phase === "error") {
        _push(`<div class="result-empty result-error"><div class="empty-icon">\u{1F635}</div><p>${serverRenderer_cjs_prodExports.ssrInterpolate(__props.errorMessage || "\u751F\u6210\u51FA\u4E86\u70B9\u95EE\u9898\uFF0C\u7A0D\u7B49\u4E00\u4E0B\u518D\u53D1\u4E00\u6B21\u5427 \u{1F64F}")}</p></div>`);
      } else if (__props.plan) {
        _push(`<div class="result-content"><div class="plan-header-card"><div><div class="plan-title">${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.title)}</div><div class="plan-subtitle">${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.destination)} \xB7 ${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.days)} \u5929 \xB7 ${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.travelers)} \u4EBA </div></div><button type="button" class="copy-button">\u{1F4CB} \u590D\u5236</button></div>`);
        if (__props.plan.estimatedBudget) {
          _push(`<div class="budget-strip"><span>\u9884\u7B97\u4F30\u7B97</span><strong>${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.estimatedBudget.currency)} ${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.estimatedBudget.amount)}</strong></div>`);
        } else {
          _push(`<!---->`);
        }
        _push(`<!--[-->`);
        serverRenderer_cjs_prodExports.ssrRenderList(__props.plan.dailyPlans, (day) => {
          _push(`<article class="result-day-card"><div class="result-day-head"><div><h3>Day ${serverRenderer_cjs_prodExports.ssrInterpolate(day.day)} \xB7 ${serverRenderer_cjs_prodExports.ssrInterpolate(day.theme)}</h3></div></div><!--[-->`);
          serverRenderer_cjs_prodExports.ssrRenderList(day.items, (item) => {
            _push(`<div class="result-day-item"><span class="result-time">${serverRenderer_cjs_prodExports.ssrInterpolate(item.time)}</span><span class="result-icon">${serverRenderer_cjs_prodExports.ssrInterpolate(itemIcon(item.type))}</span><div class="result-item-body"><strong>${serverRenderer_cjs_prodExports.ssrInterpolate(item.title)}</strong><p>${serverRenderer_cjs_prodExports.ssrInterpolate(item.desc)}</p>`);
            if (item.tips) {
              _push(`<small>${serverRenderer_cjs_prodExports.ssrInterpolate(item.tips)}</small>`);
            } else {
              _push(`<!---->`);
            }
            _push(`</div></div>`);
          });
          _push(`<!--]--></article>`);
        });
        _push(`<!--]-->`);
        if (__props.plan.tips.length) {
          _push(`<div class="tips-card"><p class="tips-title">\u51FA\u884C\u5EFA\u8BAE</p><ul><!--[-->`);
          serverRenderer_cjs_prodExports.ssrRenderList(__props.plan.tips, (tip) => {
            _push(`<li>${serverRenderer_cjs_prodExports.ssrInterpolate(tip)}</li>`);
          });
          _push(`<!--]--></ul></div>`);
        } else {
          _push(`<!---->`);
        }
        _push(`<div class="disclaimer-card">${serverRenderer_cjs_prodExports.ssrInterpolate(__props.plan.disclaimer)}</div></div>`);
      } else if (__props.phase === "planning") {
        _push(`<div class="result-content"><div class="planning-card"><div class="planning-label">\u884C\u7A0B\u751F\u6210\u4E2D</div><div class="skeleton-card"><h3>Day 1 \xB7 \u521D\u6B65\u89C4\u5212\u4E2D</h3><p>\u6B63\u5728\u4E3A\u4F60\u8865\u9F50\u6BCF\u65E5\u884C\u7A0B\u5B89\u6392\u548C\u9884\u7B97\u5EFA\u8BAE\u2026</p></div><div class="skeleton-card muted"><h3>Day 2 \xB7 \u7EE7\u7EED\u751F\u6210</h3></div><div class="skeleton-card muted dashed"><h3>Day 3 \xB7 \u89C4\u5212\u4E2D\u2026</h3></div></div></div>`);
      } else {
        _push(`<div class="result-empty"><div class="empty-icon">\u{1F9ED}</div><p>\u884C\u7A0B\u89C4\u5212\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\uFF0C\u5148\u8BF4\u8BF4\u4F60\u60F3\u53BB\u54EA\u3002</p></div>`);
      }
      _push(`</section>`);
    };
  }
});
const _sfc_setup$2 = _sfc_main$2.setup;
_sfc_main$2.setup = (props, ctx) => {
  const ssrContext = vueExports.useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("components/PlanningPreview.vue");
  return _sfc_setup$2 ? _sfc_setup$2(props, ctx) : void 0;
};
const _sfc_main$1 = /* @__PURE__ */ vueExports.defineComponent({
  __name: "PromptComposer",
  __ssrInlineRender: true,
  props: {
    draft: {},
    loading: { type: Boolean }
  },
  emits: ["submit", "updateDraft", "usePrompt"],
  setup(__props, { emit: __emit }) {
    const suggestedPrompts = [
      "\u5E2E\u6211\u89C4\u5212 5 \u5929\u4E1C\u4EAC\u884C\uFF0C2 \u4E2A\u4EBA\uFF0C\u9884\u7B97 1 \u4E07\uFF0C\u559C\u6B22\u7F8E\u98DF\u548C\u52A8\u6F2B",
      "\u4E0B\u5468\u672B\u60F3\u53BB\u676D\u5DDE\u73A9 3 \u5929\uFF0C\u4E0D\u60F3\u592A\u7D2F",
      "\u6625\u8282\u5E26\u7238\u5988\u53BB\u4E09\u4E9A 6 \u5929\uFF0C\u6015\u51B7",
      "\u4E00\u4E2A\u4EBA\u53BB\u5317\u6D77\u9053 7 \u5929\uFF0C\u6ED1\u96EA + \u6CE1\u6E29\u6CC9"
    ];
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<section${serverRenderer_cjs_prodExports.ssrRenderAttrs(vueExports.mergeProps({ class: "hero-input-shell" }, _attrs))}><div class="prompt-row"><!--[-->`);
      serverRenderer_cjs_prodExports.ssrRenderList(suggestedPrompts, (prompt) => {
        _push(`<button type="button" class="prompt-pill">${serverRenderer_cjs_prodExports.ssrInterpolate(prompt)}</button>`);
      });
      _push(`<!--]--></div><div class="composer-box"><textarea rows="3" placeholder="\u8BF4\u8BF4\u4F60\u7684\u51FA\u884C\u9700\u6C42\uFF0C\u76EE\u7684\u5730 / \u5929\u6570 / \u4EBA\u6570 / \u9884\u7B97 / \u504F\u597D\u2026">${serverRenderer_cjs_prodExports.ssrInterpolate(__props.draft)}</textarea><button type="button" class="send-button"${serverRenderer_cjs_prodExports.ssrIncludeBooleanAttr(__props.loading) ? " disabled" : ""}>${serverRenderer_cjs_prodExports.ssrInterpolate(__props.loading ? "\u89C4\u5212\u4E2D..." : "\u53D1\u9001")}</button></div></section>`);
    };
  }
});
const _sfc_setup$1 = _sfc_main$1.setup;
_sfc_main$1.setup = (props, ctx) => {
  const ssrContext = vueExports.useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("components/PromptComposer.vue");
  return _sfc_setup$1 ? _sfc_setup$1(props, ctx) : void 0;
};
function parseChunk(chunk) {
  const parsed = {};
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) {
      parsed.event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      parsed.data = parsed.data ? `${parsed.data}
${line.slice(5).trim()}` : line.slice(5).trim();
    }
  }
  return parsed;
}
function normalizeEvent(chunk) {
  const parsed = parseChunk(chunk);
  if (!parsed.data) {
    return null;
  }
  try {
    const payload = JSON.parse(parsed.data);
    const type = typeof payload.type === "string" ? payload.type : parsed.event;
    if (!type) {
      return null;
    }
    return {
      ...payload,
      type
    };
  } catch {
    return {
      type: "error",
      message: "\u65E0\u6CD5\u89E3\u6790\u670D\u52A1\u7AEF\u8FD4\u56DE\u7684\u6D41\u5F0F\u4E8B\u4EF6\u3002"
    };
  }
}
function useChatStream() {
  const config = useRuntimeConfig();
  const apiBase = config.public.apiBase || "";
  async function createSession() {
    const response = await fetch(`${apiBase}/api/sessions`, {
      method: "POST"
    });
    if (!response.ok) {
      throw new Error("\u65E0\u6CD5\u521B\u5EFA\u4F1A\u8BDD");
    }
    const payload = await response.json();
    return payload.sessionId;
  }
  async function streamChat(sessionId, message, onEvent) {
    var _a;
    const response = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        sessionId,
        message
      })
    });
    if (!response.ok || !response.body) {
      throw new Error("\u89C4\u5212\u6709\u70B9\u6162\uFF0C\u8981\u4E0D\u8981\u518D\u8BD5\u4E00\u6B21\uFF1F");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = (_a = chunks.pop()) != null ? _a : "";
      for (const chunk of chunks) {
        const event = normalizeEvent(chunk);
        if (event) {
          onEvent(event);
        }
      }
    }
    if (buffer.trim()) {
      const event = normalizeEvent(buffer.trim());
      if (event) {
        onEvent(event);
      }
    }
  }
  return {
    createSession,
    streamChat
  };
}
const welcomeMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "\u4F60\u597D\u5440\uFF5E\u544A\u8BC9\u6211\u4F60\u60F3\u53BB\u54EA\u3001\u51E0\u5929\u3001\u51E0\u4E2A\u4EBA\uFF0C\u6211\u6765\u5E2E\u4F60\u5B89\u6392\u884C\u7A0B\uFF5E"
};
const planningMessages = {
  thinking: "\u6B63\u5728\u7406\u89E3\u4F60\u7684\u9700\u6C42\u2026",
  start: "\u6B63\u5728\u4E3A\u4F60\u751F\u6210\u65C5\u884C\u65B9\u6848\u2026",
  done: "\u6B63\u5728\u6574\u7406\u6700\u7EC8\u65B9\u6848\u2026"
};
function buildPlanSummary(plan) {
  const budget = plan.estimatedBudget ? `\uFF0C\u9884\u4F30 ${plan.estimatedBudget.currency} ${plan.estimatedBudget.amount}` : "";
  const preferenceText = plan.preferences && plan.preferences.length > 0 ? `\uFF0C\u91CD\u70B9\u504F\u5411 ${plan.preferences.join(" / ")}` : "";
  return `\u5DF2\u4E3A\u4F60\u751F\u6210 ${plan.days} \u5929 ${plan.travelers} \u4EBA\u7684 ${plan.destination} \u884C\u7A0B${budget}${preferenceText}\u3002\u53F3\u4FA7\u53EF\u4EE5\u76F4\u63A5\u67E5\u770B\u6BCF\u5929\u5B89\u6392\uFF0C\u5982\u679C\u60F3\u8C03\u6574\u544A\u8BC9\u6211\u5C31\u884C\u3002`;
}
const useChatStore = defineStore("chat", {
  state: () => ({
    sessionId: "",
    draft: "",
    phase: "idle",
    agentStatus: "\u51C6\u5907\u5F00\u59CB",
    streamSteps: [],
    errorMessage: "",
    currentMessageId: "",
    messages: [welcomeMessage],
    plan: null
  }),
  actions: {
    setSession(sessionId) {
      this.sessionId = sessionId;
    },
    setDraft(value) {
      this.draft = value;
    },
    beginPlanning(content) {
      this.phase = "planning";
      this.errorMessage = "";
      this.agentStatus = planningMessages.thinking;
      this.streamSteps = [];
      this.messages.push({
        id: `user-${Date.now()}`,
        role: "user",
        content
      });
      this.currentMessageId = `assistant-${Date.now()}`;
      this.messages.push({
        id: this.currentMessageId,
        role: "assistant",
        content: ""
      });
      this.draft = "";
    },
    setAssistantContent(content) {
      const current = this.messages.find((message) => message.id === this.currentMessageId);
      if (current) {
        current.content = content;
      }
    },
    appendAssistantToken(delta) {
      const current = this.messages.find((message) => message.id === this.currentMessageId);
      if (current) {
        current.content += delta;
      }
    },
    appendStreamStep(step) {
      if (!this.streamSteps.includes(step)) {
        this.streamSteps.push(step);
      }
    },
    applyStreamEvent(event) {
      if (event.type === "session") {
        this.sessionId = event.sessionId;
        return;
      }
      if (event.type === "agent_step") {
        this.agentStatus = planningMessages[event.status];
        if (event.status === "thinking") {
          this.appendStreamStep("\u5DF2\u7406\u89E3\u9700\u6C42\uFF0C\u6B63\u5728\u62C6\u89E3\u89C4\u5212\u4EFB\u52A1");
        }
        if (event.status === "start") {
          this.appendStreamStep("\u5DF2\u5F00\u59CB\u751F\u6210\u884C\u7A0B\u548C\u9884\u7B97\u5EFA\u8BAE");
        }
        if (event.status === "done") {
          this.appendStreamStep("\u5DF2\u5B8C\u6210\u89C4\u5212\uFF0C\u6B63\u5728\u6574\u7406\u6700\u7EC8\u65B9\u6848");
        }
        return;
      }
      if (event.type === "token") {
        this.appendAssistantToken(event.delta);
        return;
      }
      if (event.type === "plan_partial" && event.plan.dailyPlans) {
        this.appendStreamStep(`\u5DF2\u751F\u6210 ${event.plan.dailyPlans.length} \u5929\u7684\u90E8\u5206\u884C\u7A0B`);
        return;
      }
      if (event.type === "plan") {
        this.plan = event.plan;
        this.phase = "result";
        this.setAssistantContent(buildPlanSummary(event.plan));
        this.appendStreamStep("\u884C\u7A0B\u5361\u7247\u5DF2\u751F\u6210\uFF0C\u53EF\u7EE7\u7EED\u8FFD\u95EE\u4FEE\u6539");
        return;
      }
      if (event.type === "done") {
        this.agentStatus = "\u89C4\u5212\u5B8C\u6210";
        if (this.phase !== "result") {
          this.phase = "idle";
        }
        return;
      }
      if (event.type === "error") {
        this.phase = "error";
        this.errorMessage = event.message;
        this.agentStatus = "\u751F\u6210\u5931\u8D25";
        this.setAssistantContent(event.message);
      }
    },
    setInputError() {
      this.phase = "error";
      this.errorMessage = "\u544A\u8BC9\u6211\u4F60\u60F3\u53BB\u54EA\uFF0C\u6211\u6765\u5E2E\u4F60\u89C4\u5212\uFF5E";
    },
    setRequestError(message) {
      this.phase = "error";
      this.errorMessage = message;
      this.agentStatus = "\u751F\u6210\u5931\u8D25";
      this.setAssistantContent(message);
    },
    resetConversation() {
      this.phase = "idle";
      this.agentStatus = "\u51C6\u5907\u5F00\u59CB";
      this.streamSteps = [];
      this.errorMessage = "";
      this.plan = null;
      this.currentMessageId = "";
      this.messages = [welcomeMessage];
      this.sessionId = "";
      this.draft = "";
    }
  }
});
const _sfc_main = /* @__PURE__ */ vueExports.defineComponent({
  __name: "index",
  __ssrInlineRender: true,
  setup(__props) {
    const chatStore = useChatStore();
    const { createSession, streamChat } = useChatStream();
    const { agentStatus, draft, errorMessage, messages, phase, plan, sessionId, streamSteps } = storeToRefs(chatStore);
    function applySuggestedPrompt(value) {
      chatStore.setDraft(value);
    }
    async function ensureSession() {
      if (sessionId.value) {
        return sessionId.value;
      }
      const id = await createSession();
      chatStore.setSession(id);
      return id;
    }
    async function submitPrompt(value) {
      const content = value.trim();
      if (!content) {
        chatStore.setInputError();
        return;
      }
      chatStore.beginPlanning(content);
      try {
        const activeSessionId = await ensureSession();
        await streamChat(activeSessionId, content, (event) => {
          chatStore.applyStreamEvent(event);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "\u751F\u6210\u51FA\u4E86\u70B9\u95EE\u9898\uFF0C\u7A0D\u7B49\u4E00\u4E0B\u518D\u53D1\u4E00\u6B21\u5427 \u{1F64F}";
        chatStore.setRequestError(message);
      }
    }
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<main${serverRenderer_cjs_prodExports.ssrRenderAttrs(vueExports.mergeProps({ class: "page-shell" }, _attrs))}><section class="hero-shell"><div class="hero-copy-block"><div class="hero-emoji">\u{1F30F}</div><h1>\u4E00\u53E5\u8BDD\uFF0CAI \u5E2E\u4F60\u89C4\u5212\u4E00\u6574\u8D9F\u65C5\u884C</h1><p>\u544A\u8BC9\u6211\u4F60\u60F3\u53BB\u54EA\u3001\u51E0\u5929\u3001\u51E0\u4E2A\u4EBA\uFF0C\u5269\u4E0B\u7684\u6211\u6765\u5B89\u6392</p></div></section>`);
      _push(serverRenderer_cjs_prodExports.ssrRenderComponent(_sfc_main$1, {
        draft: vueExports.unref(draft),
        loading: vueExports.unref(phase) === "planning",
        onSubmit: submitPrompt,
        onUpdateDraft: vueExports.unref(chatStore).setDraft,
        onUsePrompt: applySuggestedPrompt
      }, null, _parent));
      _push(`<section class="main-grid">`);
      _push(serverRenderer_cjs_prodExports.ssrRenderComponent(_sfc_main$3, {
        "agent-status": vueExports.unref(agentStatus),
        messages: vueExports.unref(messages),
        phase: vueExports.unref(phase),
        "stream-steps": vueExports.unref(streamSteps)
      }, null, _parent));
      _push(serverRenderer_cjs_prodExports.ssrRenderComponent(_sfc_main$2, {
        "agent-status": vueExports.unref(agentStatus),
        "error-message": vueExports.unref(errorMessage),
        phase: vueExports.unref(phase),
        plan: vueExports.unref(plan)
      }, null, _parent));
      _push(`</section></main>`);
    };
  }
});
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = vueExports.useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/index.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};

export { _sfc_main as default };
//# sourceMappingURL=index-DMj7fL17.mjs.map
