/**
 * Showcase Demo Dataset — mirrors the reference dashboard layout & values
 * so the app looks stunning immediately before connecting a live Tempest API token.
 */

export function getDemoDashboardData(units = 'imperial') {
  const isMetric = units === 'metric';
  const toTemp = (f) => (isMetric ? ((f - 32) * 5) / 9 : f);
  const toWind = (mph) => (isMetric ? mph * 1.60934 : mph);
  const toPress = (inhg) => (isMetric ? inhg * 33.8639 : inhg);
  const toPrecip = (inch) => (isMetric ? inch * 25.4 : inch);
  const toElev = (ft) => (isMetric ? Math.round(ft * 0.3048) : ft);

  const now = new Date();
  const baseEpoch = Math.floor(now.getTime() / 1000) - 15;

  // Build 15 days starting today matching the reference showcase
  const rawForecast = [
    { icon: 'partly-cloudy-night', cond: 'Partly Cloudy', high: 69, low: 48, pop: 8 },
    { icon: 'clear-day', cond: 'Sunny', high: 69, low: 54, pop: 8 },
    { icon: 'rainy', cond: 'Rain Likely', high: 63, low: 50, pop: 94 },
    { icon: 'partly-cloudy-day', cond: 'Partly Cloudy', high: 63, low: 44, pop: 22 },
    { icon: 'partly-cloudy-day', cond: 'Mostly Sunny', high: 52, low: 38, pop: 24 },
    { icon: 'partly-cloudy-day', cond: 'Partly Cloudy', high: 48, low: 36, pop: 18 },
    { icon: 'clear-day', cond: 'Mostly Sunny', high: 49, low: 35, pop: 11 },
    { icon: 'clear-day', cond: 'Sunny', high: 55, low: 33, pop: 4 },
    { icon: 'clear-day', cond: 'Sunny', high: 49, low: 29, pop: 5 },
    { icon: 'clear-day', cond: 'Mostly Sunny', high: 48, low: 31, pop: 11 },
    { icon: 'partly-cloudy-day', cond: 'Partly Cloudy', high: 50, low: 31, pop: 17 },
    { icon: 'partly-cloudy-day', cond: 'Partly Cloudy', high: 54, low: 34, pop: 24 },
    { icon: 'partly-cloudy-day', cond: 'Mostly Sunny', high: 54, low: 35, pop: 24 },
    { icon: 'clear-day', cond: 'Sunny', high: 54, low: 35, pop: 24 },
    { icon: 'clear-day', cond: 'Mostly Sunny', high: 54, low: 36, pop: 22 },
  ];

  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sunriseDate = new Date(todayMidnight.getTime() + (6 * 60 + 35) * 60000);
  const sunsetDate = new Date(todayMidnight.getTime() + (16 * 60 + 54) * 60000);

  const daily = rawForecast.map((d, idx) => {
    const dt = new Date(todayMidnight.getTime() + idx * 86400000);
    return {
      dayStartEpoch: Math.floor(dt.getTime() / 1000),
      dateObj: dt,
      conditions: d.cond,
      icon: d.icon,
      high: toTemp(d.high),
      low: toTemp(d.low),
      precipProbability: d.pop,
      sunrise: Math.floor(sunriseDate.getTime() / 1000) + idx * 86400,
      sunset: Math.floor(sunsetDate.getTime() / 1000) + idx * 86400,
    };
  });

  // Synthesize realistic 24-hour hourly forecast for every demo day
  const hourly = [];
  daily.forEach((day, dIdx) => {
    const rawDay = rawForecast[dIdx];
    const span = day.high - day.low;
    for (let hr = 0; hr < 24; hr++) {
      // Diurnal temperature curve: coolest around 5am, warmest around 2-3pm
      const wave = 0.5 - 0.5 * Math.cos(((hr - 5) / 24) * 2 * Math.PI);
      const tVal = day.low + span * Math.max(0, Math.min(1, wave));
      const isNight = hr < 6 || hr >= 17;
      let hrIcon = rawDay.icon;
      if (rawDay.pop >= 70 && hr >= 8 && hr <= 19) {
        hrIcon = hr >= 11 && hr <= 15 ? 'thunderstorm' : 'possibly-rainy-day';
      } else if (isNight) {
        hrIcon = rawDay.icon.includes('clear') ? 'clear-night' : 'partly-cloudy-night';
      } else if (rawDay.icon.includes('night')) {
        hrIcon = 'partly-cloudy-day';
      }
      const popFactor = hr >= 9 && hr <= 18 ? 1 : hr >= 6 && hr < 9 ? 0.35 : 0.1;
      const hrPop = Math.min(100, Math.round((rawDay.pop * popFactor) / 5) * 5);
      const baseWind = 3 + Math.round(Math.sin((hr / 24) * Math.PI) * (rawDay.pop >= 70 ? 18 : 8));
      const windDir = (115 + hr * 12 + dIdx * 25) % 360;

      hourly.push({
        t: day.dayStartEpoch + hr * 3600,
        i: hrIcon,
        tmp: Number(tVal.toFixed(1)),
        p: hrPop,
        w: Number(toWind(baseWind).toFixed(1)),
        d: windDir,
      });
    }
  });

  return {
    isDemo: true,
    units,
    station: {
      stationId: '218212',
      deviceId: null,
      name: 'Tempest Station 218212',
      badge: 'DEMO PREVIEW',
      elevation: toElev(1857),
      elevationUnit: isMetric ? 'm' : 'ft',
      latitude: 41.123,
      longitude: -75.431,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    current: {
      epoch: baseEpoch,
      temperature: toTemp(63.1),
      feelsLike: toTemp(63.0),
      conditions: 'Partly Cloudy',
      summary: isMetric
        ? 'Partly cloudy skies. Low 9°C. Winds SW at 8 to 16 km/h.'
        : 'Partly cloudy skies. Low 48°F. Winds SW at 5 to 10 mph.',
      icon: 'partly-cloudy-night',
      todayLow: toTemp(48),
      todayHigh: toTemp(69),
      humidity: 51,
      dewPoint: toTemp(44.8),
      windSpeed: toWind(1.1),
      windGust: toWind(3.4),
      windPeakToday: toWind(7.4),
      windDirection: 289,
      windCardinal: 'WNW',
      pressure: toPress(30.21),
      pressureTrend: 'falling',
      pressureChange3hr: isMetric ? -0.3 : -0.01,
      precipToday: toPrecip(0),
      precipRate: toPrecip(0),
      precip7Day: toPrecip(0),
      uv: 0,
      solarRadiation: 13.4,
      solarPeakToday: 293,
      lightningCount1hr: 0,
      lightningLastDistance: null,
      lightningLastEpoch: null,
    },
    astronomy: {
      sunriseEpoch: Math.floor(sunriseDate.getTime() / 1000),
      sunsetEpoch: Math.floor(sunsetDate.getTime() / 1000),
    },
    tides: {
      stationId: '9412110',
      stationName: 'Morro Bay',
      unit: isMetric ? 'm' : 'ft',
      predictions: [
        { time12: '5:36 AM', type: 'H', label: 'High', height: isMetric ? 1.4 : 4.5, unit: isMetric ? 'm' : 'ft' },
        { time12: '11:35 AM', type: 'L', label: 'Low', height: isMetric ? 0.8 : 2.5, unit: isMetric ? 'm' : 'ft' },
        { time12: '4:40 PM', type: 'H', label: 'High', height: isMetric ? 1.2 : 3.8, unit: isMetric ? 'm' : 'ft' },
        { time12: '11:07 PM', type: 'L', label: 'Low', height: isMetric ? 0.3 : 1.0, unit: isMetric ? 'm' : 'ft' },
      ],
    },
    daily,
    hourly,
  };
}
