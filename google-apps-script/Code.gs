/**
 * Secure WeatherFlow Tempest Proxy for Google Sites (Google Apps Script)
 *
 * Keeps your Tempest Personal Access Token 100% hidden on Google's servers!
 * Visitors to your published Google Site only receive the weather JSON — never your token.
 *
 * SETUP (takes ~60 seconds):
 * 1. Go to https://script.google.com -> New project -> name it "Tempest Weather Proxy".
 * 2. Replace the contents of Code.gs with this file and Save.
 * 3. Click the Gear icon (Project Settings) -> Script Properties -> Add script property:
 *      Property: TEMPEST_API_TOKEN
 *      Value:    <your Tempest Personal Access Token>
 *    (Optional: you can also store TEMPEST_STATION_ID = 218212)
 *    (Alternative: if you'd rather keep the token in a private Google Drive text file,
 *     set Script Property TEMPEST_DRIVE_FILE_ID = <Drive file ID> instead.)
 * 4. Click Deploy -> New deployment -> Select type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Click Deploy, authorize, and copy the Web app URL (https://script.google.com/macros/s/.../exec).
 * 5. Paste that Web app URL into EMBEDDED_CONFIG.proxyUrl in your Google Sites Embed code
 *    (or in the dashboard's Settings gear modal).
 */

const TEMPEST_BASE = 'https://swd.weatherflow.com/swd/rest';

function getSecretToken_() {
  const props = PropertiesService.getScriptProperties();
  const direct = (props.getProperty('TEMPEST_API_TOKEN') || '').trim();
  if (direct) return direct;

  // Optional: read token from a private Google Drive file (only readable by your Google account)
  const fileId = (props.getProperty('TEMPEST_DRIVE_FILE_ID') || '').trim();
  if (fileId) {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString().trim();
  }
  return '';
}

function doGet(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const params = (e && e.parameter) || {};
    const stationId = String(params.stationId || props.getProperty('TEMPEST_STATION_ID') || '218212').trim();
    const units = params.units === 'metric' ? 'metric' : 'imperial';

    const token = getSecretToken_();
    if (!token) {
      return jsonResponse_({ error: 'TEMPEST_API_TOKEN is not configured in Apps Script Properties.' });
    }

    // Cache live dashboard payload for 30 seconds to keep responses fast & rate-limit safe
    const cache = CacheService.getScriptCache();
    const cacheKey = 'dash_' + stationId + '_' + units;
    const cached = cache.get(cacheKey);
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    const payload = fetchTempestDashboard_(stationId, token, units);
    const out = JSON.stringify(payload);
    try {
      cache.put(cacheKey, out, 30);
    } catch (err) {
      // Ignore if payload exceeds cache size limit
    }
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return jsonResponse_({ error: err.message || 'Failed to fetch Tempest weather data.' });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fetchJson_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 401) throw new Error('Invalid Tempest API token (401 Unauthorized).');
  if (code === 403) throw new Error('Access denied to this Tempest station (403 Forbidden).');
  if (code < 200 || code >= 300) throw new Error('Tempest API returned HTTP ' + code);
  return JSON.parse(res.getContentText());
}

function degToCardinal_(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round((((Number(deg || 0) % 360) + 360) % 360) / 22.5) % 16];
}

function buildSummary_(bf, units) {
  const cc = bf.current_conditions || {};
  const today = (bf.forecast && bf.forecast.daily && bf.forecast.daily[0]) || null;
  const hourly = (bf.forecast && bf.forecast.hourly) || [];
  const tu = units === 'metric' ? '°C' : '°F';
  const wu = units === 'metric' ? 'km/h' : 'mph';
  const cond = cc.conditions || (today && today.conditions) || 'Clear';
  const parts = [/skies|likely|possible|showers|storms|rain|snow/i.test(cond) ? cond + '.' : cond + ' skies.'];

  const hr = new Date().getHours();
  if (today) {
    if ((hr >= 16 || hr < 5) && typeof today.air_temp_low === 'number') {
      parts.push('Low ' + Math.round(today.air_temp_low) + tu + '.');
    } else if (typeof today.air_temp_high === 'number') {
      parts.push('High ' + Math.round(today.air_temp_high) + tu + '.');
    }
  }
  const next = hourly.slice(0, 6).filter(function (h) { return typeof h.wind_avg === 'number'; });
  if (next.length >= 2) {
    const speeds = next.map(function (h) { return h.wind_avg; });
    const minW = Math.max(0, Math.round(Math.min.apply(null, speeds)));
    const maxW = Math.max(minW + 2, Math.round(Math.max.apply(null, speeds)));
    const dir = next[0].wind_direction_cardinal || cc.wind_direction_cardinal || degToCardinal_(cc.wind_direction);
    parts.push('Winds ' + dir + ' at ' + minW + ' to ' + maxW + ' ' + wu + '.');
  }
  return parts.join(' ');
}

function fetchTempestDashboard_(stationId, token, units) {
  const m = units === 'metric';
  const tok = encodeURIComponent(token);
  const sid = encodeURIComponent(stationId);

  const bfUrl = TEMPEST_BASE + '/better_forecast?station_id=' + sid +
    '&units_temp=' + (m ? 'c' : 'f') +
    '&units_wind=' + (m ? 'kph' : 'mph') +
    '&units_pressure=' + (m ? 'mb' : 'inhg') +
    '&units_precip=' + (m ? 'mm' : 'in') +
    '&units_distance=' + (m ? 'km' : 'mi') +
    '&token=' + tok;

  let stJson = {};
  try { stJson = fetchJson_(TEMPEST_BASE + '/stations/' + sid + '?token=' + tok); } catch (e) {
    if (/401|403/.test(e.message)) throw e;
  }
  const bfJson = fetchJson_(bfUrl);
  let obJson = {};
  try { obJson = fetchJson_(TEMPEST_BASE + '/observations/station/' + sid + '?token=' + tok); } catch (e) {}

  const stObj = (stJson.stations && stJson.stations[0]) || {};
  const devs = stObj.devices || [];
  let dev = null;
  for (let i = 0; i < devs.length; i++) {
    if (devs[i].device_type === 'ST') { dev = devs[i]; break; }
  }
  if (!dev) {
    for (let i = 0; i < devs.length; i++) {
      if (devs[i].device_type === 'SK') { dev = devs[i]; break; }
    }
  }
  const deviceId = (dev && dev.device_id) || obJson.device_id || null;

  let windPeakToday = null;
  let solarPeakToday = null;
  let pressureChange3hr = null;
  let precipRate = 0;
  let priorSixMm = 0;
  let hasPriorSix = false;

  if (deviceId) {
    // Fetch last 24h via time_start/time_end so local-day peaks work cleanly even after UTC midnight
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const localDayStart = (bfJson.forecast && bfJson.forecast.daily && bfJson.forecast.daily[0] && bfJson.forecast.daily[0].day_start_local) || (nowSec - 86400);
      const td = fetchJson_(TEMPEST_BASE + '/observations/device/' + deviceId + '?time_start=' + localDayStart + '&time_end=' + nowSec + '&token=' + tok);
      if (td && td.type === 'obs_st' && Array.isArray(td.obs) && td.obs.length > 0) {
        const rows = td.obs;
        let maxG = 0, maxS = 0;
        for (let i = 0; i < rows.length; i++) {
          if (typeof rows[i][3] === 'number' && rows[i][3] > maxG) maxG = rows[i][3];
          if (typeof rows[i][11] === 'number' && rows[i][11] > maxS) maxS = rows[i][11];
        }
        windPeakToday = m ? maxG * 3.6 : maxG * 2.23694;
        solarPeakToday = maxS;

        const last = rows[rows.length - 1];
        if (typeof last[6] === 'number') {
          const target = last[0] - 10800;
          let best = null, bestDiff = Infinity;
          for (let i = 0; i < rows.length; i++) {
            if (typeof rows[i][6] !== 'number') continue;
            const diff = Math.abs(rows[i][0] - target);
            if (diff < bestDiff) { bestDiff = diff; best = rows[i]; }
          }
          if (best && bestDiff < 5400) {
            const dMb = last[6] - best[6];
            pressureChange3hr = m ? Number(dMb.toFixed(1)) : Number((dMb * 0.029529983).toFixed(2));
          }
        }

        const tail = rows.slice(-5);
        let rainMm = 0;
        for (let i = 0; i < tail.length; i++) {
          if (typeof tail[i][12] === 'number') rainMm += tail[i][12];
        }
        const rateMmHr = (rainMm / tail.length) * 60;
        precipRate = m ? rateMmHr : rateMmHr / 25.4;
      }
    } catch (e) {}

    // Cache prior 6 days precip for 30 minutes
    const cache = CacheService.getScriptCache();
    const pKey = 'rain6d_' + deviceId;
    const pCached = cache.get(pKey);
    if (pCached !== null) {
      priorSixMm = Number(pCached) || 0;
      hasPriorSix = true;
    } else {
      try {
        let sum = 0;
        for (let d = 1; d <= 6; d++) {
          const dayData = fetchJson_(TEMPEST_BASE + '/observations/device/' + deviceId + '?day_offset=' + d + '&token=' + tok);
          if (dayData && dayData.type === 'obs_st' && Array.isArray(dayData.obs)) {
            for (let i = 0; i < dayData.obs.length; i++) {
              if (typeof dayData.obs[i][12] === 'number') sum += dayData.obs[i][12];
            }
          }
        }
        priorSixMm = sum;
        hasPriorSix = true;
        cache.put(pKey, String(sum), 1800);
      } catch (e) {}
    }
  }

  const cc = bfJson.current_conditions || {};
  const lastOb = (obJson.obs && obJson.obs[0]) || {};
  const dailyRaw = (bfJson.forecast && bfJson.forecast.daily) || [];
  const todayFc = dailyRaw[0] || {};
  const elevM = (stObj.station_meta && stObj.station_meta.elevation) || obJson.elevation || 0;
  const temp = cc.air_temperature !== undefined ? cc.air_temperature : 0;
  const windGust = cc.wind_gust !== undefined ? cc.wind_gust : (cc.wind_avg || 0);
  const solar = cc.solar_radiation !== undefined ? cc.solar_radiation : 0;
  const pToday = cc.precip_accum_local_day !== undefined ? cc.precip_accum_local_day : 0;
  const pYest = cc.precip_accum_local_yesterday !== undefined ? cc.precip_accum_local_yesterday : 0;

  return {
    isDemo: false,
    units: units,
    station: {
      stationId: String(stationId),
      deviceId: deviceId,
      name: stObj.public_name || stObj.name || obJson.public_name || ('Tempest Station ' + stationId),
      badge: 'TEMPEST ' + stationId,
      elevation: m ? Math.round(elevM) : Math.round(elevM * 3.28084),
      elevationUnit: m ? 'm' : 'ft',
      latitude: stObj.latitude !== undefined ? stObj.latitude : (bfJson.latitude || 0),
      longitude: stObj.longitude !== undefined ? stObj.longitude : (bfJson.longitude || 0),
      timezone: stObj.timezone || bfJson.timezone || 'UTC',
    },
    current: {
      epoch: lastOb.timestamp || cc.time || Math.floor(Date.now() / 1000),
      temperature: temp,
      feelsLike: cc.feels_like !== undefined ? cc.feels_like : temp,
      conditions: cc.conditions || todayFc.conditions || 'Clear',
      summary: buildSummary_(bfJson, units),
      icon: cc.icon || todayFc.icon || 'partly-cloudy-day',
      todayLow: todayFc.air_temp_low !== undefined ? todayFc.air_temp_low : temp - 8,
      todayHigh: todayFc.air_temp_high !== undefined ? todayFc.air_temp_high : temp + 8,
      humidity: cc.relative_humidity !== undefined ? cc.relative_humidity : 0,
      dewPoint: cc.dew_point !== undefined ? cc.dew_point : temp,
      windSpeed: cc.wind_avg !== undefined ? cc.wind_avg : 0,
      windGust: windGust,
      windPeakToday: Math.max(windGust, windPeakToday !== null ? windPeakToday : windGust),
      windDirection: cc.wind_direction !== undefined ? cc.wind_direction : 0,
      windCardinal: cc.wind_direction_cardinal || degToCardinal_(cc.wind_direction || 0),
      pressure: cc.sea_level_pressure !== undefined ? cc.sea_level_pressure : (cc.station_pressure || (m ? 1013.2 : 29.92)),
      pressureTrend: String(cc.pressure_trend || 'steady').toLowerCase(),
      pressureChange3hr: pressureChange3hr,
      precipToday: pToday,
      precipRate: precipRate,
      precip7Day: hasPriorSix ? pToday + (m ? priorSixMm : priorSixMm / 25.4) : pToday + pYest,
      uv: cc.uv !== undefined ? cc.uv : 0,
      solarRadiation: solar,
      solarPeakToday: Math.max(solar, solarPeakToday !== null ? solarPeakToday : solar),
      lightningCount1hr: cc.lightning_strike_count_last_1hr || 0,
      lightningLastDistance: cc.lightning_strike_last_distance || null,
    },
    astronomy: {
      sunriseEpoch: todayFc.sunrise || null,
      sunsetEpoch: todayFc.sunset || null,
    },
    daily: dailyRaw.map(function (d) {
      return {
        dayStartEpoch: d.day_start_local,
        conditions: d.conditions || '',
        icon: d.icon || 'partly-cloudy-day',
        high: d.air_temp_high !== undefined ? d.air_temp_high : temp,
        low: d.air_temp_low !== undefined ? d.air_temp_low : temp,
        precipProbability: d.precip_probability !== undefined ? d.precip_probability : 0,
        sunrise: d.sunrise || null,
        sunset: d.sunset || null,
      };
    }),
    hourly: ((bfJson.forecast && bfJson.forecast.hourly) || []).map(function (h) {
      return {
        t: h.time,
        i: h.icon || 'partly-cloudy-day',
        tmp: typeof h.air_temperature === 'number' ? Number(h.air_temperature.toFixed(1)) : Number(Number(temp).toFixed(1)),
        p: Math.round(h.precip_probability || 0),
        w: typeof h.wind_avg === 'number' ? Number(h.wind_avg.toFixed(1)) : 0,
        d: Math.round(h.wind_direction || 0),
      };
    }),
  };
}
