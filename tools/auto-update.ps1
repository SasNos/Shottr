<#
.SYNOPSIS
  Keeps this folder up to date with GitHub, so "Update" in chrome://extensions is all that is left to do.

.DESCRIPTION
  Chrome loads the extension from this folder. A scheduled task fast-forwards the folder from origin (git pull
  --ff-only) at logon and every 15 minutes; after that, clicking Update in chrome://extensions (Developer mode)
  loads the new version.

  .\tools\auto-update.ps1             pulls once, now
  .\tools\auto-update.ps1 -Install    registers the scheduled task for the current user (no admin rights needed)
  .\tools\auto-update.ps1 -Uninstall  removes the scheduled task

  Local changes are never touched: if the pull cannot fast-forward, nothing changes and the reason is logged.
  Log (only updates and failures): %LOCALAPPDATA%\Shottr\auto-update.log
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall
)

$TaskName = 'Shottr auto-update'
$Interval = New-TimeSpan -Minutes 15
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogFile = Join-Path $env:LOCALAPPDATA 'Shottr\auto-update.log'
$MaxLogBytes = 100KB

function Write-Log([string]$Message) {
  $folder = Split-Path -Parent $LogFile
  if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
  if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt $MaxLogBytes)) { Remove-Item $LogFile }
  Add-Content -Path $LogFile -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message)
}

# Fast-forwards the folder from origin. Returns $true when it succeeded (also when nothing was new).
function Update-Folder {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Log 'failed: git was not found in PATH'
    return $false
  }
  $env:GIT_TERMINAL_PROMPT = '0' # never wait for a password in the background
  $before = (git -C $Root rev-parse --short HEAD 2>&1) -join ' '
  $output = (git -C $Root pull --ff-only 2>&1) -join ' '
  if ($LASTEXITCODE -ne 0) {
    Write-Log "failed: $output"
    return $false
  }
  $after = (git -C $Root rev-parse --short HEAD 2>&1) -join ' '
  if ($before -ne $after) { Write-Log "updated $before -> $after" }
  return $true
}

function Install-Task {
  $script = $PSCommandPath
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $script)
  $user = '{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME
  $triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $user),
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval $Interval)
  )
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Principal $principal -Description 'Pulls the Shottr folder from GitHub.' -Force -ErrorAction Stop | Out-Null
  Write-Host "Task '$TaskName' registered: runs at logon and every $($Interval.TotalMinutes) minutes."
  if (Update-Folder) { Write-Host 'Folder is up to date. Click Update in chrome://extensions.' }
  else { Write-Host "Task registered, but the first update failed. See $LogFile" }
}

if ($Install) { Install-Task }
elseif ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Task '$TaskName' removed."
}
else {
  if (Update-Folder) { Write-Host 'Folder is up to date.' } else { Write-Host "Update failed. See $LogFile"; exit 1 }
}
