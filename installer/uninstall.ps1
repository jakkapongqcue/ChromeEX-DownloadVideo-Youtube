#Requires -Version 5.1
<#
.SYNOPSIS
  ถอนการลงทะเบียน Native Messaging Host ออกจาก Windows Registry
#>

$RegPaths = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ytdl.host",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.ytdl.host",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ytdl.host"
)

foreach ($RegPath in $RegPaths) {
  if (Test-Path $RegPath) {
    Remove-Item -Path $RegPath -Recurse -Force
    Write-Host "ลบ Registry: $RegPath เรียบร้อยแล้ว" -ForegroundColor Green
  }
}

Write-Host "ถอนการลงทะเบียน Native Host เสร็จสมบูรณ์" -ForegroundColor Cyan
