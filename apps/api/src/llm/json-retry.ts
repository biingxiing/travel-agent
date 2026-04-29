import type { ZodSchema } from 'zod'

function extractJsonSubstring(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced?.[1]) return fenced[1].trim()
  // Greedy match: first `{` to last `}` (or `[` / `]`) — handles trailing prose.
  const objStart = content.indexOf('{')
  const objEnd = content.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) return content.slice(objStart, objEnd + 1)
  const arrStart = content.indexOf('[')
  const arrEnd = content.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) return content.slice(arrStart, arrEnd + 1)
  return null
}

function tryParse<T>(content: string, schema: ZodSchema<T>): T | null {
  const candidates = [content.trim(), extractJsonSubstring(content)].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate))
    } catch {
      // try next candidate
    }
  }
  return null
}

/**
 * Parse a JSON object out of an LLM response with one retry.
 *
 * Strategy:
 *   1. Try direct JSON.parse + schema validation
 *   2. Try extracting fenced ```json``` or first `{...}` / `[...]` substring
 *   3. If `retry` is provided, call it once (caller appends a "valid JSON only" reminder)
 *   4. Return null if all attempts fail
 */
export async function parseLLMJson<T>(
  content: string,
  schema: ZodSchema<T>,
  retry?: () => Promise<string>,
): Promise<T | null> {
  const first = tryParse(content, schema)
  if (first !== null) return first
  if (!retry) return null
  let retryContent: string
  try {
    retryContent = await retry()
  } catch {
    return null
  }
  return tryParse(retryContent, schema)
}
