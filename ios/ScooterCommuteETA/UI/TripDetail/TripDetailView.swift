import Charts
import CoreLocation
import MapKit
import SwiftUI

struct TripDetailView: View {
    @Environment(AppEnvironment.self) private var env
    let tripId: Int64
    @State private var model: TripDetailModel?

    var body: some View {
        ScrollView {
            if let model, let trip = model.trip {
                VStack(alignment: .leading, spacing: 20) {
                    RouteMap(coordinates: model.coordinates)
                        .frame(height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    SummaryGrid(trip: trip)

                    if !model.speedSeries.isEmpty {
                        ChartCard(title: "Speed") {
                            SpeedChart(series: model.speedSeries)
                        }
                    }
                    if !model.elevationSeries.isEmpty {
                        ChartCard(title: "Elevation (barometric)") {
                            ElevationChart(series: model.elevationSeries)
                        }
                    }

                    TaggerInline(trip: trip)

                    DebugFooter(trip: trip)
                }
                .padding()
            } else if let model, model.loaded {
                ContentUnavailableView("Trip not found", systemImage: "questionmark")
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .navigationTitle("Trip")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model == nil {
                model = TripDetailModel(repository: env.repository, tripId: tripId)
            }
            await model?.load()
        }
    }
}

private struct RouteMap: View {
    let coordinates: [CLLocationCoordinate2D]

    var body: some View {
        Map(initialPosition: .region(region)) {
            if let first = coordinates.first {
                Marker("Start", coordinate: first).tint(.green)
            }
            if coordinates.count > 1, let last = coordinates.last {
                Marker("End", coordinate: last).tint(.red)
            }
            if coordinates.count > 1 {
                MapPolyline(coordinates: coordinates)
                    .stroke(.blue, lineWidth: 4)
            }
        }
    }

    private var region: MKCoordinateRegion {
        guard !coordinates.isEmpty else {
            return MKCoordinateRegion(
                center: SolarCalculator.vilnius,
                span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
            )
        }
        let lats = coordinates.map(\.latitude)
        let lons = coordinates.map(\.longitude)
        let minLat = lats.min()!, maxLat = lats.max()!
        let minLon = lons.min()!, maxLon = lons.max()!
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLat + maxLat) / 2,
                longitude: (minLon + maxLon) / 2
            ),
            span: MKCoordinateSpan(
                latitudeDelta: max((maxLat - minLat) * 1.4, 0.005),
                longitudeDelta: max((maxLon - minLon) * 1.4, 0.005)
            )
        )
    }
}

private struct SummaryGrid: View {
    let trip: Trip

    private var columns: [GridItem] {
        [GridItem(.flexible()), GridItem(.flexible())]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            Stat(label: "Duration", value: Format.duration(trip.duration))
            Stat(label: "Distance", value: Format.distance(trip.distanceM))
            Stat(label: "Moving", value: Format.duration(trip.movingTimeS))
            Stat(label: "Stopped", value: Format.duration(trip.stoppedTimeS))
            if let gain = trip.elevationGainM {
                Stat(label: "Climb", value: String(format: "%.0f m", gain))
            }
            if let temp = trip.weatherSnapshot?.temperature2m {
                Stat(label: "Temp", value: String(format: "%.0f°C", temp))
            }
            if let head = trip.headwindComponentMS {
                Stat(label: "Headwind", value: String(format: "%+.1f m/s", head))
            }
            Stat(label: "Light", value: trip.isDark ? "Dark" : "Daylight")
        }
    }

    struct Stat: View {
        let label: String
        let value: String
        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.headline)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

private struct ChartCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content.frame(height: 160)
        }
    }
}

private struct SpeedChart: View {
    let series: [(t: Double, v: Double)]
    var body: some View {
        Chart {
            ForEach(Array(series.enumerated()), id: \.offset) { _, point in
                LineMark(
                    x: .value("Time (s)", point.t),
                    y: .value("km/h", point.v)
                )
                .interpolationMethod(.monotone)
            }
        }
        .chartYAxisLabel("km/h")
    }
}

private struct ElevationChart: View {
    let series: [(t: Double, v: Double)]
    var body: some View {
        Chart {
            ForEach(Array(series.enumerated()), id: \.offset) { _, point in
                AreaMark(
                    x: .value("Time (s)", point.t),
                    y: .value("m", point.v)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(.green.opacity(0.3))
            }
        }
        .chartYAxisLabel("m")
    }
}

/// The tagger, inline on the detail screen (same choices as the notification).
private struct TaggerInline: View {
    @Environment(AppEnvironment.self) private var env
    let trip: Trip

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Anything unusual?").font(.headline)
            TagPicker(current: trip.tag) { tag in
                if let id = trip.id {
                    Task { try? await env.repository.setTag(tag, forTripId: id) }
                }
            }
        }
    }
}

private struct DebugFooter: View {
    let trip: Trip
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Detection").font(.caption.bold()).foregroundStyle(.secondary)
            Text("Start: \(trip.startTrigger.rawValue) · End: \(trip.endTrigger?.rawValue ?? "—")")
                .font(.caption2).foregroundStyle(.secondary)
            if trip.weatherMissing {
                Text("Weather unavailable at departure")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview {
    NavigationStack { TripDetailView(tripId: 1) }
        .environment(AppEnvironment.preview())
}
