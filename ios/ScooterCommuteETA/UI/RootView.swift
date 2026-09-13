import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if env.settings.hasCompletedOnboarding && env.settings.isConfigured {
                MainTabView()
            } else {
                OnboardingView()
            }
        }
        .sheet(item: taggerBinding) { item in
            NavigationStack {
                TripTaggerView(tripId: item.id)
            }
            .presentationDetents([.medium])
        }
    }

    /// Bridges the router's optional trip id to a `sheet(item:)`.
    private var taggerBinding: Binding<TaggerItem?> {
        Binding(
            get: { env.router.pendingTaggerTripId.map(TaggerItem.init) },
            set: { newValue in env.router.pendingTaggerTripId = newValue?.id }
        )
    }
}

private struct TaggerItem: Identifiable {
    let id: Int64
}

struct MainTabView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        @Bindable var router = env.router
        TabView(selection: $router.selectedTab) {
            NavigationStack {
                TripListView()
            }
            .tabItem { Label("Trips", systemImage: "bicycle") }
            .tag(AppRouter.Tab.trips)

            NavigationStack {
                StatsView()
            }
            .tabItem { Label("Stats", systemImage: "chart.bar") }
            .tag(AppRouter.Tab.stats)
        }
    }
}
