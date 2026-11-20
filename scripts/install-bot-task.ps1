# Registers (or updates) the "WordleScoreBot" scheduled task so the bot runs
# outside any terminal: at boot, at logon, and again every five minutes, so a
# launcher that dies without the runner's own loop noticing comes back on its
# own instead of waiting for the next sign-in.
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

# Resolve node here and hand the absolute path to the runner, so the task never
# depends on a PATH that exists only inside an interactive session.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "Cannot find node.exe on PATH."
}

if (-not (Test-Path $runner)) {
  throw "Cannot find $runner"
}

$action = New-ScheduledTaskAction `
  -Execute $shell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Node `"$node`"" `
  -WorkingDirectory $root

# Every five minutes, forever. Paired with MultipleInstances IgnoreNew this is
# a no-op while the runner is alive, and a relaunch within five minutes when it
# is not; the runner's own loop still covers a node crash in between.
# No -RepetitionDuration: an omitted duration is what Task Scheduler writes as
# <Repetition> with an interval only, i.e. repeat forever. ([TimeSpan]::MaxValue
# is rejected at registration: "value incorrectly formatted or out of range".)
# StopAtDurationEnd must be false, though New-ScheduledTaskTrigger defaults it to
# true: with no duration, true means a zero-length pattern, which Task Scheduler
# silently drops ("Repeat: Every: N/A", no next run) instead of running it.
function New-RetriggeringPattern {
  $pattern = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
  $pattern.StopAtDurationEnd = $false
  return $pattern
}

$startup = New-ScheduledTaskTrigger -AtStartup
$startup.Repetition = New-RetriggeringPattern

$logon = New-ScheduledTaskTrigger -AtLogOn -User $account
$logon.Repetition = New-RetriggeringPattern

# A one-shot trigger carrying the same pattern. Boot and logon triggers give the
# bot an immediate start; this one is the watchdog, and because it has a real
# start boundary it is the trigger whose next run Task Scheduler can schedule
# and report (StartWhenAvailable catches the boundary it misses after downtime).
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$watchdog.Repetition = New-RetriggeringPattern

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

# S4U: the task runs whether Micah is signed in or not, and is not a child of
# the interactive session, so signing out cannot take the bot down with it.
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Limited

# Re-registering needs the old instance gone, and it needs a moment to actually
# exit before the new registration takes over the name.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -ne "Ready") {
  Stop-ScheduledTask -TaskName $taskName
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-ScheduledTask -TaskName $taskName).State -ne "Ready" -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
}

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $startup, $logon, $watchdog `
  -Settings $settings `
  -Principal $principal `
  -Description "Runs the Wordle points Discord bot at boot and logon, outside the interactive session, and re-triggers every 5 minutes so it cannot stay down." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Registered and started '$taskName'."
Write-Host "Logs: $root\logs\bot.log"
