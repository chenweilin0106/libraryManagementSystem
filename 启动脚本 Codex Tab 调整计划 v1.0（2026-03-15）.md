# 启动脚本 Codex Tab 调整计划 v1.0（2026-03-15）

## 范围
- 仅调整一键启动脚本 `start-dev.ps1` 的 **codex** 这个 tab 的启动方式与外观一致性。
- 不改动后端/前端/数据库/Redis 的启动逻辑。

## 现状与问题
- 当前 `codex` tab 直接以 `wsl.exe ... bash ...` 作为 tab 入口进程启动：
  - 实际运行环境是 WSL（符合预期）；
  - 但 Windows Terminal 会按其规则套用默认 profile/字体设置，导致 `codex` tab 的字体/字号与 PowerShell tab 不一致（看起来“更小”），容易让人误以为环境不同。

## 目标
- `codex` tab 的外观（字体/字号）与 PowerShell tab 保持一致（对齐你手动在 PowerShell tab 里执行 `wsl -d ubuntu` 的体验）。
- 同时仍在 WSL 中启动 `codex`，并在 `codex` 退出后保留可交互的 WSL shell（便于继续操作）；退出 WSL 后返回 PowerShell。

## 方案与改动点（待确认后实施）
1. `codex` tab 改为以 `pwsh` 作为入口进程（而非直接 `wsl.exe`）：
   - `wt new-tab ... pwsh -NoExit -Command <codexCmd>`
2. `codexCmd` 内由 PowerShell 启动 WSL 并进入 bash：
   - `wsl.exe -d Ubuntu -- bash -ilc '(codex || true) && exec bash -il'`
3. 保持 `--startingDirectory $root`，确保启动后目录正确。
4. （可选）将 tab 标题改为 `wsl: codex` 以减少误解；默认保持 `codex` 也可。

## 验收点
- 运行 `.\start-dev.ps1`：
  - `codex` tab 的字体/字号与 PowerShell tab 一致；
  - 自动进入 WSL 并启动 `codex`；
  - `codex` 退出后仍停留在 WSL shell；
  - 退出 WSL shell 后回到 PowerShell（行为与手动 `wsl` 一致）。

## 冒烟记录（完成改动后补充）
- 命令：`.\start-dev.ps1 -DryRun`
- 命令：`.\start-dev.ps1`
- 结果：

## 冒烟记录（2026-03-15）
- 临时验证脚本：`.\test-codex-tab.ps1`（以 `pwsh` 作为 tab 入口，再进入 WSL 启动 codex）
- 结果：codex 可正常在 WSL 中启动，且 tab 外观与 PowerShell tab 保持一致；不再出现 `wt -l` 的参数报错弹窗。
