/**
 * Astronomical Moon Phase Calculator & SVG Renderer
 * Uses synodic month cycle (29.53058867 days) anchored to J2000 new moon epoch.
 */

const SYNODIC_MONTH = 29.53058867;
// Known New Moon: 2000-01-06 18:14 UTC
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

export function getMoonPhase(date = new Date()) {
  const diffDays = (date.getTime() - KNOWN_NEW_MOON_MS) / 86400000;
  let cycle = (diffDays % SYNODIC_MONTH) / SYNODIC_MONTH;
  if (cycle < 0) cycle += 1;

  // Illumination fraction 0..1
  const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * cycle));

  let name;
  if (cycle < 0.03 || cycle >= 0.97) {
    name = 'New Moon';
  } else if (cycle < 0.22) {
    name = 'Waxing Crescent';
  } else if (cycle < 0.28) {
    name = 'First Quarter';
  } else if (cycle < 0.47) {
    name = 'Waxing Gibbous';
  } else if (cycle < 0.53) {
    name = 'Full Moon';
  } else if (cycle < 0.72) {
    name = 'Waning Gibbous';
  } else if (cycle < 0.78) {
    name = 'Last Quarter';
  } else {
    name = 'Waning Crescent';
  }

  return {
    cycle,
    illumination,
    percent: Math.round(illumination * 100),
    name,
  };
}

/**
 * Renders a crisp 18x18 SVG moon disc reflecting the exact current lunar phase.
 */
export function renderMoonSvg(cycle, size = 18) {
  const r = 7.5;
  const cx = 9;
  const cy = 9;

  // Compute illuminated path on unit circle
  const phaseAngle = cycle * 2 * Math.PI;
  const rx = Math.abs(Math.cos(phaseAngle)) * r;

  // Determine sweep directions for waxing (0..0.5, right side lit) vs waning (0.5..1, left side lit)
  const isWaxing = cycle < 0.5;
  const isGibbous = cycle > 0.25 && cycle < 0.75;

  let litPath = '';
  if (cycle < 0.02 || cycle > 0.98) {
    // New moon - mostly dark disc
    litPath = '';
  } else if (Math.abs(cycle - 0.5) < 0.02) {
    // Full moon
    litPath = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#c8cfd8" />`;
  } else if (isWaxing) {
    // Right half outer arc: top -> bottom clockwise (sweep 1)
    // Inner terminator arc: bottom -> top
    const innerSweep = isGibbous ? 1 : 0;
    litPath = `<path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z" fill="#c8cfd8" />`;
  } else {
    // Waning: left half outer arc: top -> bottom counter-clockwise (sweep 0)
    const innerSweep = isGibbous ? 0 : 1;
    litPath = `<path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z" fill="#c8cfd8" />`;
  }

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#2b2e34" stroke="#6f7682" stroke-width="1" />
      ${litPath}
    </svg>
  `;
}
