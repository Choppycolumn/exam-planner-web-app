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
  $artifact = Join-Path $scriptDir "dist\BreakGuard.exe"
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant()
  $signature = Get-AuthenticodeSignature -FilePath $artifact
  $manifest = [ordered]@{
    product = "Break Guard"
    version = "1.0.0"
    builtAt = (Get-Date).ToUniversalTime().ToString("o")
    sha256 = $hash
    signatureStatus = [string]$signature.Status
    python = [string](python --version 2>&1)
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $scriptDir "dist\build-manifest.json") -Encoding utf8
  Write-Host "Built BreakGuard.exe SHA256=$hash signature=$($signature.Status)"
} finally {
  Pop-Location
}
