# Runs WordleScoreBot outside any terminal: starts node, restarts it if it
# exits, and appends output to logs/bot.log.
#
# Registered as the "WordleScoreBot" scheduled task by install-bot-task.ps1,
# which starts it at boot and re-triggers it every five minutes so a launcher
# that was killed (rather than crashed) is replaced without anyone logging in.
# It also kills any stale copy of the bot first, so a restart never leaves two
# instances fighting over the store.

param(
  # The node executable to use. The installer passes the resolved path, because
  # a task running outside the interactive session does not inherit the PATH
  # that only that session was given.
  [string]$Node = ""
)

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

if (-not $Node) {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { $Node = $command.Source }
}

if (-not $Node -or -not (Test-Path $Node)) {
  "$(Get-Date -Format o) cannot find node; pass -Node or install Node.js" |
    Add-Content -Path $log -Encoding utf8
  exit 1
}

function Stop-StaleBots {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$bot*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

"$(Get-Date -Format o) run-bot: node $Node" | Add-Content -Path $log -Encoding utf8

while ($true) {
  Stop-StaleBots
  "$(Get-Date -Format o) starting bot" | Add-Content -Path $log -Encoding utf8
  & $Node $bot 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  "$(Get-Date -Format o) bot exited ($LASTEXITCODE); restarting in 10s" | Add-Content -Path $log -Encoding utf8
  Start-Sleep -Seconds 10
}
