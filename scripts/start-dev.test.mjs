import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { runPnpmDev, startDev } from './start-dev.mjs'

test('starts pnpm dev immediately when port 3001 is already free', async () => {
  const calls = []
  const exitCode = await startDev({
    port: 3001,
    listPids: () => [],
    killPid: (pid, signal) => calls.push(['kill', pid, signal]),
    sleep: async () => calls.push(['sleep']),
    spawnDev: async () => {
      calls.push(['spawn'])
      return 0
    },
    logger: {
      log: () => {},
      error: () => {}
    }
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(calls, [['spawn']])
})

test('stops existing port 3001 process with SIGTERM before starting pnpm dev', async () => {
  const calls = []
  const pidSnapshots = [[12345], []]

  const exitCode = await startDev({
    port: 3001,
    listPids: () => pidSnapshots.shift() ?? [],
    killPid: (pid, signal) => calls.push(['kill', pid, signal]),
    sleep: async () => calls.push(['sleep']),
    spawnDev: async () => {
      calls.push(['spawn'])
      return 0
    },
    logger: {
      log: () => {},
      error: () => {}
    }
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(calls, [
    ['kill', 12345, 'SIGTERM'],
    ['sleep'],
    ['spawn']
  ])
})

test('forces SIGKILL when the port 3001 process ignores SIGTERM', async () => {
  const calls = []
  const pidSnapshots = [[12345], [12345], []]

  const exitCode = await startDev({
    port: 3001,
    waitRetries: 1,
    listPids: () => pidSnapshots.shift() ?? [],
    killPid: (pid, signal) => calls.push(['kill', pid, signal]),
    sleep: async () => calls.push(['sleep']),
    spawnDev: async () => {
      calls.push(['spawn'])
      return 0
    },
    logger: {
      log: () => {},
      error: () => {}
    }
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(calls, [
    ['kill', 12345, 'SIGTERM'],
    ['sleep'],
    ['kill', 12345, 'SIGKILL'],
    ['spawn']
  ])
})

test('forwards SIGINT to the pnpm dev child process', async () => {
  const signals = []
  const child = new EventEmitter()
  child.killed = false
  child.kill = (signal) => {
    signals.push(signal)
    child.killed = true
  }

  const processRef = new EventEmitter()
  processRef.env = process.env

  const runPromise = runPnpmDev({
    processRef,
    spawnCommand: () => child,
    logger: {
      log: () => {},
      error: () => {}
    }
  })

  processRef.emit('SIGINT')
  child.emit('exit', 130, null)

  const exitCode = await runPromise

  assert.equal(exitCode, 130)
  assert.deepEqual(signals, ['SIGINT'])
})
