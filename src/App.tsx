import { useEffect, useMemo, useRef, useState } from 'react'
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

type EventItem = {
  id: string
  name: string
  start_time: string | null
  end_time: string | null
  status: string
  created_at: string
  updated_at: string
}

type CoursePoint = {
  id?: number
  event_id?: string
  point_type: 'buoy' | 'waypoint'
  name: string | null
  latitude: number
  longitude: number
  point_order: number
}

type CourseLine = {
  id?: number
  event_id?: string
  line_type: 'start' | 'finish'
  a_latitude: number
  a_longitude: number
  b_latitude: number
  b_longitude: number
}

type LiveResponse = {
  ok: boolean
  updatedAt: string
  boats: Boat[]
  course?: CoursePoint[]
  lines?: CourseLine[]
}

type AdminDevice = {
  id: number
  name: string
  uniqueId: string
  status: string
  lastUpdate: string | null
}

type LibraryBuoy = {
  id: number
  name: string
  latitude: number
  longitude: number
  created_at?: string
  updated_at?: string
}

type TrackPoint = {
  latitude: number
  longitude: number
  fixTime: string | null
}

type BoatTrack = {
  deviceId: number
  boatName: string
  positions: TrackPoint[]
}

const BOAT_COLORS = [
  '#e53935',
  '#1e88e5',
  '#43a047',
  '#fb8c00',
  '#8e24aa',
  '#00897b',
  '#3949ab',
  '#f4511e',
  '#6d4c41',
  '#00acc1',
  '#7cb342',
  '#d81b60',
]

function App() {
  return window.location.pathname.startsWith('/admin')
    ? <AdminView />
    : <PublicLiveView />
}

function PublicLiveView() {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const boatMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const courseLayerRef = useRef<L.LayerGroup | null>(null)
  const trackLayerRef = useRef<L.LayerGroup | null>(null)
  const lastFitKeyRef = useRef('')

  const [boats, setBoats] = useState<Boat[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedEventId, setSelectedEventId] = useState('general')
  const [connected, setConnected] = useState(false)
  const [course, setCourse] = useState<CoursePoint[]>([])
  const [lines, setLines] = useState<CourseLine[]>([])
  const [showCourse, setShowCourse] = useState(true)
  const [showNames, setShowNames] = useState(true)
  const [showWind, setShowWind] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [trackDistance, setTrackDistance] = useState<0 | 0.5 | 1 | 2>(0)
  const [tracks, setTracks] = useState<BoatTrack[]>([])

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
    courseLayerRef.current = L.layerGroup().addTo(map)
    trackLayerRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    fetch('/api/events', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const loadedEvents = data.events ?? []
        setEvents(loadedEvents)

        const liveEvents = loadedEvents.filter(
          (event: EventItem) => event.status === 'live',
        )

        if (
          selectedEventId === 'general' &&
          liveEvents.length === 1
        ) {
          setSelectedEventId(liveEvents[0].id)
          lastFitKeyRef.current = ''
        }
      })
      .catch(() => setEvents([]))
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
        if (!response.ok) throw new Error()

        const data = (await response.json()) as LiveResponse
        if (!active) return

        setBoats(data.boats ?? [])
        setCourse(data.course ?? [])
        setLines(data.lines ?? [])
        setConnected(data.ok === true)
      } catch {
        if (active) {
          setConnected(false)
          setBoats([])
          setCourse([])
          setLines([])
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

  useEffect(() => {
    if (
      selectedEventId === 'general' ||
      trackDistance === 0
    ) {
      setTracks([])
      return
    }

    let active = true

    async function loadTracks() {
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(selectedEventId)}/tracks?distance=${trackDistance}`,
          { cache: 'no-store' },
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json() as {
          ok?: boolean
          tracks?: BoatTrack[]
        }

        if (active) {
          setTracks(data.tracks ?? [])
        }
      } catch {
        if (active) setTracks([])
      }
    }

    loadTracks()
    const timer = window.setInterval(loadTracks, 20000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selectedEventId, trackDistance])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const activeIds = new Set(boats.map((boat) => boat.id))

    for (const [id, marker] of boatMarkersRef.current.entries()) {
      if (!activeIds.has(id)) {
        marker.removeFrom(map)
        boatMarkersRef.current.delete(id)
      }
    }

    for (const boat of boats) {
      if (!boat.position) continue

      const color = boatColor(boat.id)
      const icon = makeBoatIcon(
        boat.name,
        boat.position.course,
        color,
        showNames,
      )
      const marker = boatMarkersRef.current.get(boat.id)

      const popup = `
        <strong>${escapeHtml(boat.name)}</strong><br>
        Velocidade: ${Number(boat.position.speed ?? 0).toFixed(1)} kn<br>
        Rumo: ${Math.round(boat.position.course ?? 0)}°
      `

      if (marker) {
        marker.setLatLng([boat.position.latitude, boat.position.longitude])
        marker.setIcon(icon)
        marker.setPopupContent(popup)
      } else {
        const newMarker = L.marker(
          [boat.position.latitude, boat.position.longitude],
          { icon },
        ).addTo(map).bindPopup(popup)

        boatMarkersRef.current.set(boat.id, newMarker)
      }
    }

    const layer = courseLayerRef.current
    if (layer) {
      layer.clearLayers()

      if (showCourse) {
        const startLine = lines.find((line) => line.line_type === 'start')
        const finishLine = lines.find((line) => line.line_type === 'finish')

        for (const line of lines) {
          L.polyline(
            [
              [line.a_latitude, line.a_longitude],
              [line.b_latitude, line.b_longitude],
            ],
            {
              weight: 5,
              opacity: 0.95,
              dashArray: line.line_type === 'start' ? '10 5' : undefined,
            },
          )
            .addTo(layer)
            .bindTooltip(
              line.line_type === 'start' ? 'Linha de largada' : 'Linha de chegada',
            )
        }

        const routeLatLngs: [number, number][] = []

        if (startLine) routeLatLngs.push(lineMidpoint(startLine))

        routeLatLngs.push(
          ...course.map(
            (point) => [point.latitude, point.longitude] as [number, number],
          ),
        )

        if (finishLine) routeLatLngs.push(lineMidpoint(finishLine))

        if (routeLatLngs.length > 1) {
          L.polyline(routeLatLngs, {
            weight: 3,
            opacity: 0.75,
            dashArray: '8 8',
          }).addTo(layer)
        }

        for (const point of course) {
          L.circleMarker([point.latitude, point.longitude], {
            radius: point.point_type === 'waypoint' ? 5 : 8,
            weight: 2,
            fillOpacity: 1,
          })
            .addTo(layer)
            .bindTooltip(point.name || labelPointType(point.point_type), {
              permanent: false,
              direction: 'top',
            })
        }
      }
    }

    const trackLayer = trackLayerRef.current
    if (trackLayer) {
      trackLayer.clearLayers()

      if (trackDistance > 0) {
        for (const track of tracks) {
          if (track.positions.length < 2) continue

          L.polyline(
            track.positions.map(
              (position) => [
                position.latitude,
                position.longitude,
              ] as [number, number],
            ),
            {
              weight: 3,
              opacity: 0.62,
              color: boatColor(track.deviceId),
            },
          ).addTo(trackLayer)
        }
      }
    }

    const fitKey = `${selectedEventId}:${boats.map((b) => b.id).sort().join(',')}:${course.length}:${lines.length}`

    if (lastFitKeyRef.current !== fitKey) {
      const points: L.LatLngExpression[] = []

      for (const boat of boats) {
        if (boat.position) points.push([boat.position.latitude, boat.position.longitude])
      }

      for (const point of course) {
        points.push([point.latitude, point.longitude])
      }

      for (const line of lines) {
        points.push([line.a_latitude, line.a_longitude])
        points.push([line.b_latitude, line.b_longitude])
      }

      if (points.length === 1) {
        map.setView(points[0], 13)
      } else if (points.length > 1) {
        map.fitBounds(L.latLngBounds(points), {
          padding: [50, 50],
          maxZoom: 13,
        })
      }

      lastFitKeyRef.current = fitKey
    }
  }, [
    boats,
    course,
    lines,
    selectedEventId,
    showCourse,
    showNames,
    trackDistance,
    tracks,
  ])

  function showAll() {
    const map = mapRef.current
    if (!map) return

    const points: L.LatLngExpression[] = []

    for (const boat of boats) {
      if (boat.position) points.push([boat.position.latitude, boat.position.longitude])
    }

    for (const point of course) {
      points.push([point.latitude, point.longitude])
    }

    for (const line of lines) {
      points.push([line.a_latitude, line.a_longitude])
      points.push([line.b_latitude, line.b_longitude])
    }

    if (points.length === 1) map.setView(points[0], 13)
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 13 })
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
                {event.status === 'live'
                  ? `● EM DIRETO — ${event.name}`
                  : event.name}
              </option>
            ))}
          </select>
        </div>

        <div className="top-actions">
          <div className={connected ? 'connection online' : 'connection offline'}>
            <span className="status-dot" />
            {connected ? 'Traccar online' : 'Traccar offline'}
          </div>

          <button
            className="layers-button"
            onClick={() => setLayersOpen((value) => !value)}
          >
            Camadas
          </button>

          <button className="show-all-button" onClick={showAll}>
            Mostrar todos
          </button>
        </div>
      </header>

      <section className="map-container">
        <div ref={mapElementRef} className="map" />

        {layersOpen && (
          <div className="layers-panel">
            <div className="layers-title">Camadas</div>

            <label className="layer-row">
              <span>Percurso</span>
              <input
                type="checkbox"
                checked={showCourse}
                onChange={(event) => setShowCourse(event.target.checked)}
              />
            </label>

            <label className="layer-row">
              <span>Nomes dos barcos</span>
              <input
                type="checkbox"
                checked={showNames}
                onChange={(event) => setShowNames(event.target.checked)}
              />
            </label>

            <div className="layer-group">
              <div className="layer-label">Rasto dos barcos</div>

              <select
                className="layer-select"
                value={trackDistance}
                disabled={selectedEventId === 'general'}
                onChange={(event) =>
                  setTrackDistance(
                    Number(event.target.value) as 0 | 0.5 | 1 | 2,
                  )
                }
              >
                <option value={0}>Desligado</option>
                <option value={0.5}>0,5 NM</option>
                <option value={1}>1 NM</option>
                <option value={2}>2 NM</option>
              </select>

              {selectedEventId === 'general' && (
                <div className="layer-hint">
                  Seleciona uma regata para usar o rasto.
                </div>
              )}
            </div>

            <label className="layer-row">
              <span>Vento (Windy)</span>
              <input
                type="checkbox"
                checked={showWind}
                onChange={(event) => setShowWind(event.target.checked)}
              />
            </label>
          </div>
        )}

        {showWind && (
          <div className="windy-panel">
            <div className="windy-header">
              <strong>Vento</strong>
              <button
                type="button"
                className="windy-close"
                onClick={() => setShowWind(false)}
              >
                ×
              </button>
            </div>

            <iframe
              title="Windy"
              className="windy-frame"
              src="https://embed.windy.com/embed2.html?lat=38.535&lon=-28.630&detailLat=38.535&detailLon=-28.630&width=650&height=450&zoom=8&level=surface&overlay=wind&product=ecmwf&menu=&message=&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=%C2%B0C&radarRange=-1"
              loading="lazy"
            />
          </div>
        )}

        <div className="boat-counter">{boats.length} barcos ativos</div>
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
      const data = await response.json()
      setEvents(data.events ?? [])
    } catch {
      setEvents([])
    }
  }

  async function createEvent(event: React.FormEvent) {
    event.preventDefault()
    if (!eventName.trim()) return setError('Indica o nome da regata.')

    setSaving(true)
    setError(null)

    try {
      const response = await adminFetch('/admin/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: eventName.trim(),
          startTime: startTime || null,
          endTime: endTime || null,
        }),
      })

      const data = await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Erro ao criar regata')
      }

      setEventName('')
      setStartTime('')
      setEndTime('')
      await loadEvents()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Erro ao criar regata')
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
                onChange={(e) => setEventName(e.target.value)}
                placeholder="Ex.: Regata Horta - Madalena"
              />
            </label>

            <label>
              Início
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>

            <label>
              Fim / hora limite
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
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

          <div className="event-list">
            {events.map((event) => (
              <div key={event.id} className="event-row">
                <div>
                  <strong>{event.name}</strong>
                  <div className={`event-meta status-${event.status}`}>
                    {event.status === 'live'
                      ? 'Em direto'
                      : event.status === 'completed'
                        ? 'Terminada'
                        : 'Agendada'}
                  </div>
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
        </section>
      </div>

      {editingEvent && (
        <EventEditor
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onChanged={loadEvents}
        />
      )}
    </main>
  )
}

function EventEditor({
  event,
  onClose,
  onChanged,
}: {
  event: EventItem
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [tab, setTab] = useState<'general' | 'participants' | 'course'>('general')

  return (
    <div className="modal-backdrop">
      <div className="event-editor-modal">
        <div className="participants-header">
          <div>
            <div className="modal-small">EDITAR REGATA</div>
            <h2>{event.name}</h2>
          </div>

          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="tabs">
          <button className={tab === 'general' ? 'tab active' : 'tab'} onClick={() => setTab('general')}>Geral</button>
          <button className={tab === 'participants' ? 'tab active' : 'tab'} onClick={() => setTab('participants')}>Participantes</button>
          <button className={tab === 'course' ? 'tab active' : 'tab'} onClick={() => setTab('course')}>Percurso</button>
        </div>

        <div className="editor-body">
          {tab === 'general' && (
            <GeneralEditor event={event} onClose={onClose} onChanged={onChanged} />
          )}

          {tab === 'participants' && (
            <ParticipantsEditor event={event} />
          )}

          {tab === 'course' && (
            <CourseEditor event={event} />
          )}
        </div>
      </div>
    </div>
  )
}

function GeneralEditor({
  event,
  onClose,
  onChanged,
}: {
  event: EventItem
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [name, setName] = useState(event.name)
  const [startTime, setStartTime] = useState(toLocalInput(event.start_time))
  const [endTime, setEndTime] = useState(toLocalInput(event.end_time))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)

    try {
      const response = await adminFetch(
        `/admin/api/events/${encodeURIComponent(event.id)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          startTime: startTime || null,
          endTime: endTime || null,
        }),
        },
      )

      const data = await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Erro ao guardar')
      }

      await onChanged()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  async function finishNow() {
    const confirmed = window.confirm(
      `Terminar agora a regata "${event.name}"?\n\nA hora de fim será atualizada para este momento. Participantes, percurso e bóias não serão apagados.`,
    )

    if (!confirmed) return

    setSaving(true)
    setError(null)

    try {
      const response = await adminFetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/finish`,
        {
          method: 'POST',
        },
      )

      const data = await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'Erro ao terminar regata',
        )
      }

      await onChanged()
      onClose()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Erro ao terminar regata',
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const confirmed = window.confirm(
      `Eliminar a regata "${event.name}"?\n\nSerão eliminados também os participantes e o percurso desta regata. Esta ação não afeta outras regatas.`,
    )

    if (!confirmed) return

    const secondConfirm = window.confirm('Confirmar eliminação definitiva?')
    if (!secondConfirm) return

    setSaving(true)
    setError(null)

    try {
      const response = await adminFetch(
        `/admin/api/events/${encodeURIComponent(event.id)}`,
        {
          method: 'DELETE',
        },
      )

      const data = await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Erro ao eliminar')
      }

      await onChanged()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Erro ao eliminar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="general-editor">
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label>
        Início
        <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
      </label>

      <label>
        Fim / hora limite
        <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </label>

      {error && <div className="form-error">{error}</div>}

      <div className="general-actions">
        <button
          className="danger-button"
          onClick={remove}
          disabled={saving}
        >
          Eliminar regata
        </button>

        {event.status !== 'completed' && (
          <button
            className="finish-button"
            onClick={finishNow}
            disabled={saving}
          >
            Terminar regata agora
          </button>
        )}

        <button
          className="save-button"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'A guardar...' : 'Guardar alterações'}
        </button>
      </div>
    </div>
  )
}

function ParticipantsEditor({ event }: { event: EventItem }) {
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [event.id])

  async function load() {
    setLoading(true)
    setLoadError(null)
    setMessage(null)

    try {
      const [devicesResponse, participantsResponse] = await Promise.all([
        adminFetch('/admin/api/devices', {
          cache: 'no-store',
        }),
        adminFetch(
          `/admin/api/events/${encodeURIComponent(event.id)}/participants`,
          {
            cache: 'no-store',
          },
        ),
      ])

      const devicesData = await readJsonResponse(devicesResponse)
      const participantsData = await readJsonResponse(participantsResponse)

      if (!devicesResponse.ok || !devicesData.ok) {
        throw new Error(
          devicesData.error ||
            `Não foi possível carregar os barcos (${devicesResponse.status}).`,
        )
      }

      if (!participantsResponse.ok || !participantsData.ok) {
        throw new Error(
          participantsData.error ||
            `Não foi possível carregar os participantes (${participantsResponse.status}).`,
        )
      }

      setDevices(devicesData.devices ?? [])
      setSelectedIds(
        new Set(
          (participantsData.participants ?? []).map(
            (participant: any) =>
              Number(participant.traccar_device_id),
          ),
        ),
      )
    } catch (error) {
      setDevices([])
      setSelectedIds(new Set())
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar participantes.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    setMessage(null)

    try {
      const participants = devices
        .filter((device) => selectedIds.has(device.id))
        .map((device) => ({
          traccarDeviceId: device.id,
          boatName: device.name,
        }))

      const response = await adminFetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/participants`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participants }),
        },
      )

      const data = await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'Erro ao guardar participantes',
        )
      }

      setMessage('Participantes guardados.')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Erro ao guardar participantes',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="modal-message">A carregar barcos...</div>
  }

  if (loadError) {
    return (
      <div className="admin-load-error">
        <strong>Não foi possível carregar os participantes.</strong>
        <div>{loadError}</div>

        <div className="access-help">
          Se estiveres no telemóvel, isto pode indicar que o Cloudflare Access
          está a proteger /admin e /admin/* como aplicações diferentes.
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={load}
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="participants-toolbar">
        <span>{selectedIds.size} selecionados</span>

        <button
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
          className="secondary-button"
          onClick={() => setSelectedIds(new Set())}
        >
          Limpar
        </button>
      </div>

      <div className="devices-list">
        {devices.length === 0 ? (
          <div className="empty-state">
            Nenhum barco recebido do Traccar.
          </div>
        ) : (
          devices.map((device) => (
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
                onChange={() => {
                  setSelectedIds((current) => {
                    const next = new Set(current)

                    if (next.has(device.id)) {
                      next.delete(device.id)
                    } else {
                      next.add(device.id)
                    }

                    return next
                  })
                }}
              />

              <div className="device-info">
                <strong>{device.name}</strong>
                <span>ID Traccar: {device.id}</span>
              </div>
            </label>
          ))
        )}
      </div>

      {message && <div className="inline-message">{message}</div>}

      <div className="participants-actions">
        <button
          className="save-button"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'A guardar...' : 'Guardar participantes'}
        </button>
      </div>
    </>
  )
}

function CourseEditor({ event }: { event: EventItem }) {
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  const [points, setPoints] = useState<CoursePoint[]>([])
  const [lines, setLines] = useState<CourseLine[]>([])
  const [library, setLibrary] = useState<LibraryBuoy[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [newType, setNewType] = useState<CoursePoint['point_type']>('buoy')

  const [lineTool, setLineTool] = useState<'start' | 'finish' | null>(null)
  const [pendingLineA, setPendingLineA] = useState<L.LatLng | null>(null)

  const [coordName, setCoordName] = useState('')
  const [coordLat, setCoordLat] = useState('')
  const [coordLon, setCoordLon] = useState('')

  const [libraryName, setLibraryName] = useState('')
  const [libraryLat, setLibraryLat] = useState('')
  const [libraryLon, setLibraryLon] = useState('')

  useEffect(() => {
    Promise.all([
      adminFetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/course`,
        { cache: 'no-store' },
      ),
      adminFetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/course-lines`,
        { cache: 'no-store' },
      ),
      adminFetch(
        '/admin/api/buoy-library',
        { cache: 'no-store' },
      ),
    ])
      .then(async ([courseResponse, linesResponse, libraryResponse]) => {
        const courseData = await readJsonResponse(courseResponse)
        const linesData = await readJsonResponse(linesResponse)
        const libraryData = await readJsonResponse(libraryResponse)

        if (!courseResponse.ok || !courseData.ok) {
          throw new Error(
            courseData.error ||
              `Erro ao carregar percurso (${courseResponse.status}).`,
          )
        }

        if (!linesResponse.ok || !linesData.ok) {
          throw new Error(
            linesData.error ||
              `Erro ao carregar linhas (${linesResponse.status}).`,
          )
        }

        if (!libraryResponse.ok || !libraryData.ok) {
          throw new Error(
            libraryData.error ||
              `Erro ao carregar biblioteca de bóias (${libraryResponse.status}).`,
          )
        }

        setPoints(
          (courseData.points ?? [])
            .filter(
              (point: any) =>
                point.point_type === 'buoy' ||
                point.point_type === 'waypoint',
            )
            .map(normalizeCoursePoint),
        )

        setLines(
          (linesData.lines ?? []).map(normalizeCourseLine),
        )

        setLibrary(libraryData.buoys ?? [])
      })
      .catch((error) => {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Erro ao carregar percurso.',
        )
      })
  }, [event.id])

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return

    const map = L.map(mapElRef.current).setView([38.535, -28.63], 11)

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' },
    ).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onClick = (e: L.LeafletMouseEvent) => {
      if (lineTool) {
        if (!pendingLineA) {
          setPendingLineA(e.latlng)
          setMessage(
            lineTool === 'start'
              ? 'Primeiro extremo da linha de largada definido. Clica no segundo extremo.'
              : 'Primeiro extremo da linha de chegada definido. Clica no segundo extremo.',
          )
          return
        }

        const newLine: CourseLine = {
          line_type: lineTool,
          a_latitude: pendingLineA.lat,
          a_longitude: pendingLineA.lng,
          b_latitude: e.latlng.lat,
          b_longitude: e.latlng.lng,
        }

        setLines((current) => [
          ...current.filter((line) => line.line_type !== lineTool),
          newLine,
        ])

        setPendingLineA(null)
        setLineTool(null)
        setMessage('Linha definida. Podes arrastar os dois extremos para ajustar.')
        return
      }

      setPoints((current) => [
        ...current,
        {
          point_type: newType,
          name: defaultPointName(newType, current.length + 1),
          latitude: e.latlng.lat,
          longitude: e.latlng.lng,
          point_order: current.length,
        },
      ])
    }

    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [newType, lineTool, pendingLineA])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()

    const startLine = lines.find((line) => line.line_type === 'start')
    const finishLine = lines.find((line) => line.line_type === 'finish')

    for (const line of lines) {
      L.polyline(
        [
          [line.a_latitude, line.a_longitude],
          [line.b_latitude, line.b_longitude],
        ],
        {
          weight: 5,
          opacity: 0.95,
          dashArray: line.line_type === 'start' ? '10 5' : undefined,
        },
      ).addTo(layer)

      const endpointA = L.marker(
        [line.a_latitude, line.a_longitude],
        {
          draggable: true,
          icon: makeLineEndpointIcon(line.line_type, 'A'),
        },
      ).addTo(layer)

      const endpointB = L.marker(
        [line.b_latitude, line.b_longitude],
        {
          draggable: true,
          icon: makeLineEndpointIcon(line.line_type, 'B'),
        },
      ).addTo(layer)

      endpointA.on('dragend', () => {
        const p = endpointA.getLatLng()
        setLines((current) =>
          current.map((item) =>
            item.line_type === line.line_type
              ? { ...item, a_latitude: p.lat, a_longitude: p.lng }
              : item,
          ),
        )
      })

      endpointB.on('dragend', () => {
        const p = endpointB.getLatLng()
        setLines((current) =>
          current.map((item) =>
            item.line_type === line.line_type
              ? { ...item, b_latitude: p.lat, b_longitude: p.lng }
              : item,
          ),
        )
      })
    }

    const route: [number, number][] = []

    if (startLine) route.push(lineMidpoint(startLine))
    route.push(...points.map((p) => [p.latitude, p.longitude] as [number, number]))
    if (finishLine) route.push(lineMidpoint(finishLine))

    if (route.length > 1) {
      L.polyline(route, {
        weight: 3,
        dashArray: '8 8',
        opacity: 0.75,
      }).addTo(layer)
    }

    points.forEach((point, index) => {
      const marker = L.marker([point.latitude, point.longitude], {
        draggable: true,
        icon: makeCourseIcon(point, index),
      }).addTo(layer)

      marker.on('dragend', () => {
        const latlng = marker.getLatLng()

        setPoints((current) =>
          current.map((p, i) =>
            i === index
              ? { ...p, latitude: latlng.lat, longitude: latlng.lng }
              : p,
          ),
        )
      })
    })

    if (pendingLineA) {
      L.circleMarker([pendingLineA.lat, pendingLineA.lng], {
        radius: 7,
        weight: 3,
        fillOpacity: 1,
      }).addTo(layer)
    }

    const boundsPoints: [number, number][] = []

    for (const point of points) {
      boundsPoints.push([point.latitude, point.longitude])
    }

    for (const line of lines) {
      boundsPoints.push([line.a_latitude, line.a_longitude])
      boundsPoints.push([line.b_latitude, line.b_longitude])
    }

    if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 14)
    } else if (boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), {
        padding: [40, 40],
        maxZoom: 14,
      })
    }
  }, [points, lines, pendingLineA])

  function startLineDrawing(type: 'start' | 'finish') {
    setLineTool(type)
    setPendingLineA(null)
    setMessage(
      type === 'start'
        ? 'Clica no primeiro extremo da linha de largada.'
        : 'Clica no primeiro extremo da linha de chegada.',
    )
  }

  function addByCoordinates() {
    const lat = parseBoatingCoordinate(coordLat, 'lat')
    const lon = parseBoatingCoordinate(coordLon, 'lon')

    if (lat === null || lon === null) {
      setMessage(
        "Coordenadas inválidas. Exemplo: 38º33.457'N e 028º37.123'W.",
      )
      return
    }

    setPoints((current) => [
      ...current,
      {
        point_type: newType,
        name: coordName.trim() || defaultPointName(newType, current.length + 1),
        latitude: lat,
        longitude: lon,
        point_order: current.length,
      },
    ])

    setCoordName('')
    setCoordLat('')
    setCoordLon('')
    setMessage(null)
  }

  function addFromLibrary(buoy: LibraryBuoy) {
    setPoints((current) => [
      ...current,
      {
        point_type: 'buoy',
        name: buoy.name,
        latitude: buoy.latitude,
        longitude: buoy.longitude,
        point_order: current.length,
      },
    ])
  }

  async function saveCourse() {
    setSaving(true)
    setMessage(null)

    try {
      const pointPayload = points.map((point, index) => ({
        pointType: point.point_type,
        name: point.name,
        latitude: point.latitude,
        longitude: point.longitude,
        pointOrder: index,
      }))

      const linePayload = lines.map((line) => ({
        lineType: line.line_type,
        aLatitude: line.a_latitude,
        aLongitude: line.a_longitude,
        bLatitude: line.b_latitude,
        bLongitude: line.b_longitude,
      }))

      const [pointsResponse, linesResponse] = await Promise.all([
        adminFetch(
          `/admin/api/events/${encodeURIComponent(event.id)}/course`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ points: pointPayload }),
          },
        ),
        adminFetch(
          `/admin/api/events/${encodeURIComponent(event.id)}/course-lines`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lines: linePayload }),
          },
        ),
      ])

      const pointsData = await readJsonResponse(pointsResponse)
      const linesData = await readJsonResponse(linesResponse)

      if (!pointsResponse.ok || !pointsData.ok) {
        throw new Error(pointsData.error || 'Erro ao guardar percurso')
      }

      if (!linesResponse.ok || !linesData.ok) {
        throw new Error(linesData.error || 'Erro ao guardar linhas')
      }

      setPoints((current) =>
        current.map((point, index) => ({ ...point, point_order: index })),
      )

      setMessage('Percurso e linhas guardados.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao guardar percurso')
    } finally {
      setSaving(false)
    }
  }

  async function createLibraryBuoy() {
    const lat = parseBoatingCoordinate(libraryLat, 'lat')
    const lon = parseBoatingCoordinate(libraryLon, 'lon')

    if (!libraryName.trim() || lat === null || lon === null) {
      setMessage(
        "Preenche o nome e coordenadas válidas. Exemplo: 38º33.457'N e 028º37.123'W.",
      )
      return
    }

    const response = await adminFetch('/admin/api/buoy-library', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: libraryName.trim(),
        latitude: lat,
        longitude: lon,
      }),
    })

    const data = await readJsonResponse(response)

    if (!response.ok || !data.ok) {
      setMessage(data.error || 'Erro ao criar bóia na biblioteca')
      return
    }

    const refreshedResponse = await adminFetch(
      '/admin/api/buoy-library',
      { cache: 'no-store' },
    )

    const refreshed = await readJsonResponse(refreshedResponse)

    setLibrary(refreshed.buoys ?? [])
    setLibraryName('')
    setLibraryLat('')
    setLibraryLon('')
    setMessage('Bóia guardada na biblioteca.')
  }

  async function deleteLibraryBuoy(id: number) {
    if (!window.confirm('Eliminar esta bóia da biblioteca? Percursos já criados não serão alterados.')) return

    const response = await adminFetch(
      `/admin/api/buoy-library/${id}`,
      {
        method: 'DELETE',
      },
    )

    const data = await readJsonResponse(response)

    if (!response.ok || !data.ok) {
      setMessage(data.error || 'Erro ao eliminar bóia da biblioteca.')
      return
    }

    setLibrary((current) => current.filter((b) => b.id !== id))
  }

  function movePoint(index: number, direction: -1 | 1) {
    setPoints((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current

      const copy = [...current]
      const [item] = copy.splice(index, 1)
      copy.splice(target, 0, item)

      return copy.map((point, i) => ({
        ...point,
        point_order: i,
      }))
    })
  }

  return (
    <div className="course-editor">
      <section className="course-panel line-builder-panel">
        <h3>Linhas de largada e chegada</h3>

        <p className="panel-note">
          Cada linha é definida por dois extremos. Clica no primeiro ponto e depois no segundo.
          Depois podes arrastar cada extremo.
        </p>

        <div className="line-buttons">
          <button
            className={lineTool === 'start' ? 'line-tool active' : 'line-tool'}
            onClick={() => startLineDrawing('start')}
          >
            Definir linha de largada
          </button>

          <button
            className={lineTool === 'finish' ? 'line-tool active' : 'line-tool'}
            onClick={() => startLineDrawing('finish')}
          >
            Definir linha de chegada
          </button>

          {lines.some((line) => line.line_type === 'start') && (
            <button
              className="secondary-button"
              onClick={() =>
                setLines((current) =>
                  current.filter((line) => line.line_type !== 'start'),
                )
              }
            >
              Remover largada
            </button>
          )}

          {lines.some((line) => line.line_type === 'finish') && (
            <button
              className="secondary-button"
              onClick={() =>
                setLines((current) =>
                  current.filter((line) => line.line_type !== 'finish'),
                )
              }
            >
              Remover chegada
            </button>
          )}
        </div>
      </section>

      <div className="course-toolbar">
        <div>
          <label>Adicionar marca</label>
          <select
            value={newType}
            onChange={(e) =>
              setNewType(e.target.value as CoursePoint['point_type'])
            }
            disabled={lineTool !== null}
          >
            <option value="buoy">Bóia</option>
            <option value="waypoint">Waypoint</option>
          </select>
        </div>

        <div className="course-help">
          Fora do modo de criação de linha, clica no mapa para adicionar a marca selecionada.
        </div>
      </div>

      <div className="course-map" ref={mapElRef} />

      <div className="course-grid">
        <section className="course-panel">
          <h3>Adicionar marca por coordenadas</h3>

          <input
            placeholder="Nome"
            value={coordName}
            onChange={(e) => setCoordName(e.target.value)}
          />

          <div className="coordinate-row">
            <input
              placeholder="38º33.457'N"
              value={coordLat}
              onChange={(e) => setCoordLat(e.target.value)}
            />
            <input
              placeholder="028º37.123'W"
              value={coordLon}
              onChange={(e) => setCoordLon(e.target.value)}
            />
          </div>

          <button className="secondary-button" onClick={addByCoordinates}>
            Adicionar ao percurso
          </button>
        </section>

        <section className="course-panel">
          <h3>Biblioteca de bóias</h3>

          <div className="library-list">
            {library.length === 0 && (
              <div className="empty-state compact">
                Sem bóias na biblioteca.
              </div>
            )}

            {library.map((buoy) => (
              <div className="library-row" key={buoy.id}>
                <div>
                  <strong>{buoy.name}</strong>
                  <span>
                    {formatBoatingCoordinate(buoy.latitude, 'lat')},{' '}
                    {formatBoatingCoordinate(buoy.longitude, 'lon')}
                  </span>
                </div>

                <div className="library-actions">
                  <button
                    className="secondary-button"
                    onClick={() => addFromLibrary(buoy)}
                  >
                    Copiar para percurso
                  </button>

                  <button
                    className="icon-danger"
                    onClick={() => deleteLibraryBuoy(buoy.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="library-create">
            <input
              placeholder="Nome da bóia"
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
            />

            <div className="coordinate-row">
              <input
                placeholder="38º33.457'N"
                value={libraryLat}
                onChange={(e) => setLibraryLat(e.target.value)}
              />
              <input
                placeholder="028º37.123'W"
                value={libraryLon}
                onChange={(e) => setLibraryLon(e.target.value)}
              />
            </div>

            <button
              className="secondary-button"
              onClick={createLibraryBuoy}
            >
              Guardar na biblioteca
            </button>
          </div>
        </section>
      </div>

      <section className="course-panel course-points-panel">
        <h3>Marcas do percurso</h3>

        {points.length === 0 ? (
          <div className="empty-state">Ainda não existem bóias ou waypoints.</div>
        ) : (
          <div className="course-points-list">
            {points.map((point, index) => (
              <div
                className="course-point-row"
                key={`${index}-${point.latitude}-${point.longitude}`}
              >
                <div className="point-order">{index + 1}</div>

                <div className="point-info">
                  <strong>
                    {point.name || labelPointType(point.point_type)}
                  </strong>
                  <span>
                    {labelPointType(point.point_type)} ·{' '}
                    {formatBoatingCoordinate(point.latitude, 'lat')},{' '}
                    {formatBoatingCoordinate(point.longitude, 'lon')}
                  </span>
                </div>

                <div className="point-actions">
                  <button
                    className="tiny-button"
                    onClick={() => movePoint(index, -1)}
                  >
                    ↑
                  </button>

                  <button
                    className="tiny-button"
                    onClick={() => movePoint(index, 1)}
                  >
                    ↓
                  </button>

                  <button
                    className="tiny-button danger"
                    onClick={() =>
                      setPoints((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {message && <div className="inline-message">{message}</div>}

      <div className="participants-actions">
        <button
          className="save-button"
          onClick={saveCourse}
          disabled={saving}
        >
          {saving ? 'A guardar...' : 'Guardar percurso'}
        </button>
      </div>
    </div>
  )
}

function makeBoatIcon(
  name: string,
  course: number,
  color: string,
  showName: boolean,
) {
  return L.divIcon({
    className: 'boat-marker-wrapper',
    html: `
      <div class="boat-marker">
        <div
          class="boat-svg-wrap"
          style="transform: rotate(${course || 0}deg)"
        >
          <svg
            width="42"
            height="58"
            viewBox="0 0 42 58"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <!-- casco visto de cima -->
            <path
              d="M21 3
                 C16 10 14 19 13 31
                 L14 46
                 Q14.5 52 21 55
                 Q27.5 52 28 46
                 L29 31
                 C28 19 26 10 21 3 Z"
              fill="${color}"
              stroke="white"
              stroke-width="2.2"
              stroke-linejoin="round"
            />

            <!-- mastro -->
            <line
              x1="21"
              y1="8"
              x2="21"
              y2="47"
              stroke="#ffffff"
              stroke-width="1.7"
              stroke-linecap="round"
            />

            <!-- vela principal -->
            <path
              d="M19.5 11 L8 36 L19.5 32 Z"
              fill="${color}"
              stroke="white"
              stroke-width="1.5"
              stroke-linejoin="round"
            />

            <!-- genoa / vela de proa -->
            <path
              d="M22.5 14 L34 33 L22.5 30 Z"
              fill="${color}"
              fill-opacity="0.82"
              stroke="white"
              stroke-width="1.5"
              stroke-linejoin="round"
            />

            <!-- cockpit -->
            <rect
              x="17.5"
              y="39"
              width="7"
              height="8"
              rx="2.5"
              fill="rgba(255,255,255,.75)"
            />
          </svg>
        </div>

        ${showName
          ? `<div class="boat-name">${escapeHtml(name)}</div>`
          : ''}
      </div>
    `,
    iconSize: [132, 78],
    iconAnchor: [66, 28],
  })
}

function makeCourseIcon(point: CoursePoint, index: number) {
  const label = escapeHtml(point.name || labelPointType(point.point_type))

  return L.divIcon({
    className: 'course-marker-wrapper',
    html: `
      <div class="course-marker ${point.point_type}">
        <span>${index + 1}</span>
      </div>
      <div class="course-marker-label">${label}</div>
    `,
    iconSize: [130, 48],
    iconAnchor: [18, 18],
  })
}

function boatColor(id: number) {
  return BOAT_COLORS[Math.abs(id) % BOAT_COLORS.length]
}

function makeLineEndpointIcon(
  type: 'start' | 'finish',
  endpoint: 'A' | 'B',
) {
  return L.divIcon({
    className: 'line-endpoint-wrapper',
    html: `
      <div class="line-endpoint ${type}">
        ${endpoint}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function lineMidpoint(line: CourseLine): [number, number] {
  return [
    (line.a_latitude + line.b_latitude) / 2,
    (line.a_longitude + line.b_longitude) / 2,
  ]
}

function normalizeCourseLine(line: any): CourseLine {
  return {
    id: line.id,
    event_id: line.event_id,
    line_type: line.line_type,
    a_latitude: Number(line.a_latitude),
    a_longitude: Number(line.a_longitude),
    b_latitude: Number(line.b_latitude),
    b_longitude: Number(line.b_longitude),
  }
}

function normalizeCoursePoint(point: any): CoursePoint {
  return {
    id: point.id,
    event_id: point.event_id,
    point_type: point.point_type,
    name: point.name,
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    point_order: Number(point.point_order),
  }
}

function labelPointType(type: CoursePoint['point_type']) {
  if (type === 'waypoint') return 'Waypoint'
  return 'Bóia'
}

function defaultPointName(type: CoursePoint['point_type'], index: number) {
  if (type === 'waypoint') return `Waypoint ${index}`
  return `Bóia ${index}`
}

function parseBoatingCoordinate(
  rawValue: string,
  axis: 'lat' | 'lon',
): number | null {
  const value = rawValue.trim().toUpperCase()

  if (!value) return null

  // Mantém compatibilidade com coordenadas decimais.
  const decimal = Number(value.replace(',', '.'))
  if (Number.isFinite(decimal)) {
    const max = axis === 'lat' ? 90 : 180
    return Math.abs(decimal) <= max ? decimal : null
  }

  // Formato de graus e minutos decimais usado no Boating:
  // 38º33.457'N   /   028º37.123'W
  const match = value.match(
    /^\s*(\d{1,3})\s*[º°]\s*(\d{1,2}(?:[.,]\d+)?)\s*['’′]?\s*([NSEW])\s*$/,
  )

  if (!match) return null

  const degrees = Number(match[1])
  const minutes = Number(match[2].replace(',', '.'))
  const hemisphere = match[3]

  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null
  if (minutes < 0 || minutes >= 60) return null

  if (axis === 'lat') {
    if (hemisphere !== 'N' && hemisphere !== 'S') return null
    if (degrees > 90) return null
  } else {
    if (hemisphere !== 'E' && hemisphere !== 'W') return null
    if (degrees > 180) return null
  }

  let decimalDegrees = degrees + minutes / 60

  if (hemisphere === 'S' || hemisphere === 'W') {
    decimalDegrees *= -1
  }

  return decimalDegrees
}

function formatBoatingCoordinate(
  value: number,
  axis: 'lat' | 'lon',
) {
  const absolute = Math.abs(value)
  const degrees = Math.floor(absolute)
  const minutes = (absolute - degrees) * 60

  const hemisphere =
    axis === 'lat'
      ? value >= 0 ? 'N' : 'S'
      : value >= 0 ? 'E' : 'W'

  const degreeWidth = axis === 'lat' ? 2 : 3
  const degreesText = String(degrees).padStart(degreeWidth, '0')
  const minutesText = minutes.toFixed(3).padStart(6, '0')

  return `${degreesText}º${minutesText}'${hemisphere}`
}

async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    cache: init.cache ?? 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const contentType =
    response.headers.get('content-type') ?? ''

  if (
    response.redirected ||
    contentType.includes('text/html')
  ) {
    const responseUrl = response.url || ''

    if (
      responseUrl.includes('/cdn-cgi/access') ||
      contentType.includes('text/html')
    ) {
      throw new Error(
        'A autenticação do Cloudflare Access não foi aceite para esta operação. A configuração do Access deve proteger /admin e /admin/* na mesma aplicação.',
      )
    }
  }

  return response
}

async function readJsonResponse(
  response: Response,
): Promise<any> {
  const text = await response.text()

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `O servidor devolveu uma resposta inesperada (${response.status}).`,
    )
  }
}

function toLocalInput(value: string | null) {
  if (!value) return ''
  return value.length >= 16 ? value.slice(0, 16) : value
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
