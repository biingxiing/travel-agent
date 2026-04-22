<script setup lang="ts">
import type { ItemSelection } from "~/types/itinerary"
import { useChatStore } from "~/stores/chat"

const props = defineProps<{
  selection: ItemSelection
}>()

const chatStore = useChatStore()
const selectedId = ref(props.selection.options[0]?.id ?? "")

const selectedOption = computed(() =>
  props.selection.options.find((option) => option.id === selectedId.value),
)

function confirm() {
  if (!selectedOption.value) return

  chatStore.applyItemSelection(
    props.selection.dayNum,
    props.selection.itemIndex,
    selectedOption.value,
  )
}
</script>

<template>
  <div class="selector-card">
    <p class="selector-question">{{ selection.question }}</p>
    <p class="selector-meta">
      Day {{ selection.dayNum }} · {{ selection.itemTitle }}
    </p>

    <label
      v-for="option in selection.options"
      :key="option.id"
      class="selector-option"
      :class="{ selected: selectedId === option.id }"
    >
      <input
        v-model="selectedId"
        type="radio"
        :name="`sel-${selection.dayNum}-${selection.itemIndex}`"
        :value="option.id"
      />
      <div class="selector-option-body">
        <strong>{{ option.label }}</strong>
        <p>{{ option.description }}</p>
      </div>
    </label>

    <button
      type="button"
      class="selector-confirm"
      :disabled="!selectedOption"
      @click="confirm"
    >
      确认选择
    </button>
  </div>
</template>
