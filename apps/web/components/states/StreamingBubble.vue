<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

defineProps<{
  status: string
  steps?: string[]
}>()
</script>

<template>
  <article class="streaming-bubble">
    <div class="streaming-row">
      <Sparkles :size="16" :stroke-width="1.75" class="streaming-icon" />
      <span class="streaming-status">{{ status }}</span>
    </div>
    <ul v-if="steps?.length" class="streaming-steps">
      <li v-for="step in steps" :key="step">{{ step }}</li>
    </ul>
  </article>
</template>

<style scoped>
.streaming-bubble {
  align-self: flex-start;
  max-width: 85%;
  padding: 11px 14px;
  border: 1px solid var(--brand-blue-border);
  border-left: 3px solid var(--brand-blue);
  border-radius: var(--r-md) var(--r-md) var(--r-md) 2px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
  animation: streaming-pulse 1.6s ease-in-out infinite;
}
.streaming-row {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: var(--type-body-sm-size);
}
.streaming-icon {
  animation: sparkle-spin 3.2s linear infinite;
  color: var(--brand-blue);
}
.streaming-status { color: var(--brand-blue-deep); font-weight: 500; }
.streaming-steps {
  margin: 10px 0 0;
  padding-left: 18px;
  list-style: none;
  display: flex; flex-direction: column; gap: 4px;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
}
.streaming-steps li { position: relative; line-height: 1.5; }
.streaming-steps li::before {
  content: "•"; position: absolute; left: -14px; top: 0;
  color: var(--brand-blue); font-weight: 700;
}

@keyframes streaming-pulse {
  0%, 100% { background: var(--brand-blue-soft); }
  50%      { background: rgba(79, 124, 255, 0.14); }
}
@keyframes sparkle-spin {
  from { transform: rotate(0deg); } to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .streaming-bubble, .streaming-icon { animation: none; }
}
</style>
