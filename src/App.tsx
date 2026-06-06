import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { apiUrl, spawnDrone } from './api'

// KrattWorks HQ — Tallinn as origin
const ORIGIN_LAT = 59.4370
const ORIGIN_LNG = 24.7536

interface Drone {
  id: number
  x: number
  y: number
  z: number
  heading: number
  battery: number
  mode: number
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

export default function App() {
  const mapRef     = useRef<HTMLDivElement>(null)
  const mapObj     = useRef<maplibregl.Map | null>(null)
  const markers    = useRef<Map<number, maplibregl.Marker>>(new Map())
  const [drones, setDrones] = useState<Drone[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [spawnStatus, setSpawnStatus] = useState<string | null>(null)
// 1. init map ONCE
useEffect(() => {
    if (!mapRef.current) return
    const key = import.meta.env.VITE_MAPTILER_KEY
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${key}`,
      center: [ORIGIN_LNG, ORIGIN_LAT],
      zoom: 14,
    })
    mapObj.current = map
    return () => {
      map.remove()
    }
}, []) // ← empty deps, runs once

// 2. click handler — uses ref for selected to avoid recreating map
const selectedRef = useRef<number | null>(null)

useEffect(() => {
  selectedRef.current = selected
}, [selected])

useEffect(() => {
    const map = mapObj.current
    if (!map) return
    
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (selectedRef.current === null) return
      const { lat, lng } = e.lngLat
      const x = (lng - ORIGIN_LNG) * 111320 *
                Math.cos(ORIGIN_LAT * Math.PI / 180)
      const y = (lat - ORIGIN_LAT) * 111320

      fetch(apiUrl('/goto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: selectedRef.current, x, y, z: 10 
        })
      })
    }

    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
}, []) // ← empty deps too

  // SSE telemetry
  useEffect(() => {
    const es = new EventSource(apiUrl('/telemetry'))
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      setDrones(data.drones)
    }
    return () => es.close()
  }, [])

  // update markers
  useEffect(() => {
    const map = mapObj.current
    if (!map) return

    drones.forEach(drone => {
      const { lat, lng } = nedToLatLng(drone.x, drone.y)

      if (!markers.current.has(drone.id)) {
        // create marker
        const el = document.createElement('div')
        el.className = 'drone-marker'
        el.innerHTML = `
          <span class="drone-heading-line" aria-hidden="true"></span>
          <span class="drone-body" aria-hidden="true"></span>
        `
        el.style.cssText = `
          color: ${drone.id === selected ? '#00ff00' : '#00aaff'};
          cursor: pointer;
        `
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          setSelected(drone.id)
        })

        const marker = new maplibregl.Marker({
          element: el,
          rotation: drone.heading,
        })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup().setHTML(
            `<b>Drone ${drone.id}</b>`
          ))
          .addTo(map)

        markers.current.set(drone.id, marker)
      } else {
        // update position and rotation
        const marker = markers.current.get(drone.id)!
        marker.setLngLat([lng, lat])
        marker.setRotation(drone.heading)
        const el = marker.getElement()
        el.style.color = drone.id === selected ? '#00ff00' : '#00aaff'
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
      const message = err instanceof Error ? err.message : 'Spawn failed'
      setSpawnStatus(message)
    }
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* map */}
      <div ref={mapRef} className="flex-1" />

      {/* sidebar */}
      <div className="w-72 bg-gray-800 p-4 flex flex-col gap-3 overflow-y-auto">
        <h1 className="text-xl font-bold text-blue-400">
          Swarm GCS
        </h1>
        <p className="text-xs text-gray-400">
          {selected !== null
            ? `Click map to send GOTO → Drone ${selected}`
            : 'Click a drone to select it'}
        </p>

        <button
          type="button"
          onClick={handleSpawn}
          className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-400"
        >
          Spawn Drone
        </button>

        {spawnStatus && (
          <p className="text-xs text-gray-300">
            {spawnStatus}
          </p>
        )}

        {drones.map(d => (
          <div
            key={d.id}
            onClick={() => setSelected(d.id)}
            className={`p-3 rounded-lg cursor-pointer border transition-all ${
              selected === d.id
                ? 'border-green-400 bg-gray-700'
                : 'border-gray-600 bg-gray-750 hover:border-gray-400'
            }`}
          >
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold">Drone {d.id}</span>
              <span className="text-xs text-gray-400">
                {modeLabel(d.mode)}
              </span>
            </div>
            <div className="text-xs text-gray-300 space-y-1">
              <div>Heading: <span className="text-white">{d.heading.toFixed(1)}°</span></div>
              <div>Battery: <span className="text-white">{d.battery.toFixed(1)}%</span></div>
              <div>Alt: <span className="text-white">{d.z.toFixed(1)}m</span></div>
              <div className="text-gray-500">
                x:{d.x.toFixed(1)} y:{d.y.toFixed(1)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
