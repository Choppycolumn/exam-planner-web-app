export function installBriefWeatherDomain(runtime, exposeRuntime) {
    function weatherCodeText(code) {
        const labels = {
            0: '晴',
            1: '基本晴朗',
            2: '局部多云',
            3: '多云',
            45: '雾',
            48: '雾凇',
            51: '小毛毛雨',
            53: '毛毛雨',
            55: '较强毛毛雨',
            61: '小雨',
            63: '中雨',
            65: '大雨',
            71: '小雪',
            73: '中雪',
            75: '大雪',
            80: '阵雨',
            81: '较强阵雨',
            82: '强阵雨',
            95: '雷暴',
        };
        return labels[Number(code)] || '天气数据已获取';
    }
    async function getBriefWeatherBackup(settings, fallbackReason) {
        const url = `https://wttr.in/~${encodeURIComponent(settings.latitude)},${encodeURIComponent(settings.longitude)}?format=j1`;
        const data = await runtime.fetchJsonWithFallback(url, 10000);
        const current = data.current_condition?.[0] || {};
        const todayForecast = data.weather?.[0] || {};
        const hourly = todayForecast.hourly?.[0] || {};
        return {
            ok: true,
            cityName: settings.cityName,
            temperature: Number(current.temp_C ?? 0),
            humidity: Number(current.humidity ?? 0),
            windSpeed: Number(current.windspeedKmph ?? 0),
            precipitation: Number(current.precipMM ?? 0),
            weatherCode: Number(current.weatherCode ?? 0),
            condition: current.weatherDesc?.[0]?.value?.trim() || '天气数据已获取',
            maxTemperature: Number(todayForecast.maxtempC ?? current.temp_C ?? 0),
            minTemperature: Number(todayForecast.mintempC ?? current.temp_C ?? 0),
            precipitationProbability: Number(hourly.chanceofrain ?? 0),
            source: 'wttr.in',
            fallbackReason,
        };
    }
    async function getBriefWeather(settings) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(settings.latitude)}&longitude=${encodeURIComponent(settings.longitude)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai&forecast_days=1`;
        try {
            const data = await runtime.fetchJsonWithFallback(url);
            const current = data.current || {};
            const daily = data.daily || {};
            return {
                ok: true,
                cityName: settings.cityName,
                temperature: Number(current.temperature_2m ?? 0),
                humidity: Number(current.relative_humidity_2m ?? 0),
                windSpeed: Number(current.wind_speed_10m ?? 0),
                precipitation: Number(current.precipitation ?? 0),
                weatherCode: Number(current.weather_code ?? 0),
                condition: weatherCodeText(current.weather_code),
                maxTemperature: Number(daily.temperature_2m_max?.[0] ?? current.temperature_2m ?? 0),
                minTemperature: Number(daily.temperature_2m_min?.[0] ?? current.temperature_2m ?? 0),
                precipitationProbability: Number(daily.precipitation_probability_max?.[0] ?? 0),
                source: 'open-meteo',
            };
        }
        catch (error) {
            const primaryMessage = error instanceof Error ? error.message : String(error);
            try {
                return await getBriefWeatherBackup(settings, primaryMessage);
            }
            catch (backupError) {
                const backupMessage = backupError instanceof Error ? backupError.message : String(backupError);
                return { ok: false, cityName: settings.cityName, error: `${primaryMessage}; wttr fallback: ${backupMessage}` };
            }
        }
    }
    exposeRuntime({
        weatherCodeText: () => weatherCodeText,
        getBriefWeatherBackup: () => getBriefWeatherBackup,
        getBriefWeather: () => getBriefWeather,
    });
}
