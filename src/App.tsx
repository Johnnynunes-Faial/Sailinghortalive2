import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Position = {
  latitude: number
  longitude: number
  speed: number
  course: number
  fixTime: string | null
}

type Boat = {
  id: number
  name: string
  uniqueId: string
  status: string
  lastUpdate: string | null
  position: Position | null
}

type LiveResponse = {
  ok: boolean
  updatedAt: string
  boats: Boat[]
}

function App() {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  const markersRef = useRef<Map<number, L.Marker>>(new Map())
  const initialFitDoneRef = useRef(false)

  const [boats, setBoats] = useState<Boat[]>([])
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return
    }

    const map = L.map(mapElementRef.current, {
      zoomControl: true,
    }).setView([38.535, -28.63], 11)

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
    ).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadLive() {
      try {
        const response = await fetch('/api/live', {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = (await response.json()) as LiveResponse

        if (!active) return

        setBoats(data.boats ?? [])
        setConnected(data.ok === true)
        setLastUpdate(data.updatedAt ?? null)
      } catch (error) {
        console.error('Erro Live:', error)

        if (active) {
          setConnected(false)
        }
      }
    }

    loadLive()

    const timer = window.setInterval(loadLive, 2000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map) return

    const positionedBoats = boats.filter(
      (boat) =>
        boat.position &&
        Number.isFinite(boat.position.latitude) &&
        Number.isFinite(boat.position.longitude),
    )

    const activeIds = new Set(positionedBoats.map((boat) => boat.id))

    for (const [id, marker] of markersRef.current.entries()) {
      if (!activeIds.has(id)) {
        marker.removeFrom(map)
        markersRef.current.delete(id)
      }
    }

    for (const boat of positionedBoats) {
      const position = boat.position!

      const icon = L.divIcon({
        className: 'boat-marker-wrapper',
        html: `
          <div class="boat-marker">
            <div
              class="boat-arrow"
              style="transform: rotate(${position.course || 0}deg)"
            >
              ▲
            </div>

            <div class="boat-name">
              ${escapeHtml(boat.name)}
            </div>
          </div>
        `,
        iconSize: [120, 50],
        iconAnchor: [60, 18],
      })

      const existingMarker = markersRef.current.get(boat.id)

      const popup = `
        <strong>${escapeHtml(boat.name)}</strong><br>
        Velocidade: ${Number(position.speed ?? 0).toFixed(1)} kn<br>
        Rumo: ${Math.round(position.course ?? 0)}°
      `

      if (existingMarker) {
        existingMarker.setLatLng([
          position.latitude,
          position.longitude,
        ])

        existingMarker.setIcon(icon)
        existingMarker.setPopupContent(popup)
      } else {
        const marker = L.marker(
          [position.latitude, position.longitude],
          {
            icon,
          },
        )
          .addTo(map)
          .bindPopup(popup)

        markersRef.current.set(boat.id, marker)
      }
    }

    if (
      !initialFitDoneRef.current &&
      positionedBoats.length > 0
    ) {
      const bounds = L.latLngBounds(
        positionedBoats.map((boat) => [
          boat.position!.latitude,
          boat.position!.longitude,
        ]),
      )

      if (positionedBoats.length === 1) {
        map.setView(bounds.getCenter(), 13)
      } else {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 13,
        })
      }

      initialFitDoneRef.current = true
    }
  }, [boats])

  function showAllBoats() {
    const map = mapRef.current

    if (!map) return

    const boatsWithPosition = boats.filter(
      (boat) => boat.position,
    )

    if (boatsWithPosition.length === 0) return

    const bounds = L.latLngBounds(
      boatsWithPosition.map((boat) => [
        boat.position!.latitude,
        boat.position!.longitude,
      ]),
    )

    if (boatsWithPosition.length === 1) {
      map.setView(bounds.getCenter(), 13)
    } else {
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 13,
      })
    }
  }

  return (
    <main className="live-app">
      <header className="top-bar">
        <div>
          <div className="brand-small">REGATA LIVE</div>
          <div className="brand-title">Sailing Horta Live</div>
        </div>

        <div className="top-actions">
          <div
            className={
              connected
                ? 'connection online'
                : 'connection offline'
            }
          >
            <span className="status-dot" />

            {connected
              ? 'Traccar online'
              : 'Traccar offline'}
          </div>

          <button
            className="show-all-button"
            onClick={showAllBoats}
          >
            Mostrar todos
          </button>
        </div>
      </header>

      <section className="map-container">
        <div
          ref={mapElementRef}
          className="map"
        />

        <div className="boat-counter">
          {boats.filter((boat) => boat.position).length}
          {' '}
          barcos com posição
        </div>

        {lastUpdate && (
          <div className="last-update">
            Atualização Live
          </div>
        )}
      </section>
    </main>
  )
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export default App
