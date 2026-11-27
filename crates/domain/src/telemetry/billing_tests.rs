use super::billing::{BillingHour, BillingMonth, PendingOverageHour};
use super::value_objects::{DecompressedBytes, TenantId};
use crate::clock::UnixSeconds;
use crate::subscriptions::CustomerRef;
use uuid::Uuid;

#[test]
fn a_known_instant_lands_in_its_calendar_month() {
    let instant = UnixSeconds::new(1_700_000_000);

    assert_eq!(BillingMonth::containing(instant).key(), "202311");
}

#[test]
fn the_epoch_is_the_first_month() {
    assert_eq!(
        BillingMonth::containing(UnixSeconds::new(0)).key(),
        "197001"
    );
}

#[test]
fn a_december_instant_does_not_roll_into_the_next_year() {
    let last_second_of_2026 = UnixSeconds::new(1_798_761_599);

    assert_eq!(
        BillingMonth::containing(last_second_of_2026).key(),
        "202612"
    );
}

#[test]
fn an_instant_beyond_the_representable_range_falls_back_to_the_epoch() {
    assert_eq!(
        BillingMonth::containing(UnixSeconds::new(u64::MAX)).key(),
        "197001"
    );
}

#[test]
fn a_month_starts_at_midnight_utc_on_its_first_day() {
    let november = BillingMonth::containing(UnixSeconds::new(1_700_000_000));

    assert_eq!(november.start_nanos(), 1_698_796_800 * 1_000_000_000);
}

#[test]
fn the_start_of_a_month_belongs_to_that_month() {
    let month = BillingMonth::containing(UnixSeconds::new(1_700_000_000));
    let start = u64::try_from(month.start_nanos() / 1_000_000_000).expect("after the epoch");

    assert_eq!(BillingMonth::containing(UnixSeconds::new(start)), month);
}

#[test]
fn an_hour_is_named_down_to_the_hour() {
    let hour = BillingHour::containing(UnixSeconds::new(1_700_000_000));

    assert_eq!(hour.key(), "2023111422");
}

#[test]
fn an_instant_inside_an_hour_names_that_hour() {
    let start = 1_699_999_200;
    let early = BillingHour::containing(UnixSeconds::new(start));
    let late = BillingHour::containing(UnixSeconds::new(start + 3599));

    assert_eq!(early, late);
}

#[test]
fn the_next_second_belongs_to_the_next_hour() {
    let hour = BillingHour::containing(UnixSeconds::new(1_700_000_000));
    let next = BillingHour::containing(UnixSeconds::new(1_700_000_000 + 3600));

    assert_ne!(hour, next);
    assert_eq!(next.previous(), hour);
}

#[test]
fn an_hour_starts_on_a_whole_hour() {
    let hour = BillingHour::containing(UnixSeconds::new(1_700_000_000));

    assert_eq!(hour.start_nanos() % (3600 * 1_000_000_000), 0);
    assert_eq!(BillingHour::from_start_nanos(hour.start_nanos()), hour);
}

fn slice(prior: u64, hour_bytes: u64, free: u64, cap: Option<u64>) -> PendingOverageHour {
    PendingOverageHour {
        org: TenantId::new(Uuid::nil()),
        customer: CustomerRef::new("cus_test"),
        hour: BillingHour::containing(UnixSeconds::new(1_700_000_000)),
        prior_month_bytes: DecompressedBytes::new(prior),
        hour_bytes: DecompressedBytes::new(hour_bytes),
        free_allowance: DecompressedBytes::new(free),
        cap_bytes: cap.map(DecompressedBytes::new),
    }
}

#[test]
fn an_hour_within_the_grace_threshold_bills_nothing() {
    assert_eq!(slice(90, 15, 108, Some(66)).billable().get(), 0);
}

#[test]
fn an_hour_crossing_the_grace_threshold_bills_only_the_excess() {
    assert_eq!(slice(105, 10, 108, Some(66)).billable().get(), 7);
}

#[test]
fn an_hour_past_the_monthly_cap_clamps_to_the_remaining_cap() {
    // Free allowance = 108, cap = 66 => ceiling = 174
    assert_eq!(slice(170, 10, 108, Some(66)).billable().get(), 4);
    assert_eq!(slice(175, 10, 108, Some(66)).billable().get(), 0);
}

#[test]
fn an_hour_is_read_back_from_its_key() {
    let hour = BillingHour::containing(UnixSeconds::new(1_700_000_000));

    assert_eq!(BillingHour::from_key(&hour.key()), Some(hour));
    assert_eq!(
        BillingHour::from_key("2023111422").map(BillingHour::start_nanos),
        Some(1_699_999_200_000_000_000)
    );
}

#[test]
fn a_month_key_or_a_malformed_key_names_no_hour() {
    for key in [
        "202311",
        "2023111",
        "20231114225",
        "2023131422",
        "2023111424",
        "2023abcd22",
    ] {
        assert_eq!(BillingHour::from_key(key), None, "{key}");
    }
}
