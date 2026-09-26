/**
 * Smoke-test the Open-Meteo integration for all four districts.
 *   node scripts/weather-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { fetchWeather, describeWeatherCode, windCompass } from '../src/services/weatherService.ts';

const SITES = {
  'Kamrup Metro (Guwahati Basin)': [26.178, 91.702],
  'Cuddalore Coastal Delta': [11.435, 79.783],
  'Kochi Backwaters Sector': [9.931, 76.267],
  'Patna Ganga Floodplain': [25.594, 85.137]
};

for (const [name, [lat, lng]] of Object.entries(SITES)) {
  try {
    const w = await fetchWeather(lat, lng);
    const c = w.current;
    const info = describeWeatherCode(c.weatherCode);
    console.log(`\n${name}`);
    console.log(`  ${c.temperatureC}°C (feels ${c.apparentTemperatureC}°) · ${info.label} [code ${c.weatherCode}/${info.group}]`);
    console.log(`  humidity ${c.humidityPct}% · pressure ${c.pressureHpa} hPa · wind ${c.windSpeedKmh} km/h ${windCompass(c.windDirectionDeg)} (gust ${c.windGustKmh})`);
    console.log(`  precip ${c.precipitationMm} mm · cloud ${c.cloudCoverPct}% · day=${c.isDay}`);
    console.log(`  hourly points: ${w.hourly.length} (first ${w.hourly[0]?.time} -> ${w.hourly[0]?.temperatureC}°C, ${w.hourly[0]?.precipitationProbabilityPct}%)`);
    console.log(`  daily points : ${w.daily.length}`);
    const d0 = w.daily[0];
    if (d0) console.log(`  today: ${d0.tempMinC}°..${d0.tempMaxC}° · pop ${d0.precipitationProbabilityMaxPct}% · sunrise ${d0.sunrise}`);
    // Sanity: the first hourly point should be at/after now, not stale history.
    const drift = w.hourly[0] ? new Date(w.hourly[0].time).getTime() - Date.now() : NaN;
    console.log(`  first-hour offset: ${(drift / 60000).toFixed(0)} min ${drift < -90 * 60000 ? '  <-- STALE!' : ''}`);
  } catch (e) {
    console.log(`\n${name}\n  FAILED: ${e.message}`);
  }
}
