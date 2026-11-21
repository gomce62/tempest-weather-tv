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
const NOAA_TIDES_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MORRO_BAY_NOAA_STATION = '9412110'; // Port San Luis / Morro Bay official NOAA station

function formatTideTime12_(timeStr) {
  // NOAA timeStr format: "YYYY-MM-DD HH:mm" in station local time (lst_ldt)
  const parts = String(timeStr || '').trim().split(/\s+/);
  if (parts.length < 2) return timeStr || '';
  const hm = parts[1].split(':');
  const h24 = parseInt(hm[0], 10);
  const min = hm[1] || '00';
  if (isNaN(h24)) return parts[1];
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return h12 + ':' + min + ' ' + ampm;
}

function fetchMorroBayTides_(units) {
  const m = units === 'metric';
  const cache = CacheService.getScriptCache();
  const now = new Date();
  const ymd = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyyMMdd');
  const cacheKey = 'tides_mb_' + ymd + '_' + (m ? 'm' : 'e');
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  try {
    const url = NOAA_TIDES_BASE +
      '?begin_date=' + ymd +
      '&end_date=' + ymd +
      '&station=' + MORRO_BAY_NOAA_STATION +
      '&product=predictions' +
      '&datum=MLLW' +
      '&time_zone=lst_ldt' +
      '&interval=hilo' +
      '&units=' + (m ? 'metric' : 'english') +
      '&application=tempest_weather_tv' +
      '&format=json';
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
      const data = JSON.parse(res.getContentText());
      if (data && Array.isArray(data.predictions) && data.predictions.length > 0) {
        const unitLabel = m ? 'm' : 'ft';
        const predictions = data.predictions.map(function (p) {
          const val = parseFloat(p.v);
          const type = String(p.type || '').toUpperCase() === 'L' ? 'L' : 'H';
          return {
            time: p.t,
            time12: formatTideTime12_(p.t),
            type: type,
            label: type === 'H' ? 'High' : 'Low',
            height: isNaN(val) ? 0 : Number(val.toFixed(1)),
            unit: unitLabel,
          };
        });
        const out = {
          stationId: MORRO_BAY_NOAA_STATION,
          stationName: 'Morro Bay',
          unit: unitLabel,
          predictions: predictions,
        };
        try { cache.put(cacheKey, JSON.stringify(out), 3600); } catch (e) {}
        return out;
      }
    }
  } catch (e) {}
  return null;
}

function cleanToken_(val) {
  return String(val || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function getSecretTokenInfo_() {
  const keys = ['TEMPEST_API_TOKEN', 'TEMPEST_TOKEN', 'WEATHERFLOW_TOKEN', 'API_TOKEN'];
  const stores = [
    { name: 'ScriptProperties', store: PropertiesService.getScriptProperties() },
    { name: 'UserProperties', store: PropertiesService.getUserProperties() },
  ];

  for (let s = 0; s < stores.length; s++) {
    const props = stores[s].store;
    for (let k = 0; k < keys.length; k++) {
      const val = cleanToken_(props.getProperty(keys[k]));
      if (val) {
        return { token: val, source: stores[s].name + '.' + keys[k] };
      }
    }
  }

  for (let s = 0; s < stores.length; s++) {
    const fileId = cleanToken_(stores[s].store.getProperty('TEMPEST_DRIVE_FILE_ID'));
    if (fileId) {
      const val = cleanToken_(DriveApp.getFileById(fileId).getBlob().getDataAsString());
      if (val) {
        return { token: val, source: stores[s].name + '.TEMPEST_DRIVE_FILE_ID' };
      }
    }
  }
  return { token: '', source: null };
}

function getSecretToken_() {
  return getSecretTokenInfo_().token;
}

function doGet(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const params = (e && e.parameter) || {};
    const stationId = String(params.stationId || props.getProperty('TEMPEST_STATION_ID') || '218212').trim();
    const units = params.units === 'metric' ? 'metric' : 'imperial';

    const tokenInfo = getSecretTokenInfo_();
    const token = tokenInfo.token;

    if (params.diag === '1') {
      const diag = {
        ok: Boolean(token),
        stationId: stationId,
        hasToken: Boolean(token),
        tokenSource: tokenInfo.source,
        tokenLength: token ? token.length : 0,
      };
      if (token) {
        try {
          const payload = fetchTempestDashboard_(stationId, token, units);
          diag.deviceId = payload.station && payload.station.deviceId;
          diag.windPeakToday = payload.current && payload.current.windPeakToday;
          diag.pressureChange3hr = payload.current && payload.current.pressureChange3hr;
          diag.precipToday = payload.current && payload.current.precipToday;
          diag.precip7Day = payload.current && payload.current.precip7Day;
          diag.solarPeakToday = payload.current && payload.current.solarPeakToday;
          diag.lightningLastEpoch = payload.current && payload.current.lightningLastEpoch;
        } catch (err) {
          diag.fetchError = err.message || String(err);
        }
      }
      return jsonResponse_(diag);
    }

    if (!token) {
      return jsonResponse_({ error: 'TEMPEST_API_TOKEN is not configured in Apps Script Properties.' });
    }

    // Cache live dashboard payload for 30 seconds to keep responses fast & rate-limit safe
    const cache = CacheService.getScriptCache();
    const cacheKey = 'dash_v2_' + stationId + '_' + units;
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

function getStationHour_(timezone) {
  try {
    var h = parseInt(Utilities.formatDate(new Date(), timezone || 'UTC', 'H'), 10);
    return isNaN(h) ? new Date().getHours() : h;
  } catch (e) {
    return new Date().getHours();
  }
}

function formatHourBucket_(epochSec, timezone) {
  try {
    var h = parseInt(Utilities.formatDate(new Date(epochSec * 1000), timezone || 'UTC', 'H'), 10);
    if (isNaN(h)) return '';
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ' ' + ampm;
  } catch (e) {
    return '';
  }
}

function skyPhrase_(cond, isNight) {
  var c = String(cond || '').toLowerCase();
  if (c.indexOf('thunder') !== -1) return 'stormy skies with thunderstorms in the area';
  if (c.indexOf('snow') !== -1 || c.indexOf('sleet') !== -1 || c.indexOf('wintry') !== -1) return 'wintry precipitation moving through';
  if (c.indexOf('rain') !== -1 || c.indexOf('shower') !== -1) {
    return c.indexOf('possible') !== -1 || c.indexOf('light') !== -1 ? 'scattered showers in the area' : 'wet weather with rain moving through';
  }
  if (c.indexOf('fog') !== -1) return 'patchy fog and low clouds';
  if (c.indexOf('partly') !== -1) return isNight ? 'partly cloudy skies' : 'a mix of sun and clouds';
  if (c.indexOf('cloud') !== -1) return 'mostly cloudy skies';
  if (c.indexOf('wind') !== -1) return 'breezy conditions';
  if (c.indexOf('clear') !== -1 || c.indexOf('sun') !== -1) return isNight ? 'clear, starlit skies' : 'bright, sunny skies';
  return c ? c + ' conditions' : 'fair skies';
}

function buildSummary_(bf, units, timezone) {
  const cc = bf.current_conditions || {};
  const today = (bf.forecast && bf.forecast.daily && bf.forecast.daily[0]) || null;
  const hourly = (bf.forecast && bf.forecast.hourly) || [];
  const tu = units === 'metric' ? '°C' : '°F';
  const wu = units === 'metric' ? 'km/h' : 'mph';
  const cond = cc.conditions || (today && today.conditions) || 'Clear';
  const parts = [/skies|likely|possible|showers|storms|rain|snow/i.test(cond) ? cond + '.' : cond + ' skies.'];

  const hr = getStationHour_(timezone);
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

function buildWeathermanBriefing_(bf, units, timezone) {
  var cc = bf.current_conditions || {};
  var daily = (bf.forecast && bf.forecast.daily) || [];
  var today = daily[0] || null;
  var tomorrow = daily[1] || null;
  var hourly = (bf.forecast && bf.forecast.hourly) || [];
  var isMetric = units === 'metric';
  var tu = isMetric ? '°C' : '°F';
  var wu = isMetric ? 'km/h' : 'mph';
  var hr = getStationHour_(timezone);
  var isNight = hr >= 18 || hr < 6;
  var cond = cc.conditions || (today && today.conditions) || 'Clear';
  var sky = skyPhrase_(cond, isNight);

  var hi = today && typeof today.air_temp_high === 'number' ? Math.round(today.air_temp_high) : null;
  var lo = today && typeof today.air_temp_low === 'number' ? Math.round(today.air_temp_low) : null;
  var hiF = hi !== null ? (isMetric ? (hi * 9) / 5 + 32 : hi) : 65;
  var comfort = hiF >= 88 ? 'hot ' : hiF >= 77 ? 'warm ' : hiF >= 64 ? 'mild ' : hiF >= 52 ? 'cool ' : 'chilly ';

  var lead = '';
  if (hr >= 5 && hr < 12) {
    lead = 'Good morning! Expect ' + sky + ' today' + (hi !== null ? ' with ' + comfort + 'highs climbing near ' + hi + tu : '') + (lo !== null ? ' before dipping to ' + lo + tu + ' tonight.' : '.');
  } else if (hr >= 12 && hr < 17) {
    lead = 'This afternoon brings ' + sky + (hi !== null ? ', with temperatures topping out near ' + hi + tu : '') + (lo !== null ? ' before cooling to around ' + lo + tu + ' tonight.' : '.');
  } else if (hr >= 17 && hr < 21) {
    lead = 'Good evening! Expect ' + sky + ' tonight' + (lo !== null ? ' as temperatures settle toward an overnight low near ' + lo + tu + '.' : '.');
  } else {
    lead = 'Tonight brings ' + sky + (lo !== null ? ' with temperatures dipping toward an overnight low near ' + lo + tu + '.' : '.');
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var upcomingHourly = [];
  for (var ui = 0; ui < hourly.length; ui++) {
    if (hourly[ui] && typeof hourly[ui].time === 'number' && hourly[ui].time >= nowSec - 1800) {
      upcomingHourly.push(hourly[ui]);
    }
  }
  var next12 = (upcomingHourly.length ? upcomingHourly : hourly).slice(0, 12);
  var peakPopH = null;
  for (var i = 0; i < next12.length; i++) {
    if (typeof next12[i].precip_probability === 'number') {
      if (!peakPopH || next12[i].precip_probability > peakPopH.precip_probability) peakPopH = next12[i];
    }
  }
  var pop = (hr >= 12 || hr < 5) && peakPopH
    ? Math.round(peakPopH.precip_probability)
    : (today && typeof today.precip_probability === 'number' ? Math.round(today.precip_probability) : 0);
  var precipPhrase = 'Dry conditions hold steady';
  if (pop >= 60) {
    var peakWhen = peakPopH && peakPopH.time && peakPopH.precip_probability >= 50 ? ' around ' + formatHourBucket_(peakPopH.time, timezone) : '';
    precipPhrase = 'Keep the umbrella handy with rain likely (' + pop + '% chance' + peakWhen + ')';
  } else if (pop >= 30) {
    precipPhrase = 'Watch for a ' + pop + '% chance of passing showers';
  }

  var nextWind = hourly.slice(0, 6).filter(function (h) { return typeof h.wind_avg === 'number'; });
  var windPhrase = '';
  if (nextWind.length >= 2) {
    var speeds = nextWind.map(function (h) { return h.wind_avg; });
    var minW = Math.max(0, Math.round(Math.min.apply(null, speeds)));
    var maxW = Math.max(minW + 2, Math.round(Math.max.apply(null, speeds)));
    var maxWMph = isMetric ? maxW / 1.60934 : maxW;
    var dir = nextWind[0].wind_direction_cardinal || cc.wind_direction_cardinal || degToCardinal_(cc.wind_direction);
    windPhrase = maxWMph >= 18
      ? ' alongside gusty ' + dir + ' winds at ' + minW + ' to ' + maxW + ' ' + wu + '.'
      : maxWMph >= 9
        ? ' with a ' + dir + ' breeze at ' + minW + ' to ' + maxW + ' ' + wu + '.'
        : ' with light ' + dir + ' winds at ' + minW + ' to ' + maxW + ' ' + wu + '.';
  } else {
    windPhrase = '.';
  }

  var extra = '';
  if ((hr >= 17 || hr < 5) && tomorrow && typeof tomorrow.air_temp_high === 'number') {
    var tomPop = typeof tomorrow.precip_probability === 'number' ? Math.round(tomorrow.precip_probability) : 0;
    var tomOutlook = tomPop >= 50 ? 'brings a ' + tomPop + '% chance of rain' : 'brings ' + skyPhrase_(tomorrow.conditions, false);
    extra = ' Tomorrow ' + tomOutlook + ' with a high near ' + Math.round(tomorrow.air_temp_high) + tu + '.';
  } else if (!isNight && typeof cc.uv === 'number' && cc.uv >= 6) {
    extra = ' Grab sunglasses and SPF with high UV today.';
  }

  return lead + ' ' + precipPhrase + windPhrase + extra;
}

function sumPriorSixDaysPrecipMm_(obsPayloads, startEpoch, endEpoch, timezone, precipYesterdayMm) {
  var days = {};
  var seenEpochs = {};
  var gotValid = false;

  for (var p = 0; p < obsPayloads.length; p++) {
    var data = obsPayloads[p];
    if (!data || !Array.isArray(data.obs)) continue;
    if (data.type !== 'obs_st' && data.type !== 'obs_sky') continue;
    gotValid = true;
    var isSky = data.type === 'obs_sky';
    var rows = data.obs;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || typeof r[0] !== 'number') continue;
      if (r[0] < startEpoch || r[0] >= endEpoch) continue;
      if (seenEpochs[r[0]]) continue;
      seenEpochs[r[0]] = true;
      var dayKey;
      try {
        dayKey = Utilities.formatDate(new Date(r[0] * 1000), timezone || 'UTC', 'yyyy-MM-dd');
      } catch (e) {
        dayKey = String(Math.floor((r[0] - startEpoch) / 86400));
      }
      if (!days[dayKey]) {
        days[dayKey] = { sumRaw: 0, maxRaw: 0, sumNc: 0, maxNc: 0, useNc: false };
      }
      var b = days[dayKey];
      var rawInt = isSky ? (typeof r[3] === 'number' ? r[3] : 0) : (typeof r[12] === 'number' ? r[12] : 0);
      var rawDay = isSky ? (typeof r[11] === 'number' ? r[11] : 0) : (typeof r[18] === 'number' ? r[18] : 0);
      var ncInt = isSky ? (typeof r[14] === 'number' ? r[14] : null) : (typeof r[19] === 'number' ? r[19] : null);
      var ncDay = isSky ? (typeof r[15] === 'number' ? r[15] : null) : (typeof r[20] === 'number' ? r[20] : null);
      var aType = isSky ? r[16] : r[21];

      b.sumRaw += rawInt;
      if (rawDay > b.maxRaw) b.maxRaw = rawDay;
      if (ncInt !== null) b.sumNc += ncInt;
      if (ncDay !== null && ncDay > b.maxNc) b.maxNc = ncDay;
      if (aType === 1 && (ncInt !== null || ncDay !== null)) b.useNc = true;
    }
  }

  if (!gotValid) return null;

  var yestKey = null;
  try {
    yestKey = Utilities.formatDate(new Date((endEpoch - 43200) * 1000), timezone || 'UTC', 'yyyy-MM-dd');
  } catch (e) {}

  var totalMm = 0;
  var keys = Object.keys(days);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var d = days[key];
    var dayMm = d.useNc ? Math.max(d.sumNc, d.maxNc) : Math.max(d.sumRaw, d.maxRaw);
    if (key === yestKey && typeof precipYesterdayMm === 'number' && precipYesterdayMm > dayMm) {
      dayMm = precipYesterdayMm;
    }
    totalMm += dayMm;
  }
  if (yestKey && !days[yestKey] && typeof precipYesterdayMm === 'number' && precipYesterdayMm > 0) {
    totalMm += precipYesterdayMm;
  }
  return totalMm;
}

function getLocalMidnightEpoch_(nowSec, timezone) {
  function getHms(ep) {
    try {
      const parts = Utilities.formatDate(new Date(ep * 1000), timezone || 'UTC', 'H:m:s').split(':');
      return { h: parseInt(parts[0], 10) % 24, m: parseInt(parts[1], 10), s: parseInt(parts[2], 10) };
    } catch (e) {
      const d = new Date(ep * 1000);
      return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
    }
  }
  const p = getHms(nowSec);
  let guess = nowSec - (p.h * 3600 + p.m * 60 + p.s);
  const chk = getHms(guess);
  if (chk.h === 23) guess += 3600;
  else if (chk.h === 1) guess -= 3600;
  return guess;
}

function resolveStationObj_(stJson, stationId) {
  const list = (stJson && (stJson.stations || stJson.locations)) || [];
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].station_id || list[i].location_id || '') === String(stationId)) return list[i];
  }
  return list[0] || {};
}

function collectCandidateDeviceIds_(obJson, devs) {
  const out = [];
  function pushId(id) {
    if (!id) return;
    for (let i = 0; i < out.length; i++) {
      if (String(out[i]) === String(id)) return;
    }
    out.push(id);
  }
  if (obJson && obJson.device_id) pushId(obJson.device_id);
  for (let i = 0; i < devs.length; i++) {
    if (devs[i].device_type === 'ST' && devs[i].serial_number) pushId(devs[i].device_id);
  }
  for (let i = 0; i < devs.length; i++) {
    if (devs[i].device_type === 'SK' && devs[i].serial_number) pushId(devs[i].device_id);
  }
  for (let i = 0; i < devs.length; i++) {
    if (devs[i].device_type === 'ST' || devs[i].device_type === 'SK') pushId(devs[i].device_id);
  }
  return out;
}

function parseTodayObs_(td, localDayStart, isMetric) {
  if (!td || (td.type !== 'obs_st' && td.type !== 'obs_sky') || !Array.isArray(td.obs) || td.obs.length === 0) {
    return null;
  }
  const isSky = td.type === 'obs_sky';
  const rows = td.obs.slice().sort(function (a, b) {
    return (Number(a && a[0]) || 0) - (Number(b && b[0]) || 0);
  });
  const gustIdx = isSky ? 6 : 3;
  const solarIdx = isSky ? 10 : 11;
  const rainIdx = isSky ? 3 : 12;

  const todayRows = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && typeof rows[i][0] === 'number' && rows[i][0] >= localDayStart) {
      todayRows.push(rows[i]);
    }
  }

  let windPeakToday = null;
  let solarPeakToday = null;
  let precipRate = 0;
  if (todayRows.length > 0) {
    let maxG = 0, maxS = 0;
    for (let i = 0; i < todayRows.length; i++) {
      if (typeof todayRows[i][gustIdx] === 'number' && todayRows[i][gustIdx] > maxG) maxG = todayRows[i][gustIdx];
      if (typeof todayRows[i][solarIdx] === 'number' && todayRows[i][solarIdx] > maxS) maxS = todayRows[i][solarIdx];
    }
    windPeakToday = isMetric ? maxG * 3.6 : maxG * 2.23694;
    solarPeakToday = maxS;

    const tail = todayRows.slice(-5);
    let rainMm = 0;
    for (let i = 0; i < tail.length; i++) {
      if (typeof tail[i][rainIdx] === 'number') rainMm += tail[i][rainIdx];
    }
    const rateMmHr = (rainMm / tail.length) * 60;
    precipRate = isMetric ? rateMmHr : rateMmHr / 25.4;
  }

  let pressureChange3hr = null;
  if (!isSky) {
    const last = rows[rows.length - 1];
    if (last && typeof last[6] === 'number') {
      const target = last[0] - 10800;
      let best = null, bestDiff = Infinity;
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i] || typeof rows[i][6] !== 'number') continue;
        const diff = Math.abs(rows[i][0] - target);
        if (diff < bestDiff) { bestDiff = diff; best = rows[i]; }
      }
      if (best && bestDiff < 5400) {
        const dMb = last[6] - best[6];
        pressureChange3hr = isMetric ? Number(dMb.toFixed(1)) : Number((dMb * 0.029529983).toFixed(2));
      }
    }
  }

  return {
    windPeakToday: windPeakToday,
    solarPeakToday: solarPeakToday,
    pressureChange3hr: pressureChange3hr,
    precipRate: precipRate,
  };
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
  let stObj = resolveStationObj_(stJson, stationId);
  if (!stObj || !Array.isArray(stObj.devices) || stObj.devices.length === 0) {
    try {
      const allSt = fetchJson_(TEMPEST_BASE + '/stations?token=' + tok);
      const found = resolveStationObj_(allSt, stationId);
      if (found && found.station_id) stObj = found;
    } catch (e) {}
  }

  const bfJson = fetchJson_(bfUrl);
  let obJson = {};
  try { obJson = fetchJson_(TEMPEST_BASE + '/observations/station/' + sid + '?token=' + tok); } catch (e) {}

  const devs = (stObj && stObj.devices) || [];
  const candidateDeviceIds = collectCandidateDeviceIds_(obJson, devs);
  let deviceId = candidateDeviceIds[0] || null;
  const stationTz = stObj.timezone || bfJson.timezone || 'UTC';

  const cc = bfJson.current_conditions || {};
  const lastOb = (obJson.obs && obJson.obs[0]) || {};
  const dailyRaw = (bfJson.forecast && bfJson.forecast.daily) || [];
  const todayFc = dailyRaw[0] || {};

  const pToday = cc.precip_accum_local_day !== undefined
    ? cc.precip_accum_local_day
    : (typeof lastOb.precip_accum_local_day_final === 'number'
      ? (m ? lastOb.precip_accum_local_day_final : lastOb.precip_accum_local_day_final / 25.4)
      : (typeof lastOb.precip_accum_local_day === 'number'
        ? (m ? lastOb.precip_accum_local_day : lastOb.precip_accum_local_day / 25.4)
        : 0));
  const pYest = cc.precip_accum_local_yesterday !== undefined
    ? cc.precip_accum_local_yesterday
    : (typeof lastOb.precip_accum_local_yesterday_final === 'number'
      ? (m ? lastOb.precip_accum_local_yesterday_final : lastOb.precip_accum_local_yesterday_final / 25.4)
      : (typeof lastOb.precip_accum_local_yesterday === 'number'
        ? (m ? lastOb.precip_accum_local_yesterday : lastOb.precip_accum_local_yesterday / 25.4)
        : 0));
  const pYestMm = typeof lastOb.precip_accum_local_yesterday_final === 'number'
    ? lastOb.precip_accum_local_yesterday_final
    : (typeof lastOb.precip_accum_local_yesterday === 'number'
      ? lastOb.precip_accum_local_yesterday
      : (m ? pYest : pYest * 25.4));

  let windPeakToday = null;
  let solarPeakToday = null;
  let pressureChange3hr = null;
  let precipRate = 0;
  let priorSixMm = 0;
  let hasPriorSix = false;

  if (candidateDeviceIds.length > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const localDayStart = getLocalMidnightEpoch_(nowSec, stationTz);
    const todayFetchStart = Math.min(localDayStart, nowSec - 14400);

    // Fetch today's observations (plus 4h lookback for 3-hr pressure delta) across candidate devices
    for (let cIdx = 0; cIdx < candidateDeviceIds.length; cIdx++) {
      const candId = candidateDeviceIds[cIdx];
      let parsed = null;
      try {
        const td = fetchJson_(TEMPEST_BASE + '/observations/device/' + candId + '?time_start=' + todayFetchStart + '&time_end=' + nowSec + '&token=' + tok);
        parsed = parseTodayObs_(td, localDayStart, m);
      } catch (e) {}
      if (!parsed) {
        try {
          const td0 = fetchJson_(TEMPEST_BASE + '/observations/device/' + candId + '?day_offset=0&token=' + tok);
          parsed = parseTodayObs_(td0, localDayStart, m);
        } catch (e) {}
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

    // Fetch prior 6 local calendar days in 2 parallel 3-day chunks (<=5 days ensures 1-min resolution + RainCheck fields)
    if (deviceId) {
      const cache = CacheService.getScriptCache();
      const pKey = 'rain6d_v3_' + deviceId + '_' + localDayStart;
      const pCached = cache.get(pKey);
      if (pCached !== null) {
        priorSixMm = Number(pCached) || 0;
        hasPriorSix = true;
      } else {
        try {
          const start6d = localDayStart - 6 * 86400;
          const mid3d = localDayStart - 3 * 86400;
          const reqs = [
            { url: TEMPEST_BASE + '/observations/device/' + deviceId + '?time_start=' + start6d + '&time_end=' + (mid3d - 1) + '&token=' + tok, muteHttpExceptions: true },
            { url: TEMPEST_BASE + '/observations/device/' + deviceId + '?time_start=' + mid3d + '&time_end=' + (localDayStart - 1) + '&token=' + tok, muteHttpExceptions: true },
          ];
          const responses = UrlFetchApp.fetchAll(reqs);
          const payloads = [];
          for (let rIdx = 0; rIdx < responses.length; rIdx++) {
            if (responses[rIdx].getResponseCode() >= 200 && responses[rIdx].getResponseCode() < 300) {
              try { payloads.push(JSON.parse(responses[rIdx].getContentText())); } catch (e) {}
            }
          }
          let isComplete = payloads.length === 2;
          if (payloads.length === 0) {
            const fbReqs = [];
            for (let dOff = 1; dOff <= 6; dOff++) {
              fbReqs.push({ url: TEMPEST_BASE + '/observations/device/' + deviceId + '?day_offset=' + dOff + '&token=' + tok, muteHttpExceptions: true });
            }
            const fbRes = UrlFetchApp.fetchAll(fbReqs);
            for (let rIdx = 0; rIdx < fbRes.length; rIdx++) {
              if (fbRes[rIdx].getResponseCode() >= 200 && fbRes[rIdx].getResponseCode() < 300) {
                try { payloads.push(JSON.parse(fbRes[rIdx].getContentText())); } catch (e) {}
              }
            }
            isComplete = payloads.length >= 5;
          }
          const sumMm = sumPriorSixDaysPrecipMm_(payloads, start6d, localDayStart, stationTz, pYestMm);
          if (sumMm !== null) {
            priorSixMm = sumMm;
            hasPriorSix = true;
            if (isComplete) {
              try { cache.put(pKey, String(sumMm), 1800); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
  }

  const elevM = (stObj.station_meta && stObj.station_meta.elevation) || obJson.elevation || 0;
  const temp = cc.air_temperature !== undefined ? cc.air_temperature : 0;
  const windGust = cc.wind_gust !== undefined ? cc.wind_gust : (cc.wind_avg || 0);
  const solar = cc.solar_radiation !== undefined ? cc.solar_radiation : 0;
  const lightningCount1hr = cc.lightning_strike_count_last_1hr !== undefined
    ? cc.lightning_strike_count_last_1hr
    : (lastOb.lightning_strike_count_last_1hr || 0);
  const lightningLastEpoch = cc.lightning_strike_last_epoch !== undefined
    ? cc.lightning_strike_last_epoch
    : (lastOb.lightning_strike_last_epoch !== undefined ? lastOb.lightning_strike_last_epoch : null);
  const lightningLastDistance = cc.lightning_strike_last_distance !== undefined
    ? cc.lightning_strike_last_distance
    : (typeof lastOb.lightning_strike_last_distance === 'number'
      ? (m ? lastOb.lightning_strike_last_distance : lastOb.lightning_strike_last_distance * 0.621371)
      : null);

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
      timezone: stationTz,
    },
    current: {
      epoch: lastOb.timestamp || cc.time || Math.floor(Date.now() / 1000),
      temperature: temp,
      feelsLike: cc.feels_like !== undefined ? cc.feels_like : temp,
      conditions: cc.conditions || todayFc.conditions || 'Clear',
      summary: buildSummary_(bfJson, units, stationTz),
      forecastBriefing: buildWeathermanBriefing_(bfJson, units, stationTz),
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
      lightningCount1hr: lightningCount1hr,
      lightningLastDistance: lightningLastDistance,
      lightningLastEpoch: lightningLastEpoch,
    },
    astronomy: {
      sunriseEpoch: todayFc.sunrise || null,
      sunsetEpoch: todayFc.sunset || null,
    },
    tides: fetchMorroBayTides_(units),
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
