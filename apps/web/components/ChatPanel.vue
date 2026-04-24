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
    <header class="panel-title">
      <div class="panel-title-text">
        <h2>对话流</h2>
      </div>
      <span class="panel-status-chip" :class="{ 'is-active': phase === 'planning' }">
        <span class="panel-status-dot" />
        {{ phase === "planning" ? "规划中" : "就绪" }}
      </span>
    </header>

    <div class="conversation-list">
      <article
        v-for="(message, index) in messages"
        :key="message.id"
        v-show="message.content.trim()"
        class="bubble"
        :class="`bubble-${message.role}`"
        :style="{ animationDelay: `${Math.min(index * 60, 480)}ms` }"
      >
        <p class="bubble-content">{{ message.content }}</p>
      </article>

      <article v-if="phase === 'planning'" class="bubble bubble-assistant bubble-progress">
        <div class="progress-inline">
          <span class="stream-dot" />
          <span class="stream-dot" />
          <span class="stream-dot" />
          <span class="progress-status">{{ agentStatus }}</span>
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
  gap: 12px;
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
  max-width: 85%;
  position: relative;
  animation: bubble-in var(--dur-slow) var(--ease-out) both;
}

.bubble-user {
  align-self: flex-end;
  background: var(--brand-gradient);
  color: var(--text-inverse);
  border-color: transparent;
  border-radius: var(--r-md) var(--r-md) 4px var(--r-md);
}

.bubble-assistant {
  align-self: flex-start;
  background: var(--bg-elevated);
  color: var(--text);
  border-color: var(--border);
  border-radius: var(--r-md) var(--r-md) var(--r-md) 4px;
}

.bubble-system {
  align-self: stretch;
  max-width: 100%;
  background: var(--accent-danger-soft);
  border-color: rgba(239, 68, 68, 0.28);
  color: #991B1B;
}

.bubble-content {
  margin: 0;
  font-family: var(--font-body);
  font-size: 14.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble-progress {
  background: var(--brand-blue-soft);
  border-color: var(--brand-blue-border);
  color: var(--brand-blue-deep);
  border-left: 3px solid var(--brand-blue);
}

.progress-inline {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--brand-blue-deep);
}

.progress-status {
  color: var(--brand-blue-deep);
}

.stream-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-blue);
  display: inline-block;
  animation: dot-pulse 1.4s infinite var(--ease-out);
}

.stream-dot:nth-child(2) { animation-delay: 0.2s; }
.stream-dot:nth-child(3) { animation-delay: 0.4s; }

.progress-list {
  margin: 10px 0 0;
  padding-left: 18px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.55;
}

.progress-list li {
  position: relative;
}

.progress-list li::before {
  content: "•";
  position: absolute;
  left: -14px;
  top: 0;
  color: var(--brand-blue);
  font-weight: 700;
}

.conversation-composer {
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes bubble-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; }
}

@keyframes dot-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

@media (max-width: 640px) {
  .conversation-shell { padding: 18px 18px 16px; }
  .panel-title h2 { font-size: 18px; }
  .bubble { max-width: 94%; }
}

@media (prefers-reduced-motion: reduce) {
  .conversation-shell,
  .bubble,
  .stream-dot {
    animation: none !important;
    transform: none !important;
  }
}
</style>
