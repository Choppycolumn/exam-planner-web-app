param(
  [string]$HostName = "8.130.68.9",
  [string]$User = "root",
  [string]$RemoteDir = "/opt/exam-planner",
  [switch]$SkipBuild,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

function Run($File, [string[]]$Args) {
  Write-Host ">> $File $($Args -join ' ')"
  & $File @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $File $($Args -join ' ')"
  }
}

if (-not $SkipBuild) {
  Run "npm" @("run", "lint")
  Run "npm" @("test")
  Run "npm" @("run", "build")
}

$target = "$User@$HostName"

Run "ssh" @($target, "mkdir -p $RemoteDir/server/modules $RemoteDir/server/migrations $RemoteDir/public $RemoteDir/scripts")
Run "scp" @("-r", "dist", "${target}:$RemoteDir/")
Run "scp" @("package.json", "package-lock.json", "${target}:$RemoteDir/")
Run "scp" @("server/auth-static-server.mjs", "server/embedding_worker.py", "server/nginx-exam-planner.conf", "${target}:$RemoteDir/server/")
Run "scp" @("-r", "server/modules", "${target}:$RemoteDir/server/")
Run "scp" @("-r", "server/migrations", "${target}:$RemoteDir/server/")
Run "scp" @("-r", "public", "${target}:$RemoteDir/")

Run "ssh" @($target, "cd $RemoteDir && npm ci --omit=dev")

if (-not $SkipRestart) {
  Run "ssh" @($target, "systemctl restart exam-planner && sleep 1 && systemctl --no-pager --full status exam-planner")
  Run "ssh" @($target, "curl -fsS http://127.0.0.1:8080/health")
}

Write-Host "Deployment finished."
