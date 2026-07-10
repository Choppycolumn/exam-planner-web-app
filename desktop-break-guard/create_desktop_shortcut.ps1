$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $scriptDir "launch_break_guard.vbs"
$desktopDir = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopDir "Break Guard.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$packagedApp = Join-Path $scriptDir "dist\BreakGuard.exe"
$shortcut.TargetPath = if (Test-Path $packagedApp) { $packagedApp } else { "wscript.exe" }
$shortcut.Arguments = if (Test-Path $packagedApp) { "" } else { "`"$launcher`"" }
$shortcut.WorkingDirectory = $scriptDir
$iconPath = Join-Path $scriptDir "app.ico"
$shortcut.IconLocation = if (Test-Path $iconPath) { $iconPath } else { "powershell.exe,0" }
$shortcut.Save()
Write-Host "Created desktop shortcut: $shortcutPath"
