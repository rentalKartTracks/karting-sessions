import Foundation
import Observation

/// Composition root. Builds and owns the single instances of the database,
/// repository, services, and coordinator for the whole app. Marked
/// `@Observable` only so it can be injected with SwiftUI's `.environment(_:)`;
/// its own stored references never change — the observable child objects
/// (`router`, `coordinator`, `settings`) drive UI updates.
@MainActor
@Observable
final class AppEnvironment {
    let database: AppDatabase
    let repository: TripRepository
    let settings: AppSettings
    let location: LocationService
    let motion: MotionService
    let coordinator: RideCoordinator
    let router: AppRouter

    init(database: AppDatabase = .makeShared()) {
        self.database = database
        self.repository = TripRepository(database: database)
        self.settings = AppSettings()
        self.location = LocationService()
        self.motion = MotionService()
        self.router = AppRouter()
        self.coordinator = RideCoordinator(
            repository: repository,
            settings: settings,
            location: location,
            motion: motion
        )
    }

    /// Start listening for trips if the user has finished setup. Safe to call
    /// on every launch, including background launches from region monitoring.
    func startIfReady() {
        guard settings.isConfigured, settings.hasCompletedOnboarding else { return }
        coordinator.begin()
        Task { try? await repository.pruneRawData() }
    }

    /// Preview / test environment backed by an in-memory database.
    static func preview() -> AppEnvironment {
        AppEnvironment(database: .makeInMemory())
    }
}
