// ===== إعدادات السحابة المشتركة (Supabase) =====
// هذا الملف الوحيد الذي تعدّله لو غيّرت مشروع Supabase.
// تجد القيمتين في: Supabase ← Project Settings ← API
//   url     : Project URL
//   anonKey : anon public key  (مفتاح عام مخصّص للمتصفح — لا تضع هنا service_role أبداً)
window.CLOUD_CONFIG = {
  url:     'https://oupqoqzvpkqhkodrszkp.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91cHFvcXp2cGtxaGtvZHJzemtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDg1NjQsImV4cCI6MjEwMTUyNDU2NH0.qBclWgz11RRVtkilEaoGfCZ4EVnf3rE5QhRfR3gQGt8',
  bucket:  'library-files'
};
