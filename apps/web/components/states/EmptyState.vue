<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

defineProps<{
  icon: LucideIcon
  title: string
  hint?: string
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">
      <component :is="icon" :size="32" :stroke-width="1.5" />
    </div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty-hint">{{ hint }}</p>
    <slot name="action" />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 40px 24px; text-align: center;
  color: var(--text-muted);
}
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--bg-subtle); color: var(--text-subtle);
  margin-bottom: 6px;
}
.empty-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-body-size);
  font-weight: 600;
  color: var(--text);
}
.empty-hint {
  margin: 0;
  font-size: var(--type-body-sm-size);
  line-height: 1.55;
  max-width: 38ch;
}
</style>
