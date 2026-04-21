<script setup lang="ts">
defineProps<{
  draft: string
  loading: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  submit: [value: string]
  updateDraft: [value: string]
  usePrompt: [value: string]
}>()

const suggestedPrompts = [
  "帮我规划 5 天东京行，2 个人，预算 1 万，喜欢美食和动漫",
  "下周末想去杭州玩 3 天，不想太累",
  "春节带爸妈去三亚 6 天，怕冷",
  "一个人去北海道 7 天，滑雪 + 泡温泉"
]
</script>

<template>
  <section class="hero-input-shell" :class="{ compact }">
    <div v-if="!compact" class="prompt-row">
      <button
        v-for="prompt in suggestedPrompts"
        :key="prompt"
        type="button"
        class="prompt-pill"
        @click="emit('usePrompt', prompt)"
      >
        {{ prompt }}
      </button>
    </div>

    <div class="composer-box">
      <textarea
        :value="draft"
        :rows="compact ? 2 : 3"
        placeholder="说说你的出行需求，目的地 / 天数 / 人数 / 预算 / 偏好…"
        @input="emit('updateDraft', ($event.target as HTMLTextAreaElement).value)"
      />

      <button
        type="button"
        class="send-button"
        :disabled="loading"
        @click="emit('submit', draft)"
      >
        {{ loading ? "规划中..." : "发送" }}
      </button>
    </div>
  </section>
</template>
