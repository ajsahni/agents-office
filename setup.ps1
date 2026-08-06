# Command Centre — one-command setup (Windows, PowerShell). Safe to re-run any time.
# Run from the repo folder:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Stop'

function Ok($msg)   { Write-Host "[ok] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host ""; Write-Host $msg -ForegroundColor White }

Set-Location -Path $PSScriptRoot

Step "1/5 Checking the basics"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git is missing. Install from https://git-scm.com/download/win then re-run setup.ps1" }
Ok "git"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js is missing. Install Node 20+ from https://nodejs.org then re-run setup.ps1" }
$nodeMajor = [int](node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 20) { Fail "Node 20+ required (you have $(node --version)). Upgrade, then re-run setup.ps1" }
Ok "Node $(node --version)"

Step "2/5 Claude Code"
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Claude Code..."
  try { Invoke-RestMethod -Uri https://claude.ai/install.ps1 | Invoke-Expression }
  catch { Fail "Claude Code install failed - install it from https://claude.com/claude-code then re-run setup.ps1" }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail "claude is not on your PATH - open a NEW terminal and re-run setup.ps1" }
Ok "Claude Code $(claude --version 2>$null | Select-Object -First 1)"
Write-Host "  Agents run on YOUR Claude login (Pro/Max) - no API key."
Write-Host "  Not logged in yet? Run 'claude' once, follow the browser login, type exit, then re-run setup.ps1."

Step "3/5 Dependencies"
npm install --no-fund --no-audit | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "npm install failed - run 'npm install' by hand to see why" }
Ok "npm packages"

Step "4/5 Your office"
foreach ($d in 'office\agents','office\inbox','office\state','office\logs','office\brain') {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Ok "office\ folders (agents - inbox - state - logs - brain)"
if (-not (Test-Path 'office.config.json')) {
  Copy-Item 'office.config.example.json' 'office.config.json'
  Ok "office.config.json created from the example - EDIT IT: name your departments and agents"
} else {
  Ok "office.config.json already exists - leaving it alone"
}

Step "5/5 First boot check"
$port = node -e "try{console.log(JSON.parse(require('fs').readFileSync('office.config.json','utf8')).port??4477)}catch{console.log(4477)}"
$boot = Start-Process node -ArgumentList 'bin/office','start' -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput 'office\logs\setup-boot.log' -RedirectStandardError 'office\logs\setup-boot.err.log'
$up = $false
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-RestMethod -Uri "http://localhost:$port/api/office" -TimeoutSec 2 | Out-Null; $up = $true; break } catch {}
}
Stop-Process -Id $boot.Id -Force -ErrorAction SilentlyContinue
if (-not $up) { Fail "The daemon didn't come up - check office\logs\setup-boot.log" }
Ok "Daemon boots clean on port $port"

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "  1. Edit office.config.json - your departments, your agents (max 6 depts, 4 agents each)."
Write-Host "  2. Start the office:   node bin/office start"
Write-Host "  3. Open it:            http://localhost:$port"
Write-Host "  4. Hire your first agent from any vacant desk - or: node bin/office new-agent"
