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


type ReplayPosition = {
  latitude: number
  longitude: number
  speed: number
  course: number
  fixTime: string | null
}

type ReplayTrack = {
  deviceId: number
  boatName: string
  positions: ReplayPosition[]
}

type ReplayEventData = {
  ok: boolean
  event: EventItem & {
    startUtc: string
    endUtc: string
  }
  participants: Array<{
    traccar_device_id: number
    boat_name: string
  }>
  course: CoursePoint[]
  lines: CourseLine[]
  tracks: ReplayTrack[]
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
  const path = window.location.pathname

  if (path.startsWith('/replay')) {
    return <ReplayView />
  }

  if (path.startsWith('/admin/regata')) {
    return <RaceModeView />
  }

  if (path.startsWith('/admin')) {
    return <AdminView />
  }

  return <PublicLiveView />
}

function PublicLiveView() {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const boatMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const liveBoatCourseRef = useRef<Map<number, number>>(new Map())
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
        const loadedEvents = (data.events ?? []) as EventItem[]

        const visibleEvents = loadedEvents.filter(
          (event) => event.status !== 'completed',
        )

        setEvents(visibleEvents)

        const liveEvents = visibleEvents.filter(
          (event) => event.status === 'live',
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
    if (
      selectedEventId !== 'general' &&
      !events.some((event) => event.id === selectedEventId)
    ) {
      setSelectedEventId('general')
      setCourse([])
      setLines([])
      setBoats([])
      lastFitKeyRef.current = ''
    }
  }, [events, selectedEventId])

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
        liveBoatCourseRef.current.delete(id)
      }
    }

    for (const boat of boats) {
      if (!boat.position) continue

      const color = boatColor(boat.id)

      const previousCourse =
        liveBoatCourseRef.current.get(boat.id)

      const displayCourse =
        smoothDisplayCourse(
          previousCourse,
          boat.position.course,
          boat.position.speed,
        )

      liveBoatCourseRef.current.set(
        boat.id,
        displayCourse,
      )

      const icon = makeBoatIcon(
        boat.name,
        displayCourse,
        color,
        showNames,
      )

      const marker =
        boatMarkersRef.current.get(boat.id)

      const popup = `
        <strong>${escapeHtml(boat.name)}</strong><br>
        Velocidade: ${Number(boat.position.speed ?? 0).toFixed(1)} kn<br>
        Rumo GPS: ${Math.round(boat.position.course ?? 0)}°
      `

      if (marker) {
        marker.setLatLng([
          boat.position.latitude,
          boat.position.longitude,
        ])

        const markerWithState =
          marker as L.Marker & {
            __showNames?: boolean
          }

        if (
          markerWithState.__showNames !==
          showNames
        ) {
          marker.setIcon(icon)
          markerWithState.__showNames =
            showNames
        } else {
          const element =
            marker.getElement()

          const boatWrap =
            element?.querySelector(
              '.boat-svg-wrap',
            ) as HTMLElement | null

          if (boatWrap) {
            boatWrap.style.transform =
              `rotate(${displayCourse}deg)`
          }
        }

        marker.setPopupContent(popup)
      } else {
        const newMarker = L.marker(
          [
            boat.position.latitude,
            boat.position.longitude,
          ],
          {
            icon,
            riseOnHover: true,
          },
        )
          .addTo(map)
          .bindPopup(popup)

        ;(
          newMarker as L.Marker & {
            __showNames?: boolean
          }
        ).__showNames = showNames

        boatMarkersRef.current.set(
          boat.id,
          newMarker,
        )
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

          <a
            href="/replay"
            className="replay-link-button"
          >
            Replay
          </a>

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


function formatEventDateForReplay(
  value: string,
) {
  const parts =
    value.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/,
    )

  if (!parts) {
    return value
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
  ] = parts

  return `${day}/${month}/${year} · ${hour}:${minute}`
}

function ReplayView() {
  const mapElementRef =
    useRef<HTMLDivElement | null>(null)

  const mapRef =
    useRef<L.Map | null>(null)

  const courseLayerRef =
    useRef<L.LayerGroup | null>(null)

  const boatsLayerRef =
    useRef<L.LayerGroup | null>(null)

  const replayTrailLayerRef =
    useRef<L.LayerGroup | null>(null)

  const replayBoatMarkersRef =
    useRef<Map<number, L.Marker>>(
      new Map(),
    )

  const replayBoatCourseRef =
    useRef<Map<number, number>>(
      new Map(),
    )

  const [events, setEvents] =
    useState<EventItem[]>([])

  const [
    selectedEventId,
    setSelectedEventId,
  ] = useState('')

  const [replayData, setReplayData] =
    useState<ReplayEventData | null>(null)

  const [loading, setLoading] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [currentTimeMs, setCurrentTimeMs] =
    useState(0)

  const [playing, setPlaying] =
    useState(false)

  const [speed, setSpeed] =
    useState(5)

  const [showReplayNames, setShowReplayNames] =
    useState(true)

  const [showReplayTrails, setShowReplayTrails] =
    useState(true)

  const [
    selectedReplayBoatId,
    setSelectedReplayBoatId,
  ] = useState<number | null>(null)

  const animationRef =
    useRef<number | null>(null)

  const lastAnimationTsRef =
    useRef<number | null>(null)

  useEffect(() => {
    fetch('/api/events', {
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((data) => {
        const completed =
          (data.events ?? []).filter(
            (event: EventItem) =>
              event.status === 'completed',
          )

        setEvents(completed)
      })
      .catch(() => {
        setEvents([])
      })
  }, [])

  useEffect(() => {
    if (
      !mapElementRef.current ||
      mapRef.current
    ) {
      return
    }

    const map =
      L.map(mapElementRef.current)
        .setView(
          [38.535, -28.63],
          10,
        )

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; OpenStreetMap contributors',
      },
    ).addTo(map)

    mapRef.current = map
    courseLayerRef.current =
      L.layerGroup().addTo(map)

    boatsLayerRef.current =
      L.layerGroup().addTo(map)

    replayTrailLayerRef.current =
      L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!selectedEventId) {
      setReplayData(null)
      setPlaying(false)
      setSelectedReplayBoatId(null)

      courseLayerRef.current?.clearLayers()
      boatsLayerRef.current?.clearLayers()
      replayTrailLayerRef.current?.clearLayers()
      replayBoatMarkersRef.current.clear()
      replayBoatCourseRef.current.clear()

      return
    }

    loadReplay(selectedEventId)
  }, [selectedEventId])

  async function loadReplay(
    eventId: string,
  ) {
    setLoading(true)
    setError(null)
    setPlaying(false)
    setSelectedReplayBoatId(null)

    try {
      const response = await fetch(
        `/api/replay/events/${encodeURIComponent(eventId)}`,
        {
          cache: 'no-store',
        },
      )

      const data =
        await response.json() as
          ReplayEventData & {
            error?: string
          }

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
            'Erro ao carregar Replay',
        )
      }

      setReplayData(data)

      const startMs =
        new Date(
          data.event.startUtc,
        ).getTime()

      setCurrentTimeMs(startMs)
      drawReplayBase(data)
    } catch (error) {
      setReplayData(null)
      setError(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar Replay',
      )
    } finally {
      setLoading(false)
    }
  }

  function drawReplayBase(
    data: ReplayEventData,
  ) {
    const map = mapRef.current
    const courseLayer =
      courseLayerRef.current

    if (!map || !courseLayer) return

    courseLayer.clearLayers()

    for (const line of data.lines ?? []) {
      L.polyline(
        [
          [
            line.a_latitude,
            line.a_longitude,
          ],
          [
            line.b_latitude,
            line.b_longitude,
          ],
        ],
        {
          weight: 5,
          opacity: 0.95,
          dashArray:
            line.line_type === 'start'
              ? '10 5'
              : undefined,
        },
      )
        .addTo(courseLayer)
        .bindTooltip(
          line.line_type === 'start'
            ? 'Linha de largada'
            : 'Linha de chegada',
        )
    }

    const startLine =
      data.lines?.find(
        (line) =>
          line.line_type === 'start',
      )

    const finishLine =
      data.lines?.find(
        (line) =>
          line.line_type === 'finish',
      )

    const route:
      [number, number][] = []

    if (startLine) {
      route.push(
        lineMidpoint(startLine),
      )
    }

    route.push(
      ...(data.course ?? []).map(
        (point) =>
          [
            point.latitude,
            point.longitude,
          ] as [number, number],
      ),
    )

    if (finishLine) {
      route.push(
        lineMidpoint(finishLine),
      )
    }

    if (route.length > 1) {
      L.polyline(route, {
        weight: 3,
        opacity: 0.7,
        dashArray: '8 8',
      }).addTo(courseLayer)
    }

    for (
      const point
      of data.course ?? []
    ) {
      L.circleMarker(
        [
          point.latitude,
          point.longitude,
        ],
        {
          radius:
            point.point_type ===
            'waypoint'
              ? 5
              : 8,
          weight: 2,
          fillOpacity: 1,
        },
      )
        .addTo(courseLayer)
        .bindTooltip(
          point.name ||
            labelPointType(
              point.point_type,
            ),
        )
    }

    const allPoints:
      [number, number][] = []

    for (
      const track
      of data.tracks ?? []
    ) {
      for (
        const position
        of track.positions
      ) {
        allPoints.push([
          position.latitude,
          position.longitude,
        ])
      }
    }

    for (
      const point
      of data.course ?? []
    ) {
      allPoints.push([
        point.latitude,
        point.longitude,
      ])
    }

    for (
      const line
      of data.lines ?? []
    ) {
      allPoints.push([
        line.a_latitude,
        line.a_longitude,
      ])

      allPoints.push([
        line.b_latitude,
        line.b_longitude,
      ])
    }

    if (allPoints.length === 1) {
      map.setView(
        allPoints[0],
        13,
      )
    } else if (
      allPoints.length > 1
    ) {
      map.fitBounds(
        L.latLngBounds(allPoints),
        {
          padding: [45, 45],
          maxZoom: 13,
        },
      )
    }
  }

  useEffect(() => {
    const map = mapRef.current
    const boatsLayer =
      boatsLayerRef.current
    const trailLayer =
      replayTrailLayerRef.current

    if (
      !map ||
      !boatsLayer ||
      !trailLayer
    ) {
      return
    }

    trailLayer.clearLayers()

    if (!replayData) {
      for (
        const marker
        of replayBoatMarkersRef.current.values()
      ) {
        marker.removeFrom(boatsLayer)
      }

      replayBoatMarkersRef.current.clear()
      replayBoatCourseRef.current.clear()
      return
    }

    const activeIds =
      new Set<number>()

    for (
      const track
      of replayData.tracks
    ) {
      const position =
        replayPositionAtTime(
          track.positions,
          currentTimeMs,
        )

      if (!position) {
        continue
      }

      activeIds.add(track.deviceId)

      if (showReplayTrails) {
        const elapsedTrack =
          replayTrackUntilTime(
            track.positions,
            currentTimeMs,
          )

        if (elapsedTrack.length > 1) {
          L.polyline(
            elapsedTrack.map(
              (trackPoint) => [
                trackPoint.latitude,
                trackPoint.longitude,
              ] as [number, number],
            ),
            {
              color:
                boatColor(
                  track.deviceId,
                ),
              weight: 3,
              opacity: 0.62,
            },
          ).addTo(trailLayer)
        }
      }

      const previousCourse =
        replayBoatCourseRef.current.get(
          track.deviceId,
        )

      const displayCourse =
        smoothDisplayCourse(
          previousCourse,
          position.course,
          position.speed,
        )

      replayBoatCourseRef.current.set(
        track.deviceId,
        displayCourse,
      )

      const icon = makeBoatIcon(
        track.boatName,
        displayCourse,
        boatColor(
          track.deviceId,
        ),
        showReplayNames,
      )

      const existingMarker =
        replayBoatMarkersRef.current.get(
          track.deviceId,
        )

      if (existingMarker) {
        existingMarker.setLatLng([
          position.latitude,
          position.longitude,
        ])

        const markerWithState =
          existingMarker as L.Marker & {
            __showReplayNames?: boolean
          }

        if (
          markerWithState.__showReplayNames !==
          showReplayNames
        ) {
          existingMarker.setIcon(icon)
          markerWithState.__showReplayNames =
            showReplayNames
        } else {
          const element =
            existingMarker.getElement()

          const boatWrap =
            element?.querySelector(
              '.boat-svg-wrap',
            ) as HTMLElement | null

          if (boatWrap) {
            boatWrap.style.transform =
              `rotate(${displayCourse}deg)`
          }
        }
      } else {
        const marker = L.marker(
          [
            position.latitude,
            position.longitude,
          ],
          {
            icon,
            riseOnHover: true,
          },
        ).addTo(boatsLayer)

        ;(
          marker as L.Marker & {
            __showReplayNames?: boolean
          }
        ).__showReplayNames =
          showReplayNames

        marker.on('click', () => {
          setSelectedReplayBoatId(
            track.deviceId,
          )
        })

        replayBoatMarkersRef.current.set(
          track.deviceId,
          marker,
        )
      }
    }

    for (
      const [deviceId, marker]
      of replayBoatMarkersRef.current.entries()
    ) {
      if (!activeIds.has(deviceId)) {
        marker.removeFrom(boatsLayer)

        replayBoatMarkersRef.current.delete(
          deviceId,
        )

        replayBoatCourseRef.current.delete(
          deviceId,
        )
      }
    }
  }, [
    replayData,
    currentTimeMs,
    showReplayNames,
    showReplayTrails,
  ])

  useEffect(() => {
    if (!playing || !replayData) {
      if (
        animationRef.current !== null
      ) {
        cancelAnimationFrame(
          animationRef.current,
        )
        animationRef.current = null
      }

      lastAnimationTsRef.current = null
      return
    }

    const endMs =
      new Date(
        replayData.event.endUtc,
      ).getTime()

    function tick(
      timestamp: number,
    ) {
      if (
        lastAnimationTsRef.current ===
        null
      ) {
        lastAnimationTsRef.current =
          timestamp
      }

      const deltaReal =
        timestamp -
        lastAnimationTsRef.current

      lastAnimationTsRef.current =
        timestamp

      setCurrentTimeMs(
        (current) => {
          const next =
            current +
            deltaReal * speed

          if (next >= endMs) {
            setPlaying(false)
            return endMs
          }

          return next
        },
      )

      animationRef.current =
        requestAnimationFrame(tick)
    }

    animationRef.current =
      requestAnimationFrame(tick)

    return () => {
      if (
        animationRef.current !== null
      ) {
        cancelAnimationFrame(
          animationRef.current,
        )
      }

      animationRef.current = null
      lastAnimationTsRef.current = null
    }
  }, [
    playing,
    replayData,
    speed,
  ])

  const selectedReplayTrack =
    replayData?.tracks.find(
      (track) =>
        track.deviceId ===
        selectedReplayBoatId,
    ) ?? null

  const selectedReplayPosition =
    selectedReplayTrack
      ? replayPositionAtTime(
          selectedReplayTrack.positions,
          currentTimeMs,
        )
      : null

  const startMs =
    replayData
      ? new Date(
          replayData.event.startUtc,
        ).getTime()
      : 0

  const endMs =
    replayData
      ? new Date(
          replayData.event.endUtc,
        ).getTime()
      : 0

  return (
    <main className="replay-page">
      <header className="replay-header">
        <div>
          <div className="brand-small">
            REGATA LIVE
          </div>

          <h1>Histórico / Replay</h1>
        </div>

        <a
          href="/"
          className="replay-back-link"
        >
          ← Live
        </a>
      </header>

      <div className="replay-toolbar">
        {selectedEventId ? (
          <>
            <button
              type="button"
              className="replay-event-list-button"
              onClick={() =>
                setSelectedEventId('')
              }
            >
              ← Escolher outra regata
            </button>

            <div className="replay-selected-event">
              {
                events.find(
                  (event) =>
                    event.id ===
                    selectedEventId,
                )?.name
              }
            </div>
          </>
        ) : (
          <div className="replay-toolbar-title">
            Escolhe uma regata para ver o Replay
          </div>
        )}

        {replayData && (
          <div className="replay-summary">
            {
              replayData.tracks.filter(
                (track) =>
                  track.positions.length >
                  0,
              ).length
            }
            {' '}
            barcos com histórico
          </div>
        )}
      </div>

      {!selectedEventId ? (
        <section className="replay-event-picker">
          {events.length === 0 ? (
            <div className="replay-event-empty">
              Ainda não existem regatas terminadas no Histórico.
            </div>
          ) : (
            <div className="replay-event-list">
              {events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="replay-event-card"
                  onClick={() =>
                    setSelectedEventId(
                      event.id,
                    )
                  }
                >
                  <span className="replay-event-card-name">
                    {event.name}
                  </span>

                  <span className="replay-event-card-date">
                    {event.start_time
                      ? formatEventDateForReplay(
                          event.start_time,
                        )
                      : 'Data não definida'}
                  </span>

                  <span className="replay-event-card-open">
                    Abrir Replay →
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
      <section className="replay-map-container">
        <div
          ref={mapElementRef}
          className="replay-map"
        />

        {loading && (
          <div className="replay-overlay-message">
            A carregar histórico do Traccar...
          </div>
        )}

        {error && (
          <div className="replay-overlay-error">
            {error}
          </div>
        )}

        {selectedReplayTrack &&
          selectedReplayPosition && (
            <div className="replay-boat-panel">
              <button
                type="button"
                className="replay-boat-panel-close"
                onClick={() =>
                  setSelectedReplayBoatId(null)
                }
                aria-label="Fechar"
              >
                ×
              </button>

              <div className="replay-boat-panel-name">
                <span
                  className="replay-boat-color"
                  style={{
                    background:
                      boatColor(
                        selectedReplayTrack.deviceId,
                      ),
                  }}
                />

                {selectedReplayTrack.boatName}
              </div>

              <div className="replay-boat-data">
                <div>
                  <span>Velocidade</span>
                  <strong>
                    {Number(
                      selectedReplayPosition.speed ??
                      0,
                    ).toFixed(1)}
                    {' '}
                    kn
                  </strong>
                </div>

                <div>
                  <span>Rumo</span>
                  <strong>
                    {Math.round(
                      selectedReplayPosition.course ??
                      0,
                    )}
                    °
                  </strong>
                </div>

                <div>
                  <span>Hora</span>
                  <strong>
                    {formatReplayClock(
                      currentTimeMs,
                    )}
                  </strong>
                </div>
              </div>
            </div>
          )}
      </section>
      )}

      {replayData && (
        <section className="replay-player">
          <div className="replay-player-top">
            <button
              type="button"
              className="replay-skip-button"
              onClick={() => {
                setPlaying(false)
                setCurrentTimeMs(startMs)
              }}
              title="Ir para o início"
            >
              |◀
            </button>

            <button
              type="button"
              className="replay-play-button"
              onClick={() =>
                setPlaying(
                  (value) => !value,
                )
              }
            >
              {playing
                ? 'Pausa'
                : 'Play'}
            </button>

            <div className="replay-time">
              {formatReplayClock(
                currentTimeMs,
              )}
            </div>

            <select
              className="replay-speed"
              value={speed}
              onChange={(event) =>
                setSpeed(
                  Number(
                    event.target.value,
                  ),
                )
              }
            >
              <option value={1}>1×</option>
              <option value={5}>5×</option>
              <option value={10}>10×</option>
              <option value={30}>30×</option>
              <option value={60}>60×</option>
            </select>

            <button
              type="button"
              className="replay-skip-button"
              onClick={() => {
                setPlaying(false)
                setCurrentTimeMs(endMs)
              }}
              title="Ir para o fim"
            >
              ▶|
            </button>
          </div>

          <div className="replay-options">
            <label>
              <input
                type="checkbox"
                checked={showReplayTrails}
                onChange={(event) =>
                  setShowReplayTrails(
                    event.target.checked,
                  )
                }
              />
              Rastos
            </label>

            <label>
              <input
                type="checkbox"
                checked={showReplayNames}
                onChange={(event) =>
                  setShowReplayNames(
                    event.target.checked,
                  )
                }
              />
              Nomes
            </label>
          </div>

          <input
            className="replay-slider"
            type="range"
            min={startMs}
            max={endMs}
            step={1000}
            value={Math.min(
              endMs,
              Math.max(
                startMs,
                currentTimeMs,
              ),
            )}
            onChange={(event) => {
              setPlaying(false)
              setCurrentTimeMs(
                Number(
                  event.target.value,
                ),
              )
            }}
          />

          <div className="replay-range-labels">
            <span>
              {formatReplayClock(
                startMs,
              )}
            </span>

            <span>
              {formatReplayClock(
                endMs,
              )}
            </span>
          </div>
        </section>
      )}

      <section className="replay-help">
        Para uma regata antiga basta criar o evento com
        início/fim, associar os participantes e desenhar o
        percurso no Admin. O Replay vai buscar as posições
        históricas ao Traccar para esse intervalo.
      </section>
    </main>
  )
}

function replayTrackUntilTime(
  positions: ReplayPosition[],
  timeMs: number,
) {
  if (positions.length === 0) {
    return []
  }

  const elapsed =
    positions.filter(
      (position) => {
        const positionTime =
          new Date(
            position.fixTime ?? 0,
          ).getTime()

        return (
          Number.isFinite(positionTime) &&
          positionTime <= timeMs
        )
      },
    )

  const interpolated =
    replayPositionAtTime(
      positions,
      timeMs,
    )

  if (!interpolated) {
    return elapsed
  }

  const last =
    elapsed[
      elapsed.length - 1
    ]

  if (
    !last ||
    last.latitude !==
      interpolated.latitude ||
    last.longitude !==
      interpolated.longitude
  ) {
    return [
      ...elapsed,
      interpolated,
    ]
  }

  return elapsed
}

function replayPositionAtTime(
  positions: ReplayPosition[],
  timeMs: number,
): ReplayPosition | null {
  if (positions.length === 0) {
    return null
  }

  const firstTime =
    new Date(
      positions[0].fixTime ?? 0,
    ).getTime()

  const lastTime =
    new Date(
      positions[
        positions.length - 1
      ].fixTime ?? 0,
    ).getTime()

  if (
    !Number.isFinite(firstTime) ||
    !Number.isFinite(lastTime)
  ) {
    return null
  }

  if (timeMs < firstTime) {
    return null
  }

  if (timeMs >= lastTime) {
    return positions[
      positions.length - 1
    ]
  }

  let low = 0
  let high =
    positions.length - 1

  while (low <= high) {
    const mid =
      Math.floor(
        (low + high) / 2,
      )

    const midTime =
      new Date(
        positions[mid].fixTime ??
        0,
      ).getTime()

    if (midTime <= timeMs) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const beforeIndex =
    Math.max(0, high)

  const afterIndex =
    Math.min(
      positions.length - 1,
      beforeIndex + 1,
    )

  const before =
    positions[beforeIndex]

  const after =
    positions[afterIndex]

  const beforeTime =
    new Date(
      before.fixTime ?? 0,
    ).getTime()

  const afterTime =
    new Date(
      after.fixTime ?? 0,
    ).getTime()

  if (
    afterTime <= beforeTime
  ) {
    return before
  }

  const fraction =
    Math.max(
      0,
      Math.min(
        1,
        (timeMs - beforeTime) /
          (afterTime - beforeTime),
      ),
    )

  return {
    latitude:
      before.latitude +
      (
        after.latitude -
        before.latitude
      ) * fraction,

    longitude:
      before.longitude +
      (
        after.longitude -
        before.longitude
      ) * fraction,

    speed:
      before.speed +
      (
        after.speed -
        before.speed
      ) * fraction,

    course:
      interpolateCourse(
        before.course,
        after.course,
        fraction,
      ),

    fixTime:
      new Date(timeMs)
        .toISOString(),
  }
}

function interpolateCourse(
  from: number,
  to: number,
  fraction: number,
) {
  const delta =
    ((to - from + 540) % 360) -
    180

  return (
    from + delta * fraction + 360
  ) % 360
}

function formatReplayClock(
  value: number,
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return '--:--:--'
  }

  return new Intl.DateTimeFormat(
    'pt-PT',
    {
      timeZone:
        'Atlantic/Azores',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    },
  ).format(new Date(value))
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

        <div className="admin-header-actions">
          <a href="/admin/regata" className="race-mode-link">
            Modo Regata
          </a>

          <a href="/" className="back-live-link">
            ← Voltar ao Live
          </a>
        </div>
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


function RaceModeView() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [quickEditor, setQuickEditor] = useState<
    'participants' | 'course' | null
  >(null)

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch('/api/events', {
        cache: 'no-store',
      })

      const data = await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'Erro ao carregar regatas',
        )
      }

      const loaded = (data.events ?? []) as EventItem[]
      setEvents(loaded)

      const liveEvents = loaded.filter(
        (event) => event.status === 'live',
      )

      const scheduledEvents = loaded.filter(
        (event) => event.status === 'scheduled',
      )

      if (!selectedEventId) {
        if (liveEvents.length > 0) {
          setSelectedEventId(liveEvents[0].id)
        } else if (scheduledEvents.length > 0) {
          setSelectedEventId(scheduledEvents[0].id)
        } else if (loaded.length > 0) {
          setSelectedEventId(loaded[0].id)
        }
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar regatas',
      )
    } finally {
      setLoading(false)
    }
  }

  const selectedEvent =
    events.find(
      (event) => event.id === selectedEventId,
    ) ?? null

  async function finishNow() {
    if (!selectedEvent) return

    const confirmed = window.confirm(
      `Terminar agora a regata "${selectedEvent.name}"?\n\nA hora de fim será atualizada para este momento.`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage(null)

    try {
      const response = await adminFetch(
        `/admin/api/events/${encodeURIComponent(selectedEvent.id)}/finish`,
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

      setMessage('Regata terminada.')
      await loadEvents()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Erro ao terminar regata',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="race-mode-page">
        <div className="race-mode-loading">
          A carregar Modo Regata...
        </div>
      </main>
    )
  }

  return (
    <main className="race-mode-page">
      <header className="race-mode-header">
        <div>
          <div className="brand-small">
            REGATA LIVE
          </div>

          <h1>Modo Regata</h1>
        </div>

        <div className="race-mode-header-actions">
          <a href="/admin" className="secondary-link-button">
            Admin completo
          </a>

          <a href="/" className="live-link-button">
            Live
          </a>
        </div>
      </header>

      <div className="race-mode-content">
        <section className="race-mode-card event-picker-card">
          <label className="race-mode-label">
            Regata
          </label>

          <select
            className="race-mode-select"
            value={selectedEventId}
            onChange={(event) => {
              setSelectedEventId(event.target.value)
              setMessage(null)
              setQuickEditor(null)
            }}
          >
            {events.length === 0 && (
              <option value="">
                Sem regatas
              </option>
            )}

            {events.map((event) => (
              <option
                key={event.id}
                value={event.id}
              >
                {event.status === 'live'
                  ? `● EM DIRETO — ${event.name}`
                  : event.status === 'completed'
                    ? `Terminada — ${event.name}`
                    : `Agendada — ${event.name}`}
              </option>
            ))}
          </select>
        </section>

        {selectedEvent ? (
          <>
            <section className="race-mode-card race-status-card">
              <div className="race-status-top">
                <div>
                  <div className="race-mode-kicker">
                    REGATA SELECIONADA
                  </div>

                  <h2>{selectedEvent.name}</h2>
                </div>

                <div
                  className={`race-status-pill ${selectedEvent.status}`}
                >
                  {selectedEvent.status === 'live'
                    ? 'EM DIRETO'
                    : selectedEvent.status === 'completed'
                      ? 'TERMINADA'
                      : 'AGENDADA'}
                </div>
              </div>

              <div className="race-time-grid">
                <div className="race-time-box">
                  <span>Início</span>
                  <strong>
                    {formatRaceDateTime(
                      selectedEvent.start_time,
                    )}
                  </strong>
                </div>

                <div className="race-time-box">
                  <span>Hora limite</span>
                  <strong>
                    {formatRaceDateTime(
                      selectedEvent.end_time,
                    )}
                  </strong>
                </div>
              </div>

              {selectedEvent.status !== 'completed' && (
                <button
                  type="button"
                  className="finish-race-big-button"
                  onClick={finishNow}
                  disabled={saving}
                >
                  {saving
                    ? 'A terminar...'
                    : 'Terminar regata agora'}
                </button>
              )}
            </section>

            <section className="race-mode-actions-grid">
              <button
                type="button"
                className={
                  quickEditor === 'participants'
                    ? 'race-action-card active'
                    : 'race-action-card'
                }
                onClick={() =>
                  setQuickEditor(
                    quickEditor === 'participants'
                      ? null
                      : 'participants',
                  )
                }
              >
                <span className="race-action-icon">👥</span>
                <strong>Participantes</strong>
                <small>
                  Adicionar ou retirar barcos
                </small>
              </button>

              <button
                type="button"
                className={
                  quickEditor === 'course'
                    ? 'race-action-card active'
                    : 'race-action-card'
                }
                onClick={() =>
                  setQuickEditor(
                    quickEditor === 'course'
                      ? null
                      : 'course',
                  )
                }
              >
                <span className="race-action-icon">⚓</span>
                <strong>Percurso</strong>
                <small>
                  Bóias, waypoints e linhas
                </small>
              </button>

              <a
                href="/"
                className="race-action-card race-action-link"
              >
                <span className="race-action-icon">🗺️</span>
                <strong>Abrir Live</strong>
                <small>
                  Ver a regata no mapa
                </small>
              </a>
            </section>

            {message && (
              <div className="race-mode-message">
                {message}
              </div>
            )}

            {quickEditor === 'participants' && (
              <section className="race-mode-editor-card">
                <div className="race-mode-section-title">
                  Participantes
                </div>

                <ParticipantsEditor
                  event={selectedEvent}
                />
              </section>
            )}

            {quickEditor === 'course' && (
              <section className="race-mode-editor-card">
                <div className="race-mode-section-title">
                  Percurso
                </div>

                <CourseEditor
                  event={selectedEvent}
                />
              </section>
            )}
          </>
        ) : (
          <section className="race-mode-card">
            Não existem regatas para editar.
          </section>
        )}
      </div>
    </main>
  )
}

function formatRaceDateTime(
  value: string | null,
) {
  if (!value) return '—'

  const normalized = value.slice(0, 16)
  const [datePart, timePart] =
    normalized.split('T')

  if (!datePart || !timePart) {
    return value
  }

  const [year, month, day] =
    datePart.split('-')

  return `${day}/${month}/${year} ${timePart}`
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
  const historyLayerRef = useRef<L.LayerGroup | null>(null)

  const [points, setPoints] = useState<CoursePoint[]>([])
  const [lines, setLines] = useState<CourseLine[]>([])
  const [library, setLibrary] = useState<LibraryBuoy[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showHistoryTracks, setShowHistoryTracks] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyData, setHistoryData] = useState<ReplayEventData | null>(null)

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
    historyLayerRef.current = L.layerGroup().addTo(map)
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

    if (
      showHistoryTracks &&
      historyData
    ) {
      for (const track of historyData.tracks) {
        for (const position of track.positions) {
          if (
            Number.isFinite(position.latitude) &&
            Number.isFinite(position.longitude)
          ) {
            boundsPoints.push([
              position.latitude,
              position.longitude,
            ])
          }
        }
      }
    }

    if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 14)
    } else if (boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), {
        padding: [40, 40],
        maxZoom: 14,
      })
    }
  }, [
    points,
    lines,
    pendingLineA,
    showHistoryTracks,
    historyData,
  ])


  useEffect(() => {
    const layer = historyLayerRef.current
    if (!layer) return

    layer.clearLayers()

    if (
      !showHistoryTracks ||
      !historyData
    ) {
      return
    }

    for (const track of historyData.tracks) {
      const latlngs = track.positions
        .filter(
          (position) =>
            Number.isFinite(position.latitude) &&
            Number.isFinite(position.longitude),
        )
        .map(
          (position) =>
            [
              position.latitude,
              position.longitude,
            ] as [number, number],
        )

      if (latlngs.length < 2) continue

      L.polyline(latlngs, {
        color: boatColor(track.deviceId),
        weight: 3,
        opacity: 0.72,
      }).addTo(layer)
    }
  }, [showHistoryTracks, historyData])

  async function toggleHistoryTracks() {
    if (showHistoryTracks) {
      setShowHistoryTracks(false)
      return
    }

    if (historyData) {
      setShowHistoryTracks(true)
      return
    }

    setHistoryLoading(true)
    setMessage(null)

    try {
      const response = await adminFetch(
        `/api/replay/events/${encodeURIComponent(event.id)}`,
        { cache: 'no-store' },
      )

      const data =
        await readJsonResponse(response)

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
            'Não foi possível carregar o histórico desta regata.',
        )
      }

      setHistoryData(
        data as ReplayEventData,
      )
      setShowHistoryTracks(true)

      const boatsWithHistory =
        (data.tracks ?? []).filter(
          (track: ReplayTrack) =>
            track.positions.length > 1,
        ).length

      setMessage(
        `${boatsWithHistory} barco(s) com rasto histórico carregado(s). Arrasta as bóias para ajustar e depois guarda o percurso.`,
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar rastos históricos.',
      )
    } finally {
      setHistoryLoading(false)
    }
  }

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

      <div className="course-history-tools">
        <button
          className={
            showHistoryTracks
              ? 'secondary-button active'
              : 'secondary-button'
          }
          onClick={toggleHistoryTracks}
          disabled={historyLoading}
        >
          {historyLoading
            ? 'A carregar histórico...'
            : showHistoryTracks
              ? 'Ocultar rastos históricos'
              : 'Mostrar rastos históricos'}
        </button>

        <span>
          Usa os rastos gravados no Traccar como referência para ajustar bóias,
          waypoints e linhas desta regata.
        </span>
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


const MIN_COURSE_SPEED_KN = 1
const COURSE_SMOOTHING_ALPHA = 0.35

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360
}

function shortestAngleDelta(from: number, to: number) {
  let delta = normalizeAngle(to) - normalizeAngle(from)
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

function smoothDisplayCourse(
  previous: number | undefined,
  incoming: number | undefined,
  speed: number | undefined,
) {
  const validIncoming =
    Number.isFinite(Number(incoming))
      ? normalizeAngle(Number(incoming))
      : undefined

  if (previous === undefined || !Number.isFinite(previous)) {
    return validIncoming ?? 0
  }

  const validSpeed =
    Number.isFinite(Number(speed))
      ? Number(speed)
      : 0

  if (validSpeed < MIN_COURSE_SPEED_KN) {
    return normalizeAngle(previous)
  }

  if (validIncoming === undefined) {
    return normalizeAngle(previous)
  }

  const delta = shortestAngleDelta(previous, validIncoming)

  return normalizeAngle(
    previous + delta * COURSE_SMOOTHING_ALPHA,
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
            width="34"
            height="47"
            viewBox="0 0 42 58"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <!-- casco -->
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

            <!-- linha central muito discreta -->
            <line
              x1="21"
              y1="7"
              x2="21"
              y2="49"
              stroke="rgba(255,255,255,.58)"
              stroke-width="1.2"
              stroke-linecap="round"
            />

            <!-- vela curvada vista de cima -->
            <path
              d="M21 12
                 C27 19 29 28 28 35
                 C27 41 24 45 21.5 47"
              fill="none"
              stroke="white"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        ${showName
          ? `<div class="boat-name">${escapeHtml(name)}</div>`
          : ''}
      </div>
    `,
    iconSize: [118, 68],
    iconAnchor: [59, 23.5],
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
