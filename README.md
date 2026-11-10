# omp-desktop-notify

跨平台桌面通知插件，专为 **Oh My Pi (`omp`)** 设计。在模型发起提问（`ask` 工具）、请求权限审批（`tool_approval_requested`）或任务执行完成（`agent_end`）时自动发送系统桌面通知。

## 特性

- **支持多平台原生通知**：
  - **Windows 10 / 11**：原生 WinRT Toast 通知卡片，支持 Base64 安全转码与免外部依赖运行；失败时自动降级到系统托盘气泡通知。
  - **macOS**：原生 AppleScript 系统通知支持。
  - **Linux**：优先调用标准的 `notify-send` 桌面通知；若未安装或处于无桌面环境，自动回退到终端原生 OSC 777 转义通知。
- **全场景通知**：
  - **提问等待**：模型调用 `ask` 选项或向用户提问时，立刻弹出待办问题与提示。
  - **权限审批**：敏感工具（如 `bash` 等）请求用户授权时，及时提醒审批。
  - **任务结算**：当前轮次执行完成或异常报错时，提示会话就绪状态。
- **无感静默与去重**：
  - 仅对交互式前台会话弹窗，避免后台子代理与批处理产生弹窗干扰（设置环境变量 `OMP_NOTIFY_ALL=1` 可强制接收全部通知）。
  - 内置 `toolCallId` 窗口去重，杜绝生命周期事件重复弹窗。
  - 采用非阻塞异步后台子进程派发，不拖慢模型推理和输出速度。

## 安装

### 本地链接安装（推荐）

在插件所在目录运行：

```bash
omp plugin link ./omp-desktop-notify
```

或者在任意路径使用绝对路径链接：

```bash
omp plugin link /path/to/omp-desktop-notify
```

### 验证状态

```bash
omp plugin list
omp plugin doctor
```

## 常用管理命令

```bash
# 停用插件
omp plugin disable omp-desktop-notify

# 启用插件
omp plugin enable omp-desktop-notify

# 卸载插件
omp plugin uninstall omp-desktop-notify
```
