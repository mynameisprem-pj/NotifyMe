# NotifyMe 🔔

A lightweight **offline-first PWA** reminder app with **voice (speech synthesis) notifications**, recurring reminders, categories, and a calendar view.

---

## 📁 Folder Structure

```
NotifyMe/
├── index.html          # App shell & all views
├── manifest.json       # PWA manifest (icons, theme, display)
├── sw.js               # Service Worker (offline caching)
├── css/
│   └── style.css       # All styles (dark theme, animations)
├── js/
│   └── app.js          # All logic: reminders, voice, calendar, storage
└── icons/
    ├── icon-192.png    # PWA icon (home screen)
    └── icon-512.png    # PWA splash icon
```

---

## ✨ Features

| Feature | Details |
|---|---|
| **Voice Notifications** | Uses Web Speech API to speak reminder titles aloud |
| **Recurring Reminders** | Daily, Weekdays, Weekly, Monthly, Yearly |
| **Categories** | All, Work, Personal, Shopping, Fitness, Ideas |
| **Calendar View** | Month grid showing days with reminders |
| **Quick Note** | One-tap note capture |
| **Search** | Filter reminders by title or note content |
| **Offline** | Service Worker caches all assets |
| **Installable** | PWA — add to home screen on iOS/Android/Desktop |
| **Browser Notifications** | System notification when reminder fires |
| **Settings** | Voice speed, pitch, test voice, clear data |

---

## 🚀 How to Run

### Option 1 — Local dev server (recommended)
```bash
# Python (any machine)
cd NotifyMe
python3 -m http.server 8080
# Open http://localhost:8080
```

```bash
# Node.js (npx)
npx serve NotifyMe
```

### Option 2 — Deploy (free)
Upload the folder to any static host:
- **Netlify**: drag & drop the folder at netlify.com/drop
- **Vercel**: `npx vercel NotifyMe`
- **GitHub Pages**: push to a repo and enable Pages

> ⚠️ Service Worker and Web Notifications require **HTTPS** (localhost is fine for dev).

---

## 📱 Install as App

1. Open in Chrome/Edge/Safari
2. Tap the browser menu → **"Add to Home Screen"** (iOS Safari) or **"Install App"** (Chrome)
3. Enjoy it like a native app — works fully offline!

---

## 🔔 How Voice Works

- Uses the browser's built-in **Web Speech API** (`SpeechSynthesisUtterance`)
- No internet required for speech — runs entirely on-device
- Customize **speed** and **pitch** in Settings
- Toggle per-reminder in the reminder form
- Global on/off switch in Settings

---

## 🔁 Recurring Logic

When a recurring reminder fires, the app automatically advances the date to the next occurrence:

| Mode | Advances by |
|---|---|
| Daily | +1 day |
| Weekdays | next Mon–Fri |
| Weekly | +7 days |
| Monthly | +1 month |
| Yearly | +1 year |

---

## 💾 Data Storage

All data is stored in **localStorage** — no server, no account needed.  
Export/import features can be added as a future enhancement.
