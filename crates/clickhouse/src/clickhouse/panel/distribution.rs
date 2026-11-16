use ferristrace_domain::dashboard::{BUCKETS, Grid, Scope};
use ferristrace_domain::{Expr, Field, Window};

use super::built::{Built, source_of};
use crate::clickhouse::query::{Compiled, Param, Table};
use crate::clickhouse::read::nanos;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Source<'a> {
    pub(crate) table: Table,
    pub(crate) name: Option<&'a str>,
    pub(crate) measured: Option<&'a Field>,
}

impl Source<'_> {
    fn value(&self, compiled: &mut Compiled) -> String {
        match self.measured {
            Some(field) => compiled.number_field(field),
            None => "value".to_owned(),
        }
    }
}

pub(crate) fn extent(
    source: Source<'_>,
    scope: Scope,
    window: Window,
    filter: Option<&Expr>,
) -> Built {
    let mut compiled = Compiled::on(source.table);
    let low = source.value(&mut compiled);
    let high = source.value(&mut compiled);
    let scoped = compiled.scoped_in(scope.org, scope.project, source.name, window, filter);
    let present = source.value(&mut compiled);
    let sql = format!(
        "SELECT toNullable(toFloat64(min({low}))) AS low, \
                toNullable(toFloat64(max({high}))) AS high, count() AS n \
         FROM {from} WHERE {scoped} AND isFinite({present})",
        from = source_of(source.table),
    );
    Built::of(sql, compiled)
}

pub(crate) fn buckets(
    source: Source<'_>,
    scope: Scope,
    window: Window,
    filter: Option<&Expr>,
    low: f64,
    width: f64,
) -> Built {
    let mut compiled = Compiled::on(source.table);
    let placed = source.value(&mut compiled);
    compiled.push(Param::Float(low));
    compiled.push(Param::Float(width));
    let scoped = compiled.scoped_in(scope.org, scope.project, source.name, window, filter);
    let present = source.value(&mut compiled);
    let sql = format!(
        "SELECT toInt64(ifNull(least(floor(({placed} - ?) / ?), {last}), 0)) AS bucket, count() AS n \
         FROM {from} WHERE {scoped} AND isFinite({present}) \
         GROUP BY bucket ORDER BY bucket",
        last = BUCKETS - 1,
        from = source_of(source.table),
    );
    Built::of(sql, compiled)
}

pub(crate) fn heat(
    source: Source<'_>,
    scope: Scope,
    window: Window,
    filter: Option<&Expr>,
    grid: Grid,
    low: f64,
    width: f64,
) -> Built {
    let mut compiled = Compiled::on(source.table);
    let time = source.table.time();
    compiled.push(Param::Whole(nanos(grid.from_nanos())));
    compiled.push(Param::Whole(nanos(grid.step_nanos())));
    let placed = source.value(&mut compiled);
    compiled.push(Param::Float(low));
    compiled.push(Param::Float(width));
    let scoped = compiled.scoped_in(scope.org, scope.project, source.name, window, filter);
    let present = source.value(&mut compiled);
    let sql = format!(
        "SELECT toInt64(intDiv(toUnixTimestamp64Nano({time}) - ?, ?)) AS slot, \
                toInt64(ifNull(least(floor(({placed} - ?) / ?), {last}), 0)) AS bucket, count() AS n \
         FROM {from} WHERE {scoped} AND isFinite({present}) \
         GROUP BY slot, bucket ORDER BY slot, bucket",
        last = BUCKETS - 1,
        from = source_of(source.table),
    );
    Built::of(sql, compiled)
}
