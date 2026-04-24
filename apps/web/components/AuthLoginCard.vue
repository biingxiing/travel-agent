<script setup lang="ts">
import { Sparkles, GitBranch, Download, Eye, EyeOff } from 'lucide-vue-next'
import Tooltip from '~/components/ui/Tooltip.vue'

const props = defineProps<{
  username: string
  password: string
  title: string
  description: string
  status: "idle" | "submitting" | "success"
  contextMode?: "fresh" | "restore" | "expired"
  statusMessage: string
  errorMessage: string
  redirectLabel: string
  helperItems: string[]
}>()

const emit = defineEmits<{
  submit: []
  updateUsername: [value: string]
  updatePassword: [value: string]
}>()

const showPassword = ref(false)

const submitLabel = computed(() => {
  if (props.status === "success") {
    return "登录成功，正在返回..."
  }

  if (props.status === "submitting") {
    return "登录中..."
  }

  return "进入旅行规划助手"
})

const statusTone = computed(() => {
  if (props.status === "success") {
    return "success"
  }

  if (props.errorMessage) {
    return "error"
  }

  return "neutral"
})

const contextLabel = computed(() => {
  if (props.contextMode === "restore") {
    return "继续刚才的工作区"
  }

  if (props.contextMode === "expired") {
    return "登录状态已失效"
  }

  return "安全登录"
})
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card auth-card-split">
      <div class="auth-hero-panel">
        <div class="auth-brand-row">
          <span class="auth-brand-badge">旅行规划助手</span>
          <span class="auth-brand-note">Protected · 2026</span>
        </div>

        <div class="auth-masthead">
          <div class="auth-copy">
            <h1>{{ title }}</h1>
            <p>{{ description }}</p>
          </div>
        </div>

        <div class="auth-route-card">
          <div class="auth-route-head">
            <p class="auth-route-label">登录后返回</p>
            <span class="auth-route-chip">{{ contextLabel }}</span>
          </div>
          <strong>{{ redirectLabel }}</strong>
        </div>

        <ul class="auth-value-props">
          <li>
            <div class="auth-vp-icon"><Sparkles :size="18" :stroke-width="1.5" /></div>
            <div>
              <strong>AI 生成 3 套方案</strong>
              <small>不再反复 try & error</small>
            </div>
          </li>
          <li>
            <div class="auth-vp-icon"><GitBranch :size="18" :stroke-width="1.5" /></div>
            <div>
              <strong>可继续追问与迭代</strong>
              <small>每次修改都保留版本</small>
            </div>
          </li>
          <li>
            <div class="auth-vp-icon"><Download :size="18" :stroke-width="1.5" /></div>
            <div>
              <strong>随时继续上次的规划</strong>
              <small>不会丢</small>
            </div>
          </li>
        </ul>
      </div>

      <div class="auth-form-panel">
        <div class="auth-panel-heading">
          <p class="auth-panel-kicker">账号登录</p>
          <h2>进入旅行规划工作区</h2>
        </div>

        <p
          class="auth-status-banner"
          :class="`is-${statusTone}`"
          aria-live="polite"
        >
          {{ statusMessage }}
        </p>

        <p class="auth-inline-note">
          当前版本使用 <code>apps/api/.env</code> 中配置的单账号登录。
        </p>

        <form class="auth-form" @submit.prevent="emit('submit')">
          <label class="auth-field">
            <span>用户名</span>
            <input
              :value="username"
              type="text"
              autocomplete="username"
              :disabled="status !== 'idle'"
              placeholder="请输入用户名"
              @input="emit('updateUsername', ($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="auth-field">
            <span>密码</span>
            <div class="auth-password-wrap">
              <input
                :value="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                :disabled="status !== 'idle'"
                placeholder="请输入密码"
                @input="emit('updatePassword', ($event.target as HTMLInputElement).value)"
              />

              <Tooltip :label="showPassword ? '隐藏密码' : '显示密码'">
                <button
                  type="button"
                  class="auth-inline-icon-button"
                  :disabled="status !== 'idle'"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <component :is="showPassword ? EyeOff : Eye" :size="16" :stroke-width="1.5" />
                </button>
              </Tooltip>
            </div>
          </label>

          <button type="submit" class="auth-submit" :disabled="status !== 'idle'">
            {{ submitLabel }}
          </button>

          <p class="auth-submit-hint">
            输入正确账号密码后会回到旅行工作区；如果刚才已有内容，会优先恢复当前上下文。
          </p>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-masthead {
  display: grid;
  gap: 6px;
}

.auth-panel-heading {
  display: grid;
  gap: 2px;
}

code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 6px;
  background: var(--bg-subtle);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.auth-value-props {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}
.auth-value-props li {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 12px;
  align-items: start;
}
.auth-vp-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
}
.auth-value-props strong {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--type-body-size);
  color: var(--text);
}
.auth-value-props small {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--type-body-sm-size);
  line-height: 1.5;
}

.auth-inline-icon-button {
  position: absolute;
  top: 50%; right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.auth-inline-icon-button:hover:not(:disabled) {
  border-color: var(--brand-blue);
  color: var(--brand-blue);
}
.auth-inline-icon-button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
