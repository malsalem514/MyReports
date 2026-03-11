$ErrorActionPreference = "Stop"

$dockerBin = "C:\Program Files\Docker\Docker\resources\bin"
$dockerCli = Join-Path $dockerBin "docker.exe"
$dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$logDir = "C:\myreports\logs"
$logFile = Join-Path $logDir "ensure-docker-and-app.log"

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$timestamp] $Message"
}

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$env:PATH = "$dockerBin;$env:PATH"

Write-Log "Bootstrap start"

if (-not (Test-Path $dockerCli)) {
  Write-Log "docker.exe not found at $dockerCli"
  exit 1
}

if (Test-Path $dockerDesktopExe) {
  Write-Log "Launching Docker Desktop"
  Start-Process -FilePath $dockerDesktopExe | Out-Null
} else {
  Write-Log "Docker Desktop executable not found at $dockerDesktopExe"
}

try {
  & $dockerCli desktop start | Out-Null
  Write-Log "docker desktop start invoked"
} catch {
  Write-Log "docker desktop start returned: $($_.Exception.Message)"
}

$deadline = (Get-Date).AddMinutes(5)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    & $dockerCli context use desktop-linux | Out-Null
    & $dockerCli info | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
  } catch {
    Write-Log "Docker engine not ready yet: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 5
}

if (-not $ready) {
  Write-Log "Docker engine failed to become ready within timeout"
  exit 1
}

Write-Log "Docker engine ready"

foreach ($container in @("myreports", "nginx-ssl", "watchtower")) {
  try {
    $exists = (& $dockerCli ps -a --format '{{.Names}}') -contains $container
    if ($exists) {
      & $dockerCli update --restart unless-stopped $container | Out-Null
      & $dockerCli start $container | Out-Null
      Write-Log "Ensured container '$container' is running"
    }
  } catch {
    Write-Log "Failed to ensure container '$container': $($_.Exception.Message)"
  }
}

try {
  $watchtowerExists = (& $dockerCli ps -a --format '{{.Names}}') -contains "watchtower"
  if (-not $watchtowerExists) {
    & $dockerCli run -d --name watchtower --restart unless-stopped -e DOCKER_API_VERSION=1.44 -v /var/run/docker.sock:/var/run/docker.sock -v C:/Users/malsalem/.docker/config.json:/config.json:ro containrrr/watchtower --interval 300 --cleanup myreports | Out-Null
    Write-Log "Created watchtower container"
  }
} catch {
  Write-Log "Failed to create watchtower container: $($_.Exception.Message)"
}

Write-Log "Bootstrap complete"
