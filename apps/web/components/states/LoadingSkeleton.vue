<script setup lang="ts">
defineProps<{
  variant: 'plan' | 'chat' | 'history' | 'generic'
}>()
</script>

<template>
  <div class="skel-root" :data-variant="variant">
    <template v-if="variant === 'plan'">
      <div class="skel-bar skel-w-60 skel-h-7" />
      <div class="skel-row">
        <div class="skel-block" />
        <div class="skel-block" />
        <div class="skel-block" />
        <div class="skel-block" />
      </div>
      <div class="skel-bar skel-w-40" />
      <div class="skel-card" />
      <div class="skel-card" />
    </template>
    <template v-else-if="variant === 'chat'">
      <div class="skel-bubble skel-bubble-left" />
      <div class="skel-bubble skel-bubble-right" />
      <div class="skel-bubble skel-bubble-left" />
    </template>
    <template v-else-if="variant === 'history'">
      <div class="skel-grid">
        <div class="skel-hist" v-for="i in 3" :key="i" />
      </div>
    </template>
    <template v-else>
      <div class="skel-bar skel-w-60" />
      <div class="skel-bar skel-w-80" />
      <div class="skel-bar skel-w-50" />
    </template>
  </div>
</template>

<style scoped>
.skel-root { display: flex; flex-direction: column; gap: 10px; padding: 4px; }

.skel-bar, .skel-block, .skel-card, .skel-bubble, .skel-hist {
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  animation: skel-pulse 1.6s var(--ease-out) infinite;
}

.skel-bar { height: 12px; }
.skel-bar.skel-h-7 { height: 28px; }
.skel-w-40 { width: 40%; }
.skel-w-50 { width: 50%; }
.skel-w-60 { width: 60%; }
.skel-w-80 { width: 80%; }

.skel-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.skel-block { height: 56px; border-radius: 10px; }
.skel-card { height: 72px; }

.skel-bubble { height: 44px; width: 70%; border-radius: 12px; }
.skel-bubble-right { align-self: flex-end; }
.skel-bubble-left { align-self: flex-start; }

.skel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.skel-hist { height: 160px; }

@keyframes skel-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .skel-bar, .skel-block, .skel-card, .skel-bubble, .skel-hist {
    animation: none; opacity: 0.8;
  }
}
</style>
