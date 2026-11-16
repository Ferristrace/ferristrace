use ferristrace_domain::dashboard::{
    Aggregation, Column, Direction, EventAggregation, Function, Grid, Order, OrderBy, PanelQuery,
    QueryError, Scope,
};
use ferristrace_domain::{Expr, Window};

use super::built::{Built, group_array, groups_in, source_of};
use crate::clickhouse::query::{Compiled, Param, Table};
use crate::clickhouse::read::nanos;

const NOT_EVENTS: QueryError = QueryError::Refused("the aggregations do not fit this signal");
const NO_FIELD: QueryError = QueryError::Refused("this aggregation needs a field");

fn aggregate(
    compiled: &mut Compiled,
    event: &EventAggregation,
    seconds: f64,
) -> Result<String, QueryError> {
    let field = || event.field().map(Column::field).ok_or(NO_FIELD);
    Ok(match event.function() {
        Function::Count => "count()".to_owned(),
        Function::CountDistinct => format!("uniqExact({})", compiled.text_field(field()?)),
        Function::Sum => format!("sum({})", compiled.number_field(field()?)),
        Function::Avg => format!("avg({})", compiled.number_field(field()?)),
        Function::Min => format!("min({})", compiled.number_field(field()?)),
        Function::Max => format!("max({})", compiled.number_field(field()?)),
        Function::P50 => format!("quantile(0.5)({})", compiled.number_field(field()?)),
        Function::P90 => format!("quantile(0.9)({})", compiled.number_field(field()?)),
        Function::P95 => format!("quantile(0.95)({})", compiled.number_field(field()?)),
        Function::P99 => format!("quantile(0.99)({})", compiled.number_field(field()?)),
        Function::Rate => {
            compiled.push(Param::Float(seconds));
            "count() / ?".to_owned()
        }
    })
}

fn value_array(
    compiled: &mut Compiled,
    query: &PanelQuery,
    seconds: f64,
) -> Result<String, QueryError> {
    let mut parts = Vec::with_capacity(query.aggregations().len());
    for aggregation in query.aggregations() {
        let Aggregation::Event(event) = aggregation else {
            return Err(NOT_EVENTS);
        };
        parts.push(format!(
            "toNullable(toFloat64({}))",
            aggregate(compiled, event, seconds)?
        ));
    }
    Ok(format!("[{}]", parts.join(", ")))
}

pub(crate) fn series(
    table: Table,
    scope: Scope,
    window: Window,
    query: &PanelQuery,
    filter: Option<&Expr>,
    grid: Grid,
) -> Result<Built, QueryError> {
    let mut compiled = Compiled::on(table);
    let time = table.time();
    compiled.push(Param::Whole(nanos(grid.from_nanos())));
    compiled.push(Param::Whole(nanos(grid.step_nanos())));
    let grouped = group_array(&mut compiled, query);
    let values = value_array(&mut compiled, query, grid.step_seconds())?;
    let scoped = compiled.scoped_in(scope.org, scope.project, None, window, filter);
    let sql = format!(
        "SELECT toInt64(intDiv(toUnixTimestamp64Nano({time}) - ?, ?)) AS slot, \
                {grouped} AS grp, {values} AS vals \
         FROM {source} WHERE {scoped} GROUP BY slot, grp ORDER BY slot",
        source = source_of(table),
    );
    Ok(Built::of(sql, compiled))
}

fn ordering(order: Option<Order>) -> String {
    let way = |direction| match direction {
        Direction::Asc => "ASC",
        Direction::Desc => "DESC",
    };
    match order {
        Some(Order {
            by: OrderBy::Group,
            direction,
        }) => format!("grp {}", way(direction)),
        Some(Order {
            by: OrderBy::Aggregation(index),
            direction,
        }) => format!(
            "vals[{}] {} NULLS LAST, grp",
            u16::from(index) + 1,
            way(direction)
        ),
        None => "vals[1] DESC NULLS LAST, grp".to_owned(),
    }
}

pub(crate) fn rows(
    table: Table,
    scope: Scope,
    window: Window,
    query: &PanelQuery,
    filter: Option<&Expr>,
    seconds: f64,
    fetched: u32,
) -> Result<Built, QueryError> {
    let mut compiled = Compiled::on(table);
    let grouped = group_array(&mut compiled, query);
    let values = value_array(&mut compiled, query, seconds)?;
    let scoped = compiled.scoped_in(scope.org, scope.project, None, window, filter);
    let mut sql = format!(
        "SELECT {grouped} AS grp, {values} AS vals FROM {source} WHERE {scoped}",
        source = source_of(table),
    );
    if !query.group_by().is_empty() {
        sql.push_str(" GROUP BY grp ORDER BY ");
        sql.push_str(&ordering(query.order()));
    }
    sql.push_str(" LIMIT ?");
    compiled.push(Param::Whole(i64::from(fetched)));
    Ok(Built::of(sql, compiled))
}

pub(crate) fn groups(
    table: Table,
    scope: Scope,
    window: Window,
    query: &PanelQuery,
    filter: Option<&Expr>,
) -> Built {
    groups_in(
        table,
        |compiled| compiled.scoped_in(scope.org, scope.project, None, window, filter),
        query,
    )
}
