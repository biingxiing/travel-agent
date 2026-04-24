<script setup lang="ts">
const props = defineProps<{
  loading?: boolean
}>()

const emit = defineEmits<{
  submit: [value: string]
}>()

const ORIGIN_STORAGE_KEY = "travel-agent.planner.origin"
const DEFAULT_ORIGIN = "北京"

const ORIGIN_OPTIONS = ["北京", "上海", "广州", "深圳", "成都", "杭州", "西安"]
const PREFERENCE_OPTIONS = [
  "美食",
  "拍照",
  "亲子",
  "户外",
  "文化",
  "购物",
  "轻松",
  "舒适",
  "动漫",
  "徒步",
]

const origin = ref<string>(DEFAULT_ORIGIN)
const destination = ref<string>("")
const startDate = ref<string>("")
const endDate = ref<string>("")
const preferences = ref<string[]>([])
const prefsOpen = ref(false)
const originEditing = ref(false)

if (import.meta.client) {
  const stored = window.localStorage.getItem(ORIGIN_STORAGE_KEY)
  if (stored && stored.trim()) {
    origin.value = stored.trim()
  }
}

function persistOrigin(value: string) {
  origin.value = value
  if (import.meta.client) {
    window.localStorage.setItem(ORIGIN_STORAGE_KEY, value)
  }
}

function clearOrigin() {
  origin.value = ""
  if (import.meta.client) {
    window.localStorage.removeItem(ORIGIN_STORAGE_KEY)
  }
}

function togglePref(tag: string) {
  const index = preferences.value.indexOf(tag)
  if (index >= 0) {
    preferences.value.splice(index, 1)
  } else {
    preferences.value.push(tag)
  }
}

function formatDateRange(): string {
  if (startDate.value && endDate.value) {
    return `${startDate.value} 至 ${endDate.value}`
  }
  if (startDate.value) {
    return `${startDate.value} 出发`
  }
  return ""
}

function buildPromptText(): string {
  const parts: string[] = []

  if (origin.value.trim()) {
    parts.push(`从${origin.value.trim()}出发`)
  }

  if (destination.value.trim()) {
    parts.push(`去${destination.value.trim()}`)
  }

  const dateText = formatDateRange()
  if (dateText) {
    parts.push(dateText)
  }

  if (preferences.value.length > 0) {
    parts.push(`偏好：${preferences.value.join("、")}`)
  }

  if (parts.length === 0) {
    return destination.value.trim()
  }

  return `${parts.join("，")}，请帮我规划行程。`
}

function onSubmitAi() {
  const text = buildPromptText()
  if (!text.trim()) {
    destinationRef.value?.focus()
    return
  }
  emit("submit", text)
}

const destinationRef = ref<HTMLInputElement | null>(null)
const prefsWrapRef = ref<HTMLElement | null>(null)

function handleDocumentClick(event: MouseEvent) {
  if (!prefsOpen.value) return
  const target = event.target as Node | null
  if (!target || !prefsWrapRef.value) return
  if (!prefsWrapRef.value.contains(target)) {
    prefsOpen.value = false
  }
}

onMounted(() => {
  if (import.meta.client) {
    document.addEventListener("click", handleDocumentClick)
  }
})

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener("click", handleDocumentClick)
  }
})

const preferenceLabel = computed(() => {
  if (preferences.value.length === 0) return "旅行偏好"
  if (preferences.value.length === 1) return preferences.value[0]
  return `已选 ${preferences.value.length} 项`
})

const dateRangeLabel = computed(() => formatDateRange() || "请选择")
</script>

<template>
  <section class="hero-planner-card">
    <div class="hero-planner-top">
      <button
        v-if="origin && !originEditing"
        type="button"
        class="origin-chip"
        aria-label="修改出发地"
        @click="originEditing = true"
      >
        <span class="origin-chip-label">出发地</span>
        <span class="origin-chip-value">{{ origin }}</span>
        <span
          class="origin-chip-clear"
          aria-label="清除出发地"
          @click.stop="clearOrigin"
        >×</span>
      </button>

      <div v-else class="origin-edit">
        <span class="origin-chip-label">出发地</span>
        <div class="origin-options">
          <button
            v-for="city in ORIGIN_OPTIONS"
            :key="city"
            type="button"
            class="origin-option"
            :class="{ active: origin === city }"
            @click="persistOrigin(city); originEditing = false"
          >
            {{ city }}
          </button>
          <button
            type="button"
            class="origin-option origin-option-cancel"
            @click="originEditing = false"
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <div class="hero-planner-row">
      <label class="hero-field hero-field-destination">
        <span class="hero-field-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </span>
        <span class="hero-field-body">
          <span class="hero-field-label">目的地</span>
          <input
            ref="destinationRef"
            v-model="destination"
            class="hero-field-input"
            type="text"
            placeholder="国家 / 城市 / 地标"
            autocomplete="off"
          />
        </span>
      </label>

      <div class="hero-field hero-field-date">
        <span class="hero-field-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 11h18" />
          </svg>
        </span>
        <span class="hero-field-body">
          <span class="hero-field-label">日期/时间</span>
          <div class="hero-date-inputs">
            <input
              v-model="startDate"
              type="date"
              class="hero-date-input"
              aria-label="开始日期"
            />
            <span class="hero-date-sep">–</span>
            <input
              v-model="endDate"
              type="date"
              class="hero-date-input"
              aria-label="结束日期"
            />
          </div>
          <span v-if="!startDate && !endDate" class="hero-date-hint">{{ dateRangeLabel }}</span>
        </span>
      </div>
    </div>

    <div class="hero-planner-row hero-planner-row-bottom">
      <div
        ref="prefsWrapRef"
        class="hero-prefs"
        :class="{ open: prefsOpen }"
      >
        <button
          type="button"
          class="hero-prefs-trigger"
          @click="prefsOpen = !prefsOpen"
        >
          <span class="hero-prefs-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </span>
          <span>{{ preferenceLabel }}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-prefs-caret">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div v-if="prefsOpen" class="hero-prefs-menu" role="listbox">
          <button
            v-for="tag in PREFERENCE_OPTIONS"
            :key="tag"
            type="button"
            class="hero-prefs-option"
            :class="{ active: preferences.includes(tag) }"
            @click="togglePref(tag)"
          >
            <span class="hero-prefs-dot" aria-hidden="true">
              <span v-if="preferences.includes(tag)" class="hero-prefs-dot-fill" />
            </span>
            {{ tag }}
          </button>
        </div>
      </div>

      <div class="hero-planner-actions">
        <button
          type="button"
          class="hero-btn hero-btn-secondary"
          disabled
          title="手动线路规划即将上线"
        >
          手动创建线路
        </button>
        <button
          type="button"
          class="hero-btn hero-btn-primary"
          :disabled="props.loading"
          @click="onSubmitAi"
        >
          <span class="hero-btn-sparkle" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
            </svg>
          </span>
          {{ props.loading ? "规划中…" : "AI 规划旅程" }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero-planner-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-card);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hero-planner-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.origin-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 10px 6px 14px;
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  color: var(--text);
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.origin-chip:hover {
  border-color: var(--brand-blue);
  background: var(--brand-blue-soft);
}

.origin-chip-label {
  color: var(--text-muted);
  font-size: 12px;
}

.origin-chip-value {
  color: var(--text);
  font-weight: 600;
}

.origin-chip-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-subtle);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}

.origin-chip-clear:hover { color: var(--text); }

.origin-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
}

.origin-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.origin-option {
  appearance: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.origin-option:hover {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
}

.origin-option.active {
  background: var(--brand-blue-soft);
  border-color: var(--brand-blue);
  color: var(--brand-blue-deep);
}

.origin-option-cancel { color: var(--text-subtle); }

.hero-planner-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.hero-planner-row-bottom {
  align-items: center;
}

.hero-field {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  cursor: text;
}

.hero-field:focus-within {
  border-color: var(--brand-blue);
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.12);
}

.hero-field-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue);
}

.hero-field-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hero-field-label {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-display);
}

.hero-field-input {
  appearance: none;
  border: 0;
  background: transparent;
  outline: none;
  padding: 0;
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--text);
}

.hero-field-input::placeholder { color: var(--text-subtle); }

.hero-date-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text);
}

.hero-date-input {
  appearance: none;
  border: 0;
  background: transparent;
  outline: none;
  padding: 0;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text);
  min-width: 0;
  flex: 1;
}

.hero-date-input::-webkit-calendar-picker-indicator {
  opacity: 0.55;
  cursor: pointer;
}

.hero-date-sep { color: var(--text-subtle); }

.hero-date-hint {
  font-size: 13px;
  color: var(--text-subtle);
  margin-top: -18px;
  pointer-events: none;
}

.hero-prefs {
  position: relative;
}

.hero-prefs-trigger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 14px;
  color: var(--text);
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.hero-prefs-trigger:hover {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
}

.hero-prefs-icon {
  display: inline-flex;
  color: var(--brand-purple);
}

.hero-prefs.open .hero-prefs-caret { transform: rotate(180deg); }

.hero-prefs-caret {
  transition: transform var(--dur-fast) var(--ease-out);
  color: var(--text-subtle);
}

.hero-prefs-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lift);
  min-width: 240px;
}

.hero-prefs-option {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border: 0;
  border-radius: var(--r-xs);
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.hero-prefs-option:hover { background: var(--bg-subtle); }

.hero-prefs-option.active { color: var(--brand-blue-deep); font-weight: 500; }

.hero-prefs-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--border-strong);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.hero-prefs-option.active .hero-prefs-dot {
  border-color: var(--brand-blue);
  background: var(--brand-blue);
}

.hero-prefs-dot-fill {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--text-inverse);
}

.hero-planner-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.hero-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: var(--r-md);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.hero-btn-secondary {
  background: var(--bg-elevated);
  color: var(--brand-blue);
  border: 1.5px solid var(--brand-blue);
}

.hero-btn-secondary:hover:not(:disabled) {
  background: var(--brand-blue-soft);
  transform: translateY(-1px);
}

.hero-btn-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  color: var(--text-subtle);
  border-color: var(--border);
  background: var(--bg-elevated);
}

.hero-btn-primary {
  background: var(--brand-gradient);
  color: var(--text-inverse);
  border: 0;
  box-shadow: var(--shadow-brand);
}

.hero-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(79, 124, 255, 0.32);
}

.hero-btn-primary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: var(--shadow-sm);
}

.hero-btn-sparkle {
  display: inline-flex;
}

@media (max-width: 820px) {
  .hero-planner-row { grid-template-columns: 1fr; }
  .hero-planner-row-bottom { align-items: stretch; }
  .hero-prefs { width: 100%; }
  .hero-prefs-trigger { width: 100%; justify-content: space-between; }
  .hero-prefs-menu { width: 100%; }
  .hero-planner-actions { flex-direction: column-reverse; }
  .hero-btn { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-btn-primary:hover:not(:disabled),
  .hero-btn-secondary:hover:not(:disabled) { transform: none; }
}
</style>
