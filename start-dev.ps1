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

$backendCmd = @"
Write-Host '启动后端：pnpm -C backend dev'
pnpm.cmd -C backend dev
"@

$frontendCmd = @"
Write-Host '启动前端：pnpm -C vue-vben-admin dev:ele'
pnpm.cmd -C vue-vben-admin dev:ele
"@

$codexCmd = @"
Write-Host '启动 codex'
codex
"@

$wtArgs = @(
  'new-tab', '--title', '数据库', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $dbCmd,
  ';',
  'new-tab', '--title', '后端', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $backendCmd,
  ';',
  'new-tab', '--title', '前端', '--startingDirectory', $root, 'pwsh', '-NoExit', '-Command', $frontendCmd,
  ';',
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
