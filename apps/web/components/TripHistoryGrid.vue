<script setup lang="ts">
import { Clock, Footprints, Compass } from 'lucide-vue-next'
import EmptyState from '~/components/states/EmptyState.vue'
import { relativeTime } from '~/utils/relative-time'
import { destinationColor } from '~/utils/destination-color'
import { useTripHistory } from "~/composables/useTripHistory"
import type { TripHistoryEntry } from "~/composables/useTripHistory"

const emit = defineEmits<{
  select: [entry: TripHistoryEntry]
  remove: [entry: TripHistoryEntry]
}>()

const { entries, refresh, remove } = useTripHistory()

onMounted(() => {
  refresh()
})

function onSelect(entry: TripHistoryEntry) {
  emit("select", entry)
}

function onRemove(entry: TripHistoryEntry) {
  remove(entry.sessionId)
  emit("remove", entry)
}
</script>

<template>
  <section class="trip-history">
    <header class="history-head">
      <h2 class="history-head-title">继续之前的规划</h2>
      <span v-if="entries.length" class="history-head-meta">
        RECENT · {{ entries.length }}
      </span>
    </header>

    <EmptyState
      v-if="entries.length === 0"
      :icon="Compass"
      title="还没有规划过的行程"
      hint="从上方的 Hero 里描述你的第一次出行需求吧。"
    />

    <div v-else class="history-grid">
      <article
        v-for="entry in entries"
        :key="entry.sessionId"
        class="history-card"
        role="button"
        tabindex="0"
        @click="onSelect(entry)"
        @keydown.enter.prevent="onSelect(entry)"
        @keydown.space.prevent="onSelect(entry)"
      >
        <div
          class="history-band"
          :style="{ background: destinationColor(entry.destination || entry.title) }"
        />
        <div class="history-body">
          <div class="history-title-row">
            <strong class="history-dest">
              {{ entry.destination || entry.title }}
              <span v-if="entry.days" class="history-dest-meta">· {{ entry.days }} 天</span>
            </strong>
            <button
              type="button"
              class="history-remove"
              aria-label="删除该线路"
              @click.stop="onRemove(entry)"
            >×</button>
          </div>
          <div class="history-meta">
            <span class="history-meta-item">
              <Clock :size="12" :stroke-width="1.5" />
              {{ relativeTime(entry.updatedAt) }}
            </span>
            <span v-if="entry.poiCount" class="history-meta-item">
              <Footprints :size="12" :stroke-width="1.5" />
              {{ entry.poiCount }} 个安排
            </span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.trip-history { display: flex; flex-direction: column; gap: 14px; }

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 2px;
}
.history-head-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-subhead-size);
  font-weight: 600;
  letter-spacing: var(--type-heading-tracking);
  color: var(--text);
}
.history-head-meta {
  font-family: var(--font-mono);
  font-size: var(--type-mono-xs-size);
  letter-spacing: var(--type-mono-xs-tracking);
  color: var(--text-subtle);
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.history-card {
  display: flex; flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.history-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-card-hover);
  border-color: var(--border-strong);
}
.history-card:focus-visible {
  outline: 2px solid var(--brand-blue);
  outline-offset: -1px;
}

.history-band {
  height: 64px;
  position: relative;
}
.history-band::after {
  content: ""; position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 20% 80%, rgba(255,255,255,0.25), transparent 40%),
    radial-gradient(circle at 80% 20%, rgba(255,255,255,0.2), transparent 40%);
}

.history-body {
  padding: 14px 16px 16px;
  display: flex; flex-direction: column; gap: 8px;
}

.history-title-row {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
}

.history-dest {
  font-family: var(--font-display);
  font-size: var(--type-body-lg-size);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}
.history-dest-meta {
  color: var(--text-muted);
  font-weight: 500;
  margin-left: 4px;
}

.history-remove {
  appearance: none;
  border: 0; background: transparent;
  color: var(--text-subtle);
  font-size: 18px; line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--r-xs);
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.history-remove:hover { color: var(--accent-danger); background: var(--accent-danger-soft); }

.history-meta {
  display: flex; gap: 12px;
  font-size: var(--type-caption-size);
  color: var(--text-muted);
}
.history-meta-item {
  display: inline-flex; align-items: center; gap: 4px;
}
.history-meta-item :deep(svg) { color: var(--text-subtle); }

@media (max-width: 640px) {
  .history-grid { grid-template-columns: 1fr; }
}
</style>
