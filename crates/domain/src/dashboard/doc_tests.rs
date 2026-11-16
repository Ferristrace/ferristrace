use serde_json::{Value, json};

use super::doc::DashboardDoc;
use super::errors::{Cap, DashboardError};
use super::value_objects::{DashboardName, PanelKind, ResultShape, Tags};

pub(super) fn series_query() -> Value {
    json!({
        "name": "spans",
        "signal": "traces",
        "aggregations": [{"function": "count", "field": null}],
        "filter": {"all": [
            {"field": "service", "op": "eq", "value": "checkout"},
            {"field": "http_status_code", "op": "gte", "value": 500}
        ]},
        "group_by": [{"field": "service"}],
        "order": {"by": {"aggregation": 0}, "direction": "desc"},
        "limit": 20,
        "step": "auto"
    })
}

pub(super) fn total_query() -> Value {
    let mut query = series_query();
    query["step"] = json!("total");
    query["group_by"] = json!([]);
    query
}

#[allow(clippy::needless_pass_by_value)]
pub(super) fn panel(id: &str, kind: &str, queries: Vec<Value>) -> Value {
    json!({
        "id": id,
        "title": "p95 per service",
        "description": "",
        "kind": kind,
        "queries": queries,
        "options": {"unit": "ms", "decimals": 2, "legend": "bottom", "stacked": false, "content": null}
    })
}

#[allow(clippy::needless_pass_by_value)]
pub(super) fn document(panels: Vec<Value>, layout: Vec<Value>) -> Value {
    json!({
        "schema_version": 1,
        "variables": [{
            "name": "service",
            "label": "Service",
            "source": {"kind": "attribute", "signal": "traces", "key": "service.name"},
            "multi": true,
            "all": true
        }],
        "panels": panels,
        "layout": layout,
        "duration": 3600
    })
}

fn place(panel: &str, x: u8, w: u8) -> Value {
    json!({"panel": panel, "x": x, "y": 0, "w": w, "h": 4})
}

fn parsed(value: Value) -> Result<DashboardDoc, DashboardError> {
    DashboardDoc::from_value(value)
}

fn refusal(value: Value) -> String {
    match parsed(value) {
        Err(DashboardError::Invalid(reason)) => reason,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn spec_l16_1_a_document_reads_back_unchanged() {
    let sent = document(
        vec![
            panel("latency", "time_series", vec![series_query()]),
            panel("errors", "number", vec![total_query()]),
            panel("notes", "text", vec![]),
        ],
        vec![place("latency", 0, 8), place("errors", 8, 4)],
    );

    let doc = parsed(sent.clone()).expect("a valid document");
    let read_back = serde_json::to_value(&doc).expect("a document serialises");

    assert_eq!(read_back, sent);
    assert_eq!(
        serde_json::from_value::<DashboardDoc>(read_back).expect("it reads back"),
        doc
    );
}

#[test]
fn every_kind_names_the_shape_of_the_result_it_expects() {
    let shapes: Vec<_> = PanelKind::ALL
        .iter()
        .map(|kind| kind.result_shape())
        .collect();

    assert_eq!(
        shapes,
        vec![
            ResultShape::Series,
            ResultShape::Series,
            ResultShape::Series,
            ResultShape::Rows,
            ResultShape::Pairs,
            ResultShape::Buckets,
            ResultShape::Heat,
            ResultShape::Scalar,
            ResultShape::Rows,
            ResultShape::Rows,
            ResultShape::None,
        ]
    );
}

#[test]
fn spec_l16_4_a_version_this_server_does_not_know_is_refused_not_guessed() {
    for version in [json!(2), json!(0), json!("1"), json!(null), json!(1.5)] {
        let mut sent = document(vec![], vec![]);
        sent["schema_version"] = version;

        assert_eq!(parsed(sent), Err(DashboardError::UnknownSchema));
    }
    let mut missing = document(vec![], vec![]);
    missing
        .as_object_mut()
        .expect("an object")
        .remove("schema_version");

    assert_eq!(parsed(missing), Err(DashboardError::UnknownSchema));
}

#[test]
fn spec_l16_5_a_thirty_first_panel_is_refused() {
    let panels = |count: usize| {
        (0..count)
            .map(|at| panel(&format!("p{at}"), "text", vec![]))
            .collect::<Vec<_>>()
    };

    assert!(parsed(document(panels(30), vec![])).is_ok());
    assert_eq!(
        parsed(document(panels(31), vec![])),
        Err(DashboardError::TooMany(Cap::Panels))
    );
}

#[test]
fn spec_l16_5_a_twenty_first_variable_is_refused() {
    let variables = |count: usize| {
        (0..count)
            .map(|at| {
                json!({
                    "name": format!("v{at}"),
                    "label": "",
                    "source": {"kind": "static", "values": ["a"]},
                    "multi": false,
                    "all": false
                })
            })
            .collect::<Vec<_>>()
    };
    let with = |count: usize| {
        let mut sent = document(vec![], vec![]);
        sent["variables"] = json!(variables(count));
        sent
    };

    assert!(parsed(with(20)).is_ok());
    assert_eq!(
        parsed(with(21)),
        Err(DashboardError::TooMany(Cap::Variables))
    );
}

#[test]
fn spec_l16_5_a_document_over_256_kb_is_refused() {
    let big = |values: usize| {
        let mut sent = document(vec![], vec![]);
        sent["variables"] = json!(
            (0..20)
                .map(|at| json!({
                    "name": format!("v{at}"),
                    "label": "",
                    "source": {"kind": "static", "values": vec!["x".repeat(values); 100]},
                    "multi": false,
                    "all": false
                }))
                .collect::<Vec<_>>()
        );
        sent
    };

    assert!(parsed(big(100)).is_ok());
    assert_eq!(parsed(big(140)), Err(DashboardError::TooLarge));
}

#[test]
fn spec_l16_11_a_number_panel_given_a_series_query_is_refused() {
    let reason = refusal(document(
        vec![panel("errors", "number", vec![series_query()])],
        vec![],
    ));

    assert!(reason.contains("number"), "{reason}");
    assert!(reason.contains("spans"), "{reason}");
}

#[test]
fn a_panel_and_its_queries_agree_on_the_shape_of_the_result() {
    let grouped_total = {
        let mut query = total_query();
        query["group_by"] = json!([{"field": "service"}]);
        query
    };
    let cases = [
        ("time_series", total_query(), false),
        ("area", series_query(), true),
        ("bar", series_query(), true),
        ("number", grouped_total.clone(), false),
        ("number", total_query(), true),
        ("table", grouped_total.clone(), true),
        ("table", series_query(), false),
        ("pie", grouped_total, true),
        ("list", total_query(), true),
    ];

    for (kind, query, accepted) in cases {
        let verdict = parsed(document(vec![panel("p", kind, vec![query])], vec![]));

        assert_eq!(verdict.is_ok(), accepted, "{kind}: {verdict:?}");
    }
}

#[test]
fn a_histogram_and_a_heatmap_aggregate_a_field_and_a_scatter_needs_two_values() {
    let over_duration = |step: &str| {
        json!({
            "name": "d",
            "signal": "traces",
            "aggregations": [{"function": "avg", "field": {"field": "duration"}}],
            "step": step
        })
    };
    let pairs = json!({
        "name": "xy",
        "signal": "traces",
        "aggregations": [
            {"function": "avg", "field": {"field": "duration"}},
            {"function": "count", "field": null}
        ],
        "group_by": [{"field": "service"}],
        "step": "total"
    });
    let counting = json!({
        "name": "n",
        "signal": "traces",
        "aggregations": [{"function": "count"}],
        "step": "total"
    });

    let accepts = |kind: &str, query: Value| {
        parsed(document(vec![panel("p", kind, vec![query])], vec![])).is_ok()
    };

    assert!(accepts("histogram", over_duration("total")));
    assert!(!accepts("histogram", counting.clone()));
    assert!(accepts("heatmap", over_duration("auto")));
    assert!(!accepts("heatmap", over_duration("total")));
    assert!(accepts("scatter", pairs));
    assert!(!accepts("scatter", counting));
}

#[test]
fn a_text_panel_runs_no_query_and_every_other_kind_needs_one() {
    assert!(
        refusal(document(
            vec![panel("t", "text", vec![total_query()])],
            vec![]
        ))
        .contains("no query")
    );
    for kind in PanelKind::ALL
        .into_iter()
        .filter(|kind| *kind != PanelKind::Text)
    {
        let reason = refusal(document(vec![panel("p", kind.as_str(), vec![])], vec![]));

        assert!(reason.contains("needs a query"), "{kind}: {reason}");
    }
}

#[test]
fn the_layout_places_existing_panels_once_inside_twelve_columns() {
    let panels = || vec![panel("a", "text", vec![]), panel("b", "text", vec![])];

    assert!(parsed(document(panels(), vec![place("a", 0, 12)])).is_ok());
    assert!(refusal(document(panels(), vec![place("ghost", 0, 4)])).contains("ghost"));
    assert!(
        refusal(document(panels(), vec![place("a", 0, 4), place("a", 4, 4)])).contains("twice")
    );
    assert!(refusal(document(panels(), vec![place("a", 9, 4)])).contains("12 columns"));
    assert!(refusal(document(panels(), vec![place("a", 0, 0)])).contains("12 columns"));
}

#[test]
fn panel_ids_and_variable_names_are_unique() {
    let twice = vec![panel("a", "text", vec![]), panel("a", "text", vec![])];

    assert!(refusal(document(twice, vec![])).contains("twice"));
    let mut sent = document(vec![], vec![]);
    let variable = sent["variables"][0].clone();
    sent["variables"] = json!([variable.clone(), variable]);

    assert!(refusal(sent).contains("declared twice"));
}

#[test]
fn a_filter_may_use_only_the_variables_the_document_declares() {
    let query = |name: &str| {
        json!({
            "name": "q",
            "signal": "traces",
            "aggregations": [{"function": "count"}],
            "filter": {"field": "service", "op": "in", "value": [{"var": name}]},
            "step": "auto"
        })
    };

    assert!(
        parsed(document(
            vec![panel("p", "bar", vec![query("service")])],
            vec![]
        ))
        .is_ok()
    );
    assert!(
        refusal(document(
            vec![panel("p", "bar", vec![query("env")])],
            vec![]
        ))
        .contains("env")
    );
}

#[test]
fn a_variable_in_a_filter_stays_a_reference_through_a_round_trip() {
    let sent = document(
        vec![panel(
            "p",
            "bar",
            vec![json!({
                "name": "q",
                "signal": "logs",
                "aggregations": [{"function": "count", "field": null}],
                "filter": {"not": {"field": "service", "op": "eq", "value": {"var": "service"}}},
                "group_by": [],
                "order": null,
                "limit": null,
                "step": {"fixed": 60}
            })],
        )],
        vec![],
    );

    let doc = parsed(sent.clone()).expect("valid");

    assert_eq!(serde_json::to_value(&doc).expect("serialises"), sent);
}

#[test]
fn a_query_stays_inside_its_signal_and_its_bounds() {
    let build = |edit: &dyn Fn(&mut Value)| {
        let mut query = series_query();
        edit(&mut query);
        parsed(document(vec![panel("p", "bar", vec![query])], vec![]))
    };

    assert!(build(&|_| {}).is_ok());
    assert!(build(&|query| query["signal"] = json!("logs")).is_err());
    assert!(build(&|query| query["limit"] = json!(1001)).is_err());
    assert!(build(&|query| query["limit"] = json!(0)).is_err());
    assert!(build(&|query| query["order"]["by"] = json!({"aggregation": 1})).is_err());
    assert!(build(&|query| query["step"] = json!({"fixed": 0})).is_err());
    assert!(
        build(&|query| query["group_by"] = json!([
            {"field": "service"}, {"field": "name"}, {"attr": "a"}, {"attr": "b"}
        ]))
        .is_err()
    );
    assert!(
        build(&|query| query["group_by"] = json!([
            {"field": "service"}, {"field": "name"}, {"attr": "a"}
        ]))
        .is_ok()
    );
    assert!(
        build(&|query| query["group_by"] = json!([{"field": "service"}, {"field": "service"}]))
            .is_err()
    );
    assert!(build(&|query| query["aggregations"] = json!([])).is_err());
    assert!(
        build(&|query| query["aggregations"] =
            json!([{"function": "p95", "field": {"field": "service"}}]))
        .is_err()
    );
    assert!(build(&|query| query["aggregations"] = json!([{"function": "p95"}])).is_err());
    assert!(
        build(&|query| query["aggregations"] =
            json!([{"function": "count", "field": {"field": "duration"}}]))
        .is_err()
    );
}

#[test]
fn a_metrics_query_names_a_metric_and_its_two_aggregations() {
    let metrics = json!({
        "name": "mem",
        "signal": "metrics",
        "aggregations": [{"metric": "node_memory_working_set_bytes", "time": "avg", "space": "sum"}],
        "group_by": [{"attr": "node"}],
        "step": "auto"
    });
    let wrong_signal = {
        let mut query = metrics.clone();
        query["signal"] = json!("traces");
        query
    };
    let span_field = {
        let mut query = metrics.clone();
        query["group_by"] = json!([{"field": "trace_id"}]);
        query
    };

    let accepts = |query: Value| {
        parsed(document(
            vec![panel("p", "time_series", vec![query])],
            vec![],
        ))
        .is_ok()
    };

    assert!(accepts(metrics));
    assert!(!accepts(wrong_signal));
    assert!(!accepts(span_field));
}

#[test]
fn a_filter_nests_eight_levels_and_holds_thirty_two_conditions() {
    let nested = |levels: usize| {
        (1..levels).fold(
            json!({"field": "service", "op": "eq", "value": "a"}),
            |inner, _| json!({"not": inner}),
        )
    };
    let conditions = |count: usize| {
        json!({"all": (0..count)
            .map(|at| json!({"attr": "k", "op": "eq", "value": at}))
            .collect::<Vec<_>>()})
    };
    let with = |filter: Value| {
        let mut query = series_query();
        query["filter"] = filter;
        parsed(document(vec![panel("p", "bar", vec![query])], vec![])).is_ok()
    };

    assert!(with(nested(7)));
    assert!(!with(nested(9)));
    assert!(with(conditions(32)));
    assert!(!with(conditions(33)));
    assert!(!with(json!({"all": []})));
    assert!(!with(json!({"field": "service", "op": "gt", "value": 1})));
    assert!(!with(
        json!({"field": "service", "attr": "a", "op": "eq", "value": "a"})
    ));
    assert!(!with(
        json!({"field": "severity", "op": "eq", "value": "error"})
    ));
}

#[test]
fn an_integer_in_a_filter_is_written_back_as_an_integer() {
    let mut query = series_query();
    query["filter"] = json!({"attr": "retries", "op": "in", "value": [1, 2.5, 3]});
    let sent = document(vec![panel("p", "bar", vec![query])], vec![]);

    let read_back = serde_json::to_value(parsed(sent.clone()).expect("valid")).expect("serialises");

    assert_eq!(read_back, sent);
}

#[test]
fn a_document_refuses_a_field_it_does_not_define() {
    let mut sent = document(vec![], vec![]);
    sent["theme"] = json!("dark");

    assert!(refusal(sent).contains("theme"));
    let mut panel_with_extra = panel("p", "text", vec![]);
    panel_with_extra["colour"] = json!("red");

    assert!(refusal(document(vec![panel_with_extra], vec![])).contains("colour"));
}

#[test]
fn a_duration_is_between_a_minute_and_thirty_one_days() {
    let with = |secs: u64| {
        let mut sent = document(vec![], vec![]);
        sent["duration"] = json!(secs);
        parsed(sent).is_ok()
    };

    assert!(with(60));
    assert!(with(31 * 86_400));
    assert!(!with(59));
    assert!(!with(31 * 86_400 + 1));
}

#[test]
fn a_name_is_trimmed_not_empty_and_at_most_120_characters() {
    assert_eq!(
        DashboardName::try_from("  Checkout health ")
            .expect("a name")
            .as_str(),
        "Checkout health"
    );
    assert!(DashboardName::try_from("   ").is_err());
    assert!(DashboardName::try_from(&*"é".repeat(120)).is_ok());
    assert!(DashboardName::try_from(&*"é".repeat(121)).is_err());
    assert!(DashboardName::try_from("a\nb").is_err());
}

#[test]
fn a_copy_is_numbered_and_never_longer_than_a_name_may_be() {
    let name = DashboardName::try_from("Checkout").expect("a name");

    assert_eq!(name.copy(1).as_str(), "Checkout copy");
    assert_eq!(name.copy(2).as_str(), "Checkout copy 2");
    let long = DashboardName::try_from(&*"n".repeat(120)).expect("a name");
    assert_eq!(long.copy(12).as_str().chars().count(), 120);
}

#[test]
fn tags_are_bounded_and_unique() {
    assert!(Tags::parse(&["prod", "checkout"]).is_ok());
    assert!(Tags::parse(&["prod", "prod"]).is_err());
    assert!(Tags::parse(&[""]).is_err());
    assert!(Tags::parse(&(0..11).map(|at| at.to_string()).collect::<Vec<_>>()).is_err());
}
