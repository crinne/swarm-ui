import { describe, expect, it, vi } from 'vitest'
import { apiUrl, spawnDrone } from './api'

describe('api', () => {
  it('builds hosted API URLs', () => {
    expect(apiUrl('/telemetry', 'https://api.swarmgcs.dev'))
      .toBe('https://api.swarmgcs.dev/telemetry')
  })

  it('sends the password only in the spawn request', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 4 }),
    })

    await spawnDrone('secret', fetcher, 'https://api.swarmgcs.dev')

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.swarmgcs.dev/spawn',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Spawn-Password': 'secret' },
      }),
    )
  })
})
