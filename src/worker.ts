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

        return json({
          ok: true,
          eventId,
          updatedAt: new Date().toISOString(),
          boats,
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
            DELETE FROM event_participants
            WHERE event_id = ?
          `).bind(eventId),

          ...participants.map((participant) =>
            env.DB.prepare(`
              INSERT INTO event_participants (
                event_id,
                traccar_device_id,
                boat_name
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

    return json({ ok: false, error: 'Not found' }, 404)
  },
}
