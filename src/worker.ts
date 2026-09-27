interface Env {
  TRACCAR_URL: string
  TRACCAR_USERNAME: string
  TRACCAR_PASSWORD: string
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'sailinghortalive' })
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
      try {
        const result = await env.DB.prepare(`
          SELECT id, name, start_time, end_time, status, created_at, updated_at
          FROM events
          ORDER BY start_time ASC, created_at ASC
        `).all()

        return json({ ok: true, events: result.results ?? [] })
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

        const cleanDevices = devices
          .map((device) => ({
            id: device.id,
            name: device.name,
            uniqueId: device.uniqueId,
            status: device.status ?? 'unknown',
            lastUpdate: device.lastUpdate ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }))

        return json({ ok: true, devices: cleanDevices })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao carregar barcos' }, 500)
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
