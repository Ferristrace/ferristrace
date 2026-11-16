use ferristrace_domain::dashboard::{
    Direction, Grid, MetricAggregation, MetricSpace, MetricTime, Order, OrderBy, PanelQuery, Scope,
};
use ferristrace_domain::{Expr, Window};

use super::built::{Built, group_array, groups_in};
use crate::clickhouse::query::{Compiled, Param, Table};
use crate::clickhouse::read::nanos;

const CUMULATIVE_INCREASE: &str = "if(nth = 1, \
     if(samples > 1, greatest(last - first, 0), NULL), \
     greatest(last - previous, 0))";

fn per_series(time: MetricTime, seconds: f64) -> String {
    match time {
        MetricTime::Avg => "mean".to_owned(),
        MetricTime::Min => "low".to_owned(),
        MetricTime::Max => "high".to_owned(),
        MetricTime::Sum => {
            "if(kind = 'gauge' OR temporality = 'cumulative', last, total)".to_owned()
        }
        MetricTime::Increase => {
            format!("if(temporality = 'cumulative', {CUMULATIVE_INCREASE}, total)")
        }
        MetricTime::Rate => format!(
            "if(temporality = 'cumulative', \
               if(nth = 1, \
                 if(samples > 1, greatest(last - first, 0) / {seconds:?}, NULL), \
                 greatest(last - previous, 0) / ((slot - previous_slot) * {seconds:?})), \
               total / {seconds:?})"
        ),
    }
}

fn across(space: MetricSpace) -> &'static str {
    match space {
        MetricSpace::Sum => "sum",
        MetricSpace::Avg => "avg",
        MetricSpace::Min => "min",
        MetricSpace::Max => "max",
        MetricSpace::Count => "count",
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Top {
    pub(crate) order: Option<Order>,
    pub(crate) fetched: u32,
}

fn ranking(order: Option<Order>) -> String {
    let way = |direction| match direction {
        Direction::Asc => "ASC",
        Direction::Desc => "DESC",
    };
    match order {
        Some(Order {
            by: OrderBy::Group,
            direction,
        }) => format!("labels {}", way(direction)),
        Some(Order {
            by: OrderBy::Aggregation(_),
            direction,
        }) => format!("value {} NULLS LAST, labels", way(direction)),
        None => "value DESC NULLS LAST, labels".to_owned(),
    }
}

pub(crate) fn series(
    scope: Scope,
    window: Window,
    query: &PanelQuery,
    aggregation: &MetricAggregation,
    filter: Option<&Expr>,
    grid: Grid,
    top: Option<Top>,
) -> Built {
    let mut compiled = Compiled::on(Table::Metrics);
    let labels = group_array(&mut compiled, query);
    compiled.push(Param::Whole(nanos(grid.from_nanos())));
    compiled.push(Param::Whole(nanos(grid.step_nanos())));
    let scoped = compiled.scoped_in(
        scope.org,
        scope.project,
        Some(aggregation.metric.as_str()),
        window,
        filter,
    );
    let sql = format!(
        "SELECT slot, labels, toNullable(toFloat64({outer}(per_series))) AS value FROM ( \
           SELECT slot, {labels} AS labels, {per_series} AS per_series FROM ( \
             SELECT slot, attributes, service_name, kind, temporality, total, mean, low, high, \
               last, first, samples, \
               row_number() OVER series AS nth, \
               lagInFrame(last) OVER series AS previous, \
               lagInFrame(slot) OVER series AS previous_slot \
             FROM ( \
               SELECT intDiv(toUnixTimestamp64Nano(time) - ?, ?) AS slot, \
                 project_id, service_name, kind, attributes, temporality, \
                 sum(value) AS total, avg(value) AS mean, min(value) AS low, max(value) AS high, \
                 argMax(value, time) AS last, argMin(value, time) AS first, count() AS samples \
               FROM metric_points \
               WHERE {scoped} \
               GROUP BY slot, project_id, service_name, kind, attributes, temporality \
             ) \
             WINDOW series AS (PARTITION BY project_id, service_name, kind, attributes, \
               temporality ORDER BY slot ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) \
           ) \
         ) GROUP BY slot, labels",
        outer = across(aggregation.space),
        per_series = per_series(aggregation.time, grid.step_seconds()),
    );
    let mut sql = sql;
    match top {
        Some(top) => {
            sql.push_str(" ORDER BY ");
            sql.push_str(&ranking(top.order));
            sql.push_str(" LIMIT ?");
            compiled.push(Param::Whole(i64::from(top.fetched)));
        }
        None => sql.push_str(" ORDER BY slot"),
    }
    Built::of(sql, compiled)
}

pub(crate) fn groups(
    scope: Scope,
    window: Window,
    query: &PanelQuery,
    aggregation: &MetricAggregation,
    filter: Option<&Expr>,
) -> Built {
    groups_in(
        Table::Metrics,
        |compiled| {
            compiled.scoped_in(
                scope.org,
                scope.project,
                Some(aggregation.metric.as_str()),
                window,
                filter,
            )
        },
        query,
    )
}
