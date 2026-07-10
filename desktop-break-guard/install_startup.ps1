$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $scriptDir "launch_break_guard.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "ExamPlannerBreakGuard.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$packagedApp = Join-Path $scriptDir "dist\BreakGuard.exe"
$shortcut.TargetPath = if (Test-Path $packagedApp) { $packagedApp } else { "wscript.exe" }
$shortcut.Arguments = if (Test-Path $packagedApp) { "" } else { "`"$launcher`"" }
$shortcut.WorkingDirectory = $scriptDir
$iconPath = Join-Path $scriptDir "app.ico"
$shortcut.IconLocation = if (Test-Path $iconPath) { $iconPath } else { "powershell.exe,0" }
$shortcut.Save()
Write-Host "Installed startup shortcut: $shortcutPath"
