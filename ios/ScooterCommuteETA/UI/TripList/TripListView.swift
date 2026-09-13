import SwiftUI

struct TripListView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var model: TripListModel?
    @State private var showExportSheet = false
    @State private var exportURL: URL?
    @State private var exporting = false

    var body: some View {
        List {
            LiveTripSection()

            if let model, model.isLoaded, model.trips.isEmpty {
                ContentUnavailableView(
                    "No trips yet",
                    systemImage: "bicycle",
                    description: Text("Ride your commute, or tap Start to log one manually.")
                )
            } else if let model {
                Section("History") {
                    ForEach(model.trips) { trip in
                        NavigationLink(value: trip.id) {
                            TripRow(trip: trip)
                        }
                    }
                }
            }
        }
        .navigationTitle("Trips")
        .navigationDestination(for: Int64.self) { id in
            TripDetailView(tripId: id)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await runExport() }
                } label: {
                    if exporting { ProgressView() } else { Image(systemName: "square.and.arrow.up") }
                }
                .disabled(exporting)
            }
        }
        .sheet(isPresented: $showExportSheet) {
            if let exportURL {
                ShareSheet(items: [exportURL])
            }
        }
        .task {
            if model == nil { model = TripListModel(repository: env.repository) }
            await model?.observe()
        }
    }

    private func runExport() async {
        exporting = true
        defer { exporting = false }
        let exporter = DataExporter(repository: env.repository)
        do {
            exportURL = try await exporter.exportToFile()
            showExportSheet = true
        } catch {
            exportURL = nil
        }
    }
}

/// Shows recording status and the manual start/stop override.
private struct LiveTripSection: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        let coordinator = env.coordinator
        Section {
            HStack {
                Circle()
                    .fill(statusColor(coordinator.phase))
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading) {
                    Text(statusText(coordinator.phase)).font(.headline)
                    if coordinator.phase != .idle {
                        Text(Format.distance(coordinator.liveDistanceM))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if coordinator.phase == .idle {
                    Button("Start") { coordinator.startManualTrip() }
                        .buttonStyle(.borderedProminent)
                } else {
                    Button("Stop") { coordinator.stopManualTrip() }
                        .buttonStyle(.bordered)
                        .tint(.red)
                }
            }
        }
    }

    private func statusColor(_ phase: RideCoordinator.Phase) -> Color {
        switch phase {
        case .idle: return .secondary
        case .arming: return .orange
        case .recording: return .green
        }
    }

    private func statusText(_ phase: RideCoordinator.Phase) -> String {
        switch phase {
        case .idle: return "Not riding"
        case .arming: return "Detecting…"
        case .recording: return "Recording ride"
        }
    }
}

struct TripRow: View {
    let trip: Trip

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: WeatherGlyph.symbol(for: trip.weatherSnapshot?.weatherCode))
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(Format.date.string(from: trip.startedAt)).font(.subheadline.bold())
                HStack(spacing: 8) {
                    Text(Format.minutes(trip.duration))
                    Text("·")
                    Text(Format.distance(trip.distanceM))
                    if trip.isDark {
                        Image(systemName: "moon.stars.fill")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if let tag = trip.tag, tag != .normal {
                Text(tag == .stopped || tag == .detour ? "excluded" : tag.rawValue)
                    .font(.caption2)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(trip.excluded ? Color.red.opacity(0.15) : Color.blue.opacity(0.15))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}

/// UIKit share sheet wrapper for exporting the JSON dump.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

#Preview {
    NavigationStack { TripListView() }
        .environment(AppEnvironment.preview())
}
