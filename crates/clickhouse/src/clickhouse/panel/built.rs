use clickhouse::Client;
use clickhouse::query::Query;
use ferristrace_domain::dashboard::PanelQuery;

use crate::clickhouse::query::{Compiled, Param, Table};

pub(crate) const GROUP_CAP: u32 = 10_000;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Built {
    pub(crate) sql: String,
    pub(crate) params: Vec<Param>,
}

impl Built {
    pub(crate) fn of(sql: String, compiled: Compiled) -> Self {
        Self {
            sql,
            params: compiled.into_params(),
        }
    }

    pub(crate) fn bound(&self, client: &Client) -> Query {
        self.params
            .iter()
            .fold(client.query(&self.sql), |statement, param| {
                statement.bind(param)
            })
    }
}

pub(crate) fn source_of(table: Table) -> &'static str {
    match table {
        Table::Spans => "spans FINAL",
        Table::Logs => "logs",
        Table::Metrics => "metric_points",
    }
}

pub(crate) fn group_array(compiled: &mut Compiled, query: &PanelQuery) -> String {
    let parts: Vec<String> = query
        .group_by()
        .iter()
        .map(|column| format!("toString({})", compiled.text_field(column.field())))
        .collect();
    if parts.is_empty() {
        "emptyArrayString()".to_owned()
    } else {
        format!("[{}]", parts.join(", "))
    }
}

pub(crate) fn groups_in(
    table: Table,
    scope_sql: impl FnOnce(&mut Compiled) -> String,
    query: &PanelQuery,
) -> Built {
    let mut compiled = Compiled::on(table);
    let filter = scope_sql(&mut compiled);
    let grouped = group_array(&mut compiled, query);
    let sql = format!(
        "SELECT count() AS n FROM (SELECT 1 FROM {source} WHERE {filter} \
         GROUP BY {grouped} LIMIT {GROUP_CAP})",
        source = source_of(table),
    );
    Built::of(sql, compiled)
}
