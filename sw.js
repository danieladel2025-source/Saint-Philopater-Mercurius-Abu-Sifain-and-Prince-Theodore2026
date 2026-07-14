// ===== Service Worker: نظام كشف غياب الكنيسة =====
const CACHE_VERSION = 'church-attendance-v1';
const CACHE_NAME = `${CACHE_VERSION}`;

// الملفات الأساسية التي يتم تخزينها مسبقًا (App Shell)
const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
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

  const url = new URL(req.url);

  // لا نتدخل في طلبات API الخاصة بـ Supabase - تذهب للشبكة مباشرة
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
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
