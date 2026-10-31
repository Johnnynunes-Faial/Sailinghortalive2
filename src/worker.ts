interface Env {
  TRACCAR_URL: string
  TRACCAR_USERNAME: string
  TRACCAR_PASSWORD: string
  UNKNOWN_MONITOR_URL?: string
  UNKNOWN_MONITOR_KEY?: string
  WINDY_WEBCAMS_KEY?: string
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


async function ensureCourseRoundingColumn(
  env: Env,
) {
  const columns = await env.DB.prepare(`
    PRAGMA table_info(course_points)
  `).all<{
    name: string
  }>()

  const hasColumn =
    (columns.results ?? []).some(
      (column) =>
        column.name === 'rounding_side',
    )

  if (!hasColumn) {
    await env.DB.prepare(`
      ALTER TABLE course_points
      ADD COLUMN rounding_side TEXT
    `).run()
  }
}


async function ensureBoatSettingsTable(
  env: Env,
) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS boat_settings (
      traccar_device_id INTEGER PRIMARY KEY,
      color TEXT,
      skipper TEXT,
      time_handicap REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  const columns = await env.DB.prepare(`
    PRAGMA table_info(boat_settings)
  `).all<{ name: string }>()

  const names = new Set(
    (columns.results ?? []).map(
      (column) => column.name,
    ),
  )

  if (!names.has('skipper')) {
    try {
      await env.DB.prepare(`
        ALTER TABLE boat_settings
        ADD COLUMN skipper TEXT
      `).run()
    } catch {
      // Outra invocação pode ter criado a coluna em simultâneo.
    }
  }

  if (!names.has('time_handicap')) {
    try {
      await env.DB.prepare(`
        ALTER TABLE boat_settings
        ADD COLUMN time_handicap REAL
      `).run()
    } catch {
      // Outra invocação pode ter criado a coluna em simultâneo.
    }
  }
}

async function ensureEventTimingEnabledColumn(
  env: Env,
) {
  const columns = await env.DB.prepare(`
    PRAGMA table_info(events)
  `).all<{
    name: string
  }>()

  const hasColumn =
    (columns.results ?? []).some(
      (column) =>
        column.name === 'timing_enabled',
    )

  if (!hasColumn) {
    try {
      await env.DB.prepare(`
        ALTER TABLE events
        ADD COLUMN timing_enabled INTEGER NOT NULL DEFAULT 0
      `).run()
    } catch {
      // Outra invocação pode ter criado a coluna em simultâneo.
    }
  }
}

async function ensureRaceTimingTables(
  env: Env,
) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS race_live_state (
      event_id TEXT NOT NULL,
      traccar_device_id INTEGER NOT NULL,
      last_latitude REAL NOT NULL,
      last_longitude REAL NOT NULL,
      last_fix_time TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (
        event_id,
        traccar_device_id
      )
    )
  `).run()

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS race_finishes (
      event_id TEXT NOT NULL,
      traccar_device_id INTEGER NOT NULL,
      finish_time TEXT NOT NULL,
      elapsed_seconds REAL NOT NULL,
      corrected_seconds REAL NOT NULL,
      handicap REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (
        event_id,
        traccar_device_id
      )
    )
  `).run()
}

function segmentIntersectionFraction(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  cLat: number,
  cLon: number,
  dLat: number,
  dLon: number,
) {
  const rx = bLon - aLon
  const ry = bLat - aLat
  const sx = dLon - cLon
  const sy = dLat - cLat

  const cross = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) => ax * by - ay * bx

  const denominator =
    cross(rx, ry, sx, sy)

  if (Math.abs(denominator) < 1e-12) {
    return null
  }

  const qpx = cLon - aLon
  const qpy = cLat - aLat

  const t =
    cross(qpx, qpy, sx, sy) /
    denominator

  const u =
    cross(qpx, qpy, rx, ry) /
    denominator

  if (
    t < 0 ||
    t > 1 ||
    u < 0 ||
    u > 1
  ) {
    return null
  }

  return t
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
      url.pathname === '/api/wind-stations' &&
      request.method === 'GET'
    ) {
      try {
        const stationNames: Record<string, string> = {
          LPAZ: 'Santa Maria',
          LPPD: 'Ponta Delgada',
          LPLA: 'Lajes',
          LPHR: 'Horta',
          LPPI: 'Pico',
          LPSJ: 'São Jorge',
          LPGR: 'Graciosa',
          LPFL: 'Flores',
          LPCR: 'Corvo',
        }

        const ids = Object.keys(stationNames).join(',')

        const response = await fetch(
          `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'SailingHortaLive/1.0 sailinghortalive.com',
            },
            cf: {
              cacheTtl: 300,
              cacheEverything: true,
            },
          } as RequestInit,
        )

        if (response.status === 204) {
          return json({ ok: true, stations: [] })
        }

        if (!response.ok) {
          return json(
            { ok: false, error: `METAR HTTP ${response.status}` },
            502,
          )
        }

        const data = await response.json() as Array<any>

        const stations = (Array.isArray(data) ? data : [])
          .map((item) => {
            const id = String(item.icaoId ?? '').toUpperCase()
            const latitude = Number(item.lat)
            const longitude = Number(item.lon)
            const windSpeed = Number(item.wspd ?? 0)
            const windGust = Number(item.wgst ?? 0)

            const windDirection =
              item.wdir === 'VRB'
                ? null
                : Number(item.wdir)

            let observedAt: string | null = null
            const rawTime = item.obsTime ?? item.reportTime ?? null

            if (typeof rawTime === 'number') {
              observedAt = new Date(
                rawTime > 10_000_000_000 ? rawTime : rawTime * 1000,
              ).toISOString()
            } else if (rawTime) {
              observedAt = String(rawTime)
            }

            return {
              id,
              name: stationNames[id] ?? id,
              latitude,
              longitude,
              windDirection:
                Number.isFinite(windDirection as number)
                  ? windDirection
                  : null,
              variableWind: item.wdir === 'VRB',
              windSpeed: Number.isFinite(windSpeed) ? windSpeed : 0,
              windGust: Number.isFinite(windGust) ? windGust : 0,
              temperature:
                Number.isFinite(Number(item.temp))
                  ? Number(item.temp)
                  : null,
              observedAt,
              rawMetar: String(item.rawOb ?? ''),
            }
          })
          .filter(
            (station) =>
              station.id &&
              Number.isFinite(station.latitude) &&
              Number.isFinite(station.longitude),
          )

        return json({
          ok: true,
          source: 'AviationWeather.gov METAR',
          stations,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao carregar METAR.',
          },
          500,
        )
      }
    }

    if (
      url.pathname === '/api/webcams' &&
      request.method === 'GET'
    ) {
      try {
        const apiKey =
          env.WINDY_WEBCAMS_KEY?.trim()

        if (!apiKey) {
          return json(
            {
              ok: false,
              error:
                'Webcams Windy não configuradas.',
            },
            503,
          )
        }

        const north =
          Number(url.searchParams.get('north'))
        const east =
          Number(url.searchParams.get('east'))
        const south =
          Number(url.searchParams.get('south'))
        const west =
          Number(url.searchParams.get('west'))

        if (
          ![
            north,
            east,
            south,
            west,
          ].every(Number.isFinite)
        ) {
          return json(
            {
              ok: false,
              error:
                'Área do mapa inválida.',
            },
            400,
          )
        }

        const params =
          new URLSearchParams({
            bbox:
              `${north},${east},${south},${west}`,
            include:
              'images,location,player,urls',
            lang: 'pt',
            limit: '20',
          })

        const response = await fetch(
          `https://api.windy.com/webcams/api/v3/webcams?${params.toString()}`,
          {
            headers: {
              'X-WINDY-API-KEY':
                apiKey,
              Accept: 'application/json',
            },
          },
        )

        if (!response.ok) {
          return json(
            {
              ok: false,
              error:
                `Windy Webcams HTTP ${response.status}`,
            },
            502,
          )
        }

        const data =
          await response.json() as {
            webcams?: Array<{
              webcamId?: number
              status?: string
              title?: string
              lastUpdatedOn?: string
              location?: {
                city?: string
                region?: string
                country?: string
                latitude?: number
                longitude?: number
              }
              images?: {
                current?: Record<
                  string,
                  string
                >
              }
              player?: Record<
                string,
                string
              >
              urls?: {
                detail?: string
              }
            }>
          }

        const webcams =
          (data.webcams ?? [])
            .filter((webcam) => {
              const lat =
                Number(
                  webcam.location
                    ?.latitude,
                )
              const lon =
                Number(
                  webcam.location
                    ?.longitude,
                )

              return (
                webcam.status !==
                  'inactive' &&
                Number.isFinite(lat) &&
                Number.isFinite(lon)
              )
            })
            .map((webcam) => {
              const images =
                webcam.images?.current ??
                {}

              const imageUrl =
                images.preview ??
                images.thumbnail ??
                images.icon ??
                Object.values(images)[0] ??
                null

              const playerUrl =
                webcam.player?.live ??
                webcam.player?.day ??
                null

              return {
                id:
                  Number(
                    webcam.webcamId,
                  ),
                title:
                  String(
                    webcam.title ??
                      'Webcam',
                  ),
                latitude:
                  Number(
                    webcam.location
                      ?.latitude,
                  ),
                longitude:
                  Number(
                    webcam.location
                      ?.longitude,
                  ),
                city:
                  String(
                    webcam.location
                      ?.city ?? '',
                  ),
                region:
                  String(
                    webcam.location
                      ?.region ?? '',
                  ),
                imageUrl,
                detailUrl:
                  webcam.urls?.detail ??
                  null,
                playerUrl,
                lastUpdatedOn:
                  webcam.lastUpdatedOn ??
                  null,
              }
            })

        return json({
          ok: true,
          webcams,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao carregar webcams.',
          },
          500,
        )
      }
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

    if (
      url.pathname === '/admin/api/unknown-devices' &&
      request.method === 'DELETE'
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

        const body = await request.json() as {
          identifier?: string
        }

        const identifier =
          String(body.identifier ?? '').trim()

        if (!identifier) {
          return json(
            {
              ok: false,
              error:
                'Identificador obrigatório.',
            },
            400,
          )
        }

        const response = await fetch(
          monitorUrl,
          {
            method: 'POST',
            headers: {
              'X-Monitor-Key': monitorKey,
              'content-type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              action: 'delete',
              identifier,
            }),
          },
        )

        const data = await response.json() as {
          ok?: boolean
          error?: string
        }

        if (!response.ok || !data.ok) {
          return json(
            {
              ok: false,
              error:
                data.error ||
                `Monitor local respondeu HTTP ${response.status}.`,
            },
            response.status === 404
              ? 404
              : 502,
          )
        }

        return json({
          ok: true,
          identifier,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao remover dispositivo.',
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
        await ensureEventTimingEnabledColumn(env)

        const result = await env.DB.prepare(`
          SELECT id, name, start_time, end_time, status, timing_enabled, created_at, updated_at
          FROM events
          ORDER BY start_time ASC, created_at ASC
        `).all()

        const events = (result.results ?? []).map((event: any) => {
          const {
            timing_enabled,
            ...rest
          } = event

          return {
            ...rest,
            status: effectiveEventStatus(event),
            timingEnabled:
              Number(timing_enabled) === 1,
          }
        })

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

        await ensureCourseRoundingColumn(env)

        const course = await env.DB.prepare(`
          SELECT
            id,
            event_id,
            point_type,
            name,
            latitude,
            longitude,
            point_order,
            rounding_side
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

        await ensureEventTimingEnabledColumn(env)

        const event = await env.DB.prepare(`
          SELECT
            id,
            name,
            start_time,
            end_time,
            status,
            timing_enabled
          FROM events
          WHERE id = ?
        `).bind(eventId).first<{
          id: string
          name: string
          start_time: string | null
          end_time: string | null
          status: string
          timing_enabled: number
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

        const eventStatus =
          effectiveEventStatus(event)

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

        const participantRows =
          participants.results ?? []

        const allowedIds = new Set(
          participantRows.map(
            (row) =>
              Number(row.traccar_device_id),
          ),
        )

        const allActiveBoats =
          await getActiveBoats(env)

        const participantNameByDevice =
          new Map(
            participantRows.map(
              (row) => [
                Number(
                  row.traccar_device_id,
                ),
                String(
                  row.boat_name ?? '',
                ).trim(),
              ],
            ),
          )

        const boats =
          allActiveBoats
            .filter(
              (boat) =>
                allowedIds.has(boat.id),
            )
            .map((boat) => ({
              ...boat,
              name:
                participantNameByDevice.get(
                  boat.id,
                ) ||
                boat.name,
            }))

        await ensureCourseRoundingColumn(env)

        const course = await env.DB.prepare(`
          SELECT id, event_id, point_type, name, latitude, longitude, point_order, rounding_side
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
        `).bind(eventId).all<{
          id: number
          event_id: string
          line_type: 'start' | 'finish'
          a_latitude: number
          a_longitude: number
          b_latitude: number
          b_longitude: number
        }>()

        let raceTiming: {
          startUtc: string | null
          finishLineReady: boolean
          entries: Array<{
            deviceId: number
            boatName: string
            skipper: string | null
            handicap: number
            color: string | null
            speed: number | null
            finished: boolean
            finishTime: string | null
            elapsedSeconds: number | null
            correctedSeconds: number | null
          }>
        } | null = null

        if (
          eventStatus === 'live' &&
          Number(event.timing_enabled) === 1
        ) {
          await ensureBoatSettingsTable(env)
          await ensureRaceTimingTables(env)

          const startUtc =
            azoresLocalToUtcIso(
              event.start_time,
            )

          const finishLine =
            (lines.results ?? []).find(
              (line) =>
                line.line_type === 'finish',
            ) ?? null

          const settings =
            await env.DB.prepare(`
              SELECT
                traccar_device_id,
                color,
                skipper,
                time_handicap
              FROM boat_settings
            `).all<{
              traccar_device_id: number
              color: string | null
              skipper: string | null
              time_handicap: number | null
            }>()

          const settingsByDevice =
            new Map(
              (settings.results ?? []).map(
                (row) => [
                  Number(
                    row.traccar_device_id,
                  ),
                  row,
                ],
              ),
            )

          const finishRows =
            await env.DB.prepare(`
              SELECT
                traccar_device_id,
                finish_time,
                elapsed_seconds,
                corrected_seconds,
                handicap
              FROM race_finishes
              WHERE event_id = ?
            `).bind(eventId).all<{
              traccar_device_id: number
              finish_time: string
              elapsed_seconds: number
              corrected_seconds: number
              handicap: number
            }>()

          const finishByDevice =
            new Map(
              (finishRows.results ?? []).map(
                (row) => [
                  Number(
                    row.traccar_device_id,
                  ),
                  row,
                ],
              ),
            )

          const stateRows =
            await env.DB.prepare(`
              SELECT
                traccar_device_id,
                last_latitude,
                last_longitude,
                last_fix_time
              FROM race_live_state
              WHERE event_id = ?
            `).bind(eventId).all<{
              traccar_device_id: number
              last_latitude: number
              last_longitude: number
              last_fix_time: string
            }>()

          const stateByDevice =
            new Map(
              (stateRows.results ?? []).map(
                (row) => [
                  Number(
                    row.traccar_device_id,
                  ),
                  row,
                ],
              ),
            )

          const activeBoatByDevice =
            new Map(
              boats.map(
                (boat) => [
                  boat.id,
                  boat,
                ],
              ),
            )

          const startMs =
            startUtc
              ? new Date(startUtc).getTime()
              : Number.NaN

          // Evita falsas chegadas quando a linha de largada
          // e a linha de chegada são a mesma (ou coincidentes).
          // O relógio da regata começa na hora oficial, mas
          // só aceitamos cruzamentos de chegada 10 minutos depois.
          const FINISH_GRACE_MS =
            10 * 60 * 1000

          const finishDetectionStartMs =
            Number.isFinite(startMs)
              ? startMs + FINISH_GRACE_MS
              : Number.NaN

          const entries = []

          for (
            const participant of
            participantRows
          ) {
            const deviceId =
              Number(
                participant.traccar_device_id,
              )

            const setting =
              settingsByDevice.get(
                deviceId,
              )

            const handicapValue =
              Number(
                setting?.time_handicap,
              )

            const handicap =
              Number.isFinite(
                handicapValue,
              ) &&
              handicapValue > 0
                ? handicapValue
                : 1

            const boat =
              activeBoatByDevice.get(
                deviceId,
              )

            let finish =
              finishByDevice.get(
                deviceId,
              ) ?? null

            if (
              !finish &&
              finishLine &&
              boat?.position &&
              Number.isFinite(startMs)
            ) {
              const currentFix =
                boat.position.fixTime

              const currentMs =
                currentFix
                  ? new Date(
                      currentFix,
                    ).getTime()
                  : Number.NaN

              const previous =
                stateByDevice.get(
                  deviceId,
                )

              if (
                !previous &&
                boat?.position &&
                startUtc &&
                Number.isFinite(
                  currentMs,
                ) &&
                currentMs >= startMs
              ) {
                const history =
                  await getReplayTrackForDevice(
                    env,
                    deviceId,
                    startUtc,
                    currentFix ??
                      new Date(
                        currentMs,
                      ).toISOString(),
                  )

                const historyPositions =
                  history.ok
                    ? history.positions
                    : []

                for (
                  let index = 1;
                  index <
                  historyPositions.length;
                  index++
                ) {
                  const before =
                    historyPositions[
                      index - 1
                    ]

                  const after =
                    historyPositions[
                      index
                    ]

                  const beforeTime =
                    new Date(
                      before.fixTime ??
                        before.deviceTime ??
                        before.serverTime ??
                        0,
                    ).getTime()

                  const afterTime =
                    new Date(
                      after.fixTime ??
                        after.deviceTime ??
                        after.serverTime ??
                        0,
                    ).getTime()

                  if (
                    !Number.isFinite(
                      beforeTime,
                    ) ||
                    !Number.isFinite(
                      afterTime,
                    ) ||
                    beforeTime <
                      startMs ||
                    afterTime <
                      finishDetectionStartMs ||
                    afterTime <=
                      beforeTime
                  ) {
                    continue
                  }

                  const fraction =
                    segmentIntersectionFraction(
                      before.latitude,
                      before.longitude,
                      after.latitude,
                      after.longitude,
                      Number(
                        finishLine.a_latitude,
                      ),
                      Number(
                        finishLine.a_longitude,
                      ),
                      Number(
                        finishLine.b_latitude,
                      ),
                      Number(
                        finishLine.b_longitude,
                      ),
                    )

                  if (
                    fraction === null
                  ) {
                    continue
                  }

                  const finishMs =
                    beforeTime +
                    (
                      afterTime -
                      beforeTime
                    ) *
                      fraction

                  if (
                    finishMs <
                    finishDetectionStartMs
                  ) {
                    continue
                  }

                  const elapsedSeconds =
                    Math.max(
                      0,
                      (
                        finishMs -
                        startMs
                      ) /
                        1000,
                    )

                  const correctedSeconds =
                    elapsedSeconds *
                    handicap

                  const finishTime =
                    new Date(
                      finishMs,
                    ).toISOString()

                  await env.DB.prepare(`
                    INSERT OR IGNORE INTO race_finishes (
                      event_id,
                      traccar_device_id,
                      finish_time,
                      elapsed_seconds,
                      corrected_seconds,
                      handicap
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).bind(
                    eventId,
                    deviceId,
                    finishTime,
                    elapsedSeconds,
                    correctedSeconds,
                    handicap,
                  ).run()

                  finish = {
                    traccar_device_id:
                      deviceId,
                    finish_time:
                      finishTime,
                    elapsed_seconds:
                      elapsedSeconds,
                    corrected_seconds:
                      correctedSeconds,
                    handicap,
                  }

                  finishByDevice.set(
                    deviceId,
                    finish,
                  )

                  break
                }
              }

              if (
                !finish &&
                previous &&
                Number.isFinite(
                  currentMs,
                )
              ) {
                const previousMs =
                  new Date(
                    previous.last_fix_time,
                  ).getTime()

                const gapMs =
                  currentMs -
                  previousMs

                if (
                  Number.isFinite(
                    previousMs,
                  ) &&
                  previousMs >= startMs &&
                  currentMs >=
                    finishDetectionStartMs &&
                  gapMs > 0 &&
                  gapMs <= 60 * 1000
                ) {
                  const fraction =
                    segmentIntersectionFraction(
                      previous.last_latitude,
                      previous.last_longitude,
                      boat.position.latitude,
                      boat.position.longitude,
                      Number(
                        finishLine.a_latitude,
                      ),
                      Number(
                        finishLine.a_longitude,
                      ),
                      Number(
                        finishLine.b_latitude,
                      ),
                      Number(
                        finishLine.b_longitude,
                      ),
                    )

                  if (
                    fraction !== null
                  ) {
                    const finishMs =
                      previousMs +
                      gapMs *
                        fraction

                    if (
                      finishMs >=
                      finishDetectionStartMs
                    ) {
                      const elapsedSeconds =
                        Math.max(
                          0,
                          (
                            finishMs -
                            startMs
                          ) /
                            1000,
                        )

                      const correctedSeconds =
                        elapsedSeconds *
                        handicap

                      const finishTime =
                        new Date(
                          finishMs,
                        ).toISOString()

                      await env.DB.prepare(`
                        INSERT OR IGNORE INTO race_finishes (
                          event_id,
                          traccar_device_id,
                          finish_time,
                          elapsed_seconds,
                          corrected_seconds,
                          handicap
                        )
                        VALUES (?, ?, ?, ?, ?, ?)
                      `).bind(
                        eventId,
                        deviceId,
                        finishTime,
                        elapsedSeconds,
                        correctedSeconds,
                        handicap,
                      ).run()

                      finish = {
                        traccar_device_id:
                          deviceId,
                        finish_time:
                          finishTime,
                        elapsed_seconds:
                          elapsedSeconds,
                        corrected_seconds:
                          correctedSeconds,
                        handicap,
                      }

                      finishByDevice.set(
                        deviceId,
                        finish,
                      )
                    }
                  }
                }
              }

              if (
                Number.isFinite(
                  currentMs,
                )
              ) {
                const previousMs =
                  previous
                    ? new Date(
                        previous.last_fix_time,
                      ).getTime()
                    : Number.NaN

                const shouldStore =
                  !Number.isFinite(
                    previousMs,
                  ) ||
                  currentMs -
                    previousMs >=
                    5000 ||
                  finish !== null

                if (shouldStore) {
                  await env.DB.prepare(`
                    INSERT INTO race_live_state (
                      event_id,
                      traccar_device_id,
                      last_latitude,
                      last_longitude,
                      last_fix_time,
                      updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT (
                      event_id,
                      traccar_device_id
                    )
                    DO UPDATE SET
                      last_latitude =
                        excluded.last_latitude,
                      last_longitude =
                        excluded.last_longitude,
                      last_fix_time =
                        excluded.last_fix_time,
                      updated_at =
                        CURRENT_TIMESTAMP
                  `).bind(
                    eventId,
                    deviceId,
                    boat.position.latitude,
                    boat.position.longitude,
                    currentFix,
                  ).run()
                }
              }
            }

            entries.push({
              deviceId,
              boatName:
                participant.boat_name,
              skipper:
                setting?.skipper ??
                null,
              handicap,
              color:
                setting?.color ??
                null,
              speed:
                boat?.position
                  ? Number(
                      boat.position.speed ??
                        0,
                    )
                  : null,
              finished:
                finish !== null,
              finishTime:
                finish?.finish_time ??
                null,
              elapsedSeconds:
                finish
                  ? Number(
                      finish.elapsed_seconds,
                    )
                  : null,
              correctedSeconds:
                finish
                  ? Number(
                      finish.corrected_seconds,
                    )
                  : null,
            })
          }

          raceTiming = {
            startUtc,
            finishLineReady:
              finishLine !== null,
            entries,
          }
        }

        return json({
          ok: true,
          eventId,
          eventStatus,
          updatedAt: new Date().toISOString(),
          boats,
          course: course.results ?? [],
          lines: lines.results ?? [],
          raceTiming,
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

    const eventTimingMatch = url.pathname.match(
      /^\/admin\/api\/events\/([^/]+)\/timing$/,
    )

    if (
      eventTimingMatch &&
      request.method === 'PUT'
    ) {
      try {
        const eventId =
          eventTimingMatch[1]

        const body =
          await request.json() as {
            enabled?: boolean
          }

        if (
          typeof body.enabled !==
          'boolean'
        ) {
          return json(
            {
              ok: false,
              error:
                'Estado dos tempos compensados inválido',
            },
            400,
          )
        }

        await ensureEventTimingEnabledColumn(
          env,
        )

        const existingEvent =
          await env.DB.prepare(`
            SELECT id
            FROM events
            WHERE id = ?
          `).bind(
            eventId,
          ).first()

        if (!existingEvent) {
          return json(
            {
              ok: false,
              error:
                'Regata não encontrada',
            },
            404,
          )
        }

        await env.DB.prepare(`
          UPDATE events
          SET
            timing_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          body.enabled ? 1 : 0,
          eventId,
        ).run()

        return json({
          ok: true,
          timingEnabled:
            body.enabled,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Erro ao alterar tempos compensados',
          },
          500,
        )
      }
    }

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
        await ensureRaceTimingTables(env)

        await env.DB.batch([
          env.DB.prepare(`DELETE FROM event_participants WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM course_points WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM course_lines WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM race_live_state WHERE event_id = ?`).bind(eventId),
          env.DB.prepare(`DELETE FROM race_finishes WHERE event_id = ?`).bind(eventId),
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
          SELECT
            traccar_device_id,
            color,
            skipper,
            time_handicap
          FROM boat_settings
        `).all<{
          traccar_device_id: number
          color: string | null
          skipper: string | null
          time_handicap: number | null
        }>()

        const settingsByDevice = new Map(
          (settings.results ?? []).map((row) => [
            Number(row.traccar_device_id),
            row,
          ]),
        )

        const cleanDevices = devices
          .map((device) => {
            const setting =
              settingsByDevice.get(device.id)

            return {
              id: device.id,
              name: device.name,
              uniqueId: device.uniqueId,
              status: device.status ?? 'unknown',
              lastUpdate: device.lastUpdate ?? null,
              color: setting?.color ?? null,
              skipper: setting?.skipper ?? null,
              timeHandicap:
                setting?.time_handicap ?? 1,
            }
          })
          .sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }))

        return json({ ok: true, devices: cleanDevices })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar barcos' }, 500)
      }
    }

    const deviceSettingsMatch = url.pathname.match(
      /^\/admin\/api\/devices\/(\d+)\/settings$/,
    )

    if (deviceSettingsMatch && request.method === 'PUT') {
      try {
        const deviceId =
          Number(deviceSettingsMatch[1])

        if (
          !Number.isInteger(deviceId) ||
          deviceId <= 0
        ) {
          return json(
            {
              ok: false,
              error: 'ID de barco inválido',
            },
            400,
          )
        }

        const body =
          await request.json() as {
            color?: string | null
            skipper?: string | null
            timeHandicap?: number | null
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

        const skipperText =
          body.skipper == null
            ? ''
            : String(
                body.skipper,
              ).trim()

        const skipper =
          skipperText
            ? skipperText.slice(0, 100)
            : null

        const handicapRaw =
          Number(
            body.timeHandicap,
          )

        const timeHandicap =
          Number.isFinite(
            handicapRaw,
          )
            ? handicapRaw
            : 1

        if (
          timeHandicap < 0.1 ||
          timeHandicap > 3
        ) {
          return json(
            {
              ok: false,
              error:
                'O handicap deve estar entre 0,100 e 3,000.',
            },
            400,
          )
        }

        await ensureBoatSettingsTable(env)

        await env.DB.prepare(`
          INSERT INTO boat_settings (
            traccar_device_id,
            color,
            skipper,
            time_handicap,
            updated_at
          )
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(traccar_device_id)
          DO UPDATE SET
            color = excluded.color,
            skipper = excluded.skipper,
            time_handicap =
              excluded.time_handicap,
            updated_at =
              CURRENT_TIMESTAMP
        `).bind(
          deviceId,
          color
            ? color.toLowerCase()
            : null,
          skipper,
          timeHandicap,
        ).run()

        return json({
          ok: true,
          deviceId,
          color:
            color
              ? color.toLowerCase()
              : null,
          skipper,
          timeHandicap,
        })
      } catch (error) {
        return json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao guardar configuração do barco',
        }, 500)
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
          color === null
            ? null
            : color.toLowerCase(),
        ).run()

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
          ? body.participants.map(
              (participant) => ({
                traccarDeviceId:
                  Number(
                    participant.traccarDeviceId,
                  ),
                boatName:
                  String(
                    participant.boatName ??
                      '',
                  ).trim(),
              }),
            )
          : []

        const invalidParticipant =
          participants.find(
            (participant) =>
              !Number.isInteger(
                participant.traccarDeviceId,
              ) ||
              participant.traccarDeviceId <= 0 ||
              !participant.boatName,
          )

        if (invalidParticipant) {
          return json(
            {
              ok: false,
              error:
                'Todos os participantes precisam de um barco e de um nome nesta regata.',
            },
            400,
          )
        }

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
        await ensureCourseRoundingColumn(env)

        const eventId = courseMatch[1]
        const result = await env.DB.prepare(`
          SELECT id, event_id, point_type, name, latitude, longitude, point_order, rounding_side
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
        await ensureCourseRoundingColumn(env)

        const eventId = courseMatch[1]
        const body = await request.json() as {
          points?: Array<{
            pointType: string
            name?: string
            latitude: number
            longitude: number
            pointOrder: number
            roundingSide?: 'port' | 'starboard' | null
          }>
        }

        const points = Array.isArray(body.points) ? body.points : []

        const statements = [
          env.DB.prepare(`DELETE FROM course_points WHERE event_id = ?`).bind(eventId),
          ...points.map((point) =>
            env.DB.prepare(`
              INSERT INTO course_points (
                event_id,
                point_type,
                name,
                latitude,
                longitude,
                point_order,
                rounding_side
              )
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(
              eventId,
              point.pointType,
              point.name ?? null,
              point.latitude,
              point.longitude,
              point.pointOrder,
              point.pointType === 'buoy' &&
              (
                point.roundingSide === 'port' ||
                point.roundingSide === 'starboard'
              )
                ? point.roundingSide
                : null,
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
