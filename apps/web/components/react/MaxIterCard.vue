<script setup lang="ts">
import { Flag, ArrowRight } from 'lucide-vue-next'

defineProps<{
  maxIterations: number
  currentScore: number
  targetScore: number
}>()

defineEmits<{ continue: [] }>()
</script>

<template>
  <div class="maxiter-card">
    <div class="maxiter-icon">
      <Flag :size="18" :stroke-width="1.75" />
    </div>
    <div class="maxiter-body">
      <p class="maxiter-title">已优化 {{ maxIterations }} 轮</p>
      <p class="maxiter-meta">
        当前 <b class="tabular">{{ currentScore }}</b> 分（目标
        <b class="tabular">{{ targetScore }}</b>），是否继续优化？
      </p>
    </div>
    <button type="button" class="maxiter-cta" @click="$emit('continue')">
      继续优化
      <ArrowRight :size="14" :stroke-width="1.75" />
    </button>
  </div>
</template>

<style scoped>
.maxiter-card {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--accent-warn-soft);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--r-md);
  animation: maxiter-in 320ms var(--ease-out);
}
.maxiter-icon {
  width: 40px; height: 40px;
  border-radius: var(--r-md);
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.14);
  color: #B45309;
}
.maxiter-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  color: #7C2D12;
  letter-spacing: -0.01em;
}
.maxiter-meta {
  margin: 2px 0 0;
  font-size: var(--type-body-sm-size);
  color: #92400E;
  line-height: 1.5;
}
.maxiter-cta {
  appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px;
  background: var(--gradient-brand);
  color: var(--text-inverse);
  border: 0;
  border-radius: var(--r-sm);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--type-body-sm-size);
  cursor: pointer;
  box-shadow: var(--shadow-brand);
  transition: box-shadow var(--dur-fast) var(--ease-out);
}
.maxiter-cta:hover { box-shadow: 0 12px 28px rgba(79, 124, 255, 0.32); }

@keyframes maxiter-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .maxiter-card { animation: none; }
}
@media (max-width: 640px) {
  .maxiter-card { grid-template-columns: 1fr; gap: 8px; text-align: left; }
  .maxiter-cta { justify-self: start; }
}
</style>
