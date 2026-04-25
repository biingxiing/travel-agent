<script setup lang="ts">
import { storeToRefs } from "pinia"
import AuthLoginCard from "~/components/AuthLoginCard.vue"
import { useAuthApi } from "~/composables/useAuthApi"
import { useAuthStore } from "~/stores/auth"
import { useChatStore } from "~/stores/chat"

const authStore = useAuthStore()
const chatStore = useChatStore()
const { fetchAuthStatus, login } = useAuthApi()
const route = useRoute()
const router = useRouter()

if (import.meta.client) {
  chatStore.hydrateFromSessionStorage()
}

const { errorMessage: authErrorMessage, redirectPath, status: authStatus } = storeToRefs(authStore)
const { draft, messages, plan } = storeToRefs(chatStore)

const credentials = reactive({
  username: "",
  password: ""
})

const loginPending = ref(false)
const loginStage = ref<"idle" | "submitting" | "success">("idle")

const hasRecoverableContext = computed(() =>
  draft.value.trim().length > 0 || messages.value.length > 1 || Boolean(plan.value),
)

const loginRedirectTarget = computed(() => {
  const fromQuery = sanitizeReturnTarget(
    typeof route.query.redirect === "string" ? route.query.redirect.trim() : "",
  )

  if (fromQuery.startsWith("/") && fromQuery !== "/login") {
    return fromQuery
  }

  const fromStore = sanitizeReturnTarget(redirectPath.value)

  if (fromStore.startsWith("/") && fromStore !== "/login") {
    return fromStore
  }

  return "/"
})

const loginRedirectLabel = computed(() =>
  loginRedirectTarget.value !== "/" ? loginRedirectTarget.value : "旅行规划首页",
)

const loginTitle = computed(() => {
  if (authErrorMessage.value.includes("已失效")) {
    return "登录状态已失效，请重新进入工作区"
  }

  if (hasRecoverableContext.value) {
    return "重新登录后继续刚才的规划"
  }

  return "登录后开始规划你的行程"
})

const loginDescription = computed(() => {
  if (hasRecoverableContext.value) {
    return "当前输入和已生成内容会保留，重新登录后直接回到当前工作区继续规划。"
  }

  return "当前页面受登录保护，登录后即可进入对话式旅行规划工作区。"
})

const loginStatus = computed(() => {
  if (loginStage.value === "success") {
    return "success"
  }

  if (loginPending.value) {
    return "submitting"
  }

  return "idle"
})

const loginStatusMessage = computed(() => {
  if (loginStage.value === "success") {
    return "登录成功，正在返回旅行规划工作区..."
  }

  if (loginPending.value) {
    return "正在验证账号信息并建立登录态..."
  }

  if (authErrorMessage.value) {
    return authErrorMessage.value
  }

  return `登录后将返回 ${loginRedirectLabel.value}。`
})

const loginContextMode = computed<"fresh" | "restore" | "expired">(() => {
  if (authErrorMessage.value.includes("已失效")) {
    return "expired"
  }

  if (hasRecoverableContext.value) {
    return "restore"
  }

  return "fresh"
})

const loginHelperItems = computed(() => {
  const items = [
    "未登录访问受保护页面时，会先跳到独立登录页。",
    "刷新后会自动恢复登录态；如果登录失效，会保留当前输入并要求重新登录。",
    "本地联调请同时启动 Web 和 API。"
  ]

  if (authErrorMessage.value.includes("用户名或密码错误")) {
    items[0] = "请确认账号信息后重试；如忘记密码请联系管理员。"
  }

  if (authErrorMessage.value.includes("超时") || authErrorMessage.value.includes("无法连接")) {
    items[2] = "网络似乎不稳定，请稍后再试或检查网络连接。"
  }

  return items
})

function rememberRedirectTarget() {
  authStore.setRedirectPath(loginRedirectTarget.value)
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

function buildWorkspaceReturnUrl(target: string, flag: "login" | "restored") {
  const separator = target.includes("?") ? "&" : "?"
  return `${target}${separator}${flag}=1`
}

async function refreshAuthState() {
  const previousError = authErrorMessage.value
  authStore.setChecking()
  rememberRedirectTarget()

  try {
    const payload = await fetchAuthStatus()

    if (payload.authenticated && payload.username) {
      authStore.setAuthenticated(payload.username)
      await router.replace(loginRedirectTarget.value)
      return
    }

    authStore.setAnonymous(previousError, loginRedirectTarget.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : "暂时无法确认登录状态，请稍后再试。"
    authStore.setAnonymous(message, loginRedirectTarget.value)
  }
}

async function submitLogin() {
  if (loginPending.value) {
    return
  }

  const nextUsername = credentials.username.trim()
  const password = credentials.password
  const previousAuthMessage = authErrorMessage.value
  const shouldRestoreContext = hasRecoverableContext.value || previousAuthMessage.includes("已失效")

  if (!nextUsername || !password) {
    authStore.setAnonymous("请输入用户名和密码。", loginRedirectTarget.value)
    return
  }

  loginPending.value = true
  loginStage.value = "submitting"
  authStore.clearError()
  rememberRedirectTarget()

  try {
    const payload = await login(nextUsername, password)
    credentials.username = payload.username
    credentials.password = ""
    loginStage.value = "success"

    await new Promise((resolve) => setTimeout(resolve, 700))

    authStore.setAuthenticated(payload.username)
    const nextPath = authStore.consumeRedirectPath(loginRedirectTarget.value)
    const target = nextPath && nextPath !== "/login" ? nextPath : "/"
    authStore.setRedirectPath(target)

    await router.replace(buildWorkspaceReturnUrl(target, shouldRestoreContext ? "restored" : "login"))
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败，请稍后再试。"
    authStore.setAnonymous(message, loginRedirectTarget.value)
    credentials.password = ""
  } finally {
    loginPending.value = false
    loginStage.value = "idle"
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
      <p>正在确认登录状态</p>
    </div>
  </div>

  <AuthLoginCard
    v-else
    :context-mode="loginContextMode"
    :description="loginDescription"
    :error-message="authErrorMessage"
    :helper-items="loginHelperItems"
    :password="credentials.password"
    :redirect-label="loginRedirectLabel"
    :status="loginStatus"
    :status-message="loginStatusMessage"
    :title="loginTitle"
    :username="credentials.username"
    @submit="submitLogin"
    @update-password="credentials.password = $event"
    @update-username="credentials.username = $event"
  />
</template>
