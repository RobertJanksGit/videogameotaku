// Cache names
const STATIC_CACHE = "static-v2";
const DYNAMIC_CACHE = "dynamic-v2";
const API_CACHE = "api-v2";
const IMAGE_CACHE = "images-v2";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo.svg",
  "/src/main.jsx",
];

// Cache duration in milliseconds
const CACHE_DURATION = {
  api: 5 * 60 * 1000, // 5 minutes
  dynamic: 24 * 60 * 60 * 1000, // 24 hours
  images: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Install event - cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
      caches.open(IMAGE_CACHE),
      caches.open(API_CACHE),
      caches.open(DYNAMIC_CACHE),
    ])
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(
            (name) =>
              name !== STATIC_CACHE &&
              name !== DYNAMIC_CACHE &&
              name !== API_CACHE &&
              name !== IMAGE_CACHE
          )
          .map((name) => caches.delete(name))
      );
    })
  );
});

// Helper function to determine cache strategy based on request
const getCacheStrategy = (request) => {
  const url = new URL(request.url);

  if (STATIC_ASSETS.includes(url.pathname)) {
    return "static";
  }

  if (url.pathname.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
    return "image";
  }

  if (url.hostname === "firestore.googleapis.com") {
    return "api";
  }

  return "dynamic";
};

// Helper function to determine if cached response is stale
const isResponseStale = (response, strategy) => {
  const dateHeader = response.headers.get("date");
  if (!dateHeader) return true;

  const cachedDate = new Date(dateHeader).getTime();
  const now = new Date().getTime();
  const age = now - cachedDate;

  return age > CACHE_DURATION[strategy];
};

// Fetch event with different strategies based on request type
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  const strategy = getCacheStrategy(event.request);

  // Handle navigation requests differently
  if (event.request.mode === "navigate") {
    event.respondWith(
      // For navigation, try network first then fallback to cache
      fetch(event.request, { cache: "no-store" }).catch(() => {
        return caches
          .match("/index.html")
          .then((response) => response || fetch("/index.html"));
      })
    );
    return;
  }

  switch (strategy) {
    case "static":
      // Cache-first strategy for static assets
      event.respondWith(
        caches
          .match(event.request)
          .then((response) => response || fetch(event.request))
      );
      break;

    case "image":
      // Cache-first strategy with background update for images
      event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            caches
              .open(IMAGE_CACHE)
              .then((cache) =>
                cache.put(event.request, networkResponse.clone())
              );
            return networkResponse;
          });
          return cachedResponse || fetchPromise;
        })
      );
      break;

    case "api":
      // Network-first strategy with cache fallback for API requests
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            const responseClone = response.clone();
            caches
              .open(API_CACHE)
              .then((cache) => cache.put(event.request, responseClone));
            return response;
          })
          .catch(() => {
            return caches.match(event.request).then((cachedResponse) => {
              if (!cachedResponse || isResponseStale(cachedResponse, "api")) {
                return new Response(
                  JSON.stringify({ error: "Network error" }),
                  {
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }
              return cachedResponse;
            });
          })
      );
      break;

    default:
      // Network-first strategy with cache fallback for dynamic content
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches
                .open(DYNAMIC_CACHE)
                .then((cache) => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => {
            return caches.match(event.request).then((cachedResponse) => {
              if (
                !cachedResponse ||
                isResponseStale(cachedResponse, "dynamic")
              ) {
                return caches.match("/index.html"); // Fallback to app shell
              }
              return cachedResponse;
            });
          })
      );
  }
});
