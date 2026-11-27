use super::value_objects::{DecompressedBytes, TenantId};
use crate::clock::UnixSeconds;
use crate::subscriptions::CustomerRef;
use time::{Date, Month, OffsetDateTime};

const NANOS_PER_SECOND: i64 = 1_000_000_000;
const SECONDS_PER_HOUR: i64 = 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct BillingMonth {
    year: i32,
    month: u8,
}

impl BillingMonth {
    pub fn containing(instant: UnixSeconds) -> Self {
        let seconds = i64::try_from(instant.get()).unwrap_or(i64::MAX);
        let moment =
            OffsetDateTime::from_unix_timestamp(seconds).unwrap_or(OffsetDateTime::UNIX_EPOCH);
        Self {
            year: moment.year(),
            month: u8::from(moment.month()),
        }
    }

    pub fn start_nanos(self) -> i64 {
        let month = Month::try_from(self.month).unwrap_or(Month::January);
        let first = Date::from_calendar_date(self.year, month, 1)
            .unwrap_or(OffsetDateTime::UNIX_EPOCH.date());
        first.midnight().assume_utc().unix_timestamp() * NANOS_PER_SECOND
    }

    pub fn key(self) -> String {
        format!("{:04}{:02}", self.year, self.month)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct BillingHour {
    start: i64,
}

impl BillingHour {
    pub fn containing(instant: UnixSeconds) -> Self {
        let seconds = i64::try_from(instant.get()).unwrap_or(i64::MAX);
        Self {
            start: seconds - seconds.rem_euclid(SECONDS_PER_HOUR),
        }
    }

    pub fn previous(self) -> Self {
        Self {
            start: self.start.saturating_sub(SECONDS_PER_HOUR),
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        if key.len() != 10 || !key.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let year = key[0..4].parse().ok()?;
        let month = Month::try_from(key[4..6].parse::<u8>().ok()?).ok()?;
        let day = key[6..8].parse().ok()?;
        let hour = key[8..10].parse().ok()?;
        let start = Date::from_calendar_date(year, month, day)
            .ok()?
            .with_hms(hour, 0, 0)
            .ok()?
            .assume_utc()
            .unix_timestamp();
        Some(Self { start })
    }

    pub fn from_start_nanos(nanos: i64) -> Self {
        let seconds = nanos.div_euclid(NANOS_PER_SECOND);
        Self {
            start: seconds - seconds.rem_euclid(SECONDS_PER_HOUR),
        }
    }

    pub fn start_nanos(self) -> i64 {
        self.start.saturating_mul(NANOS_PER_SECOND)
    }

    pub fn key(self) -> String {
        let moment =
            OffsetDateTime::from_unix_timestamp(self.start).unwrap_or(OffsetDateTime::UNIX_EPOCH);
        format!(
            "{:04}{:02}{:02}{:02}",
            moment.year(),
            u8::from(moment.month()),
            moment.day(),
            moment.hour()
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingOverageHour {
    pub org: TenantId,
    pub customer: CustomerRef,
    pub hour: BillingHour,
    pub prior_month_bytes: DecompressedBytes,
    pub hour_bytes: DecompressedBytes,
    pub free_allowance: DecompressedBytes,
    pub cap_bytes: Option<DecompressedBytes>,
}

impl PendingOverageHour {
    pub fn billable(&self) -> DecompressedBytes {
        let before = self.prior_month_bytes.get();
        let after = before.saturating_add(self.hour_bytes.get());
        let start = before.max(self.free_allowance.get());
        let end = match self.cap_bytes {
            Some(cap) => after.min(self.free_allowance.get().saturating_add(cap.get())),
            None => after,
        };
        DecompressedBytes::new(end.saturating_sub(start))
    }
}
