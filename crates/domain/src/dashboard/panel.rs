use serde::{Deserialize, Serialize};

use super::errors::{DashboardError, invalid};
use super::query::PanelQuery;
use super::value_objects::{PanelId, PanelKind, ResultShape};

pub const MAX_QUERIES: usize = 10;
const MAX_TITLE_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 1_000;
const MAX_UNIT_CHARS: usize = 32;
const MAX_DECIMALS: u8 = 10;
const MAX_CONTENT_BYTES: usize = 20_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Legend {
    #[default]
    Bottom,
    Right,
    Hidden,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PanelOptions {
    #[serde(default)]
    pub unit: Option<Box<str>>,
    #[serde(default)]
    pub decimals: Option<u8>,
    #[serde(default)]
    pub legend: Legend,
    #[serde(default)]
    pub stacked: bool,
    #[serde(default)]
    pub content: Option<Box<str>>,
}

impl PanelOptions {
    fn check(&self) -> Result<(), DashboardError> {
        if self
            .unit
            .as_deref()
            .is_some_and(|unit| unit.chars().count() > MAX_UNIT_CHARS)
        {
            return Err(invalid(format!(
                "a unit is at most {MAX_UNIT_CHARS} characters"
            )));
        }
        if self
            .decimals
            .is_some_and(|decimals| decimals > MAX_DECIMALS)
        {
            return Err(invalid(format!("decimals are at most {MAX_DECIMALS}")));
        }
        if self
            .content
            .as_deref()
            .is_some_and(|content| content.len() > MAX_CONTENT_BYTES)
        {
            return Err(invalid(format!(
                "a text panel holds at most {MAX_CONTENT_BYTES} bytes"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "PanelDraft")]
pub struct Panel {
    id: PanelId,
    title: Box<str>,
    description: Box<str>,
    kind: PanelKind,
    queries: Vec<PanelQuery>,
    options: PanelOptions,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PanelDraft {
    pub id: PanelId,
    #[serde(default)]
    pub title: Box<str>,
    #[serde(default)]
    pub description: Box<str>,
    pub kind: PanelKind,
    #[serde(default)]
    pub queries: Vec<PanelQuery>,
    #[serde(default)]
    pub options: PanelOptions,
}

impl Panel {
    pub fn new(draft: PanelDraft) -> Result<Self, DashboardError> {
        let PanelDraft {
            id,
            title,
            description,
            kind,
            queries,
            options,
        } = draft;
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(invalid(format!(
                "a panel title is at most {MAX_TITLE_CHARS} characters"
            )));
        }
        if description.chars().count() > MAX_DESCRIPTION_CHARS {
            return Err(invalid(format!(
                "a panel description is at most {MAX_DESCRIPTION_CHARS} characters"
            )));
        }
        options.check()?;
        if queries.len() > MAX_QUERIES {
            return Err(invalid(format!(
                "a panel holds at most {MAX_QUERIES} queries"
            )));
        }
        let shape = kind.result_shape();
        if shape == ResultShape::None {
            if !queries.is_empty() {
                return Err(invalid(format!("a {kind} panel runs no query")));
            }
        } else if queries.is_empty() {
            return Err(invalid(format!("a {kind} panel needs a query")));
        }
        for (at, query) in queries.iter().enumerate() {
            if queries[..at]
                .iter()
                .any(|earlier| earlier.name() == query.name())
            {
                return Err(invalid(format!(
                    "query `{}` appears twice in panel `{id}`",
                    query.name()
                )));
            }
            if !query.can_yield(shape) {
                return Err(invalid(format!(
                    "query `{}` cannot feed a {kind} panel: it does not return {shape:?}",
                    query.name()
                )));
            }
        }
        Ok(Self {
            id,
            title,
            description,
            kind,
            queries,
            options,
        })
    }

    pub fn id(&self) -> &PanelId {
        &self.id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn kind(&self) -> PanelKind {
        self.kind
    }

    pub fn queries(&self) -> &[PanelQuery] {
        &self.queries
    }

    pub fn options(&self) -> &PanelOptions {
        &self.options
    }
}

impl TryFrom<PanelDraft> for Panel {
    type Error = DashboardError;

    fn try_from(draft: PanelDraft) -> Result<Self, Self::Error> {
        Self::new(draft)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutItem {
    pub panel: PanelId,
    pub x: u8,
    pub y: u16,
    pub w: u8,
    pub h: u8,
}
