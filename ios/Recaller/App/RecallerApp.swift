import SwiftUI

@main
struct RecallerApp: App {
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Fonts.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(Theme.primary)
                .onAppear { if !store.ready { store.start() } }
        }
        .onChange(of: scenePhase) { _, phase in
            store.lifecycle(phase)
        }
    }
}
