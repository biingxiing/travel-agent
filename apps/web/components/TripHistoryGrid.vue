<script setup lang="ts">
import { useTripHistory, coverForDestination } from "~/composables/useTripHistory"
import type { TripHistoryEntry } from "~/composables/useTripHistory"

const emit = defineEmits<{
  select: [entry: TripHistoryEntry]
  remove: [entry: TripHistoryEntry]
}>()

const { entries, refresh, remove } = useTripHistory()

onMounted(() => {
  refresh()
})

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

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
    <header class="trip-history-head">
      <h2 class="trip-history-title">我的线路</h2>
      <span v-if="entries.length" class="trip-history-count">{{ entries.length }} 条方案</span>
    </header>

    <div v-if="entries.length === 0" class="trip-history-empty">
      <div class="trip-history-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 14h32v24a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V14z" />
          <path d="M16 14V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6" />
          <path d="M22 24l4 4 8-8" />
        </svg>
      </div>
      <p class="trip-history-empty-copy">
        还没有保存的线路。在上方描述你的出行需求，生成第一个方案吧。
      </p>
    </div>

    <div v-else class="trip-history-grid">
      <article
        v-for="entry in entries"
        :key="entry.sessionId"
        class="trip-card"
        tabindex="0"
        role="button"
        @click="onSelect(entry)"
        @keydown.enter.prevent="onSelect(entry)"
        @keydown.space.prevent="onSelect(entry)"
      >
        <div
          class="trip-card-cover"
          :style="{ background: coverForDestination(entry.destination || entry.title) }"
        >
          <span class="trip-card-cover-label">{{ entry.destination || entry.title }}</span>
          <button
            type="button"
            class="trip-card-remove"
            aria-label="删除该线路"
            @click.stop="onRemove(entry)"
          >
            ×
          </button>
        </div>
        <div class="trip-card-body">
          <h3 class="trip-card-title">{{ entry.title }}</h3>
          <p class="trip-card-meta">
            <span>{{ entry.days }}天</span>
            <span class="trip-card-sep">·</span>
            <span>{{ entry.poiCount }} 个地点</span>
            <span class="trip-card-sep">·</span>
            <span>{{ entry.cityCount }} 个城市</span>
          </p>
          <p class="trip-card-date">
            {{ formatDate(entry.updatedAt) }} 自动保存
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.trip-history {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.trip-history-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.trip-history-title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--text);
}

.trip-history-count {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-subtle);
  letter-spacing: 0.04em;
}

.trip-history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 36px 24px;
  background: var(--bg-elevated);
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-lg);
  color: var(--text-muted);
  text-align: center;
}

.trip-history-empty-icon {
  color: var(--brand-blue);
}

.trip-history-empty-copy {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  max-width: 360px;
}

.trip-history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.trip-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.trip-card:hover,
.trip-card:focus-visible {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lift);
  border-color: var(--border-strong);
}

.trip-card:focus-visible {
  outline: 2px solid var(--brand-blue);
  outline-offset: 2px;
}

.trip-card-cover {
  position: relative;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: flex-end;
  padding: 14px 16px;
  color: var(--text-inverse);
}

.trip-card-cover::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(17, 24, 39, 0) 40%, rgba(17, 24, 39, 0.35) 100%);
  pointer-events: none;
}

.trip-card-cover-label {
  position: relative;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: 0.01em;
  z-index: 1;
}

.trip-card-remove {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.35);
  color: var(--text-inverse);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.trip-card:hover .trip-card-remove,
.trip-card:focus-within .trip-card-remove { opacity: 1; }

.trip-card-remove:hover { background: rgba(17, 24, 39, 0.55); }

.trip-card-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trip-card-title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  line-height: 1.4;
  color: var(--text);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.trip-card-meta {
  margin: 0;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--text-subtle);
  font-size: 12.5px;
}

.trip-card-sep { color: var(--text-subtle); }

.trip-card-date {
  margin: 0;
  color: var(--text-subtle);
  font-size: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .trip-card:hover,
  .trip-card:focus-visible { transform: none; }
}
</style>
