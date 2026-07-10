$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir
try {
  python -m pip install -r requirements.txt -r requirements-build.txt
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE" }
  python -m unittest discover -s tests -v
  if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }
  python -m PyInstaller --noconfirm --clean BreakGuard.spec
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
