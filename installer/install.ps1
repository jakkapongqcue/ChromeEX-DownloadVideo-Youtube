#Requires -Version 5.1
<#
.SYNOPSIS
  สคริปต์ติดตั้ง Native Messaging Host พร้อมดาวน์โหลดและตรวจสอบค่า SHA-256 ของ yt-dlp.exe และ ffmpeg.exe
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NativeHostDir = Join-Path $ProjectRoot "native-host"
$BinDir = Join-Path $NativeHostDir "bin"
$ManifestPath = Join-Path $NativeHostDir "com.ytdl.host.json"
$HostBatPath = Join-Path $NativeHostDir "host.bat"
$ExtId = "odglcnnipefendfpdekkfikfllnolonf"

Write-Host "=== 1. เตรียมโฟลเดอร์ native-host\bin ===" -ForegroundColor Cyan
if (-not (Test-Path $BinDir)) {
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

# 1. ดาวน์โหลด yt-dlp.exe พร้อมตรวจสอบค่า SHA-256 จาก SHA2-256SUMS ทางการ
$YtdlpPath = Join-Path $BinDir "yt-dlp.exe"
if (-not (Test-Path $YtdlpPath)) {
  Write-Host "=== 2. กำลังดาวน์โหลด yt-dlp.exe และไฟล์ตรวจสอบ SHA2-256SUMS ===" -ForegroundColor Cyan
  $YtdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  $SumsUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"
  $SumsFile = Join-Path $BinDir "SHA2-256SUMS"

  Invoke-WebRequest -Uri $SumsUrl -OutFile $SumsFile -UseBasicParsing
  Invoke-WebRequest -Uri $YtdlpUrl -OutFile $YtdlpPath -UseBasicParsing

  $ExpectedLine = Get-Content $SumsFile | Where-Object { $_ -match "\syt-dlp\.exe$" } | Select-Object -First 1
  if (-not $ExpectedLine) {
    Remove-Item $YtdlpPath -Force -ErrorAction SilentlyContinue
    throw "ไม่พบค่า SHA-256 ของ yt-dlp.exe ในไฟล์ SHA2-256SUMS"
  }

  $ExpectedHash = ($ExpectedLine -split "\s+")[0].Trim().ToLower()
  $ActualHash = (Get-FileHash -Path $YtdlpPath -Algorithm SHA256).Hash.ToLower()

  if ($ExpectedHash -ne $ActualHash) {
    Remove-Item $YtdlpPath -Force -ErrorAction SilentlyContinue
    throw "ค่า SHA-256 ของ yt-dlp.exe ไม่ตรงกัน! Expected: $ExpectedHash, Actual: $ActualHash"
  }

  Remove-Item $SumsFile -Force -ErrorAction SilentlyContinue
  Write-Host "   [OK] ตรวจสอบ SHA-256 ของ yt-dlp.exe ถูกต้อง ($ActualHash)" -ForegroundColor Green
} else {
  Write-Host "=== 2. พบ yt-dlp.exe อยู่แล้ว ข้ามการดาวน์โหลด ===" -ForegroundColor Green
}

# 2. ดาวน์โหลด ffmpeg.exe จาก yt-dlp/FFmpeg-Builds พร้อมตรวจสอบ SHA-256 จาก GitHub API
$FfmpegPath = Join-Path $BinDir "ffmpeg.exe"
if (-not (Test-Path $FfmpegPath)) {
  Write-Host "=== 3. กำลังดาวน์โหลด ffmpeg.exe (yt-dlp/FFmpeg-Builds) ===" -ForegroundColor Cyan
  $ReleaseApi = "https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest"
  $ReleaseData = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ "User-Agent" = "ChromeEX-YouTube-Installer" }

  $Asset = $ReleaseData.assets | Where-Object { $_.name -eq "ffmpeg-master-latest-win64-gpl.zip" } | Select-Object -First 1
  $ChecksumsAsset = $ReleaseData.assets | Where-Object { $_.name -eq "checksums.sha256" } | Select-Object -First 1

  if (-not $Asset) {
    throw "ไม่พบแพ็กเกจ ffmpeg-master-latest-win64-gpl.zip ใน GitHub Release"
  }

  $ZipPath = Join-Path $BinDir "ffmpeg.zip"
  Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $ZipPath -UseBasicParsing

  if ($ChecksumsAsset) {
    $ChecksumsPath = Join-Path $BinDir "ffmpeg.sha256"
    Invoke-WebRequest -Uri $ChecksumsAsset.browser_download_url -OutFile $ChecksumsPath -UseBasicParsing
    $FfmpegLine = Get-Content $ChecksumsPath | Where-Object { $_ -match "ffmpeg-master-latest-win64-gpl\.zip" } | Select-Object -First 1
    if ($FfmpegLine) {
      $ExpFfmpegHash = ($FfmpegLine -split "\s+")[0].Trim().ToLower()
      $ActFfmpegHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
      if ($ExpFfmpegHash -ne $ActFfmpegHash) {
        Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
        throw "ค่า SHA-256 ของ ffmpeg.zip ไม่ตรงกัน!"
      }
      Write-Host "   [OK] ตรวจสอบ SHA-256 ของ ffmpeg.zip ถูกต้อง ($ActFfmpegHash)" -ForegroundColor Green
    }
    Remove-Item $ChecksumsPath -Force -ErrorAction SilentlyContinue
  } elseif ($Asset.digest -and $Asset.digest -match "^sha256:(.+)$") {
    $ExpFfmpegHash = $Matches[1].ToLower()
    $ActFfmpegHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
    if ($ExpFfmpegHash -ne $ActFfmpegHash) {
      Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
      throw "ค่า SHA-256 ของ ffmpeg.zip ไม่ตรงกับ GitHub Release Asset digest!"
    }
    Write-Host "   [OK] ตรวจสอบ SHA-256 ของ ffmpeg.zip ถูกต้อง ($ActFfmpegHash)" -ForegroundColor Green
  }

  $ExtractDir = Join-Path $BinDir "ffmpeg_extract"
  if (Test-Path $ExtractDir) { Remove-Item $ExtractDir -Recurse -Force }
  Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

  $ExtractedFfmpeg = Get-ChildItem -Path $ExtractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
  $ExtractedFfprobe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

  if (-not $ExtractedFfmpeg) {
    throw "ไม่พบ ffmpeg.exe ในไฟล์ zip ที่แตกออกมา"
  }

  Move-Item -Path $ExtractedFfmpeg.FullName -Destination $FfmpegPath -Force
  if ($ExtractedFfprobe) {
    Move-Item -Path $ExtractedFfprobe.FullName -Destination (Join-Path $BinDir "ffprobe.exe") -Force
  }

  Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
  Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "   [OK] ติดตั้ง ffmpeg.exe เรียบร้อย" -ForegroundColor Green
} else {
  Write-Host "=== 3. พบ ffmpeg.exe อยู่แล้ว ข้ามการดาวน์โหลด ===" -ForegroundColor Green
}

# 3. อัปเดต path ใน com.ytdl.host.json ให้ตรงกับโฟลเดอร์ปัจจุบัน
Write-Host "=== 4. ตั้งค่า Native Messaging Manifest และ Registry ===" -ForegroundColor Cyan
$ManifestObj = [ordered]@{
  name = "com.ytdl.host"
  description = "Private Hardened Native Messaging Host for YouTube Video Downloader"
  path = $HostBatPath
  type = "stdio"
  allowed_origins = @(
    "chrome-extension://$ExtId/"
  )
}
$ManifestJson = $ManifestObj | ConvertTo-Json -Depth 4
Set-Content -Path $ManifestPath -Value $ManifestJson -Encoding UTF8

# ลงทะเบียนใน HKCU สำหรับ Google Chrome และ Microsoft Edge / Brave (เผื่อใช้ Chromium ตัวอื่น)
$RegPaths = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ytdl.host",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.ytdl.host",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ytdl.host"
)

foreach ($RegPath in $RegPaths) {
  $ParentKey = Split-Path -Parent $RegPath
  if (-not (Test-Path $ParentKey)) {
    New-Item -Path $ParentKey -Force | Out-Null
  }
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }
  Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ManifestPath
}

Write-Host "   [OK] ลงทะเบียน Registry เรียบร้อยแล้ว" -ForegroundColor Green
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "ติดตั้งสำเร็จ! ขั้นตอนการเปิดใช้งานใน Chrome:" -ForegroundColor Green
Write-Host "1. เปิด Chrome ไปที่ chrome://extensions"
Write-Host "2. เปิดสวิตช์ 'โหมดนักพัฒนาซอฟต์แวร์' (Developer mode) มุมขวาบน"
Write-Host "3. กด 'โหลดส่วนขยายที่ยังไม่ได้แพ็ก' (Load unpacked)"
Write-Host "4. เลือกโฟลเดอร์: $(Join-Path $ProjectRoot 'extension')"
Write-Host "   (Extension ID ถูกล็อกไว้ที่: $ExtId)"
Write-Host "==========================================================" -ForegroundColor Cyan
