<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  loopStatus: 'evaluating' | 'refining'
  iteration: number
  maxIterations: number
  displayScore: number | null
  targetScore: number
}>()

const label = computed(() => {
  if (props.loopStatus === 'evaluating') return 'AI 正在评估当前方案…'
  return `第 ${props.iteration} / ${props.maxIterations} 轮优化中`
})

const progressPct = computed(() => {
  if (props.displayScore == null || props.targetScore <= 0) return 0
  return Math.min(100, (props.displayScore / props.targetScore) * 100)
})

const reached = computed(() =>
  props.displayScore != null && props.displayScore >= props.targetScore,
)
</script>

<template>
  <div class="react-progress" :class="{ 'is-reached': reached }" role="status" aria-live="polite">
    <div class="react-progress-head">
      <span class="react-progress-label">
        <Sparkles :size="14" :stroke-width="1.75" />
        {{ label }}
      </span>
      <span v-if="displayScore !== null" class="react-progress-score tabular">
        {{ displayScore }} <span class="currency-unit">/ {{ targetScore }}</span>
      </span>
    </div>
    <div class="react-progress-bar">
      <div class="react-progress-fill" :style="{ width: `${progressPct}%` }" />
    </div>
  </div>
</template>

<style scoped>
.react-progress {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-left: 3px solid var(--brand-purple);
  border-radius: var(--r-md);
  padding: 12px 16px;
  display: flex; flex-direction: column; gap: 10px;
  box-shadow: var(--shadow-sm);
  animation: react-pulse 1.6s ease-in-out infinite;
}
.react-progress.is-reached { animation: none; border-left-color: var(--accent-success); }

.react-progress-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.react-progress-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-display);
  font-size: var(--type-body-sm-size);
  color: var(--text);
  font-weight: 600;
}
.react-progress-label :deep(svg) { color: var(--brand-purple); }

.react-progress-score {
  font-family: var(--font-mono);
  font-size: var(--type-body-sm-size);
  color: var(--brand-purple);
  font-weight: 600;
}

.react-progress-bar {
  height: 6px; border-radius: 999px;
  background: var(--brand-purple-soft);
  overflow: hidden;
}
.react-progress-fill {
  height: 100%; border-radius: 999px;
  background: var(--gradient-brand);
  transition: width 300ms var(--ease-out);
  box-shadow: 0 0 10px rgba(79, 124, 255, 0.3);
}
.react-progress.is-reached .react-progress-fill {
  background: linear-gradient(135deg, var(--accent-success), #059669);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
}

@keyframes react-pulse {
  0%, 100% { box-shadow: var(--shadow-sm); }
  50%      { box-shadow: 0 0 0 3px rgba(123, 91, 255, 0.12), var(--shadow-sm); }
}
@media (prefers-reduced-motion: reduce) {
  .react-progress { animation: none; }
  .react-progress-fill { transition: none; }
}
</style>
