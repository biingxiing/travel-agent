<script setup lang="ts">
import { Sparkles, MapPin, Calendar, DollarSign, ArrowRight } from 'lucide-vue-next'

const props = defineProps<{
  loading?: boolean
}>()

const emit = defineEmits<{
  submit: [value: string]
}>()

const draftPrompt = ref('')
const presets = [
  { label: '杭州 · 3 天 · 美食拍照', value: '杭州 3 天 2 人，预算 3000，侧重美食和拍照' },
  { label: '北海道 · 7 天 · 冬季滑雪', value: '北海道 7 天 2 人，预算 15000，冬季滑雪为主' },
  { label: '东京 · 5 天 · 动漫之旅', value: '东京 5 天 1 人，预算 10000，动漫主题' },
  { label: '西班牙 · 10 天 · 深度', value: '西班牙 10 天 2 人，预算 30000，深度文化之旅' },
]

function submitPrompt() {
  const value = draftPrompt.value.trim()
  if (!value || props.loading) return
  emit('submit', value)
}

function applyPreset(value: string) {
  draftPrompt.value = value
}
</script>

<template>
  <section class="hero-shell">
    <div class="hero">
      <div class="hero-kicker">
        <span class="hero-dot" />
        <span>AI TRAVEL PLANNER</span>
      </div>

      <h1 class="hero-title">
        规划一次
        <br />
        <span class="hero-title-accent">称心的旅行</span>
      </h1>

      <p class="hero-sub">
        告诉我目的地、天数和预算 —— 我会用 ReAct 循环反复优化，一路带着你一起打磨。
      </p>

      <div class="hero-composer">
        <textarea
          v-model="draftPrompt"
          class="hero-composer-input"
          placeholder="说说你的出行需求：目的地 / 天数 / 人数 / 预算 / 偏好…"
          rows="2"
          :disabled="loading"
          @keydown.enter.exact.prevent="submitPrompt"
        />
        <div class="hero-composer-row">
          <div class="hero-tags">
            <span class="hero-tag"><MapPin :size="14" :stroke-width="1.5" />从 北京</span>
            <span class="hero-tag"><Calendar :size="14" :stroke-width="1.5" />5 天</span>
            <span class="hero-tag"><DollarSign :size="14" :stroke-width="1.5" />¥ 5,000</span>
          </div>
          <button
            type="button"
            class="hero-submit"
            :disabled="loading || !draftPrompt.trim()"
            @click="submitPrompt"
          >
            {{ loading ? '规划中…' : '开始规划' }}
            <ArrowRight :size="16" :stroke-width="1.75" />
          </button>
        </div>
      </div>

      <div class="hero-presets">
        <button
          v-for="preset in presets"
          :key="preset.label"
          type="button"
          class="hero-preset"
          @click="applyPreset(preset.value)"
        >
          <Sparkles :size="14" :stroke-width="1.5" />
          {{ preset.label }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero-shell { margin-bottom: 14px; }

.hero {
  position: relative;
  padding: 56px 32px 44px;
  text-align: center;
  background:
    var(--gradient-aurora-soft),
    linear-gradient(180deg, transparent 0%, var(--bg-subtle) 100%);
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  overflow: hidden;
}

.hero::before {
  content: ""; position: absolute; inset: 0;
  background-image: var(--gradient-grid-mesh);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%);
  pointer-events: none;
}

.hero-kicker {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
  border: 1px solid var(--brand-blue-border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
}
.hero-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--brand-blue);
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.18);
}

.hero-title {
  position: relative; z-index: 1;
  margin: 20px 0 12px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--type-display-xl-size);
  letter-spacing: var(--type-display-xl-tracking);
  line-height: 1.08;
  color: var(--text);
}
.hero-title-accent {
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero-sub {
  position: relative; z-index: 1;
  margin: 0 auto 28px;
  max-width: 46ch;
  color: var(--text-muted);
  font-size: var(--type-body-lg-size);
  line-height: 1.55;
}

.hero-composer {
  position: relative; z-index: 1;
  max-width: 680px;
  margin: 0 auto;
  padding: 16px 18px 14px;
  background: var(--bg-glass);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-artifact);
  text-align: left;
}
.hero-composer-input {
  width: 100%;
  resize: none;
  border: 0; outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--type-body-lg-size);
  line-height: 1.55;
  min-height: 48px;
}
.hero-composer-input::placeholder { color: var(--text-subtle); }
.hero-composer-input:disabled { cursor: not-allowed; opacity: 0.7; }

.hero-composer-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.hero-tags { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.hero-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px;
  font-size: var(--type-caption-size);
  color: var(--text-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
}
.hero-tag :deep(svg) { color: var(--text-subtle); }

.hero-submit {
  appearance: none;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  border: 0; border-radius: var(--r-sm);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--type-body-size);
  cursor: pointer;
  box-shadow: var(--shadow-brand);
  transition: box-shadow var(--dur-fast) var(--ease-out);
  white-space: nowrap;
}
.hero-submit:hover:not(:disabled) { box-shadow: 0 12px 28px rgba(79, 124, 255, 0.32); }
.hero-submit:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: var(--shadow-sm); }

.hero-presets {
  position: relative; z-index: 1;
  margin-top: 24px;
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
}
.hero-preset {
  appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.hero-preset :deep(svg) { color: var(--brand-blue); }
.hero-preset:hover {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
  background: var(--brand-blue-soft);
}

@media (max-width: 640px) {
  .hero { padding: 36px 20px 28px; }
  .hero-title { font-size: clamp(32px, 8vw, 44px); }
  .hero-composer-row { flex-direction: column; align-items: stretch; }
  .hero-submit { justify-content: center; }
}
</style>
