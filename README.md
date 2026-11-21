# Tempest Weather Dashboard & Google TV App

Real-time dark-mode weather dashboard and native Google TV app built for the **Alta Ct** WeatherFlow Tempest station (**Station 218212**, Morro Bay, CA).

It powers three synchronized surfaces from this repository:
1. **Local Web App** (`public/` + `server.mjs` / `server.ps1`)
2. **GitHub Pages + Google Sites Embed + Google Apps Script Proxy** (`google-sites-embed.html` + `google-apps-script/Code.gs`)
3. **Google TV / Sony Bravia Native APK** (`public/tv.html` + `android-tv-app/` + GitHub Actions CI)

---

## Features

- **Live Tempest REST + WebSocket Telemetry**: Streams 3-second rapid wind updates (`rapid_wind`) and 1-minute full station observations (`obs_st`), plus 15-day daily and hourly forecasts (`better_forecast`) with clickable day-detail modals.
- **Custom SVG Telemetry Gauges**: Humidity arc gauge, 360° wind compass dial, analog barometer with needle and 3-hour pressure trend, 3D precipitation rain cylinder (rate, today, 7-day total), segmented 10-tier UV pyramid, and dynamic solar radiation orb (`public/js/gauges.js`).
- **Hybrid Past-to-Future Doppler Radar**: Keyless dark-filtered **OpenStreetMap** basemap in Leaflet combining **RainViewer** observed Doppler radar (past ~2 hours through `LIVE`) with **Visual Crossing** `precipcomposite` model forecast frames in stepped intervals (`+15m`, `+30m`, `+45m`, `+1h`, `+2h`, `+3h`, `+4h`, `+6h`). Features distinct `PAST`, `LIVE` (green), and `FORECAST` (amber) indicators plus an expandable full-screen radar modal.
- **"Indie" Spoken Weather Briefing Presenter**: Interactive forecast summary card and presenter modal featuring an animated SVG weather presenter, live word-by-word highlighted auto-scrolling teleprompter script, **Auto-play on launch** toggle (persisted server-side via Apps Script `ScriptProperties` / `/api/config` and local storage), Web Speech API playback on web, and a native Android `TextToSpeech` audio bridge on Google TV.
- **Morro Bay Coastal & Astronomy Footer**: Live sunrise/sunset times, lunar phase SVG (`public/js/moon.js`), official NOAA **Morro Bay (`9412110`)** high/low tide predictions, and nearby lightning strike alerts.
- **Google TV / Sony Bravia Optimization**: Fixed `1600×900` 16:9 auto-scaled TV stage (`public/tv.html`), full D-pad remote navigation across metric/radar/forecast cards and modals, `FLAG_KEEP_SCREEN_ON`, immersive fullscreen mode, and automatic resume playback when returning to the app.

---

## Repository Structure

```text
├── public/                     # Modular web dashboard (local Node/PowerShell server)
│   ├── index.html              # Desktop/mobile web entry
│   ├── tv.html                 # Auto-scaled 1600×900 Google TV dashboard
│   ├── styles.css              # Dark-mode theme & responsive layout
│   └── js/
│       ├── app.js              # Dashboard state, UI bindings, modals, unit switching
│       ├── avatar.js           # "Indie" weather briefing generator, teleprompter & TTS
│       ├── radar.js            # MorroBayRadarController (RainViewer + Visual Crossing)
│       ├── tempest-client.js   # Tempest REST/WebSocket + Apps Script proxy client
│       ├── gauges.js           # Custom SVG telemetry gauges
│       ├── icons.js            # Weather & coastal icon set
│       ├── moon.js             # Lunar phase calculation & SVG renderer
│       └── demo-data.js        # Showcase preview data
├── google-sites-embed.html     # Standalone single-file bundle (GitHub Pages & Google Sites)
├── google-apps-script/
│   └── Code.gs                 # Secure Apps Script proxy (hides token, caches NOAA tides, stores preferences)
├── android-tv-app/             # Native Android TV / Google TV WebView wrapper (Kotlin + Gradle)
│   └── app/src/main/
│       ├── java/com/tempest/weather/tv/MainActivity.kt
│       └── assets/tv-dashboard.html
├── .github/workflows/
│   ├── deploy-pages.yml        # Auto-deploys google-sites-embed.html to GitHub Pages
│   └── build-tv-apk.yml        # Auto-builds tempest-weather-tv.apk and updates latest-tv release
├── server.mjs                  # Zero-dependency Node.js 18+ local server & API proxy
├── server.ps1                  # Native Windows PowerShell local server & API proxy
├── start-dashboard.bat         # Windows double-click launcher for server.ps1
└── .env.example                # Template for TEMPEST_API_TOKEN, TEMPEST_STATION_ID, PORT
```

---

## Running Locally

### Option 1: Node.js (Node 18+)
```bash
cp .env.example .env   # Add your TEMPEST_API_TOKEN and TEMPEST_STATION_ID
npm start              # Runs node server.mjs on http://localhost:3080
```
- Web dashboard: **http://localhost:3080**
- TV layout preview: **http://localhost:3080/tv.html**

### Option 2: Windows PowerShell (Zero Installs Required)
1. Double-click `start-dashboard.bat` (or run `powershell -ExecutionPolicy Bypass -File server.ps1`).
2. Open **http://localhost:3080**.
3. Click **Configure API Key** (gear icon) and paste your Tempest Personal Access Token from [tempestwx.com/settings/tokens](https://tempestwx.com/settings/tokens), optionally saving it to `.env`.

---

## GitHub Pages, Google Sites & Apps Script Proxy

1. **Google Apps Script Proxy (`google-apps-script/Code.gs`)**:
   - Stores `TEMPEST_API_TOKEN` privately in **Project Settings → Script Properties** so the token is never exposed in client-side code.
   - Proxies station observations/forecasts, caches NOAA Morro Bay tide predictions (`9412110`), and persists UI preferences (`PREF_AVATAR_AUTOPLAY`).
   - Deploy as Web App (**Execute as: Me**, **Who has access: Anyone**).
2. **GitHub Pages (`google-sites-embed.html`)**:
   - Pushing changes to `google-sites-embed.html` on `main` automatically runs [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) and updates the live GitHub Pages URL (`https://gomce62.github.io/tempest-weather-tv/`), which can be embedded directly in Google Sites.

---

## Google TV / Sony Bravia APK

- **Direct APK Download (`latest-tv`)**:
  `https://github.com/gomce62/tempest-weather-tv/releases/download/latest-tv/tempest-weather-tv.apk`
- Pushing to `main` automatically runs [`.github/workflows/build-tv-apk.yml`](.github/workflows/build-tv-apk.yml), builds the release APK (`android-tv-app/`), and overwrites the `latest-tv` GitHub Release asset.
- **Updating the TV dashboard**:
  1. Edit `public/tv.html` and copy it to `android-tv-app/app/src/main/assets/tv-dashboard.html`.
  2. Increment `versionCode` and `versionName` in `android-tv-app/app/build.gradle.kts` so Android TV upgrades cleanly in place.
  3. Commit and push to `main`.

---

## Data & Map Credits

- Weather telemetry & forecast: [WeatherFlow Tempest](https://tempestwx.com/)
- Tide predictions: NOAA CO-OPS ([Station 9412110](https://tidesandcurrents.noaa.gov/))
- Basemap: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Observed & future radar layers: [RainViewer](https://www.rainviewer.com/) & [Visual Crossing](https://www.visualcrossing.com/) via [Leaflet](https://leafletjs.com/)
