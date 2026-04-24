import { defineStore } from "pinia"
import { useChatStore } from "~/stores/chat"

export const useAuthStore = defineStore("auth", {
  state: () => ({
    status: "checking" as "checking" | "authenticated" | "anonymous",
    username: "",
    errorMessage: "",
    redirectPath: "/"
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
    setAnonymous(message = "", redirectPath = this.redirectPath || "/") {
      this.status = "anonymous"
      this.username = ""
      this.errorMessage = message
      this.redirectPath = redirectPath || "/"
    },
    setError(message: string) {
      this.errorMessage = message
    },
    clearError() {
      this.errorMessage = ""
    },
    setRedirectPath(path: string) {
      this.redirectPath = path || "/"
    },
    consumeRedirectPath(defaultPath = "/") {
      const path = this.redirectPath || defaultPath
      this.redirectPath = defaultPath || "/"
      return path
    },
    handleUnauthorized(message = "登录已失效，请重新登录。", redirectPath = this.redirectPath || "/") {
      this.setAnonymous(message, redirectPath)
      useChatStore().handleAuthInterrupted()
    }
  }
})
