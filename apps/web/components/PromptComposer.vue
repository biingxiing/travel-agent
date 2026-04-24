<script setup lang="ts">
const props = defineProps<{
  draft: string
  loading: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  submit: [value: string]
  updateDraft: [value: string]
  usePrompt: [value: string]
}>()

const suggestedPrompts = [
  "帮我规划 5 天东京行，2 个人，预算 1 万，喜欢美食和动漫",
  "下周末想去杭州玩 3 天，不想太累",
  "春节带爸妈去三亚 6 天，怕冷",
  "一个人去北海道 7 天，滑雪 + 泡温泉"
]

const textareaRef = ref<HTMLTextAreaElement | null>(null)

function resizeTextarea(element: HTMLTextAreaElement | null = textareaRef.value) {
  if (!element) {
    return
  }

  element.style.height = "0px"

  const maxHeight = 180
  const nextHeight = Math.min(element.scrollHeight, maxHeight)

  element.style.height = `${Math.max(nextHeight, 32)}px`
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden"
}

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  resizeTextarea(target)
  emit("updateDraft", target.value)
}

function handleKeydown(event: KeyboardEvent) {
  const shouldSubmit = event.key === "Enter" && !event.shiftKey && !event.isComposing

  if (!shouldSubmit) {
    return
  }

  event.preventDefault()
  emit("submit", (event.target as HTMLTextAreaElement).value)
}

onMounted(() => {
  resizeTextarea()
})

watch(
  () => props.draft,
  async () => {
    await nextTick()
    resizeTextarea()
  },
  { flush: "post" }
)
</script>

<template>
  <section class="composer-shell" :class="{ compact }">
    <div v-if="!compact" class="prompt-row" aria-label="示例问题">
      <p class="prompt-row-kicker">示例问题</p>
      <div class="prompt-row-chips">
        <button
          v-for="prompt in suggestedPrompts"
          :key="prompt"
          type="button"
          class="prompt-chip"
          @click="emit('usePrompt', prompt)"
        >
          {{ prompt }}
        </button>
      </div>
    </div>

    <div class="composer-shell-box">
      <label class="composer-kicker" for="composer-area">描述你的出行需求</label>
      <div class="composer-surface">
        <textarea
          id="composer-area"
          ref="textareaRef"
          :value="draft"
          rows="1"
          :disabled="loading"
          placeholder="说说你的出行需求，目的地 / 天数 / 人数 / 预算 / 偏好…"
          @input="handleInput"
          @keydown="handleKeydown"
        />

        <button
          type="button"
          class="composer-send"
          :disabled="loading"
          @click="emit('submit', draft)"
        >
          <span>{{ loading ? "规划中" : "发送" }}</span>
          <svg
            v-if="!loading"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <p class="composer-hint">
        {{ compact ? "回车发送，Shift + Enter 换行" : "点击示例问题可快速填入，回车发送，Shift + Enter 换行" }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.composer-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.composer-shell.compact {
  gap: 10px;
}

.prompt-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prompt-row-kicker {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.prompt-row-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 2px 0;
}

.prompt-chip {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 12px;
  font-family: var(--font-body);
  font-size: 13.5px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  border-radius: 999px;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.prompt-chip:hover {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
  background: var(--brand-blue-soft);
}

.prompt-chip:focus-visible {
  outline: 2px solid var(--brand-blue);
  outline-offset: 2px;
}

.composer-shell-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-sm);
  padding: 14px 14px 10px;
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.composer-shell-box:focus-within {
  border-color: var(--brand-blue);
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.12);
}

.composer-shell.compact .composer-shell-box {
  padding: 12px 14px 10px;
}

.composer-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.composer-surface {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 2px 0 2px;
}

textarea {
  flex: 1;
  border: 0;
  background: transparent;
  resize: none;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
  padding: 2px 0;
  min-height: 32px;
  max-height: 180px;
  outline: none;
}

textarea::placeholder {
  color: var(--text-subtle);
  font-family: var(--font-body);
}

textarea:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.composer-send {
  appearance: none;
  cursor: pointer;
  background: var(--brand-gradient);
  color: var(--text-inverse);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 13.5px;
  padding: 9px 16px;
  border: 0;
  border-radius: var(--r-sm);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-shadow: var(--shadow-brand);
  transition: transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.composer-send:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(79, 124, 255, 0.32);
}

.composer-send:focus-visible {
  outline: 2px solid var(--brand-blue);
  outline-offset: 2px;
}

.composer-send:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow: var(--shadow-sm);
}

.composer-hint {
  margin: 2px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--text-subtle);
}

@media (max-width: 640px) {
  .composer-shell-box { padding: 12px 12px 10px; }
  .composer-send { padding: 8px 14px; }
  textarea { font-size: 14.5px; }
  .prompt-row-chips { gap: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .prompt-chip,
  .composer-send {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
</style>
