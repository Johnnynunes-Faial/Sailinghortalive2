import {
  useEffect,
  useRef,
  useState,
} from 'react'
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

function App() {
  const mapElementRef =
    useRef<HTMLDivElement | null>(null)

  const mapRef =
    useRef<L.Map | null>(null)

  const markersRef =
    useRef<Map<number, L.Marker>>(
      new Map(),
    )

  const initialFitDoneRef =
    useRef(false)

  const [boats, setBoats] =
    useState<Boat[]>([])

  const [connected, setConnected] =
    useState(false)

  const [lastUpdate, setLastUpdate] =
    useState<string | null>(null)

  const [events, setEvents] =
    useState<EventItem[]>([])

  const [
    selectedEventId,
    setSelectedEventId,
  ] = useState<string>('general')

  const [
    showNewEvent,
    setShowNewEvent,
  ] = useState(false)

  const [eventName, setEventName] =
    useState('')

  const [startTime, setStartTime] =
    useState('')

  const [endTime, setEndTime] =
    useState('')

  const [creatingEvent, setCreatingEvent] =
    useState(false)

  const [eventError, setEventError] =
    useState<string | null>(null)

  useEffect(() => {
    if (
      !mapElementRef.current ||
      mapRef.current
    ) {
      return
    }

    const map = L.map(
      mapElementRef.current,
      {
        zoomControl: true,
      },
    ).setView(
      [38.535, -28.63],
      11,
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

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadLive() {
      try {
        const response =
          await fetch('/api/live', {
            cache: 'no-store',
          })

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`,
          )
        }

        const data =
          (await response.json()) as LiveResponse

        if (!active) return

        setBoats(data.boats ?? [])
        setConnected(
          data.ok === true,
        )

        setLastUpdate(
          data.updatedAt ?? null,
        )
      } catch (error) {
        console.error(
          'Erro Live:',
          error,
        )

        if (active) {
          setConnected(false)
        }
      }
    }

    loadLive()

    const timer =
      window.setInterval(
        loadLive,
        2000,
      )

    return () => {
      active = false

      window.clearInterval(
        timer,
      )
    }
  }, [])

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    try {
      const response =
        await fetch('/api/events', {
          cache: 'no-store',
        })

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`,
        )
      }

      const data =
        (await response.json()) as EventsResponse

      setEvents(
        data.events ?? [],
      )
    } catch (error) {
      console.error(
        'Erro a carregar regatas:',
        error,
      )
    }
  }

  useEffect(() => {
    const map = mapRef.current

    if (!map) return

    const positionedBoats =
      boats.filter(
        (boat) =>
          boat.position &&
          Number.isFinite(
            boat.position.latitude,
          ) &&
          Number.isFinite(
            boat.position.longitude,
          ),
      )

    const activeIds =
      new Set(
        positionedBoats.map(
          (boat) => boat.id,
        ),
      )

    for (
      const [id, marker]
      of markersRef.current.entries()
    ) {
      if (!activeIds.has(id)) {
        marker.removeFrom(map)

        markersRef.current.delete(
          id,
        )
      }
    }

    for (
      const boat
      of positionedBoats
    ) {
      const position =
        boat.position!

      const icon =
        L.divIcon({
          className:
            'boat-marker-wrapper',

          html: `
            <div class="boat-marker">

              <div
                class="boat-arrow"
                style="
                  transform:
                  rotate(
                    ${position.course || 0}deg
                  )
                "
              >
                ▲
              </div>

              <div class="boat-name">
                ${escapeHtml(
                  boat.name,
                )}
              </div>

            </div>
          `,

          iconSize: [
            120,
            50,
          ],

          iconAnchor: [
            60,
            18,
          ],
        })

      const existingMarker =
        markersRef.current.get(
          boat.id,
        )

      const popup = `
        <strong>
          ${escapeHtml(
            boat.name,
          )}
        </strong>
        <br>

        Velocidade:
        ${Number(
          position.speed ?? 0,
        ).toFixed(1)}
        kn
        <br>

        Rumo:
        ${Math.round(
          position.course ?? 0,
        )}°
      `

      if (existingMarker) {
        existingMarker.setLatLng(
          [
            position.latitude,
            position.longitude,
          ],
        )

        existingMarker.setIcon(
          icon,
        )

        existingMarker
          .setPopupContent(
            popup,
          )
      } else {
        const marker =
          L.marker(
            [
              position.latitude,
              position.longitude,
            ],
            {
              icon,
            },
          )
            .addTo(map)
            .bindPopup(
              popup,
            )

        markersRef.current.set(
          boat.id,
          marker,
        )
      }
    }

    if (
      !initialFitDoneRef.current &&
      positionedBoats.length > 0
    ) {
      fitBoats(
        positionedBoats,
      )

      initialFitDoneRef.current =
        true
    }
  }, [boats])

  function fitBoats(
    list: Boat[],
  ) {
    const map =
      mapRef.current

    if (!map) return

    const boatsWithPosition =
      list.filter(
        (boat) => boat.position,
      )

    if (
      boatsWithPosition.length === 0
    ) {
      return
    }

    const bounds =
      L.latLngBounds(
        boatsWithPosition.map(
          (boat) => [
            boat.position!.latitude,
            boat.position!.longitude,
          ],
        ),
      )

    if (
      boatsWithPosition.length === 1
    ) {
      map.setView(
        bounds.getCenter(),
        13,
      )
    } else {
      map.fitBounds(
        bounds,
        {
          padding: [
            50,
            50,
          ],

          maxZoom: 13,
        },
      )
    }
  }

  function showAllBoats() {
    fitBoats(boats)
  }

  async function createEvent(
    event:
      React.FormEvent,
  ) {
    event.preventDefault()

    if (!eventName.trim()) {
      setEventError(
        'Indica o nome da regata.',
      )

      return
    }

    setCreatingEvent(true)
    setEventError(null)

    try {
      const response =
        await fetch(
          '/api/events',
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json',
            },

            body: JSON.stringify({
              name:
                eventName.trim(),

              startTime:
                startTime ||
                null,

              endTime:
                endTime ||
                null,
            }),
          },
        )

      const data =
        await response.json() as {
          ok: boolean
          id?: string
          error?: string
        }

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.error ||
            'Erro ao criar regata',
        )
      }

      await loadEvents()

      if (data.id) {
        setSelectedEventId(
          data.id,
        )
      }

      setEventName('')
      setStartTime('')
      setEndTime('')
      setShowNewEvent(false)
    } catch (error) {
      setEventError(
        error instanceof Error
          ? error.message
          : 'Erro ao criar regata',
      )
    } finally {
      setCreatingEvent(false)
    }
  }

  const selectedEvent =
    events.find(
      (event) =>
        event.id ===
        selectedEventId,
    )

  return (
    <main className="live-app">

      <header className="top-bar">

        <div className="brand-block">

          <div className="brand-small">
            REGATA LIVE
          </div>

          <div className="brand-title">
            Sailing Horta Live
          </div>

        </div>

        <div className="event-controls">

          <select
            className="event-select"
            value={
              selectedEventId
            }
            onChange={(event) =>
              setSelectedEventId(
                event.target.value,
              )
            }
          >
            <option value="general">
              Modo Geral
            </option>

            {events.map(
              (event) => (
                <option
                  key={
                    event.id
                  }
                  value={
                    event.id
                  }
                >
                  {event.name}
                </option>
              ),
            )}
          </select>

          <button
            className="new-event-button"
            onClick={() => {
              setEventError(null)

              setShowNewEvent(
                true,
              )
            }}
          >
            + Nova regata
          </button>

        </div>

        <div className="top-actions">

          <div
            className={
              connected
                ? 'connection online'
                : 'connection offline'
            }
          >
            <span
              className="status-dot"
            />

            {connected
              ? 'Traccar online'
              : 'Traccar offline'}
          </div>

          <button
            className="show-all-button"
            onClick={
              showAllBoats
            }
          >
            Mostrar todos
          </button>

        </div>

      </header>

      <section className="map-container">

        <div
          ref={
            mapElementRef
          }
          className="map"
        />

        <div className="current-mode">

          {selectedEvent
            ? selectedEvent.name
            : 'Modo Geral'}

        </div>

        <div className="boat-counter">

          {
            boats.filter(
              (boat) =>
                boat.position,
            ).length
          }

          {' '}
          barcos ativos

        </div>

        {lastUpdate && (
          <div className="last-update">
            Atualização Live
          </div>
        )}

      </section>

      {showNewEvent && (

        <div className="modal-backdrop">

          <div className="event-modal">

            <div className="modal-header">

              <div>

                <div className="modal-small">
                  REGATA
                </div>

                <h2>
                  Nova regata
                </h2>

              </div>

              <button
                className="modal-close"
                onClick={() =>
                  setShowNewEvent(
                    false,
                  )
                }
              >
                ×
              </button>

            </div>

            <form
              onSubmit={
                createEvent
              }
            >

              <label>
                Nome

                <input
                  type="text"
                  value={
                    eventName
                  }
                  onChange={(
                    event,
                  ) =>
                    setEventName(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Ex.: Regata Horta - Madalena"
                  autoFocus
                />
              </label>

              <label>
                Início

                <input
                  type="datetime-local"
                  value={
                    startTime
                  }
                  onChange={(
                    event,
                  ) =>
                    setStartTime(
                      event.target
                        .value,
                    )
                  }
                />
              </label>

              <label>
                Fim / hora limite

                <input
                  type="datetime-local"
                  value={
                    endTime
                  }
                  onChange={(
                    event,
                  ) =>
                    setEndTime(
                      event.target
                        .value,
                    )
                  }
                />
              </label>

              {eventError && (
                <div className="form-error">
                  {eventError}
                </div>
              )}

              <div className="modal-actions">

                <button
                  type="button"
                  className="cancel-button"
                  onClick={() =>
                    setShowNewEvent(
                      false,
                    )
                  }
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="save-button"
                  disabled={
                    creatingEvent
                  }
                >
                  {creatingEvent
                    ? 'A guardar...'
                    : 'Criar regata'}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </main>
  )
}

function escapeHtml(
  value: string,
) {
  return value
    .replaceAll(
      '&',
      '&amp;',
    )
    .replaceAll(
      '<',
      '&lt;',
    )
    .replaceAll(
      '>',
      '&gt;',
    )
    .replaceAll(
      '"',
      '&quot;',
    )
    .replaceAll(
      "'",
      '&#039;',
    )
}

export default App
