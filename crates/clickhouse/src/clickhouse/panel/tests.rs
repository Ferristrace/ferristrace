use std::collections::BTreeMap;

use ferristrace_domain::dashboard::{
    Grid, Line, MAX_SERIES, PanelQuery, PanelResult, Scope, Variables,
};
use ferristrace_domain::{Expr, ProjectId, TenantId, Window};
use serde_json::{Value, json};
use uuid::Uuid;

use super::built::Built;
use super::shape::{self, MetricRow, SeriesRow, TableRow, samples_of};
use super::{distribution, events, metrics};
use crate::clickhouse::query::{Param, Table};

const SECOND: u64 = 1_000_000_000;
const HOUR: u64 = 3_600 * SECOND;
const BASE: u64 = 1_700_000_000 * SECOND;

fn scope() -> Scope {
    Scope {
        org: TenantId::new(Uuid::from_u128(1)),
        project: ProjectId::new(Uuid::from_u128(2)),
    }
}

fn hour() -> Window {
    Window::new(BASE, BASE + HOUR).expect("an hour")
}

fn query(value: Value) -> PanelQuery {
    serde_json::from_value(value).expect("a query")
}

fn per_service() -> PanelQuery {
    query(json!({
        "name": "spans", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "group_by": [{"field": "service"}],
        "step": "auto"
    }))
}

fn resolved(query: &PanelQuery, variables: &Variables) -> Option<Expr> {
    query
        .filter()
        .and_then(|filter| variables.resolve(filter).expect("resolved"))
}

fn marks(built: &Built) -> usize {
    built.sql.matches('?').count()
}

fn texts(built: &Built) -> Vec<&str> {
    built
        .params
        .iter()
        .filter_map(|param| match param {
            Param::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn series_of(query: &PanelQuery, table: Table, filter: Option<&Expr>) -> Built {
    let grid = Grid::new(hour(), query.step());
    events::series(table, scope(), hour(), query, filter, grid).expect("a statement")
}

#[test]
fn spec_l16_6_a_traces_count_per_service_groups_by_slot_and_service() {
    let built = series_of(&per_service(), Table::Spans, None);

    assert!(built.sql.contains("FROM spans FINAL"), "{}", built.sql);
    assert!(built.sql.contains("count()"), "{}", built.sql);
    assert!(
        built.sql.contains("toString(service_name)"),
        "{}",
        built.sql
    );
    assert!(
        built.sql.contains("GROUP BY slot, grp ORDER BY slot"),
        "{}",
        built.sql
    );
    assert!(
        built.sql.contains("tenant_id = ? AND project_id = ?"),
        "{}",
        built.sql
    );
    assert_eq!(marks(&built), built.params.len());
    assert!(built.params.contains(&Param::Id(scope().org.as_uuid())));
    assert!(built.params.contains(&Param::Id(scope().project.as_uuid())));
}

#[test]
fn spec_l16_7_a_logs_error_count_is_rows_ordered_by_count_descending() {
    let rows = query(json!({
        "name": "errors", "signal": "logs",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "severity", "op": "eq", "value": "error"},
        "group_by": [{"field": "service"}],
        "step": "total"
    }));
    let filter = resolved(&rows, &Variables::none());

    let built = events::rows(
        Table::Logs,
        scope(),
        hour(),
        &rows,
        filter.as_ref(),
        3600.0,
        101,
    )
    .expect("a statement");

    assert!(built.sql.contains("FROM logs WHERE"), "{}", built.sql);
    assert!(!built.sql.contains("FINAL"), "{}", built.sql);
    assert!(built.sql.contains("toString(severity)"), "{}", built.sql);
    assert!(
        built
            .sql
            .contains("GROUP BY grp ORDER BY vals[1] DESC NULLS LAST, grp LIMIT ?"),
        "{}",
        built.sql
    );
    assert_eq!(marks(&built), built.params.len());
    assert_eq!(built.params.last(), Some(&Param::Whole(101)));
    assert!(texts(&built).contains(&"error"));
}

#[test]
fn an_order_by_a_group_or_an_aggregation_names_its_column() {
    let by = |order: Value| {
        let ordered = query(json!({
            "name": "n", "signal": "traces",
            "aggregations": [{"function": "count"}, {"function": "p95", "field": {"field": "duration"}}],
            "group_by": [{"field": "name"}], "order": order, "step": "total"
        }));
        events::rows(Table::Spans, scope(), hour(), &ordered, None, 1.0, 11)
            .expect("a statement")
            .sql
    };

    assert!(by(json!({"by": "group", "direction": "asc"})).contains("ORDER BY grp ASC LIMIT"));
    assert!(
        by(json!({"by": {"aggregation": 1}, "direction": "desc"}))
            .contains("ORDER BY vals[2] DESC NULLS LAST, grp LIMIT")
    );
}

#[test]
fn spec_l16_10_a_hostile_variable_value_is_a_bound_parameter_never_sql() {
    let hostile = "x') OR 1=1; DROP TABLE spans --";
    let filtered = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "service", "op": "eq", "value": {"var": "svc"}},
        "step": "auto"
    }));
    let variables = Variables::new(BTreeMap::from([(
        "svc".to_owned(),
        vec![hostile.to_owned()],
    )]))
    .expect("variables");
    let filter = resolved(&filtered, &variables);

    let built = series_of(&filtered, Table::Spans, filter.as_ref());

    assert!(!built.sql.contains("DROP"), "{}", built.sql);
    assert!(!built.sql.contains("1=1"), "{}", built.sql);
    assert!(!built.sql.contains(hostile));
    assert!(built.sql.contains("service_name = ?"), "{}", built.sql);
    assert_eq!(texts(&built), vec![hostile]);
    assert_eq!(marks(&built), built.params.len());
}

#[test]
fn spec_l16_10_several_values_become_in_with_one_parameter_each() {
    let filtered = query(json!({
        "name": "n", "signal": "logs",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "service", "op": "eq", "value": {"var": "svc"}},
        "step": "auto"
    }));
    let variables = Variables::new(BTreeMap::from([(
        "svc".to_owned(),
        vec!["a')".to_owned(), "b".to_owned()],
    )]))
    .expect("variables");
    let filter = resolved(&filtered, &variables);

    let built = series_of(&filtered, Table::Logs, filter.as_ref());

    assert_eq!(texts(&built), vec!["a')", "b"]);
    assert_eq!(marks(&built), built.params.len());
    assert_eq!(
        built.sql.matches("service_name = ?").count(),
        2,
        "{}",
        built.sql
    );
}

#[test]
fn a_dropped_variable_leaves_no_clause_and_no_parameter() {
    let filtered = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "service", "op": "eq", "value": {"var": "svc"}},
        "step": "auto"
    }));
    let filter = resolved(&filtered, &Variables::none());

    let built = series_of(&filtered, Table::Spans, filter.as_ref());

    assert!(!built.sql.contains("service_name = ?"), "{}", built.sql);
    assert!(texts(&built).is_empty());
}

#[test]
fn attributes_are_read_through_bound_keys() {
    let by_attribute = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "avg", "field": {"attr": "cart.size"}}],
        "group_by": [{"attr": "k8s.pod.name"}],
        "step": "auto"
    }));

    let built = series_of(&by_attribute, Table::Spans, None);

    assert!(built.sql.contains("attributes[?]"), "{}", built.sql);
    assert!(!built.sql.contains("cart.size"));
    assert_eq!(texts(&built), vec!["k8s.pod.name", "cart.size"]);
    assert_eq!(marks(&built), built.params.len());
}

#[test]
fn a_percentile_uses_quantile_over_the_span_duration_and_a_rate_divides_by_the_step() {
    let timed = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [
            {"function": "p95", "field": {"field": "duration"}},
            {"function": "rate"}
        ],
        "step": {"fixed": 60}
    }));

    let built = series_of(&timed, Table::Spans, None);

    assert!(built.sql.contains("quantile(0.95)("), "{}", built.sql);
    assert!(built.sql.contains("count() / ?"), "{}", built.sql);
    assert!(built.params.contains(&Param::Float(60.0)));
    assert_eq!(marks(&built), built.params.len());
}

#[test]
fn the_group_count_statement_is_scoped_and_capped() {
    let built = events::groups(Table::Spans, scope(), hour(), &per_service(), None);

    assert!(built.sql.contains("tenant_id = ? AND project_id = ?"));
    assert!(built.sql.contains("LIMIT 10000"), "{}", built.sql);
    assert_eq!(marks(&built), built.params.len());
}

#[test]
fn spec_l16_8_a_metric_per_node_reads_points_by_metric_name_and_label() {
    let memory = query(json!({
        "name": "memory", "signal": "metrics",
        "aggregations": [{"metric": "node.memory.usage", "time": "avg", "space": "avg"}],
        "group_by": [{"attr": "k8s.node.name"}],
        "step": "auto"
    }));
    let ferristrace_domain::dashboard::Aggregation::Metric(held) = &memory.aggregations()[0] else {
        panic!("a metric aggregation");
    };
    let grid = Grid::new(hour(), memory.step());

    let built = metrics::series(scope(), hour(), &memory, held, None, grid, None);

    assert!(built.sql.contains("FROM metric_points"), "{}", built.sql);
    assert!(
        built
            .sql
            .contains("tenant_id = ? AND project_id = ? AND name = ?"),
        "{}",
        built.sql
    );
    assert!(built.sql.contains("avg(per_series)"), "{}", built.sql);
    assert_eq!(texts(&built), vec!["k8s.node.name", "node.memory.usage"]);
    assert_eq!(marks(&built), built.params.len());
}

#[test]
fn a_counter_rate_tells_cumulative_from_delta() {
    let rate = query(json!({
        "name": "r", "signal": "metrics",
        "aggregations": [{"metric": "http.requests", "time": "rate", "space": "sum"}],
        "step": {"fixed": 30}
    }));
    let ferristrace_domain::dashboard::Aggregation::Metric(held) = &rate.aggregations()[0] else {
        panic!("a metric aggregation");
    };

    let built = metrics::series(
        scope(),
        hour(),
        &rate,
        held,
        None,
        Grid::new(hour(), rate.step()),
        None,
    );

    assert!(built.sql.contains("temporality = 'cumulative'"));
    assert!(built.sql.contains("total / 30.0"), "{}", built.sql);
    assert!(built.sql.contains("sum(per_series)"));
}

#[test]
fn a_histogram_and_a_heatmap_bind_their_bounds() {
    let measured = ferristrace_domain::Field::Duration;
    let source = distribution::Source {
        table: Table::Spans,
        name: None,
        measured: Some(&measured),
    };
    let grid = Grid::new(hour(), ferristrace_domain::dashboard::Step::Auto);

    let buckets = distribution::buckets(source, scope(), hour(), None, 10.0, 2.5);
    let heat = distribution::heat(source, scope(), hour(), None, grid, 10.0, 2.5);

    for built in [&buckets, &heat] {
        assert_eq!(marks(built), built.params.len(), "{}", built.sql);
        assert!(built.params.contains(&Param::Float(10.0)));
        assert!(built.params.contains(&Param::Float(2.5)));
        assert!(built.sql.contains("least(floor("), "{}", built.sql);
    }
    assert!(heat.sql.contains("GROUP BY slot, bucket"));
}

fn sample(slot: i64, group: &[&str], values: &[Option<f64>]) -> SeriesRow {
    SeriesRow {
        slot,
        grp: group.iter().map(|part| (*part).to_owned()).collect(),
        vals: values.to_vec(),
    }
}

fn points_of(lines: &[Line], service: &str) -> Vec<(u64, f64)> {
    lines
        .iter()
        .find(|line| line.labels.values().any(|value| &**value == service))
        .expect("the series")
        .points
        .clone()
}

#[test]
fn spec_l16_6_one_series_per_service_with_empty_slots_counted_as_zero() {
    let counted = per_service();
    let grid = Grid::new(hour(), counted.step());
    let rows = vec![
        sample(0, &["api"], &[Some(3.0)]),
        sample(1, &["api"], &[Some(4.0)]),
        sample(1, &["web"], &[Some(1.0)]),
    ];

    let lines = shape::lines(samples_of(&rows), &counted, grid);

    assert_eq!(lines.len(), 2);
    let api = points_of(&lines, "api");
    assert_eq!(api.len(), 120);
    assert_eq!(api[0], (BASE, 3.0));
    assert_eq!(api[1], (BASE + 30 * SECOND, 4.0));
    assert_eq!(api[2], (BASE + 60 * SECOND, 0.0));
    assert_eq!(lines[0].labels.get("service").map(|v| &**v), Some("api"));
}

#[test]
fn an_average_leaves_an_empty_slot_out_instead_of_inventing_zero() {
    let averaged = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "avg", "field": {"field": "duration"}}],
        "step": "auto"
    }));
    let grid = Grid::new(hour(), averaged.step());
    let rows = vec![sample(5, &[], &[Some(7.0)]), sample(6, &[], &[None])];

    let lines = shape::lines(samples_of(&rows), &averaged, grid);

    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].points, vec![(BASE + 150 * SECOND, 7.0)]);
    assert!(lines[0].labels.is_empty());
}

#[test]
fn an_empty_ungrouped_count_is_one_flat_series() {
    let counted = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}], "step": {"fixed": 600}
    }));
    let grid = Grid::new(hour(), counted.step());

    let lines = shape::lines(samples_of(&[]), &counted, grid);

    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].points.len(), 6);
    assert!(lines[0].points.iter().all(|(_, value)| *value == 0.0));
}

#[test]
fn several_aggregations_are_told_apart_by_a_label() {
    let two = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}, {"function": "p99", "field": {"field": "duration"}}],
        "step": "auto"
    }));
    let grid = Grid::new(hour(), two.step());
    let rows = vec![sample(0, &[], &[Some(1.0), Some(9.0)])];

    let lines = shape::lines(samples_of(&rows), &two, grid);

    let names: Vec<_> = lines
        .iter()
        .map(|line| line.labels.get("aggregation").map(ToString::to_string))
        .collect();
    assert_eq!(
        names,
        vec![Some("count".to_owned()), Some("p99(duration)".to_owned())]
    );
}

#[test]
fn rows_carry_group_then_aggregation_columns_and_the_truncation_flag() {
    let grouped = query(json!({
        "name": "errors", "signal": "logs",
        "aggregations": [{"function": "count"}],
        "group_by": [{"field": "service"}], "step": "total"
    }));
    let rows = vec![
        TableRow {
            grp: vec!["api".to_owned()],
            vals: vec![Some(9.0)],
        },
        TableRow {
            grp: vec!["web".to_owned()],
            vals: vec![None],
        },
    ];

    let result = shape::table(rows, &grouped, true);

    assert_eq!(
        serde_json::to_value(result).expect("json"),
        json!({
            "kind": "rows",
            "columns": ["service", "count"],
            "rows": [["api", 9.0], ["web", null]],
            "truncated": true
        })
    );
    assert!(matches!(
        shape::table(Vec::new(), &grouped, false),
        PanelResult::Rows { rows, .. } if rows.is_empty()
    ));
}

#[test]
fn a_scalar_is_the_first_value_and_null_when_there_is_none() {
    let full = [TableRow {
        grp: Vec::new(),
        vals: vec![Some(42.0)],
    }];

    assert_eq!(
        shape::scalar(&full),
        PanelResult::Scalar { value: Some(42.0) }
    );
    assert_eq!(shape::scalar(&[]), PanelResult::Scalar { value: None });
}

#[test]
fn metric_rows_merge_by_label_and_sort_by_the_asked_order() {
    let merged = shape::merged(vec![
        vec![
            MetricRow {
                slot: 0,
                labels: vec!["n1".to_owned()],
                value: Some(1.0),
            },
            MetricRow {
                slot: 0,
                labels: vec!["n2".to_owned()],
                value: Some(5.0),
            },
        ],
        vec![MetricRow {
            slot: 0,
            labels: vec!["n1".to_owned()],
            value: Some(2.0),
        }],
    ]);
    let mut rows = merged;

    shape::ordered(&mut rows, None);

    assert_eq!(rows[0].grp, vec!["n2".to_owned()]);
    assert_eq!(rows[0].vals, vec![Some(5.0), None]);
    assert_eq!(rows[1].vals, vec![Some(1.0), Some(2.0)]);
}

#[test]
fn bands_split_the_range_in_thirty_or_one_when_flat() {
    assert_eq!(shape::bands(0.0, 300.0), (10.0, 30));
    assert_eq!(shape::bands(5.0, 5.0), (1.0, 1));
}

#[test]
fn buckets_cover_the_whole_range_with_zeros_for_empty_ones() {
    let rows = [
        shape::BucketRow { bucket: 0, n: 2 },
        shape::BucketRow { bucket: 29, n: 1 },
    ];

    let PanelResult::Buckets { buckets } = shape::buckets(&rows, 0.0, 10.0, 30) else {
        panic!("buckets");
    };

    assert_eq!(buckets.len(), 30);
    assert_eq!(
        (buckets[0].from, buckets[0].to, buckets[0].count),
        (0.0, 10.0, 2)
    );
    assert_eq!(buckets[1].count, 0);
    assert_eq!(buckets[29].count, 1);
}

#[test]
fn a_heat_map_lists_every_slot_and_every_band() {
    let grid = Grid::new(hour(), ferristrace_domain::dashboard::Step::Auto);
    let rows = [shape::HeatRow {
        slot: 1,
        bucket: 2,
        n: 7,
    }];

    let PanelResult::Heat { x, y, cells } = shape::heat(&rows, grid, 0.0, 1.0, 30) else {
        panic!("heat");
    };

    assert_eq!(x.len(), 120);
    assert_eq!(y.len(), 30);
    assert_eq!(cells, vec![(1, 2, 7)]);
}

#[test]
fn spec_l16_9_the_series_cap_is_fifty() {
    assert_eq!(MAX_SERIES, 50);
    assert!(super::refuse_beyond(50).is_ok());
    assert_eq!(
        super::refuse_beyond(51),
        Err(ferristrace_domain::dashboard::QueryError::TooManySeries { count: 51, max: 50 })
    );
}

#[test]
fn a_metrics_table_pushes_its_order_and_limit_into_the_statement() {
    let table = query(json!({
        "name": "t", "signal": "metrics",
        "aggregations": [{"metric": "node.memory.usage", "time": "avg", "space": "avg"}],
        "group_by": [{"attr": "k8s.node.name"}],
        "order": {"by": {"aggregation": 0}, "direction": "asc"},
        "step": "total"
    }));
    let ferristrace_domain::dashboard::Aggregation::Metric(held) = &table.aggregations()[0] else {
        panic!("a metric aggregation");
    };
    let top = metrics::Top {
        order: table.order(),
        fetched: 11,
    };

    let built = metrics::series(
        scope(),
        hour(),
        &table,
        held,
        None,
        Grid::new(hour(), table.step()),
        Some(top),
    );

    assert!(
        built
            .sql
            .ends_with("GROUP BY slot, labels ORDER BY value ASC NULLS LAST, labels LIMIT ?"),
        "{}",
        built.sql
    );
    assert_eq!(built.params.last(), Some(&Param::Whole(11)));
    assert_eq!(marks(&built), built.params.len());
}

#[test]
fn spec_l16_9_the_output_of_the_series_is_capped_too() {
    let counted = per_service();
    let grid = Grid::new(hour(), counted.step());
    let rows: Vec<SeriesRow> = (0..51)
        .map(|at| sample(0, &[&format!("svc-{at}")], &[Some(1.0)]))
        .collect();

    let lines = shape::lines(samples_of(&rows), &counted, grid);

    assert_eq!(
        super::capped(lines),
        Err(ferristrace_domain::dashboard::QueryError::TooManySeries { count: 51, max: 50 })
    );
}

#[test]
fn a_distribution_keeps_only_finite_values() {
    let measured = ferristrace_domain::Field::Duration;
    let source = distribution::Source {
        table: Table::Spans,
        name: None,
        measured: Some(&measured),
    };
    let grid = Grid::new(hour(), ferristrace_domain::dashboard::Step::Auto);

    let built = [
        distribution::extent(source, scope(), hour(), None),
        distribution::buckets(source, scope(), hour(), None, 0.0, 1.0),
        distribution::heat(source, scope(), hour(), None, grid, 0.0, 1.0),
    ];

    for statement in built {
        assert!(statement.sql.contains("isFinite("), "{}", statement.sql);
        assert!(!statement.sql.contains("IS NOT NULL"));
    }
}
