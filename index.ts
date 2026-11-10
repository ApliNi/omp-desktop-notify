import { spawn } from "node:child_process";
import { platform } from "node:os";

interface ExtensionContext {
  hasUI?: boolean;
  [key: string]: unknown;
}

interface AssistantMessage {
  role?: string;
  stopReason?: string;
  [key: string]: unknown;
}

interface AgentEndEvent {
  messages?: AssistantMessage[];
  [key: string]: unknown;
}

interface AskQuestionItem {
  id?: string;
  header?: string;
  question?: string;
  [key: string]: unknown;
}

interface AskPayload {
  questions?: AskQuestionItem[];
  question?: string;
  prompt?: string;
  message?: string;
  [key: string]: unknown;
}

interface ToolCallEvent {
  type?: string;
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  args?: unknown;
  [key: string]: unknown;
}

interface ToolApprovalEvent {
  type?: string;
  toolName: string;
  toolCallId?: string;
  reason?: string;
  approvalMode?: string;
  [key: string]: unknown;
}

interface ExtensionAPI {
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => void | Promise<void>): void;
  on(event: "tool_execution_start", handler: (event: ToolCallEvent, ctx: ExtensionContext) => void | Promise<void>): void;
  on(event: "tool_approval_requested", handler: (event: ToolApprovalEvent, ctx: ExtensionContext) => void | Promise<void>): void;
  on(event: "agent_end", handler: (event: AgentEndEvent, ctx: ExtensionContext) => void | Promise<void>): void;
  getSessionName?(): string;
  [key: string]: unknown;
}

/**
 * 转义 XML 关键特殊字符，保障 Windows Toast 模板加载解析成功
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 文本压缩与长度截断，适合桌面弹窗呈现
 */
function formatMessagePreview(text: string, maxLength = 260): string {
  const normalized = text.replace(/[\r\n]+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

/**
 * 解析 ask 工具入参中的具体问题文本
 */
function extractAskQuestion(rawInput: unknown): string {
  let payload: AskPayload | undefined;

  if (typeof rawInput === "string") {
    try {
      payload = JSON.parse(rawInput) as AskPayload;
    } catch {
      return formatMessagePreview(rawInput);
    }
  } else if (rawInput && typeof rawInput === "object") {
    payload = rawInput as AskPayload;
  }

  if (payload) {
    if (Array.isArray(payload.questions) && payload.questions.length > 0) {
      const first = payload.questions[0];
      if (first) {
        const text = first.question || first.header;
        if (text) {
          return formatMessagePreview(text);
        }
      }
    }
    const fallbackText = payload.question || payload.prompt || payload.message;
    if (typeof fallbackText === "string" && fallbackText.trim().length > 0) {
      return formatMessagePreview(fallbackText);
    }
  }

  return "等待您的选择或回复...";
}

/**
 * 跨平台桌面通知派发（原生免安装第三方外部依赖）
 */
export function sendDesktopNotification(title: string, message: string): void {
  const os = platform();
  const cleanTitle = title.replace(/[\r\n]+/g, " ").trim();
  const cleanBody = formatMessagePreview(message);

  if (os === "win32") {
    // Windows: 优先 WinRT Toast 原生卡片通知，失败自动降级到 NotifyIcon 气泡
    const xmlTitle = escapeXml(cleanTitle);
    const xmlBody = escapeXml(cleanBody);
    const psSafeTitle = xmlTitle.replace(/'/g, "''");
    const psSafeBody = xmlBody.replace(/'/g, "''");
    const psRawTitle = cleanTitle.replace(/'/g, "''");
    const psRawBody = cleanBody.replace(/'/g, "''");

    const psScript = `
$ErrorActionPreference = 'Stop'
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $template = '<toast><visual><binding template="ToastGeneric"><text>${psSafeTitle}</text><text>${psSafeBody}</text></binding></visual></toast>'
  $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
  $xml.LoadXml($template)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = '${psRawTitle}'
    $notify.BalloonTipText = '${psRawBody}'
    $notify.Visible = $true
    $notify.ShowBalloonTip(10000)
  } catch {}
}
`;

    try {
      const encodedCommand = Buffer.from(psScript, "utf16le").toString("base64");
      // 注意：在 Windows 上勿使用 detached: true，否则子进程会以 DETACHED_PROCESS 脱离控制台启动，导致 WinRT Toast 通知被系统静默抛弃
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    } catch {}
  } else if (os === "darwin") {
    // macOS: 调用原生 AppleScript 发送系统通知
    const safeTitle = cleanTitle.replace(/["\\]/g, "\\$&");
    const safeBody = cleanBody.replace(/["\\]/g, "\\$&");
    const appleScript = `display notification "${safeBody}" with title "${safeTitle}"`;

    try {
      const child = spawn("osascript", ["-e", appleScript], {
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  } else if (os === "linux") {
    // Linux: 优先 notify-send，不可用时降级 OSC 777 终端通知
    try {
      const child = spawn("notify-send", ["-a", "omp", cleanTitle, cleanBody], {
        stdio: "ignore",
      });
      child.on("error", () => {
        try {
          process.stdout.write(`\x1b]777;notify;${cleanTitle};${cleanBody}\x07`);
        } catch {}
      });
      child.unref();
    } catch {
      try {
        process.stdout.write(`\x1b]777;notify;${cleanTitle};${cleanBody}\x07`);
      } catch {}
    }
  }
}

export default function desktopNotify(pi: ExtensionAPI): void {
  // 用于记录近期已通知的 toolCallId，防止同一次工具调用被多重生命周期事件重复通知
  const notifiedCallIds = new Set<string>();

  const recordNotifiedCall = (callId?: string): boolean => {
    if (!callId) return false;
    if (notifiedCallIds.has(callId)) return true;
    notifiedCallIds.add(callId);
    if (notifiedCallIds.size > 200) {
      const oldest = notifiedCallIds.values().next().value;
      if (oldest) notifiedCallIds.delete(oldest);
    }
    return false;
  };

  const handleToolCall = (event: ToolCallEvent, ctx?: ExtensionContext): void => {
    if (ctx?.hasUI === false && process.env.OMP_NOTIFY_ALL !== "1") return;
    if (event.toolName !== "ask") return;

    if (event.toolCallId && recordNotifiedCall(event.toolCallId)) {
      return;
    }

    const question = extractAskQuestion(event.input ?? event.args);
    sendDesktopNotification("omp · 等待输入", question);
  };

  // 1. 监听提问工具 (ask)，兼容 tool_call 与 tool_execution_start 扩展事件
  pi.on("tool_call", handleToolCall);
  pi.on("tool_execution_start", handleToolCall);

  // 2. 监听工具权限审批请求 (如 bash/命令执行需要用户确认时)
  pi.on("tool_approval_requested", (event: ToolApprovalEvent, ctx?: ExtensionContext) => {
    if (ctx?.hasUI === false && process.env.OMP_NOTIFY_ALL !== "1") return;

    if (event.toolCallId && recordNotifiedCall(event.toolCallId)) {
      return;
    }

    const reason = event.reason || `工具 [${event.toolName}] 请求执行授权`;
    sendDesktopNotification("omp · 权限审批", reason);
  });

  // 3. 监听任务完成 (当前轮次执行结束或中断时触发)
  pi.on("agent_end", (event: AgentEndEvent, ctx: ExtensionContext) => {
    // 仅在前台交互式 UI 会话发送通知，避免后台任务和子代理频繁弹窗
    if (ctx?.hasUI === false && process.env.OMP_NOTIFY_ALL !== "1") return;

    const messages = Array.isArray(event.messages) ? event.messages : [];
    const lastAssistant = messages.findLast((m): m is AssistantMessage => m?.role === "assistant");
    if (lastAssistant?.stopReason === "aborted") return;

    const isError = lastAssistant?.stopReason === "error";
    const title = isError ? "omp · 执行异常" : "omp · 任务完成";
    const sessionName = pi.getSessionName?.() || "会话";

    sendDesktopNotification(title, `会话 [${sessionName}] 已就绪`);
  });
}
