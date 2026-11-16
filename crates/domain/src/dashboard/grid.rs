use super::query::Step;
use crate::explore::Window;

pub const MAX_POINTS: u64 = 500;
pub const MAX_SERIES: usize = 50;
pub const BUCKETS: u32 = 30;
const NANOS_PER_SECOND: u64 = 1_000_000_000;
const AUTO_POINTS: u64 = 120;
const NICE_SECONDS: [u64; 17] = [
    1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600, 7_200, 14_400, 21_600, 43_200, 86_400,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grid {
    from_nanos: u64,
    step_nanos: u64,
    slots: u64,
}

impl Grid {
    pub fn new(window: Window, step: Step) -> Self {
        let span = window.to_unix_nanos() - window.from_unix_nanos();
        let step_nanos = match step {
            Step::Total => span,
            Step::Fixed(seconds) => u64::from(seconds.get())
                .saturating_mul(NANOS_PER_SECOND)
                .max(span.div_ceil(MAX_POINTS)),
            Step::Auto => NICE_SECONDS
                .iter()
                .map(|seconds| seconds * NANOS_PER_SECOND)
                .find(|nanos| span.div_ceil(*nanos) <= AUTO_POINTS)
                .unwrap_or_else(|| span.div_ceil(MAX_POINTS))
                .max(span.div_ceil(MAX_POINTS)),
        };
        Self {
            from_nanos: window.from_unix_nanos(),
            step_nanos,
            slots: span.div_ceil(step_nanos),
        }
    }

    pub fn from_nanos(self) -> u64 {
        self.from_nanos
    }

    pub fn step_nanos(self) -> u64 {
        self.step_nanos
    }

    pub fn slots(self) -> u64 {
        self.slots
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn step_seconds(self) -> f64 {
        self.step_nanos as f64 / NANOS_PER_SECOND as f64
    }

    pub fn starts(self) -> impl Iterator<Item = u64> {
        (0..self.slots).map(move |slot| self.from_nanos + slot * self.step_nanos)
    }
}
