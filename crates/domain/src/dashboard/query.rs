use core::num::NonZeroU32;

use serde::{Deserialize, Deserializer, Serialize, de};

use super::errors::{DashboardError, invalid};
use super::filter::{Column, Filter};
use super::value_objects::{MetricName, QueryName, ResultShape};
use crate::explore::Stream;

pub const MAX_AGGREGATIONS: usize = 10;
pub const MAX_GROUP_BY: usize = 3;
pub const MAX_ROWS: u16 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuerySignal {
    Traces,
    Logs,
    Metrics,
}

impl QuerySignal {
    pub fn stream(self) -> Stream {
        match self {
            Self::Traces => Stream::Spans,
            Self::Logs => Stream::Logs,
            Self::Metrics => Stream::Metrics,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Function {
    Count,
    CountDistinct,
    Sum,
    Avg,
    Min,
    Max,
    P50,
    P90,
    P95,
    P99,
    Rate,
}

impl Function {
    fn needs_field(self) -> bool {
        !matches!(self, Self::Count | Self::Rate)
    }

    fn needs_number(self) -> bool {
        !matches!(self, Self::Count | Self::Rate | Self::CountDistinct)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "EventDraft")]
pub struct EventAggregation {
    function: Function,
    field: Option<Column>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventDraft {
    pub function: Function,
    #[serde(default)]
    pub field: Option<Column>,
}

impl EventAggregation {
    pub fn new(function: Function, field: Option<Column>) -> Result<Self, DashboardError> {
        match (&field, function.needs_field()) {
            (None, true) => return Err(invalid(format!("{function:?} aggregates a field"))),
            (Some(_), false) => return Err(invalid(format!("{function:?} takes no field"))),
            _ => {}
        }
        if function.needs_number() && field.as_ref().is_some_and(|column| !column.is_numeric()) {
            return Err(invalid(format!("{function:?} aggregates a numeric field")));
        }
        Ok(Self { function, field })
    }

    pub fn function(&self) -> Function {
        self.function
    }

    pub fn field(&self) -> Option<&Column> {
        self.field.as_ref()
    }
}

impl TryFrom<EventDraft> for EventAggregation {
    type Error = DashboardError;

    fn try_from(draft: EventDraft) -> Result<Self, Self::Error> {
        Self::new(draft.function, draft.field)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricTime {
    Avg,
    Sum,
    Min,
    Max,
    Rate,
    Increase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricSpace {
    Sum,
    Avg,
    Min,
    Max,
    Count,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricAggregation {
    pub metric: MetricName,
    pub time: MetricTime,
    pub space: MetricSpace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Aggregation {
    Event(EventAggregation),
    Metric(MetricAggregation),
}

impl<'de> Deserialize<'de> for Aggregation {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        if value.get("metric").is_some() {
            MetricAggregation::deserialize(value)
                .map(Self::Metric)
                .map_err(de::Error::custom)
        } else {
            EventAggregation::deserialize(value)
                .map(Self::Event)
                .map_err(de::Error::custom)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Auto,
    Fixed(NonZeroU32),
    Total,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderBy {
    Group,
    Aggregation(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Order {
    pub by: OrderBy,
    pub direction: Direction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u16", into = "u16")]
pub struct RowLimit(u16);

impl RowLimit {
    pub fn get(self) -> u16 {
        self.0
    }
}

impl TryFrom<u16> for RowLimit {
    type Error = DashboardError;

    fn try_from(rows: u16) -> Result<Self, Self::Error> {
        if (1..=MAX_ROWS).contains(&rows) {
            Ok(Self(rows))
        } else {
            Err(invalid(format!("a limit is 1 to {MAX_ROWS} rows")))
        }
    }
}

impl From<RowLimit> for u16 {
    fn from(limit: RowLimit) -> Self {
        limit.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "QueryDraft")]
pub struct PanelQuery {
    name: QueryName,
    signal: QuerySignal,
    aggregations: Vec<Aggregation>,
    filter: Option<Filter>,
    group_by: Vec<Column>,
    order: Option<Order>,
    limit: Option<RowLimit>,
    step: Step,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueryDraft {
    pub name: QueryName,
    pub signal: QuerySignal,
    pub aggregations: Vec<Aggregation>,
    #[serde(default)]
    pub filter: Option<Filter>,
    #[serde(default)]
    pub group_by: Vec<Column>,
    #[serde(default)]
    pub order: Option<Order>,
    #[serde(default)]
    pub limit: Option<RowLimit>,
    pub step: Step,
}

impl PanelQuery {
    pub fn new(draft: QueryDraft) -> Result<Self, DashboardError> {
        let QueryDraft {
            name,
            signal,
            aggregations,
            filter,
            group_by,
            order,
            limit,
            step,
        } = draft;
        let stream = signal.stream();
        if aggregations.is_empty() || aggregations.len() > MAX_AGGREGATIONS {
            return Err(invalid(format!(
                "a query holds 1 to {MAX_AGGREGATIONS} aggregations"
            )));
        }
        for aggregation in &aggregations {
            match (signal, aggregation) {
                (QuerySignal::Metrics, Aggregation::Metric(_)) => {}
                (QuerySignal::Traces | QuerySignal::Logs, Aggregation::Event(event)) => {
                    if event
                        .field()
                        .is_some_and(|column| !column.belongs_to(stream))
                    {
                        return Err(invalid("this field does not exist on this signal"));
                    }
                }
                _ => return Err(invalid("the aggregations do not fit the signal")),
            }
        }
        if group_by.len() > MAX_GROUP_BY {
            return Err(invalid(format!(
                "a query groups by at most {MAX_GROUP_BY} fields"
            )));
        }
        for (at, column) in group_by.iter().enumerate() {
            if !column.belongs_to(stream) {
                return Err(invalid("this field does not exist on this signal"));
            }
            if group_by[..at].contains(column) {
                return Err(invalid("a query groups by each field once"));
            }
        }
        if let Some(filter) = &filter {
            filter.fits(stream)?;
        }
        match order.map(|order| order.by) {
            Some(OrderBy::Aggregation(index)) if usize::from(index) >= aggregations.len() => {
                return Err(invalid("the order names an aggregation the query lacks"));
            }
            Some(OrderBy::Group) if group_by.is_empty() => {
                return Err(invalid("a query orders by group only when it groups"));
            }
            _ => {}
        }
        Ok(Self {
            name,
            signal,
            aggregations,
            filter,
            group_by,
            order,
            limit,
            step,
        })
    }

    pub fn name(&self) -> &QueryName {
        &self.name
    }

    pub fn signal(&self) -> QuerySignal {
        self.signal
    }

    pub fn aggregations(&self) -> &[Aggregation] {
        &self.aggregations
    }

    pub fn filter(&self) -> Option<&Filter> {
        self.filter.as_ref()
    }

    pub fn group_by(&self) -> &[Column] {
        &self.group_by
    }

    pub fn order(&self) -> Option<Order> {
        self.order
    }

    pub fn limit(&self) -> Option<RowLimit> {
        self.limit
    }

    pub fn step(&self) -> Step {
        self.step
    }

    pub fn can_yield(&self, shape: ResultShape) -> bool {
        let timed = self.step != Step::Total;
        let ungrouped = self.group_by.is_empty();
        let over_a_field = match self.aggregations.first() {
            Some(Aggregation::Event(event)) => event.field().is_some(),
            Some(Aggregation::Metric(_)) => true,
            None => false,
        };
        match shape {
            ResultShape::Series => timed,
            ResultShape::Scalar => !timed && ungrouped,
            ResultShape::Rows => !timed,
            ResultShape::Buckets => !timed && ungrouped && over_a_field,
            ResultShape::Heat => timed && ungrouped && over_a_field,
            ResultShape::Pairs => {
                !timed && self.aggregations.len() >= 2 && self.group_by.len() <= 1
            }
            ResultShape::None => false,
        }
    }
}

impl TryFrom<QueryDraft> for PanelQuery {
    type Error = DashboardError;

    fn try_from(draft: QueryDraft) -> Result<Self, Self::Error> {
        Self::new(draft)
    }
}
