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
  icon: string
  cat: CategoryScore
}

const categories = computed<CatRow[]>(() => [
  { label: '交通', icon: '✈', cat: props.score.transport },
  { label: '住宿', icon: '🏨', cat: props.score.lodging },
  { label: '景点', icon: '🎯', cat: props.score.attraction },
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
    <div class="score-inner">
      <!-- Overall ring -->
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
          <text x="40" y="38" text-anchor="middle" dominant-baseline="middle" class="score-ring-number">
            {{ score.overall }}
          </text>
          <text x="40" y="55" text-anchor="middle" dominant-baseline="middle" class="score-ring-grade">
            {{ gradeLabel(score.grade) }}
          </text>
        </svg>
        <div class="score-ring-label">综合评分</div>
      </div>

      <!-- Category bars -->
      <div class="score-cats">
        <div v-for="row in categories" :key="row.label" class="score-cat-row">
          <span class="score-cat-name">{{ row.icon }} {{ row.label }}</span>
          <div class="score-cat-bar">
            <div
              class="score-cat-fill"
              :style="{ width: catBarWidth(row.cat), background: catColor(row.cat) }"
            />
          </div>
          <span class="score-cat-value" :style="{ color: catColor(row.cat) }">
            {{ catScoreLabel(row.cat) }}
          </span>
        </div>

        <!-- Coverage row -->
        <div class="score-cat-row score-cat-coverage">
          <span class="score-cat-name">📅 覆盖</span>
          <div class="score-cat-bar">
            <div
              class="score-cat-fill"
              :style="{
                width: `${score.coverage.score}%`,
                background: gradeColor(score.grade),
              }"
            />
          </div>
          <span class="score-cat-value" :style="{ color: gradeColor(score.grade) }">
            {{ score.coverage.score }}
          </span>
        </div>
      </div>
    </div>

    <!-- Suggestions -->
    <ul v-if="score.suggestions.length" class="score-suggestions">
      <li v-for="s in score.suggestions" :key="s">
        <span class="score-suggest-icon">⚠</span>{{ s }}
      </li>
    </ul>
  </div>
</template>
