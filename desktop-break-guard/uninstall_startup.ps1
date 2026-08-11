$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "ExamPlannerBreakGuard.lnk"
Unregister-ScheduledTask -TaskName "ExamPlanner Break Guard" -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath
  Write-Host "Removed startup shortcut: $shortcutPath"
} else {
  Write-Host "Startup shortcut not found: $shortcutPath"
}
