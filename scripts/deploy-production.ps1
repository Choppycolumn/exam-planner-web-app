param(
  [string]$HostName = "8.130.68.9",
  [string]$UserName = "root",
  [string]$Password = $env:EXAM_PLANNER_SSH_PASSWORD
)

$ErrorActionPreference = "Stop"
if (-not $Password) { throw "Set EXAM_PLANNER_SSH_PASSWORD or pass -Password." }
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path (Split-Path -Parent $root) ".codex-tools"
$plink = Join-Path $tools "plink.exe"
$pscp = Join-Path $tools "pscp.exe"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$package = Join-Path ([IO.Path]::GetTempPath()) "exam-planner-$stamp.tgz"
$remotePackage = "/tmp/exam-planner-$stamp.tgz"
$remoteScript = "/tmp/exam-planner-remote-deploy-$stamp.sh"
$hostKey = "SHA256:eSJBs+4ykcbdr6Mr36OB3ia486CDfyOGeY/ggSGp2v8"

Push-Location $root
try {
  $runtimeDependency = "node_modules/undici"
  if (-not (Test-Path (Join-Path $root $runtimeDependency))) {
    throw "Missing runtime dependency: $runtimeDependency. Run npm install before deployment."
  }
  tar -czf $package dist server public shared package.json package-lock.json docs scripts infra README.md $runtimeDependency
  & $pscp -batch -hostkey $hostKey -pw $Password $package "${UserName}@${HostName}:$remotePackage"
  if ($LASTEXITCODE -ne 0) { throw "Upload failed." }
  $remoteCommand = "tar -xOf '$remotePackage' scripts/remote-deploy.sh > '$remoteScript' && chmod 0700 '$remoteScript'; " +
    "status=1; if [ -x '$remoteScript' ]; then bash '$remoteScript' '$remotePackage'; status=`$?; fi; " +
    "rm -f '$remoteScript'; exit `$status"
  & $plink -batch -ssh -hostkey $hostKey -pw $Password "${UserName}@${HostName}" $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw "Remote deployment failed and rollback was attempted." }
} finally {
  Pop-Location
  Remove-Item -LiteralPath $package -Force -ErrorAction SilentlyContinue
}
