<script setup lang="ts">
defineProps<{
  username: string
  password: string
  loading: boolean
  errorMessage: string
}>()

const emit = defineEmits<{
  submit: []
  updateUsername: [value: string]
  updatePassword: [value: string]
}>()
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-brand-row">
        <span class="auth-brand-badge">Travel Agent</span>
        <span class="auth-brand-note">Single User Login</span>
      </div>

      <div class="auth-copy">
        <h1>登录后开始规划你的行程</h1>
        <p>当前版本只支持配置文件中的一个用户名和密码。</p>
      </div>

      <form class="auth-form" @submit.prevent="emit('submit')">
        <label class="auth-field">
          <span>用户名</span>
          <input
            :value="username"
            type="text"
            autocomplete="username"
            placeholder="请输入用户名"
            @input="emit('updateUsername', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label class="auth-field">
          <span>密码</span>
          <input
            :value="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            @input="emit('updatePassword', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <p v-if="errorMessage" class="auth-error">
          {{ errorMessage }}
        </p>

        <button type="submit" class="auth-submit" :disabled="loading">
          {{ loading ? "登录中..." : "进入旅行规划助手" }}
        </button>
      </form>
    </section>
  </main>
</template>
