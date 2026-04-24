<script setup lang="ts">
import {
  TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipProvider,
} from 'reka-ui'

defineProps<{
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  delay?: number
}>()
</script>

<template>
  <TooltipProvider :delay-duration="delay ?? 150">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side ?? 'top'"
          :side-offset="6"
          class="tooltip-content"
        >
          {{ label }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style scoped>
.tooltip-content {
  padding: 5px 9px;
  background: var(--text);
  color: var(--text-inverse);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.02em;
  border-radius: var(--r-xs);
  box-shadow: var(--shadow-lift);
  animation: tooltip-in 160ms var(--ease-out);
  user-select: none;
  z-index: 50;
}

@keyframes tooltip-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .tooltip-content { animation: none; }
}
</style>
