<script setup lang="ts">
import { storeToRefs } from "pinia"
import ChatPanel from "~/components/ChatPanel.vue"
import PlanningPreview from "~/components/PlanningPreview.vue"
import PromptComposer from "~/components/PromptComposer.vue"
import { useChatStream } from "~/composables/useChatStream"
import { useChatStore } from "~/stores/chat"

const chatStore = useChatStore()
const { createSession, streamChat } = useChatStream()

const { agentStatus, draft, errorMessage, messages, phase, plan, sessionId, streamSteps } = storeToRefs(chatStore)
const hasConversation = computed(() => messages.value.length > 1)

function applySuggestedPrompt(value: string) {
  chatStore.setDraft(value)
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
    const message = error instanceof Error ? error.message : "生成出了点问题，稍等一下再发一次吧 🙏"
    chatStore.setRequestError(message)
  }
}
</script>

<template>
  <main class="page-shell">
    <section v-if="hasConversation" class="compact-header">
      <div class="compact-brand">旅行规划助手</div>
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
