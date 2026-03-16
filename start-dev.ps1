#Requires -Version 7.0

[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "未找到命令：$Name。请确认已安装并加入 PATH。"
  }
}

Require-Command 'wt'
Require-Command 'pwsh'

$dbCmd = @"
try {
  Start-Service MongoDB -ErrorAction Stop
  Write-Host 'MongoDB 服务已启动。'
} catch {
  Write-Host ('MongoDB 启动失败：' + `$_.Exception.Message)
  Write-Host '提示：如需启动/停止 Windows 服务，请用“管理员”打开 Windows Terminal / PowerShell 再运行脚本。'
}
Get-Service MongoDB | Format-List Name,Status,StartType
"@

$redisCmd = @"
`$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath `$docker)) {
  `$docker = 'docker'
}

function Test-DockerEngine {
  try {
    & `$docker info *> `$null
    return (`$LASTEXITCODE -eq 0)
  } catch {
    return `$false
  }
}

function Start-DockerDesktop {
  # 尽力而为：不要求管理员权限；失败不阻断，交给后续等待逻辑兜底
  try {
    `$svc = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
    if (`$svc -and `$svc.Status -ne 'Running') {
      try {
        Start-Service -Name 'com.docker.service' -ErrorAction Stop
      } catch {
        # 可能缺少管理员权限，忽略
      }
    }
  } catch {
    # 忽略
  }

  `$dockerDesktopExe = Join-Path `$env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath `$dockerDesktopExe)) {
    `$dockerDesktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  }
  if (Test-Path -LiteralPath `$dockerDesktopExe) {
    try {
      Start-Process -FilePath `$dockerDesktopExe -ErrorAction SilentlyContinue | Out-Null
    } catch {
      # 忽略
    }
  }
}

function Wait-DockerEngine([int]`$TimeoutSeconds = 120, [int]`$IntervalSeconds = 2) {
  `$elapsed = 0
  while (`$elapsed -lt `$TimeoutSeconds) {
    if (Test-DockerEngine) {
      return
    }

    if (`$elapsed -eq 0) {
      Write-Host '检测到 Docker 引擎不可用，尝试拉起 Docker Desktop 并等待就绪...'
      Start-DockerDesktop
    }

    Start-Sleep -Seconds `$IntervalSeconds
    `$elapsed += `$IntervalSeconds

    if ((`$elapsed % 10) -eq 0) {
      Write-Host ("等待 Docker 引擎就绪... {0}/{1}s" -f `$elapsed, `$TimeoutSeconds)
    }
  }

  throw ("Docker 引擎在 {0}s 内仍不可用。请确认 Docker Desktop 已启动且 Engine running，然后重试。" -f `$TimeoutSeconds)
}

function Invoke-Docker {
  param([Parameter(ValueFromRemainingArguments = `$true)][string[]]`$Args)

  & `$docker @Args
  if (`$LASTEXITCODE -ne 0) {
    throw ("docker {0} 失败（ExitCode={1}）。" -f (`$Args -join ' '), `$LASTEXITCODE)
  }
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path '$root' 'docker\redis\compose.yml'))) {
    throw '未找到 docker\redis\compose.yml（请先拉取最新代码或按 RUNNING.md 创建 Redis compose）。'
  }

  if (-not (Test-DockerEngine)) {
    Wait-DockerEngine -TimeoutSeconds 120 -IntervalSeconds 2
  }

  Write-Host '启动 Redis：docker compose -f docker/redis/compose.yml up -d'
  Invoke-Docker compose -f docker/redis/compose.yml up -d

  Write-Host 'Redis 自检：redis-cli ping（期望输出：PONG）'
  Invoke-Docker exec lms-redis redis-cli ping

  Write-Host 'Redis 容器状态：'
  Invoke-Docker ps --filter name=lms-redis --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
} catch {
  Write-Host ('Redis 启动失败：' + `$_.Exception.Message)
  Write-Host '提示：若持续失败，请先手动打开 Docker Desktop 并等待左下角显示 Engine running，然后重试。'
}
"@

$backendCmd = @"
Write-Host '启动后端：pnpm -C backend dev'
pnpm.cmd -C backend dev
"@

$frontendCmd = @"
Write-Host '启动前端：pnpm -C vue-vben-admin dev:ele'
pnpm.cmd -C vue-vben-admin dev:ele
"@

$codexCmd = @"
if (-not (Get-Command 'codex' -ErrorAction SilentlyContinue)) {
  Write-Host '未找到命令：codex。请确认已安装并加入 PATH。'
} else {
  Write-Host '启动 codex：codex'
  codex
}
"@

$wtArgs = @(
  'new-tab', '--title', '数据库', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $dbCmd,
  ';',
  'new-tab', '--title', 'Redis', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $redisCmd,
  ';',
  'new-tab', '--title', '后端', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $backendCmd,
  ';',
  'new-tab', '--title', '前端', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $frontendCmd,
  ';',
  # codex：以 PowerShell 作为 tab 入口进程（外观与其它 tab 一致），在 Windows 环境直接启动 codex；codex 退出后保留 PowerShell
  'new-tab', '--title', 'codex', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $codexCmd
)

if ($DryRun) {
  Write-Host 'DryRun：不会真正启动 Windows Terminal。将执行：'
  $prettyArgs = $wtArgs | ForEach-Object {
    if ($_ -match '\s|;') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }
  Write-Host ('wt -w 0 ' + ($prettyArgs -join ' '))
  exit 0
}

& wt -w 0 @wtArgs
