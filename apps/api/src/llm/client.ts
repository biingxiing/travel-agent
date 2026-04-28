import OpenAI from 'openai'

const readEnv = (primary: string, legacy: string, fallback = '') =>
  process.env[primary] ?? process.env[legacy] ?? fallback

export const BASE_URL = readEnv('LLM_BASE_URL', 'OPENAI_BASE_URL')
export const API_KEY = readEnv('LLM_API_KEY', 'OPENAI_API_KEY')
export const PLANNER_MODEL = readEnv('LLM_MODEL_PLANNER', 'OPENAI_MODEL_PLANNER', 'gpt-5.4')
export const FAST_MODEL = readEnv('LLM_MODEL_FAST', 'OPENAI_MODEL_FAST', 'codex-mini-latest')

const REASONING_EFFORT_RAW = readEnv('LLM_REASONING_EFFORT', 'OPENAI_REASONING_EFFORT', '').trim().toLowerCase()
const REASONING_EFFORT_VALID = new Set(['low', 'medium', 'high', 'xhigh'])
export const REASONING_EFFORT: string | undefined =
  REASONING_EFFORT_RAW && REASONING_EFFORT_VALID.has(REASONING_EFFORT_RAW) ? REASONING_EFFORT_RAW : undefined

if (REASONING_EFFORT_RAW && !REASONING_EFFORT) {
  console.warn(
    `[llm] LLM_REASONING_EFFORT="${REASONING_EFFORT_RAW}" is not one of low/medium/high/xhigh — ignored.`,
  )
}

if (!BASE_URL) {
  throw new Error(
    'LLM_BASE_URL (or OPENAI_BASE_URL) is required. Set it in apps/api/.env — there is no public fallback.',
  )
}
if (!API_KEY) {
  throw new Error(
    'LLM_API_KEY (or OPENAI_API_KEY) is required. Set it in apps/api/.env.',
  )
}
if (BASE_URL.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(BASE_URL)) {
  console.warn(
    `[llm] BASE_URL is plain HTTP and not localhost: ${BASE_URL}. Prompts will be sent in cleartext.`,
  )
}

export const llm = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY })
