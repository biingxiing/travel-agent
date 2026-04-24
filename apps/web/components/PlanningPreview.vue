<script setup lang="ts">
import { storeToRefs } from "pinia"
import type { Plan, PlanItem } from "@travel-agent/shared"
import { useChatStore } from "~/stores/chat"
import { useWorkspaceStore } from "~/stores/workspace"
import type { ItineraryScore, ItemScore } from "~/utils/scoring"
import { scorePlan, buildItemScoreMap, gradeColor } from "~/utils/scoring"

const props = defineProps<{
  phase: "idle" | "planning" | "result" | "error"
  agentStatus: string
  errorMessage: string
}>()

const chatStore = useChatStore()
const workspaceStore = useWorkspaceStore()
const { pendingSelections } = storeToRefs(chatStore)
const { currentPlan, currentScore } = storeToRefs(workspaceStore)

const resultStatus = computed(() => {
  if (props.phase === "planning" || pendingSelections.value.length > 0) {
    return props.agentStatus
  }

  return "就绪"
})

const displayTitle = computed(() => currentPlan.value?.title || "旅行方案")

const displaySubtitle = computed(() => {
  const plan = currentPlan.value
  if (!plan) return ""
  return `${plan.destination} · ${plan.days} 天 · ${plan.travelers} 人`
})

const displayTips = computed<string[]>(() => currentPlan.value?.tips ?? [])

const displayDisclaimer = computed(
  () =>
    currentPlan.value?.disclaimer ||
    "本行程由 AI 生成，仅供参考，出行前请再次核对交通、酒店与景点开放信息。",
)

const activeBudget = computed(() => currentPlan.value?.estimatedBudget ?? null)

const activeDailyPlans = computed(() => currentPlan.value?.dailyPlans ?? [])

const activeTransportItems = computed<PlanItem[]>(() => {
  const items: PlanItem[] = []
  for (const day of activeDailyPlans.value) {
    for (const item of day.items) {
      if (item.type === "transport") items.push(item)
    }
  }
  return items
})

const activeLodgingItems = computed<PlanItem[]>(() => {
  const items: PlanItem[] = []
  for (const day of activeDailyPlans.value) {
    for (const item of day.items) {
      if (item.type === "lodging") items.push(item)
    }
  }
  return items
})

const activeAttractionItems = computed<PlanItem[]>(() => {
  const items: PlanItem[] = []
  for (const day of activeDailyPlans.value) {
    for (const item of day.items) {
      if (item.type === "attraction") items.push(item)
    }
  }
  return items
})

const itineraryScore = computed<ItineraryScore | null>(() =>
  currentPlan.value ? scorePlan(currentPlan.value as unknown as Plan) : null,
)

const itemScoreMap = computed<Map<string, ItemScore>>(() => {
  if (!currentPlan.value || !itineraryScore.value) return new Map()
  return buildItemScoreMap(currentPlan.value as never, itineraryScore.value)
})

function itemBadgeColor(dayNum: number, idx: number): string | null {
  const scored = itemScoreMap.value.get(`${dayNum}-${idx}`)
  if (!scored) return null
  return gradeColor(scored.grade)
}

function itemBadgeTitle(dayNum: number, idx: number): string {
  const scored = itemScoreMap.value.get(`${dayNum}-${idx}`)
  if (!scored) return ""
  const missing = scored.checks.filter((c) => !c.found).map((c) => c.label)
  if (missing.length === 0) return `${scored.score}/100`
  return `${scored.score}/100 · 缺少: ${missing.join("、")}`
}

function itemTypeLabel(type: string) {
  const map: Record<string, string> = {
    transport: "交通",
    lodging: "住宿",
    attraction: "景点",
    activity: "活动",
    meal: "餐饮",
    note: "备注",
  }
  return map[type] ?? "行程"
}

function itemTime(item: PlanItem): string {
  return item.time || ""
}

function itemDescription(item: PlanItem): string {
  return item.description || ""
}

function itemTips(item: PlanItem): string[] {
  return item.tips || []
}

function itemLocation(item: PlanItem): string {
  return item.location?.name || ""
}

void workspaceStore
void currentScore
</script>

<template>
  <section class="itinerary-shell">
    <header class="itinerary-masthead">
      <div class="masthead-left">
        <h2 class="masthead-title">旅行方案</h2>
      </div>
      <span
        class="masthead-status"
        :class="{ 'is-active': phase === 'planning' || pendingSelections.length > 0 }"
      >
        <span class="masthead-status-dot" />
        {{ resultStatus }}
      </span>
    </header>

    <div v-if="phase === 'error'" class="postcard-empty postcard-error">
      <p class="postcard-kicker">生成失败</p>
      <p class="postcard-copy">{{ errorMessage || "生成出了点问题，稍等一下再发一次吧。" }}</p>
    </div>

    <div v-else-if="currentPlan" class="itinerary-body">
      <div class="plan-header">
        <div class="plan-header-text">
          <p class="masthead-kicker">目的地</p>
          <h1 class="plan-display-title">{{ displayTitle }}</h1>
          <p v-if="displaySubtitle" class="plan-subtitle-line">{{ displaySubtitle }}</p>
        </div>
        <button type="button" class="copy-button">复制</button>
      </div>

      <ItineraryScore v-if="itineraryScore" :score="itineraryScore" />

      <div v-if="activeBudget" class="budget-stamp">
        <div class="budget-stamp-kicker">
          <span class="masthead-kicker">预算估算</span>
          <span class="budget-stamp-note">本次方案预估总费用</span>
        </div>
        <div class="budget-stamp-value">
          <span class="budget-currency">{{ activeBudget.currency }}</span>
          <span class="budget-amount">{{ activeBudget.amount }}</span>
        </div>
      </div>

      <div class="workspace-grid">
        <section class="preview-card">
          <p class="masthead-kicker">交通建议</p>
          <div v-if="activeTransportItems.length" class="mini-list">
            <article
              v-for="(item, idx) in activeTransportItems"
              :key="`t-${idx}-${item.title}`"
              class="mini-entry"
            >
              <strong class="mini-title">{{ item.title }}</strong>
              <p class="mini-meta">
                <span class="data-tag">{{ itemTime(item) || "待定" }}</span>
                <span class="mini-sep">·</span>
                <span>{{ itemLocation(item) || "交通待确认" }}</span>
              </p>
            </article>
          </div>
          <p v-else class="mini-empty">暂无跨城交通安排，可继续追问 AI 补充。</p>
        </section>

        <section class="preview-card">
          <p class="masthead-kicker">住宿建议</p>
          <div v-if="activeLodgingItems.length" class="mini-list">
            <article
              v-for="(item, idx) in activeLodgingItems"
              :key="`l-${idx}-${item.title}`"
              class="mini-entry"
            >
              <strong class="mini-title">{{ item.title }}</strong>
              <p class="mini-meta">{{ itemLocation(item) || "位置待确认" }}</p>
            </article>
          </div>
          <p v-else class="mini-empty">暂无住宿候选，可继续追问 AI 补充。</p>
        </section>
      </div>

      <section v-if="activeAttractionItems.length" class="preview-card">
        <p class="masthead-kicker">景点与玩法亮点</p>
        <div class="guide-grid">
          <article
            v-for="(poi, idx) in activeAttractionItems"
            :key="`p-${idx}-${poi.title}`"
            class="mini-entry bordered"
          >
            <strong class="mini-title">{{ poi.title }}</strong>
            <p v-if="itemDescription(poi)" class="mini-meta">{{ itemDescription(poi) }}</p>
            <small v-if="itemLocation(poi)" class="mini-foot data-tag">{{ itemLocation(poi) }}</small>
          </article>
        </div>
      </section>

      <article
        v-for="(day, dayIdx) in activeDailyPlans"
        :key="day.day"
        class="preview-card day-card"
        :style="{ animationDelay: `${dayIdx * 60}ms` }"
      >
        <header class="day-head">
          <p class="masthead-kicker day-kicker">
            第 {{ day.day }} 天 · Day {{ String(day.day).padStart(2, '0') }}
          </p>
          <h3 class="day-theme">{{ day.theme || `第 ${day.day} 天` }}</h3>
        </header>
        <hr class="card-rule" />

        <div class="day-items">
          <div
            v-for="(item, idx) in day.items"
            :key="`${day.day}-${idx}-${item.title}`"
            class="day-item"
          >
            <span class="day-item-time data-tag">{{ itemTime(item) || "—" }}</span>
            <span class="day-item-type">{{ itemTypeLabel(item.type) }}</span>
            <div class="day-item-body">
              <strong class="day-item-title">{{ item.title }}</strong>
              <span
                v-if="itemBadgeColor(day.day, idx)"
                class="day-item-badge"
                :style="{ background: itemBadgeColor(day.day, idx) ?? undefined }"
                :title="itemBadgeTitle(day.day, idx)"
              />
              <p v-if="itemDescription(item)" class="day-item-desc">{{ itemDescription(item) }}</p>
              <small v-if="itemTips(item).length" class="day-item-tip">
                {{ itemTips(item).join("；") }}
              </small>
            </div>
          </div>
        </div>
      </article>

      <div v-if="displayTips.length" class="preview-card tips-card">
        <p class="masthead-kicker">出行建议</p>
        <ul class="preview-list">
          <li v-for="tip in displayTips" :key="tip">{{ tip }}</li>
        </ul>
      </div>

      <div class="disclaimer-stamp">
        <span class="masthead-kicker disclaimer-kicker">免责声明</span>
        <span class="disclaimer-body">{{ displayDisclaimer }}</span>
      </div>

      <div v-if="pendingSelections.length" class="pending-selections">
        <p class="masthead-kicker pending-kicker">请确认以下行程细节</p>
        <ItemSelector
          v-for="selection in pendingSelections"
          :key="`${selection.dayNum}-${selection.itemIndex}`"
          :selection="selection"
        />
      </div>
    </div>

    <div v-else-if="phase === 'planning'" class="itinerary-body">
      <div class="planning-stack">
        <p class="masthead-kicker planning-label">行程生成中</p>
        <div class="preview-card planning-step">
          <p class="planning-step-index">01</p>
          <h3 class="planning-step-title">正在生成行程方案</h3>
          <p class="planning-step-body">系统会先生成完整行程，再进入评分与多轮迭代优化阶段。</p>
        </div>
        <div class="preview-card planning-step muted">
          <p class="planning-step-index">02</p>
          <h3 class="planning-step-title">正在评估当前方案得分</h3>
        </div>
        <div class="preview-card planning-step muted dashed">
          <p class="planning-step-index">03</p>
          <h3 class="planning-step-title">将根据缺口继续迭代…</h3>
        </div>
      </div>
    </div>

    <div v-else class="postcard-empty">
      <p class="postcard-kicker">空页</p>
      <p class="postcard-copy">行程规划会出现在这里，先说说你想去哪。</p>
      <small class="postcard-note">
        建议一次性把目的地、天数、人数、预算和偏好说清楚，系统会更快生成方案并进入迭代优化。
      </small>
    </div>
  </section>
</template>

<style scoped>
.itinerary-shell {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-card);
  padding: 24px 26px 26px;
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.itinerary-masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.masthead-left { display: flex; flex-direction: column; gap: 2px; }

.masthead-kicker {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.masthead-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 22px;
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: var(--text);
  margin: 4px 0 0;
}

.masthead-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--accent-success-soft);
  color: #065F46;
  font-family: var(--font-mono);
  font-size: 11px;
  border: 1px solid rgba(16, 185, 129, 0.28);
  border-radius: 999px;
}

.masthead-status.is-active {
  background: var(--brand-purple-soft);
  color: var(--brand-purple);
  border-color: rgba(123, 91, 255, 0.28);
}

.masthead-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.itinerary-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-right: 4px;
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
}
.plan-header-text { display: flex; flex-direction: column; gap: 4px; }

.plan-display-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--text);
  margin: 0;
}

.plan-subtitle-line {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
}

.copy-button {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--r-xs);
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.copy-button:hover { border-color: var(--brand-blue); color: var(--brand-blue); }

.budget-stamp {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 18px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.budget-stamp-kicker { display: flex; flex-direction: column; gap: 4px; }

.budget-stamp-note {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
}

.budget-stamp-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.budget-currency { font-size: 13px; color: var(--text-subtle); }
.budget-amount {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 26px;
  letter-spacing: -0.01em;
  color: var(--text);
}

.preview-card {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
}

.preview-list {
  margin: 8px 0;
  padding-left: 18px;
  list-style: none;
}

.preview-list li {
  position: relative;
  font-family: var(--font-body);
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.6;
  padding: 2px 0;
}

.preview-list li::before {
  content: "•";
  position: absolute;
  left: -14px;
  top: 2px;
  color: var(--brand-blue);
  font-weight: 700;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mini-list { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.mini-entry { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }

.mini-entry.bordered {
  padding: 10px 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}

.mini-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14.5px;
  color: var(--text);
}

.mini-meta {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.mini-sep { color: var(--text-subtle); }

.mini-foot {
  color: var(--text-subtle);
  font-size: 11.5px;
  letter-spacing: 0.04em;
}

.mini-empty {
  font-family: var(--font-body);
  font-size: 13.5px;
  color: var(--text-subtle);
  margin: 8px 0 2px;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  margin-top: 8px;
}

.day-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: fadeRise var(--dur-slow) var(--ease-out) both;
}

.day-head { display: flex; flex-direction: column; gap: 4px; }

.day-kicker { color: var(--brand-purple); }

.day-theme {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--text);
  margin: 2px 0 0;
}

.card-rule {
  border: 0;
  height: 1px;
  background: var(--border);
  margin: 8px 0 12px;
}

.day-items { display: flex; flex-direction: column; gap: 12px; }

.day-item {
  display: grid;
  grid-template-columns: 52px 44px 1fr;
  gap: 10px;
  align-items: flex-start;
}

.day-item-time {
  color: var(--text-subtle);
  font-size: 12px;
  padding-top: 3px;
}

.day-item-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 0;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--brand-blue-deep);
  background: var(--brand-blue-soft);
  border: 1px solid var(--brand-blue-border);
  border-radius: 999px;
}

.day-item-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}

.day-item-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
  padding-right: 20px;
}

.day-item-badge {
  position: absolute;
  top: 4px;
  right: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--bg-elevated);
  box-shadow: 0 0 0 1px var(--border);
}

.day-item-desc {
  font-family: var(--font-body);
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.55;
  margin: 0;
}

.day-item-tip {
  font-family: var(--font-body);
  font-size: 12.5px;
  color: var(--text-subtle);
}

.tips-card .preview-list li::before { color: var(--brand-purple); }

.disclaimer-stamp {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px 16px;
  background: var(--accent-warn-soft);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--r-sm);
}

.disclaimer-kicker { color: #92400E; white-space: nowrap; padding-top: 1px; }

.disclaimer-body {
  font-family: var(--font-body);
  font-size: 12.5px;
  line-height: 1.6;
  color: #92400E;
}

.pending-selections {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--brand-purple-soft);
  border-left: 3px solid var(--brand-purple);
  border-radius: var(--r-md);
  background: var(--brand-purple-soft);
}

.pending-kicker { color: var(--brand-purple); }

.planning-stack { display: flex; flex-direction: column; gap: 12px; }
.planning-label { color: var(--brand-purple); }

.planning-step { display: flex; flex-direction: column; gap: 4px; animation: pulseSoft 1.4s var(--ease-out) infinite alternate; }
.planning-step.muted { opacity: 0.78; }
.planning-step.dashed { border-style: dashed; }

.planning-step-index {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--brand-blue-deep);
}

.planning-step-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 16px;
  color: var(--text);
  margin: 4px 0 0;
}

.planning-step-body {
  font-family: var(--font-body);
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.55;
  margin: 4px 0 0;
}

.postcard-empty {
  padding: 36px 28px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}

.postcard-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
  margin: 0;
}

.postcard-copy {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0;
  max-width: 480px;
}

.postcard-note {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--text-subtle);
  max-width: 520px;
  line-height: 1.7;
}

.postcard-error {
  border-color: rgba(239, 68, 68, 0.3);
  background: var(--accent-danger-soft);
}

.postcard-error .postcard-copy,
.postcard-error .postcard-kicker { color: #991B1B; }

@keyframes fadeRise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulseSoft {
  from { opacity: 0.65; }
  to { opacity: 1; }
}

@media (max-width: 980px) {
  .workspace-grid { grid-template-columns: 1fr; }
  .plan-header { flex-direction: column; align-items: flex-start; }
  .plan-display-title { font-size: 24px; }
}

@media (max-width: 640px) {
  .itinerary-shell { padding: 18px 16px 22px; }
  .day-item { grid-template-columns: 48px 1fr; }
  .day-item-type { display: none; }
  .plan-display-title { font-size: 22px; }
  .masthead-title { font-size: 18px; }
  .budget-amount { font-size: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .itinerary-body, .day-card, .planning-step { animation: none; }
}
</style>
