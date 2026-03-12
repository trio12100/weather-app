import express from "express"
import axios from "axios"
import cors from "cors"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.static(__dirname))

// Serve Chart.js from local node_modules (avoids CDN CSP issues)
app.get('/vendor/chart.umd.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js'))
})

const OW = process.env.OPENWEATHER
const CAGE = process.env.OPENCAGE

// Serve frontend
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")))

// Full weather bundle
app.get("/api/weather", async (req, res) => {
  const { lat, lon, units = "metric" } = req.query
  if (!lat || !lon) return res.status(400).json({ error: "lat/lon required" })

  try {
    const [current, forecast, air, geo] = await Promise.all([
      axios.get("https://api.openweathermap.org/data/2.5/weather", {
        params: { lat, lon, units, appid: OW }
      }),
      axios.get("https://api.openweathermap.org/data/2.5/forecast", {
        params: { lat, lon, units, appid: OW }
      }),
      axios.get("https://api.openweathermap.org/data/2.5/air_pollution", {
        params: { lat, lon, appid: OW }
      }),
      axios.get("https://api.opencagedata.com/geocode/v1/json", {
        params: { q: `${lat}+${lon}`, key: CAGE, limit: 1, language: "en" }
      })
    ])

    // UV index — try One Call 3.0 first (paid), fall back to free UV Index endpoint
    let uv = null
    try {
      const oc = await axios.get("https://api.openweathermap.org/data/3.0/onecall", {
        params: { lat, lon, exclude: "minutely,hourly,daily,alerts", units, appid: OW }
      })
      uv = oc.data.current?.uvi ?? null
    } catch (_) {}

    if (uv === null) {
      try {
        const uvRes = await axios.get("https://api.openweathermap.org/data/2.5/uvi", {
          params: { lat, lon, appid: OW }
        })
        uv = uvRes.data?.value ?? null
      } catch (_) {}
    }

    const comp = geo.data.results?.[0]?.components || {}
    const locationName =
      comp.city || comp.town || comp.village || comp.county || comp.state || "Unknown"
    const country = comp.country || ""
    const fullLocation = country ? `${locationName}, ${country}` : locationName

    res.json({
      current: current.data,
      forecast: forecast.data,
      air: air.data,
      uv,
      location: fullLocation,
      timezone: geo.data.results?.[0]?.annotations?.timezone?.name || null
    })
  } catch (err) {
    console.error(err?.response?.data || err.message)
    res.status(500).json({ error: "Weather fetch failed" })
  }
})

// City search autocomplete
app.get("/api/search", async (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])
  try {
    const r = await axios.get("https://api.openweathermap.org/geo/1.0/direct", {
      params: { q, limit: 6, appid: OW }
    })
    res.json(r.data)
  } catch (_) {
    res.json([])
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Weather server running on ${PORT}`))