# Registers (or updates) the "WordleScoreBot" scheduled task so the bot runs at
# logon, outside any terminal, and restarts itself if it crashes.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-bot-task.ps1
#
# Remove it again with:
#
#   Unregister-ScheduledTask -TaskName "WordleScoreBot" -Confirm:$false

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$taskName = "WordleScoreBot"
$runner = Join-Path $root "scripts\run-bot.ps1"
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# PowerShell 7 writes UTF-8 logs; Windows PowerShell would write UTF-16.
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $shell) {
  $shell = (Get-Command powershell).Source
}

if (-not (Test-Path $runner)) {
  throw "Cannot find $runner"
}

$action = New-ScheduledTaskAction `
  -Execute $shell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Runs the Wordle points Discord bot at logon and keeps it running." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Registered and started '$taskName'."
Write-Host "Logs: $root\logs\bot.log"
