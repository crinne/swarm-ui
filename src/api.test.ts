import { describe, expect, it, vi } from 'vitest'
import { apiUrl, sendGotoCommand, sendKillCommand, spawnDrone } from './api'

describe('api', () => {
  it('builds hosted API URLs', () => {
    expect(apiUrl('/telemetry', 'https://api.swarmgcs.dev'))
      .toBe('https://api.swarmgcs.dev/telemetry')
  })

  it('spawns a drone without auth headers', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 4 }),
    })

    await spawnDrone(fetcher, 'https://api.swarmgcs.dev')

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.swarmgcs.dev/spawn',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers')
  })

  it('sends goto commands as JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })

    await sendGotoCommand(2, { x: 12, y: -4, z: 80 }, fetcher, 'https://api.swarmgcs.dev')

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.swarmgcs.dev/goto',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 2, x: 12, y: -4, z: 80 }),
      },
    )
  })

  it('sends kill commands as JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })

    await sendKillCommand(7, fetcher, 'https://api.swarmgcs.dev')

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.swarmgcs.dev/kill',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 7 }),
      },
    )
  })
})
