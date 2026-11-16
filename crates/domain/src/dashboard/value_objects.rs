use core::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use uuid::Uuid;

use super::errors::{DashboardError, invalid};

pub const MAX_NAME_CHARS: usize = 120;
pub const MAX_TAGS: usize = 10;
const MAX_TAG_CHARS: usize = 32;
const MAX_ID_CHARS: usize = 64;
const MAX_VARIABLE_CHARS: usize = 32;
const MAX_METRIC_CHARS: usize = 256;

macro_rules! text_value {
    ($type:ident) => {
        impl $type {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $type {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }

        impl Serialize for $type {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.0)
            }
        }

        impl<'de> Deserialize<'de> for $type {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let text = String::deserialize(deserializer)?;
                Self::try_from(text.as_str()).map_err(de::Error::custom)
            }
        }
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DashboardId(Uuid);

impl DashboardId {
    pub fn new(id: Uuid) -> Self {
        Self(id)
    }

    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl fmt::Display for DashboardId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

fn no_control(text: &str, what: &str) -> Result<(), DashboardError> {
    if text.chars().any(char::is_control) {
        return Err(invalid(format!("{what} holds no control character")));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashboardName(Box<str>);

impl DashboardName {
    pub fn copy(&self, attempt: u32) -> Self {
        let suffix = if attempt <= 1 {
            " copy".to_owned()
        } else {
            format!(" copy {attempt}")
        };
        let room = MAX_NAME_CHARS.saturating_sub(suffix.chars().count());
        let base: String = self.0.chars().take(room).collect();
        Self(format!("{}{suffix}", base.trim_end()).into())
    }
}

impl TryFrom<&str> for DashboardName {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        let name = typed.trim();
        if name.is_empty() {
            return Err(invalid("a dashboard needs a name"));
        }
        if name.chars().count() > MAX_NAME_CHARS {
            return Err(invalid(format!(
                "a dashboard name is at most {MAX_NAME_CHARS} characters"
            )));
        }
        no_control(name, "a dashboard name")?;
        Ok(Self(name.into()))
    }
}

text_value!(DashboardName);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tag(Box<str>);

impl TryFrom<&str> for Tag {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        let tag = typed.trim();
        if tag.is_empty() || tag.chars().count() > MAX_TAG_CHARS {
            return Err(invalid(format!("a tag is 1 to {MAX_TAG_CHARS} characters")));
        }
        no_control(tag, "a tag")?;
        Ok(Self(tag.into()))
    }
}

text_value!(Tag);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tags(Vec<Tag>);

impl Tags {
    pub fn new(tags: Vec<Tag>) -> Result<Self, DashboardError> {
        if tags.len() > MAX_TAGS {
            return Err(invalid(format!(
                "a dashboard holds at most {MAX_TAGS} tags"
            )));
        }
        for (at, tag) in tags.iter().enumerate() {
            if tags[..at].contains(tag) {
                return Err(invalid("a dashboard carries each tag once"));
            }
        }
        Ok(Self(tags))
    }

    pub fn parse<T: AsRef<str>>(spellings: &[T]) -> Result<Self, DashboardError> {
        Self::new(
            spellings
                .iter()
                .map(|spelling| Tag::try_from(spelling.as_ref()))
                .collect::<Result<_, _>>()?,
        )
    }

    pub fn as_slice(&self) -> &[Tag] {
        &self.0
    }
}

impl Serialize for Tags {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Tags {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(Vec::<Tag>::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

fn identifier(
    text: &str,
    max: usize,
    what: &str,
    allowed: impl Fn(char) -> bool,
) -> Result<(), DashboardError> {
    if text.is_empty() || text.chars().count() > max || !text.chars().all(allowed) {
        return Err(invalid(format!(
            "{what} is 1 to {max} characters from a to z, 0 to 9, `-` and `_`"
        )));
    }
    Ok(())
}

fn word(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '-' || character == '_'
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanelId(Box<str>);

impl TryFrom<&str> for PanelId {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        identifier(typed, MAX_ID_CHARS, "a panel id", word)?;
        Ok(Self(typed.into()))
    }
}

text_value!(PanelId);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryName(Box<str>);

impl TryFrom<&str> for QueryName {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        identifier(typed, MAX_VARIABLE_CHARS, "a query name", word)?;
        Ok(Self(typed.into()))
    }
}

text_value!(QueryName);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariableName(Box<str>);

impl TryFrom<&str> for VariableName {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        let shaped = |character: char| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        };
        identifier(typed, MAX_VARIABLE_CHARS, "a variable name", shaped)?;
        if typed.starts_with(|first: char| first.is_ascii_digit()) {
            return Err(invalid("a variable name starts with a letter or `_`"));
        }
        Ok(Self(typed.into()))
    }
}

text_value!(VariableName);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetricName(Box<str>);

impl TryFrom<&str> for MetricName {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        if typed.is_empty() || typed.chars().count() > MAX_METRIC_CHARS {
            return Err(invalid(format!(
                "a metric name is 1 to {MAX_METRIC_CHARS} characters"
            )));
        }
        no_control(typed, "a metric name")?;
        Ok(Self(typed.into()))
    }
}

text_value!(MetricName);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelKind {
    TimeSeries,
    Area,
    Bar,
    Pie,
    Scatter,
    Histogram,
    Heatmap,
    Number,
    Table,
    List,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResultShape {
    Series,
    Scalar,
    Rows,
    Buckets,
    Heat,
    Pairs,
    None,
}

impl PanelKind {
    pub const ALL: [Self; 11] = [
        Self::TimeSeries,
        Self::Area,
        Self::Bar,
        Self::Pie,
        Self::Scatter,
        Self::Histogram,
        Self::Heatmap,
        Self::Number,
        Self::Table,
        Self::List,
        Self::Text,
    ];

    pub fn result_shape(self) -> ResultShape {
        match self {
            Self::TimeSeries | Self::Area | Self::Bar => ResultShape::Series,
            Self::Pie | Self::Table | Self::List => ResultShape::Rows,
            Self::Scatter => ResultShape::Pairs,
            Self::Histogram => ResultShape::Buckets,
            Self::Heatmap => ResultShape::Heat,
            Self::Number => ResultShape::Scalar,
            Self::Text => ResultShape::None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::TimeSeries => "time_series",
            Self::Area => "area",
            Self::Bar => "bar",
            Self::Pie => "pie",
            Self::Scatter => "scatter",
            Self::Histogram => "histogram",
            Self::Heatmap => "heatmap",
            Self::Number => "number",
            Self::Table => "table",
            Self::List => "list",
            Self::Text => "text",
        }
    }
}

impl fmt::Display for PanelKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}
