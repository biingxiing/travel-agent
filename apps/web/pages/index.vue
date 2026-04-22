<script setup lang="ts">
import { storeToRefs } from "pinia"
import AuthLoginCard from "~/components/AuthLoginCard.vue"
import ChatPanel from "~/components/ChatPanel.vue"
import PlanningPreview from "~/components/PlanningPreview.vue"
import PromptComposer from "~/components/PromptComposer.vue"
import { useAuthApi } from "~/composables/useAuthApi"
import { isAuthRequiredError, useChatStream } from "~/composables/useChatStream"
import { useAuthStore } from "~/stores/auth"
import { useChatStore } from "~/stores/chat"

const chatStore = useChatStore()
const authStore = useAuthStore()
const { fetchAuthStatus, login, logout } = useAuthApi()
const { createSession, streamChat } = useChatStream()

const { agentStatus, draft, errorMessage, messages, phase, plan, sessionId, streamSteps } = storeToRefs(chatStore)
const { errorMessage: authErrorMessage, status: authStatus, username } = storeToRefs(authStore)
const credentials = reactive({
  username: "",
  password: ""
})
const loginPending = ref(false)
const logoutPending = ref(false)
const hasConversation = computed(() => messages.value.length > 1)
const isAuthenticated = computed(() => authStatus.value === "authenticated")

function applySuggestedPrompt(value: string) {
  chatStore.setDraft(value)
}

async function refreshAuthState() {
  authStore.setChecking()

  try {
    const payload = await fetchAuthStatus()

    if (payload.authenticated && payload.username) {
      authStore.setAuthenticated(payload.username)
      return
    }

    authStore.setAnonymous()
  } catch (error) {
    const message = error instanceof Error ? error.message : "暂时无法确认登录状态，请稍后再试。"
    authStore.setAnonymous(message)
  }
}

async function ensureSession() {
  if (sessionId.value) {
    return sessionId.value
  }

  const id = await createSession()
  chatStore.setSession(id)
  return id
}

async function submitPrompt(value: string) {
  const content = value.trim()

  if (!content) {
    chatStore.setInputError()
    return
  }

  chatStore.beginPlanning(content)

  try {
    const activeSessionId = await ensureSession()
    await streamChat(activeSessionId, content, (event) => {
      chatStore.applyStreamEvent(event)
    })
  } catch (error) {
    if (isAuthRequiredError(error)) {
      return
    }

    const message = error instanceof Error ? error.message : "生成出了点问题，稍等一下再发一次吧 🙏"
    chatStore.setRequestError(message)
  }
}

async function submitLogin() {
  if (loginPending.value) {
    return
  }

  const username = credentials.username.trim()
  const password = credentials.password

  if (!username || !password) {
    authStore.setAnonymous("请输入用户名和密码。")
    return
  }

  loginPending.value = true
  authStore.clearError()

  try {
    const payload = await login(username, password)
    authStore.setAuthenticated(payload.username)
    chatStore.resetConversation()
    credentials.password = ""
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败，请稍后再试。"
    authStore.setAnonymous(message)
    credentials.password = ""
  } finally {
    loginPending.value = false
  }
}

async function submitLogout() {
  if (logoutPending.value) {
    return
  }

  logoutPending.value = true
  authStore.clearError()

  try {
    await logout()
    authStore.setAnonymous()
    chatStore.resetConversation()
    credentials.password = ""
  } catch (error) {
    const message = error instanceof Error ? error.message : "退出登录失败，请稍后再试。"
    authStore.setError(message)
  } finally {
    logoutPending.value = false
  }
}

onMounted(async () => {
  await refreshAuthState()
})
</script>

<template>
  <div v-if="authStatus === 'checking'" class="auth-shell auth-shell-loading">
    <div class="auth-loading-card">
      <span class="stream-dot" />
      <span class="stream-dot" />
      <span class="stream-dot" />
      <p>正在确认登录状态...</p>
    </div>
  </div>

  <AuthLoginCard
    v-else-if="!isAuthenticated"
    :error-message="authErrorMessage"
    :loading="loginPending"
    :password="credentials.password"
    :username="credentials.username"
    @submit="submitLogin"
    @update-password="credentials.password = $event"
    @update-username="credentials.username = $event"
  />

  <main v-else class="page-shell">
    <header class="page-topbar">
      <div>
        <div class="compact-brand">旅行规划助手</div>
        <p class="page-topbar-copy">输入目的地、天数、预算和偏好，我会生成可继续追问的旅行方案。</p>
      </div>

      <div class="page-topbar-actions">
        <span class="page-user-chip">{{ username }}</span>
        <button type="button" class="secondary-button" :disabled="logoutPending" @click="submitLogout">
          {{ logoutPending ? "退出中..." : "退出登录" }}
        </button>
      </div>
    </header>

    <p v-if="authErrorMessage" class="page-auth-error">
      {{ authErrorMessage }}
    </p>

    <section v-if="hasConversation" class="compact-header">
      <div class="compact-brand">当前会话</div>
      <p>继续追问、调整行程或补充偏好。</p>
    </section>

    <section class="main-grid">
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

      <PlanningPreview
        :agent-status="agentStatus"
        :error-message="errorMessage"
        :phase="phase"
        :plan="plan"
      />
    </section>
  </main>
</template>
