$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $scriptDir "break_guard.py"
$packagedApp = Join-Path $scriptDir "dist\BreakGuard.exe"
if (Test-Path $packagedApp) {
  $signature = Get-AuthenticodeSignature -FilePath $packagedApp
  $canRunPackagedApp = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
} else {
  $canRunPackagedApp = $false
}
if ($canRunPackagedApp) {
  & $packagedApp
  exit $LASTEXITCODE
}
$pythonwCommand = Get-Command pythonw.exe -ErrorAction SilentlyContinue
$pythonw = if ($pythonwCommand) { $pythonwCommand.Source } else { $null }
if (-not $pythonw) {
  $pywCommand = Get-Command pyw.exe -ErrorAction SilentlyContinue
  $pythonw = if ($pywCommand) { $pywCommand.Source } else { $null }
}
if (-not $pythonw) {
  $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
  $pythonw = if ($pyCommand) { $pyCommand.Source } else { $null }
}
if (-not $pythonw) {
  throw "pythonw.exe, pyw.exe or py.exe was not found. Please install Python 3 first."
}

$leaf = Split-Path -Leaf $pythonw
Push-Location $scriptDir
try {
  if ($leaf -ieq "py.exe" -or $leaf -ieq "pyw.exe") {
    & $pythonw -3 $app
  } else {
    & $pythonw $app
  }
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
