<script setup lang="ts">
import type { Plan } from "~/types/itinerary"

defineProps<{
  plan: Plan | null
  phase: "idle" | "planning" | "result" | "error"
  agentStatus: string
  errorMessage: string
}>()

function itemIcon(type: string) {
  if (type.includes("food") || type.includes("餐")) {
    return "🍜"
  }

  if (type.includes("transport") || type.includes("交通") || type.includes("flight")) {
    return "🛫"
  }

  return "📍"
}
</script>

<template>
  <section class="result-shell">
    <div class="panel-title">
      <div>
        <p class="panel-kicker">Plan Output</p>
        <h2>行程结果卡片</h2>
      </div>
      <span class="status-chip" :class="{ active: phase === 'planning' }">
        {{ phase === "planning" ? agentStatus : "Ready" }}
      </span>
    </div>

    <div v-if="phase === 'error'" class="result-empty result-error">
      <div class="empty-icon">😵</div>
      <p>{{ errorMessage || "生成出了点问题，稍等一下再发一次吧 🙏" }}</p>
    </div>

    <div v-else-if="plan" class="result-content">
      <div class="plan-header-card">
        <div>
          <div class="plan-title">{{ plan.title }}</div>
          <div class="plan-subtitle">
            {{ plan.destination }} · {{ plan.days }} 天 · {{ plan.travelers }} 人
          </div>
        </div>
        <button type="button" class="copy-button">📋 复制</button>
      </div>

      <div v-if="plan.estimatedBudget" class="budget-strip">
        <span>预算估算</span>
        <strong>{{ plan.estimatedBudget.currency }} {{ plan.estimatedBudget.amount }}</strong>
      </div>

      <article
        v-for="day in plan.dailyPlans"
        :key="day.day"
        class="result-day-card"
      >
        <div class="result-day-head">
          <div>
            <h3>Day {{ day.day }} · {{ day.theme }}</h3>
          </div>
        </div>

        <div
          v-for="item in day.items"
          :key="`${day.day}-${item.time}-${item.title}`"
          class="result-day-item"
        >
          <span class="result-time">{{ item.time }}</span>
          <span class="result-icon">{{ itemIcon(item.type) }}</span>
          <div class="result-item-body">
            <strong>{{ item.title }}</strong>
            <p>{{ item.desc }}</p>
            <small v-if="item.tips">{{ item.tips }}</small>
          </div>
        </div>
      </article>

      <div v-if="plan.tips.length" class="tips-card">
        <p class="tips-title">出行建议</p>
        <ul>
          <li v-for="tip in plan.tips" :key="tip">{{ tip }}</li>
        </ul>
      </div>

      <div class="disclaimer-card">
        {{ plan.disclaimer }}
      </div>
    </div>

    <div v-else-if="phase === 'planning'" class="result-content">
      <div class="planning-card">
        <div class="planning-label">行程生成中</div>
        <div class="skeleton-card">
          <h3>Day 1 · 初步规划中</h3>
          <p>正在为你补齐每日行程安排和预算建议…</p>
        </div>
        <div class="skeleton-card muted">
          <h3>Day 2 · 继续生成</h3>
        </div>
        <div class="skeleton-card muted dashed">
          <h3>Day 3 · 规划中…</h3>
        </div>
      </div>
    </div>

    <div v-else class="result-empty">
      <div class="empty-icon">🧭</div>
      <p>行程规划会出现在这里，先说说你想去哪。</p>
    </div>
  </section>
</template>
