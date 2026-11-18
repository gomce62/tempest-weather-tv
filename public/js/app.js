import { getDemoDashboardData } from './demo-data.js';
import {
  renderHumidityGauge,
  renderWindCompass,
  renderBarometer,
  renderRainCylinder,
  renderUvPyramid,
  renderSolarOrb,
} from './gauges.js';
import { getWeatherIconSvg, getRaindropSvg, getSunriseSvg, getSunsetSvg } from './icons.js';
import { getMoonPhase, renderMoonSvg } from './moon.js';
import {
  fetchServerConfig,
  saveServerConfig,
  fetchTempestDashboard,
  TempestWebSocket,
  degreesToCardinal,
} from './tempest-client.js';

const STORAGE_KEYS = {
  stationId: 'tempest_station_id',
  token: 'tempest_api_token',
  units: 'tempest_units',
  mode: 'tempest_mode',
};

const state = {
  stationId: localStorage.getItem(STORAGE_KEYS.stationId) || '218212',
  token: localStorage.getItem(STORAGE_KEYS.token) || '',
  units: localStorage.getItem(STORAGE_KEYS.units) || 'imperial',
  mode: localStorage.getItem(STORAGE_KEYS.mode) || 'auto', // 'auto' | 'live' | 'demo'
  hasServerApi: false,
  hasServerToken: false,
  wsToken: '',
  data: null,
  wsStatus: 'idle', // 'idle' | 'connecting' | 'live' | 'polling'
  lastObsEpoch: Math.floor(Date.now() / 1000) - 15,
};

const els = {
  stationName: document.getElementById('station-name'),
  stationBadge: document.getElementById('station-badge'),
  stationCoords: document.getElementById('station-coords'),
  statusDot: document.getElementById('status-dot'),
  statusLabel: document.getElementById('status-label'),
  lastUpdated: document.getElementById('last-updated'),

  clockTime: document.getElementById('clock-time'),
  clockAmPm: document.getElementById('clock-ampm'),
  clockDate: document.getElementById('clock-date'),

  noticeBanner: document.getElementById('notice-banner'),
  noticeText: document.getElementById('notice-text'),
  noticeAction: document.getElementById('notice-action'),

  tempWhole: document.getElementById('temp-whole'),
  tempUnit: document.getElementById('temp-unit'),
  tempDecimal: document.getElementById('temp-decimal'),
  feelsLikeVal: document.getElementById('feels-like-val'),
  heroIcon: document.getElementById('hero-icon'),
  conditionTitle: document.getElementById('condition-title'),
  conditionSummary: document.getElementById('condition-summary'),
  todayLowVal: document.getElementById('today-low-val'),
  todayHighVal: document.getElementById('today-high-val'),
  tempRangeDot: document.getElementById('temp-range-dot'),

  humidityVal: document.getElementById('humidity-val'),
  dewpointVal: document.getElementById('dewpoint-val'),
  gaugeHumidity: document.getElementById('gauge-humidity'),

  windVal: document.getElementById('wind-val'),
  windUnit: document.getElementById('wind-unit'),
  windDirText: document.getElementById('wind-dir-text'),
  windGustVal: document.getElementById('wind-gust-val'),
  windPeakVal: document.getElementById('wind-peak-val'),
  gaugeWind: document.getElementById('gauge-wind'),

  pressureVal: document.getElementById('pressure-val'),
  pressureUnit: document.getElementById('pressure-unit'),
  pressureTrendVal: document.getElementById('pressure-trend-val'),
  pressureDeltaVal: document.getElementById('pressure-delta-val'),
  gaugePressure: document.getElementById('gauge-pressure'),

  precipVal: document.getElementById('precip-val'),
  precipUnit: document.getElementById('precip-unit'),
  precipRateVal: document.getElementById('precip-rate-val'),
  precip7dayVal: document.getElementById('precip-7day-val'),
  gaugePrecip: document.getElementById('gauge-precip'),

  uvVal: document.getElementById('uv-val'),
  uvLevel: document.getElementById('uv-level'),
  uvProtection: document.getElementById('uv-protection'),
  gaugeUv: document.getElementById('gauge-uv'),

  solarVal: document.getElementById('solar-val'),
  solarPeakVal: document.getElementById('solar-peak-val'),
  gaugeSolar: document.getElementById('gauge-solar'),

  forecastHeading: document.getElementById('forecast-heading'),
  forecastStrip: document.getElementById('forecast-strip'),

  iconSunrise: document.getElementById('icon-sunrise'),
  iconSunset: document.getElementById('icon-sunset'),
  iconMoon: document.getElementById('icon-moon'),
  sunriseVal: document.getElementById('sunrise-val'),
  sunsetVal: document.getElementById('sunset-val'),
  moonVal: document.getElementById('moon-val'),
  lightningItem: document.getElementById('lightning-item'),
  lightningVal: document.getElementById('lightning-val'),

  btnUnits: document.getElementById('btn-units'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnSettings: document.getElementById('btn-settings'),
  btnFullscreen: document.getElementById('btn-fullscreen'),

  modal: document.getElementById('settings-modal'),
  modalClose: document.getElementById('modal-close'),
  settingsForm: document.getElementById('settings-form'),
  inputStationId: document.getElementById('input-station-id'),
  inputApiToken: document.getElementById('input-api-token'),
  inputUnits: document.getElementById('input-units'),
  inputMode: document.getElementById('input-mode'),
  inputSaveServer: document.getElementById('input-save-server'),
  saveServerRow: document.getElementById('save-server-row'),
  btnUseDemo: document.getElementById('btn-use-demo'),
  modalError: document.getElementById('modal-error'),

  dayDetailModal: document.getElementById('day-detail-modal'),
  detailDayTitle: document.getElementById('detail-day-title'),
  detailDayCond: document.getElementById('detail-day-cond'),
  detailDayIcon: document.getElementById('detail-day-icon'),
  detailPopVal: document.getElementById('detail-pop-val'),
  detailLowVal: document.getElementById('detail-low-val'),
  detailHighVal: document.getElementById('detail-high-val'),
  detailSunriseVal: document.getElementById('detail-sunrise-val'),
  detailSunsetVal: document.getElementById('detail-sunset-val'),
  detailHourlyScroll: document.getElementById('detail-hourly-scroll'),
  detailHourlyStrip: document.getElementById('detail-hourly-strip'),
  detailPrev: document.getElementById('detail-prev'),
  detailNext: document.getElementById('detail-next'),
  detailClose: document.getElementById('detail-close'),
};

let activeDetailDayIdx = null;

const tempestWs = new TempestWebSocket({
  onStatus: (status) => {
    state.wsStatus = status;
    updateConnectionStatusUi();
  },
  onRapidWind: ({ epoch, windSpeedMps, windDirection }) => {
    if (!state.data || state.data.isDemo) return;
    const isMetric = state.units === 'metric';
    const speed = isMetric ? windSpeedMps * 3.6 : windSpeedMps * 2.23694;
    state.data.current.windSpeed = speed;
    state.data.current.windDirection = windDirection;
    state.data.current.windCardinal = degreesToCardinal(windDirection);
    if (speed > state.data.current.windPeakToday) {
      state.data.current.windPeakToday = speed;
    }
    state.lastObsEpoch = epoch || Math.floor(Date.now() / 1000);
    renderWindCard(state.data);
    updateRelativeTime();
  },
  onObservation: (obs) => {
    if (!state.data || state.data.isDemo) return;
    const isMetric = state.units === 'metric';
    const cur = state.data.current;

    if (typeof obs.airTempC === 'number') {
      cur.temperature = isMetric ? obs.airTempC : (obs.airTempC * 9) / 5 + 32;
    }
    if (typeof obs.humidity === 'number') {
      cur.humidity = obs.humidity;
    }
    if (typeof obs.windAvgMps === 'number') {
      cur.windSpeed = isMetric ? obs.windAvgMps * 3.6 : obs.windAvgMps * 2.23694;
    }
    if (typeof obs.windGustMps === 'number') {
      cur.windGust = isMetric ? obs.windGustMps * 3.6 : obs.windGustMps * 2.23694;
      if (cur.windGust > cur.windPeakToday) cur.windPeakToday = cur.windGust;
    }
    if (typeof obs.windDirection === 'number') {
      cur.windDirection = obs.windDirection;
      cur.windCardinal = degreesToCardinal(obs.windDirection);
    }
    if (typeof obs.uv === 'number') {
      cur.uv = obs.uv;
    }
    if (typeof obs.solarRadiation === 'number') {
      cur.solarRadiation = obs.solarRadiation;
      if (obs.solarRadiation > cur.solarPeakToday) cur.solarPeakToday = obs.solarRadiation;
    }
    if (typeof obs.rain1MinMm === 'number') {
      const rateHr = obs.rain1MinMm * 60;
      cur.precipRate = isMetric ? rateHr : rateHr / 25.4;
      if (obs.rain1MinMm > 0) {
        const addAmt = isMetric ? obs.rain1MinMm : obs.rain1MinMm / 25.4;
        cur.precipToday = (cur.precipToday || 0) + addAmt;
        cur.precip7Day = (cur.precip7Day || 0) + addAmt;
      }
    }

    state.lastObsEpoch = obs.epoch || Math.floor(Date.now() / 1000);
    renderDashboard(state.data);
  },
});

/* ---------- Formatting Helpers ---------- */

function getTempColor(tempVal, units) {
  const f = units === 'metric' ? (tempVal * 9) / 5 + 32 : tempVal;
  if (f <= 32) return '#67c8ff';
  if (f <= 50) return '#7dd3fc';
  if (f <= 78) return '#efad50';
  if (f <= 92) return '#f58840';
  return '#f25c54';
}

function getUvMeta(uv) {
  const v = Number(uv) || 0;
  if (v < 3) return { label: 'Low', cls: 'uv-low', advice: 'None needed' };
  if (v < 6) return { label: 'Moderate', cls: 'uv-moderate', advice: 'SPF 30+ & sunglasses' };
  if (v < 8) return { label: 'High', cls: 'uv-high', advice: 'Hat, shade & SPF 30+' };
  if (v < 11) return { label: 'Very High', cls: 'uv-very-high', advice: 'Extra protection needed' };
  return { label: 'Extreme', cls: 'uv-extreme', advice: 'Avoid midday sun' };
}

function formatCoords(lat, lon) {
  const latDir = lat >= 0 ? '°N' : '°S';
  const lonDir = lon >= 0 ? '°E' : '°W';
  return `${Math.abs(lat).toFixed(3)} ${latDir} ${Math.abs(lon).toFixed(3)} ${lonDir}`;
}

function formatPrecip(val, units) {
  const n = Number(val) || 0;
  if (n === 0) return '0';
  if (units === 'metric') {
    return n < 10 ? n.toFixed(1) : Math.round(n).toString();
  }
  return n < 0.01 ? '<0.01' : n.toFixed(2).replace(/\.?0+$/, '');
}

function formatTime12(epochSeconds, timezone) {
  if (!epochSeconds) return '--:--';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone || undefined,
    }).format(new Date(epochSeconds * 1000));
  } catch {
    return new Date(epochSeconds * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

function formatClock() {
  const now = new Date();
  const tz = state.data?.station?.timezone;
  let timeStr;
  let dateStr;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz || undefined,
    }).formatToParts(now);
    const hour = parts.find((p) => p.type === 'hour')?.value || '';
    const minute = parts.find((p) => p.type === 'minute')?.value || '';
    const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value || '';
    timeStr = `${hour}:${minute}`;
    els.clockAmPm.textContent = dayPeriod.toUpperCase();

    dateStr = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: tz || undefined,
    }).format(now);
  } catch {
    const hrs = now.getHours();
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    const h12 = hrs % 12 || 12;
    const mins = String(now.getMinutes()).padStart(2, '0');
    timeStr = `${h12}:${mins}`;
    els.clockAmPm.textContent = ampm;
    dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  els.clockTime.textContent = timeStr;
  els.clockDate.textContent = dateStr;
}

function updateRelativeTime() {
  if (state.data?.isDemo) {
    els.lastUpdated.textContent = '15 seconds ago';
    return;
  }
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - (state.lastObsEpoch || 0));
  if (diffSec < 5) {
    els.lastUpdated.textContent = 'Just now';
  } else if (diffSec < 60) {
    els.lastUpdated.textContent = `${diffSec} seconds ago`;
  } else if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    els.lastUpdated.textContent = `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  } else {
    const hrs = Math.floor(diffSec / 3600);
    els.lastUpdated.textContent = `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  }
}

function updateConnectionStatusUi() {
  els.statusDot.className = 'status-dot';
  if (state.data?.isDemo) {
    els.statusDot.classList.add('connected');
    els.statusLabel.textContent = 'DEMO MODE';
    return;
  }
  if (state.wsStatus === 'live') {
    els.statusDot.classList.add('connected');
    els.statusLabel.textContent = 'CONNECTED · LIVE';
  } else if (state.wsStatus === 'connecting') {
    els.statusDot.classList.add('connecting');
    els.statusLabel.textContent = 'CONNECTING';
  } else if (state.data) {
    els.statusDot.classList.add('connected');
    els.statusLabel.textContent = 'CONNECTED';
  } else {
    els.statusDot.classList.add('error');
    els.statusLabel.textContent = 'OFFLINE';
  }
}

function showNotice(message, isError = false, showAction = true) {
  if (!message) {
    els.noticeBanner.classList.add('hidden');
    return;
  }
  els.noticeText.textContent = message;
  els.noticeBanner.classList.toggle('is-error', isError);
  els.noticeAction.classList.toggle('hidden', !showAction);
  els.noticeBanner.classList.remove('hidden');
}

/* ---------- Rendering ---------- */

function renderWindCard(data) {
  const cur = data.current;
  const isMetric = data.units === 'metric';
  const windUnit = isMetric ? 'km/h' : 'mph';

  els.windVal.textContent = Number(cur.windSpeed || 0).toFixed(1);
  els.windUnit.textContent = windUnit;
  els.windDirText.innerHTML = `${cur.windCardinal || '--'} &middot; ${Math.round(cur.windDirection || 0)}°`;
  els.windGustVal.textContent = Number(cur.windGust || 0).toFixed(1);
  els.windPeakVal.textContent = Number(cur.windPeakToday || 0).toFixed(1);
  document.querySelectorAll('.wind-unit-text').forEach((el) => (el.textContent = windUnit));
  els.gaugeWind.innerHTML = renderWindCompass(cur.windDirection, cur.windSpeed);
}

function renderDashboard(data) {
  state.data = data;
  const isMetric = data.units === 'metric';
  const { station, current: cur, astronomy, daily } = data;

  // Header
  els.stationName.textContent = station.name;
  els.stationBadge.textContent = station.badge;
  els.stationCoords.textContent = `Elev ${Number(station.elevation || 0).toLocaleString()} ${station.elevationUnit}, ${formatCoords(station.latitude, station.longitude)}`;
  els.btnUnits.textContent = isMetric ? '°C' : '°F';
  updateConnectionStatusUi();
  updateRelativeTime();
  formatClock();

  // Hero Temperature (split integer & decimal matching reference)
  const tempNum = Number(cur.temperature ?? 0);
  const formattedTemp = tempNum.toFixed(1);
  const [wholePart, decPart] = formattedTemp.split('.');
  const tempColor = getTempColor(tempNum, data.units);

  els.tempWhole.textContent = wholePart;
  els.tempDecimal.textContent = `.${decPart}`;
  els.tempWhole.style.color = tempColor;
  els.tempDecimal.style.color = tempColor;
  els.tempUnit.textContent = isMetric ? '°C' : '°F';
  els.feelsLikeVal.textContent = `${Math.round(cur.feelsLike ?? tempNum)}°`;

  // Hero Condition + Narrative
  els.heroIcon.innerHTML = getWeatherIconSvg(cur.icon, 54);
  els.conditionTitle.textContent = cur.conditions || 'Clear';
  els.conditionSummary.textContent = cur.summary || '';

  // Daily Low / High Range Bar
  const low = Number(cur.todayLow ?? tempNum - 5);
  const high = Number(cur.todayHigh ?? tempNum + 5);
  els.todayLowVal.textContent = `${Math.round(low)}°`;
  els.todayHighVal.textContent = `${Math.round(high)}°`;
  const span = Math.max(1, high - low);
  const pct = Math.max(2, Math.min(98, ((tempNum - low) / span) * 100));
  els.tempRangeDot.style.left = `${pct.toFixed(1)}%`;

  // 1. Humidity
  const hum = Math.round(cur.humidity ?? 0);
  els.humidityVal.textContent = String(hum);
  els.dewpointVal.textContent = `${Number(cur.dewPoint ?? 0).toFixed(1)}°`;
  els.gaugeHumidity.innerHTML = renderHumidityGauge(hum);

  // 2. Wind
  renderWindCard(data);

  // 3. Pressure
  const pressUnit = isMetric ? 'hPa' : 'in';
  const pressVal = Number(cur.pressure ?? (isMetric ? 1013.2 : 29.92));
  els.pressureVal.textContent = isMetric ? pressVal.toFixed(1) : pressVal.toFixed(2);
  els.pressureUnit.textContent = pressUnit;

  const trend = (cur.pressureTrend || 'steady').toLowerCase();
  if (trend.includes('ris')) {
    els.pressureTrendVal.innerHTML = '&#9652; Rising';
  } else if (trend.includes('fall')) {
    els.pressureTrendVal.innerHTML = '&#9662; Falling';
  } else {
    els.pressureTrendVal.innerHTML = '&mdash; Steady';
  }

  if (typeof cur.pressureChange3hr === 'number' && !Number.isNaN(cur.pressureChange3hr)) {
    const sign = cur.pressureChange3hr > 0 ? '+' : cur.pressureChange3hr < 0 ? '−' : '';
    const absDelta = isMetric
      ? Math.abs(cur.pressureChange3hr).toFixed(1)
      : Math.abs(cur.pressureChange3hr).toFixed(2);
    els.pressureDeltaVal.innerHTML = `${sign}${absDelta} <span class="sub-unit press-unit-text">${pressUnit}</span>`;
  } else {
    els.pressureDeltaVal.innerHTML = `&mdash; <span class="sub-unit press-unit-text">${pressUnit}</span>`;
  }
  els.gaugePressure.innerHTML = renderBarometer(pressVal, data.units);

  // 4. Precipitation
  const precipUnit = isMetric ? 'mm' : 'in';
  const precipRateUnit = isMetric ? 'mm/hr' : 'in/hr';
  els.precipVal.textContent = formatPrecip(cur.precipToday, data.units);
  els.precipUnit.textContent = precipUnit;
  els.precipRateVal.textContent = formatPrecip(cur.precipRate, data.units);
  els.precip7dayVal.textContent = formatPrecip(cur.precip7Day, data.units);
  document.querySelectorAll('.precip-unit-text').forEach((el) => (el.textContent = precipUnit));
  document.querySelectorAll('.precip-rate-unit').forEach((el) => (el.textContent = precipRateUnit));
  els.gaugePrecip.innerHTML = renderRainCylinder(cur.precipToday, data.units);

  // 5. UV Index
  const uvNum = Number(cur.uv ?? 0);
  const uvMeta = getUvMeta(uvNum);
  els.uvVal.textContent = uvNum % 1 === 0 ? String(uvNum) : uvNum.toFixed(1);
  els.uvLevel.textContent = uvMeta.label;
  els.uvLevel.className = `card-inline-meta ${uvMeta.cls}`;
  els.uvProtection.textContent = uvMeta.advice;
  els.gaugeUv.innerHTML = renderUvPyramid(uvNum);

  // 6. Solar Radiation
  const solar = Number(cur.solarRadiation ?? 0);
  els.solarVal.textContent = solar > 0 && solar < 100 ? solar.toFixed(1) : String(Math.round(solar));
  els.solarPeakVal.textContent = String(Math.round(cur.solarPeakToday ?? solar));
  els.gaugeSolar.innerHTML = renderSolarOrb(solar);

  // Forecast Strip
  renderForecast(daily, station.timezone);

  // Footer Astronomy
  els.iconSunrise.innerHTML = getSunriseSvg();
  els.iconSunset.innerHTML = getSunsetSvg();
  els.sunriseVal.textContent = formatTime12(astronomy?.sunriseEpoch, station.timezone);
  els.sunsetVal.textContent = formatTime12(astronomy?.sunsetEpoch, station.timezone);

  const moon = getMoonPhase(new Date());
  els.iconMoon.innerHTML = renderMoonSvg(moon.cycle, 18);
  els.moonVal.textContent = moon.name;

  // Lightning alert (Tempest specialty!)
  if (!data.isDemo && cur.lightningCount1hr > 0) {
    const distUnit = isMetric ? 'km' : 'mi';
    const dist = cur.lightningLastDistance ? ` · ${Math.round(cur.lightningLastDistance)} ${distUnit}` : '';
    els.lightningVal.textContent = `${cur.lightningCount1hr} in last hr${dist}`;
    els.lightningItem.classList.remove('hidden');
  } else {
    els.lightningItem.classList.add('hidden');
  }
}

function renderForecast(daily = [], timezone) {
  const days = daily.slice(0, 15);
  els.forecastHeading.textContent = `${days.length}-DAY FORECAST`;
  els.forecastStrip.style.setProperty('--day-count', String(Math.max(1, days.length)));

  if (!days.length) {
    els.forecastStrip.innerHTML = '';
    return;
  }

  const allLows = days.map((d) => Number(d.low ?? 0));
  const allHighs = days.map((d) => Number(d.high ?? 0));
  const globalMin = Math.min(...allLows);
  const globalMax = Math.max(...allHighs);
  const globalSpan = Math.max(1, globalMax - globalMin);

  const dropSvg = getRaindropSvg();

  const html = days
    .map((day, idx) => {
      const dt = day.dateObj instanceof Date ? day.dateObj : new Date(day.dayStartEpoch * 1000);
      let dow;
      let dateLabel;
      try {
        dow =
          idx === 0
            ? 'TODAY'
            : new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone || undefined })
                .format(dt)
                .toUpperCase();
        dateLabel = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: timezone || undefined,
        }).format(dt);
      } catch {
        dow = idx === 0 ? 'TODAY' : dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        dateLabel = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      const leftPct = Math.max(0, Math.min(92, ((day.low - globalMin) / globalSpan) * 100));
      const widthPct = Math.max(10, Math.min(100 - leftPct, ((day.high - day.low) / globalSpan) * 100));

      return `
        <div class="forecast-day ${idx === 0 ? 'is-today' : ''}" data-day-idx="${idx}" role="button" tabindex="0" aria-label="View detailed forecast for ${dow} ${dateLabel}" title="${day.conditions || ''} — Click for hourly forecast">
          <div class="fc-dow">${dow}</div>
          <div class="fc-date">${dateLabel}</div>
          <div class="fc-icon">${getWeatherIconSvg(day.icon, 36)}</div>
          <div class="fc-temps">
            <span class="fc-high">${Math.round(day.high)}°</span>
            <span class="fc-low">${Math.round(day.low)}°</span>
          </div>
          <div class="fc-bar-track">
            <div class="fc-bar-fill" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;"></div>
          </div>
          <div class="fc-pop">${dropSvg}<span>${Math.round(day.precipProbability ?? 0)}%</span></div>
        </div>
      `;
    })
    .join('');

  els.forecastStrip.innerHTML = html;

  // Bind click & Enter/Space on each forecast card to open detailed hourly modal
  els.forecastStrip.querySelectorAll('.forecast-day').forEach((card) => {
    const idx = Number(card.getAttribute('data-day-idx'));
    card.addEventListener('click', () => openDayDetail(idx));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDayDetail(idx);
      }
    });
  });

  // If modal is already open during a live refresh, keep its contents synced
  if (activeDetailDayIdx !== null && !els.dayDetailModal.classList.contains('hidden')) {
    renderDayDetailContent(activeDetailDayIdx);
  }
}

/* ---------- Day Detail Hourly Forecast Modal ---------- */

function getLocalDateKey(epochSeconds, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone || undefined,
    }).format(new Date(epochSeconds * 1000));
  } catch {
    const d = new Date(epochSeconds * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function formatHourShort(epochSeconds, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: timezone || undefined,
    })
      .format(new Date(epochSeconds * 1000))
      .toLowerCase();
  } catch {
    const h = new Date(epochSeconds * 1000).getHours();
    return `${h % 12 || 12} ${h >= 12 ? 'pm' : 'am'}`;
  }
}

function renderWindDartSvg(deg = 0) {
  const rot = ((Number(deg) || 0) + 180) % 360;
  return `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform="rotate(${rot} 8 8)">
        <polygon points="8,1.5 13,14 8,11 3,14" fill="#f1f5f9" />
      </g>
    </svg>
  `;
}

function renderDayDetailContent(dayIdx) {
  if (!state.data || !Array.isArray(state.data.daily)) return;
  const days = state.data.daily.slice(0, 15);
  if (dayIdx < 0 || dayIdx >= days.length) return;

  activeDetailDayIdx = dayIdx;
  const day = days[dayIdx];
  const tz = state.data.station?.timezone;
  const isMetric = state.data.units === 'metric';
  const windUnit = isMetric ? 'km/h' : 'mph';

  const dt = day.dateObj instanceof Date ? day.dateObj : new Date(day.dayStartEpoch * 1000);
  let titleText;
  try {
    const wk = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz || undefined }).format(dt);
    const num = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz || undefined }).format(dt);
    titleText = `${wk} ${num}`;
  } catch {
    titleText = `${dt.toLocaleDateString('en-US', { weekday: 'short' })} ${dt.getDate()}`;
  }

  els.detailDayTitle.textContent = titleText;
  els.detailDayCond.textContent = day.conditions || 'Clear';
  els.detailDayIcon.innerHTML = getWeatherIconSvg(day.icon, 58);
  els.detailPopVal.textContent = `${Math.round(day.precipProbability ?? 0)}%`;
  els.detailLowVal.textContent = `${Math.round(day.low ?? 0)}°`;
  els.detailHighVal.textContent = `${Math.round(day.high ?? 0)}°`;

  const sr = day.sunrise || (dayIdx === 0 ? state.data.astronomy?.sunriseEpoch : null);
  const ss = day.sunset || (dayIdx === 0 ? state.data.astronomy?.sunsetEpoch : null);
  els.detailSunriseVal.textContent = sr ? formatTime12(sr, tz).toLowerCase() : '--:--';
  els.detailSunsetVal.textContent = ss ? formatTime12(ss, tz).toLowerCase() : '--:--';

  els.detailPrev.disabled = dayIdx <= 0;
  els.detailNext.disabled = dayIdx >= days.length - 1;

  // Match hourly entries belonging to this day's local calendar date
  const allHourly = Array.isArray(state.data.hourly) ? state.data.hourly : [];
  const targetKey = getLocalDateKey(day.dayStartEpoch + 43200, tz);
  let dayHours = allHourly.filter((h) => getLocalDateKey(h.t ?? h.time, tz) === targetKey);

  // Fallback range match if timezone metadata differs
  if (!dayHours.length && allHourly.length) {
    const start = day.dayStartEpoch;
    const end = start + 86400;
    dayHours = allHourly.filter((h) => {
      const ep = h.t ?? h.time;
      return ep >= start && ep < end;
    });
  }

  const whiteDropSvg = `
    <svg width="9" height="11" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <path d="M5 0.8C5 0.8 1 5.4 1 7.9C1 10.1 2.8 11.6 5 11.6C7.2 11.6 9 10.1 9 7.9C9 5.4 5 0.8 5 0.8Z" fill="#e5e7eb"/>
    </svg>
  `;

  if (!dayHours.length) {
    els.detailHourlyStrip.innerHTML = `<div class="detail-empty-hourly">Hourly forecast data is not available for this day.</div>`;
  } else {
    els.detailHourlyStrip.innerHTML = dayHours
      .map((h) => {
        const ep = h.t ?? h.time;
        const icon = h.i ?? h.icon ?? day.icon;
        const temp = h.tmp ?? h.air_temperature ?? day.high;
        const pop = h.p ?? h.precip_probability ?? 0;
        const wind = h.w ?? h.wind_avg ?? 0;
        const dir = h.d ?? h.wind_direction ?? 0;
        const cardinal = degreesToCardinal(dir);
        return `
          <div class="detail-hour-col">
            <div class="dh-time">${formatHourShort(ep, tz)}</div>
            <div class="dh-icon">${getWeatherIconSvg(icon, 38)}</div>
            <div class="dh-temp">${Math.round(temp)}°</div>
            <div class="dh-pop" title="Precipitation probability">${whiteDropSvg}<span>${Math.round(pop)}%</span></div>
            <div class="dh-wind" title="Wind ${cardinal} at ${Number(wind).toFixed(1)} ${windUnit}">
              ${renderWindDartSvg(dir)}<span>${Math.round(wind)}</span>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function openDayDetail(dayIdx) {
  renderDayDetailContent(dayIdx);
  els.dayDetailModal.classList.remove('hidden');
  if (els.detailHourlyScroll) els.detailHourlyScroll.scrollLeft = 0;
}

function closeDayDetail() {
  activeDetailDayIdx = null;
  els.dayDetailModal.classList.add('hidden');
}

/* ---------- Data Loading & Lifecycle ---------- */

async function loadDashboardData({ manual = false } = {}) {
  if (manual) els.btnRefresh.classList.add('spinning');

  const hasToken = Boolean(state.token || state.hasServerToken);
  const shouldUseDemo = state.mode === 'demo' || (state.mode === 'auto' && !hasToken);

  if (shouldUseDemo) {
    tempestWs.disconnect();
    state.wsStatus = 'idle';
    const demo = getDemoDashboardData(state.units);
    state.lastObsEpoch = demo.current.epoch;
    renderDashboard(demo);
    showNotice(
      'Showing Showcase Preview. Add your Tempest Personal Access Token to stream live data from Station 218212.',
      false,
      true
    );
    if (manual) setTimeout(() => els.btnRefresh.classList.remove('spinning'), 350);
    return;
  }

  try {
    const liveData = await fetchTempestDashboard({
      stationId: state.stationId,
      token: state.token,
      units: state.units,
      useServerToken: state.hasServerToken,
    });

    state.lastObsEpoch = liveData.current.epoch || Math.floor(Date.now() / 1000);
    renderDashboard(liveData);
    showNotice('');

    // Connect live WebSocket if we have a token and a Tempest deviceId
    const wsToken = state.token || state.wsToken;
    if (wsToken && liveData.station.deviceId && state.wsStatus !== 'live') {
      tempestWs.connect(wsToken, liveData.station.deviceId);
    }
  } catch (err) {
    console.error('Tempest load error:', err);
    showNotice(err.message || 'Unable to load live data from Tempest API.', true, true);
    if (!state.data) {
      const demo = getDemoDashboardData(state.units);
      renderDashboard(demo);
    }
  } finally {
    if (manual) setTimeout(() => els.btnRefresh.classList.remove('spinning'), 350);
  }
}

/* ---------- Settings Modal ---------- */

function openSettingsModal() {
  els.inputStationId.value = state.stationId || '218212';
  els.inputApiToken.value = state.token || '';
  els.inputApiToken.placeholder = state.hasServerToken
    ? 'Configured on server (.env) — paste to replace'
    : 'Paste your Tempest Personal Access Token';
  els.inputUnits.value = state.units;
  els.inputMode.value = state.mode === 'demo' ? 'demo' : 'live';
  els.saveServerRow.classList.toggle('hidden', !state.hasServerApi);
  els.modalError.classList.add('hidden');
  els.modal.classList.remove('hidden');
}

function closeSettingsModal() {
  els.modal.classList.add('hidden');
}

function bindEvents() {
  els.stationBadge.addEventListener('click', openSettingsModal);
  els.btnSettings.addEventListener('click', openSettingsModal);
  els.noticeAction.addEventListener('click', openSettingsModal);
  els.modalClose.addEventListener('click', closeSettingsModal);

  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeSettingsModal();
  });

  els.detailClose.addEventListener('click', closeDayDetail);
  els.detailPrev.addEventListener('click', () => {
    if (activeDetailDayIdx !== null && activeDetailDayIdx > 0) {
      openDayDetail(activeDetailDayIdx - 1);
    }
  });
  els.detailNext.addEventListener('click', () => {
    const maxIdx = Math.min(14, (state.data?.daily?.length || 1) - 1);
    if (activeDetailDayIdx !== null && activeDetailDayIdx < maxIdx) {
      openDayDetail(activeDetailDayIdx + 1);
    }
  });
  els.dayDetailModal.addEventListener('click', (e) => {
    if (e.target === els.dayDetailModal) closeDayDetail();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.dayDetailModal.classList.contains('hidden')) closeDayDetail();
      if (!els.modal.classList.contains('hidden')) closeSettingsModal();
    } else if (!els.dayDetailModal.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft' && activeDetailDayIdx > 0) openDayDetail(activeDetailDayIdx - 1);
      if (e.key === 'ArrowRight' && activeDetailDayIdx < Math.min(14, (state.data?.daily?.length || 1) - 1)) {
        openDayDetail(activeDetailDayIdx + 1);
      }
    }
  });

  els.btnUnits.addEventListener('click', () => {
    state.units = state.units === 'imperial' ? 'metric' : 'imperial';
    localStorage.setItem(STORAGE_KEYS.units, state.units);
    loadDashboardData({ manual: true });
  });

  els.btnRefresh.addEventListener('click', () => {
    loadDashboardData({ manual: true });
  });

  els.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  els.btnUseDemo.addEventListener('click', () => {
    state.mode = 'demo';
    localStorage.setItem(STORAGE_KEYS.mode, 'demo');
    closeSettingsModal();
    loadDashboardData();
  });

  els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.modalError.classList.add('hidden');

    const stationId = els.inputStationId.value.trim() || '218212';
    const enteredToken = els.inputApiToken.value.trim();
    const units = els.inputUnits.value;
    const mode = els.inputMode.value;

    if (mode === 'live' && !enteredToken && !state.hasServerToken) {
      els.modalError.textContent = 'Please enter your Tempest Personal Access Token, or choose Showcase Demo Mode.';
      els.modalError.classList.remove('hidden');
      return;
    }

    state.stationId = stationId;
    state.units = units;
    state.mode = mode;

    if (enteredToken) {
      state.token = enteredToken;
      localStorage.setItem(STORAGE_KEYS.token, enteredToken);
    }
    localStorage.setItem(STORAGE_KEYS.stationId, stationId);
    localStorage.setItem(STORAGE_KEYS.units, units);
    localStorage.setItem(STORAGE_KEYS.mode, mode);

    if (state.hasServerApi && els.inputSaveServer.checked && enteredToken) {
      try {
        const saved = await saveServerConfig({ token: enteredToken, stationId });
        state.hasServerToken = Boolean(saved?.hasServerToken);
        state.wsToken = enteredToken;
      } catch (err) {
        console.warn('Could not persist to server .env:', err);
      }
    }

    tempestWs.disconnect();
    state.wsStatus = 'idle';
    closeSettingsModal();
    await loadDashboardData({ manual: true });
  });
}

/* ---------- Boot ---------- */

async function init() {
  bindEvents();
  formatClock();

  // Check if local backend proxy is running & already has a .env token configured
  const serverCfg = await fetchServerConfig();
  if (serverCfg) {
    state.hasServerApi = true;
    state.hasServerToken = Boolean(serverCfg.hasServerToken);
    if (serverCfg.wsToken) state.wsToken = serverCfg.wsToken;
    if (serverCfg.stationId && !localStorage.getItem(STORAGE_KEYS.stationId)) {
      state.stationId = String(serverCfg.stationId);
    }
  }

  await loadDashboardData();

  // Tick clock and relative "seconds ago" smoothly every second
  setInterval(() => {
    formatClock();
    updateRelativeTime();
  }, 1000);

  // Poll Tempest REST API every 60 seconds (keeps forecast, 3-hr pressure change, peaks & 7-day rain fresh)
  setInterval(() => {
    if (!state.data?.isDemo) {
      loadDashboardData();
    }
  }, 60000);
}

init();
