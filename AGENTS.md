# Tempest Weather Dashboard & Google TV App — Project Context

This project powers the **Alta Ct (WeatherFlow Tempest Station 218212)** weather dashboard across three surfaces:
1. **Local Web App** (`public/` + `server.ps1` / `server.mjs`)
2. **Google Sites Embed + Secure Google Apps Script Proxy** (`google-sites-embed.html` + `google-apps-script/Code.gs`)
3. **Google TV / Sony Bravia 9 II Native APK** (`public/tv.html` + `android-tv-app/` + `.github/workflows/build-tv-apk.yml`)

## Live Endpoints & Links
- **Tempest Station:** `218212` (`Alta Ct`, https://tempestwx.com/station/218212/grid)
- **GitHub Repository:** https://github.com/gomce62/tempest-weather-tv
- **Google TV APK Release (`latest-tv`):** https://github.com/gomce62/tempest-weather-tv/releases/tag/latest-tv
  - Direct Downloader URL: `https://github.com/gomce62/tempest-weather-tv/releases/download/latest-tv/tempest-weather-tv.apk`
- **Google Sites Editor:** https://sites.google.com/d/1wHPuDlZZ-2Hp_GGGiNItrmH8mcKconSg/p/1Ums0uf6J4UNEKmoFhmKX-naY9-xGNmcy/edit
- **Google Apps Script Proxy Project:** https://script.google.com/home/projects/1hzs5k4FRnrQe9PyKcQGUzEvUar3_aJk2JrdUfPSPH9_lkDwpreC729nu/edit
  - Live Web App `/exec` URL: `https://script.google.com/macros/s/AKfycbytQzDehgAoNUPG4qJDUzpdgYNj4KUuaO_uZDMhPcU5AvMI_UvZ7MIcocj8VOMe_rJK4Q/exec`
  - The Tempest Personal Access Token is stored privately in Apps Script **Project Settings → Script Properties** (`TEMPEST_API_TOKEN`) and locally in `.env` (gitignored). Never commit `.env` or raw API tokens to Git.

## Architecture & Workflows

### 1. Updating the Google TV / Sony Bravia 9 II APK
- Edit `public/tv.html` (uses an auto-scaled `1600×900` 16:9 stage so it fits Android TV's `960×540` logical CSS viewport and 1080p/4K screens with zero overlap).
- Copy `public/tv.html` to `android-tv-app/app/src/main/assets/tv-dashboard.html`.
- Bump `versionCode` and `versionName` in `android-tv-app/app/build.gradle.kts` so Android TV updates the app in place.
- Commit and push to `main`:
  ```powershell
  git add public/tv.html android-tv-app/
  git commit -m "Update Google TV dashboard"
  git push
  ```
- GitHub Actions (`.github/workflows/build-tv-apk.yml`) automatically builds `tempest-weather-tv.apk` and overwrites the `latest-tv` release asset.

### 2. Updating the Google Site
- Edit `google-sites-embed.html` (standalone single-file bundle).
- Paste the updated HTML into the `Dashboard` Full Page Embed in the Google Sites editor and click **Save** / **Publish**.

### 3. Updating the Google Apps Script Proxy
- Edit `google-apps-script/Code.gs` and paste into the Apps Script editor.
- Click **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** so the existing `/exec` URL stays unchanged.
