import XCTest
@testable import ScooterCommuteETA

final class CalendarTests: XCTestCase {
    private let cal = Calendar.vilnius

    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!
    }

    func testFixedHolidays() {
        XCTAssertTrue(Holidays.isHoliday(date(2025, 2, 16), calendar: cal))  // Restoration
        XCTAssertTrue(Holidays.isHoliday(date(2025, 12, 25), calendar: cal)) // Christmas
        XCTAssertFalse(Holidays.isHoliday(date(2025, 3, 12), calendar: cal)) // ordinary day
    }

    func testEaster2025() {
        // Easter Sunday 2025 is 20 April; Monday 21 April is also a holiday.
        XCTAssertTrue(Holidays.isHoliday(date(2025, 4, 20), calendar: cal))
        XCTAssertTrue(Holidays.isHoliday(date(2025, 4, 21), calendar: cal))
        XCTAssertFalse(Holidays.isHoliday(date(2025, 4, 22), calendar: cal))
    }

    func testDarkInWinterEvening() {
        // 08:00 in mid-December in Vilnius: sun not yet up.
        let winterMorning = cal.date(from: DateComponents(year: 2025, month: 12, day: 15, hour: 8))!
        XCTAssertTrue(SolarCalculator.isDark(at: winterMorning, coordinate: SolarCalculator.vilnius))
    }

    func testDaylightInSummerMidday() {
        let summerNoon = cal.date(from: DateComponents(year: 2025, month: 6, day: 21, hour: 12))!
        XCTAssertFalse(SolarCalculator.isDark(at: summerNoon, coordinate: SolarCalculator.vilnius))
    }
}
