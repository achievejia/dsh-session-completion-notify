# 会话完成通知 / Session Completion Notifications

DSH Host 插件，版本 1.3.0。项目采用 GNU Affero General Public License v3.0（见 `LICENSE`）。主会话的一轮回复正常结束后，向本机 macOS 提交通知并播放提示音。通知标题为会话标题（如 `1103 | 发布 | 服务部署`），正文为本轮回复的摘要（Codex 风格）；两者均经脱敏与截断。没有客户端页面、外部网络请求或模型调用。

## 行为与验收

- 触发依据：实时提交的 `session/event`，且 `type=turn/end`、`data.reason.kind=completed`；不是工具执行完成、流式文本停止或会话被关闭。
- 默认仅主会话；跳过带 `parentSession`、`origin=subagent` 或正数 `delegationDepth` 的会话。
- 取消、错误、被阻塞、截断、fork、中断不冒充成功。
- 同一 Session 对象的事件按序号去重，并在异步提交前记录水位，防止并发重复。
- 标题经 `sessionTitle.get()` 读取当前会话标题；标题服务缺失或读取失败回退固定标题 `DSH · 响应完成`。
- 正文摘要取本轮（同 turn）最后一条带文本的 assistant 消息：跳过纯 tool-call、被 `interrupted` 的输出与 reasoning 块；只回探至多 256 个相邻事件位置，不调用全量历史方法；找不到时回退固定文案。
- 摘要脱敏：移除 Markdown 修饰/链接 URL/图片/代码围栏/控制字符，凭据（api key/token/password/Bearer/JWT/sk-/ghp_ 等）与本机路径替换为占位符；标题按码点截断 80 字、正文 120 字（带省略号）。
- 不回扫历史、不保存会话数据；`showPreview=false`/`showSessionTitle=false` 时完全不读对应数据源。
- 网页关闭不影响 Host 通知；DSH 退出、机器睡眠或关机时不工作，恢复后不补发历史通知。
- 不判断页面是否在前台，也不判断长任务总目标是否完成；每个 completed 轮次都会通知，自动继续目标可产生多次通知。
- 最多同时 8 个通知进程；超出容量的事件跳过并记录警告，不排队重试；每次系统调用最长 5 秒。卸载插件取消正在提交的通知，但不能撤回系统已接收的通知。

## 系统限制

仅支持 **macOS**。通知由插件首次投递时自动构建的轻量通知器（`~/.dsh/session-completion-notify/DSH Notify.app`）发送：Swift 编写的 `UNUserNotificationCenter` 客户端，携带 DeepSeek Harness 的图标与显示名（bundle id `com.deepseek.dsh.notifier`），横幅因此显示 DSH 程序图标。首次投递会触发一次系统授权弹窗（允许后不再询问）。通知器无法构建/启动（缺 swiftc、构建失败）时回退 `/usr/bin/osascript` 普通发送（图标显示 Script Editor）。标题与正文仅经 argv 传递，绝不拼入脚本源码或 shell。

需要有已登录的 macOS 图形桌面会话；SSH/headless Host 不承诺显示。此插件采用 best-effort / at-most-once 提交语义，发送失败只记录警告，不自动重试，也不保证 exactly-once 送达。系统接受请求不代表已经显示：macOS 通知权限、专注模式、通知样式和声音设置都可静默压制。
若未看到通知，请在 **系统设置 → 通知 → DeepSeek Harness**（通知器条目）检查允许通知/横幅，并检查专注模式；本插件不会修改系统权限。
其他平台会记录不支持警告，不承诺降级到浏览器通知。

## 配置

Bundle 插入 `session-completion-notify` 行。配置定义在 `cordis.patch.yml`：

```yaml
enabled: true             # 完成通知总开关
sound: true               # 系统 Glass 提示音
includeSubagents: false   # 为 true 时包括子代理与队友，可能大量提醒
showPreview: true         # 正文=本轮回复摘要（脱敏+截断）；false 用固定文案
showSessionTitle: true    # 标题=会话标题；false 用固定标题
```

通过 DSH 插件管理器可停用/卸载 `dsh-session-completion-notify`。若修改 bundle patch，需按 DSH 的正式安装/重载流程重新应用；不要手写 profile 安装状态。

## 安装与开发

从源码开发时，可使用 DSH `plugin_manager install_bundle` 安装本地绝对目录，影响当前 profile 的所有会话并跨重启保留。发布包可直接通过 GitHub 安装：

```sh
dsh plugin --profile <profile> add github:achievejia/dsh-session-completion-notify
```
仅依赖宿主同系列 `@deepseek-ai/schemastery` 来公开 Config Schema。发布包不会携带本机绝对路径或本地依赖软链；从源码开发时需在插件目录安装宿主同系列依赖。

```sh
npm test
npm run check
```

测试使用 Node 自带 `node:test`，覆盖终态过滤、主/子会话、实时边界、并发去重、生命周期、异常隔离和参数注入安全；不需要付费模型。系统通知烟测与真实通知显示是两个不同验收层次。
原创 SVG 为铃铛+对勾，随包提供中英文插件元数据。未改 DSH 源码、会话标题插件或任何其他插件。
