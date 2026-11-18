# Runs WordleScoreBot outside any terminal: starts node, restarts it if it
# exits, and appends output to logs/bot.log.
#
# Registered as the "WordleScoreBot" scheduled task by install-bot-task.ps1,
# which runs this at logon. It also kills any stale copy of the bot first, so a
# restart never leaves two instances fighting over the store.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bot = Join-Path $root "dist\index.js"
Set-Location $root

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "bot.log"

# Keep the log bounded: one previous file is enough for debugging.
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) {
  Move-Item -Path $log -Destination "$log.1" -Force
}

function Stop-StaleBots {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$bot*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

while ($true) {
  Stop-StaleBots
  "$(Get-Date -Format o) starting bot" | Add-Content -Path $log -Encoding utf8
  & node $bot 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  "$(Get-Date -Format o) bot exited ($LASTEXITCODE); restarting in 10s" | Add-Content -Path $log -Encoding utf8
  Start-Sleep -Seconds 10
}
