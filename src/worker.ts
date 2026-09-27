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
  positionId?: number
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

async function traccarFetch(
  env: Env,
  path: string,
): Promise<Response> {
  const baseUrl = env.TRACCAR_URL.replace(/\/+$/, '')

  const auth = btoa(
    `${env.TRACCAR_USERNAME}:${env.TRACCAR_PASSWORD}`,
  )

  return fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'sailinghortalive',
      })
    }
if (url.pathname === '/api/events' && request.method === 'GET') {
  const result = await env.DB
    .prepare(`
      SELECT
        id,
        name,
        start_time,
        end_time,
        status,
        created_at,
        updated_at
      FROM events
      ORDER BY start_time ASC, created_at ASC
    `)
    .all()

  return json({
    ok: true,
    events: result.results ?? [],
  })
}

if (url.pathname === '/api/events' && request.method === 'POST') {
  try {
    const body = await request.json() as {
      name?: string
      startTime?: string
      endTime?: string
    }

    const name = body.name?.trim()

    if (!name) {
      return json(
        {
          ok: false,
          error: 'Nome da regata obrigatório',
        },
        400,
      )
    }

    const id = crypto.randomUUID()

    await env.DB
      .prepare(`
        INSERT INTO events (
          id,
          name,
          start_time,
          end_time,
          status
        )
        VALUES (?, ?, ?, ?, 'scheduled')
      `)
      .bind(
        id,
        name,
        body.startTime ?? null,
        body.endTime ?? null,
      )
      .run()

    return json(
      {
        ok: true,
        id,
      },
      201,
    )
  } catch (error) {
    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Erro ao criar regata',
      },
      500,
    )
  }
}
    if (url.pathname === '/api/live') {
      try {
        const [devicesResponse, positionsResponse] =
          await Promise.all([
            traccarFetch(env, '/api/devices'),
            traccarFetch(env, '/api/positions'),
          ])

        if (!devicesResponse.ok) {
          return json(
            {
              ok: false,
              source: 'devices',
              status: devicesResponse.status,
            },
            502,
          )
        }

        if (!positionsResponse.ok) {
          return json(
            {
              ok: false,
              source: 'positions',
              status: positionsResponse.status,
            },
            502,
          )
        }

        const devices =
          (await devicesResponse.json()) as TraccarDevice[]

        const positions =
          (await positionsResponse.json()) as TraccarPosition[]

        const positionByDevice = new Map(
          positions.map((position) => [
            position.deviceId,
            position,
          ]),
        )

        const MAX_POSITION_AGE_MS = 10 * 60 * 1000

const now = Date.now()

const boats = devices
  .map((device) => {
    const position = positionByDevice.get(device.id)

    if (!position) {
      return null
    }

    const positionTime =
      position.fixTime ??
      position.deviceTime ??
      position.serverTime ??
      null

    if (!positionTime) {
      return null
    }

    const ageMs = now - new Date(positionTime).getTime()

    if (
      !Number.isFinite(ageMs) ||
      ageMs > MAX_POSITION_AGE_MS
    ) {
      return null
    }

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

        return json({
          ok: true,
          updatedAt: new Date().toISOString(),
          boats,
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Unknown error',
          },
          500,
        )
      }
    }

    return json(
      {
        ok: false,
        error: 'Not found',
      },
      404,
    )
  },
}
