use serde::{Deserialize, Serialize};

use super::doc::{DashboardDoc, SchemaVersion};
use super::errors::DashboardError;
use super::value_objects::{DashboardId, DashboardName, Tags};
use crate::catalogue::ProjectId;
use crate::identity::AccountId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DashboardFile {
    pub name: DashboardName,
    #[serde(default)]
    pub tags: Tags,
    pub doc: DashboardDoc,
}

impl DashboardFile {
    pub fn parse<T: AsRef<str>>(
        name: &str,
        tags: &[T],
        doc: serde_json::Value,
    ) -> Result<Self, DashboardError> {
        Ok(Self {
            name: DashboardName::try_from(name)?,
            tags: Tags::parse(tags)?,
            doc: DashboardDoc::from_value(doc)?,
        })
    }

    pub fn from_value(file: serde_json::Value) -> Result<Self, DashboardError> {
        match file.get("doc").and_then(|doc| doc.get("schema_version")) {
            Some(version) if SchemaVersion::deserialize(version).is_ok() => {}
            _ => return Err(DashboardError::UnknownSchema),
        }
        Self::deserialize(file).map_err(|error| DashboardError::Invalid(error.to_string()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dashboard {
    pub id: DashboardId,
    pub project: ProjectId,
    pub name: DashboardName,
    pub tags: Tags,
    pub doc: DashboardDoc,
    pub updated_by: Option<AccountId>,
    pub created_at_unix_nanos: u64,
    pub updated_at_unix_nanos: u64,
}

impl Dashboard {
    pub fn into_file(self) -> DashboardFile {
        DashboardFile {
            name: self.name,
            tags: self.tags,
            doc: self.doc,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashboardSummary {
    pub id: DashboardId,
    pub name: DashboardName,
    pub tags: Tags,
    pub updated_by: Option<AccountId>,
    pub updated_at_unix_nanos: u64,
}
