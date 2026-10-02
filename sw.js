// ===== Service Worker: نظام كشف غياب الكنيسة =====
const CACHE_VERSION = 'church-attendance-v7'; // رفع الإصدار يجبر الأجهزة على جلب الملفات المُحدّثة
const CACHE_NAME = `${CACHE_VERSION}`;

// الملفات الأساسية التي يتم تخزينها مسبقًا (App Shell)
const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
  './library.html',
  './manifest.json',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

// ----- التثبيت: تخزين الملفات الأساسية -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => console.warn('تعذر تخزين:', url, err))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// ----- التفعيل: حذف الكاشات القديمة -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ----- الجلب: -----
// - طلبات Supabase (API/بيانات): شبكة أولاً دائمًا (لا يجب تخزين بيانات حساسة/متغيرة)
// - باقي الملفات (App Shell وخطوط ومكتبات CDN): Cache أولًا مع تحديث في الخلفية
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;
  // طلبات Range (تشغيل الصوت/الفيديو) لا يجوز تخزينها — نتركها للشبكة
  if (req.headers.has('range')) return;

  const url = new URL(req.url);

  // لا نتدخل في طلبات API الخاصة بـ Supabase - تذهب للشبكة مباشرة
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    return;
  }

  // خرائط جوجل (الخريطة المضمّنة في بطاقة البيانات) تذهب للشبكة مباشرة ولا تُخزَّن
  if (url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          // خزّن نسخة محدثة فقط لو الرد سليم
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse); // عند فشل الشبكة، استخدم النسخة المخزنة إن وُجدت

      // إن وُجدت نسخة مخزنة أعدها فورًا (سرعة) وحدّث الكاش بالخلفية
      return cachedResponse || fetchPromise;
    })
  );
});

// ----- استقبال أوامر من الصفحة (مثل تحديث فوري) -----
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// =====================================================================
//  إشعارات أعياد الميلاد (كانت سابقاً داخل Blob في index.html)
// =====================================================================
self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d) return;

  if (d.type === 'SCHEDULE_BIRTHDAY_NOTIFS') {
    scheduleBirthdayNotifications(d.people);
  }

  if (d.type === 'SEND_NOW') {
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: d.icon || './icons/icon-192.png',
      badge: d.badge || './icons/icon-192.png',
      tag: d.tag || 'birthday',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      requireInteraction: false
    });
  }
});

function scheduleBirthdayNotifications(people) {
  if (!people || !people.length) return;
  const now = Date.now();

  people.forEach((person) => {
    person.triggers.forEach((trigger) => {
      const delay = trigger.ts - now;
      if (delay > 0 && delay < 8 * 24 * 60 * 60 * 1000) {
        // setTimeout تعمل طالما الـ SW نشط (المتصفح قد يوقفه، فالصفحة تعيد الجدولة عند كل فتح)
        setTimeout(() => {
          self.registration.showNotification(trigger.title, {
            body: trigger.body,
            icon: trigger.icon || './icons/icon-192.png',
            tag: trigger.tag,
            dir: 'rtl',
            lang: 'ar',
            vibrate: [200, 100, 200, 100, 200],
            requireInteraction: true
          });
        }, delay);
      }
    });
  });
}

// فتح التطبيق عند الضغط على الإشعار
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      if (cls.length > 0) return cls[0].focus();
      return clients.openWindow(self.registration.scope);
    })
  );
});
