import CoreLocation
import MapKit
import SwiftUI

/// Four-step setup: explain, set home, set work, grant permissions one at a
/// time. Calendar access is intentionally *not* requested here — that is a
/// Phase 3 feature and is asked for lazily when it is first needed.
struct OnboardingView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var step: Step = .intro

    enum Step: Int, CaseIterable { case intro, home, work, permissions }

    var body: some View {
        NavigationStack {
            VStack {
                switch step {
                case .intro:
                    IntroStep { advance() }
                case .home:
                    EndpointStep(
                        title: "Where is home?",
                        subtitle: "Drop the pin on your usual departure point. A 150 m zone around it starts and ends trips automatically.",
                        initialCoordinate: env.settings.home ?? SolarCalculator.vilnius
                    ) { coord in
                        env.settings.home = coord
                        advance()
                    }
                case .work:
                    EndpointStep(
                        title: "Where is work?",
                        subtitle: "The other end of your commute.",
                        initialCoordinate: env.settings.work ?? SolarCalculator.vilnius
                    ) { coord in
                        env.settings.work = coord
                        advance()
                    }
                case .permissions:
                    PermissionsStep { finish() }
                }
            }
            .navigationTitle("Set up")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func advance() {
        withAnimation {
            if let next = Step(rawValue: step.rawValue + 1) { step = next }
        }
    }

    private func finish() {
        env.settings.hasCompletedOnboarding = true
        env.startIfReady()
    }
}

private struct IntroStep: View {
    let onContinue: () -> Void
    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "bicycle")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("Scooter Commute ETA")
                .font(.title.bold())
            Text("This app quietly logs your scooter commute so it can learn how long it really takes. Nothing leaves your phone except a rough weather lookup. Let's set your two endpoints and permissions.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            Spacer()
            Button("Get started", action: onContinue)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding()
    }
}

/// A draggable map pin for picking an endpoint. Defaults to the current
/// location if available.
private struct EndpointStep: View {
    let title: String
    let subtitle: String
    let initialCoordinate: CLLocationCoordinate2D
    let onConfirm: (CLLocationCoordinate2D) -> Void

    @State private var position: MapCameraPosition
    @State private var center: CLLocationCoordinate2D

    init(
        title: String,
        subtitle: String,
        initialCoordinate: CLLocationCoordinate2D,
        onConfirm: @escaping (CLLocationCoordinate2D) -> Void
    ) {
        self.title = title
        self.subtitle = subtitle
        self.initialCoordinate = initialCoordinate
        self.onConfirm = onConfirm
        _center = State(initialValue: initialCoordinate)
        _position = State(initialValue: .region(MKCoordinateRegion(
            center: initialCoordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        )))
    }

    var body: some View {
        VStack(spacing: 12) {
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            ZStack {
                Map(position: $position)
                    .onMapCameraChange { context in
                        center = context.region.center
                    }
                // The pin stays fixed at screen center; the map moves under it.
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(.red)
                    .shadow(radius: 2)
                    .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal)

            Button(title.hasPrefix("Where is home") ? "Set home here" : "Set work here") {
                onConfirm(center)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.bottom)
        }
        .navigationTitle(title)
    }
}

/// Requests permissions one at a time with a short explanation for each.
private struct PermissionsStep: View {
    @Environment(AppEnvironment.self) private var env
    let onDone: () -> Void

    var body: some View {
        List {
            Section {
                Text("Grant these in order. Location must be set to \u{201C}Always\u{201D} so trips can start without opening the app.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            PermissionRow(
                icon: "location.fill",
                title: "Location — While Using",
                detail: "Records your route while a trip is live.",
                action: { env.location.requestWhenInUse() }
            )
            PermissionRow(
                icon: "location.circle.fill",
                title: "Location — Always",
                detail: "Lets a trip start automatically when you leave home or work.",
                action: { env.location.requestAlways() }
            )
            PermissionRow(
                icon: "figure.walk.motion",
                title: "Motion & Fitness",
                detail: "Distinguishes riding from standing still.",
                action: { env.motion.primePermission() }
            )
            PermissionRow(
                icon: "bell.fill",
                title: "Notifications",
                detail: "Asks \u{201C}anything unusual?\u{201D} after each ride.",
                action: { Task { await TripNotifications.requestAuthorization() } }
            )
            Section {
                Button("Finish setup", action: onDone)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct PermissionRow: View {
    let icon: String
    let title: String
    let detail: String
    let action: () -> Void
    @State private var tapped = false

    var body: some View {
        Button {
            action()
            tapped = true
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .foregroundStyle(.tint)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if tapped {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    OnboardingView()
        .environment(AppEnvironment.preview())
}
