import { defineStore } from 'pinia'
import type {
  TripBrief, Plan, ItineraryScoreSummary, SessionStatus, SessionState,
} from '@travel-agent/shared'

const SESSION_STORAGE_KEY = 'ta_sessionId'
const PLAN_STORAGE_KEY = 'ta_currentPlan'

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    sessionId: null as string | null,
    brief: null as TripBrief | null,
    currentPlan: null as Plan | null,
    currentScore: null as ItineraryScoreSummary | null,
    status: 'draft' as SessionStatus,
  }),

  actions: {
    hydrateFromSession(session: SessionState) {
      this.sessionId = session.id
      this.brief = session.brief
      this.currentPlan = session.currentPlan
      this.currentScore = session.currentScore
      this.status = session.status
    },

    reset() {
      this.sessionId = null
      this.brief = null
      this.currentPlan = null
      this.currentScore = null
      this.status = 'draft'
    },

    persistState() {
      if (typeof window === 'undefined') return
      if (this.sessionId) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, this.sessionId)
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
      }
      if (this.currentPlan) {
        sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(this.currentPlan))
      } else {
        sessionStorage.removeItem(PLAN_STORAGE_KEY)
      }
    },

    hydrateFromSessionStorage() {
      if (typeof window === 'undefined') return
      this.sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
      const rawPlan = sessionStorage.getItem(PLAN_STORAGE_KEY)
      if (rawPlan) {
        try {
          this.currentPlan = JSON.parse(rawPlan)
        } catch {
          sessionStorage.removeItem(PLAN_STORAGE_KEY)
        }
      }
    },
  },
})
