import { getWeatherIconSvg } from './icons.js';

function expandSpokenToken(word) {
  let w = String(word || '');
  w = w.replace(/(-?\d+(?:\.\d+)?)°F\b/gi, '$1 degrees');
  w = w.replace(/(-?\d+(?:\.\d+)?)°C\b/gi, '$1 degrees Celsius');
  w = w.replace(/(-?\d+(?:\.\d+)?)°(?=[.,!?;:]|$)/g, '$1 degrees');
  w = w.replace(/\bmph\b/gi, 'miles per hour');
  w = w.replace(/\bkm\/h\b/gi, 'kilometers per hour');
  w = w.replace(/(\d+)%/g, '$1 percent');
  const cardinals = {
    N: 'north',
    NNE: 'north-northeast',
    NE: 'northeast',
    ENE: 'east-northeast',
    E: 'east',
    ESE: 'east-southeast',
    SE: 'southeast',
    SSE: 'south-southeast',
    S: 'south',
    SSW: 'south-southwest',
    SW: 'southwest',
    WSW: 'west-southwest',
    W: 'west',
    WNW: 'west-northwest',
    NW: 'northwest',
    NNW: 'north-northwest',
  };
  w = w.replace(/^([NSEW]{1,3})([.,!?;:]*)$/, (m, dir, punc) =>
    cardinals[dir] ? `${cardinals[dir]}${punc}` : m
  );
  return w;
}

function getStationHourForEpoch(epochSec, tz) {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz || undefined,
      }).format(new Date(epochSec * 1000))
    );
    return Number.isNaN(h) ? new Date(epochSec * 1000).getHours() : h % 24;
  } catch {
    return new Date(epochSec * 1000).getHours();
  }
}

function getLocalDateKey(epochSec, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: tz || undefined,
    }).format(new Date(epochSec * 1000));
  } catch {
    const d = new Date(epochSec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function skyDesc(cond, isNight = false) {
  const c = String(cond || '').toLowerCase();
  if (c.includes('thunder')) return 'thunderstorms and gusty skies';
  if (c.includes('snow') || c.includes('sleet') || c.includes('wintry')) return 'wintry showers';
  if (c.includes('rain') || c.includes('shower')) {
    return c.includes('possible') || c.includes('light') ? 'scattered light showers' : 'steady rain';
  }
  if (c.includes('fog')) return 'coastal fog and marine layer clouds';
  if (c.includes('partly')) return isNight ? 'partly cloudy skies' : 'a mix of sunshine and coastal clouds';
  if (c.includes('cloud')) return 'mostly cloudy skies';
  if (c.includes('wind')) return 'breezy skies';
  if (c.includes('clear') || c.includes('sun')) return isNight ? 'clear, starry skies' : 'bright, sunny skies';
  return c ? `${c} conditions` : 'fair skies';
}

function summarizeHourlyWindow(hours) {
  if (!hours || !hours.length) return null;
  const temps = hours.map((h) => h.tmp ?? h.air_temperature).filter((v) => typeof v === 'number');
  const pops = hours.map((h) => h.p ?? h.precip_probability ?? 0).filter((v) => typeof v === 'number');
  const winds = hours.map((h) => h.w ?? h.wind_avg).filter((v) => typeof v === 'number');
  const mid = hours[Math.floor(hours.length / 2)] || hours[0];
  return {
    avgTemp: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    maxTemp: temps.length ? Math.round(Math.max(...temps)) : null,
    minTemp: temps.length ? Math.round(Math.min(...temps)) : null,
    maxPop: pops.length ? Math.round(Math.max(...pops)) : 0,
    avgWind: winds.length ? Math.round(winds.reduce((a, b) => a + b, 0) / winds.length) : null,
    maxWind: winds.length ? Math.round(Math.max(...winds)) : null,
    icon: mid.i ?? mid.icon ?? '',
    cond: mid.c ?? mid.conditions ?? mid.i ?? mid.icon ?? '',
  };
}

function getTimeOfDayIntro(hr) {
  const prefix = "Hi, I'm Indie, your Morro Bay Alta Court weather girl. ";
  if (hr >= 5 && hr < 12) return `${prefix}Today's forecast calls for `;
  if (hr >= 12 && hr < 17) return `${prefix}This afternoon's forecast calls for `;
  if (hr >= 17 && hr < 21) return `${prefix}This evening's forecast calls for `;
  return `${prefix}Tonight's forecast calls for `;
}

export function buildIndieForecastFromDashboard(data, fallbackText = '') {
  if (!data || !data.current) {
    return formatIndieForecastScript(fallbackText, data?.station?.timezone);
  }

  const cur = data.current || {};
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const hourly = Array.isArray(data.hourly) ? data.hourly : [];
  const tz = data.station?.timezone;
  const isMetric = data.units === 'metric';
  const tu = isMetric ? '°C' : '°F';
  const wu = isMetric ? 'km/h' : 'mph';
  const today = daily[0] || null;
  const tomorrow = daily[1] || null;

  const nowSec = Math.floor(Date.now() / 1000);
  const nowHr = getStationHourForEpoch(nowSec, tz);
  const intro = getTimeOfDayIntro(nowHr);
  const todayKey = getLocalDateKey(nowSec, tz);
  const tomorrowKey = getLocalDateKey(nowSec + 86400, tz);

  // Filter only upcoming hourly buckets (30-min cushion for current hour) so morning data never leaks into afternoon/evening
  const upcomingHours = hourly.filter((h) => {
    const t = h.t ?? h.time;
    return typeof t === 'number' && t >= nowSec - 1800;
  });
  const todayHours = upcomingHours.filter((h) => {
    const t = h.t ?? h.time;
    return getLocalDateKey(t, tz) === todayKey;
  });
  const overnightHours = upcomingHours.filter((h) => {
    const t = h.t ?? h.time;
    if (t > nowSec + 14 * 3600) return false;
    const key = getLocalDateKey(t, tz);
    const hr = getStationHourForEpoch(t, tz);
    if (nowHr < 5) {
      return key === todayKey && hr < 6;
    }
    return (key === todayKey && hr >= 22) || (key === tomorrowKey && hr < 6);
  });

  const midAfternoonSlice = todayHours.filter((h) => {
    const hr = getStationHourForEpoch(h.t ?? h.time, tz);
    return hr >= Math.max(13, nowHr) && hr <= 16;
  });
  const restAfternoonSlice = todayHours.filter((h) => {
    const hr = getStationHourForEpoch(h.t ?? h.time, tz);
    return hr >= nowHr && hr <= 17;
  });
  const eveningSlice = todayHours.filter((h) => {
    const hr = getStationHourForEpoch(h.t ?? h.time, tz);
    return hr >= Math.max(17, nowHr) && hr <= 21;
  });

  const midAft = summarizeHourlyWindow(midAfternoonSlice);
  const restAft = summarizeHourlyWindow(restAfternoonSlice);
  const evening = summarizeHourlyWindow(eveningSlice);
  const overnight = summarizeHourlyWindow(overnightHours);

  // 1. Lead & Current Conditions
  const curTemp = typeof cur.temperature === 'number' ? Math.round(cur.temperature) : null;
  const curCond = cur.conditions || today?.conditions || 'Fair';
  const curSky = skyDesc(curCond, nowHr >= 18 || nowHr < 6);
  const curWind = typeof cur.windSpeed === 'number' ? Math.round(cur.windSpeed) : null;
  const curDir = cur.windCardinal || '';

  const leadParts = [];
  leadParts.push(`${curSky}.`);
  if (curTemp !== null) {
    const windBit =
      curWind !== null && curWind >= 2
        ? ` with ${curDir ? `${curDir} ` : ''}winds around ${curWind} ${wu}`
        : ' with calm winds';
    leadParts.push(`It is currently ${curTemp}${tu} and ${String(curCond).toLowerCase()}${windBit}.`);
  }

  // 2. Afternoon outlook (adapts cleanly as morning transitions to early/late afternoon)
  const todayHi = typeof today?.high === 'number' ? Math.round(today.high) : typeof cur.todayHigh === 'number' ? Math.round(cur.todayHigh) : null;
  const todayPop = typeof today?.precipProbability === 'number' ? Math.round(today.precipProbability) : 0;

  if (nowHr >= 5 && nowHr < 12) {
    const aftTemp = midAft?.maxTemp ?? todayHi;
    const aftSky = skyDesc(midAft?.cond || today?.conditions || curCond, false);
    const aftPop = Math.max(midAft?.maxPop ?? 0, todayPop);
    const aftWind = midAft?.maxWind;
    const popTxt = aftPop >= 25 ? ` and a ${aftPop}% chance of rain` : '';
    const windTxt =
      typeof aftWind === 'number' && aftWind >= 4
        ? ` with a breeze near ${aftWind} ${wu}`
        : '';
    const uvTxt = typeof cur.uv === 'number' && cur.uv >= 6 ? ' Keep sunglasses and SPF handy for high UV.' : '';
    leadParts.push(
      `You can expect ${aftSky} for mid-afternoon${aftTemp !== null ? ` with temperatures climbing near ${aftTemp}${tu}` : ''}${windTxt}${popTxt}.${uvTxt}`
    );
  } else if (nowHr >= 12 && nowHr < 14) {
    const aftTemp = midAft?.maxTemp ?? restAft?.maxTemp ?? curTemp;
    const aftSky = skyDesc(midAft?.cond || restAft?.cond || curCond, false);
    const aftPop = midAft?.maxPop ?? restAft?.maxPop ?? 0;
    const aftWind = midAft?.maxWind ?? restAft?.maxWind;
    const popTxt = aftPop >= 25 ? ` and a ${aftPop}% chance of rain` : '';
    const windTxt =
      typeof aftWind === 'number' && aftWind >= 4
        ? ` with a breeze near ${aftWind} ${wu}`
        : '';
    const uvTxt = typeof cur.uv === 'number' && cur.uv >= 6 ? ' Keep sunglasses and SPF handy for high UV.' : '';
    leadParts.push(
      `For mid-afternoon, expect ${aftSky}${aftTemp !== null ? ` with highs near ${aftTemp}${tu}` : ''}${windTxt}${popTxt}.${uvTxt}`
    );
  } else if (nowHr >= 14 && nowHr < 17) {
    const restTemp = restAft?.maxTemp ?? curTemp;
    const restSky = skyDesc(restAft?.cond || curCond, false);
    const restPop = restAft?.maxPop ?? 0;
    const restWind = restAft?.maxWind;
    const popTxt = restPop >= 25 ? ` and a ${restPop}% chance of showers` : '';
    const windTxt =
      typeof restWind === 'number' && restWind >= 4
        ? ` with winds near ${restWind} ${wu}`
        : '';
    leadParts.push(
      `Through the rest of the afternoon, expect ${restSky}${restTemp !== null ? ` holding near ${restTemp}${tu}` : ''}${windTxt}${popTxt}.`
    );
  }

  // 3. Evening (spoken before 9 PM)
  const hasEveningClause = nowHr >= 5 && nowHr < 21;
  if (hasEveningClause) {
    const eveTemp = evening?.avgTemp ?? (nowHr >= 17 ? curTemp : null);
    const eveSky = skyDesc(evening?.cond || (nowHr < 12 ? today?.conditions : null) || curCond, true);
    const evePop = evening?.maxPop ?? 0;
    const eveRain = evePop >= 25 ? ` with a ${evePop}% chance of passing showers` : '';
    const eveIntro = nowHr >= 17 ? 'Through the rest of the evening, expect' : 'Moving into the evening, expect';
    const tempClause =
      eveTemp !== null
        ? nowHr >= 17
          ? ` with temperatures settling near ${eveTemp}${tu}`
          : ` as temperatures cool toward ${eveTemp}${tu}`
        : '';
    leadParts.push(`${eveIntro} ${eveSky}${tempClause}${eveRain},`);
  }

  // 4. Overnight
  const todayLo = typeof today?.low === 'number' ? Math.round(today.low) : typeof cur.todayLow === 'number' ? Math.round(cur.todayLow) : null;
  const nextNightLo = nowHr >= 18 && tomorrow && typeof tomorrow.low === 'number' ? Math.round(tomorrow.low) : todayLo;
  const nightLo = overnight?.minTemp ?? nextNightLo;
  const nightSky = skyDesc(overnight?.cond || (nowHr < 12 ? today?.conditions : null) || curCond, true);
  const nightPop = overnight?.maxPop ?? 0;
  const nightRain = nightPop >= 30 ? ` and a ${nightPop}% chance of showers` : '';
  if (hasEveningClause) {
    leadParts.push(
      `with overnight calling for ${nightSky}${nightLo !== null ? ` and a low dipping near ${nightLo}${tu}` : ''}${nightRain}.`
    );
  } else {
    leadParts.push(
      `Overnight calls for ${nightSky}${nightLo !== null ? ` with temperatures settling near ${nightLo}${tu}` : ''}${nightRain}.`
    );
  }

  // 5. Next-day quick look (if before 5 AM, preview later today; otherwise preview tomorrow)
  if (nowHr < 5 && today && typeof today.high === 'number') {
    const daySky = skyDesc(today.conditions, false);
    const dayRain = todayPop >= 35 ? ` (${todayPop}% chance of rain)` : '';
    leadParts.push(`Later today brings ${daySky}${dayRain} with a high near ${Math.round(today.high)}${tu}.`);
  } else if (tomorrow && typeof tomorrow.high === 'number') {
    const tomSky = skyDesc(tomorrow.conditions, false);
    const tomPop = typeof tomorrow.precipProbability === 'number' ? Math.round(tomorrow.precipProbability) : 0;
    const tomRain = tomPop >= 35 ? ` (${tomPop}% chance of rain)` : '';
    leadParts.push(`Looking ahead, tomorrow brings ${tomSky}${tomRain} with a high near ${Math.round(tomorrow.high)}${tu}.`);
  }

  leadParts.push('Here are the current detailed conditions on Alta Court along with a 10-day Forecast. I hope you have a great rest of your day.');
  return `${intro}${leadParts.join(' ')}`;
}

export function formatIndieForecastScript(rawText, tz) {
  const clean = String(rawText || '').trim().replace(/\s+/g, ' ');
  const nowHr = getStationHourForEpoch(Math.floor(Date.now() / 1000), tz);
  const intro = getTimeOfDayIntro(nowHr);
  const outro = 'Here are the current detailed conditions on Alta Court along with a 10-day Forecast. I hope you have a great rest of your day.';
  if (!clean) {
    return `${intro}mild coastal weather. ${outro}`;
  }
  if (/^hi,\s*i['’]m indie/i.test(clean)) {
    return /great rest of your day/i.test(clean) ? clean : `${clean.replace(/\.?\s*$/, '.')} ${outro}`;
  }
  let body = clean
    .replace(/^Good morning!\s*Expect\s+/i, '')
    .replace(/^This afternoon brings\s+/i, '')
    .replace(/^Good evening!\s*Expect\s+/i, '')
    .replace(/^Tonight brings\s+/i, '');
  if (/^[A-Z][a-z]/.test(body)) {
    body = body.charAt(0).toLowerCase() + body.slice(1);
  }
  const withOutro = /great rest of your day/i.test(body) ? body : `${body.replace(/\.?\s*$/, '.')} ${outro}`;
  return `${intro}${withOutro}`;
}

export function buildSpeechScript(displayText) {
  const clean = formatIndieForecastScript(displayText);
  if (!clean) return { displayWords: [], spokenText: '', wordBounds: [] };
  const displayWords = clean.split(' ');
  const spokenParts = [];
  const wordBounds = [];
  let cursor = 0;
  for (let i = 0; i < displayWords.length; i++) {
    const sp = expandSpokenToken(displayWords[i]);
    const start = cursor;
    const end = cursor + sp.length;
    wordBounds.push({ wordIdx: i, start, end });
    spokenParts.push(sp);
    cursor = end + 1;
  }
  return {
    displayWords,
    spokenWords: spokenParts,
    spokenText: spokenParts.join(' '),
    wordBounds,
  };
}

const INDIE_PORTRAIT_DATA_URI = 'data:image/webp;base64,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';

const MOUTH_SCALE = 480 / 280;
const MOUTH_X0 = 198;
const MOUTH_Y0 = 212;
const MOUTH_W = 90;
const MOUTH_H = 73;

const ONES_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToSpeechWords(numStr) {
  const n = Number(numStr);
  if (!Number.isFinite(n) || n < 0 || n >= 1000) {
    return String(numStr).split('').map((d) => ONES_WORDS[Number(d)] || d).join(' ');
  }
  if (n < 20) return ONES_WORDS[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${TENS_WORDS[t]} ${ONES_WORDS[r]}` : TENS_WORDS[t];
  }
  const h = Math.floor(n / 100);
  const rem = n % 100;
  return rem ? `${ONES_WORDS[h]} hundred ${numberToSpeechWords(rem)}` : `${ONES_WORDS[h]} hundred`;
}

function wordToPhonemes(rawWord) {
  let w = String(rawWord || '').toLowerCase();
  const hasEndPause = /[.!?]$/.test(w);
  const hasCommaPause = /[,;:]$/.test(w);
  w = w.replace(/\d+/g, (n) => ` ${numberToSpeechWords(n)} `).replace(/[^a-z\s]/g, '').trim();
  const out = [];
  if (!w) {
    out.push({ open: 0.04, round: 0, ms: hasEndPause ? 440 : 220 });
    return out;
  }
  let i = 0;
  while (i < w.length) {
    const ch = w[i];
    if (ch === ' ') { i += 1; continue; }
    const pair = w.slice(i, i + 2);
    if (pair === 'oo' || pair === 'ou' || pair === 'ow' || pair === 'oh') {
      out.push({ open: 0.68, round: 0.90, ms: 132 });
      i += 2;
    } else if (pair === 'ai' || pair === 'ay' || pair === 'ae') {
      out.push({ open: 0.88, round: 0.0, ms: 132 });
      i += 2;
    } else if (pair === 'ee' || pair === 'ea' || pair === 'ie' || pair === 'ey') {
      out.push({ open: 0.54, round: 0.0, ms: 120 });
      i += 2;
    } else if (ch === 'o') {
      out.push({ open: 0.66, round: 0.86, ms: 126 });
      i += 1;
    } else if (ch === 'a') {
      out.push({ open: 0.90, round: 0.0, ms: 132 });
      i += 1;
    } else if (ch === 'u') {
      out.push({ open: 0.58, round: 0.45, ms: 120 });
      i += 1;
    } else if (ch === 'e' || ch === 'i' || ch === 'y') {
      out.push({ open: 0.50, round: 0.0, ms: 112 });
      i += 1;
    } else if (ch === 'm' || ch === 'b' || ch === 'p') {
      out.push({ open: 0.03, round: 0.04, ms: 68 });
      i += 1;
    } else if (ch === 'w') {
      out.push({ open: 0.34, round: 0.85, ms: 82 });
      i += 1;
    } else if (ch === 'f' || ch === 'v') {
      out.push({ open: 0.14, round: 0.0, ms: 68 });
      i += 1;
    } else {
      if (!out.length || out[out.length - 1].open > 0.30) {
        out.push({ open: 0.22, round: 0.08, ms: 64 });
      }
      i += 1;
    }
  }
  if (!out.length) out.push({ open: 0.38, round: 0.1, ms: 115 });
  if (hasEndPause) out.push({ open: 0.02, round: 0.0, ms: 440 });
  else if (hasCommaPause) out.push({ open: 0.04, round: 0.0, ms: 250 });
  return out;
}

const indieMouthEngine = {
  img: null,
  ready: false,
  baseData: null,
  restImgData: null,
  outImgData: null,
  loadCallbacks: [],
  warmup() {
    if (this.ready || typeof Image === 'undefined' || typeof document === 'undefined') return;
    if (!this.img) {
      this.img = new Image();
      this.img.onload = () => {
        try {
          const off = document.createElement('canvas');
          off.width = 480;
          off.height = 480;
          const octx = off.getContext('2d');
          octx.drawImage(this.img, 0, 0, 480, 480);
          this.restImgData = octx.getImageData(MOUTH_X0, MOUTH_Y0, MOUTH_W, MOUTH_H);
          this.baseData = new Uint8ClampedArray(this.restImgData.data);
          this.outImgData = octx.createImageData(MOUTH_W, MOUTH_H);
          this.ready = true;
          const cbs = this.loadCallbacks.splice(0);
          cbs.forEach((fn) => fn());
        } catch {}
      };
      this.img.src = INDIE_PORTRAIT_DATA_URI;
    }
  },
  bindCanvas(canvas, openAmt = 0, roundAmt = 0, smileAmt = 0) {
    if (!canvas) return;
    this.warmup();
    const drawBase = () => {
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx || !this.img) return;
        ctx.drawImage(this.img, 0, 0, 480, 480);
        if (openAmt > 0.004 || smileAmt > 0.004) this.render(canvas, openAmt, roundAmt, smileAmt);
      } catch {}
    };
    if (this.ready) {
      drawBase();
    } else {
      this.loadCallbacks.push(drawBase);
    }
  },
  render(canvas, openAmt, roundAmt, smileAmt = 0) {
    if (!this.ready || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (openAmt <= 0.004 && smileAmt <= 0.004) {
      ctx.putImageData(this.restImgData, MOUTH_X0, MOUTH_Y0);
      return;
    }
    const base = this.baseData;
    const out = this.outImgData.data;
    const dropMax = openAmt * 4.7;
    const liftMax = openAmt * 0.50 * (1 - roundAmt * 0.45);
    const halfW = 19.6 * (1 - roundAmt * 0.28);
    const warpHw = 22.5 * (1 - roundAmt * 0.14);
    const teethVis = Math.max(0, Math.min(1, (openAmt - 0.14) * 1.35)) * (1 - roundAmt * 0.45);
    const tongueAmtMax = Math.max(0, Math.min(1, (openAmt - 0.22) * 1.4));
    const tHw = halfW * 0.72;
    const cx = 142.2;
    const openFeather = Math.min(1, openAmt * 6.0);
    const hasOpen = openAmt > 0.004;

    for (let px = 0; px < MOUTH_W; px++) {
      const x280 = (MOUTH_X0 + px) / MOUTH_SCALE;
      let u = (x280 - cx) / warpHw;
      if (u < -1) u = -1; else if (u > 1) u = 1;
      const wx = 0.5 * (1 + Math.cos(Math.PI * u));
      const wShape = Math.pow(wx, 0.85);
      let t = (x280 - 122.0) / 40.5;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const omt = 1 - t;
      const sy = omt * omt * 133.8 + 2 * omt * t * 140.2 + t * t * 135.4;
      const liftX = liftMax * wShape;
      const dropX = dropMax * wShape;
      const upperLim = sy - liftX;
      const lowerLim = sy + dropX;
      const gap = Math.max(1e-4, lowerLim - upperLim);
      const colPuck = roundAmt * openAmt * 2.8 * Math.sin(Math.PI * u) * (1 - u * u);
      const au = Math.abs(u);
      const smLobe = smileAmt > 0.004
        ? Math.exp(-Math.pow((au - 0.72) / 0.24, 2)) * Math.max(0, 1 - Math.pow(Math.max(0, (au - 0.65) / 0.35), 2))
        : 0;
      const cornerLift = smileAmt * 2.1 * smLobe;
      const cornerPull = smileAmt * 1.15 * smLobe * (u > 0 ? -1 : 1);
      const tu = Math.max(-1, Math.min(1, (x280 - cx) / tHw));
      const tMaskX = Math.abs(tu) < 1 ? Math.max(0, 1 - Math.abs(tu * tu * tu)) : 0;
      const cosTu = Math.cos(0.5 * Math.PI * tu);
      const teethBot = upperLim + (1.1 + 1.55 * teethVis) * cosTu;
      const toothGap = 1 - 0.08 * Math.pow(Math.cos(tu * Math.PI * 5.0), 8);
      const colTongueX = Math.exp(-Math.pow((x280 - cx) / (halfW * 0.45), 2));
      const upSpan = Math.max(1e-3, upperLim - (sy - 10.0));
      const dnSpan = Math.max(1e-3, (sy + 25.0) - lowerLim);

      for (let py = 0; py < MOUTH_H; py++) {
        const y280 = (MOUTH_Y0 + py) / MOUTH_SCALE;
        let srcY = sy;
        if (y280 <= upperLim) {
          let v = (y280 - (sy - 10.0)) / upSpan;
          if (v < 0) v = 0; else if (v > 1) v = 1;
          v = v * v * (3 - 2 * v);
          srcY = y280 + liftX * v;
        } else if (y280 >= lowerLim) {
          let v = ((sy + 25.0) - y280) / dnSpan;
          if (v < 0) v = 0; else if (v > 1) v = 1;
          v = v * v * (3 - 2 * v);
          srcY = y280 - dropX * v;
        }
        const dyFromSeam = (y280 - sy) / 6.5;
        let srcX = x280 + colPuck * Math.exp(-dyFromSeam * dyFromSeam);
        if (smLobe > 0.001) {
          const dySm = (y280 - (sy - 0.3)) / 6.2;
          const smileV = Math.exp(-dySm * dySm);
          srcY += cornerLift * smileV;
          srcX += cornerPull * smileV;
        }

        let sxf = srcX * MOUTH_SCALE - MOUTH_X0;
        let syf = srcY * MOUTH_SCALE - MOUTH_Y0;
        if (sxf < 0) sxf = 0; else if (sxf > MOUTH_W - 1.001) sxf = MOUTH_W - 1.001;
        if (syf < 0) syf = 0; else if (syf > MOUTH_H - 1.001) syf = MOUTH_H - 1.001;
        const xi = sxf | 0;
        const yi = syf | 0;
        const fx = sxf - xi;
        const fy = syf - yi;
        const i00 = (yi * MOUTH_W + xi) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + MOUTH_W * 4;
        const i11 = i01 + 4;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        let r = base[i00] * w00 + base[i10] * w10 + base[i01] * w01 + base[i11] * w11;
        let g = base[i00 + 1] * w00 + base[i10 + 1] * w10 + base[i01 + 1] * w01 + base[i11 + 1] * w11;
        let b = base[i00 + 2] * w00 + base[i10 + 2] * w10 + base[i01 + 2] * w01 + base[i11 + 2] * w11;

        if (hasOpen && wx > 0.005 && y280 > upperLim - 0.8 && y280 < lowerLim + 0.8) {
          const distMin = Math.min((y280 - upperLim) * MOUTH_SCALE, (lowerLim - y280) * MOUTH_SCALE);
          let ia = distMin / 1.15;
          if (ia > 0) {
            if (ia > 1) ia = 1;
            ia *= Math.min(1, wx * 2.4) * openFeather;
            if (ia > 0.005) {
              const vCav = Math.max(0, Math.min(1, (y280 - upperLim) / gap));
              let cr = 38 + 34 * vCav;
              let cg = 11 + 14 * vCav;
              let cb = 13 + 15 * vCav;
              if (tongueAmtMax > 0.01) {
                const tv = (vCav - 0.80) / 0.28;
                const ta = tongueAmtMax * colTongueX * Math.exp(-tv * tv);
                cr = cr * (1 - ta) + 148 * ta;
                cg = cg * (1 - ta) + 64 * ta;
                cb = cb * (1 - ta) + 62 * ta;
              }
              if (teethVis > 0.01 && tMaskX > 0.01) {
                const taTop = Math.max(0, Math.min(1, (y280 - (upperLim + 0.35)) * MOUTH_SCALE * 0.9));
                const taBot = Math.max(0, Math.min(1, (teethBot - y280) * MOUTH_SCALE * 0.9));
                const ta = taTop * taBot * tMaskX * teethVis;
                if (ta > 0.005) {
                  const vSh = Math.max(0.55, Math.min(1.0, 0.65 + 0.35 * ((y280 - upperLim) / 2.2)));
                  const shadeT = (0.72 + 0.28 * cosTu) * vSh * toothGap;
                  cr = cr * (1 - ta) + 228 * shadeT * ta;
                  cg = cg * (1 - ta) + 213 * shadeT * ta;
                  cb = cb * (1 - ta) + 204 * shadeT * ta;
                }
              }
              r = r * (1 - ia) + cr * ia;
              g = g * (1 - ia) + cg * ia;
              b = b * (1 - ia) + cb * ia;
            }
          }
        }
        const outIdx = (py * MOUTH_W + px) * 4;
        out[outIdx] = r;
        out[outIdx + 1] = g;
        out[outIdx + 2] = b;
        out[outIdx + 3] = 255;
      }
    }
    ctx.putImageData(this.outImgData, MOUTH_X0, MOUTH_Y0);
  },
};

export function renderAvatarSvg({ iconCode = 'partly-cloudy-day', tempText = '--°', condText = '' } = {}) {
  const weatherIcon = getWeatherIconSvg(iconCode, 34);

  return `
    <div class="avatar-svg" role="img" aria-label="Animated beach weathercaster avatar Indie">
      <div class="av-head">
        <img class="avatar-base-img" src="${INDIE_PORTRAIT_DATA_URI}" alt="Indie weathercaster portrait" draggable="false"/>
        <canvas class="avatar-mouth-canvas" width="480" height="480"></canvas>
        <svg class="avatar-eyelids-svg" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="avEyelid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#d79b77"/>
              <stop offset="100%" stop-color="#c38361"/>
            </linearGradient>
          </defs>
          <g class="av-eyelids">
            <path d="M114.5 92 Q124 86.5 133.5 92 Q124 97 114.5 92 Z" fill="url(#avEyelid)"/>
            <path d="M114.5 92 Q124 96.5 133.5 92" stroke="#2a160e" stroke-width="1.6" stroke-linecap="round" fill="none"/>
            <path d="M153.5 92 Q163 86.5 172.5 92 Q163 97 153.5 92 Z" fill="url(#avEyelid)"/>
            <path d="M153.5 92 Q163 96.5 172.5 92" stroke="#2a160e" stroke-width="1.6" stroke-linecap="round" fill="none"/>
          </g>
        </svg>
      </div>
      <svg class="avatar-card-svg" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g transform="translate(188, 10)">
          <rect x="0" y="0" width="82" height="52" rx="9" fill="rgba(14, 18, 26, 0.68)" stroke="rgba(246, 204, 123, 0.55)" stroke-width="1.2"/>
          <g transform="translate(6, 4) scale(0.84)">${weatherIcon}</g>
          <text x="41" y="25" fill="#f8fafc" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600">${tempText}</text>
          <text x="41" y="44" text-anchor="middle" fill="#e5d7be" font-family="Inter, system-ui, sans-serif" font-size="7.8" font-weight="500">${String(condText || '').slice(0, 14)}</text>
        </g>
      </svg>
    </div>
  `;
}

export class WeatherAvatarController {
  constructor(opts) {
    this.stageEl = opts.stageEl;
    this.scriptEl = opts.scriptEl;
    this.statusPillEl = opts.statusPillEl;
    this.statusTextEl = opts.statusTextEl;
    this.btnToggleSpeak = opts.btnToggleSpeak;
    this.onAutoClose = typeof opts.onAutoClose === 'function' ? opts.onAutoClose : null;
    this.autoplayStorageKey = opts.autoplayStorageKey || 'tempest_avatar_autoplay';

    this.speaking = false;
    this.manualStop = false;
    this.scriptData = { displayWords: [], spokenWords: [], spokenText: '', wordBounds: [] };
    this.activeWordIdx = -1;
    this.autoCloseTimer = null;
    this.blinkTimer = null;
    this.rafId = null;
    this.lastRafMs = 0;
    this.curOpen = 0;
    this.curRound = 0;
    this.curSmile = 0;
    this.smileAtEnd = false;
    this.hadBoundary = false;
    this.lastBoundaryMs = 0;
    this.wordPhQueue = null;
    this.estTimeline = [];
    this.speechStartMs = 0;
    this.usingNativeTts = false;
    this.currentUtterance = null;
    this.autoPlayedOnce = false;
    this.hasPlayedOnce = false;
    this._startupWatchdog = null;
    this._gestureUnlockCleanup = null;

    indieMouthEngine.warmup();
    this._warmVoices();
    this._installGlobalNativeHooks();
    this._startBlinkLoop();
  }

  _warmVoices() {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.getVoices();
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          window.speechSynthesis.getVoices();
        });
      }
    } catch {}
  }

  _waitForFemaleVoice(timeoutMs = 700) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve(null);
        return;
      }
      const existing = this._pickBestBrowserVoice();
      if (existing && (window.speechSynthesis.getVoices() || []).length > 0) {
        resolve(existing);
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(pollId);
        clearTimeout(timerId);
        resolve(this._pickBestBrowserVoice());
      };
      const pollId = setInterval(() => {
        if ((window.speechSynthesis.getVoices() || []).length > 0) finish();
      }, 45);
      const timerId = setTimeout(finish, timeoutMs);
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
      }
    });
  }

  _readWindowPref() {
    try {
      const raw = typeof window !== 'undefined' ? window.name : '';
      if (raw && raw.startsWith('__tempest_prefs__:')) {
        const parsed = JSON.parse(raw.slice('__tempest_prefs__:'.length));
        if (parsed && typeof parsed[this.autoplayStorageKey] === 'string') {
          return parsed[this.autoplayStorageKey];
        }
      }
    } catch {}
    return null;
  }

  _writeWindowPref(val) {
    try {
      if (typeof window === 'undefined') return;
      let parsed = {};
      if (window.name && window.name.startsWith('__tempest_prefs__:')) {
        try {
          parsed = JSON.parse(window.name.slice('__tempest_prefs__:'.length)) || {};
        } catch {
          parsed = {};
        }
      }
      parsed[this.autoplayStorageKey] = val;
      window.name = '__tempest_prefs__:' + JSON.stringify(parsed);
    } catch {}
  }

  _readAutoPlayCookie() {
    if (typeof document === 'undefined') return null;
    try {
      const parts = (document.cookie || '').split(';');
      for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === this.autoplayStorageKey) {
          return decodeURIComponent(part.slice(idx + 1).trim());
        }
      }
    } catch {}
    return null;
  }

  _writeAutoPlayCookie(enabled) {
    if (typeof document === 'undefined') return;
    try {
      const val = enabled ? 'true' : 'false';
      const expires = new Date(Date.now() + 365 * 86400000).toUTCString();
      const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
      const attrs = isHttps ? '; SameSite=None; Secure' : '; SameSite=Lax';
      document.cookie = `${this.autoplayStorageKey}=${encodeURIComponent(val)}; expires=${expires}; path=/${attrs}`;
    } catch {}
  }

  isAutoPlayEnabled() {
    try {
      const val = localStorage.getItem(this.autoplayStorageKey);
      if (val !== null) return val === 'true';
    } catch {}
    try {
      const sval = sessionStorage.getItem(this.autoplayStorageKey);
      if (sval !== null) return sval === 'true';
    } catch {}
    const cookieVal = this._readAutoPlayCookie();
    if (cookieVal !== null) return cookieVal === 'true';
    const winVal = this._readWindowPref();
    if (winVal !== null) return winVal === 'true';
    return true;
  }

  setAutoPlayEnabled(enabled) {
    const val = enabled ? 'true' : 'false';
    try {
      localStorage.setItem(this.autoplayStorageKey, val);
    } catch {}
    try {
      sessionStorage.setItem(this.autoplayStorageKey, val);
    } catch {}
    this._writeAutoPlayCookie(Boolean(enabled));
    this._writeWindowPref(val);
  }

  _installGlobalNativeHooks() {
    window.__onNativeTtsStart = () => {
      if (!this.usingNativeTts) return;
      this.hasPlayedOnce = true;
      this._clearStartupWatchdog();
      this._setSpeakingState(true);
    };
    window.__onNativeTtsRange = (start) => {
      if (!this.usingNativeTts) return;
      this._handleCharBoundary(start);
    };
    window.__onNativeTtsEnd = () => {
      if (!this.usingNativeTts) return;
      this.usingNativeTts = false;
      const shouldAutoClose = !this.manualStop;
      this._setSpeakingState(false);
      if (shouldAutoClose) this._scheduleAutoClose();
    };
  }

  _scheduleAutoClose() {
    this._clearAutoClose();
    if (!this.onAutoClose) return;
    this.autoCloseTimer = setTimeout(() => {
      this.autoCloseTimer = null;
      if (!this.speaking && !this.manualStop) {
        this.onAutoClose();
      }
    }, 1800);
  }

  _clearAutoClose() {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  _startBlinkLoop() {
    const scheduleBlink = () => {
      const delay = 2800 + Math.random() * 2800;
      this.blinkTimer = setTimeout(() => {
        const svg = this.stageEl?.querySelector('.avatar-svg');
        if (svg) {
          svg.classList.add('is-blinking');
          setTimeout(() => svg.classList.remove('is-blinking'), 160);
        }
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
  }

  _getCanvas() {
    return this.stageEl?.querySelector('.avatar-mouth-canvas') || null;
  }

  _buildEstimatedTimeline() {
    const words = this.scriptData.spokenWords || [];
    const items = [];
    let tMs = 0;
    for (let i = 0; i < words.length; i++) {
      const phs = wordToPhonemes(words[i]);
      for (const p of phs) {
        items.push({ wordIdx: i, open: p.open, round: p.round, startMs: tMs, endMs: tMs + p.ms });
        tMs += p.ms;
      }
      items.push({ wordIdx: i, open: 0.08, round: 0, startMs: tMs, endMs: tMs + 60 });
      tMs += 60;
    }
    this.estTimeline = items;
  }

  updateVisual({ text, iconCode, tempText, condText }) {
    this.smileAtEnd = false;
    this.curSmile = 0;
    this.scriptData = buildSpeechScript(text);
    this._buildEstimatedTimeline();
    if (this.stageEl) {
      this.stageEl.innerHTML = renderAvatarSvg({ iconCode, tempText, condText });
      indieMouthEngine.bindCanvas(this._getCanvas(), this.curOpen, this.curRound, this.curSmile);
    }
    this._renderWords();
    this._setMouth(0, 0, 0);
  }

  _renderWords() {
    if (!this.scriptEl) return;
    if (!this.scriptData.displayWords.length) {
      this.scriptEl.textContent = 'Forecast briefing unavailable.';
      return;
    }
    this.scriptEl.innerHTML = this.scriptData.displayWords
      .map((w, i) => `<span class="av-word" data-widx="${i}">${this._escapeHtml(w)}</span>`)
      .join(' ');
    this.scriptEl.scrollTop = 0;
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _setMouth(openAmt, roundAmt, smileAmt = 0) {
    this.curOpen = openAmt;
    this.curRound = roundAmt;
    this.curSmile = smileAmt;
    indieMouthEngine.render(this._getCanvas(), openAmt, roundAmt, smileAmt);
  }

  _ensureMouthLoop() {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lastRafMs = performance.now();
    const step = (now) => {
      const dtMs = Math.min(64, Math.max(4, now - this.lastRafMs));
      const dt = dtMs / 1000;
      this.lastRafMs = now;

      let targetOpen = 0;
      let targetRound = 0;
      const targetSmile = !this.speaking && this.smileAtEnd ? 1.0 : 0.0;

      if (this.speaking) {
        const boundaryFresh = this.hadBoundary && (now - this.lastBoundaryMs) <= 950;
        if (boundaryFresh && this.wordPhQueue) {
          this.wordPhQueue.elapsed += dtMs;
          while (
            this.wordPhQueue.idx < this.wordPhQueue.items.length - 1 &&
            this.wordPhQueue.elapsed >= this.wordPhQueue.items[this.wordPhQueue.idx].ms
          ) {
            this.wordPhQueue.elapsed -= this.wordPhQueue.items[this.wordPhQueue.idx].ms;
            this.wordPhQueue.idx += 1;
          }
          const ph = this.wordPhQueue.items[this.wordPhQueue.idx];
          if (ph && this.wordPhQueue.elapsed <= ph.ms + 180) {
            targetOpen = ph.open;
            targetRound = ph.round;
          } else {
            const holdT = (now - this.lastBoundaryMs) / 1000;
            targetOpen = 0.14 + 0.22 * (0.5 + 0.5 * Math.sin(holdT * 13.0));
            targetRound = 0.10;
          }
        } else if (this.estTimeline.length) {
          const elapsed = now - this.speechStartMs;
          const totalEnd = this.estTimeline[this.estTimeline.length - 1].endMs;
          if (elapsed <= totalEnd) {
            for (let i = 0; i < this.estTimeline.length; i++) {
              const ev = this.estTimeline[i];
              if (elapsed <= ev.endMs) {
                if (!this.hadBoundary) this._highlightWord(ev.wordIdx, false);
                targetOpen = ev.open;
                targetRound = ev.round;
                break;
              }
            }
          } else {
            // Continue natural conversational articulation if TTS speaks slower than estimated timeline
            const tSec = (now - this.speechStartMs) / 1000;
            const syl = 0.5 + 0.5 * Math.sin(tSec * 14.2 + 0.65 * Math.sin(tSec * 3.7));
            const phrase = 0.5 + 0.5 * Math.cos(tSec * 1.9);
            const gate = phrase < 0.08 ? 0.14 : 1.0;
            targetOpen = (0.10 + 0.54 * syl) * gate;
            targetRound = Math.max(0, 0.50 * Math.sin(tSec * 5.2 + 0.4));
          }
        }
      }

      const openSpeed = targetOpen > this.curOpen ? 26 : 19;
      const aOpen = 1 - Math.exp(-openSpeed * dt);
      const aRound = 1 - Math.exp(-16 * dt);
      const aSmile = 1 - Math.exp(-9 * dt);
      this.curOpen += (targetOpen - this.curOpen) * aOpen;
      this.curRound += (targetRound - this.curRound) * aRound;
      this.curSmile += (targetSmile - this.curSmile) * aSmile;

      indieMouthEngine.render(this._getCanvas(), this.curOpen, this.curRound, this.curSmile);

      if (!this.speaking && this.curOpen < 0.005 && Math.abs(targetSmile - this.curSmile) < 0.008) {
        this.curOpen = 0;
        this.curRound = 0;
        this.curSmile = targetSmile;
        indieMouthEngine.render(this._getCanvas(), 0, 0, this.curSmile);
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  _scrollToActiveWord(wordEl) {
    const box = this.scriptEl;
    if (!box || !wordEl) return;
    const viewH = box.clientHeight;
    if (!viewH || box.scrollHeight <= viewH + 2) return;
    const wordTop = wordEl.offsetTop;
    const wordBottom = wordTop + wordEl.offsetHeight;
    const viewTop = box.scrollTop;
    const pad = Math.min(48, viewH * 0.25);
    if (wordBottom > viewTop + viewH - pad || wordTop < viewTop + pad * 0.4) {
      const targetScroll = Math.max(0, wordTop - viewH * 0.35);
      if (typeof box.scrollTo === 'function') {
        box.scrollTo({ top: targetScroll, behavior: 'smooth' });
      } else {
        box.scrollTop = targetScroll;
      }
    }
  }

  _highlightWord(idx, queuePhonemes = true) {
    if (!this.scriptEl || idx === this.activeWordIdx) return;
    const prev = this.scriptEl.querySelector('.av-word.is-active');
    if (prev) prev.classList.remove('is-active');
    this.activeWordIdx = idx;
    if (idx >= 0) {
      const next = this.scriptEl.querySelector(`.av-word[data-widx="${idx}"]`);
      if (next) {
        next.classList.add('is-active');
        this._scrollToActiveWord(next);
      }
      if (queuePhonemes) {
        const spokenWord = (this.scriptData.spokenWords && this.scriptData.spokenWords[idx]) || this.scriptData.displayWords[idx] || '';
        this.wordPhQueue = { items: wordToPhonemes(spokenWord), idx: 0, elapsed: 0 };
      }
    }
  }

  _handleCharBoundary(charIndex) {
    const bounds = this.scriptData.wordBounds;
    if (!bounds.length) return;
    this.hadBoundary = true;
    this.lastBoundaryMs = performance.now();
    for (let i = 0; i < bounds.length; i++) {
      if (charIndex <= bounds[i].end) {
        this._highlightWord(bounds[i].wordIdx, true);
        return;
      }
    }
  }

  _clearStartupWatchdog() {
    if (this._startupWatchdog) {
      clearTimeout(this._startupWatchdog);
      this._startupWatchdog = null;
    }
  }

  _clearGestureUnlock() {
    if (typeof this._gestureUnlockCleanup === 'function') {
      this._gestureUnlockCleanup();
      this._gestureUnlockCleanup = null;
    }
  }

  _armGestureUnlock() {
    if (this._gestureUnlockCleanup) return;
    const onFirstGesture = (e) => {
      const target = e.target;
      if (target && typeof target.closest === 'function') {
        if (target.closest('#avatar-close, #avatar-autoplay-toggle, .avatar-autoplay-label, #avatar-autoplay-btn')) {
          this._clearGestureUnlock();
          return;
        }
        if (target.closest('#avatar-toggle-speak')) {
          // Let the Play Briefing button's own click handler call speak() once
          this._clearGestureUnlock();
          return;
        }
      }
      this._clearGestureUnlock();
      if (!this.speaking && this.stageEl?.offsetParent !== null) {
        this.speak();
      }
    };
    document.addEventListener('click', onFirstGesture, true);
    document.addEventListener('keydown', onFirstGesture, true);
    this._gestureUnlockCleanup = () => {
      document.removeEventListener('click', onFirstGesture, true);
      document.removeEventListener('keydown', onFirstGesture, true);
    };
  }

  _setSpeakingState(isSpeaking, statusOverride = null) {
    this.speaking = isSpeaking;
    const svg = this.stageEl?.querySelector('.avatar-svg');
    if (svg) svg.classList.toggle('is-speaking', isSpeaking);
    if (this.statusPillEl) this.statusPillEl.classList.toggle('is-live', isSpeaking);
    if (this.statusTextEl) {
      this.statusTextEl.textContent =
        statusOverride || (isSpeaking ? 'ON AIR · INDIE LIVE' : 'READY · INDIE ON ALTA CT');
    }
    if (this.btnToggleSpeak) {
      this.btnToggleSpeak.textContent = isSpeaking
        ? 'Stop Indie'
        : this.hasPlayedOnce
          ? 'Replay Briefing'
          : 'Play Briefing';
    }

    if (isSpeaking) {
      this.smileAtEnd = true;
      this.hadBoundary = false;
      this.lastBoundaryMs = performance.now();
      this.wordPhQueue = null;
      this.speechStartMs = performance.now();
      this._ensureMouthLoop();
    } else {
      this.wordPhQueue = null;
      this._highlightWord(-1, false);
      this._ensureMouthLoop();
    }
  }

  _pickBestBrowserVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const malePattern = /\b(male|david|mark|guy|daniel|alex|fred|aaron|arthur|ryan|andrew|brian|christopher|eric|steffan|george|james|richard|rishi|oliver|thomas|albert|bruce|ralph|iol|iom|tpd)\b/i;
    const isFemaleSafe = (v) => !malePattern.test(v.name || '');
    const isEnUs = (v) => /^en[-_]US(?:$|[-_])/i.test(v.lang || '');
    const isEn = (v) => /^en(?:$|[-_])/i.test(v.lang || '');

    const usFemalePrefs = [
      /\bmicrosoft aria\b/i,
      /\bmicrosoft jenny\b/i,
      /\bmicrosoft ava\b/i,
      /\bmicrosoft emma\b/i,
      /\bgoogle us english\b/i,
      /\bsamantha\b/i,
      /\bava\b/i,
      /\ballison\b/i,
      /\bvictoria\b/i,
      /\bzira\b/i,
      /\b(female|woman)\b/i,
    ];
    const enUsVoices = voices.filter((v) => isEnUs(v) && isFemaleSafe(v));
    for (const pat of usFemalePrefs) {
      const match = enUsVoices.find((v) => pat.test(v.name || ''));
      if (match) return match;
    }
    if (enUsVoices.length) {
      return enUsVoices.find((v) => v.default) || enUsVoices[0];
    }

    const enVoices = voices.filter((v) => isEn(v) && isFemaleSafe(v));
    const otherEnPrefs = [/\bkaren\b/i, /\bserena\b/i, /\btessa\b/i, /\bmoira\b/i, /\b(female|woman)\b/i];
    for (const pat of otherEnPrefs) {
      const match = enVoices.find((v) => pat.test(v.name || ''));
      if (match) return match;
    }
    return enVoices.find((v) => v.default) || enVoices[0] || null;
  }

  speak() {
    this.stop();
    if (this.scriptEl) this.scriptEl.scrollTop = 0;
    this.manualStop = false;
    this._clearAutoClose();
    this._clearGestureUnlock();
    const spoken = this.scriptData.spokenText;
    if (!spoken) return;

    // 1. Prefer Native Android TTS Bridge when inside Sony Bravia TV APK
    if (window.AndroidTTS && typeof window.AndroidTTS.isAvailable === 'function') {
      try {
        if (window.AndroidTTS.isAvailable()) {
          this.usingNativeTts = true;
          this.hasPlayedOnce = true;
          this._setSpeakingState(true);
          const ok = window.AndroidTTS.speak(spoken, 0.90, 0.94);
          if (ok) return;
          this.usingNativeTts = false;
        }
      } catch {}
    }

    // 2. Browser Web Speech API — speak synchronously when voices are already loaded so user gestures stay intact
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      if (this.statusTextEl) {
        this.statusTextEl.textContent = 'SPEECH UNAVAILABLE ON THIS DEVICE';
      }
      this._setSpeakingState(false);
      return;
    }

    const voicesNow = window.speechSynthesis.getVoices() || [];
    if (voicesNow.length > 0) {
      this._speakWithVoice(spoken, this._pickBestBrowserVoice());
      return;
    }

    this._waitForFemaleVoice(700).then((voice) => {
      if (this.manualStop) return;
      this._speakWithVoice(spoken, voice);
    });
  }

  _speakWithVoice(spoken, voice) {
    try {
      this._clearStartupWatchdog();
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(spoken);
      utt.rate = 0.90;
      utt.pitch = 0.94;
      if (voice) {
        utt.voice = voice;
        utt.lang = voice.lang || 'en-US';
      } else {
        utt.lang = 'en-US';
      }

      let started = false;
      const handleBlockedAutoplay = () => {
        if (started || this.manualStop) return;
        this._clearStartupWatchdog();
        try {
          window.speechSynthesis.cancel();
        } catch {}
        this.currentUtterance = null;
        this._setSpeakingState(false, 'AUTO-AUDIO BLOCKED · TAP TO PLAY');
        this._armGestureUnlock();
      };

      utt.onstart = () => {
        started = true;
        this.hasPlayedOnce = true;
        this._clearStartupWatchdog();
        this._clearGestureUnlock();
        this._setSpeakingState(true);
      };
      utt.onboundary = (e) => {
        if (typeof e.charIndex === 'number') this._handleCharBoundary(e.charIndex);
      };
      utt.onend = () => {
        this._clearStartupWatchdog();
        this.currentUtterance = null;
        const shouldAutoClose = !this.manualStop;
        this._setSpeakingState(false);
        if (shouldAutoClose) this._scheduleAutoClose();
      };
      utt.onerror = (e) => {
        this._clearStartupWatchdog();
        this.currentUtterance = null;
        if (e && e.error === 'not-allowed') {
          handleBlockedAutoplay();
          return;
        }
        this._setSpeakingState(false);
      };

      this.currentUtterance = utt;
      this._setSpeakingState(true);
      window.speechSynthesis.speak(utt);

      // Watchdog catches Safari & Chrome when autoplay policy silently ignores un-gestured speak()
      this._startupWatchdog = setTimeout(() => {
        this._startupWatchdog = null;
        if (started || this.manualStop || this.currentUtterance !== utt) return;
        const synthBusy = Boolean(window.speechSynthesis?.speaking || window.speechSynthesis?.pending);
        if (!synthBusy) {
          handleBlockedAutoplay();
        } else {
          this._startupWatchdog = setTimeout(() => {
            this._startupWatchdog = null;
            if (!started && !this.manualStop && this.currentUtterance === utt) {
              handleBlockedAutoplay();
            }
          }, 1200);
        }
      }, 550);
    } catch {
      this._clearStartupWatchdog();
      this._setSpeakingState(false);
    }
  }

  stop() {
    this.manualStop = true;
    this._clearAutoClose();
    this._clearStartupWatchdog();
    this._clearGestureUnlock();
    if (this.usingNativeTts && window.AndroidTTS && typeof window.AndroidTTS.stop === 'function') {
      try {
        window.AndroidTTS.stop();
      } catch {}
    }
    this.usingNativeTts = false;

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.currentUtterance = null;
    this._setSpeakingState(false);
  }
}
