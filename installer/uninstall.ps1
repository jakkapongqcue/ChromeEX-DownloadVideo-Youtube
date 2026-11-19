#Requires -Version 5.1
<#
.SYNOPSIS
  ถอนการลงทะเบียน Native Messaging Host ออกจาก Windows Registry
#>

$RegKeys = @(
  "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytdl.host",
  "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.ytdl.host",
  "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ytdl.host"
)

foreach ($RegKey in $RegKeys) {
  & reg.exe query $RegKey >$null 2>&1
  if ($LASTEXITCODE -eq 0) {
    & reg.exe delete $RegKey /f >$null 2>&1
    Write-Host "ลบ Registry: $RegKey เรียบร้อยแล้ว" -ForegroundColor Green
  }
}

Write-Host "ถอนการลงทะเบียน Native Host เสร็จสมบูรณ์" -ForegroundColor Cyan
