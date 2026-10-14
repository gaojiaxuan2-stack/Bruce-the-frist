import SwiftUI
import SwiftData
import UserNotifications

@main
struct TimeleafApp: App {
    @State private var router = AppRouter()
    @State private var appLock = AppLock()

    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(for: TimeCapsule.self, CapsuleMedia.self)
        } catch {
            fatalError("Could not open the Timeleaf store: \(error)")
        }
        UNUserNotificationCenter.current().delegate = NotificationCenterDelegate.shared
    }

    var body: some Scene {
        WindowGroup {
            AppShell()
                .environment(router)
                .environment(appLock)
                .onAppear {
                    let router = router
                    NotificationCenterDelegate.shared.onOpenCapsule = { id in
                        router.selectedTab = .vault
                        router.presentedCapsuleID = id
                    }
                }
        }
        .modelContainer(container)
    }
}
