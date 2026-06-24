$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeBin = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$toolBin = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin"
$pnpm = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
$toolsDir = Join-Path $projectRoot "tools"
$cloudflared = Join-Path $toolsDir "cloudflared.exe"

$env:Path = "$nodeBin;$toolBin;$env:Path"
Set-Location $projectRoot

if (!(Test-Path $toolsDir)) {
  New-Item -ItemType Directory -Path $toolsDir | Out-Null
}

if (!(Test-Path $cloudflared)) {
  Write-Host "Downloading cloudflared..." -ForegroundColor Cyan
  Invoke-WebRequest `
    -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
    -OutFile $cloudflared
}

Write-Host "Building MTG Tabletop..." -ForegroundColor Cyan
& $pnpm build

Write-Host ""
Write-Host "Starting local server on http://127.0.0.1:8787 ..." -ForegroundColor Cyan
$serverJob = Start-Job -ScriptBlock {
  param($projectRoot, $nodeBin, $toolBin, $pnpm)
  $env:Path = "$nodeBin;$toolBin;$env:Path"
  Set-Location $projectRoot
  & $pnpm start
} -ArgumentList $projectRoot, $nodeBin, $toolBin, $pnpm

try {
  Start-Sleep -Seconds 2
  Write-Host ""
  Write-Host "Public tunnel is starting. Copy the https://*.trycloudflare.com URL below and send it to your friend." -ForegroundColor Green
  Write-Host "Keep this window open while playing. Press Ctrl+C to stop." -ForegroundColor Yellow
  Write-Host ""
  & $cloudflared tunnel --url http://127.0.0.1:8787
}
finally {
  Write-Host ""
  Write-Host "Stopping local server..." -ForegroundColor Yellow
  Stop-Job $serverJob -ErrorAction SilentlyContinue
  Remove-Job $serverJob -ErrorAction SilentlyContinue
}
