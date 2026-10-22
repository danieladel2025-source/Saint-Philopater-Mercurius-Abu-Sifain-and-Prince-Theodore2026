// =====================================================================
//  🔔 push-client.js — تسجيل الجهاز في Web Push ليصله الإشعار والتطبيق مغلق
//
//  يعمل تلقائياً: بمجرد أن يكون إذن الإشعارات "مسموح" (من أي زر/نافذة موجودة
//  في التطبيق) يشترك الجهاز ويرسل اشتراكه + إعداداته (تنبيه التحضير) للسحابة.
//
//  PushClient.init({
//    role: 'servant' | 'admin',
//    getClient: () => supabaseClient | null,   // null = لم يُسجَّل الدخول بعد
//    getChapterId: () => 'chapter-id',         // للخدام فقط
//    getName: () => 'اسم صاحب الجهاز'          // لعدم إرسال رسائله له (اختياري)
//  });
//  PushClient.test(15)   // إشعار تجريبي من السيرفر بعد 15 ثانية (أغلق التطبيق وانتظر)
//  PushClient.status()   // حالة نصية للتشخيص
// =====================================================================
(function (root) {
  'use strict';

  var FN = 'push-notify';
  // المفتاح يُحفظ لكل مشروع Supabase على حدة (حتى لا يبقى مفتاح المشروع القديم بعد تغيير القاعدة)
  var KEY_CACHE = 'push_vapid_pub_v2_' + (function () {
    try { return String(typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/[^a-z0-9]/gi, '').slice(-24); } catch (e) { return ''; }
  })();
  try { localStorage.removeItem('push_vapid_pub_v1'); } catch (e) {}
  var cfg = null;
  var st = { status: 'idle', busy: false, sig: '', fails: 0, nextTry: 0, endpoint: '' };

  // ---------- أدوات ----------
  function supported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  }
  function b64ToBytes(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  // تنظيف المفتاح: إزالة المسافات والأسطر وعلامات الاقتباس والبادئة، وتحويله لصيغة base64url
  function cleanKey(k) {
    return String(k || '').replace(/^\s*["']|["']\s*$/g, '').replace(/\s+/g, '').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  function validKeyBytes(k) {
    try { var b = b64ToBytes(k); return (b.length === 65 && b[0] === 4) ? b : null; } catch (e) { return null; }
  }
  function sameKey(buf, bytes) {
    if (!buf) return false;
    var a = new Uint8Array(buf);
    if (a.length !== bytes.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }
  function tz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo'; } catch (e) { return 'Africa/Cairo'; }
  }
  function client() { try { return cfg.getClient && cfg.getClient(); } catch (e) { return null; } }
  function chapter() { try { return (cfg.getChapterId && cfg.getChapterId()) || ''; } catch (e) { return ''; } }

  // تسجيل/جلب الـ Service Worker (صفحة المشرفين قد تُفتح قبل صفحة الخدام)
  function getRegistration() {
    return navigator.serviceWorker.getRegistration('./').then(function (r) {
      return r || navigator.serviceWorker.register('./sw.js', { scope: './' });
    }).then(function () { return navigator.serviceWorker.ready; });
  }

  // ---------- المفتاح العام (يُجلب من الدالة مرة واحدة ويُحفظ) ----------
  function getVapidKey(c) {
    var cached = '';
    try { cached = localStorage.getItem(KEY_CACHE) || ''; } catch (e) {}
    cached = cleanKey(cached);
    if (cached && validKeyBytes(cached)) return Promise.resolve(cached);
    try { localStorage.removeItem(KEY_CACHE); } catch (e) {}
    return c.functions.invoke(FN, { body: { mode: 'key' } }).then(function (r) {
      var k = cleanKey(r && r.data && r.data.key);
      if (r && r.error) throw r.error;
      if (!k) throw new Error('لم تُضبط مفاتيح VAPID في الدالة');
      if (!validKeyBytes(k)) throw new Error('VAPID_PUBLIC_KEY غير صالح في Secrets الدالة (يجب أن يكون المفتاح العام الناتج من web-push، طوله 87 حرفًا)');
      try { localStorage.setItem(KEY_CACHE, k); } catch (e) {}
      return k;
    });
  }

  // ---------- إعدادات الجهاز التي يحتاجها السيرفر ----------
  function buildPrefs() {
    var p = { birthdays: true, chat: true };
    var name = '';
    try { name = String((cfg.getName && cfg.getName()) || localStorage.getItem('lc_name') || '').trim(); } catch (e) {}
    if (name) p.chatName = name;

    if (cfg.role === 'servant') {
      var cid = chapter() || 'default';
      var raw = {};
      try { raw = JSON.parse(localStorage.getItem('lessonReminder_v1_' + cid) || '{}') || {}; } catch (e) {}
      p.lesson = {
        enabled: raw.enabled !== false,
        daysBefore: Math.min(6, Math.max(1, parseInt(raw.daysBefore, 10) || 3)),
        hour: Math.min(22, Math.max(5, isNaN(parseInt(raw.hour, 10)) ? 9 : parseInt(raw.hour, 10))),
        done: raw.done || {}, notified: raw.notified || {}, topics: raw.topics || {}
      };
      var dow = 5;
      try { if (typeof getAbsenceDayOfWeek === 'function') dow = getAbsenceDayOfWeek(); } catch (e) {}
      p.absenceDay = (isNaN(dow) || dow < 0 || dow > 6) ? 5 : dow;
    }
    return p;
  }

  function saveToCloud(c, sub, prefs) {
    var j = sub.toJSON();
    var keys = j.keys || {};
    var ua = (navigator.userAgent || '').slice(0, 300);
    if (cfg.role === 'admin') {
      return c.rpc('push_save_admin_subscription', {
        p_endpoint: j.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
        p_tz: tz(), p_prefs: prefs, p_user_agent: ua
      });
    }
    return c.rpc('push_save_subscription', {
      p_endpoint: j.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
      p_chapter_id: chapter(), p_tz: tz(), p_prefs: prefs, p_user_agent: ua
    });
  }

  // ---------- الدورة الرئيسية ----------
  function tick(force) {
    if (!cfg || st.busy) return Promise.resolve();
    if (!supported()) { st.status = 'unsupported'; return Promise.resolve(); }
    if (Notification.permission !== 'granted') {
      st.status = Notification.permission === 'denied' ? 'denied' : 'need-permission';
      return Promise.resolve();
    }
    var c = client();
    if (!c) { st.status = 'waiting-login'; return Promise.resolve(); }
    if (cfg.role !== 'admin' && !chapter()) { st.status = 'waiting-chapter'; return Promise.resolve(); }
    if (!force && Date.now() < st.nextTry) return Promise.resolve();

    st.busy = true;
    return getRegistration().then(function (reg) {
      return getVapidKey(c).then(function (pub) {
        var bytes = validKeyBytes(pub);
        if (!bytes) { try { localStorage.removeItem(KEY_CACHE); } catch (e) {} throw new Error('مفتاح VAPID غير صالح'); }
        return reg.pushManager.getSubscription().then(function (sub) {
          // مفتاح السيرفر تغيّر → اشتراك قديم لن يعمل
          if (sub && sub.options && sub.options.applicationServerKey && !sameKey(sub.options.applicationServerKey, bytes)) {
            return sub.unsubscribe().then(function () { return null; });
          }
          return sub;
        }).then(function (sub) {
          if (sub) return sub;
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        });
      });
    }).then(function (sub) {
      st.endpoint = sub.endpoint;
      var prefs = buildPrefs();
      var sig = sub.endpoint + '|' + cfg.role + '|' + chapter() + '|' + JSON.stringify(prefs);
      if (!force && sig === st.sig) { st.status = 'active'; return; }
      return saveToCloud(c, sub, prefs).then(function (r) {
        if (r && r.error) throw r.error;
        st.sig = sig; st.fails = 0; st.status = 'active';
      });
    }).catch(function (e) {
      st.fails++;
      st.status = 'error: ' + String((e && (e.message || e.details)) || e);
      st.nextTry = Date.now() + Math.min(300000, 15000 * st.fails);   // إعادة المحاولة بتباعد
      try { console.warn('[PushClient]', st.status); } catch (e2) {}
    }).then(function () { st.busy = false; });
  }

  // ---------- اختبار حقيقي من السيرفر ----------
  function test(delaySec) {
    if (!supported()) {
      return Promise.resolve({ ok: false, msg: 'هذا المتصفح لا يدعم الإشعارات الحقيقية. على الآيفون: أضف التطبيق للشاشة الرئيسية (Add to Home Screen) ثم افتحه من هناك.' });
    }
    if (Notification.permission !== 'granted') {
      return Promise.resolve({ ok: false, msg: 'فعّل الإشعارات أولاً ثم أعد المحاولة.' });
    }
    var c = client();
    if (!c) return Promise.resolve({ ok: false, msg: 'سجّل الدخول / افتح الفصل أولاً.' });
    return tick(true).then(function () {
      if (st.status !== 'active') return { ok: false, msg: 'تعذّر تسجيل الجهاز: ' + st.status };
      return c.functions.invoke(FN, { body: { mode: 'test', endpoint: st.endpoint, delay: delaySec || 15 } }).then(function (r) {
        if (r && r.error) return { ok: false, msg: 'تعذّر الاتصال بدالة الإشعارات: ' + (r.error.message || r.error) };
        if (r && r.data && r.data.ok === false) return { ok: false, msg: r.data.error || 'فشل الاختبار' };
        return { ok: true, msg: 'تم. أغلق التطبيق تماماً الآن (اسحبه من التطبيقات الأخيرة) وانتظر ' + (delaySec || 15) + ' ثانية ⏳' };
      });
    }).catch(function (e) { return { ok: false, msg: String((e && e.message) || e) }; });
  }

  function testFromPanel() {
    var el = document.getElementById('notifTestResult');
    if (el) el.innerHTML = '⏳ جاري تجهيز الاشتراك...';
    return test(15).then(function (r) {
      if (el) el.innerHTML = (r.ok ? '📡 ' : '❌ ') + r.msg;
      return r;
    });
  }

  // ---------- إلغاء الاشتراك ----------
  function disable() {
    var c = client();
    return getRegistration().then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        if (!sub) return;
        var ep = sub.endpoint;
        return sub.unsubscribe().then(function () {
          if (c) return c.rpc('push_remove_subscription', { p_endpoint: ep });
        });
      }).then(function () { st.sig = ''; st.status = 'disabled'; });
  }

  function init(options) {
    cfg = options || {};
    cfg.role = cfg.role === 'admin' ? 'admin' : 'servant';
    setTimeout(function () { tick(false); }, 1500);
    setInterval(function () { tick(false); }, 10000);   // يلتقط منح الإذن/فتح الفصل/تغيير الإعدادات
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick(false);
    });
  }

  root.PushClient = {
    init: init, test: test, testFromPanel: testFromPanel, disable: disable,
    sync: function () { return tick(true); },
    status: function () { return st.status; }
  };
})(window);
