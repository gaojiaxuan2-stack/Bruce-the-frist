import SwiftUI
import SwiftData

@main
struct UnhookApp: App {
    @State private var router = AppRouter.shared
    @State private var store = Store.shared

    init() {
        NotificationManager.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(router)
                .environment(store)
                .task { store.start() }
        }
        .modelContainer(AppModelContainer.shared)
    }
}
