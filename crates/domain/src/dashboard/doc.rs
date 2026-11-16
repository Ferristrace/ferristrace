use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

use super::errors::{Cap, DashboardError, invalid};
use super::filter::Key;
use super::panel::{LayoutItem, Panel};
use super::query::QuerySignal;
use super::value_objects::VariableName;

pub const MAX_PANELS: usize = 30;
pub const MAX_VARIABLES: usize = 20;
pub const MAX_DOC_BYTES: usize = 256 * 1024;
pub const GRID_COLUMNS: u8 = 12;
const MAX_LABEL_CHARS: usize = 80;
const MAX_CHOICES: usize = 100;
const MAX_CHOICE_BYTES: usize = 512;
const MIN_RANGE_SECS: u32 = 60;
const MAX_RANGE_SECS: u32 = 31 * 24 * 3_600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum SchemaVersion {
    V1 = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u32", into = "u32")]
pub struct Range(u32);

impl Range {
    pub fn secs(self) -> u32 {
        self.0
    }
}

impl TryFrom<u32> for Range {
    type Error = DashboardError;

    fn try_from(secs: u32) -> Result<Self, Self::Error> {
        if (MIN_RANGE_SECS..=MAX_RANGE_SECS).contains(&secs) {
            Ok(Self(secs))
        } else {
            Err(invalid(
                "a default duration is between one minute and 31 days, in seconds",
            ))
        }
    }
}

impl From<Range> for u32 {
    fn from(range: Range) -> Self {
        range.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum VariableSource {
    Attribute { signal: QuerySignal, key: Key },
    Static { values: Vec<Box<str>> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variable {
    pub name: VariableName,
    #[serde(default)]
    pub label: Box<str>,
    pub source: VariableSource,
    #[serde(default)]
    pub multi: bool,
    #[serde(default)]
    pub all: bool,
}

impl Variable {
    fn check(&self) -> Result<(), DashboardError> {
        if self.label.chars().count() > MAX_LABEL_CHARS {
            return Err(invalid(format!(
                "a variable label is at most {MAX_LABEL_CHARS} characters"
            )));
        }
        if let VariableSource::Static { values } = &self.source {
            if values.is_empty() || values.len() > MAX_CHOICES {
                return Err(invalid(format!(
                    "a static variable lists 1 to {MAX_CHOICES} values"
                )));
            }
            if values
                .iter()
                .any(|value| value.is_empty() || value.len() > MAX_CHOICE_BYTES)
            {
                return Err(invalid(format!(
                    "a static value is 1 to {MAX_CHOICE_BYTES} bytes"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "DocDraft")]
pub struct DashboardDoc {
    schema_version: SchemaVersion,
    variables: Vec<Variable>,
    panels: Vec<Panel>,
    layout: Vec<LayoutItem>,
    duration: Range,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocDraft {
    pub schema_version: SchemaVersion,
    #[serde(default)]
    pub variables: Vec<Variable>,
    #[serde(default)]
    pub panels: Vec<Panel>,
    #[serde(default)]
    pub layout: Vec<LayoutItem>,
    pub duration: Range,
}

impl DashboardDoc {
    pub fn new(draft: DocDraft) -> Result<Self, DashboardError> {
        let DocDraft {
            schema_version,
            variables,
            panels,
            layout,
            duration,
        } = draft;
        if panels.len() > MAX_PANELS {
            return Err(DashboardError::TooMany(Cap::Panels));
        }
        if variables.len() > MAX_VARIABLES {
            return Err(DashboardError::TooMany(Cap::Variables));
        }
        for (at, variable) in variables.iter().enumerate() {
            variable.check()?;
            if variables[..at]
                .iter()
                .any(|earlier| earlier.name == variable.name)
            {
                return Err(invalid(format!(
                    "variable `{}` is declared twice",
                    variable.name
                )));
            }
        }
        for (at, panel) in panels.iter().enumerate() {
            if panels[..at]
                .iter()
                .any(|earlier| earlier.id() == panel.id())
            {
                return Err(invalid(format!("panel `{}` appears twice", panel.id())));
            }
        }
        for (at, item) in layout.iter().enumerate() {
            if !panels.iter().any(|panel| panel.id() == &item.panel) {
                return Err(invalid(format!(
                    "the layout places panel `{}`, which does not exist",
                    item.panel
                )));
            }
            if layout[..at]
                .iter()
                .any(|earlier| earlier.panel == item.panel)
            {
                return Err(invalid(format!(
                    "the layout places panel `{}` twice",
                    item.panel
                )));
            }
            let fits = item.w >= 1
                && item.h >= 1
                && u16::from(item.x) + u16::from(item.w) <= u16::from(GRID_COLUMNS);
            if !fits {
                return Err(invalid(format!(
                    "panel `{}` does not fit the {GRID_COLUMNS} columns of the grid",
                    item.panel
                )));
            }
        }
        for panel in &panels {
            for query in panel.queries() {
                let named = query.filter().map(|filter| filter.variables());
                for name in named.into_iter().flatten() {
                    if !variables.iter().any(|declared| &declared.name == name) {
                        return Err(invalid(format!(
                            "panel `{}` uses variable `{name}`, which is not declared",
                            panel.id()
                        )));
                    }
                }
            }
        }
        let doc = Self {
            schema_version,
            variables,
            panels,
            layout,
            duration,
        };
        let bytes = serde_json::to_vec(&doc).map_err(|error| invalid(error.to_string()))?;
        if bytes.len() > MAX_DOC_BYTES {
            return Err(DashboardError::TooLarge);
        }
        Ok(doc)
    }

    pub fn from_value(value: serde_json::Value) -> Result<Self, DashboardError> {
        match value.get("schema_version") {
            Some(version) if SchemaVersion::deserialize(version).is_ok() => {}
            _ => return Err(DashboardError::UnknownSchema),
        }
        let draft = DocDraft::deserialize(value).map_err(|error| invalid(error.to_string()))?;
        Self::new(draft)
    }

    pub fn schema_version(&self) -> SchemaVersion {
        self.schema_version
    }

    pub fn variables(&self) -> &[Variable] {
        &self.variables
    }

    pub fn panels(&self) -> &[Panel] {
        &self.panels
    }

    pub fn layout(&self) -> &[LayoutItem] {
        &self.layout
    }

    pub fn duration(&self) -> Range {
        self.duration
    }
}

impl TryFrom<DocDraft> for DashboardDoc {
    type Error = DashboardError;

    fn try_from(draft: DocDraft) -> Result<Self, Self::Error> {
        Self::new(draft)
    }
}
