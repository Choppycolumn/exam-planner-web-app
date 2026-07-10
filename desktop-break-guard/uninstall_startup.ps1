$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "ExamPlannerBreakGuard.lnk"
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath
  Write-Host "Removed startup shortcut: $shortcutPath"
} else {
  Write-Host "Startup shortcut not found: $shortcutPath"
}
