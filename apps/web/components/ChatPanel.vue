<script setup lang="ts">
import { Motion } from 'motion-v'
import type { ChatMessage } from "~/types/itinerary"
import ScrollArea from '~/components/ui/ScrollArea.vue'
import StreamingBubble from '~/components/states/StreamingBubble.vue'
defineProps<{
  messages: ChatMessage[]
  phase: "idle" | "planning" | "result" | "error"
  agentStatus: string
  streamSteps: string[]
}>()
</script>

<template>
  <section class="conversation-shell">
    <header class="panel-title">
      <div class="panel-title-text">
        <h2>对话</h2>
      </div>
      <span class="panel-status-chip" :class="{ 'is-active': phase === 'planning' }">
        <span class="panel-status-dot" />
        {{ phase === "planning" ? "规划中" : "就绪" }}
      </span>
    </header>

    <ScrollArea class="conversation-list">
      <Motion
        v-for="(message, index) in messages"
        :key="message.id"
        tag="article"
        v-show="message.content.trim()"
        :initial="{ y: 8, opacity: 0 }"
        :animate="{ y: 0, opacity: 1 }"
        :transition="{ duration: 0.32, ease: [0.2, 0.7, 0.25, 1], delay: Math.min(index * 0.04, 0.24) }"
        class="bubble"
        :class="`bubble-${message.role}`"
      >
        <p class="bubble-content">{{ message.content }}</p>
      </Motion>

      <StreamingBubble
        v-if="phase === 'planning'"
        :status="agentStatus"
        :steps="streamSteps"
      />
    </ScrollArea>

    <div class="conversation-composer">
      <slot name="composer" />
    </div>
  </section>
</template>

<style scoped>
.conversation-shell {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-card);
  padding: 22px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
  min-height: 0;
  animation: panel-in var(--dur-slow) var(--ease-out) both;
}

.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0;
  padding: 0;
  border: 0;
}

.panel-title-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel-title h2 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 20px;
  line-height: 1.2;
  color: var(--text);
}

.panel-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--brand-blue-soft);
  color: var(--brand-blue-deep);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  border: 1px solid var(--brand-blue-border);
  border-radius: 999px;
}

.panel-status-chip.is-active {
  background: var(--brand-purple-soft);
  color: var(--brand-purple);
  border-color: rgba(123, 91, 255, 0.28);
}

.panel-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 2px 2px 4px;
}

.bubble {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  max-width: min(640px, 85%);
  position: relative;
}

.bubble-user {
  align-self: flex-end;
  background: var(--brand-gradient);
  color: var(--text-inverse);
  border-color: transparent;
  border-radius: var(--r-md) var(--r-md) 4px var(--r-md);
  max-width: min(520px, 85%);
}

.bubble-assistant {
  align-self: flex-start;
  background: var(--bg-elevated);
  color: var(--text);
  border-color: var(--border);
  border-radius: var(--r-md) var(--r-md) var(--r-md) 4px;
  max-width: min(640px, 85%);
}

.bubble-system {
  align-self: stretch;
  max-width: 100%;
  background: var(--accent-danger-soft);
  border-color: rgba(239, 68, 68, 0.28);
  color: #991B1B;
}

.bubble-narration {
  align-self: flex-start;
  background: var(--bg-subtle);
  color: var(--text-muted, #6b7280);
  border-color: var(--border-subtle-2, var(--border));
  border-radius: var(--r-md) var(--r-md) var(--r-md) 4px;
  font-style: italic;
  max-width: min(640px, 85%);
  opacity: 0.85;
}

.bubble-content {
  margin: 0;
  font-family: var(--font-body);
  font-size: 14.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.conversation-composer {
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle-2);
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 640px) {
  .conversation-shell { padding: 18px 18px 16px; }
  .panel-title h2 { font-size: 18px; }
  .bubble { max-width: 94%; }
  .bubble-user,
  .bubble-assistant { max-width: 94%; }
}

@media (prefers-reduced-motion: reduce) {
  .conversation-shell,
  .bubble {
    animation: none !important;
    transform: none !important;
  }
}
</style>
