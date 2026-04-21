<script setup lang="ts">
import type { ChatMessage } from "~/types/itinerary"

defineProps<{
  messages: ChatMessage[]
  phase: "idle" | "planning" | "result" | "error"
  agentStatus: string
  streamSteps: string[]
}>()
</script>

<template>
  <section class="conversation-shell">
    <div class="panel-title">
      <div>
        <p class="panel-kicker">Conversation</p>
        <h2>对话流</h2>
      </div>
      <span class="panel-badge">Live</span>
    </div>

    <div class="conversation-list">
      <article
        v-for="message in messages"
        :key="message.id"
        v-show="message.content.trim()"
        class="bubble"
        :class="`bubble-${message.role}`"
      >
        <p class="bubble-content">{{ message.content }}</p>
      </article>

      <article v-if="phase === 'planning'" class="bubble bubble-assistant bubble-progress">
        <div class="progress-inline">
          <span class="stream-dot" />
          <span class="stream-dot" />
          <span class="stream-dot" />
          <span>{{ agentStatus }}</span>
        </div>

        <ul v-if="streamSteps.length" class="progress-list">
          <li v-for="step in streamSteps" :key="step">{{ step }}</li>
        </ul>
      </article>
    </div>

    <div class="conversation-composer">
      <slot name="composer" />
    </div>
  </section>
</template>
