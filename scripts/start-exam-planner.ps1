$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Url = "http://127.0.0.1:5173/"
$OutLog = Join-Path $ProjectRoot "exam-planner-dev.out.log"
$ErrLog = Join-Path $ProjectRoot "exam-planner-dev.err.log"

function Test-AppReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  npm install
}

if (-not (Test-AppReady)) {
  Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run", "dev", "--", "--host", "127.0.0.1" `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    if (Test-AppReady) { break }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $Url
