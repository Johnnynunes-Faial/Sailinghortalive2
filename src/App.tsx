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

type EventItem = {
  id: string
  name: string
  start_time: string | null
  end_time: string | null
  status: string
  created_at: string
  updated_at: string
}

type EventsResponse = {
  ok: boolean
  events: EventItem[]
}

type AdminDevice = {
  id: number
  name: string
  uniqueId: string
  status: string
  lastUpdate: string | null
}

function App() {
  return window.location.pathname.startsWith('/admin')
    ? <AdminView />
    : <PublicLiveView />
}

function PublicLiveView() {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<number, L.Marker>>(new Map())
  const lastFitKeyRef = useRef<string>('')

  const [boats, setBoats] = useState<Boat[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedEventId, setSelectedEventId] = useState('general')
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return

    const map = L.map(mapElementRef.current).setView([38.535, -28.63], 11)

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
    loadEvents()
  }, [])

  useEffect(() => {
    let active = true

    async function loadLive() {
      try {
        const endpoint =
          selectedEventId === 'general'
            ? '/api/live'
            : `/api/events/${encodeURIComponent(selectedEventId)}/live`

        const response = await fetch(endpoint, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = (await response.json()) as LiveResponse
        if (!active) return

        setBoats(data.boats ?? [])
        setConnected(data.ok === true)
      } catch {
        if (active) {
          setConnected(false)
          setBoats([])
        }
      }
    }

    loadLive()
    const timer = window.setInterval(loadLive, 2000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selectedEventId])

  async function loadEvents() {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = (await response.json()) as EventsResponse
      setEvents(data.events ?? [])
    } catch {
      setEvents([])
    }
  }

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
            <div class="boat-arrow" style="transform: rotate(${position.course || 0}deg)">▲</div>
            <div class="boat-name">${escapeHtml(boat.name)}</div>
          </div>
        `,
        iconSize: [120, 50],
        iconAnchor: [60, 18],
      })

      const popup = `
        <strong>${escapeHtml(boat.name)}</strong><br>
        Velocidade: ${Number(position.speed ?? 0).toFixed(1)} kn<br>
        Rumo: ${Math.round(position.course ?? 0)}°
      `

      const existingMarker = markersRef.current.get(boat.id)

      if (existingMarker) {
        existingMarker.setLatLng([position.latitude, position.longitude])
        existingMarker.setIcon(icon)
        existingMarker.setPopupContent(popup)
      } else {
        const marker = L.marker(
          [position.latitude, position.longitude],
          { icon },
        )
          .addTo(map)
          .bindPopup(popup)

        markersRef.current.set(boat.id, marker)
      }
    }

    const fitKey =
      `${selectedEventId}:${positionedBoats.map((boat) => boat.id).sort((a, b) => a - b).join(',')}`

    if (positionedBoats.length > 0 && lastFitKeyRef.current !== fitKey) {
      fitBoats(map, positionedBoats)
      lastFitKeyRef.current = fitKey
    }
  }, [boats, selectedEventId])

  function showAllBoats() {
    const map = mapRef.current
    if (!map) return
    fitBoats(map, boats)
  }

  return (
    <main className="live-app">
      <header className="top-bar">
        <div className="brand-block">
          <div className="brand-small">REGATA LIVE</div>
          <div className="brand-title">Sailing Horta Live</div>
        </div>

        <div className="event-controls">
          <select
            className="event-select"
            value={selectedEventId}
            onChange={(event) => {
              setSelectedEventId(event.target.value)
              lastFitKeyRef.current = ''
            }}
          >
            <option value="general">Modo Geral</option>

            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </div>

        <div className="top-actions">
          <div className={connected ? 'connection online' : 'connection offline'}>
            <span className="status-dot" />
            {connected ? 'Traccar online' : 'Traccar offline'}
          </div>

          <button className="show-all-button" onClick={showAllBoats}>
            Mostrar todos
          </button>
        </div>
      </header>

      <section className="map-container">
        <div ref={mapElementRef} className="map" />

        <div className="boat-counter">
          {boats.length} barcos ativos
        </div>
      </section>
    </main>
  )
}

function AdminView() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [eventName, setEventName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null)

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = (await response.json()) as EventsResponse
      setEvents(data.events ?? [])
    } catch {
      setEvents([])
    }
  }

  async function createEvent(event: React.FormEvent) {
    event.preventDefault()

    if (!eventName.trim()) {
      setError('Indica o nome da regata.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/admin/api/events', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: eventName.trim(),
          startTime: startTime || null,
          endTime: endTime || null,
        }),
      })

      const data = await response.json() as {
        ok?: boolean
        error?: string
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Erro ao criar regata')
      }

      setEventName('')
      setStartTime('')
      setEndTime('')
      await loadEvents()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Erro ao criar regata',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <div className="brand-small">REGATA LIVE</div>
          <h1>Administração</h1>
        </div>

        <a href="/" className="back-live-link">← Voltar ao Live</a>
      </header>

      <div className="admin-content">
        <section className="admin-card">
          <h2>Nova regata</h2>

          <form onSubmit={createEvent} className="admin-form">
            <label>
              Nome
              <input
                type="text"
                value={eventName}
                onChange={(event) => setEventName(event.target.value)}
                placeholder="Ex.: Regata Horta - Madalena"
              />
            </label>

            <label>
              Início
              <input
                type="datetime-local"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>

            <label>
              Fim / hora limite
              <input
                type="datetime-local"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>

            {error && <div className="form-error">{error}</div>}

            <button type="submit" className="save-button" disabled={saving}>
              {saving ? 'A guardar...' : 'Criar regata'}
            </button>
          </form>
        </section>

        <section className="admin-card">
          <h2>Regatas</h2>

          {events.length === 0 ? (
            <div className="empty-state">Ainda não existem regatas.</div>
          ) : (
            <div className="event-list">
              {events.map((event) => (
                <div key={event.id} className="event-row">
                  <div>
                    <strong>{event.name}</strong>
                    <div className="event-meta">{event.status}</div>
                  </div>

                  <button
                    type="button"
                    className="edit-event-button"
                    onClick={() => setEditingEvent(event)}
                  >
                    Editar
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editingEvent && (
        <ParticipantsEditor
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </main>
  )
}

function ParticipantsEditor({
  event,
  onClose,
}: {
  event: EventItem
  onClose: () => void
}) {
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [event.id])

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const [devicesResponse, participantsResponse] = await Promise.all([
        fetch('/admin/api/devices', {
          credentials: 'same-origin',
          cache: 'no-store',
        }),
        fetch(
          `/admin/api/events/${encodeURIComponent(event.id)}/participants`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
          },
        ),
      ])

      const devicesData = await devicesResponse.json() as {
        ok?: boolean
        devices?: AdminDevice[]
        error?: string
      }

      const participantsData = await participantsResponse.json() as {
        ok?: boolean
        participants?: Array<{
          traccar_device_id: number
          boat_name: string
        }>
        error?: string
      }

      if (!devicesResponse.ok || !devicesData.ok) {
        throw new Error(devicesData.error || 'Erro ao carregar barcos')
      }

      if (!participantsResponse.ok || !participantsData.ok) {
        throw new Error(participantsData.error || 'Erro ao carregar participantes')
      }

      setDevices(devicesData.devices ?? [])

      setSelectedIds(
        new Set(
          (participantsData.participants ?? []).map(
            (participant) => Number(participant.traccar_device_id),
          ),
        ),
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar dados',
      )
    } finally {
      setLoading(false)
    }
  }

  function toggleDevice(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function saveParticipants() {
    setSaving(true)
    setError(null)

    try {
      const participants = devices
        .filter((device) => selectedIds.has(device.id))
        .map((device) => ({
          traccarDeviceId: device.id,
          boatName: device.name,
        }))

      const response = await fetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/participants`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participants }),
        },
      )

      const data = await response.json() as {
        ok?: boolean
        error?: string
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Erro ao guardar participantes')
      }

      onClose()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Erro ao guardar participantes',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="participants-modal">
        <div className="participants-header">
          <div>
            <div className="modal-small">PARTICIPANTES</div>
            <h2>{event.name}</h2>
          </div>

          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {loading ? (
          <div className="modal-message">A carregar barcos...</div>
        ) : (
          <>
            {error && <div className="form-error modal-error">{error}</div>}

            <div className="participants-toolbar">
              <span>{selectedIds.size} selecionados</span>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setSelectedIds(
                    new Set(devices.map((device) => device.id)),
                  )
                }
              >
                Selecionar todos
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelectedIds(new Set())}
              >
                Limpar
              </button>
            </div>

            <div className="devices-list">
              {devices.map((device) => (
                <label
                  key={device.id}
                  className={
                    selectedIds.has(device.id)
                      ? 'device-row selected'
                      : 'device-row'
                  }
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(device.id)}
                    onChange={() => toggleDevice(device.id)}
                  />

                  <div className="device-info">
                    <strong>{device.name}</strong>
                    <span>ID Traccar: {device.id}</span>
                  </div>
                </label>
              ))}
            </div>

            <div className="participants-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="save-button"
                disabled={saving}
                onClick={saveParticipants}
              >
                {saving ? 'A guardar...' : 'Guardar participantes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function fitBoats(map: L.Map, boats: Boat[]) {
  const boatsWithPosition = boats.filter((boat) => boat.position)
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export default App
