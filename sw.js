/* Sales Quest — service worker
   หน้าที่: ให้เปิดแอปได้แม้ไม่มีเน็ต และโหลดเร็วขึ้น
   หลักการ: ไฟล์แอป = network-first (ได้ของใหม่เสมอถ้าเน็ตมา, ไม่มีเน็ตค่อยใช้ของเก่า)
            ไอคอน/ฟอนต์ = cache-first (ไม่ค่อยเปลี่ยน)
   หมายเหตุ: ข้อมูลเควสต์ไม่เกี่ยวกับ cache นี้ — เก็บใน localStorage + ซิงก์ Google Sheet แยกต่างหาก */

const VERSION = 'sq-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // ไม่ใช้ addAll เพราะถ้าไฟล์เดียวพลาด จะล้มทั้งชุด
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST ไป Google Sheet ปล่อยผ่าน

  const url = new URL(req.url);
  if (url.hostname.includes('script.google')) return;     // ห้าม cache การซิงก์ ต้องสดเสมอ

  const cacheFirst = /\.(png|jpg|jpeg|svg|webp|woff2?)$/i.test(url.pathname)
                     || url.hostname.includes('fonts.g');

  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // network-first สำหรับ index.html / manifest
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});

// ให้หน้าเว็บสั่งอัปเดตทันทีได้
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
