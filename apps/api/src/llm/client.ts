import OpenAI from 'openai'

const readEnv = (primary: string, legacy: string, fallback = '') =>
  process.env[primary] ?? process.env[legacy] ?? fallback

export const BASE_URL = readEnv('LLM_BASE_URL', 'OPENAI_BASE_URL', 'http://43.166.169.153:8080/v1')
export const API_KEY = readEnv('LLM_API_KEY', 'OPENAI_API_KEY')
export const PLANNER_MODEL = readEnv('LLM_MODEL_PLANNER', 'OPENAI_MODEL_PLANNER', 'gpt-5.4')
export const FAST_MODEL = readEnv('LLM_MODEL_FAST', 'OPENAI_MODEL_FAST', 'codex-mini-latest')

export const llm = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY })
