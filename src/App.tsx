import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { apiUrl, spawnDrone } from './api'
import { fpvMetrics } from './fpv'

const ORIGIN_LAT = 59.4370
const ORIGIN_LNG = 24.7536
const ALT_BUFFER_SIZE = 60

interface Drone {
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

interface TelemetryPoint {
  x: number
  y: number
  z: number
  time: number
}

function nedToLatLng(x: number, y: number) {
  const lat = ORIGIN_LAT + (y / 111320)
  const lng = ORIGIN_LNG + (x / (111320 * Math.cos(ORIGIN_LAT * Math.PI / 180)))
  return { lat, lng }
}

function modeLabel(mode: number) {
  if (mode === 0xD8) return 'GUIDED_ARMED'
  if (mode === 0xBC) return 'AUTO_ARMED'
  return `MODE_${mode}`
}

function isArmed(mode: number) {
  return mode === 0xD8 || mode === 0xBC
}

function batteryColor(pct: number) {
  if (pct > 50) return '#22c55e'
  if (pct > 20) return '#eab308'
  return '#ef4444'
}

function HeadingArrow({ heading }: { heading: number }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
      <circle cx="10" cy="10" r="9" stroke="#374151" strokeWidth="1" fill="none" />
      <g transform={`rotate(${heading} 10 10)`}>
        <polygon points="10,2 7,14 10,12 13,14" fill="#3b82f6" />
      </g>
    </svg>
  )
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div style={{ height: 32 }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const W = 220
  const H = 32
  const pad = 2
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - pad - ((v - min) / range) * (H - pad * 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="#3b82f6" fillOpacity="0.15" />
      <polyline points={pts} stroke="#3b82f6" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

function FpvPanel({ drone, enabled }: { drone?: Drone, enabled: boolean }) {
  if (!enabled) return null

  if (!drone) {
    return (
      <div className="fpv-panel">
        <div className="fpv-topline">
          <span>FPV</span>
          <span className="fpv-alert">SIGNAL LOST</span>
        </div>
        <div className="fpv-offline">NO TELEMETRY</div>
      </div>
    )
  }

  const metrics = fpvMetrics(drone)
  return (
    <div className="fpv-panel">
      <div className="fpv-topline">
        <span>DRONE {drone.id} FPV</span>
        <span className={metrics.lowBattery ? 'fpv-alert' : 'fpv-live'}>{metrics.lowBattery ? 'LOW BAT' : 'LIVE'}</span>
      </div>

      <div className="fpv-viewport">
        <div
          className="fpv-horizon"
          style={{
            transform: `translate(-50%, calc(-50% + ${metrics.horizonOffset}px)) rotate(${metrics.horizonTilt}deg)`,
          }}
        >
          <div className="fpv-sky" />
          <div className="fpv-ground" />
        </div>
        <div className="fpv-ladder fpv-ladder-left" />
        <div className="fpv-ladder fpv-ladder-right" />
        <div className="fpv-crosshair">
          <span />
          <span />
        </div>
        <div className="fpv-heading">{metrics.headingLabel}</div>
      </div>

      <div className="fpv-readouts">
        <span>SPD {metrics.speedLabel}</span>
        <span>ALT {metrics.altitudeLabel}</span>
        <span>BAT {metrics.batteryLabel}</span>
      </div>
    </div>
  )
}

export default function App() {
  const mapRef     = useRef<HTMLDivElement>(null)
  const mapObj     = useRef<maplibregl.Map | null>(null)
  const markers    = useRef<Map<number, maplibregl.Marker>>(new Map())
  const altHistory = useRef<Map<number, number[]>>(new Map())
  const lastTelemetry = useRef<Map<number, TelemetryPoint>>(new Map())
  const [drones, setDrones] = useState<Drone[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [fpvEnabled, setFpvEnabled] = useState(false)
  const [spawnStatus, setSpawnStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!mapRef.current) return
    const key = import.meta.env.VITE_MAPTILER_KEY
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${key}`,
      center: [ORIGIN_LNG, ORIGIN_LAT],
      zoom: 14,
    })
    mapObj.current = map
    return () => { map.remove() }
  }, [])

  const selectedRef = useRef<number | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (selectedRef.current === null) return
      const { lat, lng } = e.lngLat
      const x = (lng - ORIGIN_LNG) * 111320 * Math.cos(ORIGIN_LAT * Math.PI / 180)
      const y = (lat - ORIGIN_LAT) * 111320
      fetch(apiUrl('/goto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedRef.current, x, y, z: 10 }),
      })
    }
    map.on('click', handleClick)
    return () => { map.off('click', handleClick) }
  }, [])

  useEffect(() => {
    const es = new EventSource(apiUrl('/telemetry'))
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      const now = performance.now()
      const nextDrones = data.drones.map((d: Omit<Drone, 'vx' | 'vy' | 'vz'>) => {
        const previous = lastTelemetry.current.get(d.id)
        const dt = previous ? Math.max((now - previous.time) / 1000, 0.001) : 0
        const velocity = previous && dt > 0
          ? {
              vx: (d.x - previous.x) / dt,
              vy: (d.y - previous.y) / dt,
              vz: (d.z - previous.z) / dt,
            }
          : { vx: 0, vy: 0, vz: 0 }

        const hist = altHistory.current.get(d.id) ?? []
        hist.push(d.z)
        if (hist.length > ALT_BUFFER_SIZE) hist.shift()
        altHistory.current.set(d.id, hist)
        lastTelemetry.current.set(d.id, { x: d.x, y: d.y, z: d.z, time: now })

        return { ...d, ...velocity }
      })
      setDrones(nextDrones)
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    const liveDroneIds = new Set(drones.map(drone => drone.id))
    markers.current.forEach((marker, id) => {
      if (!liveDroneIds.has(id)) {
        marker.remove()
        markers.current.delete(id)
        altHistory.current.delete(id)
        if (selected === id) {
          setSelected(null)
        }
      }
    })
    drones.forEach(drone => {
      const { lat, lng } = nedToLatLng(drone.x, drone.y)
      if (!markers.current.has(drone.id)) {
        const el = document.createElement('div')
        el.className = 'drone-marker'
        el.innerHTML = `
          <span class="drone-heading-line" aria-hidden="true"></span>
          <span class="drone-body" aria-hidden="true"></span>
        `
        el.style.cssText = `color: ${drone.id === selected ? '#22c55e' : '#3b82f6'}; cursor: pointer;`
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          setSelected(drone.id)
        })
        const marker = new maplibregl.Marker({ element: el, rotation: drone.heading })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup().setHTML(`<b>Drone ${drone.id}</b>`))
          .addTo(map)
        markers.current.set(drone.id, marker)
      } else {
        const marker = markers.current.get(drone.id)!
        marker.setLngLat([lng, lat])
        marker.setRotation(drone.heading)
        marker.getElement().style.color = drone.id === selected ? '#22c55e' : '#3b82f6'
      }
    })
  }, [drones, selected])

  const handleSpawn = async () => {
    const password = window.prompt('Spawn password')
    if (!password) return
    setSpawnStatus('Spawning drone...')
    try {
      const result = await spawnDrone(password)
      setSpawnStatus(`Drone ${result.id} spawned`)
    } catch (err) {
      setSpawnStatus(err instanceof Error ? err.message : 'Spawn failed')
    }
  }

  const selectedDrone = selected === null
    ? undefined
    : drones.find(drone => drone.id === selected)

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f1117', color: 'white' }}>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <div ref={mapRef} style={{ position: 'absolute', inset: 0 }} />
        <FpvPanel drone={selectedDrone} enabled={fpvEnabled && selected !== null} />
      </div>

      <div style={{
        width: 288,
        background: '#0f1117',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        overflowY: 'auto',
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6', margin: 0, marginBottom: 4 }}>
            Swarm GCS
          </h1>
          <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
            {selected !== null
              ? `Click map to send GOTO → Drone ${selected}`
              : 'Click a drone to select it'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSpawn}
          className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-400"
        >
          Spawn Drone
        </button>

        <button
          type="button"
          onClick={() => setFpvEnabled(value => !value)}
          disabled={selected === null}
          className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
        >
          {fpvEnabled ? 'Close FPV' : 'Open FPV'}
        </button>

        {spawnStatus && (
          <p className="text-xs text-gray-300">{spawnStatus}</p>
        )}

        {drones.map(d => {
          const sel = selected === d.id
          const armed = isArmed(d.mode)
          const hist = altHistory.current.get(d.id) ?? []
          return (
            <div
              key={d.id}
              onClick={() => setSelected(d.id)}
              style={{
                background: '#1a1d27',
                border: `1px solid ${sel ? '#3b82f6' : '#2a2d3a'}`,
                boxShadow: sel ? '0 0 8px rgba(59,130,246,0.4)' : 'none',
                borderRadius: 8,
                padding: 12,
                cursor: 'pointer',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              {/* header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Drone {d.id}</span>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  background: '#0f1117',
                  borderRadius: 999,
                  padding: '2px 8px',
                  color: armed ? '#22c55e' : '#9ca3af',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: armed ? '#22c55e' : '#6b7280',
                    display: 'inline-block',
                  }} />
                  {modeLabel(d.mode)}
                </span>
              </div>

              {/* stats */}
              <div style={{ fontSize: 12, color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <HeadingArrow heading={d.heading} />
                  <span>Heading: <span style={{ color: 'white' }}>{d.heading.toFixed(1)}°</span></span>
                </div>
                <div>Battery: <span style={{ color: 'white' }}>{d.battery.toFixed(1)}%</span></div>
                <div>Alt: <span style={{ color: 'white' }}>{d.z.toFixed(1)}m</span></div>
                <div style={{ color: '#4b5563' }}>x:{d.x.toFixed(1)} y:{d.y.toFixed(1)}</div>
              </div>

              {/* battery bar */}
              <div style={{ height: 4, background: '#2a2d3a', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(0, d.battery))}%`,
                  background: batteryColor(d.battery),
                  borderRadius: 2,
                  transition: 'width 0.3s, background 0.3s',
                }} />
              </div>

              {/* altitude sparkline */}
              <Sparkline data={hist} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
