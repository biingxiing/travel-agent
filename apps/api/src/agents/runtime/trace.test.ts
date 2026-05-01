import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { Trace, traceDir } from './trace.js'

const TEST_RUN = 'run-test-123'

describe('Trace', () => {
  beforeEach(async () => {
    await fs.rm(path.join(traceDir(), `${TEST_RUN}.jsonl`), { force: true })
  })
  afterEach(async () => {
    await fs.rm(path.join(traceDir(), `${TEST_RUN}.jsonl`), { force: true })
  })

  it('appends one JSON object per line and flushes on close', async () => {
    const t = new Trace(TEST_RUN)
    t.event({ agent: 'orchestrator', event: 'llm_call_start', model: 'gpt-5.4' })
    t.event({ agent: 'researcher#0', event: 'spawn', parent: 'orchestrator' })
    await t.close()
    const txt = await fs.readFile(path.join(traceDir(), `${TEST_RUN}.jsonl`), 'utf8')
    const lines = txt.trim().split('\n')
    expect(lines).toHaveLength(2)
    const a = JSON.parse(lines[0]!)
    const b = JSON.parse(lines[1]!)
    expect(a.agent).toBe('orchestrator')
    expect(a.event).toBe('llm_call_start')
    expect(typeof a.ts).toBe('string')
    expect(b.agent).toBe('researcher#0')
  })

  it('creates the .traces directory if missing', async () => {
    const t = new Trace(TEST_RUN)
    t.event({ agent: 'x', event: 'noop' })
    await t.close()
    await expect(fs.stat(traceDir())).resolves.toBeDefined()
  })
})
