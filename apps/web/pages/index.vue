<script setup lang="ts">
import { storeToRefs } from "pinia"
import { ChevronDown, History, LogOut, Settings, User } from "lucide-vue-next"
import ChatPanel from "~/components/ChatPanel.vue"
import HeroPlannerCard from "~/components/HeroPlannerCard.vue"
import PlanningPreview from "~/components/PlanningPreview.vue"
import PromptComposer from "~/components/PromptComposer.vue"
import TripHistoryGrid from "~/components/TripHistoryGrid.vue"
import DropdownMenu, { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenu.vue"
import { useAuthApi } from "~/composables/useAuthApi"
import { useChatStream } from "~/composables/useChatStream"
import { useTripHistory, type TripHistoryEntry } from "~/composables/useTripHistory"
import { useAuthStore } from "~/stores/auth"
import { useChatStore } from "~/stores/chat"
import { useWorkspaceStore } from "~/stores/workspace"

const chatStore = useChatStore()
const authStore = useAuthStore()
const workspaceStore = useWorkspaceStore()
const { fetchAuthStatus, logout } = useAuthApi()
const { upsert: _upsertTripHistory } = useTripHistory()
const route = useRoute()
const router = useRouter()
const { $toast } = useNuxtApp()

if (import.meta.client) {
  chatStore.hydrateFromSessionStorage()
  workspaceStore.hydrateFromSessionStorage()
}

const stream = useChatStream(workspaceStore.sessionId)

const {
  agentStatus,
  draft,
  errorMessage,
  messages,
  phase,
  streamSteps,
  iteration,
  maxIterations,
  displayScore,
  targetScore,
  loopStatus,
  awaitingClarify,
  maxIterReached,
  canContinue,
} = storeToRefs(chatStore)
const { errorMessage: authErrorMessage, status: authStatus, username } = storeToRefs(authStore)
const { sessionId: workspaceSessionId, currentPlan } = storeToRefs(workspaceStore)
const logoutPending = ref(false)
const pageShellRef = ref<HTMLElement | null>(null)
const mainSectionRef = ref<HTMLElement | null>(null)
const mainSplitRef = ref<HTMLElement | null>(null)
const mainSectionHeight = ref<number | null>(null)
const leftPanelWidth = ref(54)
const isResizingMainSection = ref(false)
const isResizingSplit = ref(false)
let stopActiveResize: (() => void) | null = null
const hasConversation = computed(() => messages.value.length > 1)
const hasWorkspaceState = computed(() => Boolean(currentPlan.value || workspaceSessionId.value))
const isAuthenticated = computed(() => authStatus.value === "authenticated")
const isLanding = computed(() => !hasConversation.value && !hasWorkspaceState.value)
const pageNotice = computed(() => {
  if (route.query.restored === "1") {
    return "已恢复登录，可继续刚才的规划内容。"
  }

  if (route.query.login === "1") {
    return username.value ? `欢迎回来，${username.value}。现在可以开始规划行程了。` : "登录成功。"
  }

  return ""
})
const breadcrumbDestination = computed(() => currentPlan.value?.destination || "")

watch(pageNotice, (msg) => {
  if (msg) $toast.info(msg)
})
watch(authErrorMessage, (msg) => {
  if (msg) $toast.error(msg)
})

const mainSectionStyle = computed(() =>
  mainSectionHeight.value ? { height: `${mainSectionHeight.value}px` } : undefined,
)
const mainGridStyle = computed(() => ({
  "--main-grid-left": `${leftPanelWidth.value}%`,
}))

const PANEL_LAYOUT_STORAGE_KEY = "travel-agent-panel-layout"
const MAIN_SECTION_MIN_HEIGHT = 360
const MAIN_SPLIT_MIN_LEFT_PX = 420
const MAIN_SPLIT_MIN_RIGHT_PX = 420

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function readStoredPanelLayout() {
  if (!import.meta.client) return

  const raw = window.sessionStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)
  if (!raw) return

  try {
    const parsed = JSON.parse(raw) as {
      leftPanelWidth?: number
      mainSectionHeight?: number | null
    }

    if (typeof parsed.leftPanelWidth === "number") {
      leftPanelWidth.value = parsed.leftPanelWidth
    }

    if (typeof parsed.mainSectionHeight === "number") {
      mainSectionHeight.value = parsed.mainSectionHeight
    }
  } catch {
    window.sessionStorage.removeItem(PANEL_LAYOUT_STORAGE_KEY)
  }
}

function writeStoredPanelLayout() {
  if (!import.meta.client) return

  window.sessionStorage.setItem(
    PANEL_LAYOUT_STORAGE_KEY,
    JSON.stringify({
      leftPanelWidth: leftPanelWidth.value,
      mainSectionHeight: mainSectionHeight.value,
    }),
  )
}

function availableMainSectionHeight() {
  const shell = pageShellRef.value
  const main = mainSectionRef.value

  if (!shell || !main) {
    return 760
  }

  const shellRect = shell.getBoundingClientRect()
  const mainRect = main.getBoundingClientRect()
  const maxHeight = shellRect.height - (mainRect.top - shellRect.top)

  return Math.max(MAIN_SECTION_MIN_HEIGHT, Math.floor(maxHeight))
}

function clampMainSectionHeight(value: number) {
  return clamp(value, MAIN_SECTION_MIN_HEIGHT, availableMainSectionHeight())
}

function clampLeftPanelPercent(value: number) {
  const width = mainSplitRef.value?.clientWidth ?? 0

  if (width <= MAIN_SPLIT_MIN_LEFT_PX + MAIN_SPLIT_MIN_RIGHT_PX) {
    return 50
  }

  const min = (MAIN_SPLIT_MIN_LEFT_PX / width) * 100
  const max = 100 - (MAIN_SPLIT_MIN_RIGHT_PX / width) * 100
  return clamp(value, min, max)
}

function syncPanelLayoutBounds() {
  if (!import.meta.client || window.innerWidth <= 980) {
    return
  }

  leftPanelWidth.value = clampLeftPanelPercent(leftPanelWidth.value)

  if (mainSectionHeight.value !== null) {
    mainSectionHeight.value = clampMainSectionHeight(mainSectionHeight.value)
  }
}

function clearResizeState() {
  isResizingMainSection.value = false
  isResizingSplit.value = false
  document.body.classList.remove("is-panel-resizing")
}

function beginPointerResize(
  event: PointerEvent,
  onMove: (moveEvent: PointerEvent) => void,
  onFinish: () => void,
) {
  if (!import.meta.client) return

  stopActiveResize?.()
  event.preventDefault()
  event.stopPropagation()
  document.body.classList.add("is-panel-resizing")

  const move = (moveEvent: PointerEvent) => {
    onMove(moveEvent)
  }

  const stop = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", stop)
    window.removeEventListener("pointercancel", stop)
    stopActiveResize = null
    clearResizeState()
    onFinish()
  }

  stopActiveResize = stop
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", stop)
  window.addEventListener("pointercancel", stop)
}

function startMainSectionResize(event: PointerEvent) {
  if (!import.meta.client || window.innerWidth <= 980 || !mainSectionRef.value) {
    return
  }

  isResizingMainSection.value = true
  const startY = event.clientY
  const startHeight = mainSectionRef.value.offsetHeight

  beginPointerResize(
    event,
    (moveEvent) => {
      mainSectionHeight.value = clampMainSectionHeight(startHeight + moveEvent.clientY - startY)
    },
    writeStoredPanelLayout,
  )
}

function startSplitResize(event: PointerEvent) {
  if (!import.meta.client || window.innerWidth <= 980 || !mainSplitRef.value) {
    return
  }

  isResizingSplit.value = true
  const startX = event.clientX
  const width = mainSplitRef.value.clientWidth
  const startWidth = leftPanelWidth.value

  beginPointerResize(
    event,
    (moveEvent) => {
      const nextWidth = startWidth + ((moveEvent.clientX - startX) / width) * 100
      leftPanelWidth.value = clampLeftPanelPercent(nextWidth)
    },
    writeStoredPanelLayout,
  )
}

function applySuggestedPrompt(value: string) {
  chatStore.setDraft(value)
}

function sanitizeReturnTarget(target: string) {
  if (!target.startsWith("/")) {
    return "/"
  }

  const url = new URL(target, "http://travel-agent.local")
  url.searchParams.delete("login")
  url.searchParams.delete("restored")
  return `${url.pathname}${url.search}${url.hash}`
}

function buildProtectedReturnPath() {
  return sanitizeReturnTarget(route.fullPath || "/")
}

function rememberProtectedTarget() {
  authStore.setRedirectPath(buildProtectedReturnPath())
}

function buildLoginLocation() {
  return {
    path: "/login",
    query: {
      redirect: buildProtectedReturnPath()
    }
  }
}

async function redirectToLogin() {
  if (route.path === "/login") {
    return
  }

  await router.replace(buildLoginLocation())
}

async function refreshAuthState() {
  authStore.setChecking()
  rememberProtectedTarget()

  try {
    const payload = await fetchAuthStatus()

    if (payload.authenticated && payload.username) {
      authStore.setAuthenticated(payload.username)
      return
    }

    authStore.setAnonymous("", route.fullPath || "/")
    await redirectToLogin()
  } catch (error) {
    const message = error instanceof Error ? error.message : "暂时无法确认登录状态，请稍后再试。"
    authStore.setAnonymous(message, route.fullPath || "/")
    await redirectToLogin()
  }
}

async function submitPrompt(value: string) {
  const content = value.trim()

  if (!content) {
    chatStore.setInputError()
    return
  }

  chatStore.beginPlanning(content)

  try {
    await stream.sendMessage(content, {
      onEvent: (event) => {
        chatStore.handleStreamEvent(event)
        // Sync sessionId from stream into stores after first event
        const id = stream.getSessionId()
        if (id) {
          if (!chatStore.sessionId) chatStore.setSession(id)
          if (workspaceStore.sessionId !== id) {
            workspaceStore.sessionId = id
            workspaceStore.persistState()
          }
        }
      },
      onClose: () => {
        chatStore.completePlannerResponse(
          currentPlan.value
            ? "已为你生成最新方案，右侧可以查看完整行程。"
            : "已收到你的需求，请继续补充信息。"
        )
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : "生成出了点问题，稍等一下再发一次吧 🙏"
        chatStore.setRequestError(message)
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成出了点问题，稍等一下再发一次吧 🙏"
    chatStore.setRequestError(message)
  }
}

async function onContinue() {
  await stream.continueOptimization({
    onEvent: (event) => {
      chatStore.handleStreamEvent(event)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "继续优化失败，请稍后再试。"
      chatStore.setRequestError(message)
    },
  })
}

async function loadHistoryEntry(entry: TripHistoryEntry) {
  try {
    const { session } = await stream.loadSession(entry.sessionId)
    workspaceStore.hydrateFromSession(session)
    workspaceStore.persistState()
    // Reset chat conversation; ReAct sessions restore visual state via workspace
    // (plan + score). Detailed message history is not bulk-restored — user can
    // continue with a new prompt against the restored session.
    chatStore.resetConversation()
    chatStore.setSession(session.id)
  } catch (err) {
    console.error("[loadHistoryEntry] failed", err)
  }
}

function returnToLanding() {
  chatStore.resetConversation()
  workspaceStore.reset()
  stream.setSessionId(null)
  workspaceStore.persistState()
}

async function submitLogout() {
  if (logoutPending.value) {
    return
  }

  logoutPending.value = true
  authStore.clearError()
  rememberProtectedTarget()

  try {
    await logout()
    authStore.setAnonymous("已退出登录。", route.fullPath || "/")
    chatStore.resetConversation()
    workspaceStore.reset()
    stream.setSessionId(null)
    workspaceStore.persistState()
    await redirectToLogin()
  } catch (error) {
    const message = error instanceof Error ? error.message : "退出登录失败，请稍后再试。"
    authStore.setError(message)
  } finally {
    logoutPending.value = false
  }
}

onMounted(async () => {
  await refreshAuthState()
  await nextTick()
  readStoredPanelLayout()
  syncPanelLayoutBounds()
  window.addEventListener("resize", syncPanelLayoutBounds)
})

watch(
  () => route.fullPath,
  () => {
    if (!isAuthenticated.value) {
      rememberProtectedTarget()
    }
  },
  { immediate: true }
)

watch(
  () => authStatus.value,
  async (nextStatus) => {
    if (nextStatus === "anonymous") {
      await redirectToLogin()
    }
  }
)

onBeforeUnmount(() => {
  stopActiveResize?.()
  window.removeEventListener("resize", syncPanelLayoutBounds)
})

</script>

<template>
  <div v-if="authStatus !== 'authenticated'" class="auth-shell auth-shell-loading">
    <div class="auth-loading-card">
      <span class="stream-dot" />
      <span class="stream-dot" />
      <span class="stream-dot" />
      <p>{{ authStatus === "checking" ? "正在确认登录状态" : "正在跳转到登录页" }}</p>
    </div>
  </div>

  <main
    v-else
    ref="pageShellRef"
    class="page-shell"
    :class="{ 'is-landing': isLanding, 'is-conversation': !isLanding }"
  >
    <header class="page-topbar">
      <div class="page-topbar-brand">
        <button
          type="button"
          class="compact-brand"
          aria-label="回到首页"
          @click="returnToLanding"
        >
          旅行规划助手
        </button>
        <div v-if="breadcrumbDestination" class="page-breadcrumb">
          <span>规划</span>
          <span class="page-breadcrumb-sep">/</span>
          <span class="page-breadcrumb-current">{{ breadcrumbDestination }}</span>
        </div>
        <p v-else class="page-topbar-copy">
          输入目的地、天数、预算和偏好，我会生成可继续追问的旅行方案。
        </p>
      </div>

      <div class="page-topbar-actions">
        <DropdownMenu>
          <template #trigger>
            <button type="button" class="page-user-chip">
              {{ username }}
              <ChevronDown :size="14" :stroke-width="1.75" />
            </button>
          </template>
          <DropdownMenuItem @select="() => {}">
            <User :size="14" :stroke-width="1.5" />
            账号信息
          </DropdownMenuItem>
          <DropdownMenuItem @select="returnToLanding">
            <History :size="14" :stroke-width="1.5" />
            规划历史
          </DropdownMenuItem>
          <DropdownMenuItem @select="() => {}">
            <Settings :size="14" :stroke-width="1.5" />
            偏好设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="is-danger" @select="submitLogout">
            <LogOut :size="14" :stroke-width="1.5" />
            {{ logoutPending ? '退出中…' : '退出登录' }}
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>

    <template v-if="isLanding">
      <div class="landing-stack">
        <HeroPlannerCard :loading="phase === 'planning'" @submit="submitPrompt" />
        <TripHistoryGrid @select="loadHistoryEntry" />
      </div>
    </template>

    <template v-else>
      <!-- ReAct progress bar -->
      <div v-if="loopStatus" class="react-progress">
        <div class="react-progress-head">
          <span class="react-progress-label">
            {{ loopStatus === 'evaluating'
              ? 'AI 正在评估当前方案…'
              : `第 ${iteration} / ${maxIterations} 轮优化中` }}
          </span>
          <span v-if="displayScore !== null" class="react-progress-score">
            {{ displayScore }} / {{ targetScore }}
          </span>
        </div>
        <progress
          class="react-progress-bar"
          :value="displayScore ?? 0"
          :max="targetScore"
        ></progress>
      </div>

      <!-- Clarify question -->
      <div v-if="awaitingClarify" class="clarify-card">
        <p class="clarify-kicker">需要补充信息</p>
        <p class="clarify-question">{{ awaitingClarify.question }}</p>
        <p class="clarify-hint">在下方对话框中回复，方案将继续生成。</p>
      </div>

      <!-- Continue optimization button -->
      <div v-if="canContinue && maxIterReached" class="continue-card">
        <div class="continue-card-text">
          <p class="continue-card-title">已优化 {{ maxIterations }} 轮</p>
          <p class="continue-card-meta">
            当前 {{ maxIterReached.currentScore }} 分（目标 {{ targetScore }}），是否继续优化？
          </p>
        </div>
        <button type="button" class="continue-button" @click="onContinue">
          继续优化
        </button>
      </div>

      <div
        ref="mainSectionRef"
        class="resizable-panel resizable-panel-main"
        :class="{ 'is-resizing': isResizingMainSection }"
        :style="mainSectionStyle"
      >
        <section ref="mainSplitRef" class="main-grid" :style="mainGridStyle">
          <div class="main-grid-panel main-grid-panel-primary">
            <ChatPanel
              :agent-status="agentStatus"
              :messages="messages"
              :phase="phase"
              :stream-steps="streamSteps"
            >
              <template #composer>
                <PromptComposer
                  compact
                  :draft="draft"
                  :loading="phase === 'planning'"
                  @submit="submitPrompt"
                  @update-draft="chatStore.setDraft"
                  @use-prompt="applySuggestedPrompt"
                />
              </template>
            </ChatPanel>
          </div>

          <button
            type="button"
            class="main-grid-divider"
            :class="{ 'is-resizing': isResizingSplit }"
            aria-label="调整对话区和结果区宽度"
            @pointerdown="startSplitResize"
          >
            <span class="main-grid-divider-track" />
            <span class="main-grid-divider-grip">
              <span />
              <span />
              <span />
            </span>
          </button>

          <div class="main-grid-panel">
            <PlanningPreview
              :agent-status="agentStatus"
              :error-message="errorMessage"
              :phase="phase"
            />
          </div>
        </section>

        <button
          type="button"
          class="panel-resize-handle"
          aria-label="调整下方工作区高度"
          @pointerdown="startMainSectionResize"
        />
      </div>
    </template>
  </main>
</template>

<style scoped>
.page-topbar-brand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.compact-brand {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
}

.landing-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 8px 0 40px;
}

.react-progress {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-left: 3px solid var(--brand-purple);
  border-radius: var(--r-md);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
}

.react-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.react-progress-label {
  font-family: var(--font-display);
  font-size: 13.5px;
  color: var(--text);
  font-weight: 600;
}

.react-progress-score {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: var(--brand-purple);
}

.react-progress-bar {
  appearance: none;
  width: 100%;
  height: 6px;
  border: 0;
  border-radius: 999px;
  background: var(--brand-purple-soft);
  overflow: hidden;
}

.react-progress-bar::-webkit-progress-bar {
  background: var(--brand-purple-soft);
  border-radius: 999px;
}

.react-progress-bar::-webkit-progress-value {
  background: var(--brand-gradient, var(--brand-purple));
  border-radius: 999px;
  transition: width var(--dur-fast, 0.2s) var(--ease-out, ease);
}

.react-progress-bar::-moz-progress-bar {
  background: var(--brand-purple);
  border-radius: 999px;
}

.clarify-card {
  background: var(--brand-blue-soft);
  border: 1px solid var(--brand-blue-border);
  border-left: 3px solid var(--brand-blue);
  border-radius: var(--r-md);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.clarify-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--brand-blue-deep);
  margin: 0;
}

.clarify-question {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
  margin: 0;
  line-height: 1.45;
}

.clarify-hint {
  font-family: var(--font-body);
  font-size: 12.5px;
  color: var(--text-muted);
  margin: 0;
}

.continue-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-left: 3px solid var(--brand-purple);
  border-radius: var(--r-md);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: var(--shadow-sm);
}

.continue-card-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.continue-card-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  margin: 0;
}

.continue-card-meta {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.continue-button {
  appearance: none;
  background: var(--brand-gradient, var(--brand-purple));
  color: var(--text-inverse, #fff);
  border: 0;
  border-radius: var(--r-md);
  padding: 10px 20px;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  box-shadow: var(--shadow-brand, var(--shadow-sm));
  transition: transform var(--dur-fast, 0.2s) var(--ease-out, ease);
  white-space: nowrap;
}

.continue-button:hover {
  transform: translateY(-1px);
}

@media (max-width: 640px) {
  .landing-stack { gap: 22px; padding-bottom: 24px; }
  .continue-card { flex-direction: column; align-items: stretch; }
  .continue-button { width: 100%; }
}

.page-breadcrumb {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-mono);
  font-size: var(--type-caption-size);
  color: var(--text-subtle);
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.page-breadcrumb-sep { color: var(--text-subtle); opacity: 0.6; }
.page-breadcrumb-current { color: var(--text); font-weight: 600; }

.page-user-chip {
  appearance: none;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 5px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: var(--type-body-sm-size);
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.page-user-chip:hover { border-color: var(--border-strong); }
.page-user-chip::before {
  content: "";
  display: inline-block;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: var(--gradient-brand);
}
</style>
