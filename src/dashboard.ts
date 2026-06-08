export interface DashboardDrone {
  id: number
  x: number
  y: number
  z: number
  heading: number
  battery: number
  mode: number
  vx: number
  vy: number
  vz: number
}

export interface TargetPoint {
  x: number
  y: number
  z: number
}

export interface EventLogEntry {
  level: 'INFO' | 'WARN'
  droneId: number
  message: string
}

export type DroneCommand =
  | 'ARM'
  | 'DISARM'
  | 'LOITER'
  | 'RTL'
  | 'LAND'
  | 'HOLD'
  | 'GOTO'
  | 'ARM_ALL'
  | 'RTL_ALL'
  | 'LAND_ALL'

export function modeLabel(mode: number) {
  if (mode === 0xd8) return 'GUIDED_ARMED'
  if (mode === 0xbc) return 'AUTO_ARMED'
  if (mode === 0) return 'STANDBY'
  if (mode === 0x51) return 'LOITER'
  if (mode === 0x52) return 'RTL'
  if (mode === 0x53) return 'LAND'
  if (mode === 0x54) return 'HOLD'
  return `MODE_${mode}`
}

export function isArmed(mode: number) {
  return mode === 0xd8 || mode === 0xbc
}

export function droneSpeed(drone: DashboardDrone) {
  return Math.sqrt(drone.vx * drone.vx + drone.vy * drone.vy)
}

export function droneLinkLoss(drone: DashboardDrone) {
  const batteryPenalty = Math.max(0, 30 - drone.battery) * (isArmed(drone.mode) ? 1 : 0.48)
  const distance = Math.sqrt(drone.x * drone.x + drone.y * drone.y)
  const distancePenalty = Math.min(12, distance / 28)
  const standbyPenalty = isArmed(drone.mode) ? 0 : 9
  return Math.round(Math.min(32, batteryPenalty + distancePenalty + standbyPenalty + 3))
}

export function dashboardSummary(drones: DashboardDrone[]) {
  const total = drones.length
  const active = drones.filter(drone => isArmed(drone.mode)).length
  const avgLoss = total
    ? Math.round(drones.reduce((sum, drone) => sum + droneLinkLoss(drone), 0) / total)
    : 0
  const avgThroughput = Number((32 * Math.max(0.2, 1 - avgLoss / 100)).toFixed(1))

  return {
    active,
    total,
    linkQuality: avgLoss >= 18 ? 'POOR' : avgLoss >= 10 ? 'DEGRADED' : 'GOOD',
    avgLoss,
    avgThroughput,
    telemetryHz: 10,
  }
}

export function nextTelemetryDrones(current: DashboardDrone[], incoming: DashboardDrone[]) {
  void current
  return incoming
}

export function nextPendingSpawnIds(pendingIds: number[], drones: DashboardDrone[]) {
  const liveIds = new Set(drones.map(drone => drone.id))
  return pendingIds.filter(id => !liveIds.has(id))
}

export function selectedDroneTarget(drones: DashboardDrone[], selected: number | null) {
  return selected === null ? undefined : drones.find(drone => drone.id === selected)
}

export function followTarget(drones: DashboardDrone[], selected: number | null, isFollowing: boolean) {
  if (!isFollowing) return undefined
  return selectedDroneTarget(drones, selected)
}

export function animateDemoDrones(drones: DashboardDrone[], elapsedMs: number): DashboardDrone[] {
  const time = elapsedMs / 1000

  return drones.map((drone, index) => {
    const phase = time * (0.52 + index * 0.04) + index * 1.35
    const radius = 46 + index * 11
    const nextX = drone.x + Math.cos(phase) * radius
    const nextY = drone.y + Math.sin(phase) * radius
    const vx = -Math.sin(phase) * (8 + index * 1.4)
    const vy = Math.cos(phase) * (8 + index * 1.4)

    return {
      ...drone,
      x: nextX,
      y: nextY,
      z: Math.max(8, drone.z + Math.sin(phase * 0.7) * 4),
      heading: (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360,
      battery: Math.max(5, drone.battery - (index === drones.length - 1 ? 0 : elapsedMs / 600000)),
      vx,
      vy,
      vz: Math.cos(phase * 0.7) * 0.6,
    }
  })
}

export function applyDroneCommand(
  drones: DashboardDrone[],
  command: DroneCommand,
  selected: number | null,
  target: TargetPoint,
): DashboardDrone[] {
  const appliesTo = (drone: DashboardDrone) => {
    if (command.endsWith('_ALL')) return true
    return selected !== null && drone.id === selected
  }

  return drones.map(drone => {
    if (!appliesTo(drone)) return drone

    switch (command) {
      case 'ARM':
      case 'ARM_ALL':
        return { ...drone, mode: 0xd8 }
      case 'DISARM':
        return { ...drone, mode: 0, vx: 0, vy: 0, vz: 0 }
      case 'LOITER':
        return { ...drone, mode: 0x51, vx: 0, vy: 0, vz: 0 }
      case 'RTL':
      case 'RTL_ALL':
        return { ...drone, x: 0, y: 0, z: Math.max(30, drone.z), mode: 0x52 }
      case 'LAND':
      case 'LAND_ALL':
        return { ...drone, z: 8, mode: 0x53, vx: 0, vy: 0, vz: -1.5 }
      case 'HOLD':
        return { ...drone, mode: 0x54, vx: 0, vy: 0, vz: 0 }
      case 'GOTO':
        return { ...drone, x: target.x, y: target.y, z: target.z, mode: 0xd8 }
    }
  })
}

export function buildEventLog(drones: DashboardDrone[]): EventLogEntry[] {
  void drones
  return []
}

export function commandPayload(id: number, target: TargetPoint) {
  return { id, x: target.x, y: target.y, z: target.z }
}
