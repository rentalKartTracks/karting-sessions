import Foundation
import OSLog
import UserNotifications

/// Local notifications for the post-trip outlier tagger. No remote push, no
/// tokens — everything is scheduled on-device.
struct TripNotifications: Sendable {
    static let taggerCategory = "TRIP_TAGGER"
    static let tripIdKey = "trip_id"
    private static let log = Logger(subsystem: "ScooterCommuteETA", category: "notify")

    /// Register the tagger category. Call once at launch.
    static func registerCategories() {
        let category = UNNotificationCategory(
            identifier: taggerCategory,
            actions: [],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    @discardableResult
    static func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound])
        } catch {
            log.warning("Notification auth failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    /// "20 min ride logged. Anything unusual?" — tapping opens the tagger for
    /// this trip. Fires immediately (the trip just ended).
    static func promptForTag(tripId: Int64, durationMinutes: Int) async {
        let content = UNMutableNotificationContent()
        content.title = "\(durationMinutes) min ride logged"
        content.body = "Anything unusual?"
        content.categoryIdentifier = taggerCategory
        content.userInfo = [tripIdKey: tripId]
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "tagger-\(tripId)",
            content: content,
            trigger: nil // deliver now
        )
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            log.warning("Failed to schedule tagger prompt: \(error.localizedDescription, privacy: .public)")
        }
    }
}
