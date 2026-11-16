use super::filter::Column;
use super::query::{Aggregation, Function, MetricSpace, MetricTime, PanelQuery};
use crate::explore::Field;

pub fn column_label(column: &Column) -> String {
    match column.field() {
        Field::Service => "service".to_owned(),
        Field::Name => "name".to_owned(),
        Field::Status => "status".to_owned(),
        Field::Kind => "kind".to_owned(),
        Field::Duration => "duration".to_owned(),
        Field::HttpStatusCode => "http_status_code".to_owned(),
        Field::TraceId => "trace_id".to_owned(),
        Field::SpanId => "span_id".to_owned(),
        Field::Severity => "severity".to_owned(),
        Field::Body => "body".to_owned(),
        Field::Attribute(key) => key.as_str().to_owned(),
    }
}

fn function_label(function: Function) -> &'static str {
    match function {
        Function::Count => "count",
        Function::CountDistinct => "count_distinct",
        Function::Sum => "sum",
        Function::Avg => "avg",
        Function::Min => "min",
        Function::Max => "max",
        Function::P50 => "p50",
        Function::P90 => "p90",
        Function::P95 => "p95",
        Function::P99 => "p99",
        Function::Rate => "rate",
    }
}

fn time_label(time: MetricTime) -> &'static str {
    match time {
        MetricTime::Avg => "avg",
        MetricTime::Sum => "sum",
        MetricTime::Min => "min",
        MetricTime::Max => "max",
        MetricTime::Rate => "rate",
        MetricTime::Increase => "increase",
    }
}

fn space_label(space: MetricSpace) -> &'static str {
    match space {
        MetricSpace::Sum => "sum",
        MetricSpace::Avg => "avg",
        MetricSpace::Min => "min",
        MetricSpace::Max => "max",
        MetricSpace::Count => "count",
    }
}

pub fn aggregation_label(aggregation: &Aggregation) -> String {
    match aggregation {
        Aggregation::Event(event) => match event.field() {
            Some(field) => format!(
                "{}({})",
                function_label(event.function()),
                column_label(field)
            ),
            None => function_label(event.function()).to_owned(),
        },
        Aggregation::Metric(metric) => format!(
            "{}({}({}))",
            space_label(metric.space),
            time_label(metric.time),
            metric.metric
        ),
    }
}

pub const AGGREGATION_LABEL: &str = "aggregation";

pub fn clashing_label(query: &PanelQuery) -> Option<String> {
    let mut seen: Vec<String> = Vec::new();
    let aggregations: Vec<String> = query.aggregations().iter().map(aggregation_label).collect();
    for label in query.group_by().iter().map(column_label) {
        if seen.contains(&label)
            || aggregations.contains(&label)
            || (aggregations.len() > 1 && label == AGGREGATION_LABEL)
        {
            return Some(label);
        }
        seen.push(label);
    }
    None
}
