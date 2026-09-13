import Foundation
import Observation

/// Cross-screen navigation intents that originate outside the view tree —
/// chiefly a tap on the post-trip tagger notification.
@MainActor
@Observable
final class AppRouter {
    enum Tab: Hashable { case trips, stats }

    var selectedTab: Tab = .trips
    /// When set, the UI presents the tagger for this trip and clears it.
    var pendingTaggerTripId: Int64?
}
