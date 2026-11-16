use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

use super::errors::{DashboardError, invalid};
use super::value_objects::VariableName;
use crate::explore::{AttributeKey, BadQuery, Clause, Field, Number, Op, Scalar, Stream, Value};

const MAX_DEPTH: usize = 8;
const MAX_CONDITIONS: usize = 32;
const MAX_LIST: usize = 50;
const EXACT_INTEGERS: f64 = 9_007_199_254_740_992.0;

fn refused(error: BadQuery) -> DashboardError {
    invalid(error.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BuiltIn {
    Service,
    Name,
    Status,
    Kind,
    Duration,
    HttpStatusCode,
    TraceId,
    SpanId,
    Severity,
    Body,
}

impl From<BuiltIn> for Field {
    fn from(built: BuiltIn) -> Self {
        match built {
            BuiltIn::Service => Self::Service,
            BuiltIn::Name => Self::Name,
            BuiltIn::Status => Self::Status,
            BuiltIn::Kind => Self::Kind,
            BuiltIn::Duration => Self::Duration,
            BuiltIn::HttpStatusCode => Self::HttpStatusCode,
            BuiltIn::TraceId => Self::TraceId,
            BuiltIn::SpanId => Self::SpanId,
            BuiltIn::Severity => Self::Severity,
            BuiltIn::Body => Self::Body,
        }
    }
}

fn built_in(field: &Field) -> Option<BuiltIn> {
    Some(match field {
        Field::Service => BuiltIn::Service,
        Field::Name => BuiltIn::Name,
        Field::Status => BuiltIn::Status,
        Field::Kind => BuiltIn::Kind,
        Field::Duration => BuiltIn::Duration,
        Field::HttpStatusCode => BuiltIn::HttpStatusCode,
        Field::TraceId => BuiltIn::TraceId,
        Field::SpanId => BuiltIn::SpanId,
        Field::Severity => BuiltIn::Severity,
        Field::Body => BuiltIn::Body,
        Field::Attribute(_) => return None,
    })
}

fn field_of(built: Option<BuiltIn>, attr: Option<&str>) -> Result<Field, DashboardError> {
    match (built, attr) {
        (Some(built), None) => Ok(built.into()),
        (None, Some(key)) => Ok(Field::Attribute(AttributeKey::new(key).map_err(refused)?)),
        _ => Err(invalid("a field is a `field` or an `attr`, not both")),
    }
}

fn attr_of(field: &Field) -> Option<String> {
    match field {
        Field::Attribute(key) => Some(key.as_str().to_owned()),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Key(AttributeKey);

impl Key {
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl TryFrom<&str> for Key {
    type Error = DashboardError;

    fn try_from(typed: &str) -> Result<Self, Self::Error> {
        AttributeKey::new(typed).map(Self).map_err(refused)
    }
}

impl Serialize for Key {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0.as_str())
    }
}

impl<'de> Deserialize<'de> for Key {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::try_from(text.as_str()).map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Column(Field);

impl Column {
    pub fn new(field: Field) -> Self {
        Self(field)
    }

    pub fn field(&self) -> &Field {
        &self.0
    }

    pub fn is_numeric(&self) -> bool {
        matches!(
            self.0,
            Field::Duration | Field::HttpStatusCode | Field::Attribute(_)
        )
    }

    pub fn belongs_to(&self, stream: Stream) -> bool {
        self.0.belongs_to(stream)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ColumnWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    field: Option<BuiltIn>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attr: Option<String>,
}

impl Serialize for Column {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ColumnWire {
            field: built_in(&self.0),
            attr: attr_of(&self.0),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Column {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = ColumnWire::deserialize(deserializer)?;
        field_of(wire.field, wire.attr.as_deref())
            .map(Self)
            .map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterValue {
    Literal(Scalar),
    Variable(VariableName),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Operand {
    Nothing,
    One(FilterValue),
    Many(Vec<FilterValue>),
}

impl Operand {
    fn literal(&self) -> Option<Value> {
        match self {
            Self::Nothing => Some(Value::Nothing),
            Self::One(FilterValue::Literal(scalar)) => Some(Value::One(scalar.clone())),
            Self::One(FilterValue::Variable(_)) => None,
            Self::Many(values) => values
                .iter()
                .map(|value| match value {
                    FilterValue::Literal(scalar) => Some(scalar.clone()),
                    FilterValue::Variable(_) => None,
                })
                .collect::<Option<Vec<_>>>()
                .map(Value::Many),
        }
    }

    fn variables(&self) -> impl Iterator<Item = &VariableName> {
        let held: &[FilterValue] = match self {
            Self::Nothing => &[],
            Self::One(one) => std::slice::from_ref(one),
            Self::Many(many) => many,
        };
        held.iter().filter_map(|value| match value {
            FilterValue::Variable(name) => Some(name),
            FilterValue::Literal(_) => None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Condition {
    column: Column,
    op: Op,
    operand: Operand,
}

impl Condition {
    pub fn new(column: Column, op: Op, operand: Operand) -> Result<Self, DashboardError> {
        match operand.literal() {
            Some(value) => {
                Clause::new(column.0.clone(), op, value).map_err(refused)?;
            }
            None => variable_shape(op, &operand)?,
        }
        Ok(Self {
            column,
            op,
            operand,
        })
    }

    pub fn column(&self) -> &Column {
        &self.column
    }

    pub fn op(&self) -> Op {
        self.op
    }

    pub fn operand(&self) -> &Operand {
        &self.operand
    }
}

fn variable_shape(op: Op, operand: &Operand) -> Result<(), DashboardError> {
    let fits = match operand {
        Operand::Many(values) => {
            matches!(op, Op::In | Op::NotIn) && (1..=MAX_LIST).contains(&values.len())
        }
        Operand::One(_) => !matches!(op, Op::Exists | Op::NotExists),
        Operand::Nothing => true,
    };
    if fits {
        Ok(())
    } else {
        Err(refused(BadQuery::Shape))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Filter {
    All(Vec<Filter>),
    Any(Vec<Filter>),
    Not(Box<Filter>),
    Is(Condition),
}

impl Filter {
    pub fn fits(&self, stream: Stream) -> Result<(), DashboardError> {
        let fits = match self {
            Self::Is(condition) => condition.column.belongs_to(stream),
            Self::Not(inner) => return inner.fits(stream),
            Self::All(parts) | Self::Any(parts) => {
                return parts.iter().try_for_each(|part| part.fits(stream));
            }
        };
        if fits {
            Ok(())
        } else {
            Err(refused(BadQuery::Field))
        }
    }

    pub fn variables(&self) -> Vec<&VariableName> {
        match self {
            Self::Is(condition) => condition.operand.variables().collect(),
            Self::Not(inner) => inner.variables(),
            Self::All(parts) | Self::Any(parts) => parts.iter().flat_map(Self::variables).collect(),
        }
    }

    fn build(wire: FilterWire, depth: usize, count: &mut usize) -> Result<Self, DashboardError> {
        if depth > MAX_DEPTH {
            return Err(refused(BadQuery::Deep));
        }
        match wire {
            FilterWire::All(AllWire { all: parts }) => {
                Ok(Self::All(Self::group(parts, depth, count)?))
            }
            FilterWire::Any(AnyWire { any: parts }) => {
                Ok(Self::Any(Self::group(parts, depth, count)?))
            }
            FilterWire::Not(NotWire { not }) => {
                Ok(Self::Not(Box::new(Self::build(*not, depth + 1, count)?)))
            }
            FilterWire::Is(condition) => {
                *count += 1;
                if *count > MAX_CONDITIONS {
                    return Err(refused(BadQuery::Large));
                }
                Ok(Self::Is(condition.condition()?))
            }
        }
    }

    fn group(
        parts: Vec<FilterWire>,
        depth: usize,
        count: &mut usize,
    ) -> Result<Vec<Self>, DashboardError> {
        if parts.is_empty() {
            return Err(refused(BadQuery::Empty));
        }
        parts
            .into_iter()
            .map(|part| Self::build(part, depth + 1, count))
            .collect()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OpWire {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    NotContains,
    In,
    NotIn,
    Exists,
    NotExists,
}

impl From<OpWire> for Op {
    fn from(op: OpWire) -> Self {
        match op {
            OpWire::Eq => Self::Eq,
            OpWire::Ne => Self::Ne,
            OpWire::Gt => Self::Gt,
            OpWire::Gte => Self::Gte,
            OpWire::Lt => Self::Lt,
            OpWire::Lte => Self::Lte,
            OpWire::Contains => Self::Contains,
            OpWire::NotContains => Self::NotContains,
            OpWire::In => Self::In,
            OpWire::NotIn => Self::NotIn,
            OpWire::Exists => Self::Exists,
            OpWire::NotExists => Self::NotExists,
        }
    }
}

impl From<Op> for OpWire {
    fn from(op: Op) -> Self {
        match op {
            Op::Eq => Self::Eq,
            Op::Ne => Self::Ne,
            Op::Gt => Self::Gt,
            Op::Gte => Self::Gte,
            Op::Lt => Self::Lt,
            Op::Lte => Self::Lte,
            Op::Contains => Self::Contains,
            Op::NotContains => Self::NotContains,
            Op::In => Self::In,
            Op::NotIn => Self::NotIn,
            Op::Exists => Self::Exists,
            Op::NotExists => Self::NotExists,
        }
    }
}

#[allow(clippy::cast_possible_truncation, clippy::trivially_copy_pass_by_ref)]
fn number<S: Serializer>(count: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if count.fract() == 0.0 && count.abs() < EXACT_INTEGERS {
        serializer.serialize_i64(*count as i64)
    } else {
        serializer.serialize_f64(*count)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct VariableWire {
    var: String,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum ValueWire {
    Flag(bool),
    Count(#[serde(serialize_with = "number")] f64),
    Word(String),
    Variable(VariableWire),
}

impl ValueWire {
    fn value(self) -> Result<FilterValue, DashboardError> {
        Ok(match self {
            Self::Flag(flag) => FilterValue::Literal(Scalar::Bool(flag)),
            Self::Count(count) => {
                FilterValue::Literal(Scalar::Number(Number::new(count).map_err(refused)?))
            }
            Self::Word(word) => FilterValue::Literal(Scalar::Text(word.into())),
            Self::Variable(VariableWire { var }) => {
                FilterValue::Variable(VariableName::try_from(var.as_str())?)
            }
        })
    }
}

impl From<&FilterValue> for ValueWire {
    fn from(value: &FilterValue) -> Self {
        match value {
            FilterValue::Literal(Scalar::Bool(flag)) => Self::Flag(*flag),
            FilterValue::Literal(Scalar::Number(count)) => Self::Count(count.get()),
            FilterValue::Literal(Scalar::Text(text)) => Self::Word(text.to_string()),
            FilterValue::Variable(name) => Self::Variable(VariableWire {
                var: name.as_str().to_owned(),
            }),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum OperandWire {
    Many(Vec<ValueWire>),
    One(ValueWire),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConditionWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    field: Option<BuiltIn>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attr: Option<String>,
    op: OpWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    value: Option<OperandWire>,
}

impl ConditionWire {
    fn condition(self) -> Result<Condition, DashboardError> {
        let field = field_of(self.field, self.attr.as_deref())?;
        let operand = match self.value {
            None => Operand::Nothing,
            Some(OperandWire::One(one)) => Operand::One(one.value()?),
            Some(OperandWire::Many(many)) => Operand::Many(
                many.into_iter()
                    .map(ValueWire::value)
                    .collect::<Result<_, _>>()?,
            ),
        };
        Condition::new(Column(field), self.op.into(), operand)
    }
}

impl From<&Condition> for ConditionWire {
    fn from(condition: &Condition) -> Self {
        Self {
            field: built_in(&condition.column.0),
            attr: attr_of(&condition.column.0),
            op: condition.op.into(),
            value: match &condition.operand {
                Operand::Nothing => None,
                Operand::One(one) => Some(OperandWire::One(one.into())),
                Operand::Many(many) => {
                    Some(OperandWire::Many(many.iter().map(Into::into).collect()))
                }
            },
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AllWire {
    all: Vec<FilterWire>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AnyWire {
    any: Vec<FilterWire>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotWire {
    not: Box<FilterWire>,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum FilterWire {
    All(AllWire),
    Any(AnyWire),
    Not(NotWire),
    Is(ConditionWire),
}

impl From<&Filter> for FilterWire {
    fn from(filter: &Filter) -> Self {
        match filter {
            Filter::All(parts) => Self::All(AllWire {
                all: parts.iter().map(Into::into).collect(),
            }),
            Filter::Any(parts) => Self::Any(AnyWire {
                any: parts.iter().map(Into::into).collect(),
            }),
            Filter::Not(inner) => Self::Not(NotWire {
                not: Box::new(Self::from(&**inner)),
            }),
            Filter::Is(condition) => Self::Is(condition.into()),
        }
    }
}

impl Serialize for Filter {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        FilterWire::from(self).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Filter {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = FilterWire::deserialize(deserializer)?;
        Self::build(wire, 1, &mut 0).map_err(de::Error::custom)
    }
}
