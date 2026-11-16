use std::collections::BTreeMap;
use std::time::Duration;

use clickhouse::Client;
use ferristrace_clickhouse::{
    BatchLimits, ClickhouseLogSink, ClickhouseMetricSink, ClickhouseMigrator,
    ClickhousePanelReader, ClickhouseSink,
};
use ferristrace_domain::dashboard::{
    PanelKind, PanelQuery, PanelResult, QueryError, Scope as PanelScope, Variables,
};
use ferristrace_domain::{
    LogRecord, LogSink, Metric, MetricData, MetricPoint, MetricSink, PanelReader, ProjectId, Scope,
    Severity, Span, SpanId, SpanKind, SpanSink, SpanStatus, Temporality, TenantId, TraceId, Window,
};
use ferristrace_infra::FixedClock;
use serde_json::{Value, json};
use uuid::Uuid;

mod backend;

const NOW: u64 = 4_000_000_000;
const BASE: u64 = 1_700_000_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const MILLI: u64 = 1_000_000;
const HOUR: u64 = 3_600 * SECOND;
const DAY: u64 = 24 * 3_600;
const MINE: u128 = 1;
const THEIRS: u128 = 2;
const OURS: u128 = 10;
const OTHER: u128 = 11;

fn connected(url: &str) -> Client {
    let mut client = Client::default().with_url(url);
    if let Ok(user) = std::env::var("CLICKHOUSE_USER") {
        client = client.with_user(user);
    }
    if let Ok(password) = std::env::var("CLICKHOUSE_PASSWORD") {
        client = client.with_password(password);
    }
    client
}

async fn prepared(name: &str) -> Option<Client> {
    let url = backend::clickhouse_url()?;
    let root = connected(&url);
    root.query(&format!("DROP DATABASE IF EXISTS {name}"))
        .execute()
        .await
        .expect("dropping a leftover database");
    root.query(&format!("CREATE DATABASE {name}"))
        .execute()
        .await
        .expect("creating the test database");
    let client = connected(&url).with_database(name);
    ClickhouseMigrator::new(client.clone())
        .up()
        .await
        .expect("the migrations apply");
    Some(client)
}

fn org(seed: u128) -> TenantId {
    TenantId::new(Uuid::from_u128(seed))
}

fn project(seed: u128) -> ProjectId {
    ProjectId::new(Uuid::from_u128(seed))
}

fn ours() -> PanelScope {
    PanelScope {
        org: org(MINE),
        project: project(OURS),
    }
}

fn hour() -> Window {
    Window::new(BASE, BASE + HOUR).expect("an hour")
}

fn written(who: u128, seed: u128) -> Scope {
    Scope::of(org(who)).in_project(Some(project(seed)))
}

fn batching() -> BatchLimits {
    BatchLimits {
        max_rows: 100_000,
        period: Duration::from_secs(60),
    }
}

fn retention() -> Duration {
    Duration::from_secs(30 * DAY)
}

fn a_span(
    seed: u16,
    service: &str,
    second: u64,
    millis: u64,
    failed: bool,
    attributes: &[(&str, &str)],
) -> Span {
    let [high, low] = (seed + 1).to_be_bytes();
    let mut trace = [0_u8; 16];
    trace[14] = high;
    trace[15] = low;
    let mut span = [0_u8; 8];
    span[6] = high;
    span[7] = low;
    let start = BASE + second * SECOND;
    Span {
        trace_id: TraceId::try_from(trace.as_slice()).expect("sixteen bytes"),
        span_id: SpanId::try_from(span.as_slice()).expect("eight bytes"),
        parent: None,
        name: "work".into(),
        service_name: service.into(),
        kind: SpanKind::Server,
        status: if failed {
            SpanStatus::Error
        } else {
            SpanStatus::Ok
        },
        start_unix_nanos: start,
        end_unix_nanos: start + millis * MILLI,
        attributes: attributes
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect(),
        events: Vec::new(),
    }
}

async fn spans_in(client: &Client, scope: Scope, spans: Vec<Span>) {
    let sink = ClickhouseSink::new(client, batching(), retention(), FixedClock::at(NOW));
    sink.accept(scope, spans).await.expect("spans accepted");
    sink.flush().await.expect("spans flushed");
}

fn a_log(second: u64, service: &str, severity: Severity, body: &str) -> LogRecord {
    LogRecord {
        time_unix_nanos: BASE + second * SECOND,
        observed_unix_nanos: BASE + second * SECOND + 1,
        severity,
        severity_number: 0,
        service_name: service.into(),
        body: body.into(),
        attributes: BTreeMap::new(),
        resource: BTreeMap::new(),
        trace_id: None,
        span_id: None,
    }
}

async fn logs_in(client: &Client, scope: Scope, records: Vec<LogRecord>) {
    let sink = ClickhouseLogSink::new(client, batching(), retention(), FixedClock::at(NOW));
    sink.accept_logs(scope, records)
        .await
        .expect("logs accepted");
    sink.flush().await.expect("logs flushed");
}

fn a_point(second: u64, value: f64, node: &str) -> MetricPoint {
    MetricPoint {
        time_unix_nanos: BASE + second * SECOND,
        value,
        attributes: BTreeMap::from([("k8s.node.name".into(), node.into())]),
        exemplars: Vec::new(),
    }
}

async fn metrics_in(client: &Client, scope: Scope, metrics: Vec<Metric>) {
    let sink = ClickhouseMetricSink::new(client, batching(), retention(), FixedClock::at(NOW));
    sink.accept_metrics(scope, metrics)
        .await
        .expect("metrics accepted");
    sink.flush().await.expect("metrics flushed");
}

fn gauge(name: &str, points: Vec<MetricPoint>) -> Metric {
    Metric {
        name: name.into(),
        unit: "By".into(),
        description: String::new().into(),
        service_name: "kubelet".into(),
        data: MetricData::Gauge(points),
    }
}

fn query(value: Value) -> PanelQuery {
    serde_json::from_value(value).expect("a query")
}

async fn run(
    client: &Client,
    kind: PanelKind,
    query: &PanelQuery,
    variables: &Variables,
) -> Result<PanelResult, QueryError> {
    ClickhousePanelReader::new(client.clone())
        .run(ours(), query, kind, hour(), variables)
        .await
}

fn named(entries: &[(&str, &[&str])]) -> Variables {
    Variables::new(
        entries
            .iter()
            .map(|(name, values)| {
                (
                    (*name).to_owned(),
                    values.iter().map(|value| (*value).to_owned()).collect(),
                )
            })
            .collect(),
    )
    .expect("variables")
}

fn series_of(result: PanelResult) -> BTreeMap<String, Vec<(u64, f64)>> {
    let PanelResult::Series { series } = result else {
        panic!("a series result, got {result:?}");
    };
    series
        .into_iter()
        .map(|line| {
            let label = line
                .labels
                .values()
                .next()
                .map_or_else(String::new, ToString::to_string);
            (label, line.points)
        })
        .collect()
}

fn total(points: &[(u64, f64)]) -> f64 {
    points.iter().map(|(_, value)| value).sum()
}

fn count_per_service() -> PanelQuery {
    query(json!({
        "name": "spans", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "group_by": [{"field": "service"}],
        "step": "auto"
    }))
}

#[tokio::test]
async fn spec_l16_6_a_traces_count_per_service_over_an_hour_is_one_series_per_service() {
    let Some(client) = prepared("ferristrace_panel_traces").await else {
        return;
    };
    let mut spans = Vec::new();
    for at in 0..6 {
        spans.push(a_span(at, "checkout", u64::from(at) * 600, 10, false, &[]));
    }
    for at in 6..9 {
        spans.push(a_span(at, "cart", u64::from(at) * 300, 10, false, &[]));
    }
    spans_in(&client, written(MINE, OURS), spans).await;
    spans_in(
        &client,
        written(MINE, OTHER),
        vec![a_span(100, "elsewhere", 5, 10, false, &[])],
    )
    .await;
    spans_in(
        &client,
        written(THEIRS, OURS),
        vec![a_span(101, "stranger", 5, 10, false, &[])],
    )
    .await;

    let result = run(
        &client,
        PanelKind::TimeSeries,
        &count_per_service(),
        &Variables::none(),
    )
    .await
    .expect("the panel runs");

    let series = series_of(result);
    assert_eq!(
        series.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["cart", "checkout"]
    );
    assert_eq!(total(&series["checkout"]), 6.0);
    assert_eq!(total(&series["cart"]), 3.0);
    assert_eq!(series["checkout"].len(), 120);
    assert_eq!(series["checkout"][0].0, BASE);
}

#[tokio::test]
async fn spec_l16_7_error_logs_per_service_are_rows_ordered_by_count_descending() {
    let Some(client) = prepared("ferristrace_panel_logs").await else {
        return;
    };
    let mut records = Vec::new();
    for at in 0..5 {
        records.push(a_log(at, "cart", Severity::Error, "boom"));
    }
    for at in 0..2 {
        records.push(a_log(at, "checkout", Severity::Error, "boom"));
    }
    records.push(a_log(1, "checkout", Severity::Info, "fine"));
    for at in 0..9 {
        records.push(a_log(at, "search", Severity::Warn, "slow"));
    }
    logs_in(&client, written(MINE, OURS), records).await;
    logs_in(
        &client,
        written(THEIRS, OURS),
        vec![a_log(1, "stranger", Severity::Error, "boom")],
    )
    .await;
    let errors = query(json!({
        "name": "errors", "signal": "logs",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "severity", "op": "eq", "value": "error"},
        "group_by": [{"field": "service"}],
        "order": {"by": {"aggregation": 0}, "direction": "desc"},
        "step": "total"
    }));

    let result = run(&client, PanelKind::Table, &errors, &Variables::none())
        .await
        .expect("the panel runs");

    assert_eq!(
        serde_json::to_value(result).expect("json"),
        json!({
            "kind": "rows", "columns": ["service", "count"],
            "rows": [["cart", 5.0], ["checkout", 2.0]], "truncated": false
        })
    );
}

#[tokio::test]
async fn a_row_limit_cuts_the_table_and_says_so() {
    let Some(client) = prepared("ferristrace_panel_limit").await else {
        return;
    };
    let records = ["a", "b", "c"]
        .iter()
        .map(|service| a_log(1, service, Severity::Error, "boom"))
        .collect();
    logs_in(&client, written(MINE, OURS), records).await;
    let limited = query(json!({
        "name": "n", "signal": "logs",
        "aggregations": [{"function": "count"}],
        "group_by": [{"field": "service"}],
        "limit": 2, "step": "total"
    }));

    let result = run(&client, PanelKind::List, &limited, &Variables::none())
        .await
        .expect("the panel runs");

    let PanelResult::Rows {
        rows, truncated, ..
    } = result
    else {
        panic!("rows");
    };
    assert_eq!(rows.len(), 2);
    assert!(truncated);
}

#[tokio::test]
async fn spec_l16_8_node_memory_per_node_is_one_series_per_node() {
    let Some(client) = prepared("ferristrace_panel_metrics").await else {
        return;
    };
    let mut points = Vec::new();
    for second in (0..600).step_by(60) {
        points.push(a_point(second, 100.0, "node-a"));
        points.push(a_point(second, 300.0, "node-b"));
    }
    metrics_in(
        &client,
        written(MINE, OURS),
        vec![gauge("node.memory.usage", points)],
    )
    .await;
    metrics_in(
        &client,
        written(THEIRS, OURS),
        vec![gauge(
            "node.memory.usage",
            vec![a_point(10, 999.0, "node-stranger")],
        )],
    )
    .await;
    let memory = query(json!({
        "name": "memory", "signal": "metrics",
        "aggregations": [{"metric": "node.memory.usage", "time": "avg", "space": "avg"}],
        "group_by": [{"attr": "k8s.node.name"}],
        "step": {"fixed": 60}
    }));

    let result = run(&client, PanelKind::TimeSeries, &memory, &Variables::none())
        .await
        .expect("the panel runs");

    let series = series_of(result);
    assert_eq!(
        series.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["node-a", "node-b"]
    );
    assert_eq!(series["node-a"].len(), 10);
    assert!(
        series["node-a"]
            .iter()
            .all(|(_, value)| (*value - 100.0).abs() < 1e-9)
    );
    assert!(
        series["node-b"]
            .iter()
            .all(|(_, value)| (*value - 300.0).abs() < 1e-9)
    );
}

#[tokio::test]
async fn a_counter_rate_is_its_delta_per_second_of_the_step() {
    let Some(client) = prepared("ferristrace_panel_rate").await else {
        return;
    };
    let counter = Metric {
        name: "http.requests".into(),
        unit: "1".into(),
        description: String::new().into(),
        service_name: "checkout".into(),
        data: MetricData::Sum {
            monotonic: true,
            temporality: Temporality::Delta,
            points: vec![a_point(0, 60.0, "n"), a_point(30, 60.0, "n")],
        },
    };
    metrics_in(&client, written(MINE, OURS), vec![counter]).await;
    let rate = query(json!({
        "name": "r", "signal": "metrics",
        "aggregations": [{"metric": "http.requests", "time": "rate", "space": "sum"}],
        "step": {"fixed": 60}
    }));

    let result = run(&client, PanelKind::TimeSeries, &rate, &Variables::none())
        .await
        .expect("the panel runs");

    let series = series_of(result);
    assert_eq!(series[""][0], (BASE, 2.0));
}

#[tokio::test]
async fn metrics_as_a_number_is_the_aggregate_over_the_range() {
    let Some(client) = prepared("ferristrace_panel_number").await else {
        return;
    };
    metrics_in(
        &client,
        written(MINE, OURS),
        vec![gauge(
            "node.memory.usage",
            vec![a_point(1, 100.0, "a"), a_point(2, 300.0, "b")],
        )],
    )
    .await;
    let number = query(json!({
        "name": "n", "signal": "metrics",
        "aggregations": [{"metric": "node.memory.usage", "time": "max", "space": "sum"}],
        "step": "total"
    }));

    let result = run(&client, PanelKind::Number, &number, &Variables::none())
        .await
        .expect("the panel runs");

    assert_eq!(result, PanelResult::Scalar { value: Some(400.0) });
}

#[tokio::test]
async fn spec_l16_9_fifty_one_series_are_refused_with_the_count_and_fifty_are_served() {
    let Some(client) = prepared("ferristrace_panel_cap").await else {
        return;
    };
    let services: Vec<String> = (0..51).map(|at| format!("svc-{at:02}")).collect();
    let spans = |names: &[String]| -> Vec<Span> {
        names
            .iter()
            .enumerate()
            .map(|(at, name)| a_span(u16::try_from(at).expect("small"), name, 5, 10, false, &[]))
            .collect()
    };
    spans_in(&client, written(MINE, OURS), spans(&services)).await;

    let refused = run(
        &client,
        PanelKind::TimeSeries,
        &count_per_service(),
        &Variables::none(),
    )
    .await;
    let narrowed = query(json!({
        "name": "spans", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "service", "op": "ne", "value": "svc-00"},
        "group_by": [{"field": "service"}],
        "step": "auto"
    }));
    let served = run(
        &client,
        PanelKind::TimeSeries,
        &narrowed,
        &Variables::none(),
    )
    .await;

    assert_eq!(
        refused,
        Err(QueryError::TooManySeries { count: 51, max: 50 })
    );
    assert_eq!(series_of(served.expect("fifty are served")).len(), 50);
}

#[tokio::test]
async fn spec_l16_10_a_variable_value_with_a_quote_or_a_parenthesis_filters_by_that_text_only() {
    let Some(client) = prepared("ferristrace_panel_injection").await else {
        return;
    };
    let hostile = "x') OR 1=1 --";
    spans_in(
        &client,
        written(MINE, OURS),
        vec![
            a_span(1, hostile, 5, 10, false, &[]),
            a_span(2, "checkout", 6, 10, false, &[]),
            a_span(3, "cart", 7, 10, false, &[("note", "it's (fine)")]),
        ],
    )
    .await;
    let filtered = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "service", "op": "eq", "value": {"var": "svc"}},
        "step": "total"
    }));
    let by_attribute = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}],
        "filter": {"attr": "note", "op": "eq", "value": {"var": "note"}},
        "step": "total"
    }));

    let hostile_only = run(
        &client,
        PanelKind::Number,
        &filtered,
        &named(&[("svc", &[hostile])]),
    )
    .await
    .expect("runs");
    let both = run(
        &client,
        PanelKind::Number,
        &filtered,
        &named(&[("svc", &[hostile, "checkout"])]),
    )
    .await
    .expect("runs");
    let dropped = run(&client, PanelKind::Number, &filtered, &Variables::none())
        .await
        .expect("runs");
    let quoted = run(
        &client,
        PanelKind::Number,
        &by_attribute,
        &named(&[("note", &["it's (fine)"])]),
    )
    .await
    .expect("runs");
    let nothing = run(
        &client,
        PanelKind::Number,
        &by_attribute,
        &named(&[("note", &["it's (fine)' OR '1'='1"])]),
    )
    .await
    .expect("runs");

    assert_eq!(hostile_only, PanelResult::Scalar { value: Some(1.0) });
    assert_eq!(both, PanelResult::Scalar { value: Some(2.0) });
    assert_eq!(dropped, PanelResult::Scalar { value: Some(3.0) });
    assert_eq!(quoted, PanelResult::Scalar { value: Some(1.0) });
    assert_eq!(nothing, PanelResult::Scalar { value: Some(0.0) });
}

async fn latencies(client: &Client) {
    let spans = (0..40)
        .map(|at| {
            a_span(
                at,
                "checkout",
                u64::from(at) * 60,
                u64::from(at) + 1,
                false,
                &[("cart.size", &(at % 5).to_string())],
            )
        })
        .collect();
    spans_in(client, written(MINE, OURS), spans).await;
}

#[tokio::test]
async fn a_percentile_a_histogram_a_heatmap_and_a_scatter_read_span_durations() {
    let Some(client) = prepared("ferristrace_panel_shapes").await else {
        return;
    };
    latencies(&client).await;
    let p95 = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "p95", "field": {"field": "duration"}}],
        "step": "total"
    }));
    let histogram = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "avg", "field": {"field": "duration"}}],
        "step": "total"
    }));
    let heat = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "avg", "field": {"field": "duration"}}],
        "step": {"fixed": 600}
    }));
    let scatter = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [
            {"function": "count"},
            {"function": "avg", "field": {"field": "duration"}}
        ],
        "group_by": [{"attr": "cart.size"}],
        "step": "total"
    }));

    let number = run(&client, PanelKind::Number, &p95, &Variables::none())
        .await
        .expect("runs");
    let buckets = run(
        &client,
        PanelKind::Histogram,
        &histogram,
        &Variables::none(),
    )
    .await
    .expect("runs");
    let cells = run(&client, PanelKind::Heatmap, &heat, &Variables::none())
        .await
        .expect("runs");
    let pairs = run(&client, PanelKind::Scatter, &scatter, &Variables::none())
        .await
        .expect("runs");

    let PanelResult::Scalar { value: Some(p95) } = number else {
        panic!("a scalar");
    };
    assert!(
        (p95 - 38.0 * MILLI as f64).abs() < 2.0 * MILLI as f64,
        "{p95}"
    );
    let PanelResult::Buckets { buckets } = buckets else {
        panic!("buckets");
    };
    assert_eq!(buckets.len(), 30);
    assert_eq!(buckets.iter().map(|bucket| bucket.count).sum::<u64>(), 40);
    assert_eq!(buckets[0].from, MILLI as f64);
    let PanelResult::Heat { x, y, cells } = cells else {
        panic!("heat");
    };
    assert_eq!(x.len(), 6);
    assert_eq!(y.len(), 30);
    assert_eq!(cells.iter().map(|(_, _, count)| count).sum::<u64>(), 40);
    let PanelResult::Pairs { points } = pairs else {
        panic!("pairs");
    };
    assert_eq!(points.len(), 5);
    assert!(points.iter().all(|point| (point.x - 8.0).abs() < 1e-9));
}

#[tokio::test]
async fn an_empty_range_gives_empty_shapes() {
    let Some(client) = prepared("ferristrace_panel_empty").await else {
        return;
    };
    let histogram = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "avg", "field": {"field": "duration"}}],
        "step": "total"
    }));
    let count = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "count"}], "step": "total"
    }));

    let buckets = run(
        &client,
        PanelKind::Histogram,
        &histogram,
        &Variables::none(),
    )
    .await
    .expect("runs");
    let number = run(&client, PanelKind::Number, &count, &Variables::none())
        .await
        .expect("runs");

    assert_eq!(
        buckets,
        PanelResult::Buckets {
            buckets: Vec::new()
        }
    );
    assert_eq!(number, PanelResult::Scalar { value: Some(0.0) });
}

#[tokio::test]
async fn a_metrics_table_is_ordered_and_limited_by_the_store_and_says_so() {
    let Some(client) = prepared("ferristrace_panel_metric_rows").await else {
        return;
    };
    let points = ["a", "b", "c", "d"]
        .iter()
        .zip([4.0, 1.0, 3.0, 2.0])
        .map(|(node, value)| a_point(1, value, node))
        .collect();
    metrics_in(
        &client,
        written(MINE, OURS),
        vec![gauge("node.memory.usage", points)],
    )
    .await;
    let table = query(json!({
        "name": "t", "signal": "metrics",
        "aggregations": [{"metric": "node.memory.usage", "time": "max", "space": "sum"}],
        "group_by": [{"attr": "k8s.node.name"}],
        "order": {"by": {"aggregation": 0}, "direction": "desc"},
        "limit": 3, "step": "total"
    }));

    let result = run(&client, PanelKind::Table, &table, &Variables::none())
        .await
        .expect("the panel runs");

    assert_eq!(
        serde_json::to_value(result).expect("json"),
        json!({
            "kind": "rows", "columns": ["k8s.node.name", "sum(max(node.memory.usage))"],
            "rows": [["a", 4.0], ["c", 3.0], ["d", 2.0]], "truncated": true
        })
    );
}

#[tokio::test]
async fn a_non_finite_attribute_value_cannot_empty_a_histogram() {
    let Some(client) = prepared("ferristrace_panel_finite").await else {
        return;
    };
    let spans = vec![
        a_span(1, "checkout", 5, 10, false, &[("cart.size", "inf")]),
        a_span(2, "checkout", 6, 10, false, &[("cart.size", "nan")]),
        a_span(3, "checkout", 7, 10, false, &[("cart.size", "2")]),
        a_span(4, "checkout", 8, 10, false, &[("cart.size", "6")]),
    ];
    spans_in(&client, written(MINE, OURS), spans).await;
    let sizes = query(json!({
        "name": "n", "signal": "traces",
        "aggregations": [{"function": "avg", "field": {"attr": "cart.size"}}],
        "step": "total"
    }));

    let result = run(&client, PanelKind::Histogram, &sizes, &Variables::none())
        .await
        .expect("runs");

    let PanelResult::Buckets { buckets } = result else {
        panic!("buckets");
    };
    assert_eq!(buckets.len(), 30);
    assert_eq!(buckets[0].from, 2.0);
    assert_eq!(buckets.iter().map(|bucket| bucket.count).sum::<u64>(), 2);
}

#[tokio::test]
async fn a_metrics_table_over_the_group_cap_is_refused_before_it_is_fetched() {
    let Some(client) = prepared("ferristrace_panel_group_cap").await else {
        return;
    };
    let points = (0..10_001)
        .map(|at| a_point(1, 1.0, &format!("node-{at}")))
        .collect();
    metrics_in(
        &client,
        written(MINE, OURS),
        vec![gauge("node.memory.usage", points)],
    )
    .await;
    let table = query(json!({
        "name": "t", "signal": "metrics",
        "aggregations": [{"metric": "node.memory.usage", "time": "max", "space": "sum"}],
        "group_by": [{"attr": "k8s.node.name"}],
        "step": "total"
    }));

    let result = run(&client, PanelKind::Table, &table, &Variables::none()).await;

    assert!(matches!(result, Err(QueryError::Refused(_))), "{result:?}");
}
