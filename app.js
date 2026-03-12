/* ============================================================
   SkyPulse – Advanced Weather App
   ============================================================ */

const RENDER_API = 'https://weather-api-3ytv.onrender.com'

function normalizeBase(url) {
  return (url || '').replace(/\/$/, '')
}

function getApiBaseCandidates() {
  const host = window.location.hostname
  const override = normalizeBase(window.__WEATHER_API_BASE__)

  const bases = []
  if (override) bases.push(override)

  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const isRenderHost = host.endsWith('onrender.com')
  if (isLocal || isRenderHost) bases.push('')

  // Netlify is static hosting in this project, so prefer Render API.
  if (host.endsWith('netlify.app')) bases.push(RENDER_API)

  // Safe fallback so custom domains still work if they don't proxy /api.
  bases.push('')
  bases.push(RENDER_API)

  return [...new Set(bases)]
}

const API_BASES = getApiBaseCandidates()

async function fetchFromApi(path, params = {}) {
  const query = new URLSearchParams(params).toString()
  const suffix = query ? `${path}?${query}` : path
  let lastError = new Error('API request failed')

  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${suffix}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data?.error) throw new Error(data.error)
      return data
    } catch (err) {
      lastError = err
    }
  }

  throw lastError
}

let units = localStorage.getItem('units') || 'metric'
let charts = {}
let currentLat = null
let currentLon = null
let lastData = null

// ── Boot ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initUnitToggle()
  initSearch()
  initMapTabs()
  useMyLocation()
})

// ── Geolocation ───────────────────────────────────────────
function useMyLocation() {
  if (!navigator.geolocation) {
    loadWeather(28.6139, 77.2090)  // Delhi fallback
    return
  }

  // Try high-accuracy first, fall back to low-accuracy on timeout
  navigator.geolocation.getCurrentPosition(
    pos => loadWeather(pos.coords.latitude, pos.coords.longitude),
    () => {
      // Low accuracy fallback
      navigator.geolocation.getCurrentPosition(
        pos => loadWeather(pos.coords.latitude, pos.coords.longitude),
        () => loadWeather(28.6139, 77.2090),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      )
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  )
}

document.getElementById('locBtn').addEventListener('click', () => {
  showLoad()
  useMyLocation()
})

function retryLoad() {
  document.getElementById('errorState').style.display = 'none'
  if (currentLat && currentLon) loadWeather(currentLat, currentLon)
  else useMyLocation()
}
window.retryLoad = retryLoad

// ── Fetch ─────────────────────────────────────────────────
async function loadWeather(lat, lon) {
  showLoad()
  currentLat = lat
  currentLon = lon

  try {
    const data = await fetchFromApi('/api/weather', { lat, lon, units })
    lastData = data
    render(data, lat, lon)
  } catch (e) {
    console.error(e)
    showError('Could not load weather data. Please check your connection.')
  }
}

// ── Render all ────────────────────────────────────────────
function render(d, lat, lon) {
  setBodyTheme(d.current)
  renderHero(d.current, d.location, d.uv)
  renderQuickStats(d.current, d.uv)
  renderAQI(d.air)
  renderHourly(d.forecast.list)
  renderWeekly(d.forecast.list)
  renderCharts(d.forecast.list)
  renderSunMoon(d.current)
  renderDetails(d.current, d.uv)
  renderWindyMap(lat, lon, 'radar')
  updateLastUpdated()
  showApp()
}

// ── Hero ──────────────────────────────────────────────────
function renderHero(c, location, uv) {
  const tempUnit = units === 'metric' ? '°C' : '°F'
  const now = new Date()

  document.getElementById('heroLocation').textContent = location || 'Unknown'
  document.getElementById('heroDate').textContent =
    now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  document.getElementById('heroTemp').textContent = `${Math.round(c.main.temp)}${tempUnit}`
  document.getElementById('heroDesc').textContent = c.weather[0].description
  document.getElementById('heroFeels').textContent =
    `Feels like ${Math.round(c.main.feels_like)}${tempUnit}`
  document.getElementById('heroIcon').textContent = weatherEmoji(c.weather[0].id, isDaytime(c))
  document.getElementById('heroHiLo').textContent =
    `H: ${Math.round(c.main.temp_max)}° · L: ${Math.round(c.main.temp_min)}°`
}

// ── Quick Stats ───────────────────────────────────────────
function renderQuickStats(c, uv) {
  const spdUnit = units === 'metric' ? 'm/s' : 'mph'
  const visVal = c.visibility ? (c.visibility / 1000).toFixed(1) + ' km' : '—'
  const uvLabel = uv !== null ? uvCategory(uv).label : '—'

  setText('statHumidity', '.stat-val', `${c.main.humidity}%`)
  setText('statWind', '.stat-val', `${c.wind.speed} ${spdUnit}`)
  setText('statUV', '.stat-val', uv !== null ? `${uv} – ${uvLabel}` : '—')
  setText('statVis', '.stat-val', visVal)
  setText('statPressure', '.stat-val', `${c.main.pressure} hPa`)

  // Dew point
  const dew = calcDewPoint(c.main.temp, c.main.humidity)
  const tempUnit = units === 'metric' ? '°C' : '°F'
  setText('statDew', '.stat-val', `${Math.round(dew)}${tempUnit}`)

  // Sunrise / Sunset
  setText('statSunrise', '.stat-val', formatTime(c.sys.sunrise, c.timezone))
  setText('statSunset', '.stat-val', formatTime(c.sys.sunset, c.timezone))
}

// ── AQI ───────────────────────────────────────────────────
function renderAQI(air) {
  if (!air?.list?.length) return
  const aqi = air.list[0].main.aqi
  const comp = air.list[0].components
  const info = aqiInfo(aqi)

  document.getElementById('aqiValue').textContent = aqi
  document.getElementById('aqiValue').className = `aqi-value ${info.cls}`
  document.getElementById('aqiText').textContent = info.label
  document.getElementById('aqiText').className = `aqi-text ${info.cls}`

  // Bars
  setAqiBar('pm25Bar', 'pm25Val', comp.pm2_5, 75)
  setAqiBar('pm10Bar', 'pm10Val', comp.pm10, 150)
  setAqiBar('o3Bar', 'o3Val', comp.o3, 180)
  setAqiBar('no2Bar', 'no2Val', comp.no2, 200)
}

function setAqiBar(barId, valId, val, max) {
  const pct = Math.min(100, (val / max) * 100)
  document.getElementById(barId).style.width = `${pct}%`
  document.getElementById(valId).textContent = val ? val.toFixed(1) : '—'
}

// ── Hourly ────────────────────────────────────────────────
function renderHourly(list) {
  const container = document.getElementById('hourlyScroll')
  const items = list.slice(0, 16) // 48 hours (3h intervals)
  const nowHour = new Date().getHours()

  container.innerHTML = items.map((item, i) => {
    const dt = new Date(item.dt * 1000)
    const isNow = i === 0
    const time = isNow ? 'Now' : dt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
    const temp = `${Math.round(item.main.temp)}°`
    const icon = weatherEmoji(item.weather[0].id, dt.getHours() >= 6 && dt.getHours() < 20)
    const pop = item.pop > 0 ? `💧 ${Math.round(item.pop * 100)}%` : ''

    return `
      <div class="hour-card ${isNow ? 'now' : ''}">
        <div class="hour-time">${time}</div>
        <div class="hour-icon">${icon}</div>
        <div class="hour-temp">${temp}</div>
        ${pop ? `<div class="hour-pop">${pop}</div>` : ''}
      </div>
    `
  }).join('')
}

// ── Weekly ────────────────────────────────────────────────
function renderWeekly(list) {
  const days = {}
  list.forEach(item => {
    const day = item.dt_txt.split(' ')[0]
    if (!days[day]) days[day] = { items: [] }
    days[day].items.push(item)
  })

  const tempUnit = units === 'metric' ? '°' : '°'
  const grid = document.getElementById('weeklyGrid')

  grid.innerHTML = Object.entries(days).slice(0, 7).map(([date, { items }]) => {
    const temps = items.map(i => i.main.temp)
    const hi = Math.max(...temps)
    const lo = Math.min(...temps)
    const rep = items[Math.floor(items.length / 2)] || items[0]
    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const icon = weatherEmoji(rep.weather[0].id, true)
    const desc = rep.weather[0].description
    const pop = rep.pop > 0 ? `💧 ${Math.round(rep.pop * 100)}%` : ''

    return `
      <div class="week-card">
        <div class="week-day">${dayName}</div>
        <div class="week-icon">${icon}</div>
        <div class="week-desc">${desc}</div>
        <div class="week-hi-lo">
          <span class="week-hi">${Math.round(hi)}${tempUnit}</span>
          <span class="week-lo">${Math.round(lo)}${tempUnit}</span>
        </div>
        ${pop ? `<div class="week-pop">${pop}</div>` : ''}
      </div>
    `
  }).join('')
}

// ── Charts ────────────────────────────────────────────────
function renderCharts(list) {
  const slice = list.slice(0, 16)
  const labels = slice.map(i => {
    const d = new Date(i.dt * 1000)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  })
  const temps = slice.map(i => i.main.temp)
  const precip = slice.map(i => (i.rain?.['3h'] || 0))
  const humidity = slice.map(i => i.main.humidity)

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#8b949e', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#8b949e', font: { size: 11 } } }
    }
  }

  buildChart('tempChart', 'line', labels, temps, {
    ...chartDefaults,
    plugins: { ...chartDefaults.plugins },
  }, {
    label: `Temperature (${units === 'metric' ? '°C' : '°F'})`,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,.1)',
    borderWidth: 2.5,
    pointRadius: 3,
    pointBackgroundColor: '#3b82f6',
    tension: 0.4,
    fill: true
  })

  buildChart('precipChart', 'bar', labels, precip, chartDefaults, {
    label: 'Precipitation (mm)',
    backgroundColor: 'rgba(96,165,250,.6)',
    borderColor: '#60a5fa',
    borderWidth: 1,
    borderRadius: 4
  })

  buildChart('humidChart', 'line', labels, humidity, {
    ...chartDefaults,
    scales: {
      ...chartDefaults.scales,
      y: {
        ...chartDefaults.scales.y, min: 0, max: 100,
        ticks: { ...chartDefaults.scales.y.ticks, callback: v => v + '%' }
      }
    }
  }, {
    label: 'Humidity (%)',
    borderColor: '#34d399',
    backgroundColor: 'rgba(52,211,153,.1)',
    borderWidth: 2.5,
    tension: 0.4,
    fill: true,
    pointRadius: 3,
    pointBackgroundColor: '#34d399'
  })
}

function buildChart(id, type, labels, data, options, dataset) {
  if (charts[id]) { charts[id].destroy(); charts[id] = null }
  const canvas = document.getElementById(id)
  if (!canvas) return
  charts[id] = new Chart(canvas, { type, data: { labels, datasets: [dataset] }, options })
}

// ── Sun & Moon ────────────────────────────────────────────
function renderSunMoon(c) {
  const rise = c.sys.sunrise
  const set = c.sys.sunset
  const now = Math.floor(Date.now() / 1000)

  // Arc progress
  const total = set - rise
  const elapsed = Math.max(0, Math.min(now - rise, total))
  const pct = elapsed / total  // 0–1

  const arcLen = Math.PI * 130  // half-circle circumference ≈ 408
  const dashArr = `${(pct * arcLen).toFixed(1)} ${arcLen}`
  document.getElementById('arcActive').style.strokeDasharray = dashArr

  // Sun dot position
  const angle = Math.PI - pct * Math.PI  // 180° → 0°
  const cx = 150 + 130 * Math.cos(angle)
  const cy = 150 - 130 * Math.sin(angle)
  const dot = document.getElementById('sunDot')
  dot.setAttribute('cx', cx.toFixed(1))
  dot.setAttribute('cy', cy.toFixed(1))

  document.getElementById('smSunrise').textContent = `🌅 ${formatTime(rise, c.timezone)}`
  document.getElementById('smSunset').textContent = `🌇 ${formatTime(set, c.timezone)}`

  // Moon phase
  const phase = getMoonPhase(new Date())
  document.getElementById('moonIcon').textContent = phase.emoji
  document.getElementById('moonPhase').textContent = phase.name
}

// ── Details ───────────────────────────────────────────────
function renderDetails(c, uv) {
  const tempUnit = units === 'metric' ? '°C' : '°F'
  const spdUnit = units === 'metric' ? 'm/s' : 'mph'

  document.getElementById('dcFeels').textContent = `${Math.round(c.main.feels_like)}${tempUnit}`
  document.getElementById('dcHumidity').textContent = `${c.main.humidity}%`
  document.getElementById('dcWind').textContent = `${c.wind.speed} ${spdUnit}`
  document.getElementById('dcWindDir').textContent = windDirection(c.wind.deg)
  document.getElementById('dcGust').textContent = c.wind.gust ? `${c.wind.gust} ${spdUnit}` : '—'
  document.getElementById('dcPressure').textContent = `${c.main.pressure} hPa`
  document.getElementById('dcVis').textContent = c.visibility ? `${(c.visibility / 1000).toFixed(1)} km` : '—'
  document.getElementById('dcClouds').textContent = `${c.clouds.all}%`
  document.getElementById('dcUV').textContent = uv !== null ? `${uv} (${uvCategory(uv).label})` : '—'

  const dew = calcDewPoint(c.main.temp, c.main.humidity)
  document.getElementById('dcDew').textContent = `${Math.round(dew)}${tempUnit}`

  // Heat index (only relevant when temp > 26°C and humid)
  const hi = calcHeatIndex(c.main.temp, c.main.humidity)
  document.getElementById('dcHeat').textContent = hi !== null ? `${Math.round(hi)}${tempUnit}` : 'N/A (temp < 26°C)'

  // Wind chill (only relevant when cold and windy)
  const wc = calcWindChill(c.main.temp, c.wind.speed)
  document.getElementById('dcChill').textContent = wc !== null ? `${Math.round(wc)}${tempUnit}` : 'N/A (temp > 10°C)'
}

// ── Windy Map ─────────────────────────────────────────────
const WINDY_LAYERS = {
  radar: 'radar',
  wind: 'wind',
  clouds: 'clouds',
  temp: 'temp',
  rain: 'rain'
}

function renderWindyMap(lat, lon, layer) {
  const l = WINDY_LAYERS[layer] || 'radar'
  const z = 7
  const src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&width=650&height=450&zoom=${z}&level=surface&overlay=${l}&product=ecmwf&menu=&message=&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1`
  document.getElementById('windyFrame').src = src
}

function initMapTabs() {
  document.querySelectorAll('.map-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-tab').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      if (currentLat) renderWindyMap(currentLat, currentLon, btn.dataset.layer)
    })
  })
}

// ── Search ────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('cityInput')
  const clear = document.getElementById('clearBtn')
  const sugg = document.getElementById('suggestions')
  let timer

  input.addEventListener('input', () => {
    const q = input.value.trim()
    clear.style.display = q ? 'block' : 'none'
    clearTimeout(timer)
    if (q.length < 2) { sugg.innerHTML = ''; sugg.style.display = 'none'; return }
    timer = setTimeout(() => fetchSuggestions(q), 350)
  })

  clear.addEventListener('click', () => {
    input.value = ''
    clear.style.display = 'none'
    sugg.innerHTML = ''
    sugg.style.display = 'none'
    input.focus()
  })

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = sugg.querySelector('.suggestion-item')
      if (first) first.click()
    }
    if (e.key === 'Escape') { sugg.innerHTML = ''; sugg.style.display = 'none' }
  })

  document.addEventListener('click', e => {
    if (!document.getElementById('searchWrap').contains(e.target)) {
      sugg.innerHTML = ''; sugg.style.display = 'none'
    }
  })
}

async function fetchSuggestions(q) {
  const sugg = document.getElementById('suggestions')
  try {
    const data = await fetchFromApi('/api/search', { q })
    if (!data.length) { sugg.style.display = 'none'; return }
    sugg.style.display = 'block'
    sugg.innerHTML = data.map(c => `
      <div class="suggestion-item" data-lat="${c.lat}" data-lon="${c.lon}">
        <span class="sug-flag">${countryFlag(c.country)}</span>
        <div>
          <div class="sug-name">${c.name}${c.state ? ', ' + c.state : ''}</div>
          <div class="sug-country">${c.country}</div>
        </div>
      </div>
    `).join('')

    sugg.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('cityInput').value = item.querySelector('.sug-name').textContent
        sugg.innerHTML = ''
        sugg.style.display = 'none'
        document.getElementById('clearBtn').style.display = 'block'
        loadWeather(item.dataset.lat, item.dataset.lon)
      })
    })
  } catch (_) { }
}

// ── Unit Toggle ───────────────────────────────────────────
function initUnitToggle() {
  const btn = document.getElementById('unitToggle')
  btn.textContent = units === 'metric' ? '°F' : '°C'

  btn.addEventListener('click', () => {
    units = units === 'metric' ? 'imperial' : 'metric'
    localStorage.setItem('units', units)
    btn.textContent = units === 'metric' ? '°F' : '°C'
    if (currentLat) loadWeather(currentLat, currentLon)
  })
}

// ── Theme based on weather ────────────────────────────────
function setBodyTheme(c) {
  const id = c.weather[0].id
  const day = isDaytime(c)
  const themes = ['theme-clear', 'theme-clouds', 'theme-rain', 'theme-snow', 'theme-thunder', 'theme-mist', 'theme-night']
  document.body.classList.remove(...themes)

  if (!day) { document.body.classList.add('theme-night'); return }
  if (id >= 200 && id < 300) document.body.classList.add('theme-thunder')
  else if (id >= 300 && id < 600) document.body.classList.add('theme-rain')
  else if (id >= 600 && id < 700) document.body.classList.add('theme-snow')
  else if (id >= 700 && id < 800) document.body.classList.add('theme-mist')
  else if (id === 800) document.body.classList.add('theme-clear')
  else document.body.classList.add('theme-clouds')
}

// ── State helpers ─────────────────────────────────────────
function showLoad() {
  document.body.classList.add('loading')
  document.getElementById('app').style.display = 'none'
  document.getElementById('errorState').style.display = 'none'
}

function showApp() {
  document.body.classList.remove('loading')
  document.getElementById('app').style.display = 'block'
  document.getElementById('errorState').style.display = 'none'
}

function showError(msg) {
  document.body.classList.remove('loading')
  document.getElementById('app').style.display = 'none'
  document.getElementById('errorState').style.display = 'block'
  document.getElementById('errorMsg').textContent = msg
}

function updateLastUpdated() {
  document.getElementById('lastUpdated').textContent =
    'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function setText(parentId, selector, value) {
  const el = document.getElementById(parentId)?.querySelector(selector)
  if (el) el.textContent = value
}

// ── Weather Emoji ─────────────────────────────────────────
function weatherEmoji(id, day = true) {
  if (id >= 200 && id < 300) return '⛈️'
  if (id >= 300 && id < 400) return '🌦️'
  if (id >= 500 && id < 600) {
    if (id === 511) return '🌨️'
    if (id >= 502) return '🌧️'
    return '🌦️'
  }
  if (id >= 600 && id < 700) return id === 611 || id === 612 ? '🌨️' : '❄️'
  if (id >= 700 && id < 800) {
    if (id === 781) return '🌪️'
    return '🌫️'
  }
  if (id === 800) return day ? '☀️' : '🌙'
  if (id === 801) return day ? '🌤️' : '🌙'
  if (id === 802) return '⛅'
  if (id === 803) return '🌥️'
  if (id === 804) return '☁️'
  return day ? '🌤️' : '🌙'
}

// ── Wind Direction ────────────────────────────────────────
function windDirection(deg) {
  if (deg === undefined) return '—'
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

// ── Time Formatting ───────────────────────────────────────
function formatTime(unixSec) {
  return new Date(unixSec * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ── Daytime check ─────────────────────────────────────────
function isDaytime(c) {
  const now = Math.floor(Date.now() / 1000)
  return now >= c.sys.sunrise && now <= c.sys.sunset
}

// ── Dew Point ─────────────────────────────────────────────
function calcDewPoint(temp, humidity) {
  // Magnus formula operates on °C; convert imperial input first
  const tempC = units === 'metric' ? temp : (temp - 32) * 5 / 9
  const a = 17.27, b = 237.7
  const alpha = ((a * tempC) / (b + tempC)) + Math.log(humidity / 100)
  const dewC = (b * alpha) / (a - alpha)
  return units === 'metric' ? dewC : dewC * 9 / 5 + 32
}

// ── Heat Index ────────────────────────────────────────────
function calcHeatIndex(temp, humidity) {
  // Normalise to °C for threshold check
  const tempC = units === 'metric' ? temp : (temp - 32) * 5 / 9
  if (tempC < 26) return null
  // Rothfusz formula requires °F
  const T = tempC * 9 / 5 + 32
  const H = humidity
  const HI = -42.379 + 2.04901523 * T + 10.14333127 * H - 0.22475541 * T * H
    - 0.00683783 * T * T - 0.05481717 * H * H + 0.00122874 * T * T * H
    + 0.00085282 * T * H * H - 0.00000199 * T * T * H * H
  const hiC = (HI - 32) * 5 / 9
  return units === 'metric' ? hiC : HI
}

// ── Wind Chill ────────────────────────────────────────────
// OWM always returns temp in the requested units and wind in m/s (metric) or mph (imperial)
function calcWindChill(temp, windSpeed) {
  // Normalise to °C and km/h for the Canadian wind chill formula
  const tempC = units === 'metric' ? temp : (temp - 32) * 5 / 9
  const vKmh  = units === 'metric' ? windSpeed * 3.6 : windSpeed * 1.60934

  if (tempC > 10 || vKmh < 4.8) return null  // formula only valid below 10°C and above 4.8 km/h

  const wcC = 13.12 + 0.6215 * tempC - 11.37 * Math.pow(vKmh, 0.16) + 0.3965 * tempC * Math.pow(vKmh, 0.16)
  return units === 'metric' ? wcC : wcC * 9 / 5 + 32
}

// ── UV Category ───────────────────────────────────────────
function uvCategory(uv) {
  if (uv <= 2) return { label: 'Low', cls: 'aqi-good' }
  if (uv <= 5) return { label: 'Moderate', cls: 'aqi-fair' }
  if (uv <= 7) return { label: 'High', cls: 'aqi-mod' }
  if (uv <= 10) return { label: 'Very High', cls: 'aqi-poor' }
  return { label: 'Extreme', cls: 'aqi-vpoor' }
}

// ── AQI Info ──────────────────────────────────────────────
function aqiInfo(aqi) {
  const map = {
    1: { label: 'Good', cls: 'aqi-good' },
    2: { label: 'Fair', cls: 'aqi-fair' },
    3: { label: 'Moderate', cls: 'aqi-mod' },
    4: { label: 'Poor', cls: 'aqi-poor' },
    5: { label: 'Very Poor', cls: 'aqi-vpoor' }
  }
  return map[aqi] || { label: '—', cls: '' }
}

// ── Moon Phase ────────────────────────────────────────────
function getMoonPhase(date) {
  const knownNew = new Date(2000, 0, 6, 18, 14)
  const cycle = 29.53058867
  const diff = (date - knownNew) / (1000 * 60 * 60 * 24)
  const phase = ((diff % cycle) + cycle) % cycle

  if (phase < 1.85) return { name: 'New Moon', emoji: '🌑' }
  if (phase < 7.38) return { name: 'Waxing Crescent', emoji: '🌒' }
  if (phase < 9.22) return { name: 'First Quarter', emoji: '🌓' }
  if (phase < 14.77) return { name: 'Waxing Gibbous', emoji: '🌔' }
  if (phase < 16.61) return { name: 'Full Moon', emoji: '🌕' }
  if (phase < 22.15) return { name: 'Waning Gibbous', emoji: '🌖' }
  if (phase < 23.99) return { name: 'Last Quarter', emoji: '🌗' }
  if (phase < 29.53) return { name: 'Waning Crescent', emoji: '🌘' }
  return { name: 'New Moon', emoji: '🌑' }
}

// ── Lightning Tracker fallback ────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const frame = document.getElementById('lightningFrame')
  const fallback = document.getElementById('lightningFallback')
  if (!frame) return
  // If iframe fails (blocked by X-Frame-Options), show fallback links
  frame.addEventListener('error', () => {
    frame.style.display = 'none'
    if (fallback) fallback.style.display = 'block'
  })
  // Secondary check: if load fires but content is blocked, iframe height collapses
  frame.addEventListener('load', () => {
    setTimeout(() => {
      try {
        const h = frame.contentWindow?.document?.body?.scrollHeight
        if (h !== undefined && h < 10) {
          frame.style.display = 'none'
          if (fallback) fallback.style.display = 'block'
        }
      } catch (_) {
        // cross-origin — can't read; assume it loaded OK
      }
    }, 2000)
  })
})

// ── Country Flag Emoji ────────────────────────────────────
function countryFlag(code) {
  if (!code) return '🌍'
  return code.toUpperCase().replace(/./g, c =>
    String.fromCodePoint(c.charCodeAt(0) + 127397))
}