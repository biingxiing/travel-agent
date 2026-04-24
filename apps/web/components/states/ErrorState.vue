<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

defineProps<{
  title: string
  detail?: string
  retryLabel?: string
}>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="error-state" role="alert">
    <div class="error-icon">
      <AlertCircle :size="32" :stroke-width="1.5" />
    </div>
    <p class="error-title">{{ title }}</p>
    <p v-if="detail" class="error-detail">{{ detail }}</p>
    <button
      v-if="$attrs.onRetry || retryLabel"
      type="button"
      class="error-retry"
      @click="$emit('retry')"
    >
      {{ retryLabel ?? '重试' }}
    </button>
  </div>
</template>

<style scoped>
.error-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 36px 22px; text-align: center;
  background: var(--accent-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: var(--r-md);
  color: #991B1B;
}
.error-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: 12px;
  background: rgba(239, 68, 68, 0.14);
  color: var(--accent-danger);
  margin-bottom: 4px;
}
.error-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-body-size);
  font-weight: 600;
  color: #7F1D1D;
}
.error-detail {
  margin: 0;
  font-size: var(--type-body-sm-size);
  line-height: 1.55;
  max-width: 42ch;
  color: #991B1B;
}
.error-retry {
  margin-top: 10px;
  appearance: none;
  border: 1px solid rgba(239, 68, 68, 0.32);
  background: var(--bg-elevated);
  color: var(--accent-danger);
  padding: 7px 16px;
  border-radius: var(--r-sm);
  font-family: var(--font-display);
  font-size: var(--type-body-sm-size);
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.error-retry:hover { background: var(--accent-danger-soft); border-color: var(--accent-danger); }
</style>
