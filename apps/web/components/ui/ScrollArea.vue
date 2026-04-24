<script setup lang="ts">
import {
  ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar,
  ScrollAreaThumb, ScrollAreaCorner,
} from 'reka-ui'

defineProps<{ maxHeight?: string }>()
</script>

<template>
  <ScrollAreaRoot class="sa-root" :style="{ maxHeight }">
    <ScrollAreaViewport class="sa-viewport">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar orientation="vertical" class="sa-scrollbar">
      <ScrollAreaThumb class="sa-thumb" />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

<style scoped>
.sa-root {
  width: 100%; height: 100%;
  overflow: hidden; position: relative;
}
.sa-viewport { width: 100%; height: 100%; }
.sa-scrollbar {
  display: flex;
  user-select: none; touch-action: none;
  padding: 2px;
  background: transparent;
  transition: background-color 160ms var(--ease-out);
  width: 10px;
}
.sa-scrollbar:hover { background: var(--bg-subtle); }
.sa-thumb {
  flex: 1;
  background: var(--border-strong);
  border-radius: 999px;
  transition: background-color 160ms var(--ease-out);
}
.sa-thumb:hover { background: var(--text-subtle); }
</style>
