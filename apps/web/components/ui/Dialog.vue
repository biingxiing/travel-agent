<script setup lang="ts">
import {
  DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent,
  DialogTitle, DialogDescription,
} from 'reka-ui'

defineProps<{
  open?: boolean
  title?: string
  description?: string
}>()

defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => $emit('update:open', v)">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="dg-overlay" />
      <DialogContent class="dg-content">
        <DialogTitle v-if="title" class="dg-title">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="dg-desc">{{ description }}</DialogDescription>
        <slot />
        <div v-if="$slots.actions" class="dg-actions">
          <slot name="actions" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script lang="ts">
export { DialogClose } from 'reka-ui'
</script>

<style scoped>
.dg-overlay {
  position: fixed; inset: 0;
  background: rgba(17, 24, 39, 0.36);
  backdrop-filter: blur(4px);
  z-index: 50;
  animation: dg-fade 180ms var(--ease-out);
}

.dg-content {
  position: fixed; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: min(90vw, 440px);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-artifact);
  padding: 24px;
  z-index: 51;
  animation: dg-in 200ms var(--ease-out);
}

.dg-title {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: var(--type-heading-size);
  font-weight: 600;
  letter-spacing: var(--type-heading-tracking);
  color: var(--text);
}
.dg-desc {
  margin: 0 0 16px;
  color: var(--text-muted);
  font-size: var(--type-body-size);
  line-height: 1.55;
}
.dg-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 20px;
}

@keyframes dg-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dg-in {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dg-overlay, .dg-content { animation: none; }
}
</style>
