export interface FpvDroneTelemetry {
  id: number
  x: number
  y: number
  z: number
  heading: number
  battery: number
  mode: number
  vx?: number
  vy?: number
  vz?: number
}

export interface FpvMetrics {
  speed: number
  speedLabel: string
  headingLabel: string
  altitudeLabel: string
  batteryLabel: string
  lowBattery: boolean
  horizonTilt: number
  horizonOffset: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function fpvMetrics(drone: FpvDroneTelemetry): FpvMetrics {
  const vx = drone.vx ?? 0
  const vy = drone.vy ?? 0
  const vz = drone.vz ?? 0
  const speed = Math.sqrt(vx * vx + vy * vy)
  const heading = Math.round(drone.heading) % 360
  const normalizedHeading = heading < 0 ? heading + 360 : heading

  return {
    speed,
    speedLabel: `${speed.toFixed(1)} m/s`,
    headingLabel: normalizedHeading.toString().padStart(3, '0'),
    altitudeLabel: `${drone.z.toFixed(1)}m`,
    batteryLabel: `${Math.round(clamp(drone.battery, 0, 100))}%`,
    lowBattery: drone.battery <= 20,
    horizonTilt: clamp(vx * 0.8, -22, 22),
    horizonOffset: clamp(-vz * 2.25, -24, 24),
  }
}
