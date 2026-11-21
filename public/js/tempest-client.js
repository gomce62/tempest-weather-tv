/**
 * WeatherFlow Tempest REST + Real-Time WebSocket Client
 *
 * Supports:
 * 1. Local proxy server (/api/dashboard) -> zero CORS issues, computes Peak Wind, Peak Solar, 3-hr Pressure Delta & 7-Day Precip.
 * 2. Direct Tempest REST API fallback (https://swd.weatherflow.com/swd/rest/...) if served statically.
 * 3. Live WebSocket (wss://ws.weatherflow.com/swd/data) for 3-second rapid wind and 1-minute obs_st sensor updates.
 */

const TEMPEST_REST_BASE = 'https://swd.weatherflow.com/swd/rest';
const TEMPEST_WS_BASE = 'wss://ws.weatherflow.com/swd/data';
const NOAA_TIDES_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MORRO_BAY_NOAA_STATION = '9412110';

const browserTideCache = new Map();

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

export async function fetchMorroBayTides(units = 'imperial') {
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
  const cached = browserTideCache.get(cacheKey);
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
    const res = await fetch(`${NOAA_TIDES_BASE}?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
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
        browserTideCache.set(cacheKey, { ts: Date.now(), data: out });
        return out;
      }
    }
  } catch {
    // Non-fatal fallback
  }
  return null;
}

export function degreesToCardinal(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '--';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

const directSevenDayCache = new Map();

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

export function buildNarrativeSummary(betterForecast, units, timezone) {
  const cc = betterForecast?.current_conditions || {};
  const today = betterForecast?.forecast?.daily?.[0];
  const hourly = betterForecast?.forecast?.hourly || [];
  const tempUnit = units === 'metric' ? '°C' : '°F';
  const windUnit = units === 'metric' ? 'km/h' : 'mph';

  const cond = cc.conditions || today?.conditions || 'Clear';
  const parts = [];

  // Sky / condition sentence
  if (/sky|skies|cloud|clear|sun|rain|storm|snow|fog/i.test(cond)) {
    const clean = cond.charAt(0).toUpperCase() + cond.slice(1);
    parts.push(/skies|likely|possible|showers|storms/i.test(clean) ? `${clean}.` : `${clean} skies.`);
  } else {
    parts.push(`${cond}.`);
  }

  // Low / High mention depending on time of day
  const hour = getStationHour(timezone);
  if (today) {
    if (hour >= 16 || hour < 5) {
      if (typeof today.air_temp_low === 'number') {
        parts.push(`Low ${Math.round(today.air_temp_low)}${tempUnit}.`);
      }
    } else if (typeof today.air_temp_high === 'number') {
      parts.push(`High ${Math.round(today.air_temp_high)}${tempUnit}.`);
    }
  }

  // Wind sentence from upcoming hours or current
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

export function buildWeathermanBriefing(betterForecast, units, timezone) {
  const cc = betterForecast?.current_conditions || {};
  const daily = betterForecast?.forecast?.daily || [];
  const today = daily[0] || null;
  const tomorrow = daily[1] || null;
  const hourly = betterForecast?.forecast?.hourly || [];
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

  const nowSec = Math.floor(Date.now() / 1000);
  const upcomingHourly = hourly.filter((h) => typeof h?.time === 'number' && h.time >= nowSec - 1800);
  const next12 = (upcomingHourly.length ? upcomingHourly : hourly).slice(0, 12);
  let peakPopH = null;
  for (const h of next12) {
    if (typeof h.precip_probability === 'number') {
      if (!peakPopH || h.precip_probability > peakPopH.precip_probability) peakPopH = h;
    }
  }
  const pop = (hr >= 12 || hr < 5) && peakPopH
    ? Math.round(peakPopH.precip_probability)
    : (typeof today?.precip_probability === 'number' ? Math.round(today.precip_probability) : 0);
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

export function buildWeathermanBriefingFromDashboard(data) {
  const cur = data?.current || {};
  const daily = data?.daily || [];
  const hourly = data?.hourly || [];
  const tz = data?.station?.timezone;
  const betterForecast = {
    current_conditions: {
      conditions: cur.conditions,
      wind_avg: cur.windSpeed,
      wind_direction: cur.windDirection,
      wind_direction_cardinal: cur.windCardinal,
      uv: cur.uv,
    },
    forecast: {
      daily: daily.map((d) => ({
        air_temp_high: d.high,
        air_temp_low: d.low,
        precip_probability: d.precipProbability,
        conditions: d.conditions,
      })),
      hourly: hourly.map((h) => ({
        time: h.t ?? h.time,
        precip_probability: h.p ?? h.precip_probability ?? 0,
        wind_avg: h.w ?? h.wind_avg,
        wind_direction: h.d ?? h.wind_direction,
      })),
    },
  };
  return buildWeathermanBriefing(betterForecast, data?.units || 'imperial', tz);
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
  const out = {};

  if (todayRows.length > 0) {
    let maxG = 0;
    let maxS = 0;
    for (const r of todayRows) {
      if (typeof r[gustIdx] === 'number' && r[gustIdx] > maxG) maxG = r[gustIdx];
      if (typeof r[solarIdx] === 'number' && r[solarIdx] > maxS) maxS = r[solarIdx];
    }
    out.windPeakToday = isMetric ? maxG * 3.6 : maxG * 2.23694;
    out.solarPeakToday = maxS;

    const tail = todayRows.slice(-5);
    const rainMm = tail.reduce((acc, r) => acc + (typeof r[rainIdx] === 'number' ? r[rainIdx] : 0), 0);
    const rateMmHr = (rainMm / tail.length) * 60;
    out.precipRate = isMetric ? rateMmHr : rateMmHr / 25.4;
  }

  if (!isSky) {
    const latest = rows[rows.length - 1];
    if (latest && typeof latest[6] === 'number') {
      const target = latest[0] - 10800;
      let best = null;
      let bestDiff = Infinity;
      for (const r of rows) {
        if (!r || typeof r[6] !== 'number') continue;
        const diff = Math.abs(r[0] - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = r;
        }
      }
      if (best && bestDiff < 5400) {
        const dMb = latest[6] - best[6];
        out.pressureChange3hr = isMetric ? Number(dMb.toFixed(1)) : Number((dMb * 0.029529983).toFixed(2));
      }
    }
  }

  return out;
}

/**
 * Fetches server configuration (whether a server-side .env token is present, default station ID).
 */
export async function fetchServerConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Saves API token and station ID to server .env (if running via local server).
 */
export async function saveServerConfig({ token, stationId }) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, stationId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || 'Failed to save configuration to server');
  }
  return await res.json();
}

/**
 * Fetch complete dashboard payload for a Tempest station.
 */
export async function fetchTempestDashboard({ stationId, token, units = 'imperial', useServerToken = false }) {
  const headers = {};
  if (token) {
    headers['X-Tempest-Token'] = token;
  }

  // 1. Prefer local server proxy (avoids CORS + computes today peaks, 3-hr pressure delta, 7-day precip)
  try {
    const proxyUrl = `/api/dashboard?stationId=${encodeURIComponent(stationId)}&units=${encodeURIComponent(units)}`;
    const res = await fetch(proxyUrl, { headers, cache: 'no-store' });
    if (res.ok) {
      const payload = await res.json();
      if (payload && payload.station && payload.current) {
        return payload;
      }
    } else if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 404 || res.status === 502) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Tempest API error (HTTP ${res.status})`);
    }
  } catch (err) {
    // If the proxy responded with a genuine API auth/station error, rethrow immediately
    if (err.message && /Tempest|token|station|401|403|404/i.test(err.message)) {
      throw err;
    }
    // Otherwise (e.g., running on a static host without /api), try direct REST API
    if (!token && useServerToken) {
      throw new Error('Could not reach local dashboard server.');
    }
  }

  if (!token) {
    throw new Error('Please enter your Tempest Personal Access Token in Settings.');
  }

  // 2. Direct browser fallback to WeatherFlow REST API
  return await fetchDirectFromWeatherFlow({ stationId, token, units });
}

async function fetchDirectFromWeatherFlow({ stationId, token, units }) {
  const isMetric = units === 'metric';
  const bfParams = new URLSearchParams({
    station_id: String(stationId),
    units_temp: isMetric ? 'c' : 'f',
    units_wind: isMetric ? 'kph' : 'mph',
    units_pressure: isMetric ? 'mb' : 'inhg',
    units_precip: isMetric ? 'mm' : 'in',
    units_distance: isMetric ? 'km' : 'mi',
    token,
  });

  const [stationRes, forecastRes, obsRes, tides] = await Promise.all([
    fetch(`${TEMPEST_REST_BASE}/stations/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`),
    fetch(`${TEMPEST_REST_BASE}/better_forecast?${bfParams.toString()}`),
    fetch(`${TEMPEST_REST_BASE}/observations/station/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`),
    fetchMorroBayTides(units),
  ]);

  if (stationRes.status === 401 || forecastRes.status === 401) {
    throw new Error('Invalid Tempest API token (401 Unauthorized). Check your Personal Access Token.');
  }
  if (!forecastRes.ok) {
    throw new Error(`Tempest forecast request failed (HTTP ${forecastRes.status}).`);
  }

  const stationJson = stationRes.ok ? await stationRes.json() : {};
  const forecastJson = await forecastRes.json();
  const obsJson = obsRes.ok ? await obsRes.json() : {};

  let stationObj = resolveStationObj(stationJson, stationId);
  if (!Array.isArray(stationObj.devices) || stationObj.devices.length === 0) {
    const allSt = await fetch(`${TEMPEST_REST_BASE}/stations?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (allSt) stationObj = resolveStationObj(allSt, stationId);
  }
  const devices = stationObj.devices || [];
  const candidateDeviceIds = collectCandidateDeviceIds(obsJson, devices);
  let deviceId = candidateDeviceIds[0] || null;
  const stationTz = stationObj.timezone || forecastJson?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const historyStats = {};
  if (candidateDeviceIds.length > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const localDayStart = getLocalMidnightEpoch(nowSec, stationTz);
    const todayFetchStart = Math.min(localDayStart, nowSec - 14400);
    const cc = forecastJson?.current_conditions || {};
    const latestObs = obsJson?.obs?.[0] || {};
    const precipYestRaw = cc.precip_accum_local_yesterday;
    const precipYestMm =
      typeof latestObs.precip_accum_local_yesterday_final === 'number'
        ? latestObs.precip_accum_local_yesterday_final
        : typeof latestObs.precip_accum_local_yesterday === 'number'
          ? latestObs.precip_accum_local_yesterday
          : typeof precipYestRaw === 'number'
            ? isMetric
              ? precipYestRaw
              : precipYestRaw * 25.4
            : 0;

    for (const candId of candidateDeviceIds) {
      let todayObs = await fetch(
        `${TEMPEST_REST_BASE}/observations/device/${candId}?time_start=${todayFetchStart}&time_end=${nowSec}&token=${encodeURIComponent(token)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      let parsed = parseTodayObs(todayObs, localDayStart, isMetric);
      if (!parsed) {
        todayObs = await fetch(
          `${TEMPEST_REST_BASE}/observations/device/${candId}?day_offset=0&token=${encodeURIComponent(token)}`
        )
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        parsed = parseTodayObs(todayObs, localDayStart, isMetric);
      }
      if (parsed) {
        deviceId = candId;
        Object.assign(historyStats, parsed);
        break;
      }
    }

    if (deviceId) {
      const cacheKey = `${deviceId}_${localDayStart}`;
      const cached6d = directSevenDayCache.get(cacheKey);
      const sixDayRes =
        cached6d && Date.now() - cached6d.ts < 30 * 60 * 1000
          ? { cachedMm: cached6d.mm }
          : await Promise.all([
              fetch(
                `${TEMPEST_REST_BASE}/observations/device/${deviceId}?time_start=${localDayStart - 6 * 86400}&time_end=${localDayStart - 3 * 86400 - 1}&token=${encodeURIComponent(token)}`
              )
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null),
              fetch(
                `${TEMPEST_REST_BASE}/observations/device/${deviceId}?time_start=${localDayStart - 3 * 86400}&time_end=${localDayStart - 1}&token=${encodeURIComponent(token)}`
              )
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null),
            ]);

      const pTodayDisp =
        cc.precip_accum_local_day ??
        (typeof latestObs.precip_accum_local_day_final === 'number'
          ? isMetric
            ? latestObs.precip_accum_local_day_final
            : latestObs.precip_accum_local_day_final / 25.4
          : typeof latestObs.precip_accum_local_day === 'number'
            ? isMetric
              ? latestObs.precip_accum_local_day
              : latestObs.precip_accum_local_day / 25.4
            : 0);

      if (sixDayRes && typeof sixDayRes.cachedMm === 'number') {
        historyStats.precip7Day = pTodayDisp + (isMetric ? sixDayRes.cachedMm : sixDayRes.cachedMm / 25.4);
      } else if (Array.isArray(sixDayRes)) {
        let valid = sixDayRes.filter(Boolean);
        let isComplete = valid.length === 2;
        if (valid.length === 0) {
          const fb = await Promise.all(
            [1, 2, 3, 4, 5, 6].map((dOff) =>
              fetch(`${TEMPEST_REST_BASE}/observations/device/${deviceId}?day_offset=${dOff}&token=${encodeURIComponent(token)}`)
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null)
            )
          );
          valid = fb.filter(Boolean);
          isComplete = valid.length >= 5;
        }
        const sumMm = sumPriorSixDaysPrecipMm(valid, localDayStart - 6 * 86400, localDayStart, stationTz, precipYestMm);
        if (sumMm !== null) {
          if (isComplete) {
            directSevenDayCache.set(cacheKey, { ts: Date.now(), mm: sumMm });
          }
          historyStats.precip7Day = pTodayDisp + (isMetric ? sumMm : sumMm / 25.4);
        }
      }
    }
  }

  return normalizeTempestResponses({ stationJson, forecastJson, obsJson, historyStats, tides, stationId, units, resolvedStationObj: stationObj, resolvedDeviceId: deviceId });
}

export function normalizeTempestResponses({ stationJson, forecastJson, obsJson, historyStats, tides = null, stationId, units, resolvedStationObj = null, resolvedDeviceId = null }) {
  const isMetric = units === 'metric';
  const stationObj = resolvedStationObj || resolveStationObj(stationJson, stationId);
  const devices = stationObj.devices || [];
  const tempestDevice =
    devices.find((d) => d.device_id === resolvedDeviceId) ||
    devices.find((d) => d.device_type === 'ST' && d.serial_number) ||
    devices.find((d) => d.device_type === 'SK' && d.serial_number) ||
    devices.find((d) => d.device_type === 'ST') ||
    devices.find((d) => d.device_type === 'SK') ||
    devices.find((d) => d.device_type === 'AR') ||
    null;

  const cc = forecastJson?.current_conditions || {};
  const latestObs = obsJson?.obs?.[0] || {};
  const dailyRaw = forecastJson?.forecast?.daily || [];
  const hourlyRaw = forecastJson?.forecast?.hourly || [];
  const todayForecast = dailyRaw[0] || {};
  const stationTz = stationObj.timezone || forecastJson?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Elevation from Tempest is in meters
  const elevMeters = stationObj?.station_meta?.elevation ?? obsJson?.elevation ?? 0;
  const elevation = isMetric ? Math.round(elevMeters) : Math.round(elevMeters * 3.28084);

  const windDir = cc.wind_direction ?? latestObs.wind_direction ?? 0;
  const windCardinal = cc.wind_direction_cardinal || degreesToCardinal(windDir);

  // Convert latestObs SI values if cc didn't include them
  const cToDisplay = (c) => (isMetric ? c : (c * 9) / 5 + 32);
  const mpsToDisplay = (mps) => (isMetric ? mps * 3.6 : mps * 2.23694);
  const mbToDisplay = (mb) => (isMetric ? mb : mb * 0.029529983);
  const mmToDisplay = (mm) => (isMetric ? mm : mm / 25.4);

  const temperature =
    cc.air_temperature ?? (typeof latestObs.air_temperature === 'number' ? cToDisplay(latestObs.air_temperature) : 0);
  const feelsLike =
    cc.feels_like ?? (typeof latestObs.feels_like === 'number' ? cToDisplay(latestObs.feels_like) : temperature);
  const dewPoint =
    cc.dew_point ?? (typeof latestObs.dew_point === 'number' ? cToDisplay(latestObs.dew_point) : temperature);
  const humidity = cc.relative_humidity ?? latestObs.relative_humidity ?? 0;
  const windSpeed = cc.wind_avg ?? (typeof latestObs.wind_avg === 'number' ? mpsToDisplay(latestObs.wind_avg) : 0);
  const windGust = cc.wind_gust ?? (typeof latestObs.wind_gust === 'number' ? mpsToDisplay(latestObs.wind_gust) : windSpeed);
  const pressure =
    cc.sea_level_pressure ??
    cc.station_pressure ??
    (typeof latestObs.sea_level_pressure === 'number' ? mbToDisplay(latestObs.sea_level_pressure) : isMetric ? 1013.2 : 29.92);

  const precipToday =
    cc.precip_accum_local_day ??
    (typeof latestObs.precip_accum_local_day_final === 'number'
      ? mmToDisplay(latestObs.precip_accum_local_day_final)
      : typeof latestObs.precip_accum_local_day === 'number'
        ? mmToDisplay(latestObs.precip_accum_local_day)
        : 0);

  const precipYesterday =
    cc.precip_accum_local_yesterday ??
    (typeof latestObs.precip_accum_local_yesterday_final === 'number'
      ? mmToDisplay(latestObs.precip_accum_local_yesterday_final)
      : typeof latestObs.precip_accum_local_yesterday === 'number'
        ? mmToDisplay(latestObs.precip_accum_local_yesterday)
        : 0);

  const solarRadiation = cc.solar_radiation ?? latestObs.solar_radiation ?? 0;
  const uv = cc.uv ?? latestObs.uv ?? 0;

  const stats = historyStats || {};
  const windPeakToday = Math.max(windGust, stats.windPeakToday ?? windGust);
  const solarPeakToday = Math.max(solarRadiation, stats.solarPeakToday ?? solarRadiation);
  const pressureChange3hr = stats.pressureChange3hr ?? null;
  const precipRate = stats.precipRate ?? (typeof latestObs.precip === 'number' ? mmToDisplay(latestObs.precip * 60) : 0);
  const precip7Day = stats.precip7Day ?? precipToday + precipYesterday;

  const daily = dailyRaw.map((d) => ({
    dayStartEpoch: d.day_start_local,
    dateObj: new Date(d.day_start_local * 1000),
    conditions: d.conditions || '',
    icon: d.icon || 'partly-cloudy-day',
    high: d.air_temp_high,
    low: d.air_temp_low,
    precipProbability: d.precip_probability ?? 0,
    sunrise: d.sunrise,
    sunset: d.sunset,
  }));

  return {
    isDemo: false,
    units,
    station: {
      stationId: String(stationObj.station_id || stationId),
      deviceId: resolvedDeviceId || obsJson?.device_id || tempestDevice?.device_id || null,
      name: stationObj.public_name || stationObj.name || obsJson?.public_name || obsJson?.station_name || `Tempest Station ${stationId}`,
      badge: `TEMPEST ${stationId}`,
      elevation,
      elevationUnit: isMetric ? 'm' : 'ft',
      latitude: stationObj.latitude ?? forecastJson?.latitude ?? obsJson?.latitude ?? 0,
      longitude: stationObj.longitude ?? forecastJson?.longitude ?? obsJson?.longitude ?? 0,
      timezone: stationTz,
    },
    current: {
      epoch: latestObs.timestamp || cc.time || Math.floor(Date.now() / 1000),
      temperature,
      feelsLike,
      conditions: cc.conditions || todayForecast.conditions || 'Clear',
      summary: buildNarrativeSummary(forecastJson, units, stationTz),
      forecastBriefing: buildWeathermanBriefing(forecastJson, units, stationTz),
      icon: cc.icon || todayForecast.icon || 'partly-cloudy-day',
      todayLow: todayForecast.air_temp_low ?? temperature - 8,
      todayHigh: todayForecast.air_temp_high ?? temperature + 8,
      humidity,
      dewPoint,
      windSpeed,
      windGust,
      windPeakToday,
      windDirection: windDir,
      windCardinal,
      pressure,
      pressureTrend: (cc.pressure_trend || latestObs.pressure_trend || 'steady').toLowerCase(),
      pressureChange3hr,
      precipToday,
      precipRate,
      precip7Day,
      uv,
      solarRadiation,
      solarPeakToday,
      lightningCount1hr: cc.lightning_strike_count_last_1hr ?? latestObs.lightning_strike_count_last_1hr ?? 0,
      lightningLastDistance:
        cc.lightning_strike_last_distance ??
        (typeof latestObs.lightning_strike_last_distance === 'number'
          ? isMetric
            ? latestObs.lightning_strike_last_distance
            : latestObs.lightning_strike_last_distance * 0.621371
          : null),
      lightningLastEpoch: cc.lightning_strike_last_epoch ?? latestObs.lightning_strike_last_epoch ?? null,
    },
    astronomy: {
      sunriseEpoch: todayForecast.sunrise || null,
      sunsetEpoch: todayForecast.sunset || null,
    },
    tides,
    daily,
    hourly: hourlyRaw.map((h) => ({
      t: h.time,
      i: h.icon || 'partly-cloudy-day',
      tmp: typeof h.air_temperature === 'number' ? Number(h.air_temperature.toFixed(1)) : Number(temperature.toFixed(1)),
      p: Math.round(h.precip_probability ?? 0),
      w: typeof h.wind_avg === 'number' ? Number(h.wind_avg.toFixed(1)) : 0,
      d: Math.round(h.wind_direction ?? 0),
    })),
  };
}

/**
 * Real-time WeatherFlow Tempest WebSocket Manager
 * Streams 3-second rapid_wind and 1-minute obs_st updates directly from Tempest cloud.
 */
export class TempestWebSocket {
  constructor({ onStatus, onRapidWind, onObservation }) {
    this.onStatus = onStatus;
    this.onRapidWind = onRapidWind;
    this.onObservation = onObservation;
    this.ws = null;
    this.deviceId = null;
    this.token = null;
    this.reconnectTimer = null;
    this.intentionalClose = false;
  }

  connect(token, deviceId) {
    this.disconnect();
    if (!token || !deviceId) return;

    this.token = token;
    this.deviceId = Number(deviceId);
    this.intentionalClose = false;

    this.onStatus?.('connecting');
    try {
      const ws = new WebSocket(`${TEMPEST_WS_BASE}?token=${encodeURIComponent(token)}`);
      this.ws = ws;

      ws.onopen = () => {
        this.onStatus?.('live');
        // Subscribe to 1-minute observations
        ws.send(
          JSON.stringify({
            type: 'listen_start',
            device_id: this.deviceId,
            id: `obs-${Date.now()}`,
          })
        );
        // Subscribe to 3-second rapid wind
        ws.send(
          JSON.stringify({
            type: 'listen_rapid_start',
            device_id: this.deviceId,
            id: `wind-${Date.now()}`,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'rapid_wind' && Array.isArray(msg.ob)) {
            // [epoch, wind_speed_mps, wind_dir_deg]
            this.onRapidWind?.({
              epoch: msg.ob[0],
              windSpeedMps: msg.ob[1],
              windDirection: msg.ob[2],
            });
          } else if (msg.type === 'obs_st' && Array.isArray(msg.obs?.[0])) {
            // Tempest obs_st array layout:
            // 0:epoch, 1:lull(m/s), 2:avg(m/s), 3:gust(m/s), 4:dir(deg), 5:interval,
            // 6:station_pressure(mb), 7:air_temp(C), 8:rh(%), 9:illuminance(lux),
            // 10:uv, 11:solar_rad(W/m2), 12:rain_accum_1min(mm), 13:precip_type,
            // 14:strike_avg_dist, 15:strike_count, 16:battery, 17:report_interval
            const ob = msg.obs[0];
            this.onObservation?.({
              epoch: ob[0],
              windLullMps: ob[1],
              windAvgMps: ob[2],
              windGustMps: ob[3],
              windDirection: ob[4],
              stationPressureMb: ob[6],
              airTempC: ob[7],
              humidity: ob[8],
              uv: ob[10],
              solarRadiation: ob[11],
              rain1MinMm: ob[12],
              precipTodayMm: msg.summary?.precip_total_1h !== undefined ? null : null,
              summary: msg.summary || null,
            });
          }
        } catch {
          // Ignore malformed keepalive frames
        }
      };

      ws.onerror = () => {
        this.onStatus?.('polling');
      };

      ws.onclose = () => {
        if (!this.intentionalClose) {
          this.onStatus?.('polling');
          this.reconnectTimer = setTimeout(() => {
            if (!this.intentionalClose && this.token && this.deviceId) {
              this.connect(this.token, this.deviceId);
            }
          }, 15000);
        }
      };
    } catch {
      this.onStatus?.('polling');
    }
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }
}
