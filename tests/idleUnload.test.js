import test from 'node:test'
import assert from 'node:assert/strict'

import {
  idleUnloadDue,
  vramUsedFromStats,
  IDLE_UNLOAD_MS,
} from '../api/src/idleUnload.mjs'

const GB = 1024 ** 3
const base = {
  autoUnload: true,
  busy: false,
  vramUsed: 4 * GB,
  idleForMs: IDLE_UNLOAD_MS,
}

test('idle unload fires after five quiet minutes with models resident', () => {
  assert.equal(idleUnloadDue(base), true)
})

test('idle unload respects the toggle, queue and idle window', () => {
  assert.equal(idleUnloadDue({ ...base, autoUnload: false }), false)
  assert.equal(idleUnloadDue({ ...base, busy: true }), false)
  assert.equal(idleUnloadDue({ ...base, idleForMs: IDLE_UNLOAD_MS - 1 }), false)
})

test('idle unload skips when VRAM shows no resident models', () => {
  assert.equal(idleUnloadDue({ ...base, vramUsed: 0 }), false)
  assert.equal(idleUnloadDue({ ...base, vramUsed: 128 * 1024 ** 2 }), false)
})

test('a custom idle window is honored', () => {
  assert.equal(idleUnloadDue({ ...base, idleForMs: 1000, idleMs: 1000 }), true)
  assert.equal(idleUnloadDue({ ...base, idleForMs: 999, idleMs: 1000 }), false)
})

test('VRAM usage is read from the device, not the top-level response', () => {
  const total = 16 * GB
  const free = 2 * GB
  assert.equal(vramUsedFromStats({ devices: [{ vram_total: total, vram_free: free }] }), 14 * GB)
  assert.equal(vramUsedFromStats(null), 0)
  assert.equal(vramUsedFromStats({ devices: [] }), 0)
})
