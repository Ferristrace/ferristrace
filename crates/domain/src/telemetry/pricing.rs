use core::fmt;

use super::errors::BadCurrency;
use super::value_objects::{SignalKind, Split};
use crate::clock::UnixSeconds;
use crate::explore::Window;

pub const BYTES_PER_GB: u64 = 1_000_000_000;
pub const POINTS_PER_MILLION: u64 = 1_000_000;
const NANOS_PER_SECOND: u64 = 1_000_000_000;
const AN_HOUR_NANOS: u64 = 3600 * NANOS_PER_SECOND;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Currency([u8; 3]);

impl Currency {
    pub fn code(&self) -> &str {
        core::str::from_utf8(&self.0).unwrap_or_default()
    }
}

impl TryFrom<&str> for Currency {
    type Error = BadCurrency;

    fn try_from(spelling: &str) -> Result<Self, BadCurrency> {
        let letters: [u8; 3] = spelling.as_bytes().try_into().map_err(|_| BadCurrency)?;
        if !letters.iter().all(u8::is_ascii_alphabetic) {
            return Err(BadCurrency);
        }
        Ok(Self(letters.map(|letter| letter.to_ascii_uppercase())))
    }
}

impl fmt::Display for Currency {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PriceList {
    pub currency: Currency,
    pub spans_gb_micros: u64,
    pub logs_gb_micros: u64,
    pub metrics_million_micros: u64,
    pub included: Split,
}

impl PriceList {
    #[must_use]
    pub fn including(self, included: Split) -> Self {
        Self { included, ..self }
    }

    fn rate(&self, signal: SignalKind) -> (u64, u64) {
        match signal {
            SignalKind::Spans => (self.spans_gb_micros, BYTES_PER_GB),
            SignalKind::Logs => (self.logs_gb_micros, BYTES_PER_GB),
            SignalKind::Metrics => (self.metrics_million_micros, POINTS_PER_MILLION),
        }
    }

    pub fn value(&self, signal: SignalKind, volume: u64) -> u64 {
        let (price, unit) = self.rate(signal);
        rounded_half_up(u128::from(volume) * u128::from(price), u128::from(unit))
    }

    pub fn bill(&self, used: Split, window: Window, now: UnixSeconds) -> Bill {
        let pace = Pace::of(window, now);
        let line = |signal| self.line(signal, used.of(signal), pace);
        Bill {
            spans: line(SignalKind::Spans),
            logs: line(SignalKind::Logs),
            metrics: line(SignalKind::Metrics),
        }
    }

    fn line(&self, signal: SignalKind, used: u64, pace: Pace) -> SignalBill {
        let included = self.included.of(signal);
        let projected = pace.projected(used);
        SignalBill {
            used,
            included,
            projected,
            value_micros: self.value(signal, used),
            billable_micros: self.value(signal, used.saturating_sub(included)),
            projected_value_micros: self.value(signal, projected),
            projected_billable_micros: self.value(signal, projected.saturating_sub(included)),
            passes_at_unix_nanos: pace.passes(included, used),
        }
    }
}

fn rounded_half_up(numerator: u128, unit: u128) -> u64 {
    let quotient = numerator / unit;
    let rounded = if (numerator % unit) * 2 >= unit {
        quotient + 1
    } else {
        quotient
    };
    u64::try_from(rounded).unwrap_or(u64::MAX)
}

#[derive(Debug, Clone, Copy)]
struct Pace {
    from: u64,
    length: u64,
    elapsed: u64,
    running: bool,
}

impl Pace {
    fn of(window: Window, now: UnixSeconds) -> Self {
        let from = window.from_unix_nanos();
        let to = window.to_unix_nanos();
        let now = now.get().saturating_mul(NANOS_PER_SECOND);
        let length = to - from;
        let elapsed = if now < from {
            0
        } else {
            (now - from).max(AN_HOUR_NANOS).min(length)
        };
        Self {
            from,
            length,
            elapsed,
            running: (from..to).contains(&now),
        }
    }

    fn projected(self, used: u64) -> u64 {
        if !self.running {
            return used;
        }
        scaled(used, self.length, self.elapsed)
    }

    fn passes(self, included: u64, used: u64) -> Option<u64> {
        if included == 0 || used == 0 || self.elapsed == 0 {
            return None;
        }
        let after = scaled(included, self.elapsed, used);
        (after < self.length).then(|| self.from + after)
    }
}

fn scaled(volume: u64, numerator: u64, denominator: u64) -> u64 {
    let product = u128::from(volume) * u128::from(numerator) / u128::from(denominator.max(1));
    u64::try_from(product).unwrap_or(u64::MAX)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignalBill {
    pub used: u64,
    pub included: u64,
    pub projected: u64,
    pub value_micros: u64,
    pub billable_micros: u64,
    pub projected_value_micros: u64,
    pub projected_billable_micros: u64,
    pub passes_at_unix_nanos: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bill {
    pub spans: SignalBill,
    pub logs: SignalBill,
    pub metrics: SignalBill,
}

impl Bill {
    fn lines(&self) -> [&SignalBill; 3] {
        [&self.spans, &self.logs, &self.metrics]
    }

    fn total(&self, of: impl Fn(&SignalBill) -> u64) -> u64 {
        self.lines()
            .into_iter()
            .fold(0, |sum, line| sum.saturating_add(of(line)))
    }

    pub fn value_micros(&self) -> u64 {
        self.total(|line| line.value_micros)
    }

    pub fn billable_micros(&self) -> u64 {
        self.total(|line| line.billable_micros)
    }

    pub fn projected_value_micros(&self) -> u64 {
        self.total(|line| line.projected_value_micros)
    }

    pub fn projected_billable_micros(&self) -> u64 {
        self.total(|line| line.projected_billable_micros)
    }
}
