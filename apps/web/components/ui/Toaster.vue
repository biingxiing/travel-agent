<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'
</script>

<template>
  <Toaster
    position="top-right"
    :duration="2000"
    :close-button="false"
    theme="light"
    :toast-options="{
      style: {
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        borderRadius: 'var(--r-sm)',
        boxShadow: 'var(--shadow-card)',
        fontFamily: 'var(--font-body)',
        fontSize: '13px',
      },
    }"
  />
</template>
