# Tempest Weather Station Dashboard

A sleek, real-time dark-mode weather dashboard designed for WeatherFlow Tempest stations (pre-configured for Station **218212**).

## Features
- **Live Tempest REST + WebSocket Integration**: Streams 3-second rapid wind updates (`rapid_wind`) and 1-minute full observations (`obs_st`) directly from WeatherFlow Tempest, plus 10-day forecast via `better_forecast`.
- **Precision Custom SVG Gauges**: Humidity ring, 360° wind compass dial, analog barometer with red needle, 3D precipitation rain cylinder, segmented 10-tier UV pyramid, and dynamic solar radiation orb.
- **Computed Station Metrics**: Automatically calculates Today's Peak Wind Gust, Today's Peak Solar Radiation, 3-Hour Barometric Pressure Change, Precipitation Rate, and 7-Day Precipitation Total from Tempest device history.
- **Zero-Dependency Local Server**: Includes both a native Windows PowerShell server (`server.ps1` / `start-dashboard.bat`) and a Node.js server (`server.mjs`) that proxy Tempest REST API calls cleanly with zero CORS errors.
- **Showcase Preview Mode**: Loads immediately with a full preview before you enter your API key.

## Quick Start (Windows — Zero Installs Required)
1. Double-click `start-dashboard.bat` (or run `powershell -ExecutionPolicy Bypass -File server.ps1`).
2. Open **http://localhost:3080** in your browser.
3. Click **Configure API Key** (or the gear icon in the top-right) and paste your Tempest Personal Access Token from [tempestwx.com/settings/tokens](https://tempestwx.com/settings/tokens).
4. Optionally check **Save token & station ID to local server `.env` file** so your key persists automatically.

## Alternative: Node.js (Node 18+)
```bash
node server.mjs
```
Then visit **http://localhost:3080**.
