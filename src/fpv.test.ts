import { describe, expect, it } from 'vitest'
import { fpvMetrics } from './fpv'

describe('fpvMetrics', () => {
  it('computes speed and heading labels from drone telemetry', () => {
    const metrics = fpvMetrics({
      id: 2,
      x: 0,
      y: 0,
      z: 24.3,
      heading: 359.6,
      battery: 87,
      mode: 0xd8,
      vx: 3,
      vy: 4,
      vz: -1,
    })

    expect(metrics.speed).toBe(5)
    expect(metrics.headingLabel).toBe('000')
    expect(metrics.altitudeLabel).toBe('24.3m')
  })

  it('flags low battery and clamps synthetic horizon tilt', () => {
    const metrics = fpvMetrics({
      id: 3,
      x: 0,
      y: 0,
      z: 8,
      heading: 270,
      battery: 12,
      mode: 0xd8,
      vx: 20,
      vy: 0,
      vz: 8,
    })

    expect(metrics.lowBattery).toBe(true)
    expect(metrics.horizonTilt).toBe(16)
    expect(metrics.horizonOffset).toBe(-18)
  })
})
