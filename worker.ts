interface Env {
  TRACCAR_URL: string
  TRACCAR_USERNAME: string
  TRACCAR_PASSWORD: string
  UNKNOWN_MONITOR_URL?: string
  UNKNOWN_MONITOR_KEY?: string
  DB: D1Database
}

interface TraccarDevice {
  id: number
  name: string
  uniqueId: string
  status?: string
  lastUpdate?: string
}

interface TraccarPosition {
  id: number
  deviceId: number
  latitude: number
  longitude: number
  speed?: number
  course?: number
  fixTime?: string
  deviceTime?: string
  serverTime?: string
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function traccarFetch(env: Env, path: string) {
  const baseUrl = env.TRACCAR_URL.replace(/\/+$/, '')
  const auth = btoa(`${env.TRACCAR_USERNAME}:${env.TRACCAR_PASSWORD}`)

  return fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })
}

async function getActiveBoats(env: Env) {
  const [devicesResponse, positionsResponse] = await Promise.all([
    traccarFetch(env, '/api/devices'),
    traccarFetch(env, '/api/positions'),
  ])

  if (!devicesResponse.ok) throw new Error(`Traccar devices HTTP ${devicesResponse.status}`)
  if (!positionsResponse.ok) throw new Error(`Traccar positions HTTP ${positionsResponse.status}`)

  const devices = (await devicesResponse.json()) as TraccarDevice[]
  const positions = (await positionsResponse.json()) as TraccarPosition[]

  const positionByDevice = new Map(
    positions.map((position) => [position.deviceId, position]),
  )

  const MAX_POSITION_AGE_MS = 10 * 60 * 1000
  const now = Date.now()

  return devices
    .map((device) => {
      const position = positionByDevice.get(device.id)
      if (!position) return null

      const positionTime =
        position.fixTime ??
        position.deviceTime ??
        position.serverTime ??
        null

      if (!positionTime) return null

      const ageMs = now - new Date(positionTime).getTime()
      if (!Number.isFinite(ageMs) || ageMs > MAX_POSITION_AGE_MS) return null

      return {
        id: device.id,
        name: device.name,
        uniqueId: device.uniqueId,
        status: device.status ?? 'unknown',
        lastUpdate: device.lastUpdate ?? null,
        position: {
          latitude: position.latitude,
          longitude: position.longitude,
          speed: position.speed ?? 0,
          course: position.course ?? 0,
          fixTime: positionTime,
        },
      }
    })
    .filter((boat): boat is NonNullable<typeof boat> => boat !== null)
}

async function ensureLibraryTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS buoy_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run()
}

async function ensureCourseLinesTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS course_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      line_type TEXT NOT NULL,
      a_latitude REAL NOT NULL,
      a_longitude REAL NOT NULL,
      b_latitude REAL NOT NULL,
      b_longitude REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, line_type)
    )
  `).run()
}


async function ensureBoatSettingsTable(
  env: Env,
) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS boat_settings (
      traccar_device_id INTEGER PRIMARY KEY,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run()
}


async function ensureReplayTrackCacheTable(
  env: Env,
) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS replay_track_cache (
      event_id TEXT NOT NULL,
      traccar_device_id INTEGER NOT NULL,
      from_iso TEXT NOT NULL,
      to_iso TEXT NOT NULL,
      track_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (
        event_id,
        traccar_device_id
      )
    )
  `).run()

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_replay_track_cache_event
    ON replay_track_cache(event_id)
  `).run()
}


function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const R_NM = 3440.065
  const toRad = (value: number) => value * Math.PI / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R_NM * c
}

async function getTrackForDevice(
  env: Env,
  deviceId: number,
  distanceNm: number,
) {
  const to = new Date()
  const from = new Date(to.getTime() - 6 * 60 * 60 * 1000)

  const params = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  })

  const response = await traccarFetch(
    env,
    `/api/reports/route?${params.toString()}`,
  )

  if (!response.ok) {
    return []
  }

  const positions = (await response.json()) as TraccarPosition[]

  const valid = positions
    .filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude),
    )
    .sort((a, b) => {
      const ta = new Date(a.fixTime ?? a.deviceTime ?? a.serverTime ?? 0).getTime()
      const tb = new Date(b.fixTime ?? b.deviceTime ?? b.serverTime ?? 0).getTime()
      return ta - tb
    })

  if (valid.length <= 1) return valid

  const selected: TraccarPosition[] = []
  let accumulated = 0

  for (let i = valid.length - 1; i >= 0; i--) {
    selected.push(valid[i])

    if (i > 0) {
      accumulated += haversineNm(
        valid[i].latitude,
        valid[i].longitude,
        valid[i - 1].latitude,
        valid[i - 1].longitude,
      )

      if (accumulated >= distanceNm) {
        break
      }
    }
  }

  return selected.reverse()
}


async function getRecentTrackForDevice(
  env: Env,
  deviceId: number,
  minutes: number,
) {
  const to = new Date()
  const from = new Date(
    to.getTime() - minutes * 60 * 1000,
  )

  const params = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  })

  const response = await traccarFetch(
    env,
    `/api/reports/route?${params.toString()}`,
  )

  if (!response.ok) {
    return []
  }

  const positions =
    (await response.json()) as TraccarPosition[]

  const valid = positions
    .filter(
      (position) =>
        Number.isFinite(position.latitude) &&
        Number.isFinite(position.longitude),
    )
    .sort((a, b) => {
      const ta = new Date(
        a.fixTime ??
          a.deviceTime ??
          a.serverTime ??
          0,
      ).getTime()

      const tb = new Date(
        b.fixTime ??
          b.deviceTime ??
          b.serverTime ??
          0,
      ).getTime()

      return ta - tb
    })

  // Evita linhas excessivamente pesadas se um dispositivo
  // estiver configurado para enviar posições com muita frequência.
  const MAX_POINTS = 240
  if (valid.length <= MAX_POINTS) {
    return valid
  }

  const step = Math.ceil(
    valid.length / MAX_POINTS,
  )

  const reduced = valid.filter(
    (_, index) =>
      index % step === 0 ||
      index === valid.length - 1,
  )

  return reduced
}


function azoresLocalDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Atlantic/Azores',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}


function getTimeZoneOffsetMs(
  date: Date,
  timeZone: string,
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )

  return asUtc - date.getTime()
}

function azoresLocalToUtcIso(
  value: string | null | undefined,
) {
  if (!value) return null

  const normalized = value.slice(0, 19)
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  )

  if (!match) return null

  const [, y, m, d, hh, mm, ss = '00'] = match

  const localAsUtcMs = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
  )

  let guess = new Date(localAsUtcMs)
  let offset = getTimeZoneOffsetMs(
    guess,
    'Atlantic/Azores',
  )

  guess = new Date(localAsUtcMs - offset)

  const offset2 = getTimeZoneOffsetMs(
    guess,
    'Atlantic/Azores',
  )

  return new Date(localAsUtcMs - offset2).toISOString()
}

function downsamplePositions(
  positions: TraccarPosition[],
  maxPoints = 2000,
) {
  if (positions.length <= maxPoints) {
    return positions
  }

  const step =
    (positions.length - 1) /
    (maxPoints - 1)

  const sampled: TraccarPosition[] = []

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.round(i * step)
    sampled.push(positions[index])
  }

  return sampled
}

async function getReplayTrackForDevice(
  env: Env,
  deviceId: number,
  fromIso: string,
  toIso: string,
) {
  const params = new URLSearchParams({
    deviceId: String(deviceId),
    from: fromIso,
    to: toIso,
  })

  const response = await traccarFetch(
    env,
    `/api/reports/route?${params.toString()}`,
  )

  if (!response.ok) {
    return {
      ok: false,
      positions: [] as TraccarPosition[],
    }
  }

  const positions =
    (await response.json()) as TraccarPosition[]

  const valid = positions
    .filter(
      (position) =>
        Number.isFinite(position.latitude) &&
        Number.isFinite(position.longitude),
    )
    .sort((a, b) => {
      const ta = new Date(
        a.fixTime ??
        a.deviceTime ??
        a.serverTime ??
        0,
      ).getTime()

      const tb = new Date(
        b.fixTime ??
        b.deviceTime ??
        b.serverTime ??
        0,
      ).getTime()

      return ta - tb
    })

  return {
    ok: true,
    positions:
      downsamplePositions(valid),
  }
}

function effectiveEventStatus(event: {
  status?: string
  start_time?: string | null
  end_time?: string | null
}) {
  if (event.status === 'completed') {
    return 'completed'
  }

  const now = azoresLocalDateTime()
  const start = event.start_time?.slice(0, 16) ?? null
  const end = event.end_time?.slice(0, 16) ?? null

  if (start && now < start) {
    return 'scheduled'
  }

  if (start && now >= start && (!end || now < end)) {
    return 'live'
  }

  if (end && now >= end) {
    return 'completed'
  }

  return event.status || 'scheduled'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'sailinghortalive' })
    }

    if (
      url.pathname === '/admin/api/unknown-devices' &&
      request.method === 'GET'
    ) {
      try {
        const monitorUrl =
          env.UNKNOWN_MONITOR_URL?.trim()

        const monitorKey =
          env.UNKNOWN_MONITOR_KEY?.trim()

        if (!monitorUrl || !monitorKey) {
          return json(
            {
              ok: false,
              error:
                'Monitor não configurado no Worker.',
            },
            503,
          )
        }

        const response = await fetch(
          monitorUrl,
          {
            headers: {
              'X-Monitor-Key': monitorKey,
              Accept: 'application/json',
            },
            cf: {
              cacheTtl: 0,
            },
          } as RequestInit,
        )

        if (!response.ok) {
          return json(
            {
              ok: false,
              error:
                `Monitor local respondeu HTTP ${response.status}.`,
            },
            502,
          )
        }

        const data = await response.json() as {
          ok?: boolean
          devices?: Array<{
            identifier?: string
            firstSeen?: string
            lastSeen?: string
            attempts?: number
            lastSourceIp?: string
          }>
        }

        if (!data.ok || !Array.isArray(data.devices)) {
          return json(
            {
              ok: false,
              error:
                'Resposta inválida do monitor local.',
            },
            502,
          )
        }

        const devices = data.devices
          .map((item) => ({
            identifier:
              String(item.identifier ?? '').trim(),
            firstSeen:
              String(item.firstSeen ?? ''),
            lastSeen:
              String(item.lastSeen ?? ''),
            attempts:
              Number(item.attempts ?? 0),
            lastSourceIp:
              String(item.lastSourceIp ?? ''),
          }))
          .filter(
            (item) =>
              item.identifier.length > 0,
          )
          .sort((a, b) =>
            b.lastSeen.localeCompare(
              a.lastSeen,
            ),
          )

        return json({
          ok: true,
          devices,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao consultar monitor local.',
          },
          500,
        )
      }
    }

    if (url.pathname === '/api/boat-colors' && request.method === 'GET') {
      try {
        await ensureBoatSettingsTable(env)

        const result = await env.DB.prepare(`
          SELECT traccar_device_id, color
          FROM boat_settings
          WHERE color IS NOT NULL
          ORDER BY traccar_device_id ASC
        `).all<{
          traccar_device_id: number
          color: string | null
        }>()

        const colors = (result.results ?? [])
          .filter(
            (row) =>
              typeof row.color === 'string' &&
              /^#[0-9a-fA-F]{6}$/.test(row.color),
          )
          .map((row) => ({
            deviceId: Number(row.traccar_device_id),
            color: row.color,
          }))

        return json({
          ok: true,
          colors,
        })
      } catch (error) {
        return json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao carregar cores dos barcos',
        }, 500)
      }
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
      try {
        const result = await env.DB.prepare(`
          SELECT id, name, start_time, end_time, status, created_at, updated_at
          FROM events
          ORDER BY start_time ASC, created_at ASC
        `).all()

        const events = (result.results ?? []).map((event: any) => ({
          ...event,
          status: effectiveEventStatus(event),
        }))

        return json({ ok: true, events })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar regatas' }, 500)
      }
    }

    const eventTracksMatch = url.pathname.match(
      /^\/api\/events\/([^/]+)\/tracks$/,
    )

    if (eventTracksMatch && request.method === 'GET') {
      try {
        const eventId = eventTracksMatch[1]
        const requestedDistance = Number(url.searchParams.get('distance') ?? '1')
        const distanceNm = Math.min(2, Math.max(0.5, requestedDistance))

        const participants = await env.DB.prepare(`
          SELECT traccar_device_id, boat_name
          FROM event_participants
          WHERE event_id = ?
          ORDER BY boat_name COLLATE NOCASE ASC
        `).bind(eventId).all<{
          traccar_device_id: number
          boat_name: string
        }>()

        const rows = participants.results ?? []

        const trackResults = await Promise.all(
          rows.map(async (participant) => {
            const positions = await getTrackForDevice(
              env,
              Number(participant.traccar_device_id),
              distanceNm,
            )

            return {
              deviceId: Number(participant.traccar_device_id),
              boatName: participant.boat_name,
              positions: positions.map((position) => ({
                latitude: position.latitude,
                longitude: position.longitude,
                fixTime:
                  position.fixTime ??
                  position.deviceTime ??
                  position.serverTime ??
                  null,
              })),
            }
          }),
        )

        return json({
          ok: true,
          distanceNm,
          tracks: trackResults,
        })
      } catch (error) {
        return json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao carregar rastos',
        }, 500)
      }
    }

    const replayMatch = url.pathname.match(
      /^\/api\/replay\/events\/([^/]+)$/,
    )

    if (replayMatch && request.method === 'GET') {
      try {
        const eventId = replayMatch[1]

        const event = await env.DB.prepare(`
          SELECT
            id,
            name,
            start_time,
            end_time,
            status,
            created_at,
            updated_at
          FROM events
          WHERE id = ?
        `).bind(eventId).first<{
          id: string
          name: string
          start_time: string | null
          end_time: string | null
          status: string
          created_at: string
          updated_at: string
        }>()

        if (!event) {
          return json(
            {
              ok: false,
              error: 'Regata não encontrada',
            },
            404,
          )
        }

        const fromIso =
          azoresLocalToUtcIso(event.start_time)

        const toIso =
          azoresLocalToUtcIso(event.end_time)

        if (!fromIso || !toIso) {
          return json(
            {
              ok: false,
              error:
                'A regata precisa de hora de início e fim válidas para criar o Replay.',
            },
            400,
          )
        }

        const participants = await env.DB.prepare(`
          SELECT
            traccar_device_id,
            boat_name
          FROM event_participants
          WHERE event_id = ?
          ORDER BY boat_name COLLATE NOCASE ASC
        `).bind(eventId).all<{
          traccar_device_id: number
          boat_name: string
        }>()

        const course = await env.DB.prepare(`
          SELECT
            id,
            event_id,
            point_type,
            name,
            latitude,
            longitude,
            point_order
          FROM course_points
          WHERE event_id = ?
          ORDER BY point_order ASC
        `).bind(eventId).all()

        await ensureCourseLinesTable(env)

        const lines = await env.DB.prepare(`
          SELECT
            id,
            event_id,
            line_type,
            a_latitude,
            a_longitude,
            b_latitude,
            b_longitude
          FROM course_lines
          WHERE event_id = ?
          ORDER BY CASE line_type WHEN 'start' THEN 0 ELSE 1 END
        `).bind(eventId).all()

        const rows =
          participants.results ?? []

        await ensureReplayTrackCacheTable(
          env,
        )

        const cachedRows =
          await env.DB.prepare(`
            SELECT
              traccar_device_id,
              from_iso,
              to_iso,
              track_json
            FROM replay_track_cache
            WHERE event_id = ?
          `).bind(eventId).all<{
            traccar_device_id: number
            from_iso: string
            to_iso: string
            track_json: string
          }>()

        const cacheByDevice =
          new Map(
            (cachedRows.results ?? []).map(
              (row) => [
                Number(
                  row.traccar_device_id,
                ),
                row,
              ],
            ),
          )

        let cacheHits = 0
        let traccarFetches = 0

        const tracks =
          await Promise.all(
            rows.map(
              async (participant) => {
                const deviceId =
                  Number(
                    participant.traccar_device_id,
                  )

                const cached =
                  cacheByDevice.get(
                    deviceId,
                  )

                if (
                  cached &&
                  cached.from_iso ===
                    fromIso &&
                  cached.to_iso ===
                    toIso
                ) {
                  try {
                    const positions =
                      JSON.parse(
                        cached.track_json,
                      ) as Array<{
                        latitude: number
                        longitude: number
                        speed: number
                        course: number
                        fixTime: string | null
                      }>

                    cacheHits += 1

                    return {
                      deviceId,
                      boatName:
                        participant.boat_name,
                      positions,
                    }
                  } catch {
                    // Cache corrompida:
                    // volta a pedir este barco.
                  }
                }

                traccarFetches += 1

                const replayTrack =
                  await getReplayTrackForDevice(
                    env,
                    deviceId,
                    fromIso,
                    toIso,
                  )

                const positions =
                  replayTrack.positions.map(
                    (position) => ({
                      latitude:
                        position.latitude,
                      longitude:
                        position.longitude,
                      speed:
                        position.speed ?? 0,
                      course:
                        position.course ?? 0,
                      fixTime:
                        position.fixTime ??
                        position.deviceTime ??
                        position.serverTime ??
                        null,
                    }),
                  )

                if (replayTrack.ok) {
                  await env.DB.prepare(`
                    INSERT INTO replay_track_cache (
                      event_id,
                      traccar_device_id,
                      from_iso,
                      to_iso,
                      track_json,
                      updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT (
                      event_id,
                      traccar_device_id
                    )
                    DO UPDATE SET
                      from_iso = excluded.from_iso,
                      to_iso = excluded.to_iso,
                      track_json = excluded.track_json,
                      updated_at = CURRENT_TIMESTAMP
                  `).bind(
                    eventId,
                    deviceId,
                    fromIso,
                    toIso,
                    JSON.stringify(
                      positions,
                    ),
                  ).run()
                }

                return {
                  deviceId,
                  boatName:
                    participant.boat_name,
                  positions,
                }
              },
            ),
          )

        return json({
          ok: true,
          event: {
            ...event,
            status:
              effectiveEventStatus(event),
            startUtc: fromIso,
            endUtc: toIso,
          },
          participants:
            rows,
          course:
            course.results ?? [],
          lines:
            lines.results ?? [],
          tracks,
          cache: {
            hits: cacheHits,
            traccarFetches,
          },
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao preparar Replay',
          },
          500,
        )
      }
    }

    if (url.pathname === '/api/live/tracks' && request.method === 'GET') {
      try {
        const requestedMinutes = Number(
          url.searchParams.get('minutes') ?? '20',
        )

        const minutes = Math.min(
          60,
          Math.max(
            5,
            Number.isFinite(requestedMinutes)
              ? requestedMinutes
              : 20,
          ),
        )

        // Só pedimos histórico dos barcos que continuam ativos no Live.
        // Assim o rasto desaparece quando a posição atual deixa de ser recente.
        const boats = await getActiveBoats(env)

        const tracks = await Promise.all(
          boats.map(async (boat) => {
            const positions =
              await getRecentTrackForDevice(
                env,
                boat.id,
                minutes,
              )

            return {
              deviceId: boat.id,
              boatName: boat.name,
              positions: positions.map(
                (position) => ({
                  latitude: position.latitude,
                  longitude: position.longitude,
                  fixTime:
                    position.fixTime ??
                    position.deviceTime ??
                    position.serverTime ??
                    null,
                }),
              ),
            }
          }),
        )

        return json({
          ok: true,
          minutes,
          tracks,
        })
      } catch (error) {
        return json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao carregar rastos globais',
        }, 500)
      }
    }

    if (url.pathname === '/api/live' && request.method === 'GET') {
      try {
        const boats = await getActiveBoats(env)
        return json({ ok: true, updatedAt: new Date().toISOString(), boats })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro Live' }, 500)
      }
    }

    const liveEventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/live$/)
    if (liveEventMatch && request.method === 'GET') {
      try {
        const eventId = liveEventMatch[1]
        const participants = await env.DB.prepare(`
          SELECT traccar_device_id
          FROM event_participants
          WHERE event_id = ?
        `).bind(eventId).all<{ traccar_device_id: number }>()

        const allowedIds = new Set(
          (participants.results ?? []).map((row) => Number(row.traccar_device_id)),
        )

        const boats = (await getActiveBoats(env)).filter((boat) => allowedIds.has(boat.id))

        const course = await env.DB.prepare(`
          SELECT id, event_id, point_type, name, latitude, longitude, point_order
          FROM course_points
          WHERE event_id = ?
          ORDER BY point_order ASC
        `).bind(eventId).all()

        await ensureCourseLinesTable(env)

        const lines = await env.DB.prepare(`
          SELECT
            id,
            event_id,
            line_type,
            a_latitude,
            a_longitude,
            b_latitude,
            b_longitude
          FROM course_lines
          WHERE event_id = ?
          ORDER BY CASE line_type WHEN 'start' THEN 0 ELSE 1 END
        `).bind(eventId).all()

        return json({
          ok: true,
          eventId,
          updatedAt: new Date().toISOString(),
          boats,
          course: course.results ?? [],
          lines: lines.results ?? [],
        })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro Live da regata' }, 500)
      }
    }

    if (url.pathname === '/admin/api/events' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          name?: string
          startTime?: string
          endTime?: string
        }

        const name = body.name?.trim()
        if (!name) return json({ ok: false, error: 'Nome da regata obrigatório' }, 400)

        const id = crypto.randomUUID()

        await env.DB.prepare(`
          INSERT INTO events (id, name, start_time, end_time, status)
          VALUES (?, ?, ?, ?, 'scheduled')
        `).bind(
          id,
          name,
          body.startTime ?? null,
          body.endTime ?? null,
        ).run()

        return json({ ok: true, id }, 201)
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao criar regata' }, 500)
      }
    }

    const adminEventMatch = url.pathname.match(/^\/admin\/api\/events\/([^/]+)$/)

    const finishEventMatch = url.pathname.match(
      /^\/admin\/api\/events\/([^/]+)\/finish$/,
    )

    if (finishEventMatch && request.method === 'POST') {
      try {
        const eventId = finishEventMatch[1]
        const finishedAt = azoresLocalDateTime()

        const existingEvent = await env.DB.prepare(`
          SELECT id
          FROM events
          WHERE id = ?
        `).bind(eventId).first()

        if (!existingEvent) {
          return json(
            { ok: false, error: 'Regata não encontrada' },
            404,
          )
        }

        await env.DB.prepare(`
          UPDATE events
          SET
            status = 'completed',
            end_time = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          finishedAt,
          eventId,
        ).run()

        return json({
          ok: true,
          status: 'completed',
          endTime: finishedAt,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao terminar regata',
          },
          500,
        )
      }
    }

    if (adminEventMatch && request.method === 'PUT') {
      try {
        const eventId = adminEventMatch[1]
        const body = await request.json() as {
          name?: string
          startTime?: string | null
          endTime?: string | null
        }

        const name = body.name?.trim()
        if (!name) return json({ ok: false, error: 'Nome da regata obrigatório' }, 400)

        await env.DB.prepare(`
          UPDATE events
          SET name = ?, start_time = ?, end_time = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          name,
          body.startTime ?? null,
          body.endTime ?? null,
          eventId,
        ).run()

        return json({ ok: true })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao atualizar regata' }, 500)
      }
    }

    if (adminEventMatch && request.method === 'DELETE') {
      try {
        const eventId = adminEventMatch[1]

        await ensureCourseLinesTable(env)

        await env.DB.batch([
          env.DB.prepare(`DELETE FROM event_participants WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM course_points WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM course_lines WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(eventId),
        ])

        return json({ ok: true })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao eliminar regata' }, 500)
      }
    }

    if (url.pathname === '/admin/api/devices' && request.method === 'GET') {
      try {
        const response = await traccarFetch(env, '/api/devices')
        if (!response.ok) return json({ ok: false, error: `Traccar HTTP ${response.status}` }, 502)

        const devices = (await response.json()) as TraccarDevice[]

        await ensureBoatSettingsTable(env)

        const settings = await env.DB.prepare(`
          SELECT traccar_device_id, color
          FROM boat_settings
        `).all<{
          traccar_device_id: number
          color: string | null
        }>()

        const colorByDevice = new Map(
          (settings.results ?? []).map((row) => [
            Number(row.traccar_device_id),
            row.color,
          ]),
        )

        const cleanDevices = devices
          .map((device) => ({
            id: device.id,
            name: device.name,
            uniqueId: device.uniqueId,
            status: device.status ?? 'unknown',
            lastUpdate: device.lastUpdate ?? null,
            color: colorByDevice.get(device.id) ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }))

        return json({ ok: true, devices: cleanDevices })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar barcos' }, 500)
      }
    }

    const deviceColorMatch = url.pathname.match(
      /^\/admin\/api\/devices\/(\d+)\/color$/,
    )

    if (deviceColorMatch && request.method === 'PUT') {
      try {
        const deviceId = Number(deviceColorMatch[1])

        if (!Number.isInteger(deviceId) || deviceId <= 0) {
          return json(
            { ok: false, error: 'ID de barco inválido' },
            400,
          )
        }

        const body = await request.json() as {
          color?: string | null
        }

        const color =
          body.color == null ||
          body.color === ''
            ? null
            : String(body.color).trim()

        if (
          color !== null &&
          !/^#[0-9a-fA-F]{6}$/.test(color)
        ) {
          return json(
            {
              ok: false,
              error:
                'Cor inválida. Usa o formato #RRGGBB.',
            },
            400,
          )
        }

        await ensureBoatSettingsTable(env)

        if (color === null) {
          await env.DB.prepare(`
            DELETE FROM boat_settings
            WHERE traccar_device_id = ?
          `).bind(deviceId).run()
        } else {
          await env.DB.prepare(`
            INSERT INTO boat_settings (
              traccar_device_id,
              color,
              updated_at
            )
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(traccar_device_id)
            DO UPDATE SET
              color = excluded.color,
              updated_at = CURRENT_TIMESTAMP
          `).bind(
            deviceId,
            color.toLowerCase(),
          ).run()
        }

        return json({
          ok: true,
          deviceId,
          color:
            color === null
              ? null
              : color.toLowerCase(),
        })
      } catch (error) {
        return json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao guardar a cor do barco',
        }, 500)
      }
    }

    const participantsMatch = url.pathname.match(
      /^\/admin\/api\/events\/([^/]+)\/participants$/,
    )

    if (participantsMatch && request.method === 'GET') {
      try {
        const eventId = participantsMatch[1]

        const result = await env.DB.prepare(`
          SELECT traccar_device_id, boat_name
          FROM event_participants
          WHERE event_id = ?
          ORDER BY boat_name COLLATE NOCASE ASC
        `).bind(eventId).all()

        return json({ ok: true, participants: result.results ?? [] })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar participantes' }, 500)
      }
    }

    if (participantsMatch && request.method === 'PUT') {
      try {
        const eventId = participantsMatch[1]
        const body = await request.json() as {
          participants?: Array<{
            traccarDeviceId: number
            boatName: string
          }>
        }

        const participants = Array.isArray(body.participants)
          ? body.participants
          : []

        const existingEvent = await env.DB.prepare(`
          SELECT id FROM events WHERE id = ?
        `).bind(eventId).first()

        if (!existingEvent) {
          return json({ ok: false, error: 'Regata não encontrada' }, 404)
        }

        const statements = [
          env.DB.prepare(`
            DELETE FROM event_participants WHERE event_id = ?
          `).bind(eventId),
          ...participants.map((participant) =>
            env.DB.prepare(`
              INSERT INTO event_participants (
                event_id, traccar_device_id, boat_name
              )
              VALUES (?, ?, ?)
            `).bind(
              eventId,
              participant.traccarDeviceId,
              participant.boatName,
            ),
          ),
        ]

        await env.DB.batch(statements)

        return json({ ok: true, count: participants.length })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao guardar participantes' }, 500)
      }
    }

    const courseMatch = url.pathname.match(
      /^\/admin\/api\/events\/([^/]+)\/course$/,
    )

    if (courseMatch && request.method === 'GET') {
      try {
        const eventId = courseMatch[1]
        const result = await env.DB.prepare(`
          SELECT id, event_id, point_type, name, latitude, longitude, point_order
          FROM course_points
          WHERE event_id = ?
          ORDER BY point_order ASC
        `).bind(eventId).all()

        return json({ ok: true, points: result.results ?? [] })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar percurso' }, 500)
      }
    }

    if (courseMatch && request.method === 'PUT') {
      try {
        const eventId = courseMatch[1]
        const body = await request.json() as {
          points?: Array<{
            pointType: string
            name?: string
            latitude: number
            longitude: number
            pointOrder: number
          }>
        }

        const points = Array.isArray(body.points) ? body.points : []

        const statements = [
          env.DB.prepare(`DELETE FROM course_points WHERE event_id = ?`).bind(eventId),
          ...points.map((point) =>
            env.DB.prepare(`
              INSERT INTO course_points (
                event_id, point_type, name, latitude, longitude, point_order
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
              eventId,
              point.pointType,
              point.name ?? null,
              point.latitude,
              point.longitude,
              point.pointOrder,
            ),
          ),
        ]

        await env.DB.batch(statements)

        return json({ ok: true, count: points.length })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao guardar percurso' }, 500)
      }
    }

    const courseLinesMatch = url.pathname.match(
      /^\/admin\/api\/events\/([^/]+)\/course-lines$/,
    )

    if (courseLinesMatch && request.method === 'GET') {
      try {
        await ensureCourseLinesTable(env)

        const eventId = courseLinesMatch[1]
        const result = await env.DB.prepare(`
          SELECT
            id,
            event_id,
            line_type,
            a_latitude,
            a_longitude,
            b_latitude,
            b_longitude
          FROM course_lines
          WHERE event_id = ?
          ORDER BY CASE line_type WHEN 'start' THEN 0 ELSE 1 END
        `).bind(eventId).all()

        return json({ ok: true, lines: result.results ?? [] })
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : 'Erro ao carregar linhas',
        }, 500)
      }
    }

    if (courseLinesMatch && request.method === 'PUT') {
      try {
        await ensureCourseLinesTable(env)

        const eventId = courseLinesMatch[1]
        const body = await request.json() as {
          lines?: Array<{
            lineType: 'start' | 'finish'
            aLatitude: number
            aLongitude: number
            bLatitude: number
            bLongitude: number
          }>
        }

        const lines = Array.isArray(body.lines) ? body.lines : []

        const statements = [
          env.DB.prepare(`DELETE FROM course_lines WHERE event_id = ?`).bind(eventId),
          ...lines.map((line) =>
            env.DB.prepare(`
              INSERT INTO course_lines (
                event_id,
                line_type,
                a_latitude,
                a_longitude,
                b_latitude,
                b_longitude
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
              eventId,
              line.lineType,
              line.aLatitude,
              line.aLongitude,
              line.bLatitude,
              line.bLongitude,
            ),
          ),
        ]

        await env.DB.batch(statements)

        return json({ ok: true, count: lines.length })
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : 'Erro ao guardar linhas',
        }, 500)
      }
    }

    if (url.pathname === '/admin/api/buoy-library' && request.method === 'GET') {
      try {
        await ensureLibraryTable(env)

        const result = await env.DB.prepare(`
          SELECT id, name, latitude, longitude, created_at, updated_at
          FROM buoy_library
          ORDER BY name COLLATE NOCASE ASC
        `).all()

        return json({ ok: true, buoys: result.results ?? [] })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar biblioteca' }, 500)
      }
    }

    if (url.pathname === '/admin/api/buoy-library' && request.method === 'POST') {
      try {
        await ensureLibraryTable(env)

        const body = await request.json() as {
          name?: string
          latitude?: number
          longitude?: number
        }

        const name = body.name?.trim()
        const latitude = Number(body.latitude)
        const longitude = Number(body.longitude)

        if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return json({ ok: false, error: 'Nome e coordenadas válidas são obrigatórios' }, 400)
        }

        const result = await env.DB.prepare(`
          INSERT INTO buoy_library (name, latitude, longitude)
          VALUES (?, ?, ?)
        `).bind(name, latitude, longitude).run()

        return json({ ok: true, id: result.meta.last_row_id }, 201)
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao criar bóia' }, 500)
      }
    }

    const buoyMatch = url.pathname.match(/^\/admin\/api\/buoy-library\/(\d+)$/)

    if (buoyMatch && request.method === 'PUT') {
      try {
        await ensureLibraryTable(env)

        const id = Number(buoyMatch[1])
        const body = await request.json() as {
          name?: string
          latitude?: number
          longitude?: number
        }

        const name = body.name?.trim()
        const latitude = Number(body.latitude)
        const longitude = Number(body.longitude)

        if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return json({ ok: false, error: 'Nome e coordenadas válidas são obrigatórios' }, 400)
        }

        await env.DB.prepare(`
          UPDATE buoy_library
          SET name = ?, latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(name, latitude, longitude, id).run()

        return json({ ok: true })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao atualizar bóia' }, 500)
      }
    }

    if (buoyMatch && request.method === 'DELETE') {
      try {
        await ensureLibraryTable(env)
        const id = Number(buoyMatch[1])

        await env.DB.prepare(`
          DELETE FROM buoy_library WHERE id = ?
        `).bind(id).run()

        return json({ ok: true })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao eliminar bóia' }, 500)
      }
    }

    return json({ ok: false, error: 'Not found' }, 404)
  },
}
