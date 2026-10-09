const CACHE_NAME = 'sailing-horta-live-v18-0'

const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/pwa-192.png',
  '/pwa-512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
  '/social-share.jpg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  // Nunca colocar dados Live/Admin/API em cache.
  if (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/admin/api/')
    )
  ) {
    return
  }

  // Navegação: rede primeiro; cache apenas como fallback offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put('/', copy)
          })
          return response
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Assets do próprio site: rede primeiro para receber sempre releases novas.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, copy)
            })
          }
          return response
        })
        .catch(() => caches.match(request)),
    )
  }
})
