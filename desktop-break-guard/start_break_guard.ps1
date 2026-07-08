$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $scriptDir "break_guard.py"
$pythonwCommand = Get-Command pythonw.exe -ErrorAction SilentlyContinue
$pythonw = if ($pythonwCommand) { $pythonwCommand.Source } else { $null }
if (-not $pythonw) {
  $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
  $pythonw = if ($pyCommand) { $pyCommand.Source } else { $null }
}
if (-not $pythonw) {
  throw "pythonw.exe or py.exe was not found. Please install Python 3 first."
}
if ((Split-Path -Leaf $pythonw) -ieq "py.exe") {
  Start-Process -WindowStyle Hidden -FilePath $pythonw -ArgumentList @("-3", $app)
} else {
  Start-Process -WindowStyle Hidden -FilePath $pythonw -ArgumentList @($app)
}
