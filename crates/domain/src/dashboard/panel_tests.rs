use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::filter::Filter;
use super::grid::{Grid, MAX_POINTS};
use super::query::{PanelQuery, Step};
use super::result::PanelResult;
use super::variables::Variables;
use crate::explore::{Clause, Expr, Field, Op, Scalar, Value as ClauseValue, Window};

const HOUR: u64 = 3_600_000_000_000;
const DAY: u64 = 24 * HOUR;

fn window(span: u64) -> Window {
    Window::new(1_000_000_000_000, 1_000_000_000_000 + span).expect("a window")
}

fn filter(value: Value) -> Filter {
    serde_json::from_value(value).expect("a filter")
}

fn chosen(name: &str, values: &[&str]) -> Variables {
    Variables::new(BTreeMap::from([(
        name.to_owned(),
        values.iter().map(|value| (*value).to_owned()).collect(),
    )]))
    .expect("variables")
}

fn text(value: &str) -> Scalar {
    Scalar::Text(value.into())
}

fn is(field: Field, op: Op, value: ClauseValue) -> Expr {
    Expr::Is(Clause::new(field, op, value).expect("a clause"))
}

#[test]
fn an_auto_step_over_an_hour_gives_a_hundred_and_twenty_points() {
    let grid = Grid::new(window(HOUR), Step::Auto);

    assert_eq!(grid.step_nanos(), 30_000_000_000);
    assert_eq!(grid.slots(), 120);
    assert_eq!(grid.starts().count(), 120);
}

#[test]
fn spec_l16_9_no_step_gives_more_than_five_hundred_points() {
    for span in [HOUR, DAY, 31 * DAY, 400 * DAY] {
        for step in [
            Step::Auto,
            Step::Fixed(1.try_into().expect("one")),
            Step::Fixed(60.try_into().expect("sixty")),
        ] {
            let grid = Grid::new(window(span), step);

            assert!(grid.slots() <= MAX_POINTS, "{span} {step:?} {grid:?}");
            assert!(grid.slots() >= 1);
        }
    }
}

#[test]
fn a_fixed_step_is_kept_when_it_fits() {
    let grid = Grid::new(window(HOUR), Step::Fixed(60.try_into().expect("sixty")));

    assert_eq!(grid.step_nanos(), 60_000_000_000);
    assert_eq!(grid.slots(), 60);
}

#[test]
fn a_total_step_is_one_slot_over_the_whole_window() {
    let grid = Grid::new(window(HOUR), Step::Total);

    assert_eq!(grid.slots(), 1);
    assert!((grid.step_seconds() - 3_600.0).abs() < f64::EPSILON);
}

#[test]
fn spec_l16_10_a_value_with_a_quote_stays_one_literal() {
    let hostile = "x') OR 1=1 --";
    let held = filter(json!({"field": "service", "op": "eq", "value": {"var": "svc"}}));

    let resolved = chosen("svc", &[hostile]).resolve(&held).expect("resolved");

    assert_eq!(
        resolved,
        Some(is(Field::Service, Op::Eq, ClauseValue::One(text(hostile))))
    );
}

#[test]
fn several_values_become_a_list() {
    let held = filter(json!({"field": "service", "op": "eq", "value": {"var": "svc"}}));

    let resolved = chosen("svc", &["a", "b"]).resolve(&held).expect("resolved");

    assert_eq!(
        resolved,
        Some(is(
            Field::Service,
            Op::In,
            ClauseValue::Many(vec![text("a"), text("b")])
        ))
    );
}

#[test]
fn no_value_drops_the_clause_and_keeps_its_neighbours() {
    let held = filter(json!({"all": [
        {"field": "service", "op": "eq", "value": {"var": "svc"}},
        {"field": "name", "op": "eq", "value": "pay"}
    ]}));

    let resolved = Variables::none().resolve(&held).expect("resolved");

    assert_eq!(
        resolved,
        Some(Expr::All(vec![is(
            Field::Name,
            Op::Eq,
            ClauseValue::One(text("pay"))
        )]))
    );
    let alone = filter(json!({"field": "service", "op": "eq", "value": {"var": "svc"}}));
    assert_eq!(chosen("svc", &[]).resolve(&alone).expect("resolved"), None);
}

#[test]
fn a_number_field_takes_a_numeric_variable_only() {
    let held = filter(json!({"field": "http_status_code", "op": "gte", "value": {"var": "code"}}));

    assert!(chosen("code", &["500"]).resolve(&held).is_ok());
    assert!(chosen("code", &["five"]).resolve(&held).is_err());
}

#[test]
fn a_variable_with_several_values_cannot_feed_a_comparison() {
    let held = filter(json!({"field": "http_status_code", "op": "gte", "value": {"var": "code"}}));

    assert!(chosen("code", &["500", "404"]).resolve(&held).is_err());
}

#[test]
fn a_variable_inside_a_list_joins_its_literals() {
    let held = filter(json!({"field": "service", "op": "in", "value": ["a", {"var": "svc"}]}));

    let resolved = chosen("svc", &["b", "c"]).resolve(&held).expect("resolved");

    assert_eq!(
        resolved,
        Some(is(
            Field::Service,
            Op::In,
            ClauseValue::Many(vec![text("a"), text("b"), text("c")])
        ))
    );
}

#[test]
fn variable_names_and_sizes_are_bounded() {
    let bad = BTreeMap::from([("Not A Name".to_owned(), vec!["a".to_owned()])]);
    let long = BTreeMap::from([("svc".to_owned(), vec!["v".repeat(513)])]);

    assert!(Variables::new(bad).is_err());
    assert!(Variables::new(long).is_err());
}

#[test]
fn spec_l16_11_a_result_names_the_shape_it_has() {
    let query: PanelQuery = serde_json::from_value(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}], "step": "total"
    }))
    .expect("a query");

    assert!(query.can_yield(super::value_objects::ResultShape::Scalar));
    assert_eq!(
        PanelResult::Scalar { value: Some(1.0) }.shape(),
        super::value_objects::ResultShape::Scalar
    );
    assert_eq!(
        serde_json::to_value(PanelResult::Scalar { value: None }).expect("json"),
        json!({"kind": "scalar", "value": null})
    );
}

fn svc() -> Value {
    json!({"field": "service", "op": "eq", "value": {"var": "svc"}})
}

fn named() -> Value {
    json!({"field": "name", "op": "eq", "value": "pay"})
}

#[test]
fn an_or_with_an_unset_variable_is_dropped_whole_not_narrowed() {
    let held = filter(json!({"any": [svc(), named()]}));

    assert_eq!(Variables::none().resolve(&held).expect("resolved"), None);
    assert!(
        chosen("svc", &["a"])
            .resolve(&held)
            .expect("resolved")
            .is_some()
    );
}

#[test]
fn an_and_with_an_unset_variable_keeps_its_other_clauses() {
    let held = filter(json!({"all": [svc(), named()]}));

    let resolved = Variables::none().resolve(&held).expect("resolved");

    assert!(matches!(resolved, Some(Expr::All(parts)) if parts.len() == 1));
}

#[test]
fn a_not_over_an_unset_variable_is_dropped_and_never_inverts_a_narrowed_group() {
    let direct = filter(json!({"not": svc()}));
    let inside_and = filter(json!({"not": {"all": [svc(), named()]}}));
    let inside_or = filter(json!({"not": {"any": [svc(), named()]}}));

    for held in [direct, inside_and, inside_or] {
        assert_eq!(Variables::none().resolve(&held).expect("resolved"), None);
    }
    let set = filter(json!({"not": svc()}));
    assert!(matches!(
        chosen("svc", &["a"]).resolve(&set).expect("resolved"),
        Some(Expr::Not(_))
    ));
}

#[test]
fn an_empty_string_value_drops_the_clause_for_every_operator() {
    for op in ["eq", "ne", "contains", "not_contains", "in"] {
        let held = filter(json!({"field": "service", "op": op, "value": {"var": "svc"}}));

        assert_eq!(
            chosen("svc", &[""]).resolve(&held).expect("resolved"),
            None,
            "{op}"
        );
    }
    let held = filter(json!({"field": "service", "op": "eq", "value": {"var": "svc"}}));
    assert_eq!(
        chosen("svc", &["", "a"]).resolve(&held).expect("resolved"),
        Some(is(Field::Service, Op::Eq, ClauseValue::One(text("a"))))
    );
}

fn query_of(value: Value) -> PanelQuery {
    serde_json::from_value(value).expect("a query")
}

#[test]
fn colliding_group_labels_are_found() {
    let clash = |value: Value| super::labels::clashing_label(&query_of(value));
    let base = |group: Value, aggs: Value| {
        json!({"name": "n", "signal": "traces", "aggregations": aggs,
               "group_by": group, "step": "auto"})
    };
    let one = json!([{"function": "count"}]);
    let two = json!([{"function": "count"}, {"function": "p95", "field": {"field": "duration"}}]);

    assert_eq!(
        clash(base(
            json!([{"field": "service"}, {"attr": "service"}]),
            one.clone()
        )),
        Some("service".to_owned())
    );
    assert_eq!(
        clash(base(json!([{"attr": "aggregation"}]), two.clone())),
        Some("aggregation".to_owned())
    );
    assert_eq!(
        clash(base(json!([{"attr": "count"}]), one.clone())),
        Some("count".to_owned())
    );
    assert_eq!(clash(base(json!([{"attr": "aggregation"}]), one)), None);
    assert_eq!(
        clash(base(json!([{"field": "service"}, {"attr": "region"}]), two)),
        None
    );
}
