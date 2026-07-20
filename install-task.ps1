[CmdletBinding()]
param([int]$EveryHours = 6)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'lumix-finder.ps1'
$name = 'Lumix S1 II Finder'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -NoOpen"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours $EveryHours)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Sucht nach gebrauchten Panasonic Lumix S1 II Angeboten.' -Force | Out-Null
Write-Host "Zeitplan '$name' eingerichtet: alle $EveryHours Stunden." -ForegroundColor Green
