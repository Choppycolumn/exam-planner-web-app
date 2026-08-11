param(
  [string]$HostName = "8.130.68.9",
  [string]$User = "root",
  [string]$Password = $env:EXAM_PLANNER_SSH_PASSWORD,
  [switch]$SkipBuild,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
if ($SkipRestart) { throw "The legacy in-place deployment mode was removed. Safe releases always verify and activate atomically." }
$safeDeploy = Join-Path $PSScriptRoot "deploy-production.ps1"
& $safeDeploy -HostName $HostName -UserName $User -Password $Password -SkipValidation:$SkipBuild
if ($LASTEXITCODE -ne 0) { throw "Safe production deployment failed." }
