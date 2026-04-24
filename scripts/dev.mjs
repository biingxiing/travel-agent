import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const appsRoot = path.join(repoRoot, 'apps')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function parsePort(value, fallback) {
  const port = Number.parseInt(value ?? '', 10)
  return Number.isInteger(port) && port > 0 ? port : fallback
}

function checkPortAvailabilityOnHost(port, host) {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen({ port, host })
  })
}

async function findAvailablePort(startPort, blockedPorts = new Set()) {
  let port = startPort

  while (
    blockedPorts.has(port) ||
    !(await checkPortAvailabilityOnHost(port, 'localhost')) ||
    !(await checkPortAvailabilityOnHost(port, '127.0.0.1'))
  ) {
    port += 1
  }

  return port
}

function spawnWorkspaceCommand(relativeDir, command, args, extraEnv = {}) {
  return spawn(pnpmCommand, ['exec', command, ...args], {
    cwd: path.join(appsRoot, relativeDir),
    env: {
      ...process.env,
      ...extraEnv
    },
    stdio: 'inherit'
  })
}

const requestedWebPort = parsePort(process.env.WEB_PORT, 3000)
const requestedApiPort = parsePort(process.env.API_PORT ?? process.env.PORT, 3001)
const webPort = await findAvailablePort(requestedWebPort)
const apiPort = await findAvailablePort(requestedApiPort, new Set([webPort]))
const localApiTarget = `http://127.0.0.1:${apiPort}`

console.log(`[dev] Web: http://localhost:${webPort}`)
console.log(`[dev] API: ${localApiTarget}`)

const children = [
  spawnWorkspaceCommand('api', 'tsx', ['watch', '--env-file=.env', 'src/index.ts'], {
    PORT: String(apiPort),
    API_PORT: String(apiPort)
  }),
  spawnWorkspaceCommand('web', 'nuxt', ['dev', '--port', String(webPort)], {
    LOCAL_API_TARGET: localApiTarget
  })
]

let shuttingDown = false
let exitCount = 0

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  process.exitCode = exitCode

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    exitCount += 1

    if (!shuttingDown) {
      const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`
      console.error(`[dev] Child process exited with ${detail}`)
      shutdown(code ?? 1)
    }

    if (exitCount === children.length) {
      process.exit(process.exitCode ?? 0)
    }
  })
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))
