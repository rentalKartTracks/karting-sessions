import Foundation

/// Lithuanian public holidays. Fixed-date holidays plus Easter-derived ones
/// (Easter Sunday and Monday), computed with the Anonymous Gregorian algorithm.
///
/// This is a feature of the trip, not a legal reference — it only needs to be
/// good enough to let the model separate "the roads were quiet" days.
enum Holidays {
    static func isHoliday(_ date: Date, calendar: Calendar = .vilnius) -> Bool {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = c.year, let month = c.month, let day = c.day else { return false }

        // Fixed-date public holidays.
        let fixed: Set<[Int]> = [
            [1, 1],   // New Year's Day
            [2, 16],  // Restoration of the State
            [3, 11],  // Restoration of Independence
            [5, 1],   // Labour Day
            [6, 24],  // St John's Day (Rasos)
            [7, 6],   // Statehood Day
            [8, 15],  // Assumption
            [11, 1],  // All Saints' Day
            [11, 2],  // All Souls' Day
            [12, 24], // Christmas Eve
            [12, 25], // Christmas Day
            [12, 26], // Second day of Christmas
        ]
        if fixed.contains([month, day]) { return true }

        // Easter Sunday and Easter Monday.
        let easter = easterSunday(year: year, calendar: calendar)
        if let easter,
           let easterMonday = calendar.date(byAdding: .day, value: 1, to: easter) {
            for holiday in [easter, easterMonday] {
                let hc = calendar.dateComponents([.month, .day], from: holiday)
                if hc.month == month && hc.day == day { return true }
            }
        }
        return false
    }

    /// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
    private static func easterSunday(year: Int, calendar: Calendar) -> Date? {
        let a = year % 19
        let b = year / 100
        let c = year % 100
        let d = b / 4
        let e = b % 4
        let f = (b + 8) / 25
        let g = (b - f + 1) / 3
        let h = (19 * a + b - d - g + 15) % 30
        let i = c / 4
        let k = c % 4
        let l = (32 + 2 * e + 2 * i - h - k) % 7
        let m = (a + 11 * h + 22 * l) / 451
        let month = (h + l - 7 * m + 114) / 31
        let day = ((h + l - 7 * m + 114) % 31) + 1
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }
}

extension Calendar {
    /// Gregorian calendar anchored to Europe/Vilnius, so day-of-week and
    /// holiday boundaries match the rider's local day.
    static var vilnius: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Vilnius") ?? .current
        return cal
    }
}
