//! Calendar dates as days since 1970, on the `time` crate's range of years -9999 to 9999.

use time::{Date, Month, OffsetDateTime};

pub(crate) const MS_PER_DAY: i64 = 86_400_000;

const UNIX_EPOCH_JULIAN_DAY: i64 = 2_440_588;

/// A real date; months are 1-based.
pub(crate) fn date(year: i64, month: i64, day: i64) -> Option<Date> {
    Date::from_calendar_date(
        i32::try_from(year).ok()?,
        Month::try_from(u8::try_from(month).ok()?).ok()?,
        u8::try_from(day).ok()?,
    )
    .ok()
}

pub(crate) fn unix_day(date: Date) -> i64 {
    i64::from(date.to_julian_day()) - UNIX_EPOCH_JULIAN_DAY
}

pub(crate) fn month_length(date: Date) -> i64 {
    i64::from(date.month().length(date.year()))
}

/// 0 for Sunday.
pub(crate) const fn weekday(days: i64) -> i64 {
    (days + 4).rem_euclid(7)
}

/// Milliseconds since 1970 as `YYYY-MM-DDTHH:MM:SS`, read in UTC, for years 0 to 9999.
pub(crate) fn format_ms(ms: i64) -> Option<String> {
    let at = OffsetDateTime::from_unix_timestamp(ms.div_euclid(1000)).ok()?;
    (0..=9999).contains(&at.year()).then(|| {
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            at.year(),
            u8::from(at.month()),
            at.day(),
            at.hour(),
            at.minute(),
            at.second()
        )
    })
}
