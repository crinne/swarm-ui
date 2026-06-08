import { describe, expect, it } from 'vitest'
import {
  applyDroneCommand,
  buildEventLog,
  commandPayload,
  dashboardSummary,
  droneLinkLoss,
  animateDemoDrones,
  nextTelemetryDrones,
  selectedDroneTarget,
  modeLabel,
  nextPendingSpawnIds,
  followTarget,
} from './dashboard'

const drones = [
  { id: 1, x: 20, y: 10, z: 42, heading: 91, battery: 83, mode: 0xd8, vx: 3, vy: 4, vz: -0.4 },
  { id: 2, x: -18, y: 22, z: 55, heading: 180, battery: 17, mode: 0xbc, vx: 5, vy: 2, vz: 0.1 },
  { id: 3, x: 8, y: -30, z: 18, heading: 270, battery: 7, mode: 0, vx: 0, vy: 1, vz: 0 },
]

describe('dashboard helpers', () => {
  it('labels known flight modes for operator panels', () => {
    expect(modeLabel(0xd8)).toBe('GUIDED_ARMED')
    expect(modeLabel(0xbc)).toBe('AUTO_ARMED')
    expect(modeLabel(0)).toBe('STANDBY')
  })

  it('derives deterministic link loss from telemetry health', () => {
    expect(droneLinkLoss(drones[0])).toBe(4)
    expect(droneLinkLoss(drones[1])).toBe(17)
    expect(droneLinkLoss(drones[2])).toBe(24)
  })

  it('summarizes swarm status for the top bar', () => {
    expect(dashboardSummary(drones)).toEqual({
      active: 2,
      total: 3,
      linkQuality: 'DEGRADED',
      avgLoss: 15,
      avgThroughput: 27.2,
      telemetryHz: 10,
    })
  })

  it('does not invent event log rows from telemetry alone', () => {
    expect(buildEventLog(drones)).toEqual([])
  })

  it('converts map targets into goto payloads', () => {
    expect(commandPayload(2, { x: 12.4, y: -3.6, z: 80 })).toEqual({
      id: 2,
      x: 12.4,
      y: -3.6,
      z: 80,
    })
  })

  it('clears drones when live telemetry reports an empty swarm', () => {
    expect(nextTelemetryDrones(drones, [])).toEqual([])
  })

  it('uses telemetry drones when the swarm has live drones', () => {
    const liveDrones = [{ ...drones[0], id: 9 }]

    expect(nextTelemetryDrones(drones, liveDrones)).toEqual(liveDrones)
  })

  it('keeps pending spawn ids until telemetry reports them', () => {
    expect(nextPendingSpawnIds([4, 5], drones)).toEqual([4, 5])
    expect(nextPendingSpawnIds([2, 4], drones)).toEqual([4])
  })

  it('animates demo drones with visible position and velocity changes', () => {
    const animated = animateDemoDrones(drones, 2250)

    expect(animated[0].x).not.toBe(drones[0].x)
    expect(animated[0].y).not.toBe(drones[0].y)
    expect(animated[0].vx).not.toBe(drones[0].vx)
    expect(animated[0].heading).not.toBe(drones[0].heading)
  })

  it('finds the selected drone target for follow camera updates', () => {
    expect(selectedDroneTarget(drones, 2)).toEqual(drones[1])
    expect(selectedDroneTarget(drones, 99)).toBeUndefined()
    expect(selectedDroneTarget(drones, null)).toBeUndefined()
  })

  it('only returns a follow target when follow mode is enabled', () => {
    expect(followTarget(drones, 2, true)).toEqual(drones[1])
    expect(followTarget(drones, 2, false)).toBeUndefined()
    expect(followTarget(drones, 99, true)).toBeUndefined()
  })

  it('applies selected drone commands without changing the rest of the swarm', () => {
    const commanded = applyDroneCommand(drones, 'LAND', 2, { x: 100, y: 100, z: 120 })

    expect(commanded[0]).toEqual(drones[0])
    expect(commanded[1]).toEqual({ ...drones[1], z: 8, mode: 0x53, vx: 0, vy: 0, vz: -1.5 })
  })

  it('applies goto commands to the selected drone target', () => {
    const commanded = applyDroneCommand(drones, 'GOTO', 1, { x: 100, y: -50, z: 75 })

    expect(commanded[0]).toEqual({ ...drones[0], x: 100, y: -50, z: 75, mode: 0xd8 })
  })

  it('applies all-drone commands across the swarm', () => {
    const commanded = applyDroneCommand(drones, 'RTL_ALL', 1, { x: 100, y: 100, z: 120 })

    expect(commanded.map(drone => ({ x: drone.x, y: drone.y, mode: drone.mode }))).toEqual([
      { x: 0, y: 0, mode: 0x52 },
      { x: 0, y: 0, mode: 0x52 },
      { x: 0, y: 0, mode: 0x52 },
    ])
  })
})
