/**
 * Crisp multi-tone SVG Weather Icons matching the reference dashboard aesthetic
 * and covering all WeatherFlow Tempest icon codes.
 */

export function getWeatherIconSvg(iconCode = 'partly-cloudy-day', size = 44) {
  const code = String(iconCode || 'clear-day').replace(/^cc-/, '').toLowerCase();

  switch (code) {
    case 'clear-day':
      return sunSvg(size);
    case 'clear-night':
      return moonOnlySvg(size);
    case 'partly-cloudy-day':
      return partlyCloudyDaySvg(size);
    case 'partly-cloudy-night':
      return partlyCloudyNightSvg(size);
    case 'cloudy':
      return cloudySvg(size);
    case 'rainy':
    case 'possibly-rainy-day':
    case 'possibly-rainy-night':
      return rainSvg(size, code.includes('possibly-rainy-day'));
    case 'thunderstorm':
    case 'possibly-thunderstorm-day':
    case 'possibly-thunderstorm-night':
      return stormSvg(size);
    case 'snow':
    case 'possibly-snow-day':
    case 'possibly-snow-night':
      return snowSvg(size);
    case 'sleet':
    case 'possibly-sleet-day':
    case 'possibly-sleet-night':
      return sleetSvg(size);
    case 'foggy':
      return fogSvg(size);
    case 'windy':
      return windySvg(size);
    default:
      return partlyCloudyDaySvg(size);
  }
}

function sunSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="sunCore" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ffe066"/>
          <stop offset="60%" stop-color="#f5a623"/>
          <stop offset="100%" stop-color="#e07c18"/>
        </radialGradient>
      </defs>
      <g stroke="#f5a623" stroke-width="2.6" stroke-linecap="round">
        <line x1="24" y1="4.5" x2="24" y2="10"/>
        <line x1="24" y1="38" x2="24" y2="43.5"/>
        <line x1="4.5" y1="24" x2="10" y2="24"/>
        <line x1="38" y1="24" x2="43.5" y2="24"/>
        <line x1="10.2" y1="10.2" x2="14.1" y2="14.1"/>
        <line x1="33.9" y1="33.9" x2="37.8" y2="37.8"/>
        <line x1="37.8" y1="10.2" x2="33.9" y2="14.1"/>
        <line x1="14.1" y1="33.9" x2="10.2" y2="37.8"/>
      </g>
      <circle cx="24" cy="24" r="10.5" fill="url(#sunCore)"/>
    </svg>
  `;
}

function moonOnlySvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="moonGrad" x1="10" y1="8" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#9ad8ff"/>
          <stop offset="55%" stop-color="#5bb2e8"/>
          <stop offset="100%" stop-color="#3a89c9"/>
        </linearGradient>
      </defs>
      <path d="M29.8 10.5C22.2 11.2 16.5 17.7 16.8 25.4C17.1 33 23.4 39 31 39C34.2 39 37.1 37.9 39.4 36.1C36.7 36.7 33.8 36.3 31.3 34.7C26.1 31.4 24.5 24.5 27.8 19.3C29.4 16.8 31.8 15.1 34.4 14.3C33 11.9 31.5 10.7 29.8 10.5Z" fill="url(#moonGrad)"/>
      <circle cx="35" cy="14" r="1.4" fill="#a8dfff" opacity="0.8"/>
      <circle cx="14" cy="13" r="1.1" fill="#a8dfff" opacity="0.6"/>
    </svg>
  `;
}

function partlyCloudyNightSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="pcnMoon" x1="14" y1="6" x2="38" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#8cd3ff"/>
          <stop offset="55%" stop-color="#4ea8e0"/>
          <stop offset="100%" stop-color="#2e7ab8"/>
        </linearGradient>
        <linearGradient id="pcnCloud" x1="8" y1="25" x2="32" y2="41" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f1f5f9"/>
          <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
      </defs>
      <path d="M26.5 7.5C19.5 9.1 14.8 15.8 16 23.1C17.2 30.3 23.8 35.3 31.1 34.5C35.2 34 38.6 31.7 40.7 28.4C37.5 29.8 33.6 29.5 30.4 27.3C25.5 23.9 24.2 17.2 27.5 12.2C28.4 10.8 29.6 9.6 31 8.8C29.5 7.7 28 7.3 26.5 7.5Z" fill="url(#pcnMoon)"/>
      <path d="M12.5 39H31C34.3 39 37 36.4 37 33.2C37 30.2 34.7 27.7 31.8 27.4C30.8 23.4 27.2 20.5 22.9 20.5C18.1 20.5 14.2 24.1 13.8 28.8C10.5 29.1 8 31.7 8 34.9C8 37.2 10 39 12.5 39Z" fill="url(#pcnCloud)"/>
    </svg>
  `;
}

function partlyCloudyDaySvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="pcdSun" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ffe066"/>
          <stop offset="65%" stop-color="#f5a623"/>
          <stop offset="100%" stop-color="#df7b16"/>
        </radialGradient>
        <linearGradient id="pcdCloud" x1="12" y1="22" x2="38" y2="41" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
      </defs>
      <g stroke="#f5a623" stroke-width="2.2" stroke-linecap="round">
        <line x1="29" y1="6.5" x2="29" y2="10.5"/>
        <line x1="41.5" y1="19" x2="45" y2="19"/>
        <line x1="37.8" y1="10.2" x2="40.5" y2="7.5"/>
        <line x1="20.2" y1="10.2" x2="17.5" y2="7.5"/>
        <line x1="37.8" y1="27.8" x2="40.5" y2="30.5"/>
      </g>
      <circle cx="29" cy="19" r="8.8" fill="url(#pcdSun)"/>
      <path d="M12.5 40H33.5C37.1 40 40 37.2 40 33.7C40 30.4 37.5 27.7 34.3 27.4C33.2 22.9 29.2 19.6 24.4 19.6C19.2 19.6 14.9 23.6 14.5 28.8C10.8 29.1 8 32.1 8 35.6C8 38.1 10 40 12.5 40Z" fill="url(#pcdCloud)"/>
    </svg>
  `;
}

function cloudySvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cldBack" x1="16" y1="12" x2="42" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#94a3b8"/>
          <stop offset="100%" stop-color="#64748b"/>
        </linearGradient>
        <linearGradient id="cldFront" x1="8" y1="20" x2="36" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#e2e8f0"/>
          <stop offset="100%" stop-color="#b8c4d2"/>
        </linearGradient>
      </defs>
      <path d="M19 31H37.5C40.5 31 43 28.6 43 25.6C43 22.9 40.9 20.7 38.2 20.4C37.3 16.6 34 13.8 29.9 13.8C25.5 13.8 21.9 17.1 21.5 21.4C18.5 21.7 16 24.1 16 27.1C16 29.3 17.3 31 19 31Z" fill="url(#cldBack)"/>
      <path d="M11.5 38H32.5C36.1 38 39 35.2 39 31.7C39 28.4 36.5 25.7 33.3 25.4C32.2 20.9 28.2 17.6 23.4 17.6C18.2 17.6 13.9 21.6 13.5 26.8C9.8 27.1 7 30.1 7 33.6C7 36.1 9 38 11.5 38Z" fill="url(#cldFront)"/>
    </svg>
  `;
}

function rainSvg(size, showSun = false) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="rainCloud" x1="10" y1="12" x2="38" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#d8e0ea"/>
          <stop offset="100%" stop-color="#94a3b8"/>
        </linearGradient>
      </defs>
      ${showSun ? `<circle cx="33" cy="14" r="6.5" fill="#f5a623"/>` : ''}
      <path d="M12.5 31.5H34.5C38.1 31.5 41 28.7 41 25.3C41 22.1 38.5 19.5 35.3 19.2C34.2 14.8 30.2 11.6 25.4 11.6C20.2 11.6 15.9 15.5 15.5 20.5C11.8 20.8 9 23.7 9 27.1C9 29.6 10.6 31.5 12.5 31.5Z" fill="url(#rainCloud)"/>
      <g stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round">
        <line x1="17" y1="35" x2="14.5" y2="41.5"/>
        <line x1="23.5" y1="35" x2="21" y2="41.5"/>
        <line x1="30" y1="35" x2="27.5" y2="41.5"/>
        <line x1="35.5" y1="35" x2="33" y2="40"/>
      </g>
    </svg>
  `;
}

function stormSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M12 30.5H35C38.6 30.5 41.5 27.7 41.5 24.3C41.5 21.1 39 18.5 35.8 18.2C34.7 13.8 30.7 10.6 25.9 10.6C20.7 10.6 16.4 14.5 16 19.5C12.3 19.8 9.5 22.7 9.5 26.1C9.5 28.6 10.6 30.5 12 30.5Z" fill="#7c8b9e"/>
      <polygon points="25.5,27 19.5,36 24.5,36 22,44 31,33.5 25.8,33.5" fill="#fbbf24"/>
      <line x1="15.5" y1="34" x2="13.5" y2="39.5" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="34.5" y1="34" x2="32.5" y2="39.5" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `;
}

function snowSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M12.5 31H34.5C38.1 31 41 28.2 41 24.8C41 21.6 38.5 19 35.3 18.7C34.2 14.3 30.2 11.1 25.4 11.1C20.2 11.1 15.9 15 15.5 20C11.8 20.3 9 23.2 9 26.6C9 29.1 10.6 31 12.5 31Z" fill="#cbd5e1"/>
      <g fill="#e0f2fe">
        <circle cx="16.5" cy="36.5" r="2.2"/>
        <circle cx="24" cy="39.5" r="2.2"/>
        <circle cx="31.5" cy="36.5" r="2.2"/>
        <circle cx="20.2" cy="42.5" r="1.7"/>
        <circle cx="28.2" cy="42.5" r="1.7"/>
      </g>
    </svg>
  `;
}

function sleetSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M12.5 31H34.5C38.1 31 41 28.2 41 24.8C41 21.6 38.5 19 35.3 18.7C34.2 14.3 30.2 11.1 25.4 11.1C20.2 11.1 15.9 15 15.5 20C11.8 20.3 9 23.2 9 26.6C9 29.1 10.6 31 12.5 31Z" fill="#94a3b8"/>
      <line x1="17.5" y1="34.5" x2="15" y2="40.5" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="29.5" y1="34.5" x2="27" y2="40.5" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="23" cy="38" r="2.2" fill="#e0f2fe"/>
    </svg>
  `;
}

function fogSvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M13 27.5H35C38 27.5 40.5 25.1 40.5 22.1C40.5 19.4 38.4 17.2 35.7 16.9C34.8 13.1 31.4 10.3 27.3 10.3C22.9 10.3 19.3 13.6 18.9 17.9C15.7 18.2 13 20.6 13 23.6C13 25.8 13 27.5 13 27.5Z" fill="#94a3b8"/>
      <g stroke="#9ca3af" stroke-width="2.4" stroke-linecap="round">
        <line x1="10" y1="32.5" x2="38" y2="32.5"/>
        <line x1="14" y1="37.5" x2="35" y2="37.5"/>
        <line x1="11" y1="42.5" x2="31" y2="42.5"/>
      </g>
    </svg>
  `;
}

function windySvg(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <g stroke="#93c5fd" stroke-width="2.8" stroke-linecap="round" fill="none">
        <path d="M8 19H31C34 19 36.5 16.8 36.5 14C36.5 11.2 34 9 31.2 9C28.8 9 27 10.6 26.6 12.6"/>
        <path d="M6 26H37C40 26 42.5 28.2 42.5 31C42.5 33.8 40 36 37.2 36C34.8 36 33 34.4 32.6 32.4"/>
        <path d="M12 33H26"/>
      </g>
    </svg>
  `;
}

export function getRaindropSvg() {
  return `
    <svg width="9" height="11" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <path d="M5 0.8C5 0.8 1 5.4 1 7.9C1 10.1 2.8 11.6 5 11.6C7.2 11.6 9 10.1 9 7.9C9 5.4 5 0.8 5 0.8Z" fill="#4aa8d8"/>
    </svg>
  `;
}

export function getSunriseSvg() {
  return `
    <svg width="20" height="16" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <path d="M4 14.5H18" stroke="#c88a2e" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M6 14.5A5 5 0 0 1 16 14.5Z" fill="#f5a623"/>
      <g stroke="#f5a623" stroke-width="1.4" stroke-linecap="round">
        <line x1="11" y1="4.5" x2="11" y2="7"/>
        <line x1="5.2" y1="8.2" x2="6.9" y2="9.7"/>
        <line x1="16.8" y1="8.2" x2="15.1" y2="9.7"/>
      </g>
    </svg>
  `;
}

export function getSunsetSvg() {
  return `
    <svg width="20" height="16" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <path d="M4 11.5H18" stroke="#c46a2b" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M6 11.5A5 5 0 0 0 16 11.5Z" fill="#e67e22"/>
      <path d="M7.5 14.5H14.5" stroke="#9e5a24" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/>
    </svg>
  `;
}

export function getTideWaveSvg() {
  return `
    <svg width="20" height="16" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <path d="M2 7.5C4.2 5 6.8 5 9 7.5C11.2 10 13.8 10 16 7.5C17.5 5.8 19 5.3 20.5 6" stroke="#38bdf8" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M2 12.5C4.2 10 6.8 10 9 12.5C11.2 15 13.8 15 16 12.5C17.5 10.8 19 10.3 20.5 11" stroke="#0ea5e9" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>
    </svg>
  `;
}
