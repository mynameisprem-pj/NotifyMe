/* ===== NotifyMe Service Worker ===== */

const CACHE = 'notifyme-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// ══════════════════════════════════════════════════════════════
// BACKGROUND REMINDER CHECKING (runs even when app is closed)
// ══════════════════════════════════════════════════════════════

// Periodic background sync for reminder checks
self.addEventListener('sync', e => {
  if (e.tag === 'check-reminders') {
    e.waitUntil(checkRemindersBackground());
  }
});

// Message from app to manually trigger reminder check or sync data
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_REMINDERS') {
    e.waitUntil(checkRemindersBackground());
  } else if (e.data && e.data.type === 'SYNC_DATA' && e.data.reminders) {
    e.waitUntil(saveReminderToStorage(e.data.reminders));
  }
});

async function getRemindersFromStorage() {
  return new Promise(resolve => {
    const req = indexedDB.open('NotifyMeDB', 1);
    req.onsuccess = e => {
      try {
        const db = e.target.result;
        const tx = db.transaction('reminders', 'readonly');
        const store = tx.objectStore('reminders');
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => resolve(getAllReq.result || []);
        getAllReq.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
    req.onerror = () => resolve([]);
    req.onupgradeneeded = e => {
      try {
        e.target.result.createObjectStore('reminders', { keyPath: 'id' });
      } catch {}
    };
  });
}

async function saveReminderToStorage(reminders) {
  return new Promise(resolve => {
    const req = indexedDB.open('NotifyMeDB', 1);
    req.onsuccess = e => {
      try {
        const db = e.target.result;
        const tx = db.transaction('reminders', 'readwrite');
        const store = tx.objectStore('reminders');
        store.clear();
        reminders.forEach(r => store.add(r));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    };
    req.onerror = () => resolve();
    req.onupgradeneeded = e => {
      try {
        e.target.result.createObjectStore('reminders', { keyPath: 'id' });
      } catch {}
    };
  });
}

function getNextDate(d, recurring) {
  const next = new Date(d);
  switch (recurring) {
    case 'daily':    next.setDate(next.getDate() + 1); break;
    case 'weekdays': do { next.setDate(next.getDate() + 1); } while ([0,6].includes(next.getDay())); break;
    case 'weekly':   next.setDate(next.getDate() + 7); break;
    case 'monthly':  next.setMonth(next.getMonth() + 1); break;
    case 'yearly':   next.setFullYear(next.getFullYear() + 1); break;
  }
  return next;
}

async function checkRemindersBackground() {
  try {
    let reminders = await getRemindersFromStorage();
    if (!reminders || reminders.length === 0) return;

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowMin = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    let changed = false;
    reminders.forEach(r => {
      if (r.done || !r.date || !r.time) return;
      if (`${r.date}T${r.time}` === nowMin) {
        // Fire notification
        self.registration.showNotification('NotifyMe 🔔', {
          body: r.speakText || (r.title + (r.note ? '\n' + r.note : '')),
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: r.id,
          requireInteraction: true
        });
        
        // Handle recurring reminders
        if (r.recurring && r.recurring !== 'none') {
          r.date = getNextDate(new Date(`${r.date}T${r.time}`), r.recurring).toISOString().slice(0, 10);
        } else {
          r.done = true;
        }
        changed = true;
      }
    });

    if (changed) {
      await saveReminderToStorage(reminders);
      // Notify all clients to refresh
      const clients = await self.clients.matchAll();
      clients.forEach(c => c.postMessage({ type: 'REMINDERS_UPDATED' }));
    }
  } catch (e) {
    console.error('Error checking reminders:', e);
  }
}

// Notification click handler
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
