<script setup lang="ts">
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent,
} from 'reka-ui'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent :side-offset="6" align="end" class="dm-content">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<script lang="ts">
export { DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui'
</script>

<style scoped>
.dm-content {
  min-width: 200px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lift);
  animation: dm-in 200ms var(--ease-out);
  z-index: 50;
}

.dm-content :deep([data-reka-dropdown-menu-item]) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text);
  border-radius: var(--r-xs);
  cursor: pointer;
  outline: none;
  transition: background-color var(--dur-fast) var(--ease-out);
}
.dm-content :deep([data-reka-dropdown-menu-item][data-highlighted]) {
  background: var(--bg-subtle);
}
.dm-content :deep([data-reka-dropdown-menu-item].is-danger) {
  color: var(--accent-danger);
}
.dm-content :deep([data-reka-dropdown-menu-item].is-danger[data-highlighted]) {
  background: var(--accent-danger-soft);
}
.dm-content :deep([data-reka-dropdown-menu-separator]) {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 2px;
}

@keyframes dm-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dm-content { animation: none; }
}
</style>
