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
    param([string]$Token, [string]$StationId, [int]$ServerPort, [string]$AvatarAutoplay = '')
    $existing = Load-DotEnv
    if ($Token) { $existing['TEMPEST_API_TOKEN'] = $Token }
    if ($StationId) { $existing['TEMPEST_STATION_ID'] = $StationId }
    if ($AvatarAutoplay -eq 'true' -or $AvatarAutoplay -eq 'false') { $existing['TEMPEST_AVATAR_AUTOPLAY'] = $AvatarAutoplay }
    if (-not $existing.ContainsKey('PORT')) { $existing['PORT'] = "$ServerPort" }

    $lines = @(
        '# WeatherFlow Tempest Dashboard Configuration',
        "TEMPEST_API_TOKEN=$($existing['TEMPEST_API_TOKEN'])",
        "TEMPEST_STATION_ID=$($existing['TEMPEST_STATION_ID'])",
        "PORT=$($existing['PORT'])"
    )
    if ($existing.ContainsKey('TEMPEST_AVATAR_AUTOPLAY')) {
        $lines += "TEMPEST_AVATAR_AUTOPLAY=$($existing['TEMPEST_AVATAR_AUTOPLAY'])"
    }
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
$TideCache = @{}
$NoaaTidesBase = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
$MorroBayNoaaStation = '9412110'

function Format-TideTime12 {
    param([string]$TimeStr)
    $parts = ($TimeStr -split '\s+')
    if ($parts.Count -lt 2) { return $TimeStr }
    $hm = $parts[1] -split ':'
    $h24 = 0
    if (-not [int]::TryParse($hm[0], [ref]$h24)) { return $parts[1] }
    $min = if ($hm.Count -gt 1) { $hm[1] } else { '00' }
    $ampm = if ($h24 -ge 12) { 'PM' } else { 'AM' }
    $h12 = $h24 % 12
    if ($h12 -eq 0) { $h12 = 12 }
    return "${h12}:${min} ${ampm}"
}

function Get-MorroBayTides {
    param([string]$Units = 'imperial')
    $isMetric = ($Units -eq 'metric')
    $ymd = (Get-Date).ToString('yyyyMMdd')
    try {
        $pst = [System.TimeZoneInfo]::FindSystemTimeZoneById('Pacific Standard Time')
        $pacNow = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $pst)
        $ymd = $pacNow.ToString('yyyyMMdd')
    } catch {}

    $cacheKey = "${ymd}_$(if ($isMetric) { 'm' } else { 'e' })"
    $nowUtc = [DateTime]::UtcNow
    if ($TideCache.ContainsKey($cacheKey) -and ($nowUtc - $TideCache[$cacheKey].Time).TotalMinutes -lt 60) {
        return $TideCache[$cacheKey].Data
    }

    try {
        $uParam = if ($isMetric) { 'metric' } else { 'english' }
        $url = "$NoaaTidesBase`?begin_date=$ymd&end_date=$ymd&station=$MorroBayNoaaStation&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=$uParam&application=tempest_weather_tv&format=json"
        $data = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 -ErrorAction Stop
        if ($data -and $data.predictions -and $data.predictions.Count -gt 0) {
            $unitLabel = if ($isMetric) { 'm' } else { 'ft' }
            $preds = @()
            foreach ($p in $data.predictions) {
                $val = 0.0
                [void][double]::TryParse([string]$p.v, [ref]$val)
                $tType = if (([string]$p.type).ToUpper() -eq 'L') { 'L' } else { 'H' }
                $preds += @{
                    time = [string]$p.t
                    time12 = Format-TideTime12 ([string]$p.t)
                    type = $tType
                    label = if ($tType -eq 'H') { 'High' } else { 'Low' }
                    height = [Math]::Round($val, 1)
                    unit = $unitLabel
                }
            }
            $out = @{
                stationId = $MorroBayNoaaStation
                stationName = 'Morro Bay'
                unit = $unitLabel
                predictions = $preds
            }
            $TideCache[$cacheKey] = @{ Time = $nowUtc; Data = $out }
            return $out
        }
    } catch {}
    return $null
}

function Degrees-ToCardinal {
    param([double]$Deg)
    $dirs = @('N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW')
    $norm = (($Deg % 360) + 360) % 360
    $idx = [int][Math]::Round($norm / 22.5) % 16
    return $dirs[$idx]
}

function Get-StationHour {
    param([string]$Timezone)
    try {
        if ($Timezone) {
            $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($Timezone)
            return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).Hour
        }
    } catch {}
    return (Get-Date).Hour
}

function Format-HourBucket {
    param([double]$EpochSec, [string]$Timezone)
    try {
        $utc = [DateTimeOffset]::FromUnixTimeSeconds([long]$EpochSec).UtcDateTime
        $dt = $utc.ToLocalTime()
        if ($Timezone) {
            try {
                $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($Timezone)
                $dt = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
            } catch {}
        }
        $h = $dt.Hour
        $ampm = if ($h -ge 12) { 'PM' } else { 'AM' }
        $h12 = $h % 12
        if ($h12 -eq 0) { $h12 = 12 }
        return "$h12 $ampm"
    } catch { return '' }
}

function Get-LocalDateKey {
    param([double]$EpochSec, [string]$Timezone)
    try {
        $utc = [DateTimeOffset]::FromUnixTimeSeconds([long]$EpochSec).UtcDateTime
        $dt = $utc.ToLocalTime()
        if ($Timezone) {
            try {
                $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($Timezone)
                $dt = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
            } catch {}
        }
        return $dt.ToString('yyyy-MM-dd')
    } catch { return '0' }
}

function Get-LocalMidnightEpoch {
    param([long]$NowSec, [string]$Timezone)
    try {
        $utc = [DateTimeOffset]::FromUnixTimeSeconds($NowSec).UtcDateTime
        $tz = if ($Timezone) { [System.TimeZoneInfo]::FindSystemTimeZoneById($Timezone) } else { [System.TimeZoneInfo]::Local }
        $localDt = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
        $midnightLocal = [DateTime]::new($localDt.Year, $localDt.Month, $localDt.Day, 0, 0, 0, [DateTimeKind]::Unspecified)
        $midnightUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($midnightLocal, $tz)
        return [long]([DateTimeOffset]::new($midnightUtc).ToUnixTimeSeconds())
    } catch {
        $d = (Get-Date).Date
        return [long]([DateTimeOffset]::new($d).ToUnixTimeSeconds())
    }
}

function Get-SkyPhrase {
    param([string]$Cond, [bool]$IsNight)
    $c = "$Cond".ToLower()
    if ($c -match 'thunder') { return 'stormy skies with thunderstorms in the area' }
    if ($c -match 'snow|sleet|wintry') { return 'wintry precipitation moving through' }
    if ($c -match 'rain|shower') {
        if ($c -match 'possible|light') { return 'scattered showers in the area' }
        return 'wet weather with rain moving through'
    }
    if ($c -match 'fog') { return 'patchy fog and low clouds' }
    if ($c -match 'partly') { if ($IsNight) { return 'partly cloudy skies' } else { return 'a mix of sun and clouds' } }
    if ($c -match 'cloud') { return 'mostly cloudy skies' }
    if ($c -match 'wind') { return 'breezy conditions' }
    if ($c -match 'clear|sun') { if ($IsNight) { return 'clear, starlit skies' } else { return 'bright, sunny skies' } }
    if ($c) { return "$c conditions" }
    return 'fair skies'
}

function Build-NarrativeSummary {
    param($ForecastJson, [string]$Units, [string]$Timezone)
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

    $hrNow = Get-StationHour -Timezone $Timezone
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

function Build-WeathermanBriefing {
    param($ForecastJson, [string]$Units, [string]$Timezone)
    $cc = $ForecastJson.current_conditions
    $daily = @($ForecastJson.forecast.daily)
    $today = if ($daily.Count -gt 0) { $daily[0] } else { $null }
    $tomorrow = if ($daily.Count -gt 1) { $daily[1] } else { $null }
    $hourly = @($ForecastJson.forecast.hourly)
    $isMetric = ($Units -eq 'metric')
    $tu = if ($isMetric) { [char]0x00B0 + 'C' } else { [char]0x00B0 + 'F' }
    $wu = if ($isMetric) { 'km/h' } else { 'mph' }
    $hr = Get-StationHour -Timezone $Timezone
    $isNight = ($hr -ge 18 -or $hr -lt 6)
    $cond = if ($cc -and $cc.conditions) { [string]$cc.conditions } elseif ($today -and $today.conditions) { [string]$today.conditions } else { 'Clear' }
    $sky = Get-SkyPhrase -Cond $cond -IsNight $isNight

    $hi = if ($today -and $null -ne $today.air_temp_high) { [int][Math]::Round([double]$today.air_temp_high) } else { $null }
    $lo = if ($today -and $null -ne $today.air_temp_low) { [int][Math]::Round([double]$today.air_temp_low) } else { $null }
    $hiF = if ($null -ne $hi) { if ($isMetric) { ($hi * 9.0 / 5.0) + 32.0 } else { [double]$hi } } else { 65.0 }
    $comfort = if ($hiF -ge 88) { 'hot ' } elseif ($hiF -ge 77) { 'warm ' } elseif ($hiF -ge 64) { 'mild ' } elseif ($hiF -ge 52) { 'cool ' } else { 'chilly ' }

    $lead = ''
    if ($hr -ge 5 -and $hr -lt 12) {
        $hiTxt = if ($null -ne $hi) { " with ${comfort}highs climbing near $hi$tu" } else { '' }
        $loTxt = if ($null -ne $lo) { " before dipping to $lo$tu tonight." } else { '.' }
        $lead = "Good morning! Expect $sky today$hiTxt$loTxt"
    } elseif ($hr -ge 12 -and $hr -lt 17) {
        $hiTxt = if ($null -ne $hi) { ", with temperatures topping out near $hi$tu" } else { '' }
        $loTxt = if ($null -ne $lo) { " before cooling to around $lo$tu tonight." } else { '.' }
        $lead = "This afternoon brings $sky$hiTxt$loTxt"
    } elseif ($hr -ge 17 -and $hr -lt 21) {
        $loTxt = if ($null -ne $lo) { " as temperatures settle toward an overnight low near $lo$tu." } else { '.' }
        $lead = "Good evening! Expect $sky tonight$loTxt"
    } else {
        $loTxt = if ($null -ne $lo) { " with temperatures dipping toward an overnight low near $lo$tu." } else { '.' }
        $lead = "Tonight brings $sky$loTxt"
    }

    $pop = if ($today -and $null -ne $today.precip_probability) { [int][Math]::Round([double]$today.precip_probability) } else { 0 }
    $peakPopH = $null
    foreach ($h in ($hourly | Select-Object -First 12)) {
        if ($null -ne $h.precip_probability) {
            if (-not $peakPopH -or [double]$h.precip_probability -gt [double]$peakPopH.precip_probability) { $peakPopH = $h }
        }
    }
    $precipPhrase = 'Dry conditions hold steady'
    if ($pop -ge 60) {
        $peakWhen = if ($peakPopH -and $peakPopH.time -and [double]$peakPopH.precip_probability -ge 50) { " around $(Format-HourBucket -EpochSec ([double]$peakPopH.time) -Timezone $Timezone)" } else { '' }
        $precipPhrase = "Keep the umbrella handy with rain likely ($pop% chance$peakWhen)"
    } elseif ($pop -ge 30) {
        $precipPhrase = "Watch for a $pop% chance of passing showers"
    }

    $windSlice = @($hourly | Select-Object -First 6 | Where-Object { $null -ne $_.wind_avg })
    $windPhrase = '.'
    if ($windSlice.Count -ge 2) {
        $speeds = @($windSlice | ForEach-Object { [double]$_.wind_avg })
        $minW = [Math]::Max(0, [int][Math]::Round(($speeds | Measure-Object -Minimum).Minimum))
        $maxW = [Math]::Max($minW + 2, [int][Math]::Round(($speeds | Measure-Object -Maximum).Maximum))
        $maxWMph = if ($isMetric) { $maxW / 1.60934 } else { [double]$maxW }
        $dir = if ($windSlice[0].wind_direction_cardinal) { $windSlice[0].wind_direction_cardinal } elseif ($cc.wind_direction_cardinal) { $cc.wind_direction_cardinal } else { Degrees-ToCardinal ([double]$cc.wind_direction) }
        if ($maxWMph -ge 18) { $windPhrase = " alongside gusty $dir winds at $minW to $maxW $wu." }
        elseif ($maxWMph -ge 9) { $windPhrase = " with a $dir breeze at $minW to $maxW $wu." }
        else { $windPhrase = " with light $dir winds at $minW to $maxW $wu." }
    }

    $extra = ''
    if (($hr -ge 17 -or $hr -lt 5) -and $tomorrow -and $null -ne $tomorrow.air_temp_high) {
        $tomPop = if ($null -ne $tomorrow.precip_probability) { [int][Math]::Round([double]$tomorrow.precip_probability) } else { 0 }
        $tomOut = if ($tomPop -ge 50) { "brings a $tomPop% chance of rain" } else { "brings $(Get-SkyPhrase -Cond ([string]$tomorrow.conditions) -IsNight $false)" }
        $extra = " Tomorrow $tomOut with a high near $([int][Math]::Round([double]$tomorrow.air_temp_high))$tu."
    } elseif ((-not $isNight) -and $cc -and $null -ne $cc.uv -and [double]$cc.uv -ge 6) {
        $extra = ' Grab sunglasses and SPF with high UV today.'
    }

    return "$lead $precipPhrase$windPhrase$extra"
}

function Sum-PriorSixDaysPrecipMm {
    param($ObsPayloads, [long]$StartEpoch, [long]$EndEpoch, [string]$Timezone, $PrecipYesterdayMm)
    $days = @{}
    $seenEpochs = @{}
    $gotValid = $false

    foreach ($data in $ObsPayloads) {
        if (-not $data -or -not $data.obs) { continue }
        if ($data.type -ne 'obs_st' -and $data.type -ne 'obs_sky') { continue }
        $gotValid = $true
        $isSky = ($data.type -eq 'obs_sky')
        foreach ($r in $data.obs) {
            if (-not $r -or $null -eq $r[0]) { continue }
            $ts = [long]$r[0]
            if ($ts -lt $StartEpoch -or $ts -ge $EndEpoch) { continue }
            if ($seenEpochs.ContainsKey($ts)) { continue }
            $seenEpochs[$ts] = $true
            $dayKey = Get-LocalDateKey -EpochSec $ts -Timezone $Timezone
            if (-not $days.ContainsKey($dayKey)) {
                $days[$dayKey] = @{ sumRaw = 0.0; maxRaw = 0.0; sumNc = 0.0; maxNc = 0.0; useNc = $false }
            }
            $b = $days[$dayKey]
            $rawInt = if ($isSky) { if ($null -ne $r[3]) { [double]$r[3] } else { 0.0 } } else { if ($null -ne $r[12]) { [double]$r[12] } else { 0.0 } }
            $rawDay = if ($isSky) { if ($null -ne $r[11]) { [double]$r[11] } else { 0.0 } } else { if ($null -ne $r[18]) { [double]$r[18] } else { 0.0 } }
            $ncInt = if ($isSky) { if ($r.Count -gt 14 -and $null -ne $r[14]) { [double]$r[14] } else { $null } } else { if ($r.Count -gt 19 -and $null -ne $r[19]) { [double]$r[19] } else { $null } }
            $ncDay = if ($isSky) { if ($r.Count -gt 15 -and $null -ne $r[15]) { [double]$r[15] } else { $null } } else { if ($r.Count -gt 20 -and $null -ne $r[20]) { [double]$r[20] } else { $null } }
            $aType = if ($isSky) { if ($r.Count -gt 16) { $r[16] } else { $null } } else { if ($r.Count -gt 21) { $r[21] } else { $null } }

            $b.sumRaw += $rawInt
            if ($rawDay -gt $b.maxRaw) { $b.maxRaw = $rawDay }
            if ($null -ne $ncInt) { $b.sumNc += $ncInt }
            if ($null -ne $ncDay -and $ncDay -gt $b.maxNc) { $b.maxNc = $ncDay }
            if ($aType -eq 1 -and ($null -ne $ncInt -or $null -ne $ncDay)) { $b.useNc = $true }
        }
    }

    if (-not $gotValid) { return $null }

    $yestKey = Get-LocalDateKey -EpochSec ($EndEpoch - 43200) -Timezone $Timezone
    $totalMm = 0.0
    foreach ($key in $days.Keys) {
        $d = $days[$key]
        $dayMm = if ($d.useNc) { [Math]::Max($d.sumNc, $d.maxNc) } else { [Math]::Max($d.sumRaw, $d.maxRaw) }
        if ($key -eq $yestKey -and $null -ne $PrecipYesterdayMm -and [double]$PrecipYesterdayMm -gt $dayMm) {
            $dayMm = [double]$PrecipYesterdayMm
        }
        $totalMm += $dayMm
    }
    if (-not $days.ContainsKey($yestKey) -and $null -ne $PrecipYesterdayMm -and [double]$PrecipYesterdayMm -gt 0) {
        $totalMm += [double]$PrecipYesterdayMm
    }
    return $totalMm
}

function Resolve-StationObj {
    param($StationJson, [string]$StationId)
    if (-not $StationJson) { return $null }
    $list = $null
    if ($StationJson.stations) { $list = $StationJson.stations }
    elseif ($StationJson.locations) { $list = $StationJson.locations }
    if (-not $list -or $list.Count -eq 0) { return $null }
    foreach ($s in $list) {
        $sidVal = if ($null -ne $s.station_id) { "$($s.station_id)" } elseif ($null -ne $s.location_id) { "$($s.location_id)" } else { '' }
        if ($sidVal -eq "$StationId") { return $s }
    }
    return $list[0]
}

function Get-CandidateDeviceIds {
    param($ObsJson, $Devices)
    $out = New-Object System.Collections.ArrayList
    $seen = @{}
    function Add-Id($id) {
        if (-not $id) { return }
        $k = "$id"
        if (-not $seen.ContainsKey($k)) {
            $seen[$k] = $true
            [void]$out.Add($id)
        }
    }
    if ($ObsJson -and $ObsJson.device_id) { Add-Id $ObsJson.device_id }
    if ($Devices) {
        foreach ($d in $Devices) { if ($d.device_type -eq 'ST' -and $d.serial_number) { Add-Id $d.device_id } }
        foreach ($d in $Devices) { if ($d.device_type -eq 'SK' -and $d.serial_number) { Add-Id $d.device_id } }
        foreach ($d in $Devices) { if ($d.device_type -eq 'ST' -or $d.device_type -eq 'SK') { Add-Id $d.device_id } }
    }
    return $out
}

function Parse-TodayObs {
    param($TodayObs, [long]$LocalDayStart, [bool]$IsMetric)
    if (-not $TodayObs -or -not $TodayObs.obs -or $TodayObs.obs.Count -eq 0) { return $null }
    if ($TodayObs.type -ne 'obs_st' -and $TodayObs.type -ne 'obs_sky') { return $null }

    $isSky = ($TodayObs.type -eq 'obs_sky')
    $rows = @($TodayObs.obs | Sort-Object { if ($_ -and $null -ne $_[0]) { [long]$_[0] } else { 0 } })
    $gustIdx = if ($isSky) { 6 } else { 3 }
    $solarIdx = if ($isSky) { 10 } else { 11 }
    $rainIdx = if ($isSky) { 3 } else { 12 }

    $todayRows = @($rows | Where-Object { $_ -and $null -ne $_[0] -and [long]$_[0] -ge $LocalDayStart })
    $windPeakToday = $null
    $solarPeakToday = $null
    $precipRate = 0.0

    if ($todayRows.Count -gt 0) {
        $maxGustMps = 0.0
        $maxSolar = 0.0
        foreach ($r in $todayRows) {
            if ($null -ne $r[$gustIdx] -and [double]$r[$gustIdx] -gt $maxGustMps) { $maxGustMps = [double]$r[$gustIdx] }
            if ($null -ne $r[$solarIdx] -and [double]$r[$solarIdx] -gt $maxSolar) { $maxSolar = [double]$r[$solarIdx] }
        }
        $windPeakToday = if ($IsMetric) { $maxGustMps * 3.6 } else { $maxGustMps * 2.23694 }
        $solarPeakToday = $maxSolar

        $tailCount = [Math]::Min(5, $todayRows.Count)
        $rainSumMm = 0.0
        for ($i = $todayRows.Count - $tailCount; $i -lt $todayRows.Count; $i++) {
            if ($null -ne $todayRows[$i][$rainIdx]) { $rainSumMm += [double]$todayRows[$i][$rainIdx] }
        }
        $rateMmHr = ($rainSumMm / $tailCount) * 60.0
        $precipRate = if ($IsMetric) { $rateMmHr } else { $rateMmHr / 25.4 }
    }

    $pressureChange3hr = $null
    if (-not $isSky -and $rows.Count -gt 0) {
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
                $pressureChange3hr = if ($IsMetric) { [Math]::Round($deltaMb, 1) } else { [Math]::Round($deltaMb * 0.029529983, 2) }
            }
        }
    }

    return @{
        windPeakToday = $windPeakToday
        solarPeakToday = $solarPeakToday
        pressureChange3hr = $pressureChange3hr
        precipRate = $precipRate
    }
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

    $stationObj = Resolve-StationObj -StationJson $stationJson -StationId $StationId
    if (-not $stationObj -or -not $stationObj.devices -or $stationObj.devices.Count -eq 0) {
        try {
            $allSt = Invoke-TempestGet "$TempestBase/stations?token=$tokEsc"
            $foundSt = Resolve-StationObj -StationJson $allSt -StationId $StationId
            if ($foundSt) { $stationObj = $foundSt }
        } catch {}
    }

    $devices = if ($stationObj -and $stationObj.devices) { $stationObj.devices } else { @() }
    $candidateDeviceIds = Get-CandidateDeviceIds -ObsJson $obsJson -Devices $devices
    $deviceId = if ($candidateDeviceIds.Count -gt 0) { $candidateDeviceIds[0] } else { $null }

    $cc = $forecastJson.current_conditions
    $latestObs = if ($obsJson -and $obsJson.obs -and $obsJson.obs.Count -gt 0) { $obsJson.obs[0] } else { $null }
    $dailyRaw = @($forecastJson.forecast.daily)
    $todayFc = if ($dailyRaw.Count -gt 0) { $dailyRaw[0] } else { $null }
    $tz = if ($stationObj -and $stationObj.timezone) { [string]$stationObj.timezone } elseif ($forecastJson.timezone) { [string]$forecastJson.timezone } else { 'UTC' }

    $precipToday = if ($null -ne $cc.precip_accum_local_day) { [double]$cc.precip_accum_local_day }
        elseif ($latestObs -and $null -ne $latestObs.precip_accum_local_day_final) { if ($isMetric) { [double]$latestObs.precip_accum_local_day_final } else { [double]$latestObs.precip_accum_local_day_final / 25.4 } }
        elseif ($latestObs -and $null -ne $latestObs.precip_accum_local_day) { if ($isMetric) { [double]$latestObs.precip_accum_local_day } else { [double]$latestObs.precip_accum_local_day / 25.4 } }
        else { 0.0 }
    $precipYesterday = if ($null -ne $cc.precip_accum_local_yesterday) { [double]$cc.precip_accum_local_yesterday }
        elseif ($latestObs -and $null -ne $latestObs.precip_accum_local_yesterday_final) { if ($isMetric) { [double]$latestObs.precip_accum_local_yesterday_final } else { [double]$latestObs.precip_accum_local_yesterday_final / 25.4 } }
        elseif ($latestObs -and $null -ne $latestObs.precip_accum_local_yesterday) { if ($isMetric) { [double]$latestObs.precip_accum_local_yesterday } else { [double]$latestObs.precip_accum_local_yesterday / 25.4 } }
        else { 0.0 }
    $precipYestMm = if ($latestObs -and $null -ne $latestObs.precip_accum_local_yesterday_final) { [double]$latestObs.precip_accum_local_yesterday_final }
        elseif ($latestObs -and $null -ne $latestObs.precip_accum_local_yesterday) { [double]$latestObs.precip_accum_local_yesterday }
        elseif ($isMetric) { $precipYesterday } else { $precipYesterday * 25.4 }

    # Fetch today's observations to compute Peak Wind Today, Peak Solar Today, 3-Hr Pressure Delta, Precip Rate
    $windPeakToday = $null
    $solarPeakToday = $null
    $pressureChange3hr = $null
    $precipRate = $null
    $priorSixDaysMm = 0.0
    $hasPriorSixDays = $false

    if ($candidateDeviceIds.Count -gt 0) {
        $nowSec = [long][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $localDayStart = Get-LocalMidnightEpoch -NowSec $nowSec -Timezone $tz
        $todayFetchStart = [Math]::Min($localDayStart, $nowSec - 14400)

        foreach ($candId in $candidateDeviceIds) {
            $parsed = $null
            try {
                $todayObs = Invoke-TempestGet "$TempestBase/observations/device/$candId`?time_start=$todayFetchStart&time_end=$nowSec&token=$tokEsc"
                $parsed = Parse-TodayObs -TodayObs $todayObs -LocalDayStart $localDayStart -IsMetric $isMetric
            } catch {}
            if (-not $parsed) {
                try {
                    $td0 = Invoke-TempestGet "$TempestBase/observations/device/$candId`?day_offset=0&token=$tokEsc"
                    $parsed = Parse-TodayObs -TodayObs $td0 -LocalDayStart $localDayStart -IsMetric $isMetric
                } catch {}
            }
            if ($parsed) {
                $deviceId = $candId
                $windPeakToday = $parsed.windPeakToday
                $solarPeakToday = $parsed.solarPeakToday
                $pressureChange3hr = $parsed.pressureChange3hr
                $precipRate = $parsed.precipRate
                break
            }
        }

        # Cached 6-day prior precipitation (2 local-time 3-day chunks, RainCheck-aware)
        if ($deviceId) {
            $cacheKey = "${deviceId}_${localDayStart}"
            $nowUtc = [DateTime]::UtcNow
            if ($SevenDayCache.ContainsKey($cacheKey) -and ($nowUtc - $SevenDayCache[$cacheKey].Time).TotalMinutes -lt 30) {
                $priorSixDaysMm = $SevenDayCache[$cacheKey].Mm
                $hasPriorSixDays = $true
            } else {
                try {
                    $start6d = $localDayStart - 6 * 86400
                    $mid3d = $localDayStart - 3 * 86400
                    $end1 = $mid3d - 1
                    $end2 = $localDayStart - 1
                    $payloads = @()
                    try { $p1 = Invoke-TempestGet "$TempestBase/observations/device/$deviceId`?time_start=$start6d&time_end=$end1&token=$tokEsc"; if ($p1) { $payloads += $p1 } } catch {}
                    try { $p2 = Invoke-TempestGet "$TempestBase/observations/device/$deviceId`?time_start=$mid3d&time_end=$end2&token=$tokEsc"; if ($p2) { $payloads += $p2 } } catch {}
                    $isComplete = ($payloads.Count -eq 2)
                    if ($payloads.Count -eq 0) {
                        for ($dOff = 1; $dOff -le 6; $dOff++) {
                            try { $fb = Invoke-TempestGet "$TempestBase/observations/device/$deviceId`?day_offset=$dOff&token=$tokEsc"; if ($fb) { $payloads += $fb } } catch {}
                        }
                        $isComplete = ($payloads.Count -ge 5)
                    }
                    $sumMm = Sum-PriorSixDaysPrecipMm -ObsPayloads $payloads -StartEpoch $start6d -EndEpoch $localDayStart -Timezone $tz -PrecipYesterdayMm $precipYestMm
                    if ($null -ne $sumMm) {
                        $priorSixDaysMm = [double]$sumMm
                        $hasPriorSixDays = $true
                        if ($isComplete) {
                            $SevenDayCache[$cacheKey] = @{ Time = $nowUtc; Mm = [double]$sumMm }
                        }
                    }
                } catch {}
            }
        }
    }

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
            summary = Build-NarrativeSummary -ForecastJson $forecastJson -Units $Units -Timezone $tz
            forecastBriefing = Build-WeathermanBriefing -ForecastJson $forecastJson -Units $Units -Timezone $tz
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
            lightningCount1hr = if ($null -ne $cc.lightning_strike_count_last_1hr) { [int]$cc.lightning_strike_count_last_1hr } elseif ($latestObs -and $null -ne $latestObs.lightning_strike_count_last_1hr) { [int]$latestObs.lightning_strike_count_last_1hr } else { 0 }
            lightningLastDistance = if ($null -ne $cc.lightning_strike_last_distance) { $cc.lightning_strike_last_distance } elseif ($latestObs -and $null -ne $latestObs.lightning_strike_last_distance) { if ($isMetric) { [double]$latestObs.lightning_strike_last_distance } else { [double]$latestObs.lightning_strike_last_distance * 0.621371 } } else { $null }
            lightningLastEpoch = if ($null -ne $cc.lightning_strike_last_epoch) { $cc.lightning_strike_last_epoch } elseif ($latestObs -and $null -ne $latestObs.lightning_strike_last_epoch) { $latestObs.lightning_strike_last_epoch } else { $null }
        }
        astronomy = @{
            sunriseEpoch = if ($todayFc) { $todayFc.sunrise } else { $null }
            sunsetEpoch = if ($todayFc) { $todayFc.sunset } else { $null }
        }
        tides = Get-MorroBayTides -Units $Units
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
                    $apVal = $null
                    if ($cfg.ContainsKey('TEMPEST_AVATAR_AUTOPLAY')) {
                        if ($cfg['TEMPEST_AVATAR_AUTOPLAY'] -eq 'false') { $apVal = $false }
                        elseif ($cfg['TEMPEST_AVATAR_AUTOPLAY'] -eq 'true') { $apVal = $true }
                    }
                    Send-Json -Response $res -Obj @{
                        hasServerToken = ($tok.Length -gt 0)
                        wsToken = $tok
                        stationId = $sid
                        avatarAutoplay = $apVal
                    }
                    continue
                } elseif ($req.HttpMethod -eq 'POST') {
                    $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
                    $bodyText = $reader.ReadToEnd()
                    $body = $bodyText | ConvertFrom-Json
                    $tok = if ($body.token) { ([string]$body.token).Trim() } else { '' }
                    $sid = if ($body.stationId) { ([string]$body.stationId).Trim() } else { '' }
                    $apStr = ''
                    if ($null -ne $body.avatarAutoplay) {
                        $apStr = if ([bool]$body.avatarAutoplay) { 'true' } else { 'false' }
                    }
                    Save-DotEnv -Token $tok -StationId $sid -ServerPort $Port -AvatarAutoplay $apStr
                    $cfg = Load-DotEnv
                    $finalTok = if ($cfg.ContainsKey('TEMPEST_API_TOKEN')) { $cfg['TEMPEST_API_TOKEN'] } else { '' }
                    $finalSid = if ($cfg.ContainsKey('TEMPEST_STATION_ID') -and $cfg['TEMPEST_STATION_ID']) { $cfg['TEMPEST_STATION_ID'] } else { '218212' }
                    $finalAp = $null
                    if ($cfg.ContainsKey('TEMPEST_AVATAR_AUTOPLAY')) {
                        if ($cfg['TEMPEST_AVATAR_AUTOPLAY'] -eq 'false') { $finalAp = $false }
                        elseif ($cfg['TEMPEST_AVATAR_AUTOPLAY'] -eq 'true') { $finalAp = $true }
                    }
                    Send-Json -Response $res -Obj @{
                        ok = $true
                        hasServerToken = ($finalTok.Length -gt 0)
                        stationId = $finalSid
                        avatarAutoplay = $finalAp
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
