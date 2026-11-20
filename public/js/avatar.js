import { getWeatherIconSvg } from './icons.js';

function expandSpokenToken(word) {
  let w = String(word || '');
  // Temperature units like 69°F, 21°C, 69°
  w = w.replace(/(-?\d+(?:\.\d+)?)°F\b/gi, '$1 degrees');
  w = w.replace(/(-?\d+(?:\.\d+)?)°C\b/gi, '$1 degrees Celsius');
  w = w.replace(/(-?\d+(?:\.\d+)?)°(?=[.,!?;:]|$)/g, '$1 degrees');
  // Speed & percentage
  w = w.replace(/\bmph\b/gi, 'miles per hour');
  w = w.replace(/\bkm\/h\b/gi, 'kilometers per hour');
  w = w.replace(/(\d+)%/g, '$1 percent');
  // Cardinal wind directions (only standalone uppercase compass words)
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
    return { top: '#181e30', mid: '#2b344d', bot: '#3e4761', accent: '#fbbf24', mode: 'storm' };
  }
  if (c.includes('rain') || c.includes('sleet') || c.includes('snow')) {
    return { top: '#1a2a3a', mid: '#2c4459', bot: '#44627a', accent: '#38bdf8', mode: 'rain' };
  }
  if (c.includes('night')) {
    return { top: '#0c1428', mid: '#172544', bot: '#243a61', accent: '#7dd3fc', mode: 'night' };
  }
  if (c.includes('cloudy') && !c.includes('partly')) {
    return { top: '#243447', mid: '#3a4f66', bot: '#566d85', accent: '#93c5fd', mode: 'cloudy' };
  }
  if (c.includes('partly')) {
    return { top: '#1d4b7a', mid: '#3772a3', bot: '#d48d59', accent: '#f5a623', mode: 'partly' };
  }
  return { top: '#1c538a', mid: '#3b82bd', bot: '#e39a5d', accent: '#fbbf24', mode: 'sunny' };
}

export function renderAvatarSvg({ iconCode = 'partly-cloudy-day', tempText = '--°', condText = '' } = {}) {
  const sky = getSkyPalette(iconCode);
  const weatherIcon = getWeatherIconSvg(iconCode, 34);

  let skyFx = '';
  if (sky.mode === 'night') {
    skyFx = `
      <circle cx="42" cy="36" r="1.4" fill="#e2e8f0" opacity="0.85"/>
      <circle cx="76" cy="24" r="1.1" fill="#e2e8f0" opacity="0.7"/>
      <circle cx="115" cy="42" r="1.3" fill="#bae6fd" opacity="0.8"/>
      <circle cx="60" cy="64" r="1" fill="#e2e8f0" opacity="0.6"/>
      <path d="M46 46 A14 14 0 1 0 60 60 A11 11 0 1 1 46 46 Z" fill="#bae6fd" opacity="0.55"/>
    `;
  } else if (sky.mode === 'rain' || sky.mode === 'storm') {
    skyFx = `
      <g stroke="#7dd3fc" stroke-width="1.5" stroke-linecap="round" opacity="0.35">
        <line x1="34" y1="26" x2="26" y2="48"/>
        <line x1="68" y1="18" x2="60" y2="40"/>
        <line x1="94" y1="44" x2="86" y2="66"/>
        <line x1="234" y1="92" x2="226" y2="114"/>
        <line x1="256" y1="120" x2="248" y2="142"/>
      </g>
    `;
  } else {
    skyFx = `
      <circle cx="48" cy="48" r="36" fill="${sky.accent}" opacity="0.16"/>
      <circle cx="48" cy="48" r="18" fill="${sky.accent}" opacity="0.28"/>
    `;
  }

  return `
    <svg class="avatar-svg" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated weathercaster avatar">
      <defs>
        <linearGradient id="avSkyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${sky.top}"/>
          <stop offset="58%" stop-color="${sky.mid}"/>
          <stop offset="100%" stop-color="${sky.bot}"/>
        </linearGradient>
        <radialGradient id="avStudioGlow" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#0b0e14" stop-opacity="0.28"/>
        </radialGradient>
        <linearGradient id="avHairBack" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stop-color="#d4984c"/>
          <stop offset="52%" stop-color="#9c6427"/>
          <stop offset="100%" stop-color="#6e4115"/>
        </linearGradient>
        <linearGradient id="avHairFront" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stop-color="#f2c472"/>
          <stop offset="45%" stop-color="#cf9042"/>
          <stop offset="100%" stop-color="#965d22"/>
        </linearGradient>
        <linearGradient id="avSkin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f7cab0"/>
          <stop offset="65%" stop-color="#eab28f"/>
          <stop offset="100%" stop-color="#dc9c76"/>
        </linearGradient>
        <linearGradient id="avNeckShadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#b8744e" stop-opacity="0.58"/>
          <stop offset="55%" stop-color="#e5a985" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="avBlazer" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stop-color="#27466e"/>
          <stop offset="100%" stop-color="#14263f"/>
        </linearGradient>
        <linearGradient id="avBlouse" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#dce4ee"/>
        </linearGradient>
      </defs>

      <!-- Studio Background -->
      <rect width="280" height="280" fill="url(#avSkyGrad)"/>
      <rect width="280" height="280" fill="url(#avStudioGlow)"/>
      ${skyFx}
      <path d="M0 228 Q70 214 140 224 T280 220 L280 280 L0 280 Z" fill="#0f172a" opacity="0.35"/>

      <!-- Over-the-Shoulder Live Weather Studio Graphic -->
      <g transform="translate(184, 14)">
        <rect x="0" y="0" width="84" height="68" rx="10" fill="rgba(14, 18, 26, 0.72)" stroke="rgba(96, 174, 255, 0.45)" stroke-width="1.2"/>
        <g transform="translate(8, 7)">${weatherIcon}</g>
        <text x="47" y="30" fill="#f8fafc" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="600">${tempText}</text>
        <text x="42" y="56" text-anchor="middle" fill="#a4b8cf" font-family="Inter, system-ui, sans-serif" font-size="8.5" font-weight="500">${String(condText || '').slice(0, 14)}</text>
      </g>

      <!-- Back Hair Mass (flowing waves behind shoulders) -->
      <path d="M78 106 C66 138, 60 185, 65 232 C76 244, 96 246, 108 238 L172 238 C184 246, 204 244, 215 232 C220 185, 214 138, 202 106 C194 64, 170 42, 140 42 C110 42, 86 64, 78 106 Z" fill="url(#avHairBack)"/>

      <!-- Torso, Shoulders, Neck & Broadcast Blazer -->
      <g class="av-torso">
        <!-- Neck -->
        <path d="M122 162 L122 204 Q140 215 158 204 L158 162 Z" fill="url(#avSkin)"/>
        <path d="M122 162 L122 192 Q140 198 158 192 L158 162 Z" fill="url(#avNeckShadow)"/>

        <!-- Ivory V-neck Blouse -->
        <path d="M98 206 Q140 195 182 206 L192 280 L88 280 Z" fill="url(#avBlouse)"/>
        <!-- Collarbone subtle shading -->
        <path d="M116 208 Q128 214 136 212 M164 208 Q152 214 144 212" stroke="#d99a74" stroke-width="1.3" stroke-linecap="round" fill="none" opacity="0.65"/>
        <!-- Delicate Gold Necklace -->
        <path d="M121 200 Q140 225 159 200" stroke="#e5b869" stroke-width="1.4" fill="none"/>
        <circle cx="140" cy="215" r="2.6" fill="#f3cd7a" stroke="#b98936" stroke-width="0.6"/>

        <!-- Tailored Navy Broadcast Blazer -->
        <path d="M52 280 C55 242, 68 214, 98 203 L122 197 L137 265 L140 280 L52 280 Z" fill="url(#avBlazer)"/>
        <path d="M228 280 C225 242, 212 214, 182 203 L158 197 L143 265 L140 280 L228 280 Z" fill="url(#avBlazer)"/>
        <!-- Blazer Lapels -->
        <polygon points="122,197 104,218 118,225 110,242 138,266" fill="#1b3557" stroke="#315785" stroke-width="0.9"/>
        <polygon points="158,197 176,218 162,225 170,242 142,266" fill="#1b3557" stroke="#315785" stroke-width="0.9"/>
        <!-- Broadcast Lapel Mic -->
        <rect x="163" y="232" width="4.5" height="8" rx="2" fill="#0f172a" stroke="#64748b" stroke-width="0.7"/>
        <circle cx="165.2" cy="234" r="1.4" fill="#60aeff"/>
      </g>

      <!-- Head & Facial Animation Group -->
      <g class="av-head">
        <!-- Ears & Gold Studs -->
        <ellipse cx="94" cy="126" rx="6.5" ry="11" fill="#e5a884"/>
        <ellipse cx="186" cy="126" rx="6.5" ry="11" fill="#e5a884"/>
        <circle cx="93.5" cy="133.5" r="2.3" fill="#f3cd7a"/>
        <circle cx="186.5" cy="133.5" r="2.3" fill="#f3cd7a"/>

        <!-- Face Contour -->
        <path d="M96 105 C95 142, 111 174, 140 177 C169 174, 185 142, 184 105 C184 73, 166 56, 140 56 C114 56, 96 73, 96 105 Z" fill="url(#avSkin)"/>

        <!-- Warm Cheek Blush & Smile Lines -->
        <ellipse cx="111" cy="135" rx="11" ry="6" fill="#e37c68" opacity="0.24"/>
        <ellipse cx="169" cy="135" rx="11" ry="6" fill="#e37c68" opacity="0.24"/>
        <path d="M115 141 Q112 148 117 154" stroke="#c88563" stroke-width="1" fill="none" opacity="0.35"/>
        <path d="M165 141 Q168 148 163 154" stroke="#c88563" stroke-width="1" fill="none" opacity="0.35"/>

        <!-- Soft Sculpted Nose -->
        <path d="M139 112 L136.5 129 Q140 134 144.5 130" stroke="#c5825d" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M136 131 Q140 134 144 131" stroke="#b9724e" stroke-width="1" fill="none" opacity="0.55"/>

        <!-- Eyebrows -->
        <g class="av-brows">
          <path d="M107 103 Q119 97 131 102" stroke="#855628" stroke-width="2.7" stroke-linecap="round" fill="none"/>
          <path d="M149 102 Q161 97 173 103" stroke="#855628" stroke-width="2.7" stroke-linecap="round" fill="none"/>
        </g>

        <!-- Ocean-Blue Eyes -->
        <g class="av-eyes">
          <!-- Left Eye -->
          <path d="M108 115 Q120 107 131 115 Q120 122 108 115 Z" fill="#ffffff"/>
          <circle cx="119.5" cy="114.8" r="5.2" fill="#2c6eb5"/>
          <circle cx="119.5" cy="114.8" r="3.4" fill="#4e9ae8"/>
          <circle cx="119.5" cy="114.8" r="2.2" fill="#0f172a"/>
          <circle cx="121.2" cy="113.1" r="1.3" fill="#ffffff"/>
          <path d="M107.5 115 Q120 106.5 131.5 115" stroke="#362214" stroke-width="2.1" stroke-linecap="round" fill="none"/>
          <!-- Right Eye -->
          <path d="M149 115 Q160 107 172 115 Q160 122 149 115 Z" fill="#ffffff"/>
          <circle cx="160.5" cy="114.8" r="5.2" fill="#2c6eb5"/>
          <circle cx="160.5" cy="114.8" r="3.4" fill="#4e9ae8"/>
          <circle cx="160.5" cy="114.8" r="2.2" fill="#0f172a"/>
          <circle cx="162.2" cy="113.1" r="1.3" fill="#ffffff"/>
          <path d="M148.5 115 Q160 106.5 172.5 115" stroke="#362214" stroke-width="2.1" stroke-linecap="round" fill="none"/>
        </g>

        <!-- Eyelids for Natural Blinking -->
        <g class="av-eyelids">
          <path d="M107 115 Q120 106 132 115 Q120 123 107 115 Z" fill="#e8af8c"/>
          <path d="M148 115 Q160 106 173 115 Q160 123 148 115 Z" fill="#e8af8c"/>
        </g>

        <!-- Multi-state Lip-Sync Mouth -->
        <g class="av-mouth-wrap">
          <!-- State: rest (warm friendly smile) -->
          <g class="av-mouth av-mouth-rest">
            <path d="M123 149 Q140 160 157 149 Q140 153 123 149 Z" fill="#ffffff"/>
            <path d="M122 149 Q140 154 158 149" stroke="#ba5e5a" stroke-width="2.2" stroke-linecap="round" fill="none"/>
            <path d="M124 150 Q140 163 156 150" stroke="#c86b66" stroke-width="2.3" stroke-linecap="round" fill="none"/>
          </g>
          <!-- State: small (soft consonant / slight open) -->
          <g class="av-mouth av-mouth-small">
            <path d="M124 149 Q140 146 156 149 Q140 160 124 149 Z" fill="#5e2124"/>
            <path d="M127 149 Q140 148 153 149 L151 152 Q140 153 129 152 Z" fill="#ffffff"/>
            <path d="M124 149 Q140 146 156 149 Q140 161 124 149 Z" stroke="#c0615d" stroke-width="2" fill="none"/>
          </g>
          <!-- State: medium (conversational vowels) -->
          <g class="av-mouth av-mouth-medium">
            <path d="M123 148 Q140 144 157 148 Q154 164 140 164 Q126 164 123 148 Z" fill="#561b1e"/>
            <path d="M126 148 Q140 146 154 148 L152 152 Q140 153 128 152 Z" fill="#ffffff"/>
            <ellipse cx="140" cy="160" rx="8" ry="3.2" fill="#c96b6d"/>
            <path d="M123 148 Q140 144 157 148 Q154 164 140 164 Q126 164 123 148 Z" stroke="#c0615d" stroke-width="2.1" fill="none"/>
          </g>
          <!-- State: wide (open ah / emphasis) -->
          <g class="av-mouth av-mouth-wide">
            <path d="M124 147 Q140 143 156 147 Q155 168 140 168 Q125 168 124 147 Z" fill="#4f171a"/>
            <path d="M127 147 Q140 145 153 147 L151 152 Q140 153 129 152 Z" fill="#ffffff"/>
            <ellipse cx="140" cy="162.5" rx="9" ry="4" fill="#ce7072"/>
            <path d="M124 147 Q140 143 156 147 Q155 168 140 168 Q125 168 124 147 Z" stroke="#c0615d" stroke-width="2.1" fill="none"/>
          </g>
          <!-- State: round (oh / oo) -->
          <g class="av-mouth av-mouth-round">
            <ellipse cx="140" cy="155" rx="8.5" ry="7.8" fill="#561b1e" stroke="#c0615d" stroke-width="2.4"/>
            <ellipse cx="140" cy="159.5" rx="4.5" ry="2.2" fill="#c96b6d"/>
          </g>
        </g>

        <!-- Front Hair / Layered Golden-Blonde Sweep -->
        <path d="M126 48 C102 49, 82 69, 77 104 C72 135, 76 172, 86 206 C92 184, 93 150, 96 122 C99 95, 110 75, 128 65 Z" fill="url(#avHairFront)"/>
        <path d="M125 48 C154 44, 188 64, 198 102 C207 136, 203 176, 193 209 C187 184, 187 150, 183 122 C179 92, 160 72, 126 65 Z" fill="url(#avHairFront)"/>
        <!-- Soft side-swept crown wave -->
        <path d="M125 48 C116 62, 102 78, 92 92 C98 71, 110 53, 125 48 Z" fill="#e9b764" opacity="0.72"/>
        <path d="M126 49 C145 55, 166 72, 179 94 C168 68, 149 52, 126 49 Z" fill="#f3ca7d" opacity="0.65"/>
        <!-- Silky Golden Hair Highlight Strands -->
        <path d="M108 64 Q89 96 86 148" stroke="#fbe3a4" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.48"/>
        <path d="M158 58 Q186 88 192 146" stroke="#fbe3a4" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.48"/>
        <path d="M170 72 Q194 114 190 176" stroke="#f5d186" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.38"/>
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
    this.autoplayStorageKey = opts.autoplayStorageKey || 'tempest_avatar_autoplay';

    this.speaking = false;
    this.scriptData = { displayWords: [], spokenText: '', wordBounds: [] };
    this.activeWordIdx = -1;
    this.cadenceTimer = null;
    this.blinkTimer = null;
    this.mouthIndex = 0;
    this.usingNativeTts = false;
    this.currentUtterance = null;
    this.autoPlayedOnce = false;

    this._installGlobalNativeHooks();
    this._startBlinkLoop();
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
      this._setSpeakingState(false);
    };
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
      'zira',
      'female',
    ];
    for (const name of preferred) {
      const match = voices.find((v) => v.name.toLowerCase().includes(name));
      if (match) return match;
    }
    const malePattern = /\b(male|david|mark|guy|daniel|alex|fred|aaron|arthur|ryan|andrew|brian|christopher|eric|steffan|george|james|richard)\b/i;
    return (
      voices.find((v) => /^en[-_]US/i.test(v.lang) && !malePattern.test(v.name)) ||
      voices.find((v) => /^en/i.test(v.lang) && !malePattern.test(v.name)) ||
      voices.find((v) => /^en[-_]US/i.test(v.lang)) ||
      voices[0]
    );
  }

  speak() {
    this.stop();
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

    // 2. Browser Web Speech API
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      if (this.statusTextEl) {
        this.statusTextEl.textContent = 'SPEECH UNAVAILABLE ON THIS DEVICE';
      }
      this._setSpeakingState(false);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(spoken);
      utt.rate = 0.90;
      utt.pitch = 0.94;
      const voice = this._pickBestBrowserVoice();
      if (voice) utt.voice = voice;

      utt.onstart = () => this._setSpeakingState(true);
      utt.onboundary = (e) => {
        if (typeof e.charIndex === 'number') this._handleCharBoundary(e.charIndex);
      };
      utt.onend = () => {
        this.currentUtterance = null;
        this._setSpeakingState(false);
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
