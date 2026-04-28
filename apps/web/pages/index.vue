<script setup lang="ts">
import { storeToRefs } from "pinia"
import { ChevronDown, History, LogOut, Menu, Plus, Settings, User } from "lucide-vue-next"
import ChatPanel from "~/components/ChatPanel.vue"
import HeroPlannerCard from "~/components/HeroPlannerCard.vue"
import PlanningPreview from "~/components/PlanningPreview.vue"
import PromptComposer from "~/components/PromptComposer.vue"
import TripHistoryGrid from "~/components/TripHistoryGrid.vue"
import ClarifyCard from "~/components/react/ClarifyCard.vue"
import MaxIterCard from "~/components/react/MaxIterCard.vue"
import ReactProgressBar from "~/components/react/ReactProgressBar.vue"
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
const sidebarOpen = ref(false)
const mainSplitRef = ref<HTMLElement | null>(null)
const leftPanelWidth = ref(42)
const isResizingSplit = ref(false)
let stopActiveResize: (() => void) | null = null
const hasConversation = computed(() => messages.value.length > 1)
const hasWorkspaceState = computed(() => Boolean(currentPlan.value || workspaceSessionId.value))
const hasPlanArtifact = computed(() => Boolean(currentPlan.value))
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
const breadcrumbDestination = computed(() =>
  (currentPlan.value?.destinations ?? []).join(' / ') || ''
)

watch(pageNotice, (msg) => {
  if (msg) $toast.info(msg)
})
watch(authErrorMessage, (msg) => {
  if (msg) $toast.error(msg)
})

const mainGridStyle = computed(() => ({
  "--main-grid-left": `${leftPanelWidth.value}%`,
}))

const PANEL_LAYOUT_STORAGE_KEY = "travel-agent-panel-layout"
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
    }

    if (typeof parsed.leftPanelWidth === "number") {
      leftPanelWidth.value = parsed.leftPanelWidth
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
    }),
  )
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
}

function clearResizeState() {
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

function onUseDefault(suggestion: string) {
  submitPrompt(suggestion)
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
            : chatStore.awaitingClarify?.question ?? ""
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
  sidebarOpen.value = false
  try {
    const { session } = await stream.loadSession(entry.sessionId)
    stream.setSessionId(session.id)
    workspaceStore.hydrateFromSession(session)
    workspaceStore.persistState()
    chatStore.hydrateFromSessionMessages(session.messages)
    chatStore.setSession(session.id)
  } catch (err) {
    const isNotFound = err instanceof Error && err.message.includes('404')
    if (isNotFound) {
      $toast.error("该行程已失效，可能是服务重启导致，请重新规划。")
      const { remove } = useTripHistory()
      remove(entry.sessionId)
    } else {
      console.error("[loadHistoryEntry] failed", err)
      $toast.error("加载行程失败，请稍后再试。")
    }
  }
}

function startNewConversation() {
  chatStore.resetConversation()
  workspaceStore.reset()
  stream.setSessionId(null)
  workspaceStore.persistState()
  sidebarOpen.value = false
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
    class="page-shell"
    :class="{ 'is-landing': isLanding, 'is-conversation': !isLanding }"
  >
    <header class="page-topbar">
      <div class="page-topbar-brand">
        <button
          type="button"
          class="compact-brand"
          aria-label="回到首页"
          @click="startNewConversation"
        >
          旅行规划助手
        </button>
        <div v-if="breadcrumbDestination" class="page-breadcrumb">
          <span>规划</span>
          <span class="page-breadcrumb-sep">/</span>
          <span class="page-breadcrumb-current">{{ breadcrumbDestination }}</span>
        </div>
        <p v-else-if="isLanding" class="page-topbar-copy">
          输入目的地、天数、预算和偏好，我会生成可继续追问的旅行方案。
        </p>
      </div>

      <button
        type="button"
        class="sidebar-hamburger"
        aria-label="打开历史记录"
        @click="sidebarOpen = !sidebarOpen"
      >
        <Menu :size="18" :stroke-width="1.75" />
      </button>

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
          <DropdownMenuItem @select="startNewConversation">
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

    <div class="page-body">
      <!-- Sidebar -->
      <aside
        class="history-sidebar"
        :class="{ 'is-open': sidebarOpen }"
      >
        <button
          type="button"
          class="sidebar-new-btn"
          @click="startNewConversation"
        >
          <Plus :size="14" :stroke-width="2" />
          新建行程
        </button>
        <TripHistoryGrid
          variant="list"
          :active-session-id="workspaceSessionId"
          @select="loadHistoryEntry"
        />
      </aside>

      <!-- Overlay for mobile -->
      <div
        v-if="sidebarOpen"
        class="sidebar-overlay"
        @click="sidebarOpen = false"
      />

      <!-- Main content -->
      <div class="page-main">
        <template v-if="isLanding">
          <div class="landing-stack">
            <HeroPlannerCard :loading="phase === 'planning'" @submit="submitPrompt" />
          </div>
        </template>

        <template v-else>
          <!-- ReAct loop UI (mutually exclusive) -->
          <ReactProgressBar
            v-if="loopStatus"
            :loop-status="loopStatus"
            :iteration="iteration"
            :max-iterations="maxIterations"
            :display-score="displayScore"
            :target-score="targetScore"
          />
          <ClarifyCard
            v-else-if="awaitingClarify"
            :question="awaitingClarify.question"
            :reason="awaitingClarify.reason"
            :default-suggestion="awaitingClarify.defaultSuggestion"
            @use-default="onUseDefault"
          />
          <MaxIterCard
            v-else-if="canContinue && maxIterReached"
            :max-iterations="maxIterations"
            :current-score="maxIterReached.currentScore"
            :target-score="targetScore"
            @continue="onContinue"
          />

          <section class="main-section">
            <section
              ref="mainSplitRef"
              class="main-grid"
              :class="{ 'is-single-panel': !hasPlanArtifact }"
              :style="mainGridStyle"
            >
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

              <template v-if="hasPlanArtifact">
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
              </template>
            </section>
          </section>
        </template>
      </div>
    </div>
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

.page-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.history-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 8px;
  overflow-y: auto;
  background: var(--bg);
}

.sidebar-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  font-family: var(--font-display);
  font-size: var(--type-body-sm-size);
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.sidebar-new-btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-surface);
}

.page-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.landing-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 8px 0 40px;
}

.sidebar-hamburger {
  display: none;
  appearance: none;
  background: transparent;
  border: 0;
  padding: 4px;
  cursor: pointer;
  color: var(--text);
}

.sidebar-overlay {
  display: none;
}

@media (max-width: 768px) {
  .history-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 200;
    width: 280px;
    transform: translateX(-100%);
    transition: transform 0.22s var(--ease-out);
    box-shadow: var(--shadow-xl);
  }
  .history-sidebar.is-open {
    transform: translateX(0);
  }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 199;
    background: rgba(0,0,0,0.3);
  }
  .sidebar-hamburger {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

@media (max-width: 640px) {
  .landing-stack { gap: 22px; padding-bottom: 24px; }
  .page-topbar-brand { gap: 4px; }
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
