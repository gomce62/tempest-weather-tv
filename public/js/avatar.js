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

export function buildIndieForecastFromDashboard(data, fallbackText = '') {
  const intro = "Hi, I'm Indie, your Morro Bay Alta Court weather girl. Today's forecast calls for ";
  if (!data || !data.current) {
    return formatIndieForecastScript(fallbackText);
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
  const todayKey = getLocalDateKey(nowSec, tz);
  const tomorrowKey = getLocalDateKey(nowSec + 86400, tz);

  // Filter today's and tonight's hourly buckets
  const todayHours = hourly.filter((h) => {
    const t = h.t ?? h.time;
    return typeof t === 'number' && getLocalDateKey(t, tz) === todayKey;
  });
  const overnightHours = hourly.filter((h) => {
    const t = h.t ?? h.time;
    if (typeof t !== 'number') return false;
    const key = getLocalDateKey(t, tz);
    const hr = getStationHourForEpoch(t, tz);
    return (key === todayKey && hr >= 22) || (key === tomorrowKey && hr < 6);
  });

  const midAfternoonSlice = todayHours.filter((h) => {
    const hr = getStationHourForEpoch(h.t ?? h.time, tz);
    return hr >= 13 && hr <= 16;
  });
  const eveningSlice = todayHours.filter((h) => {
    const hr = getStationHourForEpoch(h.t ?? h.time, tz);
    return hr >= 17 && hr <= 21;
  });

  const midAft = summarizeHourlyWindow(midAfternoonSlice);
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

  // 2. Mid-Afternoon
  const todayHi = typeof today?.high === 'number' ? Math.round(today.high) : typeof cur.todayHigh === 'number' ? Math.round(cur.todayHigh) : null;
  const todayPop = typeof today?.precipProbability === 'number' ? Math.round(today.precipProbability) : 0;

  if (nowHr < 16) {
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
  }

  // 3. Evening
  if (nowHr < 21) {
    const eveTemp = evening?.avgTemp;
    const eveSky = skyDesc(evening?.cond || today?.conditions || curCond, true);
    const evePop = evening?.maxPop ?? 0;
    const eveRain = evePop >= 25 ? ` with a ${evePop}% chance of passing showers` : '';
    leadParts.push(
      `Moving into the evening, expect ${eveSky}${eveTemp !== null ? ` as temperatures cool toward ${eveTemp}${tu}` : ''}${eveRain},`
    );
  }

  // 4. Overnight
  const todayLo = typeof today?.low === 'number' ? Math.round(today.low) : typeof cur.todayLow === 'number' ? Math.round(cur.todayLow) : null;
  const nightLo = overnight?.minTemp ?? todayLo;
  const nightSky = skyDesc(overnight?.cond || today?.conditions || curCond, true);
  const nightPop = overnight?.maxPop ?? 0;
  const nightRain = nightPop >= 30 ? ` and a ${nightPop}% chance of showers` : '';
  if (nowHr < 21) {
    leadParts.push(
      `with overnight calling for ${nightSky}${nightLo !== null ? ` and a low dipping near ${nightLo}${tu}` : ''}${nightRain}.`
    );
  } else {
    leadParts.push(
      `Overnight calls for ${nightSky}${nightLo !== null ? ` with temperatures settling near ${nightLo}${tu}` : ''}${nightRain}.`
    );
  }

  // 5. Tomorrow quick look
  if (tomorrow && typeof tomorrow.high === 'number') {
    const tomSky = skyDesc(tomorrow.conditions, false);
    const tomPop = typeof tomorrow.precipProbability === 'number' ? Math.round(tomorrow.precipProbability) : 0;
    const tomRain = tomPop >= 35 ? ` (${tomPop}% chance of rain)` : '';
    leadParts.push(`Looking ahead, tomorrow brings ${tomSky}${tomRain} with a high near ${Math.round(tomorrow.high)}${tu}.`);
  }

  return `${intro}${leadParts.join(' ')}`;
}

export function formatIndieForecastScript(rawText) {
  const clean = String(rawText || '').trim().replace(/\s+/g, ' ');
  const intro = "Hi, I'm Indie, your Morro Bay Alta Court weather girl. Today's forecast calls for ";
  if (!clean) {
    return `${intro}mild coastal weather.`;
  }
  if (/^hi,\s*i['’]m indie/i.test(clean)) {
    return clean;
  }
  let body = clean
    .replace(/^Good morning!\s*Expect\s+/i, '')
    .replace(/^This afternoon brings\s+/i, '')
    .replace(/^Good evening!\s*Expect\s+/i, '')
    .replace(/^Tonight brings\s+/i, '');
  if (/^[A-Z][a-z]/.test(body)) {
    body = body.charAt(0).toLowerCase() + body.slice(1);
  }
  return `${intro}${body}`;
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
    spokenText: spokenParts.join(' '),
    wordBounds,
  };
}

function getSkyPalette(iconCode) {
  const c = String(iconCode || '').toLowerCase();
  if (c.includes('thunder')) {
    return { top: '#24293d', mid: '#484863', bot: '#9e6e58', sun: '#fbbf24', sea: '#28364d', mode: 'storm' };
  }
  if (c.includes('rain') || c.includes('sleet') || c.includes('snow')) {
    return { top: '#283e52', mid: '#4e6b80', bot: '#99887a', sun: '#7dd3fc', sea: '#2d495e', mode: 'rain' };
  }
  if (c.includes('night')) {
    return { top: '#0e172e', mid: '#1f3359', bot: '#3c4c70', sun: '#bae6fd', sea: '#142642', mode: 'night' };
  }
  if (c.includes('cloudy') && !c.includes('partly')) {
    return { top: '#3c536b', mid: '#6e8399', bot: '#d49d79', sun: '#fde68a', sea: '#3a556e', mode: 'cloudy' };
  }
  // Golden-hour coastal sunset matching Indie's beach reference photo
  return { top: '#5a7090', mid: '#d18e5a', bot: '#f7c87e', sun: '#fff3c4', sea: '#576f82', mode: 'sunset' };
}

export function renderAvatarSvg({ iconCode = 'partly-cloudy-day', tempText = '--°', condText = '' } = {}) {
  const sky = getSkyPalette(iconCode);
  const weatherIcon = getWeatherIconSvg(iconCode, 34);

  let skyFx = '';
  if (sky.mode === 'night') {
    skyFx = `
      <circle cx="38" cy="34" r="1.4" fill="#e2e8f0" opacity="0.85"/>
      <circle cx="72" cy="22" r="1.1" fill="#e2e8f0" opacity="0.7"/>
      <circle cx="114" cy="38" r="1.3" fill="#bae6fd" opacity="0.8"/>
      <path d="M52 52 A14 14 0 1 0 66 66 A11 11 0 1 1 52 52 Z" fill="#bae6fd" opacity="0.65"/>
    `;
  } else if (sky.mode === 'rain' || sky.mode === 'storm') {
    skyFx = `
      <g stroke="#bae6fd" stroke-width="1.5" stroke-linecap="round" opacity="0.35">
        <line x1="34" y1="26" x2="26" y2="48"/>
        <line x1="68" y1="18" x2="60" y2="40"/>
        <line x1="94" y1="44" x2="86" y2="66"/>
        <line x1="234" y1="92" x2="226" y2="114"/>
      </g>
    `;
  } else {
    skyFx = `
      <circle cx="64" cy="110" r="46" fill="#ffd990" opacity="0.32"/>
      <circle cx="64" cy="110" r="24" fill="${sky.sun}" opacity="0.72"/>
      <ellipse cx="64" cy="164" rx="22" ry="4" fill="#ffe5a3" opacity="0.55"/>
    `;
  }

  return `
    <svg class="avatar-svg" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated beach weathercaster avatar Indie">
      <defs>
        <linearGradient id="avBeachSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${sky.top}"/>
          <stop offset="52%" stop-color="${sky.mid}"/>
          <stop offset="100%" stop-color="${sky.bot}"/>
        </linearGradient>
        <linearGradient id="avOcean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${sky.sea}"/>
          <stop offset="100%" stop-color="#2c4152"/>
        </linearGradient>
        <linearGradient id="avSand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#c99c72"/>
          <stop offset="100%" stop-color="#8a6445"/>
        </linearGradient>
        <linearGradient id="avHairBack" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stop-color="#d89e4e"/>
          <stop offset="48%" stop-color="#a86d2a"/>
          <stop offset="100%" stop-color="#704316"/>
        </linearGradient>
        <linearGradient id="avHairFront" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stop-color="#f6cc7b"/>
          <stop offset="45%" stop-color="#d59444"/>
          <stop offset="100%" stop-color="#965d22"/>
        </linearGradient>
        <linearGradient id="avSkinTan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f2ba96"/>
          <stop offset="58%" stop-color="#e19e76"/>
          <stop offset="100%" stop-color="#cf865e"/>
        </linearGradient>
        <linearGradient id="avNeckShadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#a6603b" stop-opacity="0.52"/>
          <stop offset="58%" stop-color="#de9b73" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="avBikiniWhite" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#e7ecf2"/>
        </linearGradient>
      </defs>

      <!-- Golden-Hour Beach Backdrop -->
      <rect width="280" height="162" fill="url(#avBeachSky)"/>
      ${skyFx}
      <rect x="0" y="158" width="280" height="58" fill="url(#avOcean)"/>
      <!-- Soft ocean wave foam -->
      <path d="M0 184 Q45 178 90 184 T180 182 T280 185" stroke="#f8fafc" stroke-width="2" fill="none" opacity="0.45"/>
      <path d="M0 202 Q65 196 130 203 T280 200" stroke="#fde68a" stroke-width="1.6" fill="none" opacity="0.3"/>
      <!-- Warm coastal beach sand -->
      <path d="M0 212 Q120 202 280 218 L280 280 L0 280 Z" fill="url(#avSand)"/>

      <!-- Over-the-Shoulder Live Weather Card -->
      <g transform="translate(184, 14)">
        <rect x="0" y="0" width="84" height="68" rx="10" fill="rgba(14, 18, 26, 0.68)" stroke="rgba(246, 204, 123, 0.55)" stroke-width="1.2"/>
        <g transform="translate(8, 7)">${weatherIcon}</g>
        <text x="47" y="30" fill="#f8fafc" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="600">${tempText}</text>
        <text x="42" y="56" text-anchor="middle" fill="#e5d7be" font-family="Inter, system-ui, sans-serif" font-size="8.5" font-weight="500">${String(condText || '').slice(0, 14)}</text>
      </g>

      <!-- Flowing Tousled Golden-Blonde Beach Hair (Back) -->
      <path d="M76 96 C58 134, 46 184, 54 236 C68 248, 92 246, 108 232 L176 232 C192 246, 218 244, 232 228 C236 182, 222 130, 206 96 C195 58, 170 40, 140 40 C108 40, 86 58, 76 96 Z" fill="url(#avHairBack)"/>

      <!-- Sun-kissed Shoulders, Arms, Neck & White-and-Gold Beach Halter -->
      <g class="av-torso">
        <!-- Relaxed bare shoulders & arms -->
        <path d="M58 280 C62 244, 72 214, 98 202 C112 195, 168 195, 182 202 C208 214, 218 244, 222 280 Z" fill="url(#avSkinTan)"/>
        <!-- Subtle shoulder highlight from sunset light -->
        <ellipse cx="86" cy="218" rx="14" ry="7" fill="#ffd9b8" opacity="0.32" transform="rotate(-18 86 218)"/>
        <ellipse cx="194" cy="218" rx="14" ry="7" fill="#ffd9b8" opacity="0.28" transform="rotate(18 194 218)"/>
        <!-- Neck -->
        <path d="M123 158 L123 200 Q140 212 157 200 L157 158 Z" fill="url(#avSkinTan)"/>
        <path d="M123 158 L123 189 Q140 195 157 189 L157 158 Z" fill="url(#avNeckShadow)"/>
        <!-- Collarbone contours -->
        <path d="M107 205 Q124 214 136 210 M173 205 Q156 214 144 210" stroke="#b9724e" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.5"/>
        <!-- Soft cleavage / chest contour -->
        <path d="M128 240 Q140 256 152 240" stroke="#b86e48" stroke-width="1.2" fill="none" opacity="0.45"/>

        <!-- White Bikini Halter Top with Metallic Gold Trim (from photo) -->
        <!-- Halter straps going around neck -->
        <path d="M124 198 L106 244 M156 198 L174 244" stroke="#d4a656" stroke-width="3.2" stroke-linecap="round"/>
        <!-- Left cup -->
        <path d="M96 276 C96 250, 108 232, 122 232 C133 232, 139 248, 139 272 C125 278, 108 279, 96 276 Z" fill="url(#avBikiniWhite)" stroke="#cfa04f" stroke-width="2.2"/>
        <!-- Right cup -->
        <path d="M184 276 C184 250, 172 232, 158 232 C147 232, 141 248, 141 272 C155 278, 172 279, 184 276 Z" fill="url(#avBikiniWhite)" stroke="#cfa04f" stroke-width="2.2"/>
        <!-- Center gold tie knot -->
        <circle cx="140" cy="271" r="3" fill="#e0b463" stroke="#9e742b" stroke-width="0.8"/>
        <path d="M138 273 Q133 279 136 280 M142 273 Q147 279 144 280" stroke="#d4a656" stroke-width="1.4" fill="none"/>
      </g>

      <!-- Head & Facial Animation Group -->
      <g class="av-head">
        <ellipse cx="94" cy="126" rx="6.5" ry="11" fill="#df9e77"/>
        <ellipse cx="186" cy="126" rx="6.5" ry="11" fill="#df9e77"/>

        <!-- Face Contour -->
        <path d="M96 105 C95 142, 111 174, 140 177 C169 174, 185 142, 184 105 C184 73, 166 56, 140 56 C114 56, 96 73, 96 105 Z" fill="url(#avSkinTan)"/>

        <!-- Sun-kissed Cheek Warmth & Smile Lines -->
        <ellipse cx="111" cy="135" rx="12" ry="6.5" fill="#df725c" opacity="0.24"/>
        <ellipse cx="169" cy="135" rx="12" ry="6.5" fill="#df725c" opacity="0.24"/>
        <path d="M115 141 Q112 148 117 154" stroke="#b97552" stroke-width="1" fill="none" opacity="0.35"/>
        <path d="M165 141 Q168 148 163 154" stroke="#b97552" stroke-width="1" fill="none" opacity="0.35"/>

        <!-- Nose -->
        <path d="M139 112 L136.5 129 Q140 134 144.5 130" stroke="#b9744f" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M136 131 Q140 134 144 131" stroke="#ad6541" stroke-width="1" fill="none" opacity="0.55"/>

        <!-- Eyebrows -->
        <g class="av-brows">
          <path d="M107 103 Q119 97 131 102" stroke="#805124" stroke-width="2.6" stroke-linecap="round" fill="none"/>
          <path d="M149 102 Q161 97 173 103" stroke="#805124" stroke-width="2.6" stroke-linecap="round" fill="none"/>
        </g>

        <!-- Bright Blue Eyes -->
        <g class="av-eyes">
          <path d="M108 115 Q120 107 131 115 Q120 122 108 115 Z" fill="#ffffff"/>
          <circle cx="119.5" cy="114.8" r="5.2" fill="#2a6cb3"/>
          <circle cx="119.5" cy="114.8" r="3.4" fill="#4f9be8"/>
          <circle cx="119.5" cy="114.8" r="2.2" fill="#0f172a"/>
          <circle cx="121.2" cy="113.1" r="1.3" fill="#ffffff"/>
          <path d="M107.5 115 Q120 106.5 131.5 115" stroke="#362214" stroke-width="2.1" stroke-linecap="round" fill="none"/>

          <path d="M149 115 Q160 107 172 115 Q160 122 149 115 Z" fill="#ffffff"/>
          <circle cx="160.5" cy="114.8" r="5.2" fill="#2a6cb3"/>
          <circle cx="160.5" cy="114.8" r="3.4" fill="#4f9be8"/>
          <circle cx="160.5" cy="114.8" r="2.2" fill="#0f172a"/>
          <circle cx="162.2" cy="113.1" r="1.3" fill="#ffffff"/>
          <path d="M148.5 115 Q160 106.5 172.5 115" stroke="#362214" stroke-width="2.1" stroke-linecap="round" fill="none"/>
        </g>

        <!-- Eyelids -->
        <g class="av-eyelids">
          <path d="M107 115 Q120 106 132 115 Q120 123 107 115 Z" fill="#e19e76"/>
          <path d="M148 115 Q160 106 173 115 Q160 123 148 115 Z" fill="#e19e76"/>
        </g>

        <!-- Multi-state Lip-Sync Mouth -->
        <g class="av-mouth-wrap">
          <g class="av-mouth av-mouth-rest">
            <path d="M123 149 Q140 160 157 149 Q140 153 123 149 Z" fill="#ffffff"/>
            <path d="M122 149 Q140 154 158 149" stroke="#ba5e5a" stroke-width="2.2" stroke-linecap="round" fill="none"/>
            <path d="M124 150 Q140 163 156 150" stroke="#c86b66" stroke-width="2.3" stroke-linecap="round" fill="none"/>
          </g>
          <g class="av-mouth av-mouth-small">
            <path d="M124 149 Q140 146 156 149 Q140 160 124 149 Z" fill="#5e2124"/>
            <path d="M127 149 Q140 148 153 149 L151 152 Q140 153 129 152 Z" fill="#ffffff"/>
            <path d="M124 149 Q140 146 156 149 Q140 161 124 149 Z" stroke="#c0615d" stroke-width="2" fill="none"/>
          </g>
          <g class="av-mouth av-mouth-medium">
            <path d="M123 148 Q140 144 157 148 Q154 164 140 164 Q126 164 123 148 Z" fill="#561b1e"/>
            <path d="M126 148 Q140 146 154 148 L152 152 Q140 153 128 152 Z" fill="#ffffff"/>
            <ellipse cx="140" cy="160" rx="8" ry="3.2" fill="#c96b6d"/>
            <path d="M123 148 Q140 144 157 148 Q154 164 140 164 Q126 164 123 148 Z" stroke="#c0615d" stroke-width="2.1" fill="none"/>
          </g>
          <g class="av-mouth av-mouth-wide">
            <path d="M124 147 Q140 143 156 147 Q155 168 140 168 Q125 168 124 147 Z" fill="#4f171a"/>
            <path d="M127 147 Q140 145 153 147 L151 152 Q140 153 129 152 Z" fill="#ffffff"/>
            <ellipse cx="140" cy="162.5" rx="9" ry="4" fill="#ce7072"/>
            <path d="M124 147 Q140 143 156 147 Q155 168 140 168 Q125 168 124 147 Z" stroke="#c0615d" stroke-width="2.1" fill="none"/>
          </g>
          <g class="av-mouth av-mouth-round">
            <ellipse cx="140" cy="155" rx="8.5" ry="7.8" fill="#561b1e" stroke="#c0615d" stroke-width="2.4"/>
            <ellipse cx="140" cy="159.5" rx="4.5" ry="2.2" fill="#c96b6d"/>
          </g>
        </g>

        <!-- Tousled Sunlit Golden-Blonde Beach Waves (Front) -->
        <path d="M129 46 C103 47, 81 66, 74 103 C67 136, 71 178, 82 222 C92 198, 92 162, 95 124 C98 94, 111 72, 130 62 Z" fill="url(#avHairFront)"/>
        <path d="M128 46 C158 43, 191 63, 202 103 C213 140, 211 184, 198 228 C189 200, 189 158, 184 124 C179 92, 161 70, 129 62 Z" fill="url(#avHairFront)"/>
        <!-- Sunlit wind-swept waves & golden rim-light -->
        <path d="M128 46 C116 61, 102 77, 90 93 C97 70, 111 51, 128 46 Z" fill="#f3c774" opacity="0.78"/>
        <path d="M129 48 C149 54, 169 72, 182 95 C170 67, 151 51, 129 48 Z" fill="#f9d891" opacity="0.7"/>
        <path d="M105 63 Q84 96 76 158 Q74 192 84 218" stroke="#ffeab3" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.58"/>
        <path d="M161 58 Q190 90 198 156 Q200 186 192 214" stroke="#ffeab3" stroke-width="2.1" stroke-linecap="round" fill="none" opacity="0.55"/>
        <path d="M77 116 Q60 154 64 198" stroke="#f7d58b" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.45"/>
        <path d="M198 116 Q216 154 212 198" stroke="#f7d58b" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.45"/>
      </g>
    </svg>
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
    this.scriptData = { displayWords: [], spokenText: '', wordBounds: [] };
    this.activeWordIdx = -1;
    this.cadenceTimer = null;
    this.autoCloseTimer = null;
    this.blinkTimer = null;
    this.mouthIndex = 0;
    this.usingNativeTts = false;
    this.currentUtterance = null;
    this.autoPlayedOnce = false;

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

  isAutoPlayEnabled() {
    try {
      return localStorage.getItem(this.autoplayStorageKey) === 'true';
    } catch {
      return false;
    }
  }

  setAutoPlayEnabled(enabled) {
    try {
      localStorage.setItem(this.autoplayStorageKey, enabled ? 'true' : 'false');
    } catch {}
  }

  _installGlobalNativeHooks() {
    window.__onNativeTtsStart = () => {
      if (!this.usingNativeTts) return;
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
    }, 1100);
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

  updateVisual({ text, iconCode, tempText, condText }) {
    this.scriptData = buildSpeechScript(text);
    if (this.stageEl) {
      this.stageEl.innerHTML = renderAvatarSvg({ iconCode, tempText, condText });
    }
    this._renderWords();
    this._setMouth('rest');
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
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _setMouth(shape) {
    const svg = this.stageEl?.querySelector('.avatar-svg');
    if (svg) svg.setAttribute('data-mouth', shape || 'rest');
  }

  _pickMouthForWord(word) {
    const clean = String(word || '').toLowerCase();
    if (!clean) return 'small';
    if (/[o0]/.test(clean) && !/[aeiou]{2}/.test(clean)) return 'round';
    if (/[a]|igh|ay/.test(clean)) return 'wide';
    if (/[eiuy]/.test(clean)) return 'medium';
    return 'small';
  }

  _highlightWord(idx) {
    if (!this.scriptEl || idx === this.activeWordIdx) return;
    const prev = this.scriptEl.querySelector('.av-word.is-active');
    if (prev) prev.classList.remove('is-active');
    this.activeWordIdx = idx;
    if (idx >= 0) {
      const next = this.scriptEl.querySelector(`.av-word[data-widx="${idx}"]`);
      if (next) next.classList.add('is-active');
      const word = this.scriptData.displayWords[idx] || '';
      this._setMouth(this._pickMouthForWord(word));
    }
  }

  _handleCharBoundary(charIndex) {
    const bounds = this.scriptData.wordBounds;
    if (!bounds.length) return;
    for (let i = 0; i < bounds.length; i++) {
      if (charIndex <= bounds[i].end) {
        this._highlightWord(bounds[i].wordIdx);
        return;
      }
    }
  }

  _setSpeakingState(isSpeaking) {
    this.speaking = isSpeaking;
    const svg = this.stageEl?.querySelector('.avatar-svg');
    if (svg) svg.classList.toggle('is-speaking', isSpeaking);
    if (this.statusPillEl) this.statusPillEl.classList.toggle('is-live', isSpeaking);
    if (this.statusTextEl) {
      this.statusTextEl.textContent = isSpeaking ? 'ON AIR · INDIE LIVE' : 'READY · INDIE ON ALTA CT';
    }
    if (this.btnToggleSpeak) {
      this.btnToggleSpeak.textContent = isSpeaking ? 'Stop Indie' : 'Replay Briefing';
    }

    if (this.cadenceTimer) {
      clearInterval(this.cadenceTimer);
      this.cadenceTimer = null;
    }

    if (isSpeaking) {
      const shapes = ['small', 'medium', 'wide', 'small', 'round', 'medium'];
      this.cadenceTimer = setInterval(() => {
        if (!this.speaking) return;
        this.mouthIndex = (this.mouthIndex + 1) % shapes.length;
        this._setMouth(shapes[this.mouthIndex]);
      }, 160);
    } else {
      this._setMouth('rest');
      this._highlightWord(-1);
    }
  }

  _pickBestBrowserVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const malePattern = /\b(male|david|mark|guy|daniel|alex|fred|aaron|arthur|ryan|andrew|brian|christopher|eric|steffan|george|james|richard|rishi|oliver|thomas|albert|bruce|ralph)\b/i;
    const preferred = [
      'microsoft aria',
      'microsoft jenny',
      'microsoft ava',
      'microsoft emma',
      'google us english',
      'samantha',
      'ava',
      'allison',
      'victoria',
      'serena',
      'karen',
      'tessa',
      'moira',
      'zira',
      'female',
    ];
    for (const name of preferred) {
      const match = voices.find((v) => v.name.toLowerCase().includes(name) && !malePattern.test(v.name));
      if (match) return match;
    }
    return (
      voices.find((v) => /^en[-_]US/i.test(v.lang) && !malePattern.test(v.name)) ||
      voices.find((v) => /^en/i.test(v.lang) && !malePattern.test(v.name)) ||
      null
    );
  }

  async speak() {
    this.stop();
    this.manualStop = false;
    this._clearAutoClose();
    const spoken = this.scriptData.spokenText;
    if (!spoken) return;

    // 1. Prefer Native Android TTS Bridge when inside Sony Bravia TV APK
    if (window.AndroidTTS && typeof window.AndroidTTS.isAvailable === 'function') {
      try {
        if (window.AndroidTTS.isAvailable()) {
          this.usingNativeTts = true;
          this._setSpeakingState(true);
          const ok = window.AndroidTTS.speak(spoken, 0.90, 0.94);
          if (ok) return;
          this.usingNativeTts = false;
        }
      } catch {}
    }

    // 2. Browser Web Speech API — wait for voices to finish loading so first play is ALWAYS female
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      if (this.statusTextEl) {
        this.statusTextEl.textContent = 'SPEECH UNAVAILABLE ON THIS DEVICE';
      }
      this._setSpeakingState(false);
      return;
    }

    const voice = await this._waitForFemaleVoice(700);
    if (this.manualStop) return;

    try {
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

      utt.onstart = () => this._setSpeakingState(true);
      utt.onboundary = (e) => {
        if (typeof e.charIndex === 'number') this._handleCharBoundary(e.charIndex);
      };
      utt.onend = () => {
        this.currentUtterance = null;
        const shouldAutoClose = !this.manualStop;
        this._setSpeakingState(false);
        if (shouldAutoClose) this._scheduleAutoClose();
      };
      utt.onerror = () => {
        this.currentUtterance = null;
        this._setSpeakingState(false);
      };

      this.currentUtterance = utt;
      this._setSpeakingState(true);
      window.speechSynthesis.speak(utt);
    } catch {
      this._setSpeakingState(false);
    }
  }

  stop() {
    this.manualStop = true;
    this._clearAutoClose();
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
