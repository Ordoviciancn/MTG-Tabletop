$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeBin = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$toolBin = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin"
$pnpm = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"

$env:Path = "$nodeBin;$toolBin;$env:Path"
Set-Location $projectRoot
& $pnpm dev
