use super::errors::BadCurrency;
use super::pricing::{BYTES_PER_GB, Currency, POINTS_PER_MILLION, PriceList};
use super::value_objects::{SignalKind, Split};
use crate::clock::UnixSeconds;
use crate::explore::Window;

const NOVEMBER: u64 = 1_698_796_800;
const DECEMBER: u64 = 1_701_388_800;
const A_DAY: u64 = 86_400;
const NANOS: u64 = 1_000_000_000;

fn euros() -> Currency {
    Currency::try_from("EUR").expect("a currency")
}

fn prices(included: Split) -> PriceList {
    PriceList {
        currency: euros(),
        spans_gb_micros: 250_000,
        logs_gb_micros: 500_000_000,
        metrics_million_micros: 100_000,
        included,
    }
}

fn november() -> Window {
    Window::new(NOVEMBER * NANOS, DECEMBER * NANOS).expect("a month")
}

fn at_day(day: u64) -> UnixSeconds {
    UnixSeconds::new(NOVEMBER + day * A_DAY)
}

#[test]
fn a_currency_is_three_ascii_letters_read_in_capitals() {
    assert_eq!(
        Currency::try_from("eur").map(|c| c.to_string()),
        Ok("EUR".to_owned())
    );
    for refused in ["", "EU", "EURO", "E1R", "€UR", "US "] {
        assert_eq!(Currency::try_from(refused), Err(BadCurrency), "{refused:?}");
    }
}

#[test]
fn a_gigabyte_costs_its_price_and_a_million_points_theirs() {
    let list = prices(Split::default());

    assert_eq!(list.value(SignalKind::Spans, BYTES_PER_GB), 250_000);
    assert_eq!(
        list.value(SignalKind::Logs, 3 * BYTES_PER_GB),
        1_500_000_000
    );
    assert_eq!(
        list.value(SignalKind::Metrics, 2 * POINTS_PER_MILLION),
        200_000
    );
    assert_eq!(list.value(SignalKind::Spans, 0), 0);
}

#[test]
fn a_half_micro_rounds_up_and_less_rounds_down() {
    let list = prices(Split::default());

    assert_eq!(list.value(SignalKind::Logs, 1), 1, "0.5 micro");
    assert_eq!(list.value(SignalKind::Spans, 1_999), 0, "0.49975 micro");
    assert_eq!(list.value(SignalKind::Spans, 2_000), 1, "0.5 micro");
    assert_eq!(list.value(SignalKind::Spans, 6_000), 2, "1.5 micros");
    assert_eq!(list.value(SignalKind::Metrics, 15), 2, "1.5 micros");
    assert_eq!(list.value(SignalKind::Metrics, 14), 1, "1.4 micros");
}

#[test]
fn a_value_too_large_for_u64_saturates() {
    let list = PriceList {
        logs_gb_micros: u64::MAX,
        ..prices(Split::default())
    };

    assert_eq!(list.value(SignalKind::Logs, u64::MAX), u64::MAX);
}

#[test]
fn what_is_included_is_not_billable_and_the_rest_is() {
    let used = Split {
        spans_bytes: 3 * BYTES_PER_GB,
        logs_bytes: BYTES_PER_GB,
        metrics_points: 5 * POINTS_PER_MILLION,
    };
    let included = Split {
        spans_bytes: 10 * BYTES_PER_GB,
        logs_bytes: BYTES_PER_GB / 4,
        metrics_points: 5 * POINTS_PER_MILLION,
    };

    let bill = prices(included).bill(used, november(), UnixSeconds::new(DECEMBER));

    assert_eq!(bill.spans.value_micros, 750_000);
    assert_eq!(bill.spans.billable_micros, 0);
    assert_eq!(bill.logs.value_micros, 500_000_000);
    assert_eq!(bill.logs.billable_micros, 375_000_000);
    assert_eq!(bill.metrics.value_micros, 500_000);
    assert_eq!(bill.metrics.billable_micros, 0);
    assert_eq!(bill.value_micros(), 501_250_000);
    assert_eq!(bill.billable_micros(), 375_000_000);
}

#[test]
fn a_finished_window_projects_what_was_used() {
    let used = Split {
        logs_bytes: 2 * BYTES_PER_GB,
        ..Split::default()
    };

    let bill = prices(Split::default()).bill(used, november(), UnixSeconds::new(DECEMBER + 10));

    assert_eq!(bill.logs.projected, 2 * BYTES_PER_GB);
    assert_eq!(bill.projected_value_micros(), bill.value_micros());
    assert_eq!(bill.projected_billable_micros(), bill.billable_micros());
}

#[test]
fn halfway_through_the_month_the_projection_doubles_what_was_used() {
    let used = Split {
        logs_bytes: BYTES_PER_GB,
        ..Split::default()
    };
    let included = Split {
        logs_bytes: BYTES_PER_GB,
        ..Split::default()
    };

    let bill = prices(included).bill(used, november(), at_day(15));

    assert_eq!(bill.logs.projected, 2 * BYTES_PER_GB);
    assert_eq!(bill.logs.projected_billable_micros, 500_000_000);
    assert_eq!(bill.projected_value_micros(), 1_000_000_000);
    assert_eq!(bill.billable_micros(), 0);
}

#[test]
fn the_first_minutes_of_a_window_count_as_an_hour() {
    let used = Split {
        spans_bytes: 10,
        ..Split::default()
    };

    let bill = prices(Split::default()).bill(used, november(), UnixSeconds::new(NOVEMBER + 60));

    assert_eq!(bill.spans.projected, 10 * 30 * 24);
}

#[test]
fn an_allowance_is_passed_where_the_pace_reaches_it() {
    let used = Split {
        logs_bytes: 10,
        spans_bytes: 10,
        metrics_points: 10,
    };
    let included = Split {
        logs_bytes: 15,
        spans_bytes: 40,
        metrics_points: 0,
    };

    let bill = prices(included).bill(used, november(), at_day(10));

    assert_eq!(
        bill.logs.passes_at_unix_nanos,
        Some((NOVEMBER + 15 * A_DAY) * NANOS)
    );
    assert_eq!(
        bill.spans.passes_at_unix_nanos, None,
        "after the month ends"
    );
    assert_eq!(bill.metrics.passes_at_unix_nanos, None, "nothing included");
}

#[test]
fn an_allowance_already_passed_is_dated_where_the_pace_crossed_it() {
    let used = Split {
        logs_bytes: 20,
        ..Split::default()
    };
    let included = Split {
        logs_bytes: 10,
        ..Split::default()
    };

    let bill = prices(included).bill(used, november(), at_day(10));

    assert_eq!(
        bill.logs.passes_at_unix_nanos,
        Some((NOVEMBER + 5 * A_DAY) * NANOS)
    );
}

#[test]
fn nothing_used_passes_nothing() {
    let included = Split {
        logs_bytes: 10,
        ..Split::default()
    };

    let bill = prices(included).bill(Split::default(), november(), at_day(10));

    assert_eq!(bill.logs.passes_at_unix_nanos, None);
    assert_eq!(bill.logs.projected, 0);
}

#[test]
fn a_window_not_started_projects_what_was_used_and_passes_nothing() {
    let used = Split {
        logs_bytes: 10,
        ..Split::default()
    };
    let included = Split {
        logs_bytes: 5,
        ..Split::default()
    };

    let bill = prices(included).bill(used, november(), UnixSeconds::new(NOVEMBER - A_DAY));

    assert_eq!(bill.logs.projected, 10);
    assert_eq!(bill.logs.passes_at_unix_nanos, None);
}
