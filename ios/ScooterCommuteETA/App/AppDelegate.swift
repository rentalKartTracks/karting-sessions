import Foundation
import UIKit
import UserNotifications

/// Owns app-launch wiring. Using a delegate (rather than only the SwiftUI
/// lifecycle) matters because iOS can relaunch us in the background on a
/// geofence crossing with no UI — the coordinator must be built and listening
/// before any window exists.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Built once at launch and handed to the SwiftUI tree.
    let environment = AppEnvironment()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        TripNotifications.registerCategories()
        environment.startIfReady()
        return true
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Show the tagger prompt even when the app is in the foreground.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// Tapping the "anything unusual?" prompt routes to the tagger.
    ///
    /// These callbacks arrive on a private queue, not the main actor, so we
    /// capture only the `Sendable` trip id, hop to the main actor to update the
    /// router, and acknowledge the system on the delegate queue.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let tripId = userInfo[TripNotifications.tripIdKey] as? Int64
            ?? (userInfo[TripNotifications.tripIdKey] as? NSNumber)?.int64Value
        if let tripId {
            Task { @MainActor in
                environment.router.pendingTaggerTripId = tripId
                environment.router.selectedTab = .trips
            }
        }
        completionHandler()
    }
}
