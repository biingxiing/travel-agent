import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

export const DEFAULT_PORT = 3001
export const DEFAULT_WAIT_RETRIES = 10
export const DEFAULT_WAIT_MS = 200

export function parsePidOutput(output) {
  return output
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0)
}

export function listPortPids(port) {
  try {
    const output = execFileSync('lsof', ['-ti', `:${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    return parsePidOutput(output)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error('[start-dev] `lsof` is required but was not found in PATH.')
    }

    if (error && typeof error === 'object' && error.status === 1) {
      return []
    }

    throw error
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function runPnpmDev({
  cwd = repoRoot,
  env = process.env,
  spawnCommand = spawn,
  logger = console,
  processRef = process
} = {}) {
  const pnpmCommand = (processRef.platform ?? process.platform) === 'win32' ? 'pnpm.cmd' : 'pnpm'

  return new Promise((resolve, reject) => {
    const child = spawnCommand(pnpmCommand, ['dev'], {
      cwd,
      env,
      stdio: 'inherit'
    })

    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal)
      }
    }

    const forwardSigint = () => forwardSignal('SIGINT')
    const forwardSigterm = () => forwardSignal('SIGTERM')

    processRef.once('SIGINT', forwardSigint)
    processRef.once('SIGTERM', forwardSigterm)

    child.on('error', (error) => {
      processRef.removeListener('SIGINT', forwardSigint)
      processRef.removeListener('SIGTERM', forwardSigterm)
      reject(error)
    })

    child.on('exit', (code, signal) => {
      processRef.removeListener('SIGINT', forwardSigint)
      processRef.removeListener('SIGTERM', forwardSigterm)

      if (signal) {
        logger.error(`[start-dev] pnpm dev exited with signal ${signal}`)
        resolve(1)
        return
      }

      resolve(code ?? 0)
    })
  })
}

export async function startDev({
  port = DEFAULT_PORT,
  waitRetries = DEFAULT_WAIT_RETRIES,
  waitMs = DEFAULT_WAIT_MS,
  listPids = listPortPids,
  killPid = (pid, signal) => process.kill(pid, signal),
  sleep: sleepFn = sleep,
  spawnDev = () => runPnpmDev(),
  logger = console
} = {}) {
  let pids = listPids(port)

  if (pids.length > 0) {
    logger.log(`[start-dev] Port ${port} is occupied by PID(s): ${pids.join(', ')}`)

    for (const pid of pids) {
      killPid(pid, 'SIGTERM')
    }

    for (let attempt = 0; attempt < waitRetries; attempt += 1) {
      await sleepFn(waitMs)
      pids = listPids(port)

      if (pids.length === 0) {
        break
      }
    }

    if (pids.length > 0) {
      logger.log(
        `[start-dev] Port ${port} still occupied after SIGTERM, sending SIGKILL to PID(s): ${pids.join(', ')}`
      )

      for (const pid of pids) {
        killPid(pid, 'SIGKILL')
      }

      pids = listPids(port)
    }

    if (pids.length > 0) {
      throw new Error(`[start-dev] Failed to free port ${port}; remaining PID(s): ${pids.join(', ')}`)
    }

    logger.log(`[start-dev] Port ${port} released`)
  }

  return spawnDev()
}

async function main() {
  try {
    const exitCode = await startDev()
    process.exit(exitCode)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
