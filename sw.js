// ===== NOVASHOP SERVICE WORKER =====
// PWA + Push Notifications + Offline Support

const CACHE_NAME    = "novashop-v1";
const DYNAMIC_CACHE = "novashop-dynamic-v1";

// الملفات الأساسية التي تُخزَّن مسبقاً
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/products.html",
  "/cart.html",
  "/profile.html",
  "/login.html",
  "/checkout.html",
  "/styles.css",
  "/db.js",
  "/api.js",
  "/store.js",
  "/notifications.js",
  "/manifest.json",
];

// ===== INSTALL: خزّن الملفات الأساسية =====
self.addEventListener("install", event => {
  console.log("[SW] Installing NovaShop Service Worker...");
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn("[SW] Failed to cache:", url, err))
        )
      );
    }).then(() => {
      console.log("[SW] ✅ Static assets cached");
      return self.skipWaiting();
    })
  );
});

// ===== ACTIVATE: احذف الكاش القديم =====
self.addEventListener("activate", event => {
  console.log("[SW] Activating...");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== DYNAMIC_CACHE)
            .map(k => { console.log("[SW] Deleting old cache:", k); return caches.delete(k); })
      )
    ).then(() => {
      console.log("[SW] ✅ Activated");
      return self.clients.claim();
    })
  );
});

// ===== FETCH: استراتيجية Network-First مع Offline Fallback =====
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل طلبات الـ API والـ extensions والـ chrome-extension
  if (
    url.pathname.startsWith("/api/") ||
    request.url.startsWith("chrome-extension") ||
    request.url.includes("googleapis.com/css")
  ) {
    return;
  }

  // للملفات الثابتة: Cache-First
  if (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font"
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(request, clone));
          return response;
        }).catch(() => caches.match("/offline.html"));
      })
    );
    return;
  }

  // للصفحات HTML: Network-First مع Offline Fallback
  if (request.destination === "document" || request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => {
            if (cached) return cached;
            return caches.match("/offline.html") || caches.match("/index.html");
          })
        )
    );
    return;
  }

  // للصور: Cache-First مع تخزين ديناميكي
  if (request.destination === "image") {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(request, clone));
          return response;
        }).catch(() => new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#1e293b"/><text x="150" y="110" text-anchor="middle" fill="#475569" font-size="14">صورة غير متاحة</text></svg>',
          { headers: { "Content-Type": "image/svg+xml" } }
        ));
      })
    );
    return;
  }
});

// ===== PUSH NOTIFICATIONS =====
self.addEventListener("push", event => {
  console.log("[SW] Push received");

  let data = { title: "NovaShop", body: "لديك إشعار جديد!", icon: "/icon-192.png", badge: "/icon-96.png" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body:      data.body,
    icon:      data.icon || "/icon-192.png",
    badge:     data.badge || "/icon-96.png",
    dir:       "rtl",
    lang:      "ar",
    vibrate:   [100, 50, 100],
    data: {
      url:       data.url || "/",
      dateOfArrival: Date.now(),
    },
    actions: data.actions || [
      { action: "open",    title: "فتح المتجر" },
      { action: "dismiss", title: "إغلاق" },
    ],
    requireInteraction: data.requireInteraction || false,
    tag:  data.tag  || "novashop-general",
    renotify: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener("notificationclick", event => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      // إذا في نافذة مفتوحة — وجّهها
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // إذا لا — افتح نافذة جديدة
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

// ===== BACKGROUND SYNC (للطلبات المعلّقة عند عودة الإنترنت) =====
self.addEventListener("sync", event => {
  if (event.tag === "sync-orders") {
    event.waitUntil(syncPendingOrders());
  }
});

async function syncPendingOrders() {
  console.log("[SW] Syncing pending orders...");
  // سيُنفَّذ عند عودة الاتصال
}

// ===== MESSAGE من الصفحة الرئيسية =====
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  // تحديث الـ badge count
  if (event.data?.type === "UPDATE_BADGE") {
    self.registration.setAppBadge?.(event.data.count).catch(() => {});
  }
});

console.log("[SW] NovaShop Service Worker loaded ✅");
