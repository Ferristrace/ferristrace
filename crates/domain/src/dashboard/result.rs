use std::collections::BTreeMap;

use serde::Serialize;

use super::errors::DashboardError;
use super::value_objects::ResultShape;
use crate::store::StoreError;

pub type Labels = BTreeMap<Box<str>, Box<str>>;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Line {
    pub labels: Labels,
    pub points: Vec<(u64, f64)>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Cell {
    Text(Box<str>),
    Number(f64),
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Bucket {
    pub from: f64,
    pub to: f64,
    pub count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Band {
    pub from: f64,
    pub to: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pair {
    pub group: Labels,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PanelResult {
    Series {
        series: Vec<Line>,
    },
    Scalar {
        value: Option<f64>,
    },
    Rows {
        columns: Vec<Box<str>>,
        rows: Vec<Vec<Cell>>,
        truncated: bool,
    },
    Buckets {
        buckets: Vec<Bucket>,
    },
    Heat {
        x: Vec<u64>,
        y: Vec<Band>,
        cells: Vec<(u32, u32, u64)>,
    },
    Pairs {
        points: Vec<Pair>,
    },
}

impl PanelResult {
    pub fn shape(&self) -> ResultShape {
        match self {
            Self::Series { .. } => ResultShape::Series,
            Self::Scalar { .. } => ResultShape::Scalar,
            Self::Rows { .. } => ResultShape::Rows,
            Self::Buckets { .. } => ResultShape::Buckets,
            Self::Heat { .. } => ResultShape::Heat,
            Self::Pairs { .. } => ResultShape::Pairs,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum QueryError {
    #[error("{0}")]
    Refused(&'static str),
    #[error("this query would return {count} series, at most {max} are served")]
    TooManySeries { count: usize, max: usize },
    #[error("the query took longer than 10 seconds")]
    Timeout,
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PanelError {
    #[error(transparent)]
    Dashboard(#[from] DashboardError),
    #[error(transparent)]
    Query(#[from] QueryError),
}
