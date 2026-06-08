import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { apiUrl, sendGotoCommand, sendKillCommand, spawnDrone } from './api'
import {
  commandPayload,
  droneSpeed,
  followTarget,
  modeLabel,
  nextTelemetryDrones,
  nextPendingSpawnIds,
  selectedDroneTarget,
  type DashboardDrone,
  type TargetPoint,
} from './dashboard'

const ORIGIN_LAT = 59.4370
const ORIGIN_LNG = 24.7536

interface TelemetryPoint {
  x: number
  y: number
  z: number
  time: number
}

type TelemetryState = 'connecting' | 'live' | 'empty' | 'offline'

function nedToLatLng(x: number, y: number) {
  const lat = ORIGIN_LAT + (y / 111320)
  const lng = ORIGIN_LNG + (x / (111320 * Math.cos(ORIGIN_LAT * Math.PI / 180)))
  return { lat, lng }
}

function batteryColor(pct: number) {
  if (pct > 50) return '#35d46e'
  if (pct > 20) return '#e8d64d'
  return '#ff5151'
}

function droneHue(id: number) {
  return ['#31d65a', '#ffe642', '#2386ff', '#ff3f4e', '#c6d0dd'][id % 5]
}

function formatUtcTime() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(new Date())
}

function osmFallback(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: 'OpenStreetMap',
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-saturation': -0.35,
          'raster-brightness-max': 0.7,
        },
      },
    ],
  }
}

function mapStyle(): string | maplibregl.StyleSpecification {
  const mapTilerKey = String(import.meta.env.VITE_MAPTILER_KEY ?? '').trim()
  if (mapTilerKey) {
    return `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${mapTilerKey}`
  }
  return osmFallback()
}

function ProviderLabel({ hasMapTiler }: { hasMapTiler: boolean }) {
  return (
    <span className={hasMapTiler ? 'map-provider ok' : 'map-provider warn'}>
      {hasMapTiler ? 'MapTiler' : 'OSM fallback'}
    </span>
  )
}

export default function App() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapObj = useRef<maplibregl.Map | null>(null)
  const markers = useRef<Map<number, maplibregl.Marker>>(new Map())
  const lastTelemetry = useRef<Map<number, TelemetryPoint>>(new Map())
  const selectedRef = useRef<number | null>(null)
  const [drones, setDrones] = useState<DashboardDrone[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [target, setTarget] = useState<TargetPoint>({ x: 0, y: 0, z: 120 })
  const [telemetryState, setTelemetryState] = useState<TelemetryState>('connecting')
  const [message, setMessage] = useState<string | null>(null)
  const [isSpawning, setIsSpawning] = useState(false)
  const [pendingSpawnIds, setPendingSpawnIds] = useState<number[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [clock, setClock] = useState(formatUtcTime())

  const hasMapTiler = String(import.meta.env.VITE_MAPTILER_KEY ?? '').trim().length > 0
  const selectedDrone = selectedDroneTarget(drones, selected)
  const telemetryLabel = telemetryState === 'live'
    ? 'Live'
    : telemetryState === 'empty'
      ? 'No drones'
      : telemetryState === 'offline'
        ? 'Offline'
        : 'Connecting'

  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatUtcTime()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: mapStyle(),
      center: [ORIGIN_LNG, ORIGIN_LAT],
      zoom: 13,
      pitch: 0,
      bearing: 0,
    })
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    mapObj.current = map
    return () => {
      map.remove()
      mapObj.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (selectedRef.current === null) return
      const { lat, lng } = event.lngLat
      const x = (lng - ORIGIN_LNG) * 111320 * Math.cos(ORIGIN_LAT * Math.PI / 180)
      const y = (lat - ORIGIN_LAT) * 111320
      issueGoto({ x, y, z: target.z }, 'Map')
    }
    map.on('click', handleClick)
    return () => { map.off('click', handleClick) }
  }, [target.z])

  useEffect(() => {
    const map = mapObj.current
    const drone = followTarget(drones, selected, isFollowing)
    if (!map || !drone) return
    const { lat, lng } = nedToLatLng(drone.x, drone.y)
    map.easeTo({
      center: [lng, lat],
      duration: 220,
      easing: value => value,
    })
  }, [drones, selected, isFollowing])

  useEffect(() => {
    const es = new EventSource(apiUrl('/telemetry'))
    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const now = performance.now()
      const nextDrones = data.drones.map((drone: Omit<DashboardDrone, 'vx' | 'vy' | 'vz'>) => {
        const previous = lastTelemetry.current.get(drone.id)
        const dt = previous ? Math.max((now - previous.time) / 1000, 0.001) : 0
        const velocity = previous
          ? { vx: (drone.x - previous.x) / dt, vy: (drone.y - previous.y) / dt, vz: (drone.z - previous.z) / dt }
          : { vx: 0, vy: 0, vz: 0 }
        lastTelemetry.current.set(drone.id, { x: drone.x, y: drone.y, z: drone.z, time: now })
        return { ...drone, ...velocity }
      })

      setTelemetryState(nextDrones.length > 0 ? 'live' : 'empty')
      setDrones(current => {
        const updated = nextTelemetryDrones(current, nextDrones)
        setPendingSpawnIds(currentPending => nextPendingSpawnIds(currentPending, updated))
        setSelected(currentSelected => {
          if (currentSelected !== null && updated.some(drone => drone.id === currentSelected)) return currentSelected
          return updated[0]?.id ?? null
        })
        return updated
      })
    }
    es.onerror = () => {
      setTelemetryState('offline')
      es.close()
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
      }
    })
    drones.forEach(drone => {
      const { lat, lng } = nedToLatLng(drone.x, drone.y)
      if (!markers.current.has(drone.id)) {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'drone-marker'
        element.innerHTML = `<span>${drone.id}</span>`
        element.style.color = droneHue(drone.id - 1)
        element.addEventListener('click', event => {
          event.stopPropagation()
          setSelected(drone.id)
        })
        markers.current.set(
          drone.id,
          new maplibregl.Marker({ element, rotation: drone.heading }).setLngLat([lng, lat]).addTo(map),
        )
      } else {
        const marker = markers.current.get(drone.id)!
        marker.setLngLat([lng, lat])
        marker.setRotation(drone.heading)
        marker.getElement().classList.toggle('selected', drone.id === selected)
      }
    })
  }, [drones, selected])

  const handleSpawn = async () => {
    if (isSpawning) return
    setIsSpawning(true)
    setMessage('Requesting new drone...')
    try {
      const result = await spawnDrone()
      setPendingSpawnIds(current => current.includes(result.id) ? current : [...current, result.id])
      setMessage(`Drone ${result.id} starting`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Add drone failed')
    } finally {
      setIsSpawning(false)
    }
  }

  function issueGoto(nextTarget: TargetPoint, source: string) {
    const selectedId = selectedRef.current
    if (selectedId === null) return
    setTarget(nextTarget)
    sendGotoCommand(selectedId, commandPayload(selectedId, nextTarget))
      .then(() => {
        setMessage(`Drone ${selectedId}: ${source} GOTO sent`)
      })
      .catch(err => {
        setMessage(err instanceof Error ? err.message : 'GOTO failed')
      })
  }

  const sendGoto = () => {
    issueGoto(target, 'Form')
  }

  const killSelected = () => {
    const selectedId = selectedRef.current
    if (selectedId === null) return
    sendKillCommand(selectedId)
      .then(() => {
        setMessage(`Drone ${selectedId}: crash sequence started`)
      })
      .catch(err => {
        setMessage(err instanceof Error ? err.message : 'Crash command failed')
      })
  }

  const nudgeSelected = (dx: number, dy: number, dz = 0) => {
    const drone = selectedDroneTarget(drones, selectedRef.current)
    if (!drone) return
    issueGoto({
      x: drone.x + dx,
      y: drone.y + dy,
      z: Math.max(8, drone.z + dz),
    }, 'Nudge')
  }

  const selectedLatLng = selectedDrone ? nedToLatLng(selectedDrone.x, selectedDrone.y) : undefined

  return (
    <main className="gcs-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>KRATT SWARM GCS</strong>
            <span>v1.0.0</span>
          </div>
        </div>
        <div className="status-strip">
          <span><i className={telemetryState === 'offline' ? 'warn-dot' : 'ok-dot'} /> Telemetry: {telemetryLabel}</span>
          <span>Drones: {drones.length}</span>
          <ProviderLabel hasMapTiler={hasMapTiler} />
          <span>{clock} UTC</span>
        </div>
      </header>

      <section className="mission-grid real-data-grid">
        <aside className="fleet-panel panel">
          <div className="panel-title">
            <span>Swarm</span>
            <button type="button" onClick={handleSpawn} disabled={isSpawning} className={isSpawning ? 'is-loading' : ''}>
              {isSpawning ? <><i className="button-spinner" />Adding...</> : '+ Add Drone'}
            </button>
          </div>
          {drones.length > 0 || pendingSpawnIds.length > 0 ? (
            <>
              <div className="fleet-list">
                {drones.map(drone => {
                  const active = selected === drone.id
                  return (
                    <button
                      type="button"
                      key={drone.id}
                      className={`drone-card ${active ? 'active' : ''}`}
                      onClick={() => setSelected(drone.id)}
                    >
                      <span className="mini-drone" style={{ color: droneHue(drone.id - 1) }}>{drone.id}</span>
                      <span className="drone-card-main">
                        <strong>Drone {drone.id}</strong>
                        <small>SYSID {drone.id}</small>
                        <em>{modeLabel(drone.mode)}</em>
                      </span>
                      <span className="loss-readout">
                        <b style={{ color: batteryColor(drone.battery) }}>{Math.round(drone.battery)}%</b>
                        <small>{drone.z.toFixed(0)} m</small>
                      </span>
                    </button>
                  )
                })}
                {pendingSpawnIds.map(id => (
                  <div className="drone-card pending-drone-card" key={`pending-${id}`}>
                    <span className="mini-drone pending" style={{ color: droneHue(id - 1) }}>{id}</span>
                    <span className="drone-card-main">
                      <strong>Drone {id}</strong>
                      <small>SYSID {id}</small>
                      <em>STARTING</em>
                    </span>
                    <span className="loss-readout">
                      <b><i className="inline-spinner" /></b>
                      <small>waiting telemetry</small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="fleet-total">
                <span>Total: {drones.length + pendingSpawnIds.length}</span>
                <span>Selected: {selected ?? '-'}</span>
              </div>
            </>
          ) : (
            <div className="empty-panel">
              <strong>No drones in telemetry</strong>
              <span>Use Add Drone, then wait for the controller to publish telemetry.</span>
            </div>
          )}
        </aside>

        <section className="map-panel panel map-panel-live">
          <div ref={mapRef} className="map-canvas" />
          <div className="map-toolbar">
            <ProviderLabel hasMapTiler={hasMapTiler} />
            {!hasMapTiler && <span>Set VITE_MAPTILER_KEY in Cloudflare Pages to show MapTiler.</span>}
          </div>
          <div className="map-scale">500 m</div>
          <div className="home-readout">
            <strong>Home</strong>
            <span>Lat {ORIGIN_LAT.toFixed(6)}</span>
            <span>Lon {ORIGIN_LNG.toFixed(6)}</span>
          </div>
          <div className={`follow-readout ${isFollowing ? 'active' : ''}`}>
            <button
              type="button"
              onClick={() => setIsFollowing(current => !current)}
              disabled={!selectedDrone}
            >
              {isFollowing ? 'Observe Map' : 'Follow Drone'}
            </button>
            <span>{selectedDrone ? `Drone ${selectedDrone.id}` : 'Select drone'}</span>
          </div>
          {drones.length === 0 && (
            <div className="empty-map-message">
              <strong>No drone markers</strong>
              <span>Map is live; telemetry has no drones yet.</span>
            </div>
          )}
        </section>

        <aside className="inspector panel">
          <div className="inspector-head">
            <div>
              <strong>{selectedDrone ? `Drone ${selectedDrone.id}` : 'No Drone'}</strong>
              <span>{selectedDrone ? modeLabel(selectedDrone.mode) : 'Select a live drone'}</span>
            </div>
          </div>
          {selectedDrone && selectedLatLng ? (
            <div className="telemetry-panel">
              <div className="telemetry-grid">
                <div><span>Battery</span><strong style={{ color: batteryColor(selectedDrone.battery) }}>{Math.round(selectedDrone.battery)}%</strong></div>
                <div><span>Altitude</span><strong>{selectedDrone.z.toFixed(1)} m</strong></div>
                <div><span>Speed</span><strong>{droneSpeed(selectedDrone).toFixed(1)} m/s</strong></div>
                <div><span>Heading</span><strong>{Math.round(selectedDrone.heading)} deg</strong></div>
              </div>
              <div className="coords-grid single">
                <div>
                  <span>Position</span>
                  <p>X {selectedDrone.x.toFixed(1)}</p>
                  <p>Y {selectedDrone.y.toFixed(1)}</p>
                  <p>Lat {selectedLatLng.lat.toFixed(6)}</p>
                  <p>Lon {selectedLatLng.lng.toFixed(6)}</p>
                </div>
                <div>
                  <span>Target</span>
                  <p>X {target.x.toFixed(1)}</p>
                  <p>Y {target.y.toFixed(1)}</p>
                  <p>Alt {target.z.toFixed(1)} m</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-inspector">No live drone selected.</div>
          )}
        </aside>

        <footer className="command-deck panel real-command-deck">
          <div className="goto-form">
            <span>Goto Location</span>
            <label>X <input value={target.x.toFixed(1)} onChange={event => setTarget({ ...target, x: Number(event.target.value) || 0 })} /></label>
            <label>Y <input value={target.y.toFixed(1)} onChange={event => setTarget({ ...target, y: Number(event.target.value) || 0 })} /></label>
            <label>Alt <input value={target.z.toFixed(1)} onChange={event => setTarget({ ...target, z: Number(event.target.value) || 0 })} /></label>
            <button type="button" onClick={sendGoto} disabled={selected === null}>Send</button>
          </div>
          <div className="direct-control">
            <span>Nudge Selected</span>
            <button type="button" onClick={() => nudgeSelected(0, 35)} disabled={!selectedDrone}>N</button>
            <button type="button" onClick={() => nudgeSelected(-35, 0)} disabled={!selectedDrone}>W</button>
            <button type="button" onClick={() => nudgeSelected(35, 0)} disabled={!selectedDrone}>E</button>
            <button type="button" onClick={() => nudgeSelected(0, -35)} disabled={!selectedDrone}>S</button>
            <button type="button" onClick={() => nudgeSelected(0, 0, 15)} disabled={!selectedDrone}>Up</button>
            <button type="button" onClick={() => nudgeSelected(0, 0, -15)} disabled={!selectedDrone}>Down</button>
            <button type="button" className="danger-command" onClick={killSelected} disabled={!selectedDrone}>Crash</button>
          </div>
        </footer>
      </section>

      <div className="bottom-status">
        <span>API: {apiUrl('/').replace(/\/$/, '')}</span>
        <span>Map: {hasMapTiler ? 'MapTiler streets-v2-dark' : 'OpenStreetMap fallback'}</span>
        <span>{message ?? `Telemetry: ${telemetryLabel}`}</span>
      </div>
    </main>
  )
}
