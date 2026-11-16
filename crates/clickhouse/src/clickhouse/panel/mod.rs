mod built;
mod distribution;
mod events;
mod metrics;
mod shape;
#[cfg(test)]
mod tests;

use std::time::Duration;

use clickhouse::{Client, RowOwned, RowRead};
use ferristrace_domain::dashboard::{
    Aggregation, Column, Grid, Line, MAX_ROWS, MAX_SERIES, MetricAggregation, PanelKind,
    PanelQuery, PanelReader, PanelResult, QueryError, QuerySignal, ResultShape, RowLimit, Scope,
    Step, Variables,
};
use ferristrace_domain::{Expr, Field, StoreError, Window};

use self::built::{Built, GROUP_CAP};
use self::distribution::Source;
use self::metrics::Top;
use self::shape::{
    BucketRow, CountRow, ExtentRow, HeatRow, MetricRow, SeriesRow, TableRow, metric_samples,
    samples_of,
};
use crate::clickhouse::query::Table;

const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_MEMORY_BYTES: u64 = 2_000_000_000;
const MAX_GROUPED_ROWS: u64 = 1_000_000;
const MAX_RESULT_ROWS: u64 = 100_000;
const NANOS_PER_SECOND: f64 = 1_000_000_000.0;

#[derive(Debug, Clone)]
pub struct ClickhousePanelReader {
    client: Client,
}

impl ClickhousePanelReader {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    async fn fetch<T: RowOwned + RowRead>(&self, built: &Built) -> Result<Vec<T>, QueryError> {
        built
            .bound(&self.client)
            .with_setting("readonly", "2")
            .with_setting("max_execution_time", TIMEOUT.as_secs().to_string())
            .with_setting("max_memory_usage", MAX_MEMORY_BYTES.to_string())
            .with_setting("max_rows_to_group_by", MAX_GROUPED_ROWS.to_string())
            .with_setting("group_by_overflow_mode", "throw")
            .with_setting("max_result_rows", MAX_RESULT_ROWS.to_string())
            .with_setting("result_overflow_mode", "throw")
            .fetch_all()
            .await
            .map_err(|error| failed(&error))
    }

    async fn groups_of(&self, built: &Built) -> Result<usize, QueryError> {
        let rows: Vec<CountRow> = self.fetch(built).await?;
        Ok(rows
            .first()
            .map_or(0, |row| usize::try_from(row.n).unwrap_or(usize::MAX)))
    }

    async fn events(
        &self,
        table: Table,
        scope: Scope,
        query: &PanelQuery,
        shape: ResultShape,
        window: Window,
        filter: Option<&Expr>,
    ) -> Result<PanelResult, QueryError> {
        match shape {
            ResultShape::Series => {
                let grid = Grid::new(window, query.step());
                let groups = if query.group_by().is_empty() {
                    1
                } else {
                    self.groups_of(&events::groups(table, scope, window, query, filter))
                        .await?
                };
                refuse_beyond(groups.saturating_mul(query.aggregations().len()))?;
                let built = events::series(table, scope, window, query, filter, grid)?;
                let rows: Vec<SeriesRow> = self.fetch(&built).await?;
                Ok(PanelResult::Series {
                    series: capped(shape::lines(samples_of(&rows), query, grid))?,
                })
            }
            ResultShape::Rows | ResultShape::Scalar | ResultShape::Pairs => {
                let limit = row_limit(query);
                let built = events::rows(
                    table,
                    scope,
                    window,
                    query,
                    filter,
                    seconds_of(window),
                    limit + 1,
                )?;
                let mut rows: Vec<TableRow> = self.fetch(&built).await?;
                let truncated = rows.len() > limit as usize;
                rows.truncate(limit as usize);
                Ok(settled(shape, rows, query, truncated))
            }
            ResultShape::Buckets | ResultShape::Heat => {
                let field = measured(query)?;
                let source = Source {
                    table,
                    name: None,
                    measured: Some(field),
                };
                self.distribution(source, scope, window, filter, shape, query.step())
                    .await
            }
            ResultShape::None => Err(QueryError::Refused("a text panel runs no query")),
        }
    }

    async fn metrics(
        &self,
        scope: Scope,
        query: &PanelQuery,
        shape: ResultShape,
        window: Window,
        filter: Option<&Expr>,
    ) -> Result<PanelResult, QueryError> {
        let held = metric_aggregations(query)?;
        match shape {
            ResultShape::Series => {
                let grid = Grid::new(window, query.step());
                let mut total = 0_usize;
                for aggregation in &held {
                    total = total.saturating_add(if query.group_by().is_empty() {
                        1
                    } else {
                        self.groups_of(&metrics::groups(scope, window, query, aggregation, filter))
                            .await?
                    });
                }
                refuse_beyond(total)?;
                let mut fetched: Vec<Vec<MetricRow>> = Vec::with_capacity(held.len());
                for aggregation in &held {
                    let built =
                        metrics::series(scope, window, query, aggregation, filter, grid, None);
                    fetched.push(self.fetch(&built).await?);
                }
                Ok(PanelResult::Series {
                    series: capped(shape::lines(metric_samples(&fetched), query, grid))?,
                })
            }
            ResultShape::Rows | ResultShape::Scalar | ResultShape::Pairs => {
                let grid = Grid::new(window, Step::Total);
                let limit = row_limit(query);
                let mut groups = 0_usize;
                if !query.group_by().is_empty() {
                    for aggregation in &held {
                        groups = groups.saturating_add(
                            self.groups_of(&metrics::groups(
                                scope,
                                window,
                                query,
                                aggregation,
                                filter,
                            ))
                            .await?,
                        );
                    }
                }
                if groups >= GROUP_CAP as usize {
                    return Err(QueryError::Refused(
                        "this query groups into too many rows: narrow the filter or group by less",
                    ));
                }
                let top = (held.len() == 1).then_some(Top {
                    order: query.order(),
                    fetched: limit + 1,
                });
                let mut fetched: Vec<Vec<MetricRow>> = Vec::with_capacity(held.len());
                for aggregation in &held {
                    let built =
                        metrics::series(scope, window, query, aggregation, filter, grid, top);
                    fetched.push(self.fetch(&built).await?);
                }
                let mut rows = shape::merged(fetched);
                shape::ordered(&mut rows, query.order());
                let truncated = rows.len() > limit as usize;
                rows.truncate(limit as usize);
                Ok(settled(shape, rows, query, truncated))
            }
            ResultShape::Buckets | ResultShape::Heat => {
                let first = held.first().ok_or(QueryError::Refused(
                    "a histogram or heatmap measures one metric",
                ))?;
                let source = Source {
                    table: Table::Metrics,
                    name: Some(first.metric.as_str()),
                    measured: None,
                };
                self.distribution(source, scope, window, filter, shape, query.step())
                    .await
            }
            ResultShape::None => Err(QueryError::Refused("a text panel runs no query")),
        }
    }

    async fn distribution(
        &self,
        source: Source<'_>,
        scope: Scope,
        window: Window,
        filter: Option<&Expr>,
        shape: ResultShape,
        step: Step,
    ) -> Result<PanelResult, QueryError> {
        let grid = Grid::new(window, step);
        let extent: Vec<ExtentRow> = self
            .fetch(&distribution::extent(source, scope, window, filter))
            .await?;
        let found = extent.first().and_then(|row| match (row.low, row.high) {
            (Some(low), Some(high)) if row.n > 0 && low.is_finite() && high.is_finite() => {
                Some((low, high))
            }
            _ => None,
        });
        let Some((low, high)) = found else {
            return Ok(if shape == ResultShape::Heat {
                PanelResult::Heat {
                    x: grid.starts().collect(),
                    y: Vec::new(),
                    cells: Vec::new(),
                }
            } else {
                PanelResult::Buckets {
                    buckets: Vec::new(),
                }
            });
        };
        let (width, count) = shape::bands(low, high);
        if shape == ResultShape::Heat {
            let rows: Vec<HeatRow> = self
                .fetch(&distribution::heat(
                    source, scope, window, filter, grid, low, width,
                ))
                .await?;
            Ok(shape::heat(&rows, grid, low, width, count))
        } else {
            let rows: Vec<BucketRow> = self
                .fetch(&distribution::buckets(
                    source, scope, window, filter, low, width,
                ))
                .await?;
            Ok(shape::buckets(&rows, low, width, count))
        }
    }

    async fn answer(
        &self,
        scope: Scope,
        query: &PanelQuery,
        kind: PanelKind,
        window: Window,
        variables: &Variables,
    ) -> Result<PanelResult, QueryError> {
        let filter = query
            .filter()
            .map(|filter| variables.resolve(filter))
            .transpose()
            .map_err(|_| QueryError::Refused("a variable does not fit the filter it feeds"))?
            .flatten();
        let shape = kind.result_shape();
        match query.signal() {
            QuerySignal::Traces => {
                self.events(Table::Spans, scope, query, shape, window, filter.as_ref())
                    .await
            }
            QuerySignal::Logs => {
                self.events(Table::Logs, scope, query, shape, window, filter.as_ref())
                    .await
            }
            QuerySignal::Metrics => {
                self.metrics(scope, query, shape, window, filter.as_ref())
                    .await
            }
        }
    }
}

impl PanelReader for ClickhousePanelReader {
    async fn run(
        &self,
        scope: Scope,
        query: &PanelQuery,
        kind: PanelKind,
        window: Window,
        variables: &Variables,
    ) -> Result<PanelResult, QueryError> {
        tokio::time::timeout(TIMEOUT, self.answer(scope, query, kind, window, variables))
            .await
            .unwrap_or(Err(QueryError::Timeout))
    }
}

fn failed(error: &clickhouse::error::Error) -> QueryError {
    let text = error.to_string();
    if text.contains("TIMEOUT_EXCEEDED") || text.contains("Timeout exceeded") {
        return QueryError::Timeout;
    }
    if text.contains("TOO_MANY_ROWS") || text.contains("MEMORY_LIMIT_EXCEEDED") {
        return QueryError::Refused("this query is too large to run: narrow its filter or range");
    }
    tracing::error!(%error, "the store refused a panel query");
    QueryError::Store(StoreError::Unreachable)
}

fn capped(series: Vec<Line>) -> Result<Vec<Line>, QueryError> {
    refuse_beyond(series.len())?;
    Ok(series)
}

fn refuse_beyond(count: usize) -> Result<(), QueryError> {
    if count > MAX_SERIES {
        Err(QueryError::TooManySeries {
            count,
            max: MAX_SERIES,
        })
    } else {
        Ok(())
    }
}

fn row_limit(query: &PanelQuery) -> u32 {
    u32::from(query.limit().map_or(MAX_ROWS, RowLimit::get))
}

#[allow(clippy::cast_precision_loss)]
fn seconds_of(window: Window) -> f64 {
    (window.to_unix_nanos() - window.from_unix_nanos()) as f64 / NANOS_PER_SECOND
}

fn settled(
    shape: ResultShape,
    rows: Vec<TableRow>,
    query: &PanelQuery,
    truncated: bool,
) -> PanelResult {
    match shape {
        ResultShape::Scalar => shape::scalar(&rows),
        ResultShape::Pairs => shape::pairs(&rows, query),
        _ => shape::table(rows, query, truncated),
    }
}

fn measured(query: &PanelQuery) -> Result<&Field, QueryError> {
    match query.aggregations().first() {
        Some(Aggregation::Event(event)) => event
            .field()
            .filter(|column| column.is_numeric())
            .map(Column::field)
            .ok_or(QueryError::Refused(
                "a histogram or heatmap measures a numeric field",
            )),
        _ => Err(QueryError::Refused(
            "a histogram or heatmap measures a numeric field",
        )),
    }
}

fn metric_aggregations(query: &PanelQuery) -> Result<Vec<&MetricAggregation>, QueryError> {
    query
        .aggregations()
        .iter()
        .map(|aggregation| match aggregation {
            Aggregation::Metric(metric) => Ok(metric),
            Aggregation::Event(_) => Err(QueryError::Refused(
                "the aggregations do not fit this signal",
            )),
        })
        .collect()
}
