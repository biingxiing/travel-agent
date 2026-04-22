import { defineStore } from "pinia"
import { useChatStore } from "~/stores/chat"

export const useAuthStore = defineStore("auth", {
  state: () => ({
    status: "checking" as "checking" | "authenticated" | "anonymous",
    username: "",
    errorMessage: ""
  }),
  getters: {
    isAuthenticated: (state) => state.status === "authenticated"
  },
  actions: {
    setChecking() {
      this.status = "checking"
      this.errorMessage = ""
    },
    setAuthenticated(username: string) {
      this.status = "authenticated"
      this.username = username
      this.errorMessage = ""
    },
    setAnonymous(message = "") {
      this.status = "anonymous"
      this.username = ""
      this.errorMessage = message
    },
    setError(message: string) {
      this.errorMessage = message
    },
    clearError() {
      this.errorMessage = ""
    },
    handleUnauthorized(message = "登录已失效，请重新登录。") {
      this.setAnonymous(message)
      useChatStore().resetConversation()
    }
  }
})
