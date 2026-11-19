/**
 * Tempest Weather Dashboard — Zero-Dependency Node.js Server (Node 18+)
 * Serves ./public static files and proxies WeatherFlow Tempest REST API requests (eliminating CORS).
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_PATH = path.join(__dirname, '.env');
const TEMPEST_BASE = 'https://swd.weatherflow.com/swd/rest';
const NOAA_TIDES_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MORRO_BAY_NOAA_STATION = '9412110'; // Port San Luis / Morro Bay official NOAA station

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const sevenDayCache = new Map();
const tideCache = new Map();

function formatTideTime12(timeStr) {
  const parts = String(timeStr || '').trim().split(/\s+/);
  if (parts.length < 2) return timeStr || '';
  const [hStr, mStr = '00'] = parts[1].split(':');
  const h24 = parseInt(hStr, 10);
  if (Number.isNaN(h24)) return parts[1];
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${mStr} ${ampm}`;
}

async function fetchMorroBayTides(units = 'imperial') {
  const isMetric = units === 'metric';
  let ymd;
  try {
    ymd = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'America/Los_Angeles',
    })
      .format(new Date())
      .replace(/-/g, '');
  } catch {
    const d = new Date();
    ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  const cacheKey = `${ymd}_${isMetric ? 'm' : 'e'}`;
  const cached = tideCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) {
    return cached.data;
  }

  try {
    const params = new URLSearchParams({
      begin_date: ymd,
      end_date: ymd,
      station: MORRO_BAY_NOAA_STATION,
      product: 'predictions',
      datum: 'MLLW',
      time_zone: 'lst_ldt',
      interval: 'hilo',
      units: isMetric ? 'metric' : 'english',
      application: 'tempest_weather_tv',
      format: 'json',
    });
    const data = await fetchJson(`${NOAA_TIDES_BASE}?${params.toString()}`);
    if (Array.isArray(data?.predictions) && data.predictions.length > 0) {
      const unitLabel = isMetric ? 'm' : 'ft';
      const predictions = data.predictions.map((p) => {
        const val = parseFloat(p.v);
        const type = String(p.type || '').toUpperCase() === 'L' ? 'L' : 'H';
        return {
          time: p.t,
          time12: formatTideTime12(p.t),
          type,
          label: type === 'H' ? 'High' : 'Low',
          height: Number.isNaN(val) ? 0 : Number(val.toFixed(1)),
          unit: unitLabel,
        };
      });
      const out = {
        stationId: MORRO_BAY_NOAA_STATION,
        stationName: 'Morro Bay',
        unit: unitLabel,
        predictions,
      };
      tideCache.set(cacheKey, { ts: Date.now(), data: out });
      return out;
    }
  } catch {
    // Non-fatal if NOAA CO-OPS is unreachable
  }
  return null;
}

async function loadDotEnv() {
  const map = {};
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        map[k] = v;
      }
    }
  } catch {
    // .env not created yet
  }
  return map;
}

async function saveDotEnv({ token, stationId, port }) {
  const existing = await loadDotEnv();
  if (token) existing.TEMPEST_API_TOKEN = token;
  if (stationId) existing.TEMPEST_STATION_ID = stationId;
  if (!existing.PORT) existing.PORT = String(port);

  const out = [
    '# WeatherFlow Tempest Dashboard Configuration',
    `TEMPEST_API_TOKEN=${existing.TEMPEST_API_TOKEN || ''}`,
    `TEMPEST_STATION_ID=${existing.TEMPEST_STATION_ID || '218212'}`,
    `PORT=${existing.PORT}`,
    '',
  ].join('\n');
  await fs.writeFile(ENV_PATH, out, 'utf8');
}

function degreesToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((Number(deg || 0) % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

function buildNarrativeSummary(forecastJson, units) {
  const cc = forecastJson?.current_conditions || {};
  const today = forecastJson?.forecast?.daily?.[0];
  const hourly = forecastJson?.forecast?.hourly || [];
  const tempUnit = units === 'metric' ? '°C' : '°F';
  const windUnit = units === 'metric' ? 'km/h' : 'mph';

  const cond = cc.conditions || today?.conditions || 'Clear';
  const parts = [/skies|likely|possible|showers|storms|rain|snow/i.test(cond) ? `${cond}.` : `${cond} skies.`];

  const hr = new Date().getHours();
  if (today) {
    if (hr >= 16 || hr < 5) {
      if (typeof today.air_temp_low === 'number') parts.push(`Low ${Math.round(today.air_temp_low)}${tempUnit}.`);
    } else if (typeof today.air_temp_high === 'number') {
      parts.push(`High ${Math.round(today.air_temp_high)}${tempUnit}.`);
    }
  }

  const nextHours = hourly.slice(0, 6).filter((h) => typeof h.wind_avg === 'number');
  if (nextHours.length >= 2) {
    const speeds = nextHours.map((h) => h.wind_avg);
    const minW = Math.max(0, Math.round(Math.min(...speeds)));
    const maxW = Math.max(minW + 2, Math.round(Math.max(...speeds)));
    const dir = nextHours[0].wind_direction_cardinal || cc.wind_direction_cardinal || degreesToCardinal(cc.wind_direction);
    parts.push(`Winds ${dir} at ${minW} to ${maxW} ${windUnit}.`);
  } else if (typeof cc.wind_avg === 'number') {
    const dir = cc.wind_direction_cardinal || degreesToCardinal(cc.wind_direction);
    parts.push(`Winds ${dir} at ${Math.round(cc.wind_avg)} ${windUnit}.`);
  }
  return parts.join(' ');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

async function buildDashboardPayload({ stationId, token, units }) {
  const isMetric = units === 'metric';
  const params = new URLSearchParams({
    station_id: String(stationId),
    units_temp: isMetric ? 'c' : 'f',
    units_wind: isMetric ? 'kph' : 'mph',
    units_pressure: isMetric ? 'mb' : 'inhg',
    units_precip: isMetric ? 'mm' : 'in',
    units_distance: isMetric ? 'km' : 'mi',
    token,
  });

  const [stationJson, forecastJson, obsJson, tides] = await Promise.all([
    fetchJson(`${TEMPEST_BASE}/stations/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`).catch((e) => {
      if (e.status === 401 || e.status === 403) throw e;
      return null;
    }),
    fetchJson(`${TEMPEST_BASE}/better_forecast?${params.toString()}`),
    fetchJson(`${TEMPEST_BASE}/observations/station/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`).catch(() => null),
    fetchMorroBayTides(units),
  ]);

  const stationObj = stationJson?.stations?.[0] || {};
  const devices = stationObj.devices || [];
  const primaryDev = devices.find((d) => d.device_type === 'ST') || devices.find((d) => d.device_type === 'SK') || null;
  const deviceId = primaryDev?.device_id || obsJson?.device_id || null;

  let windPeakToday = null;
  let solarPeakToday = null;
  let pressureChange3hr = null;
  let precipRate = 0;
  let priorSixDaysMm = 0;
  let hasPriorSixDays = false;

  if (deviceId) {
    try {
      const todayObs = await fetchJson(
        `${TEMPEST_BASE}/observations/device/${deviceId}?day_offset=0&token=${encodeURIComponent(token)}`
      );
      if (todayObs?.type === 'obs_st' && Array.isArray(todayObs.obs) && todayObs.obs.length > 0) {
        const rows = todayObs.obs;
        let maxGustMps = 0;
        let maxSolar = 0;
        for (const r of rows) {
          if (typeof r[3] === 'number' && r[3] > maxGustMps) maxGustMps = r[3];
          if (typeof r[11] === 'number' && r[11] > maxSolar) maxSolar = r[11];
        }
        windPeakToday = isMetric ? maxGustMps * 3.6 : maxGustMps * 2.23694;
        solarPeakToday = maxSolar;

        const latest = rows[rows.length - 1];
        if (typeof latest[6] === 'number') {
          const targetEpoch = latest[0] - 10800;
          let best = null;
          let bestDiff = Infinity;
          for (const r of rows) {
            if (typeof r[6] !== 'number') continue;
            const diff = Math.abs(r[0] - targetEpoch);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = r;
            }
          }
          if (best && bestDiff < 5400) {
            const deltaMb = latest[6] - best[6];
            pressureChange3hr = isMetric ? Number(deltaMb.toFixed(1)) : Number((deltaMb * 0.029529983).toFixed(2));
          }
        }

        const tail = rows.slice(-5);
        const rainSumMm = tail.reduce((acc, r) => acc + (typeof r[12] === 'number' ? r[12] : 0), 0);
        const rateMmHr = (rainSumMm / tail.length) * 60;
        precipRate = isMetric ? rateMmHr : rateMmHr / 25.4;
      }
    } catch {
      // Optional enrichment
    }

    const cached = sevenDayCache.get(String(deviceId));
    if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
      priorSixDaysMm = cached.mm;
      hasPriorSixDays = true;
    } else {
      try {
        const dayPromises = [1, 2, 3, 4, 5, 6].map((d) =>
          fetchJson(`${TEMPEST_BASE}/observations/device/${deviceId}?day_offset=${d}&token=${encodeURIComponent(token)}`).catch(() => null)
        );
        const results = await Promise.all(dayPromises);
        let sum = 0;
        for (const res of results) {
          if (res?.type === 'obs_st' && Array.isArray(res.obs)) {
            for (const r of res.obs) {
              if (typeof r[12] === 'number') sum += r[12];
            }
          }
        }
        priorSixDaysMm = sum;
        hasPriorSixDays = true;
        sevenDayCache.set(String(deviceId), { ts: Date.now(), mm: sum });
      } catch {
        // Optional enrichment
      }
    }
  }

  const cc = forecastJson?.current_conditions || {};
  const latestObs = obsJson?.obs?.[0] || {};
  const dailyRaw = forecastJson?.forecast?.daily || [];
  const todayFc = dailyRaw[0] || {};

  const elevMeters = stationObj?.station_meta?.elevation ?? obsJson?.elevation ?? 0;
  const elevation = isMetric ? Math.round(elevMeters) : Math.round(elevMeters * 3.28084);

  const temp = cc.air_temperature ?? 0;
  const windGust = cc.wind_gust ?? cc.wind_avg ?? 0;
  const solar = cc.solar_radiation ?? 0;
  const precipToday = cc.precip_accum_local_day ?? 0;
  const precipYesterday = cc.precip_accum_local_yesterday ?? 0;
  const precip7Day = hasPriorSixDays
    ? precipToday + (isMetric ? priorSixDaysMm : priorSixDaysMm / 25.4)
    : precipToday + precipYesterday;

  return {
    isDemo: false,
    units,
    station: {
      stationId: String(stationId),
      deviceId,
      name: stationObj.public_name || stationObj.name || obsJson?.public_name || `Tempest Station ${stationId}`,
      badge: `TEMPEST ${stationId}`,
      elevation,
      elevationUnit: isMetric ? 'm' : 'ft',
      latitude: stationObj.latitude ?? forecastJson?.latitude ?? 0,
      longitude: stationObj.longitude ?? forecastJson?.longitude ?? 0,
      timezone: stationObj.timezone || forecastJson?.timezone || 'UTC',
    },
    current: {
      epoch: latestObs.timestamp || cc.time || Math.floor(Date.now() / 1000),
      temperature: temp,
      feelsLike: cc.feels_like ?? temp,
      conditions: cc.conditions || todayFc.conditions || 'Clear',
      summary: buildNarrativeSummary(forecastJson, units),
      icon: cc.icon || todayFc.icon || 'partly-cloudy-day',
      todayLow: todayFc.air_temp_low ?? temp - 8,
      todayHigh: todayFc.air_temp_high ?? temp + 8,
      humidity: cc.relative_humidity ?? 0,
      dewPoint: cc.dew_point ?? temp,
      windSpeed: cc.wind_avg ?? 0,
      windGust,
      windPeakToday: Math.max(windGust, windPeakToday ?? windGust),
      windDirection: cc.wind_direction ?? 0,
      windCardinal: cc.wind_direction_cardinal || degreesToCardinal(cc.wind_direction ?? 0),
      pressure: cc.sea_level_pressure ?? cc.station_pressure ?? (isMetric ? 1013.2 : 29.92),
      pressureTrend: String(cc.pressure_trend || 'steady').toLowerCase(),
      pressureChange3hr,
      precipToday,
      precipRate,
      precip7Day,
      uv: cc.uv ?? 0,
      solarRadiation: solar,
      solarPeakToday: Math.max(solar, solarPeakToday ?? solar),
      lightningCount1hr: cc.lightning_strike_count_last_1hr ?? 0,
      lightningLastDistance: cc.lightning_strike_last_distance ?? null,
      lightningLastEpoch: cc.lightning_strike_last_epoch ?? null,
    },
    astronomy: {
      sunriseEpoch: todayFc.sunrise || null,
      sunsetEpoch: todayFc.sunset || null,
    },
    tides,
    daily: dailyRaw.map((d) => ({
      dayStartEpoch: d.day_start_local,
      conditions: d.conditions || '',
      icon: d.icon || 'partly-cloudy-day',
      high: d.air_temp_high ?? temp,
      low: d.air_temp_low ?? temp,
      precipProbability: d.precip_probability ?? 0,
      sunrise: d.sunrise,
      sunset: d.sunset,
    })),
    hourly: (forecastJson?.forecast?.hourly || []).map((h) => ({
      t: h.time,
      i: h.icon || 'partly-cloudy-day',
      tmp: typeof h.air_temperature === 'number' ? Number(h.air_temperature.toFixed(1)) : Number(temp.toFixed(1)),
      p: Math.round(h.precip_probability ?? 0),
      w: typeof h.wind_avg === 'number' ? Number(h.wind_avg.toFixed(1)) : 0,
      d: Math.round(h.wind_direction ?? 0),
    })),
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const initialEnv = await loadDotEnv();
const PORT = Number(process.env.PORT || initialEnv.PORT || 3080);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    if (pathname === '/api/config' && req.method === 'GET') {
      const cfg = await loadDotEnv();
      const token = process.env.TEMPEST_API_TOKEN || cfg.TEMPEST_API_TOKEN || '';
      const stationId = process.env.TEMPEST_STATION_ID || cfg.TEMPEST_STATION_ID || '218212';
      return sendJson(res, 200, {
        hasServerToken: Boolean(token),
        wsToken: token,
        stationId,
      });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      const token = String(parsed.token || '').trim();
      const stationId = String(parsed.stationId || '218212').trim();
      await saveDotEnv({ token, stationId, port: PORT });
      return sendJson(res, 200, { ok: true, hasServerToken: Boolean(token), stationId });
    }

    if (pathname === '/api/dashboard' && req.method === 'GET') {
      const cfg = await loadDotEnv();
      const stationId = url.searchParams.get('stationId') || cfg.TEMPEST_STATION_ID || '218212';
      const units = url.searchParams.get('units') === 'metric' ? 'metric' : 'imperial';
      const token = req.headers['x-tempest-token'] || process.env.TEMPEST_API_TOKEN || cfg.TEMPEST_API_TOKEN || '';

      if (!token) {
        return sendJson(res, 401, { error: 'Missing Tempest Personal Access Token.' });
      }
      try {
        const payload = await buildDashboardPayload({ stationId, token, units });
        return sendJson(res, 200, payload);
      } catch (err) {
        const code = err.status === 401 ? 401 : err.status === 403 ? 403 : err.status === 404 ? 404 : 502;
        return sendJson(res, code, { error: err.message || 'Tempest API request failed.' });
      }
    }

    // Static files
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '').replace(/\.\./g, '');
    const filePath = path.join(PUBLIC_DIR, rel);
    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tempest Weather Dashboard running at http://localhost:${PORT}`);
});
