/**
 * Custom Precision SVG Gauges for the 6 Weather Metric Cards
 */

/**
 * 1. Humidity Circular Donut Gauge
 */
export function renderHumidityGauge(percent = 0) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const r = 24;
  const cx = 32;
  const cy = 32;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - clamped / 100);

  return `
    <svg class="gauge-svg" width="64" height="64" viewBox="0 0 64 64" aria-label="Humidity ${Math.round(clamped)}%">
      <circle
        cx="${cx}" cy="${cy}" r="${r}"
        fill="none"
        stroke="#2c2f36"
        stroke-width="5.5"
      />
      <circle
        cx="${cx}" cy="${cy}" r="${r}"
        fill="none"
        stroke="#4ba3d6"
        stroke-width="5.5"
        stroke-linecap="butt"
        stroke-dasharray="${circumference.toFixed(2)}"
        stroke-dashoffset="${dashOffset.toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"
        style="transition: stroke-dashoffset 0.6s ease;"
      />
    </svg>
  `;
}

/**
 * 2. Wind Compass Dial with 360-degree tick ring and directional pointer arrow
 */
export function renderWindCompass(degrees = 0, windSpeed = 0) {
  const deg = ((Number(degrees) || 0) % 360 + 360) % 360;
  const cx = 38;
  const cy = 38;
  const outerR = 30;

  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const angle = i * 6;
    const isCardinal = angle % 90 === 0;
    const isMajor = angle % 30 === 0;
    const innerR = isCardinal ? 23.5 : isMajor ? 25.5 : 27;
    const stroke = isCardinal ? '#7c828f' : isMajor ? '#585d68' : '#3d4048';
    const width = isCardinal ? 1.4 : 1;
    const rad = ((angle - 90) * Math.PI) / 180;
    const x1 = cx + Math.cos(rad) * innerR;
    const y1 = cy + Math.sin(rad) * innerR;
    const x2 = cx + Math.cos(rad) * outerR;
    const y2 = cy + Math.sin(rad) * outerR;
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${width}" />`;
  }

  // Subtle dashed inner ring
  const opacity = windSpeed > 0.05 ? 1 : 0.45;

  return `
    <svg class="gauge-svg" width="76" height="76" viewBox="0 0 76 76" aria-label="Wind direction ${Math.round(deg)} degrees">
      <circle cx="${cx}" cy="${cy}" r="30.5" fill="#151618" stroke="#2c2f36" stroke-width="1" />
      ${ticks}
      <circle cx="${cx}" cy="${cy}" r="21" fill="none" stroke="#26282e" stroke-width="1" />
      <g transform="rotate(${deg} ${cx} ${cy})" opacity="${opacity}" style="transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);">
        <polygon points="${cx},2 ${cx - 5.5},13 ${cx},10.2 ${cx + 5.5},13" fill="#f1f5f9" />
      </g>
    </svg>
  `;
}

/**
 * 3. Analog Barometer Dial with numeric markings and red needle
 */
export function renderBarometer(pressureValue = 30.0, units = 'imperial') {
  const isMetric = units === 'metric';
  const minP = isMetric ? 965 : 28.5;
  const maxP = isMetric ? 1050 : 31.0;
  const val = Number(pressureValue) || (isMetric ? 1013 : 29.92);
  const ratio = Math.max(0, Math.min(1, (val - minP) / (maxP - minP)));

  // Sweep from -135 deg (bottom-left) to +135 deg (bottom-right) -> 270 deg arc
  // 0 deg = straight up (12 o'clock)
  const needleAngle = -135 + ratio * 270;

  const cx = 38;
  const cy = 38;

  // Outer bezel ticks
  let ticks = '';
  const totalTicks = 25;
  for (let i = 0; i <= totalTicks; i++) {
    const angle = -135 + (i / totalTicks) * 270;
    const rad = ((angle - 90) * Math.PI) / 180;
    const isMajor = i % 5 === 0;
    const r1 = isMajor ? 21 : 23.5;
    const r2 = 27.5;
    const x1 = cx + Math.cos(rad) * r1;
    const y1 = cy + Math.sin(rad) * r1;
    const x2 = cx + Math.cos(rad) * r2;
    const y2 = cy + Math.sin(rad) * r2;
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${isMajor ? '#d1d5db' : '#7a808c'}" stroke-width="${isMajor ? 1.3 : 0.9}" />`;
  }

  // Tiny scale labels around outer ring
  const labels = isMetric
    ? [
        { text: '965', angle: -135 },
        { text: '990', angle: -56 },
        { text: '1013', angle: 17 },
        { text: '1050', angle: 135 },
      ]
    : [
        { text: '28.5', angle: -130 },
        { text: '29.5', angle: -27 },
        { text: '30.5', angle: 81 },
        { text: '31.0', angle: 130 },
      ];

  let labelSvg = '';
  for (const lbl of labels) {
    const rad = ((lbl.angle - 90) * Math.PI) / 180;
    const x = cx + Math.cos(rad) * 31.5;
    const y = cy + Math.sin(rad) * 31.5 + 2;
    labelSvg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#9aa0a6" font-size="5.3" font-family="system-ui, sans-serif">${lbl.text}</text>`;
  }

  return `
    <svg class="gauge-svg" width="76" height="76" viewBox="0 0 76 76" aria-label="Barometric pressure ${val}">
      <!-- Outer metallic bezel -->
      <circle cx="${cx}" cy="${cy}" r="36" fill="#1e2024" stroke="#454952" stroke-width="1.5" />
      <circle cx="${cx}" cy="${cy}" r="28" fill="#272a30" stroke="#525761" stroke-width="1" />
      ${ticks}
      ${labelSvg}
      <!-- Inner silver-white dial face -->
      <circle cx="${cx}" cy="${cy}" r="18.5" fill="#dfe3e8" stroke="#8a9099" stroke-width="1" />
      <!-- Red barometer needle -->
      <g transform="rotate(${needleAngle.toFixed(1)} ${cx} ${cy})" style="transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);">
        <polygon points="${cx - 1.6},${cy + 5} ${cx + 1.6},${cy + 5} ${cx + 0.7},${cy - 17} ${cx - 0.7},${cy - 17}" fill="#dc2626" />
        <circle cx="${cx}" cy="${cy}" r="3.2" fill="#2a2d33" stroke="#cbd5e1" stroke-width="0.9" />
      </g>
    </svg>
  `;
}

/**
 * 4. Precipitation 3D Glass Rain Cylinder
 */
export function renderRainCylinder(amount = 0, units = 'imperial') {
  const val = Math.max(0, Number(amount) || 0);
  // Auto-scale max height: 1 in (or 25 mm), expanding cleanly for heavy storms
  const baseMax = units === 'metric' ? 25 : 1.0;
  const maxScale = val <= baseMax ? baseMax : val <= baseMax * 2 ? baseMax * 2 : baseMax * 4;
  const ratio = Math.min(1, val / maxScale);

  const topY = 10;
  const bottomY = 60;
  const usableHeight = bottomY - topY - 4;
  const fillHeight = ratio > 0 ? Math.max(3, ratio * usableHeight) : 0;
  const waterTopY = bottomY - fillHeight;

  return `
    <svg class="gauge-svg" width="48" height="68" viewBox="0 0 48 68" aria-label="Precipitation ${val}">
      <defs>
        <linearGradient id="rainWaterGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#228be6" stop-opacity="0.75"/>
          <stop offset="50%" stop-color="#4dabf7" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#1c7ed6" stop-opacity="0.75"/>
        </linearGradient>
      </defs>
      <!-- Cylinder subtle glass fill -->
      <path d="M11 10 L11 58 A13 4 0 0 0 37 58 L37 10 Z" fill="#23252a" fill-opacity="0.45" />
      <!-- Water column -->
      ${
        fillHeight > 0
          ? `
        <path d="M11.5 ${waterTopY.toFixed(1)} L11.5 58 A12.5 3.8 0 0 0 36.5 58 L36.5 ${waterTopY.toFixed(1)} Z" fill="url(#rainWaterGrad)" />
        <ellipse cx="24" cy="${waterTopY.toFixed(1)}" rx="12.5" ry="3.4" fill="#74c0fc" fill-opacity="0.85" />
      `
          : ''
      }
      <!-- Cylinder wireframe -->
      <line x1="11" y1="10" x2="11" y2="58" stroke="#5b6069" stroke-width="1.4" />
      <line x1="37" y1="10" x2="37" y2="58" stroke="#5b6069" stroke-width="1.4" />
      <path d="M11 58 A13 4 0 0 0 37 58" fill="none" stroke="#5b6069" stroke-width="1.4" />
      <ellipse cx="24" cy="10" rx="13" ry="3.8" fill="#1e2024" stroke="#686d77" stroke-width="1.4" />
    </svg>
  `;
}

/**
 * 5. UV Index Segmented 10-Bar Pyramid/Triangle Gauge
 */
export function renderUvPyramid(uvIndex = 0) {
  const uv = Math.max(0, Number(uvIndex) || 0);
  const tiers = 10;
  // Map UV 0..11+ across 10 horizontal stacked slices from bottom (index 0) to top (index 9)
  const litTiers = uv <= 0 ? 0 : Math.min(tiers, Math.ceil((uv / 11) * tiers));

  const tierColors = [
    '#52c41a', // 1 - Low
    '#67c23a', // 2 - Low
    '#c8d82d', // 3 - Moderate
    '#eab308', // 4 - Moderate
    '#f59e0b', // 5 - Moderate
    '#f97316', // 6 - High
    '#ea580c', // 7 - High
    '#ef4444', // 8 - Very High
    '#dc2626', // 9 - Very High
    '#a855f7', // 10 - Extreme
  ];

  const width = 76;
  const height = 64;
  const cx = width / 2;
  const topY = 5;
  const bottomY = 60;
  const totalH = bottomY - topY;
  const gap = 1.6;
  const sliceH = (totalH - gap * (tiers - 1)) / tiers;
  const maxHalfW = 34;

  let bars = '';
  for (let i = 0; i < tiers; i++) {
    // i = 0 is bottom tier, i = tiers - 1 is apex
    const yBottom = bottomY - i * (sliceH + gap);
    const yTop = yBottom - sliceH;

    const fracBottom = (yBottom - topY) / totalH;
    const fracTop = (yTop - topY) / totalH;

    const halfWBottom = fracBottom * maxHalfW;
    const halfWTop = fracTop * maxHalfW;

    const isLit = i < litTiers;
    const fill = isLit ? tierColors[i] : '#42454c';

    const points = [
      `${(cx - halfWTop).toFixed(2)},${yTop.toFixed(2)}`,
      `${(cx + halfWTop).toFixed(2)},${yTop.toFixed(2)}`,
      `${(cx + halfWBottom).toFixed(2)},${yBottom.toFixed(2)}`,
      `${(cx - halfWBottom).toFixed(2)},${yBottom.toFixed(2)}`,
    ].join(' ');

    bars += `<polygon points="${points}" fill="${fill}" />`;
  }

  return `
    <svg class="gauge-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="UV Index ${uv}">
      ${bars}
    </svg>
  `;
}

/**
 * 6. Solar Radiation Orb Gauge
 * Smoothly shifts from muted charcoal circle at night/dusk to glowing solar gold at peak sun.
 */
export function renderSolarOrb(watts = 0) {
  const w = Math.max(0, Number(watts) || 0);
  // Normalize 0..1000 W/m^2
  const intensity = Math.min(1, w / 1000);

  if (w < 25) {
    // Low/dusk/night: clean muted dark gray circle matching screenshot (13.4 W/m²)
    return `
      <svg class="gauge-svg" width="68" height="68" viewBox="0 0 68 68" aria-label="Solar radiation ${w} watts per square meter">
        <circle cx="34" cy="34" r="27" fill="#4c4f55" />
      </svg>
    `;
  }

  // Smooth color interpolation for daytime solar intensity
  const glowOpacity = (0.15 + intensity * 0.45).toFixed(2);
  const coreColor = intensity > 0.6 ? '#fde047' : intensity > 0.25 ? '#f5b731' : '#a88743';
  const rimColor = intensity > 0.6 ? '#f59e0b' : intensity > 0.25 ? '#c48321' : '#6c634b';

  return `
    <svg class="gauge-svg" width="68" height="68" viewBox="0 0 68 68" aria-label="Solar radiation ${w} watts per square meter">
      <defs>
        <radialGradient id="solarOrbGrad" cx="42%" cy="38%" r="60%">
          <stop offset="0%" stop-color="${coreColor}" />
          <stop offset="100%" stop-color="${rimColor}" />
        </radialGradient>
        <radialGradient id="solarHaloGrad" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stop-color="#f59e0b" stop-opacity="${glowOpacity}" />
          <stop offset="100%" stop-color="#f59e0b" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="34" cy="34" r="33" fill="url(#solarHaloGrad)" />
      <circle cx="34" cy="34" r="25" fill="url(#solarOrbGrad)" />
    </svg>
  `;
}
