<script setup lang="ts">
import type { ItineraryScore, CategoryScore, Grade } from '~/utils/scoring'
import { gradeColor, gradeLabel } from '~/utils/scoring'

const props = defineProps<{
  score: ItineraryScore
}>()

const CIRCUMFERENCE = 2 * Math.PI * 30 // radius = 30

const ringOffset = computed(() => CIRCUMFERENCE * (1 - props.score.overall / 100))
const ringColor = computed(() => gradeColor(props.score.grade))

interface CatRow {
  label: string
  cat: CategoryScore
}

const categories = computed<CatRow[]>(() => [
  { label: '交通', cat: props.score.transport },
  { label: '住宿', cat: props.score.lodging },
  { label: '景点', cat: props.score.attraction },
])

function catColor(cat: CategoryScore) {
  return gradeColor(cat.grade)
}

function catBarWidth(cat: CategoryScore): string {
  return cat.score === null ? '0%' : `${cat.score}%`
}

function catScoreLabel(cat: CategoryScore): string {
  return cat.score === null ? 'N/A' : `${cat.score}`
}
</script>

<template>
  <div class="score-panel">
    <header class="score-header">
      <p class="score-kicker">综合评分</p>
      <span class="score-badge">{{ gradeLabel(score.grade) }}</span>
    </header>

    <div class="score-inner">
      <div class="score-ring-wrap">
        <svg viewBox="0 0 80 80" class="score-ring-svg">
          <circle cx="40" cy="40" r="30" class="score-ring-track" />
          <circle
            cx="40"
            cy="40"
            r="30"
            class="score-ring-fill"
            :style="{
              strokeDasharray: CIRCUMFERENCE,
              strokeDashoffset: ringOffset,
              stroke: ringColor,
            }"
          />
          <text x="40" y="40" text-anchor="middle" dominant-baseline="middle" class="score-ring-number">
            {{ score.overall }}
          </text>
        </svg>
        <div class="score-ring-label">综合评分</div>
      </div>

      <div class="score-cats">
        <div v-for="row in categories" :key="row.label" class="score-cat-row">
          <span class="score-cat-name">{{ row.label }}</span>
          <div class="score-cat-bar">
            <div
              class="score-cat-fill"
              :style="{ width: catBarWidth(row.cat), background: catColor(row.cat) }"
            />
          </div>
          <span class="score-cat-value data-tag" :style="{ color: catColor(row.cat) }">
            {{ catScoreLabel(row.cat) }}
          </span>
        </div>

        <div class="score-cat-row score-cat-coverage">
          <span class="score-cat-name">覆盖</span>
          <div class="score-cat-bar">
            <div
              class="score-cat-fill"
              :style="{
                width: `${score.coverage.score}%`,
                background: gradeColor(score.grade),
              }"
            />
          </div>
          <span class="score-cat-value data-tag" :style="{ color: gradeColor(score.grade) }">
            {{ score.coverage.score }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="score.suggestions.length" class="score-suggestions-wrap">
      <p class="score-suggest-kicker">建议</p>
      <ul class="score-suggestions">
        <li v-for="s in score.suggestions" :key="s">{{ s }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.score-panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 16px 18px 18px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.score-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.score-kicker {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.score-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--brand-purple);
  border: 1px solid rgba(123, 91, 255, 0.28);
  background: var(--brand-purple-soft);
  padding: 3px 10px;
  border-radius: 999px;
}

.score-inner {
  display: flex;
  align-items: center;
  gap: 20px;
}

.score-ring-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.score-ring-svg {
  width: 96px;
  height: 96px;
}

.score-ring-track {
  fill: none;
  stroke: var(--border);
  stroke-width: 6;
}

.score-ring-fill {
  fill: none;
  stroke-width: 6;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 40px 40px;
  transition: stroke-dashoffset var(--dur-slow) var(--ease-out);
}

.score-ring-number {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  fill: var(--text);
}

.score-ring-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.score-cats {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.score-cat-row {
  display: grid;
  grid-template-columns: 48px 1fr 40px;
  align-items: center;
  gap: 10px;
}

.score-cat-name {
  font-family: var(--font-body);
  font-size: 12.5px;
  color: var(--text-muted);
}

.score-cat-bar {
  height: 6px;
  background: var(--border);
  border-radius: 999px;
  overflow: hidden;
}

.score-cat-fill {
  height: 100%;
  border-radius: 999px;
  transition: width var(--dur-slow) var(--ease-out);
}

.score-cat-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  font-weight: 600;
  text-align: right;
}

.score-suggestions-wrap {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.score-suggest-kicker {
  margin: 0 0 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.score-suggestions {
  margin: 0;
  padding-left: 16px;
  list-style: none;
}

.score-suggestions li {
  position: relative;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.55;
  padding: 2px 0;
}

.score-suggestions li::before {
  content: "•";
  position: absolute;
  left: -12px;
  top: 0;
  color: var(--accent-warn);
  font-weight: 700;
}

@media (max-width: 640px) {
  .score-inner { flex-direction: column; align-items: stretch; gap: 12px; }
  .score-ring-wrap { flex-direction: row; gap: 12px; justify-content: flex-start; }
}

@media (prefers-reduced-motion: reduce) {
  .score-ring-fill, .score-cat-fill { transition: none; }
}
</style>
