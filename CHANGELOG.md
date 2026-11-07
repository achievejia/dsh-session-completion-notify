# Changelog

## 1.3.0 — 2026-11-04

### Changed
- 通知图标归属改为自建 Swift 通知器：插件首次投递时自动编译 `DSH Notify.app`（UNUserNotificationCenter + DSH 图标/显示名，bundle id `com.deepseek.dsh.notifier`，LSUIElement 不驻 Dock）到 `~/.dsh/session-completion-notify/`，横幅显示 DeepSeek Harness 程序图标；首次运行触发一次系统授权弹窗。通知器构建/启动失败时回退 osascript（Script Editor 归属）。用户文本仍只经 argv 传递。

### Fixed
- 撤销 1.2.0 无效方案：`tell application id` 对 Electron app 不响应 Apple events，exit=0 系脚本内 on error 静默回退，横幅仍为 Script Editor 图标。

### Removed
- AppleScript applet（osacompile）路线：ad-hoc applet 在 macOS 26 从未注册通知中心，`display notification` 的 XPC 调用永久挂起（进程不退出、通知不投递）。

## 1.2.0 — 2026-11-04

### Changed
- 通知归属与图标：AppleScript 先以 `tell application id "com.deepseek.dsh"`（DeepSeek Harness）名义发送，横幅显示程序图标而非 Script Editor 卷轴图标；app 无法寻址时脚本内自动回退普通发送。bundle id 为脚本内常量，用户文本仍只经 argv 传递。

## 1.1.0 — 2026-11-04

### Added
- Codex 风格通知文案：标题=会话标题（sessionTitle.get），正文=本轮回复摘要；新增 showPreview / showSessionTitle 开关（默认开启）。

### Changed
- 摘要脱敏与截断：Markdown 修饰、链接/图片 URL、代码围栏、控制字符移除；凭据与本地路径替换占位符；标题 80 / 正文 120 码点截断。
- 摘要读取限定本轮（同 turn）assistant 文本，至多回探 256 个相邻事件位置；标题服务缺失或读取失败回退固定标题。

## 1.0.0 — 2026-11-03

### Added
- 每轮主会话正常响应结束后发送 macOS 系统通知，可关闭提示音或开启子代理通知。
- 不读取或展示对话正文；实时事件去重、历史过滤、进程超时与卸载清理。
- 中英文插件信息、原创通知图标及 Node 自动化测试。

### Limitations
- 仅 macOS；系统接受通知不代表横幅实际显示。macOS 权限和专注模式由用户管理。
- 通知不支持点击跳回会话；自动继续任务按轮次通知，不代表整个目标已完成。
