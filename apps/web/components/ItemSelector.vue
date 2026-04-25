<script setup lang="ts">
import type { ItemSelection } from "@travel-agent/shared"
import { useChatStore } from "~/stores/chat"

const props = defineProps<{
  selection: ItemSelection
}>()

const chatStore = useChatStore()
const selectedId = ref(props.selection.options[0]?.id ?? "")

const selectedOption = computed(() =>
  props.selection.options.find((option) => option.id === selectedId.value),
)

function confirm() {
  if (!selectedOption.value) return

  chatStore.applyItemSelection(
    props.selection.dayNum,
    props.selection.itemIndex,
    selectedOption.value,
  )
}
</script>

<template>
  <div class="selector-card">
    <p class="selector-kicker">请选择</p>
    <p class="selector-question">{{ selection.question }}</p>
    <p class="selector-meta">
      <span class="mono-tag">第 {{ selection.dayNum }} 天</span>
      <span class="dot-sep">·</span>
      <span>{{ selection.itemTitle }}</span>
    </p>
    <hr class="selector-rule" />

    <label
      v-for="(option, idx) in selection.options"
      :key="option.id"
      class="selector-option"
      :class="{ selected: selectedId === option.id }"
    >
      <input
        v-model="selectedId"
        type="radio"
        :name="`sel-${selection.dayNum}-${selection.itemIndex}`"
        :value="option.id"
        class="selector-radio"
      />
      <div class="selector-option-body">
        <span class="selector-option-index">0{{ idx + 1 }}</span>
        <strong class="selector-option-title">{{ option.label }}</strong>
        <p class="selector-option-desc">{{ option.description }}</p>
      </div>
      <span v-if="selectedId === option.id" class="selector-tick" aria-hidden="true">✓</span>
    </label>

    <button
      type="button"
      class="selector-confirm"
      :disabled="!selectedOption"
      @click="confirm"
    >
      确认选择
    </button>
  </div>
</template>

<style scoped>
.selector-card {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
}

.selector-kicker {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--brand-purple);
}

.selector-question {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 17px;
  line-height: 1.35;
  color: var(--text);
  margin: 4px 0 0;
}

.selector-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-subtle);
  margin: 0 0 4px;
  font-size: 12.5px;
}

.mono-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
}

.dot-sep { color: var(--text-subtle); }

.selector-rule {
  border: 0;
  height: 1px;
  background: var(--border);
  margin: 8px 0 6px;
}

.selector-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  cursor: pointer;
  position: relative;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.selector-option:hover {
  border-color: var(--brand-blue);
  box-shadow: var(--shadow-sm);
}

.selector-option.selected {
  background: var(--brand-blue-soft);
  border-color: var(--brand-blue);
}

.selector-radio {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
  background: var(--bg-elevated);
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.selector-option.selected .selector-radio {
  border-color: var(--brand-blue);
  background: var(--brand-blue);
  box-shadow: inset 0 0 0 3px var(--bg-elevated);
}

.selector-option-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selector-option-index {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
  text-transform: uppercase;
}

.selector-option-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
}

.selector-option-desc {
  font-family: var(--font-body);
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.55;
  margin: 0;
}

.selector-tick {
  position: absolute;
  top: 12px;
  right: 14px;
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--brand-blue);
}

.selector-confirm {
  align-self: flex-end;
  border: 0;
  border-radius: var(--r-sm);
  padding: 10px 20px;
  background: var(--brand-gradient);
  color: var(--text-inverse);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--shadow-brand);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  margin-top: 4px;
}

.selector-confirm:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(79, 124, 255, 0.32);
}

.selector-confirm:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: var(--shadow-sm);
}

@media (prefers-reduced-motion: reduce) {
  .selector-option:hover { transition: none; box-shadow: none; }
  .selector-confirm:hover:not(:disabled) { transform: none; }
}
</style>
