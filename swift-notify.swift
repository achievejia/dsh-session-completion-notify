// DSH session-completion notifier: posts one macOS user notification via
// UNUserNotificationCenter and exits. Bundled into ~/.dsh/session-completion-notify/
// with DeepSeek Harness's icon and display name so the banner shows the app icon.
// Usage: dsh-notify TITLE BODY [SOUND(true|false)]
import Foundation
import UserNotifications

let args = CommandLine.arguments
guard args.count >= 3 else { fputs("dsh-notify: TITLE BODY [SOUND]\n", stderr); exit(64) }
let title = args[1]
let body = args[2]
let playSound = args.count > 3 && args[3] == "true"

let center = UNUserNotificationCenter.current()
let sem = DispatchSemaphore(value: 0)
var exitCode: Int32 = 0

center.requestAuthorization(options: [.alert, .sound]) { granted, error in
    if let error {
        fputs("dsh-notify: authorization error: \(error.localizedDescription)\n", stderr)
        exitCode = 70
        sem.signal()
        return
    }
    guard granted else {
        fputs("dsh-notify: notification authorization denied\n", stderr)
        exitCode = 69
        sem.signal()
        return
    }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    if playSound { content.sound = .default }
    let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    center.add(request) { addError in
        if let addError {
            fputs("dsh-notify: post error: \(addError.localizedDescription)\n", stderr)
            exitCode = 70
        }
        sem.signal()
    }
}
// Authorization + delivery must finish inside the budget or we exit nonzero.
if sem.wait(timeout: .now() + 7) == .timedOut { exitCode = 68 }
exit(exitCode)
