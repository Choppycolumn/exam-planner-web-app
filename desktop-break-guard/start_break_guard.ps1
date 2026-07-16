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
  try {
    Start-Process -FilePath $packagedApp -WorkingDirectory $scriptDir -WindowStyle Hidden -ErrorAction Stop
    exit 0
  } catch {
    # Smart App Control can reject an unsigned local build. The signed Python
    # runtime provides the same tray application without weakening Windows policy.
  }
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
$arguments = if ($leaf -ieq "py.exe" -or $leaf -ieq "pyw.exe") {
  "-3 `"$app`""
} else {
  "`"$app`""
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $pythonw
$startInfo.Arguments = $arguments
$startInfo.WorkingDirectory = $scriptDir
$startInfo.UseShellExecute = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
[System.Diagnostics.Process]::Start($startInfo) | Out-Null
