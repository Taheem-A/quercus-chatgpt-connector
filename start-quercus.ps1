$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js was not found. Install Node.js 20 or newer, then run this script again." -ForegroundColor Red
    Write-Host "https://nodejs.org/"
    Read-Host "Press Enter to close"
    exit 1
}

$major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 20) {
    Write-Host "Node.js 20 or newer is required. Current version: $(node --version)" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Starting Quercus Local..." -ForegroundColor Cyan
node server.mjs
