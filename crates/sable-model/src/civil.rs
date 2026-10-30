use jiff::{
    SignedDuration,
    civil::{Date, DateTime},
    fmt::temporal::DateTimePrinter,
};

pub(crate) const MS_PER_DAY: i64 = 86_400_000;

const UNIX_EPOCH: Date = Date::constant(1970, 1, 1);

/// A real date; months are 1-based.
pub(crate) fn date(year: i64, month: i64, day: i64) -> Option<Date> {
    Date::new(
        i16::try_from(year).ok()?,
        i8::try_from(month).ok()?,
        i8::try_from(day).ok()?,
    )
    .ok()
}

/// Milliseconds since 1970 as `YYYY-MM-DDTHH:MM:SS`, read in UTC, for years 0 to 9999.
pub(crate) fn format_ms(ms: i64) -> Option<String> {
    let at = UNIX_EPOCH
        .at(0, 0, 0, 0)
        .checked_add(SignedDuration::from_secs(ms.div_euclid(1000)))
        .ok()?;
    (at.year() >= 0).then(|| format_datetime(at))
}

pub(crate) fn format_datetime(at: DateTime) -> String {
    DateTimePrinter::new()
        .precision(Some(0))
        .datetime_to_string(&at)
}
