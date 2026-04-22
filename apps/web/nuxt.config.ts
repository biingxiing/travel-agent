export default defineNuxtConfig({
  compatibilityDate: "2025-04-21",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  modules: ["@pinia/nuxt"],
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || ""
    }
  },
  routeRules: {
    "/api/**": { proxy: "http://localhost:3001/api/**" }
  },
  app: {
    head: {
      title: "旅行规划助手",
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1"
        },
        {
          name: "description",
          content: "Conversational travel planning MVP built with Nuxt 3."
        }
      ]
    }
  }
})
