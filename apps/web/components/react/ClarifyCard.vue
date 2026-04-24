<script setup lang="ts">
import { MessageCircleQuestion } from 'lucide-vue-next'

defineProps<{
  question: string
  reason?: string
}>()
</script>

<template>
  <div class="clarify-card" role="dialog" aria-live="polite">
    <p class="clarify-kicker">
      <MessageCircleQuestion :size="14" :stroke-width="1.75" />
      需要补充信息
    </p>
    <p class="clarify-question">"{{ question }}"</p>
    <p class="clarify-hint">
      {{ reason || '在下方对话框中回复，方案会继续生成。' }}
    </p>
  </div>
</template>

<style scoped>
.clarify-card {
  background: var(--brand-blue-soft);
  border: 1px solid var(--brand-blue-border);
  border-left: 3px solid var(--brand-blue);
  border-radius: var(--r-md);
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
  animation: clarify-in 320ms var(--ease-out);
}
.clarify-kicker {
  margin: 0;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  color: var(--brand-blue-deep);
  text-transform: uppercase;
}
.clarify-question {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}
.clarify-hint {
  margin: 0;
  font-size: var(--type-body-sm-size);
  color: var(--text-muted);
  line-height: 1.55;
}

@keyframes clarify-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .clarify-card { animation: none; }
}
</style>
