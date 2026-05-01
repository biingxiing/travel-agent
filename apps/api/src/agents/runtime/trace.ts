import { promises as fs } from 'fs'
import path from 'path'

const TRACE_DIR = path.resolve(process.cwd(), '.traces')

export function traceDir(): string { return TRACE_DIR }

export interface TraceEvent {
  agent: string
  event: string
  [k: string]: unknown
}

export class Trace {
  private buf: string[] = []
  private writePromise: Promise<void> = Promise.resolve()
  private closed = false

  constructor(private readonly runId: string) {}

  event(obj: TraceEvent): void {
    if (this.closed) return
    const line = JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'
    this.buf.push(line)
    // schedule flush (debounced via single in-flight chain)
    this.writePromise = this.writePromise.then(() => this.flushLocked())
  }

  private async flushLocked(): Promise<void> {
    if (this.buf.length === 0) return
    const chunk = this.buf.join('')
    this.buf = []
    await fs.mkdir(TRACE_DIR, { recursive: true })
    await fs.appendFile(path.join(TRACE_DIR, `${this.runId}.jsonl`), chunk, 'utf8')
  }

  async close(): Promise<void> {
    this.closed = false      // allow final flush
    await this.writePromise
    await this.flushLocked()
    this.closed = true
  }
}
