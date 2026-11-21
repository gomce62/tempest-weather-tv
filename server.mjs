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

async function saveDotEnv({ token, stationId, port, avatarAutoplay }) {
  const existing = await loadDotEnv();
  if (token) existing.TEMPEST_API_TOKEN = token;
  if (stationId) existing.TEMPEST_STATION_ID = stationId;
  if (typeof avatarAutoplay === 'boolean') {
    existing.TEMPEST_AVATAR_AUTOPLAY = avatarAutoplay ? 'true' : 'false';
  }
  if (!existing.PORT) existing.PORT = String(port);

  const lines = [
    '# WeatherFlow Tempest Dashboard Configuration',
    `TEMPEST_API_TOKEN=${existing.TEMPEST_API_TOKEN || ''}`,
    `TEMPEST_STATION_ID=${existing.TEMPEST_STATION_ID || '218212'}`,
    `PORT=${existing.PORT}`,
  ];
  if (existing.TEMPEST_AVATAR_AUTOPLAY !== undefined) {
    lines.push(`TEMPEST_AVATAR_AUTOPLAY=${existing.TEMPEST_AVATAR_AUTOPLAY}`);
  }
  lines.push('');
  await fs.writeFile(ENV_PATH, lines.join('\n'), 'utf8');
}

function degreesToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((Number(deg || 0) % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

function getStationHour(timezone) {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone || undefined }).format(new Date())
    );
    return Number.isNaN(h) ? new Date().getHours() : h % 24;
  } catch {
    return new Date().getHours();
  }
}

function getLocalMidnightEpoch(nowSec, timezone) {
  function getHms(ep) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || undefined,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(new Date(ep * 1000));
      const map = {};
      for (const p of parts) map[p.type] = p.value;
      return { h: Number(map.hour) % 24, m: Number(map.minute), s: Number(map.second) };
    } catch {
      const d = new Date(ep * 1000);
      return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
    }
  }
  const p = getHms(nowSec);
  let guess = nowSec - (p.h * 3600 + p.m * 60 + p.s);
  const chk = getHms(guess);
  if (chk.h === 23) guess += 3600;
  else if (chk.h === 1) guess -= 3600;
  return guess;
}

function formatHourBucket(epochSec, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true, timeZone: timezone || undefined }).format(
      new Date(epochSec * 1000)
    );
  } catch {
    const h = new Date(epochSec * 1000).getHours();
    return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
  }
}

function getLocalDateKey(epochSec, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone || undefined,
    }).format(new Date(epochSec * 1000));
  } catch {
    const d = new Date(epochSec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function skyPhrase(cond, isNight) {
  const c = String(cond || '').toLowerCase();
  if (c.includes('thunder')) return 'stormy skies with thunderstorms in the area';
  if (c.includes('snow') || c.includes('sleet') || c.includes('wintry')) return 'wintry precipitation moving through';
  if (c.includes('rain') || c.includes('shower')) {
    return c.includes('possible') || c.includes('light')
      ? 'scattered showers in the area'
      : 'wet weather with rain moving through';
  }
  if (c.includes('fog')) return 'patchy fog and low clouds';
  if (c.includes('partly')) return isNight ? 'partly cloudy skies' : 'a mix of sun and clouds';
  if (c.includes('cloud')) return 'mostly cloudy skies';
  if (c.includes('wind')) return 'breezy conditions';
  if (c.includes('clear') || c.includes('sun')) return isNight ? 'clear, starlit skies' : 'bright, sunny skies';
  return c ? `${c} conditions` : 'fair skies';
}

function buildNarrativeSummary(forecastJson, units, timezone) {
  const cc = forecastJson?.current_conditions || {};
  const today = forecastJson?.forecast?.daily?.[0];
  const hourly = forecastJson?.forecast?.hourly || [];
  const tempUnit = units === 'metric' ? '°C' : '°F';
  const windUnit = units === 'metric' ? 'km/h' : 'mph';

  const cond = cc.conditions || today?.conditions || 'Clear';
  const parts = [/skies|likely|possible|showers|storms|rain|snow/i.test(cond) ? `${cond}.` : `${cond} skies.`];

  const hr = getStationHour(timezone);
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

function buildWeathermanBriefing(forecastJson, units, timezone) {
  const cc = forecastJson?.current_conditions || {};
  const daily = forecastJson?.forecast?.daily || [];
  const today = daily[0] || null;
  const tomorrow = daily[1] || null;
  const hourly = forecastJson?.forecast?.hourly || [];
  const isMetric = units === 'metric';
  const tu = isMetric ? '°C' : '°F';
  const wu = isMetric ? 'km/h' : 'mph';
  const hr = getStationHour(timezone);
  const isNight = hr >= 18 || hr < 6;
  const cond = cc.conditions || today?.conditions || 'Clear';
  const sky = skyPhrase(cond, isNight);

  const hi = typeof today?.air_temp_high === 'number' ? Math.round(today.air_temp_high) : null;
  const lo = typeof today?.air_temp_low === 'number' ? Math.round(today.air_temp_low) : null;
  const hiF = hi !== null ? (isMetric ? (hi * 9) / 5 + 32 : hi) : 65;
  const comfort = hiF >= 88 ? 'hot ' : hiF >= 77 ? 'warm ' : hiF >= 64 ? 'mild ' : hiF >= 52 ? 'cool ' : 'chilly ';

  let lead = '';
  if (hr >= 5 && hr < 12) {
    lead = `Good morning! Expect ${sky} today${hi !== null ? ` with ${comfort}highs climbing near ${hi}${tu}` : ''}${lo !== null ? ` before dipping to ${lo}${tu} tonight.` : '.'}`;
  } else if (hr >= 12 && hr < 17) {
    lead = `This afternoon brings ${sky}${hi !== null ? `, with temperatures topping out near ${hi}${tu}` : ''}${lo !== null ? ` before cooling to around ${lo}${tu} tonight.` : '.'}`;
  } else if (hr >= 17 && hr < 21) {
    lead = `Good evening! Expect ${sky} tonight${lo !== null ? ` as temperatures settle toward an overnight low near ${lo}${tu}.` : '.'}`;
  } else {
    lead = `Tonight brings ${sky}${lo !== null ? ` with temperatures dipping toward an overnight low near ${lo}${tu}.` : '.'}`;
  }

  const pop = typeof today?.precip_probability === 'number' ? Math.round(today.precip_probability) : 0;
  const next12 = hourly.slice(0, 12);
  let peakPopH = null;
  for (const h of next12) {
    if (typeof h.precip_probability === 'number') {
      if (!peakPopH || h.precip_probability > peakPopH.precip_probability) peakPopH = h;
    }
  }
  let precipPhrase = 'Dry conditions hold steady';
  if (pop >= 60) {
    const peakWhen = peakPopH?.time && peakPopH.precip_probability >= 50 ? ` around ${formatHourBucket(peakPopH.time, timezone)}` : '';
    precipPhrase = `Keep the umbrella handy with rain likely (${pop}% chance${peakWhen})`;
  } else if (pop >= 30) {
    precipPhrase = `Watch for a ${pop}% chance of passing showers`;
  }

  const nextWind = hourly.slice(0, 6).filter((h) => typeof h.wind_avg === 'number');
  let windPhrase = '.';
  if (nextWind.length >= 2) {
    const speeds = nextWind.map((h) => h.wind_avg);
    const minW = Math.max(0, Math.round(Math.min(...speeds)));
    const maxW = Math.max(minW + 2, Math.round(Math.max(...speeds)));
    const maxWMph = isMetric ? maxW / 1.60934 : maxW;
    const dir = nextWind[0].wind_direction_cardinal || cc.wind_direction_cardinal || degreesToCardinal(cc.wind_direction);
    windPhrase =
      maxWMph >= 18
        ? ` alongside gusty ${dir} winds at ${minW} to ${maxW} ${wu}.`
        : maxWMph >= 9
          ? ` with a ${dir} breeze at ${minW} to ${maxW} ${wu}.`
          : ` with light ${dir} winds at ${minW} to ${maxW} ${wu}.`;
  }

  let extra = '';
  if ((hr >= 17 || hr < 5) && typeof tomorrow?.air_temp_high === 'number') {
    const tomPop = typeof tomorrow.precip_probability === 'number' ? Math.round(tomorrow.precip_probability) : 0;
    const tomOutlook = tomPop >= 50 ? `brings a ${tomPop}% chance of rain` : `brings ${skyPhrase(tomorrow.conditions, false)}`;
    extra = ` Tomorrow ${tomOutlook} with a high near ${Math.round(tomorrow.air_temp_high)}${tu}.`;
  } else if (!isNight && typeof cc.uv === 'number' && cc.uv >= 6) {
    extra = ' Grab sunglasses and SPF with high UV today.';
  }

  return `${lead} ${precipPhrase}${windPhrase}${extra}`;
}

function sumPriorSixDaysPrecipMm(obsPayloads, startEpoch, endEpoch, timezone, precipYesterdayMm) {
  const days = new Map();
  const seenEpochs = new Set();
  let gotValid = false;

  for (const data of obsPayloads) {
    if (!data || !Array.isArray(data.obs)) continue;
    if (data.type !== 'obs_st' && data.type !== 'obs_sky') continue;
    gotValid = true;
    const isSky = data.type === 'obs_sky';
    for (const r of data.obs) {
      if (!r || typeof r[0] !== 'number') continue;
      if (r[0] < startEpoch || r[0] >= endEpoch) continue;
      if (seenEpochs.has(r[0])) continue;
      seenEpochs.add(r[0]);
      const dayKey = getLocalDateKey(r[0], timezone);
      if (!days.has(dayKey)) {
        days.set(dayKey, { sumRaw: 0, maxRaw: 0, sumNc: 0, maxNc: 0, useNc: false });
      }
      const b = days.get(dayKey);
      const rawInt = isSky ? (typeof r[3] === 'number' ? r[3] : 0) : (typeof r[12] === 'number' ? r[12] : 0);
      const rawDay = isSky ? (typeof r[11] === 'number' ? r[11] : 0) : (typeof r[18] === 'number' ? r[18] : 0);
      const ncInt = isSky ? (typeof r[14] === 'number' ? r[14] : null) : (typeof r[19] === 'number' ? r[19] : null);
      const ncDay = isSky ? (typeof r[15] === 'number' ? r[15] : null) : (typeof r[20] === 'number' ? r[20] : null);
      const aType = isSky ? r[16] : r[21];

      b.sumRaw += rawInt;
      if (rawDay > b.maxRaw) b.maxRaw = rawDay;
      if (ncInt !== null) b.sumNc += ncInt;
      if (ncDay !== null && ncDay > b.maxNc) b.maxNc = ncDay;
      if (aType === 1 && (ncInt !== null || ncDay !== null)) b.useNc = true;
    }
  }

  if (!gotValid) return null;

  const yestKey = getLocalDateKey(endEpoch - 43200, timezone);
  let totalMm = 0;
  for (const [key, d] of days.entries()) {
    let dayMm = d.useNc ? Math.max(d.sumNc, d.maxNc) : Math.max(d.sumRaw, d.maxRaw);
    if (key === yestKey && typeof precipYesterdayMm === 'number' && precipYesterdayMm > dayMm) {
      dayMm = precipYesterdayMm;
    }
    totalMm += dayMm;
  }
  if (!days.has(yestKey) && typeof precipYesterdayMm === 'number' && precipYesterdayMm > 0) {
    totalMm += precipYesterdayMm;
  }
  return totalMm;
}

function resolveStationObj(stationJson, stationId) {
  const list = stationJson?.stations || stationJson?.locations || [];
  return list.find((s) => String(s?.station_id ?? s?.location_id ?? '') === String(stationId)) || list[0] || {};
}

function collectCandidateDeviceIds(obsJson, devices) {
  const seen = new Set();
  const out = [];
  const add = (id) => {
    if (!id || seen.has(String(id))) return;
    seen.add(String(id));
    out.push(id);
  };
  if (obsJson?.device_id) add(obsJson.device_id);
  for (const d of devices) if (d.device_type === 'ST' && d.serial_number) add(d.device_id);
  for (const d of devices) if (d.device_type === 'SK' && d.serial_number) add(d.device_id);
  for (const d of devices) if (d.device_type === 'ST' || d.device_type === 'SK') add(d.device_id);
  return out;
}

function parseTodayObs(todayObs, localDayStart, isMetric) {
  if (!todayObs || (todayObs.type !== 'obs_st' && todayObs.type !== 'obs_sky') || !Array.isArray(todayObs.obs) || todayObs.obs.length === 0) {
    return null;
  }
  const isSky = todayObs.type === 'obs_sky';
  const rows = [...todayObs.obs].sort((a, b) => (Number(a?.[0]) || 0) - (Number(b?.[0]) || 0));
  const gustIdx = isSky ? 6 : 3;
  const solarIdx = isSky ? 10 : 11;
  const rainIdx = isSky ? 3 : 12;

  const todayRows = rows.filter((r) => r && typeof r[0] === 'number' && r[0] >= localDayStart);
  let windPeakToday = null;
  let solarPeakToday = null;
  let precipRate = 0;

  if (todayRows.length > 0) {
    let maxGustMps = 0;
    let maxSolar = 0;
    for (const r of todayRows) {
      if (typeof r[gustIdx] === 'number' && r[gustIdx] > maxGustMps) maxGustMps = r[gustIdx];
      if (typeof r[solarIdx] === 'number' && r[solarIdx] > maxSolar) maxSolar = r[solarIdx];
    }
    windPeakToday = isMetric ? maxGustMps * 3.6 : maxGustMps * 2.23694;
    solarPeakToday = maxSolar;

    const tail = todayRows.slice(-5);
    const rainSumMm = tail.reduce((acc, r) => acc + (typeof r[rainIdx] === 'number' ? r[rainIdx] : 0), 0);
    const rateMmHr = (rainSumMm / tail.length) * 60;
    precipRate = isMetric ? rateMmHr : rateMmHr / 25.4;
  }

  let pressureChange3hr = null;
  if (!isSky) {
    const latest = rows[rows.length - 1];
    if (latest && typeof latest[6] === 'number') {
      const targetEpoch = latest[0] - 10800;
      let best = null;
      let bestDiff = Infinity;
      for (const r of rows) {
        if (!r || typeof r[6] !== 'number') continue;
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
  }

  return { windPeakToday, solarPeakToday, pressureChange3hr, precipRate };
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

  let stationObj = resolveStationObj(stationJson, stationId);
  if (!Array.isArray(stationObj.devices) || stationObj.devices.length === 0) {
    const allSt = await fetchJson(`${TEMPEST_BASE}/stations?token=${encodeURIComponent(token)}`).catch(() => null);
    if (allSt) stationObj = resolveStationObj(allSt, stationId);
  }
  const devices = stationObj.devices || [];
  const candidateDeviceIds = collectCandidateDeviceIds(obsJson, devices);
  let deviceId = candidateDeviceIds[0] || null;
  const stationTz = stationObj.timezone || forecastJson?.timezone || 'UTC';

  const cc = forecastJson?.current_conditions || {};
  const latestObs = obsJson?.obs?.[0] || {};
  const dailyRaw = forecastJson?.forecast?.daily || [];
  const todayFc = dailyRaw[0] || {};

  const precipToday =
    cc.precip_accum_local_day ??
    (typeof latestObs.precip_accum_local_day_final === 'number'
      ? (isMetric ? latestObs.precip_accum_local_day_final : latestObs.precip_accum_local_day_final / 25.4)
      : typeof latestObs.precip_accum_local_day === 'number'
        ? (isMetric ? latestObs.precip_accum_local_day : latestObs.precip_accum_local_day / 25.4)
        : 0);
  const precipYesterday =
    cc.precip_accum_local_yesterday ??
    (typeof latestObs.precip_accum_local_yesterday_final === 'number'
      ? (isMetric ? latestObs.precip_accum_local_yesterday_final : latestObs.precip_accum_local_yesterday_final / 25.4)
      : typeof latestObs.precip_accum_local_yesterday === 'number'
        ? (isMetric ? latestObs.precip_accum_local_yesterday : latestObs.precip_accum_local_yesterday / 25.4)
        : 0);
  const precipYestMm =
    typeof latestObs.precip_accum_local_yesterday_final === 'number'
      ? latestObs.precip_accum_local_yesterday_final
      : typeof latestObs.precip_accum_local_yesterday === 'number'
        ? latestObs.precip_accum_local_yesterday
        : isMetric
          ? precipYesterday
          : precipYesterday * 25.4;

  let windPeakToday = null;
  let solarPeakToday = null;
  let pressureChange3hr = null;
  let precipRate = 0;
  let priorSixDaysMm = 0;
  let hasPriorSixDays = false;

  if (candidateDeviceIds.length > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const localDayStart = getLocalMidnightEpoch(nowSec, stationTz);
    const todayFetchStart = Math.min(localDayStart, nowSec - 14400);

    for (const candId of candidateDeviceIds) {
      let parsed = null;
      try {
        const todayObs = await fetchJson(
          `${TEMPEST_BASE}/observations/device/${candId}?time_start=${todayFetchStart}&time_end=${nowSec}&token=${encodeURIComponent(token)}`
        );
        parsed = parseTodayObs(todayObs, localDayStart, isMetric);
      } catch {}
      if (!parsed) {
        try {
          const td0 = await fetchJson(
            `${TEMPEST_BASE}/observations/device/${candId}?day_offset=0&token=${encodeURIComponent(token)}`
          );
          parsed = parseTodayObs(td0, localDayStart, isMetric);
        } catch {}
      }
      if (parsed) {
        deviceId = candId;
        windPeakToday = parsed.windPeakToday;
        solarPeakToday = parsed.solarPeakToday;
        pressureChange3hr = parsed.pressureChange3hr;
        precipRate = parsed.precipRate;
        break;
      }
    }

    if (deviceId) {
      const cacheKey = `${deviceId}_${localDayStart}`;
      const cached = sevenDayCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
        priorSixDaysMm = cached.mm;
        hasPriorSixDays = true;
      } else {
        try {
          const start6d = localDayStart - 6 * 86400;
          const mid3d = localDayStart - 3 * 86400;
          const payloads = await Promise.all([
            fetchJson(`${TEMPEST_BASE}/observations/device/${deviceId}?time_start=${start6d}&time_end=${mid3d - 1}&token=${encodeURIComponent(token)}`).catch(() => null),
            fetchJson(`${TEMPEST_BASE}/observations/device/${deviceId}?time_start=${mid3d}&time_end=${localDayStart - 1}&token=${encodeURIComponent(token)}`).catch(() => null),
          ]);
          let validPayloads = payloads.filter(Boolean);
          let isComplete = validPayloads.length === 2;
          if (validPayloads.length === 0) {
            const fb = await Promise.all(
              [1, 2, 3, 4, 5, 6].map((dOff) =>
                fetchJson(`${TEMPEST_BASE}/observations/device/${deviceId}?day_offset=${dOff}&token=${encodeURIComponent(token)}`).catch(() => null)
              )
            );
            validPayloads = fb.filter(Boolean);
            isComplete = validPayloads.length >= 5;
          }
          const sumMm = sumPriorSixDaysPrecipMm(validPayloads, start6d, localDayStart, stationTz, precipYestMm);
          if (sumMm !== null) {
            priorSixDaysMm = sumMm;
            hasPriorSixDays = true;
            if (isComplete) {
              sevenDayCache.set(cacheKey, { ts: Date.now(), mm: sumMm });
            }
          }
        } catch {
          // Optional enrichment
        }
      }
    }
  }

  const elevMeters = stationObj?.station_meta?.elevation ?? obsJson?.elevation ?? 0;
  const elevation = isMetric ? Math.round(elevMeters) : Math.round(elevMeters * 3.28084);

  const temp = cc.air_temperature ?? 0;
  const windGust = cc.wind_gust ?? cc.wind_avg ?? 0;
  const solar = cc.solar_radiation ?? 0;
  const precip7Day = hasPriorSixDays
    ? precipToday + (isMetric ? priorSixDaysMm : priorSixDaysMm / 25.4)
    : precipToday + precipYesterday;
  const lightningCount1hr = cc.lightning_strike_count_last_1hr ?? latestObs.lightning_strike_count_last_1hr ?? 0;
  const lightningLastEpoch = cc.lightning_strike_last_epoch ?? latestObs.lightning_strike_last_epoch ?? null;
  const lightningLastDistance =
    cc.lightning_strike_last_distance ??
    (typeof latestObs.lightning_strike_last_distance === 'number'
      ? (isMetric ? latestObs.lightning_strike_last_distance : latestObs.lightning_strike_last_distance * 0.621371)
      : null);

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
      timezone: stationTz,
    },
    current: {
      epoch: latestObs.timestamp || cc.time || Math.floor(Date.now() / 1000),
      temperature: temp,
      feelsLike: cc.feels_like ?? temp,
      conditions: cc.conditions || todayFc.conditions || 'Clear',
      summary: buildNarrativeSummary(forecastJson, units, stationTz),
      forecastBriefing: buildWeathermanBriefing(forecastJson, units, stationTz),
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
      lightningCount1hr,
      lightningLastDistance,
      lightningLastEpoch,
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
      const rawAp = process.env.TEMPEST_AVATAR_AUTOPLAY ?? cfg.TEMPEST_AVATAR_AUTOPLAY;
      const avatarAutoplay = rawAp === 'false' ? false : rawAp === 'true' ? true : null;
      return sendJson(res, 200, {
        hasServerToken: Boolean(token),
        wsToken: token,
        stationId,
        avatarAutoplay,
      });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      const token = String(parsed.token || '').trim();
      const stationId = String(parsed.stationId || '').trim();
      const avatarAutoplay = typeof parsed.avatarAutoplay === 'boolean' ? parsed.avatarAutoplay : undefined;
      await saveDotEnv({ token, stationId, port: PORT, avatarAutoplay });
      const cfg = await loadDotEnv();
      return sendJson(res, 200, {
        ok: true,
        hasServerToken: Boolean(cfg.TEMPEST_API_TOKEN),
        stationId: cfg.TEMPEST_STATION_ID || '218212',
        avatarAutoplay: cfg.TEMPEST_AVATAR_AUTOPLAY === 'false' ? false : cfg.TEMPEST_AVATAR_AUTOPLAY === 'true' ? true : null,
      });
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
