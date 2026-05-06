import express from "express";

const router = express.Router();


function getIconName(code) {
  if (code === 0) return "clear-day.svg";
  if (code === 1 || code === 2) return "partly-cloudy-day.svg";
  if (code === 3) return "overcast.svg";
  if (code >= 45 && code <= 48) return "fog-day.svg";
  if (code >= 51 && code <= 67) return "drizzle.svg";
  if (code >= 61 && code <= 65) return "rain.svg";
  if (code >= 80 && code <= 82) return "partly-cloudy-day-rain.svg";
  if (code >= 71 && code <= 77) return "snow.svg";
  if (code >= 95 && code <= 99) return "thunderstorms-day-rain.svg";
  return "overcast.svg";
}


function describeWeather(code) {
  const iconUrl = `/weather-icons/${code}.svg`;
  if (code === 0) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Clear", code };
  }

  if (code === 1 || code === 2) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Partly cloudy", code };
  }

  if (code === 3) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Cloudy", code };
  }

  if (code >= 45 && code <= 48) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Fog", code };
  }

  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Rain", code };
  }

  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Snow", code };
  }

  if (code >= 95 && code <= 99) {
    return { icon: `/weather-icons/${getIconName(code)}`, summary: "Storms", code };
  }

  return { icon: `/weather-icons/${getIconName(code)}`, summary: "Cloudy", code };
}

function getMowRisk(rainChance) {
  if (rainChance >= 70) {
    return "high";
  }

  if (rainChance >= 40) {
    return "medium";
  }

  return "low";
}

router.get("/", async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ ok: false, error: "lat/lon required" });
  }

  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: "temperature_2m,weather_code,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
      forecast_days: "7",
      temperature_unit: "fahrenheit",
      windspeed_unit: "mph",
      precipitation_unit: "inch",
      timezone: "auto"
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Open-Meteo request failed");
    }

    const data = await response.json();
    const currentWeather = describeWeather(data.current?.weather_code);
    const dates = data.daily?.time ?? [];
    const highs = data.daily?.temperature_2m_max ?? [];
    const lows = data.daily?.temperature_2m_min ?? [];
    const rainChances = data.daily?.precipitation_probability_max ?? [];
    const weatherCodes = data.daily?.weather_code ?? [];
    const days = dates.map((date, index) => {
      const rainChance = rainChances[index] ?? 0;
      const weather = describeWeather(weatherCodes[index]);

      return {
        date,
        dayName: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${date}T00:00:00`)),
        highF: highs[index],
        lowF: lows[index],
        rainChance,
        icon: weather.icon,
        summary: weather.summary,
        mowRisk: getMowRisk(rainChance)
      };
    });

    return res.json({
      ok: true,
      source: "open-meteo",
      units: {
        temperature: "F",
        wind: "mph"
      },
      current: {
        temperatureF: data.current?.temperature_2m,
        windMph: data.current?.wind_speed_10m,
        icon: currentWeather.icon,
        summary: currentWeather.summary
      },
      days
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: "weather failed" });
  }
});

export default router;
