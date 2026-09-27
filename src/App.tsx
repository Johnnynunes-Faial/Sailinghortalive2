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
  point_type: 'start' | 'buoy' | 'waypoint' | 'finish'
  name: string | null
  latitude: number
  longitude: number
  point_order: number
}

type LiveResponse = {
  ok: boolean
  updatedAt: string
  boats: Boat[]
  course?: CoursePoint[]
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
  const lastFitKeyRef = useRef('')

  const [boats, setBoats] = useState<Boat[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedEventId, setSelectedEventId] = useState('general')
  const [connected, setConnected] = useState(false)
  const [course, setCourse] = useState<CoursePoint[]>([])

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

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    fetch('/api/events', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setEvents(data.events ?? []))
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
        setConnected(data.ok === true)
      } catch {
        if (active) {
          setConnected(false)
          setBoats([])
          setCourse([])
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
      const icon = makeBoatIcon(boat.name, boat.position.course, color)
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

      if (course.length > 0) {
        const latLngs = course.map((point) => [point.latitude, point.longitude] as [number, number])

        L.polyline(latLngs, {
          weight: 3,
          opacity: 0.85,
          dashArray: '8 8',
        }).addTo(layer)

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

    const fitKey = `${selectedEventId}:${boats.map((b) => b.id).sort().join(',')}:${course.length}`

    if (lastFitKeyRef.current !== fitKey) {
      const points: L.LatLngExpression[] = []

      for (const boat of boats) {
        if (boat.position) points.push([boat.position.latitude, boat.position.longitude])
      }

      for (const point of course) {
        points.push([point.latitude, point.longitude])
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
  }, [boats, course, selectedEventId])

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

          <button className="show-all-button" onClick={showAll}>
            Mostrar todos
          </button>
        </div>
      </header>

      <section className="map-container">
        <div ref={mapElementRef} className="map" />
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

      const data = await response.json()

      if (!response.ok || !data.ok) throw new Error(data.error || 'Erro ao criar regata')

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
      const response = await fetch(`/admin/api/events/${encodeURIComponent(event.id)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          startTime: startTime || null,
          endTime: endTime || null,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Erro ao guardar')

      await onChanged()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Erro ao guardar')
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
      const response = await fetch(`/admin/api/events/${encodeURIComponent(event.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })

      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Erro ao eliminar')

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
        <button className="danger-button" onClick={remove} disabled={saving}>Eliminar regata</button>
        <button className="save-button" onClick={save} disabled={saving}>{saving ? 'A guardar...' : 'Guardar alterações'}</button>
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

  useEffect(() => {
    load()
  }, [event.id])

  async function load() {
    setLoading(true)

    try {
      const [devicesResponse, participantsResponse] = await Promise.all([
        fetch('/admin/api/devices', {
          credentials: 'same-origin',
          cache: 'no-store',
        }),
        fetch(`/admin/api/events/${encodeURIComponent(event.id)}/participants`, {
          credentials: 'same-origin',
          cache: 'no-store',
        }),
      ])

      const devicesData = await devicesResponse.json()
      const participantsData = await participantsResponse.json()

      setDevices(devicesData.devices ?? [])
      setSelectedIds(
        new Set(
          (participantsData.participants ?? []).map(
            (participant: any) => Number(participant.traccar_device_id),
          ),
        ),
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

      const response = await fetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/participants`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participants }),
        },
      )

      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Erro')

      setMessage('Participantes guardados.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="modal-message">A carregar barcos...</div>

  return (
    <>
      <div className="participants-toolbar">
        <span>{selectedIds.size} selecionados</span>
        <button className="secondary-button" onClick={() => setSelectedIds(new Set(devices.map((d) => d.id)))}>Selecionar todos</button>
        <button className="secondary-button" onClick={() => setSelectedIds(new Set())}>Limpar</button>
      </div>

      <div className="devices-list">
        {devices.map((device) => (
          <label
            key={device.id}
            className={selectedIds.has(device.id) ? 'device-row selected' : 'device-row'}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(device.id)}
              onChange={() => {
                setSelectedIds((current) => {
                  const next = new Set(current)
                  if (next.has(device.id)) next.delete(device.id)
                  else next.add(device.id)
                  return next
                })
              }}
            />
            <div className="device-info">
              <strong>{device.name}</strong>
              <span>ID Traccar: {device.id}</span>
            </div>
          </label>
        ))}
      </div>

      {message && <div className="inline-message">{message}</div>}

      <div className="participants-actions">
        <button className="save-button" onClick={save} disabled={saving}>
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
  const [library, setLibrary] = useState<LibraryBuoy[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [newType, setNewType] = useState<CoursePoint['point_type']>('buoy')
  const [coordName, setCoordName] = useState('')
  const [coordLat, setCoordLat] = useState('')
  const [coordLon, setCoordLon] = useState('')
  const [libraryName, setLibraryName] = useState('')
  const [libraryLat, setLibraryLat] = useState('')
  const [libraryLon, setLibraryLon] = useState('')

  useEffect(() => {
    Promise.all([
      fetch(`/admin/api/events/${encodeURIComponent(event.id)}/course`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }).then((r) => r.json()),
      fetch('/admin/api/buoy-library', {
        credentials: 'same-origin',
        cache: 'no-store',
      }).then((r) => r.json()),
    ]).then(([courseData, libraryData]) => {
      setPoints((courseData.points ?? []).map(normalizeCoursePoint))
      setLibrary(libraryData.buoys ?? [])
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

    map.on('click', (e) => {
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
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [newType])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()

    if (points.length > 1) {
      L.polyline(
        points.map((p) => [p.latitude, p.longitude] as [number, number]),
        {
          weight: 3,
          dashArray: '8 8',
          opacity: 0.9,
        },
      ).addTo(layer)
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

    if (points.length > 0) {
      const bounds = L.latLngBounds(
        points.map((p) => [p.latitude, p.longitude] as [number, number]),
      )
      if (points.length === 1) map.setView(bounds.getCenter(), 14)
      else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    }
  }, [points])

  function addByCoordinates() {
    const lat = Number(coordLat.replace(',', '.'))
    const lon = Number(coordLon.replace(',', '.'))

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setMessage('Coordenadas inválidas.')
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
      const payload = points.map((point, index) => ({
        pointType: point.point_type,
        name: point.name,
        latitude: point.latitude,
        longitude: point.longitude,
        pointOrder: index,
      }))

      const response = await fetch(
        `/admin/api/events/${encodeURIComponent(event.id)}/course`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ points: payload }),
        },
      )

      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Erro ao guardar')

      setPoints((current) =>
        current.map((point, index) => ({ ...point, point_order: index })),
      )
      setMessage('Percurso guardado.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao guardar percurso')
    } finally {
      setSaving(false)
    }
  }

  async function createLibraryBuoy() {
    const lat = Number(libraryLat.replace(',', '.'))
    const lon = Number(libraryLon.replace(',', '.'))

    if (!libraryName.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setMessage('Preenche nome e coordenadas válidas para a biblioteca.')
      return
    }

    const response = await fetch('/admin/api/buoy-library', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: libraryName.trim(),
        latitude: lat,
        longitude: lon,
      }),
    })

    const data = await response.json()
    if (!response.ok || !data.ok) {
      setMessage(data.error || 'Erro ao criar bóia na biblioteca')
      return
    }

    const refreshed = await fetch('/admin/api/buoy-library', {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then((r) => r.json())

    setLibrary(refreshed.buoys ?? [])
    setLibraryName('')
    setLibraryLat('')
    setLibraryLon('')
    setMessage('Bóia guardada na biblioteca.')
  }

  async function deleteLibraryBuoy(id: number) {
    if (!window.confirm('Eliminar esta bóia da biblioteca? Percursos já criados não serão alterados.')) return

    await fetch(`/admin/api/buoy-library/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })

    setLibrary((current) => current.filter((b) => b.id !== id))
  }

  function movePoint(index: number, direction: -1 | 1) {
    setPoints((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current

      const copy = [...current]
      const [item] = copy.splice(index, 1)
      copy.splice(target, 0, item)
      return copy.map((point, i) => ({ ...point, point_order: i }))
    })
  }

  return (
    <div className="course-editor">
      <div className="course-toolbar">
        <div>
          <label>Tipo de ponto</label>
          <select value={newType} onChange={(e) => setNewType(e.target.value as CoursePoint['point_type'])}>
            <option value="start">Partida</option>
            <option value="buoy">Bóia</option>
            <option value="waypoint">Waypoint</option>
            <option value="finish">Chegada</option>
          </select>
        </div>

        <div className="course-help">
          Clica no mapa para adicionar o tipo selecionado. Depois podes arrastar o ponto.
        </div>
      </div>

      <div className="course-map" ref={mapElRef} />

      <div className="course-grid">
        <section className="course-panel">
          <h3>Adicionar por coordenadas</h3>

          <input
            placeholder="Nome"
            value={coordName}
            onChange={(e) => setCoordName(e.target.value)}
          />

          <div className="coordinate-row">
            <input
              placeholder="Latitude"
              value={coordLat}
              onChange={(e) => setCoordLat(e.target.value)}
            />
            <input
              placeholder="Longitude"
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
            {library.length === 0 && <div className="empty-state compact">Sem bóias na biblioteca.</div>}

            {library.map((buoy) => (
              <div className="library-row" key={buoy.id}>
                <div>
                  <strong>{buoy.name}</strong>
                  <span>{buoy.latitude.toFixed(6)}, {buoy.longitude.toFixed(6)}</span>
                </div>

                <div className="library-actions">
                  <button className="secondary-button" onClick={() => addFromLibrary(buoy)}>Copiar para percurso</button>
                  <button className="icon-danger" onClick={() => deleteLibraryBuoy(buoy.id)}>×</button>
                </div>
              </div>
            ))}
          </div>

          <div className="library-create">
            <input placeholder="Nome da bóia" value={libraryName} onChange={(e) => setLibraryName(e.target.value)} />
            <div className="coordinate-row">
              <input placeholder="Latitude" value={libraryLat} onChange={(e) => setLibraryLat(e.target.value)} />
              <input placeholder="Longitude" value={libraryLon} onChange={(e) => setLibraryLon(e.target.value)} />
            </div>
            <button className="secondary-button" onClick={createLibraryBuoy}>Guardar na biblioteca</button>
          </div>
        </section>
      </div>

      <section className="course-panel course-points-panel">
        <h3>Pontos do percurso</h3>

        {points.length === 0 ? (
          <div className="empty-state">Ainda não existem pontos.</div>
        ) : (
          <div className="course-points-list">
            {points.map((point, index) => (
              <div className="course-point-row" key={`${index}-${point.latitude}-${point.longitude}`}>
                <div className="point-order">{index + 1}</div>

                <div className="point-info">
                  <strong>{point.name || labelPointType(point.point_type)}</strong>
                  <span>{labelPointType(point.point_type)} · {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</span>
                </div>

                <div className="point-actions">
                  <button className="tiny-button" onClick={() => movePoint(index, -1)}>↑</button>
                  <button className="tiny-button" onClick={() => movePoint(index, 1)}>↓</button>
                  <button
                    className="tiny-button danger"
                    onClick={() => setPoints((current) => current.filter((_, i) => i !== index))}
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
        <button className="save-button" onClick={saveCourse} disabled={saving}>
          {saving ? 'A guardar...' : 'Guardar percurso'}
        </button>
      </div>
    </div>
  )
}

function makeBoatIcon(name: string, course: number, color: string) {
  return L.divIcon({
    className: 'boat-marker-wrapper',
    html: `
      <div class="boat-marker">
        <div class="boat-svg-wrap" style="transform: rotate(${course || 0}deg)">
          <svg width="30" height="46" viewBox="0 0 30 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M15 1 L24 34 L15 44 L6 34 Z" fill="${color}" stroke="white" stroke-width="2"/>
            <path d="M15 5 L15 39" stroke="rgba(255,255,255,.8)" stroke-width="1.5"/>
            <path d="M15 8 L22 31 L15 27 Z" fill="rgba(255,255,255,.42)"/>
            <path d="M15 8 L8 31 L15 27 Z" fill="rgba(255,255,255,.18)"/>
          </svg>
        </div>
        <div class="boat-name">${escapeHtml(name)}</div>
      </div>
    `,
    iconSize: [130, 66],
    iconAnchor: [65, 24],
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
  if (type === 'start') return 'Partida'
  if (type === 'finish') return 'Chegada'
  if (type === 'waypoint') return 'Waypoint'
  return 'Bóia'
}

function defaultPointName(type: CoursePoint['point_type'], index: number) {
  if (type === 'start') return 'Partida'
  if (type === 'finish') return 'Chegada'
  if (type === 'waypoint') return `Waypoint ${index}`
  return `Bóia ${index}`
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
