$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $scriptDir "launch_break_guard.vbs"
$taskName = "ExamPlanner Break Guard"

try {
  $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$launcher`"" -WorkingDirectory $scriptDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Break Guard tray timer; restart automatically after an unexpected exit." -Force | Out-Null
  $startupDir = [Environment]::GetFolderPath("Startup")
  $legacyShortcut = Join-Path $startupDir "ExamPlannerBreakGuard.lnk"
  if (Test-Path -LiteralPath $legacyShortcut) { Remove-Item -LiteralPath $legacyShortcut -Force }
  Write-Host "Installed restartable logon task: $taskName"
} catch {
  Write-Warning "Task Scheduler registration failed; using the Startup folder fallback. $($_.Exception.Message)"
  $startupDir = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupDir "ExamPlannerBreakGuard.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "wscript.exe"
  $shortcut.Arguments = "`"$launcher`""
  $shortcut.WorkingDirectory = $scriptDir
  $shortcut.IconLocation = Join-Path $scriptDir "app.ico"
  $shortcut.Save()
  Write-Host "Installed startup fallback: $shortcutPath"
}
