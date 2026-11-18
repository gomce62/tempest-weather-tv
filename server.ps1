<#
  Tempest Weather Dashboard — Zero-Dependency Windows PowerShell Server
  Serves ./public static files and proxies WeatherFlow Tempest REST API requests (eliminating CORS).
  Compatible with Windows PowerShell 5.1 and PowerShell 7+.
#>

param(
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublicDir = Join-Path $RootDir 'public'
$EnvPath = Join-Path $RootDir '.env'
$TempestBase = 'https://swd.weatherflow.com/swd/rest'

function Load-DotEnv {
    $map = @{}
    if (Test-Path $EnvPath) {
        foreach ($line in Get-Content $EnvPath) {
            $trimmed = $line.Trim()
            if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
            $idx = $trimmed.IndexOf('=')
            if ($idx -gt 0) {
                $k = $trimmed.Substring(0, $idx).Trim()
                $v = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
                $map[$k] = $v
            }
        }
    }
    return $map
}

function Save-DotEnv {
    param([string]$Token, [string]$StationId, [int]$ServerPort)
    $existing = Load-DotEnv
    if ($Token) { $existing['TEMPEST_API_TOKEN'] = $Token }
    if ($StationId) { $existing['TEMPEST_STATION_ID'] = $StationId }
    if (-not $existing.ContainsKey('PORT')) { $existing['PORT'] = "$ServerPort" }

    $lines = @(
        '# WeatherFlow Tempest Dashboard Configuration',
        "TEMPEST_API_TOKEN=$($existing['TEMPEST_API_TOKEN'])",
        "TEMPEST_STATION_ID=$($existing['TEMPEST_STATION_ID'])",
        "PORT=$($existing['PORT'])"
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($EnvPath, $lines, $utf8NoBom)
}

$envVars = Load-DotEnv
if ($Port -le 0) {
    if ($envVars.ContainsKey('PORT') -and ($envVars['PORT'] -as [int])) {
        $Port = [int]$envVars['PORT']
    } else {
        $Port = 3080
    }
}

# In-memory cache for 6-day prior precipitation (refreshed every 30 minutes)
$SevenDayCache = @{}

function Degrees-ToCardinal {
    param([double]$Deg)
    $dirs = @('N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW')
    $norm = (($Deg % 360) + 360) % 360
    $idx = [int][Math]::Round($norm / 22.5) % 16
    return $dirs[$idx]
}

function Build-NarrativeSummary {
    param($ForecastJson, [string]$Units)
    $cc = $ForecastJson.current_conditions
    $daily = $ForecastJson.forecast.daily
    $hourly = $ForecastJson.forecast.hourly
    $tempUnit = if ($Units -eq 'metric') { [char]0x00B0 + 'C' } else { [char]0x00B0 + 'F' }
    $windUnit = if ($Units -eq 'metric') { 'km/h' } else { 'mph' }

    $cond = 'Clear'
    if ($cc -and $cc.conditions) { $cond = [string]$cc.conditions }
    elseif ($daily -and $daily.Count -gt 0 -and $daily[0].conditions) { $cond = [string]$daily[0].conditions }

    $parts = New-Object System.Collections.Generic.List[string]
    if ($cond -match '(?i)skies|likely|possible|showers|storms|rain|snow') {
        $parts.Add("$cond.")
    } else {
        $parts.Add("$cond skies.")
    }

    $hrNow = (Get-Date).Hour
    if ($daily -and $daily.Count -gt 0) {
        if ($hrNow -ge 16 -or $hrNow -lt 5) {
            if ($null -ne $daily[0].air_temp_low) {
                $parts.Add("Low $([Math]::Round([double]$daily[0].air_temp_low))$tempUnit.")
            }
        } else {
            if ($null -ne $daily[0].air_temp_high) {
                $parts.Add("High $([Math]::Round([double]$daily[0].air_temp_high))$tempUnit.")
            }
        }
    }

    if ($hourly -and $hourly.Count -ge 2) {
        $slice = @($hourly | Select-Object -First 6 | Where-Object { $null -ne $_.wind_avg })
        if ($slice.Count -ge 2) {
            $speeds = @($slice | ForEach-Object { [double]$_.wind_avg })
            $minW = [Math]::Max(0, [int][Math]::Round(($speeds | Measure-Object -Minimum).Minimum))
            $maxW = [Math]::Max($minW + 2, [int][Math]::Round(($speeds | Measure-Object -Maximum).Maximum))
            $dir = if ($slice[0].wind_direction_cardinal) { $slice[0].wind_direction_cardinal } elseif ($cc.wind_direction_cardinal) { $cc.wind_direction_cardinal } else { Degrees-ToCardinal ([double]$cc.wind_direction) }
            $parts.Add("Winds $dir at $minW to $maxW $windUnit.")
        }
    } elseif ($cc -and $null -ne $cc.wind_avg) {
        $dir = if ($cc.wind_direction_cardinal) { $cc.wind_direction_cardinal } else { Degrees-ToCardinal ([double]$cc.wind_direction) }
        $parts.Add("Winds $dir at $([int][Math]::Round([double]$cc.wind_avg)) $windUnit.")
    }

    return ($parts -join ' ')
}

function Invoke-TempestGet {
    param([string]$Url)
    try {
        return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 15 -ErrorAction Stop
    } catch {
        $statusCode = 502
        if ($_.Exception.Response) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
        }
        throw [System.Exception]::new("HTTP_${statusCode}: $($_.Exception.Message)")
    }
}

function Get-TempestDashboardPayload {
    param([string]$StationId, [string]$Token, [string]$Units)

    $isMetric = ($Units -eq 'metric')
    $uTemp = if ($isMetric) { 'c' } else { 'f' }
    $uWind = if ($isMetric) { 'kph' } else { 'mph' }
    $uPress = if ($isMetric) { 'mb' } else { 'inhg' }
    $uPrecip = if ($isMetric) { 'mm' } else { 'in' }
    $uDist = if ($isMetric) { 'km' } else { 'mi' }

    $tokEsc = [System.Uri]::EscapeDataString($Token)
    $stEsc = [System.Uri]::EscapeDataString($StationId)

    $stationUrl = "$TempestBase/stations/$stEsc`?token=$tokEsc"
    $forecastUrl = "$TempestBase/better_forecast?station_id=$stEsc&units_temp=$uTemp&units_wind=$uWind&units_pressure=$uPress&units_precip=$uPrecip&units_distance=$uDist&token=$tokEsc"
    $obsUrl = "$TempestBase/observations/station/$stEsc`?token=$tokEsc"

    $stationJson = $null
    try { $stationJson = Invoke-TempestGet $stationUrl } catch {
        if ($_.Exception.Message -match 'HTTP_401|HTTP_403') { throw }
    }

    $forecastJson = Invoke-TempestGet $forecastUrl

    $obsJson = $null
    try { $obsJson = Invoke-TempestGet $obsUrl } catch {}

    $stationObj = $null
    if ($stationJson -and $stationJson.stations -and $stationJson.stations.Count -gt 0) {
        $stationObj = $stationJson.stations[0]
    }

    # Locate primary Tempest / Sky device ID for today's history & live WebSocket
    $deviceId = $null
    if ($stationObj -and $stationObj.devices) {
        $stDev = $stationObj.devices | Where-Object { $_.device_type -eq 'ST' } | Select-Object -First 1
        if (-not $stDev) { $stDev = $stationObj.devices | Where-Object { $_.device_type -eq 'SK' } | Select-Object -First 1 }
        if ($stDev) { $deviceId = $stDev.device_id }
    }
    if (-not $deviceId -and $obsJson -and $obsJson.device_id) {
        $deviceId = $obsJson.device_id
    }

    # Fetch today's observations to compute Peak Wind Today, Peak Solar Today, 3-Hr Pressure Delta, Precip Rate
    $windPeakToday = $null
    $solarPeakToday = $null
    $pressureChange3hr = $null
    $precipRate = $null
    $priorSixDaysMm = 0.0
    $hasPriorSixDays = $false

    if ($deviceId) {
        try {
            $nowSec = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            $localDayStart = $nowSec - 86400
            if ($forecastJson.forecast -and $forecastJson.forecast.daily -and $forecastJson.forecast.daily.Count -gt 0 -and $forecastJson.forecast.daily[0].day_start_local) {
                $localDayStart = [int]$forecastJson.forecast.daily[0].day_start_local
            }
            $todayObs = Invoke-TempestGet "$TempestBase/observations/device/$deviceId`?time_start=$localDayStart&time_end=$nowSec&token=$tokEsc"
            if ($todayObs -and $todayObs.obs -and $todayObs.obs.Count -gt 0 -and $todayObs.type -eq 'obs_st') {
                $rows = $todayObs.obs
                $maxGustMps = 0.0
                $maxSolar = 0.0
                foreach ($r in $rows) {
                    if ($null -ne $r[3] -and [double]$r[3] -gt $maxGustMps) { $maxGustMps = [double]$r[3] }
                    if ($null -ne $r[11] -and [double]$r[11] -gt $maxSolar) { $maxSolar = [double]$r[11] }
                }
                $windPeakToday = if ($isMetric) { $maxGustMps * 3.6 } else { $maxGustMps * 2.23694 }
                $solarPeakToday = $maxSolar

                # Latest observation & 3-hour pressure delta
                $latestRow = $rows[$rows.Count - 1]
                $latestEpoch = [double]$latestRow[0]
                $latestPressMb = $latestRow[6]
                if ($null -ne $latestPressMb) {
                    $targetEpoch = $latestEpoch - 10800
                    $bestRow = $null
                    $bestDiff = 9999999
                    foreach ($r in $rows) {
                        if ($null -eq $r[6]) { continue }
                        $diff = [Math]::Abs([double]$r[0] - $targetEpoch)
                        if ($diff -lt $bestDiff) {
                            $bestDiff = $diff
                            $bestRow = $r
                        }
                    }
                    if ($bestRow -and $bestDiff -lt 5400) {
                        $deltaMb = [double]$latestPressMb - [double]$bestRow[6]
                        $pressureChange3hr = if ($isMetric) { [Math]::Round($deltaMb, 1) } else { [Math]::Round($deltaMb * 0.029529983, 2) }
                    }
                }

                # Recent 5-minute rain rate
                $tailCount = [Math]::Min(5, $rows.Count)
                $rainSumMm = 0.0
                for ($i = $rows.Count - $tailCount; $i -lt $rows.Count; $i++) {
                    if ($null -ne $rows[$i][12]) { $rainSumMm += [double]$rows[$i][12] }
                }
                $rateMmHr = ($rainSumMm / $tailCount) * 60.0
                $precipRate = if ($isMetric) { $rateMmHr } else { $rateMmHr / 25.4 }
            }
        } catch {}

        # Cached 6-day prior precipitation (day_offset 1..6) for accurate 7-Day total
        $cacheKey = "$deviceId"
        $nowUtc = [DateTime]::UtcNow
        if ($SevenDayCache.ContainsKey($cacheKey) -and ($nowUtc - $SevenDayCache[$cacheKey].Time).TotalMinutes -lt 30) {
            $priorSixDaysMm = $SevenDayCache[$cacheKey].Mm
            $hasPriorSixDays = $true
        } else {
            try {
                $sumPrior = 0.0
                for ($d = 1; $d -le 6; $d++) {
                    $dayData = Invoke-TempestGet "$TempestBase/observations/device/$deviceId`?day_offset=$d&token=$tokEsc"
                    if ($dayData -and $dayData.obs -and $dayData.type -eq 'obs_st') {
                        foreach ($r in $dayData.obs) {
                            if ($null -ne $r[12]) { $sumPrior += [double]$r[12] }
                        }
                    }
                }
                $priorSixDaysMm = $sumPrior
                $hasPriorSixDays = $true
                $SevenDayCache[$cacheKey] = @{ Time = $nowUtc; Mm = $sumPrior }
            } catch {}
        }
    }

    $cc = $forecastJson.current_conditions
    $latestObs = if ($obsJson -and $obsJson.obs -and $obsJson.obs.Count -gt 0) { $obsJson.obs[0] } else { $null }
    $dailyRaw = @($forecastJson.forecast.daily)
    $todayFc = if ($dailyRaw.Count -gt 0) { $dailyRaw[0] } else { $null }

    $elevMeters = 0.0
    if ($stationObj -and $stationObj.station_meta -and $null -ne $stationObj.station_meta.elevation) {
        $elevMeters = [double]$stationObj.station_meta.elevation
    } elseif ($obsJson -and $null -ne $obsJson.elevation) {
        $elevMeters = [double]$obsJson.elevation
    }
    $elevation = if ($isMetric) { [int][Math]::Round($elevMeters) } else { [int][Math]::Round($elevMeters * 3.28084) }

    $temp = if ($null -ne $cc.air_temperature) { [double]$cc.air_temperature } else { 0.0 }
    $feelsLike = if ($null -ne $cc.feels_like) { [double]$cc.feels_like } else { $temp }
    $dewPoint = if ($null -ne $cc.dew_point) { [double]$cc.dew_point } else { $temp }
    $humidity = if ($null -ne $cc.relative_humidity) { [double]$cc.relative_humidity } else { 0.0 }
    $windSpeed = if ($null -ne $cc.wind_avg) { [double]$cc.wind_avg } else { 0.0 }
    $windGust = if ($null -ne $cc.wind_gust) { [double]$cc.wind_gust } else { $windSpeed }
    $windDir = if ($null -ne $cc.wind_direction) { [double]$cc.wind_direction } else { 0.0 }
    $windCardinal = if ($cc.wind_direction_cardinal) { [string]$cc.wind_direction_cardinal } else { Degrees-ToCardinal $windDir }
    $pressure = if ($null -ne $cc.sea_level_pressure) { [double]$cc.sea_level_pressure } elseif ($null -ne $cc.station_pressure) { [double]$cc.station_pressure } elseif ($isMetric) { 1013.2 } else { 29.92 }
    $pressTrend = if ($cc.pressure_trend) { ([string]$cc.pressure_trend).ToLower() } else { 'steady' }

    $precipToday = if ($null -ne $cc.precip_accum_local_day) { [double]$cc.precip_accum_local_day } else { 0.0 }
    $precipYesterday = if ($null -ne $cc.precip_accum_local_yesterday) { [double]$cc.precip_accum_local_yesterday } else { 0.0 }
    $precip7Day = if ($hasPriorSixDays) {
        $priorDisp = if ($isMetric) { $priorSixDaysMm } else { $priorSixDaysMm / 25.4 }
        $precipToday + $priorDisp
    } else {
        $precipToday + $precipYesterday
    }
    if ($null -eq $precipRate) { $precipRate = 0.0 }

    $uv = if ($null -ne $cc.uv) { [double]$cc.uv } else { 0.0 }
    $solar = if ($null -ne $cc.solar_radiation) { [double]$cc.solar_radiation } else { 0.0 }

    if ($null -eq $windPeakToday -or $windGust -gt $windPeakToday) { $windPeakToday = $windGust }
    if ($null -eq $solarPeakToday -or $solar -gt $solarPeakToday) { $solarPeakToday = $solar }

    $stationName = "Tempest Station $StationId"
    if ($stationObj -and $stationObj.public_name) { $stationName = [string]$stationObj.public_name }
    elseif ($stationObj -and $stationObj.name) { $stationName = [string]$stationObj.name }
    elseif ($obsJson -and $obsJson.public_name) { $stationName = [string]$obsJson.public_name }
    elseif ($obsJson -and $obsJson.station_name) { $stationName = [string]$obsJson.station_name }

    $lat = if ($stationObj -and $null -ne $stationObj.latitude) { [double]$stationObj.latitude } elseif ($null -ne $forecastJson.latitude) { [double]$forecastJson.latitude } else { 0.0 }
    $lon = if ($stationObj -and $null -ne $stationObj.longitude) { [double]$stationObj.longitude } elseif ($null -ne $forecastJson.longitude) { [double]$forecastJson.longitude } else { 0.0 }
    $tz = if ($stationObj -and $stationObj.timezone) { [string]$stationObj.timezone } elseif ($forecastJson.timezone) { [string]$forecastJson.timezone } else { 'UTC' }

    $dailyOut = @()
    foreach ($d in $dailyRaw) {
        $dailyOut += @{
            dayStartEpoch = $d.day_start_local
            conditions = if ($d.conditions) { [string]$d.conditions } else { '' }
            icon = if ($d.icon) { [string]$d.icon } else { 'partly-cloudy-day' }
            high = if ($null -ne $d.air_temp_high) { [double]$d.air_temp_high } else { $temp }
            low = if ($null -ne $d.air_temp_low) { [double]$d.air_temp_low } else { $temp }
            precipProbability = if ($null -ne $d.precip_probability) { [double]$d.precip_probability } else { 0 }
            sunrise = $d.sunrise
            sunset = $d.sunset
        }
    }

    $hourlyRaw = @($forecastJson.forecast.hourly)
    $hourlyOut = @()
    foreach ($h in $hourlyRaw) {
        $hourlyOut += @{
            t = $h.time
            i = if ($h.icon) { [string]$h.icon } else { 'partly-cloudy-day' }
            tmp = if ($null -ne $h.air_temperature) { [Math]::Round([double]$h.air_temperature, 1) } else { [Math]::Round($temp, 1) }
            p = if ($null -ne $h.precip_probability) { [int][Math]::Round([double]$h.precip_probability) } else { 0 }
            w = if ($null -ne $h.wind_avg) { [Math]::Round([double]$h.wind_avg, 1) } else { 0 }
            d = if ($null -ne $h.wind_direction) { [int][Math]::Round([double]$h.wind_direction) } else { 0 }
        }
    }

    $obsEpoch = if ($latestObs -and $latestObs.timestamp) { $latestObs.timestamp } elseif ($cc.time) { $cc.time } else { [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }

    return @{
        isDemo = $false
        units = $Units
        station = @{
            stationId = "$StationId"
            deviceId = $deviceId
            name = $stationName
            badge = "TEMPEST $StationId"
            elevation = $elevation
            elevationUnit = if ($isMetric) { 'm' } else { 'ft' }
            latitude = $lat
            longitude = $lon
            timezone = $tz
        }
        current = @{
            epoch = $obsEpoch
            temperature = $temp
            feelsLike = $feelsLike
            conditions = if ($cc.conditions) { [string]$cc.conditions } elseif ($todayFc -and $todayFc.conditions) { [string]$todayFc.conditions } else { 'Clear' }
            summary = Build-NarrativeSummary -ForecastJson $forecastJson -Units $Units
            icon = if ($cc.icon) { [string]$cc.icon } elseif ($todayFc -and $todayFc.icon) { [string]$todayFc.icon } else { 'partly-cloudy-day' }
            todayLow = if ($todayFc -and $null -ne $todayFc.air_temp_low) { [double]$todayFc.air_temp_low } else { $temp - 8 }
            todayHigh = if ($todayFc -and $null -ne $todayFc.air_temp_high) { [double]$todayFc.air_temp_high } else { $temp + 8 }
            humidity = $humidity
            dewPoint = $dewPoint
            windSpeed = $windSpeed
            windGust = $windGust
            windPeakToday = $windPeakToday
            windDirection = $windDir
            windCardinal = $windCardinal
            pressure = $pressure
            pressureTrend = $pressTrend
            pressureChange3hr = $pressureChange3hr
            precipToday = $precipToday
            precipRate = $precipRate
            precip7Day = $precip7Day
            uv = $uv
            solarRadiation = $solar
            solarPeakToday = $solarPeakToday
            lightningCount1hr = if ($null -ne $cc.lightning_strike_count_last_1hr) { [int]$cc.lightning_strike_count_last_1hr } else { 0 }
            lightningLastDistance = $cc.lightning_strike_last_distance
            lightningLastEpoch = $cc.lightning_strike_last_epoch
        }
        astronomy = @{
            sunriseEpoch = if ($todayFc) { $todayFc.sunrise } else { $null }
            sunsetEpoch = if ($todayFc) { $todayFc.sunset } else { $null }
        }
        daily = $dailyOut
        hourly = $hourlyOut
    }
}

$MimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
}

function Send-Bytes {
    param($Response, [byte[]]$Bytes, [string]$ContentType, [int]$StatusCode = 200)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = $ContentType
    $Response.Headers.Add('Cache-Control', 'no-store')
    $Response.ContentLength64 = $Bytes.Length
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Response.OutputStream.Close()
}

function Send-Json {
    param($Response, $Obj, [int]$StatusCode = 200)
    $json = $Obj | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Send-Bytes -Response $Response -Bytes $bytes -ContentType 'application/json; charset=utf-8' -StatusCode $StatusCode
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Tempest Weather Dashboard running at $prefix"
Write-Host "Press Ctrl+C to stop."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        try {
            $path = $req.Url.AbsolutePath

            if ($path -eq '/api/config') {
                if ($req.HttpMethod -eq 'GET') {
                    $cfg = Load-DotEnv
                    $tok = if ($cfg.ContainsKey('TEMPEST_API_TOKEN')) { $cfg['TEMPEST_API_TOKEN'] } else { '' }
                    $sid = if ($cfg.ContainsKey('TEMPEST_STATION_ID') -and $cfg['TEMPEST_STATION_ID']) { $cfg['TEMPEST_STATION_ID'] } else { '218212' }
                    Send-Json -Response $res -Obj @{
                        hasServerToken = ($tok.Length -gt 0)
                        wsToken = $tok
                        stationId = $sid
                    }
                    continue
                } elseif ($req.HttpMethod -eq 'POST') {
                    $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
                    $bodyText = $reader.ReadToEnd()
                    $body = $bodyText | ConvertFrom-Json
                    $tok = if ($body.token) { ([string]$body.token).Trim() } else { '' }
                    $sid = if ($body.stationId) { ([string]$body.stationId).Trim() } else { '218212' }
                    Save-DotEnv -Token $tok -StationId $sid -ServerPort $Port
                    Send-Json -Response $res -Obj @{
                        ok = $true
                        hasServerToken = ($tok.Length -gt 0)
                        stationId = $sid
                    }
                    continue
                }
            }

            if ($path -eq '/api/dashboard' -and $req.HttpMethod -eq 'GET') {
                $cfg = Load-DotEnv
                $stationId = $req.QueryString['stationId']
                if (-not $stationId) {
                    $stationId = if ($cfg.ContainsKey('TEMPEST_STATION_ID') -and $cfg['TEMPEST_STATION_ID']) { $cfg['TEMPEST_STATION_ID'] } else { '218212' }
                }
                $units = $req.QueryString['units']
                if ($units -ne 'metric') { $units = 'imperial' }

                $token = $req.Headers['X-Tempest-Token']
                if (-not $token -and $cfg.ContainsKey('TEMPEST_API_TOKEN')) {
                    $token = $cfg['TEMPEST_API_TOKEN']
                }

                if (-not $token) {
                    Send-Json -Response $res -Obj @{ error = 'Missing Tempest Personal Access Token.' } -StatusCode 401
                    continue
                }

                try {
                    $payload = Get-TempestDashboardPayload -StationId $stationId -Token $token -Units $units
                    Send-Json -Response $res -Obj $payload -StatusCode 200
                } catch {
                    $msg = $_.Exception.Message
                    $code = 502
                    if ($msg -match 'HTTP_401') { $code = 401; $msg = 'Invalid Tempest API token (401 Unauthorized).' }
                    elseif ($msg -match 'HTTP_403') { $code = 403; $msg = 'Access denied to this Tempest station (403 Forbidden).' }
                    elseif ($msg -match 'HTTP_404') { $code = 404; $msg = "Tempest station $stationId was not found (404)." }
                    Send-Json -Response $res -Obj @{ error = $msg } -StatusCode $code
                }
                continue
            }

            # Static File Serving
            $relPath = if ($path -eq '/' -or $path -eq '') { 'index.html' } else { $path.TrimStart('/') }
            $relPath = $relPath -replace '\.\.', ''
            $filePath = Join-Path $PublicDir ($relPath -replace '/', '\')

            if ((Test-Path $filePath) -and -not (Get-Item $filePath).PSIsContainer) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $mime = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { 'application/octet-stream' }
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                Send-Bytes -Response $res -Bytes $bytes -ContentType $mime -StatusCode 200
            } else {
                $notFound = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
                Send-Bytes -Response $res -Bytes $notFound -ContentType 'text/plain; charset=utf-8' -StatusCode 404
            }
        } catch {
            try {
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"Server error`"}")
                Send-Bytes -Response $res -Bytes $errBytes -ContentType 'application/json; charset=utf-8' -StatusCode 500
            } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
