use std::cmp::Ordering;
use std::collections::BTreeMap;

use clickhouse::Row;
use ferristrace_domain::dashboard::{
    AGGREGATION_LABEL, Aggregation, BUCKETS, Band, Bucket, Cell, Direction, Function, Grid, Labels,
    Line, Order, OrderBy, Pair, PanelQuery, PanelResult, aggregation_label, column_label,
};
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct SeriesRow {
    pub(crate) slot: i64,
    pub(crate) grp: Vec<String>,
    pub(crate) vals: Vec<Option<f64>>,
}

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct TableRow {
    pub(crate) grp: Vec<String>,
    pub(crate) vals: Vec<Option<f64>>,
}

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct MetricRow {
    pub(crate) slot: i64,
    pub(crate) labels: Vec<String>,
    pub(crate) value: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct CountRow {
    pub(crate) n: u64,
}

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct ExtentRow {
    pub(crate) low: Option<f64>,
    pub(crate) high: Option<f64>,
    pub(crate) n: u64,
}

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct BucketRow {
    pub(crate) bucket: i64,
    pub(crate) n: u64,
}

#[derive(Debug, Clone, PartialEq, Row, Deserialize)]
pub(crate) struct HeatRow {
    pub(crate) slot: i64,
    pub(crate) bucket: i64,
    pub(crate) n: u64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Sample<'a> {
    pub(crate) slot: i64,
    pub(crate) group: &'a [String],
    pub(crate) aggregation: usize,
    pub(crate) value: Option<f64>,
}

pub(crate) fn samples_of(rows: &[SeriesRow]) -> impl Iterator<Item = Sample<'_>> {
    rows.iter().flat_map(|row| {
        row.vals
            .iter()
            .enumerate()
            .map(move |(aggregation, value)| Sample {
                slot: row.slot,
                group: &row.grp,
                aggregation,
                value: *value,
            })
    })
}

pub(crate) fn metric_samples(fetched: &[Vec<MetricRow>]) -> impl Iterator<Item = Sample<'_>> {
    fetched.iter().enumerate().flat_map(|(aggregation, rows)| {
        rows.iter().map(move |row| Sample {
            slot: row.slot,
            group: &row.labels,
            aggregation,
            value: row.value,
        })
    })
}

fn labelled(query: &PanelQuery, group: &[String]) -> Labels {
    query
        .group_by()
        .iter()
        .zip(group)
        .map(|(column, value)| (column_label(column).into(), value.as_str().into()))
        .collect()
}

fn fills(aggregation: &Aggregation) -> bool {
    matches!(
        aggregation,
        Aggregation::Event(event) if matches!(
            event.function(),
            Function::Count | Function::CountDistinct | Function::Sum | Function::Rate
        )
    )
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|number| number.is_finite())
}

pub(crate) fn lines<'a>(
    samples: impl Iterator<Item = Sample<'a>>,
    query: &PanelQuery,
    grid: Grid,
) -> Vec<Line> {
    let aggregations = query.aggregations();
    let mut held: BTreeMap<(&[String], usize), BTreeMap<u64, f64>> = BTreeMap::new();
    for sample in samples {
        let slot = u64::try_from(sample.slot)
            .ok()
            .filter(|slot| *slot < grid.slots());
        if let (Some(slot), Some(value)) = (slot, finite(sample.value)) {
            held.entry((sample.group, sample.aggregation))
                .or_default()
                .insert(slot, value);
        }
    }
    if query.group_by().is_empty() {
        for aggregation in 0..aggregations.len() {
            held.entry((&[], aggregation)).or_default();
        }
    }
    held.into_iter()
        .filter_map(|((group, at), points)| {
            let aggregation = aggregations.get(at)?;
            let points = if fills(aggregation) {
                (0..grid.slots())
                    .zip(grid.starts())
                    .map(|(slot, start)| (start, points.get(&slot).copied().unwrap_or(0.0)))
                    .collect()
            } else {
                points
                    .into_iter()
                    .map(|(slot, value)| (grid.from_nanos() + slot * grid.step_nanos(), value))
                    .collect()
            };
            let mut labels = labelled(query, group);
            if aggregations.len() > 1 {
                labels.insert(
                    AGGREGATION_LABEL.into(),
                    aggregation_label(aggregation).into(),
                );
            }
            Some(Line { labels, points })
        })
        .collect()
}

fn cell(value: Option<f64>) -> Cell {
    finite(value).map_or(Cell::Empty, Cell::Number)
}

pub(crate) fn table(rows: Vec<TableRow>, query: &PanelQuery, truncated: bool) -> PanelResult {
    let columns = query
        .group_by()
        .iter()
        .map(|column| column_label(column).into())
        .chain(
            query
                .aggregations()
                .iter()
                .map(|aggregation| aggregation_label(aggregation).into()),
        )
        .collect();
    let rows = rows
        .into_iter()
        .map(|row| {
            row.grp
                .into_iter()
                .map(|text| Cell::Text(text.into()))
                .chain(row.vals.into_iter().map(cell))
                .collect()
        })
        .collect();
    PanelResult::Rows {
        columns,
        rows,
        truncated,
    }
}

pub(crate) fn scalar(rows: &[TableRow]) -> PanelResult {
    PanelResult::Scalar {
        value: finite(
            rows.first()
                .and_then(|row| row.vals.first().copied().flatten()),
        ),
    }
}

pub(crate) fn pairs(rows: &[TableRow], query: &PanelQuery) -> PanelResult {
    let points = rows
        .iter()
        .filter_map(|row| {
            let x = finite(row.vals.first().copied().flatten())?;
            let y = finite(row.vals.get(1).copied().flatten())?;
            Some(Pair {
                group: labelled(query, &row.grp),
                x,
                y,
            })
        })
        .collect();
    PanelResult::Pairs { points }
}

pub(crate) fn merged(per_aggregation: Vec<Vec<MetricRow>>) -> Vec<TableRow> {
    let width = per_aggregation.len();
    let mut held: BTreeMap<Vec<String>, Vec<Option<f64>>> = BTreeMap::new();
    for (at, rows) in per_aggregation.into_iter().enumerate() {
        for row in rows {
            held.entry(row.labels).or_insert_with(|| vec![None; width])[at] = finite(row.value);
        }
    }
    held.into_iter()
        .map(|(grp, vals)| TableRow { grp, vals })
        .collect()
}

pub(crate) fn ordered(rows: &mut [TableRow], order: Option<Order>) {
    let at = |row: &TableRow, index: usize| row.vals.get(index).copied().flatten();
    let by_value = |left: Option<f64>, right: Option<f64>, direction: Direction| match (left, right)
    {
        (Some(left), Some(right)) => {
            let found = left.total_cmp(&right);
            match direction {
                Direction::Asc => found,
                Direction::Desc => found.reverse(),
            }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    };
    rows.sort_by(|left, right| match order {
        Some(Order {
            by: OrderBy::Group,
            direction,
        }) => match direction {
            Direction::Asc => left.grp.cmp(&right.grp),
            Direction::Desc => right.grp.cmp(&left.grp),
        },
        Some(Order {
            by: OrderBy::Aggregation(index),
            direction,
        }) => by_value(
            at(left, usize::from(index)),
            at(right, usize::from(index)),
            direction,
        )
        .then_with(|| left.grp.cmp(&right.grp)),
        None => by_value(at(left, 0), at(right, 0), Direction::Desc)
            .then_with(|| left.grp.cmp(&right.grp)),
    });
}

pub(crate) fn bands(low: f64, high: f64) -> (f64, u32) {
    let width = (high - low) / f64::from(BUCKETS);
    if width > 0.0 && width.is_finite() {
        (width, BUCKETS)
    } else {
        (1.0, 1)
    }
}

fn band(low: f64, width: f64, index: u32) -> Band {
    Band {
        from: low + width * f64::from(index),
        to: low + width * f64::from(index + 1),
    }
}

pub(crate) fn buckets(rows: &[BucketRow], low: f64, width: f64, count: u32) -> PanelResult {
    let mut counts = vec![0_u64; count as usize];
    for row in rows {
        if let Some(slot) = usize::try_from(row.bucket)
            .ok()
            .and_then(|index| counts.get_mut(index))
        {
            *slot += row.n;
        }
    }
    PanelResult::Buckets {
        buckets: counts
            .into_iter()
            .zip(0..count)
            .map(|(count, index)| {
                let held = band(low, width, index);
                Bucket {
                    from: held.from,
                    to: held.to,
                    count,
                }
            })
            .collect(),
    }
}

pub(crate) fn heat(rows: &[HeatRow], grid: Grid, low: f64, width: f64, count: u32) -> PanelResult {
    let cells = rows
        .iter()
        .filter_map(|row| {
            let x = u32::try_from(row.slot)
                .ok()
                .filter(|slot| u64::from(*slot) < grid.slots())?;
            let y = u32::try_from(row.bucket)
                .ok()
                .filter(|bucket| *bucket < count)?;
            Some((x, y, row.n))
        })
        .collect();
    PanelResult::Heat {
        x: grid.starts().collect(),
        y: (0..count).map(|index| band(low, width, index)).collect(),
        cells,
    }
}
