use std::collections::BTreeMap;

use super::errors::{DashboardError, invalid};
use super::filter::{Condition, Filter, FilterValue, Operand};
use super::value_objects::VariableName;
use crate::explore::{Clause, Expr, Field, Number, Op, Scalar, Value};

const MAX_NAMED: usize = 20;
const MAX_VALUES: usize = 100;
const MAX_VALUE_BYTES: usize = 512;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Variables(Vec<(VariableName, Vec<Box<str>>)>);

impl Variables {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn new(chosen: BTreeMap<String, Vec<String>>) -> Result<Self, DashboardError> {
        if chosen.len() > MAX_NAMED {
            return Err(invalid(format!("at most {MAX_NAMED} variables are given")));
        }
        let mut named = Vec::with_capacity(chosen.len());
        for (name, values) in chosen {
            if values.len() > MAX_VALUES || values.iter().any(|value| value.len() > MAX_VALUE_BYTES)
            {
                return Err(invalid(format!(
                    "variable `{name}` holds at most {MAX_VALUES} values of {MAX_VALUE_BYTES} bytes"
                )));
            }
            named.push((
                VariableName::try_from(name.as_str())?,
                values.into_iter().map(String::into_boxed_str).collect(),
            ));
        }
        Ok(Self(named))
    }

    fn values(&self, name: &VariableName) -> Vec<&str> {
        self.0
            .iter()
            .find(|(held, _)| held == name)
            .map_or_else(Vec::new, |(_, values)| {
                values
                    .iter()
                    .map(|value| &**value)
                    .filter(|value| !value.is_empty())
                    .collect()
            })
    }

    pub fn resolve(&self, filter: &Filter) -> Result<Option<Expr>, DashboardError> {
        self.resolved(filter, false)
    }

    fn resolved(&self, filter: &Filter, negated: bool) -> Result<Option<Expr>, DashboardError> {
        match filter {
            Filter::Is(condition) => self.condition(condition),
            Filter::Not(inner) => Ok(self
                .resolved(inner, true)?
                .map(|expr| Expr::Not(Box::new(expr)))),
            Filter::All(parts) => Ok(self.group(parts, negated, negated)?.map(Expr::All)),
            Filter::Any(parts) => Ok(self.group(parts, true, negated)?.map(Expr::Any)),
        }
    }

    fn group(
        &self,
        parts: &[Filter],
        all_or_nothing: bool,
        negated: bool,
    ) -> Result<Option<Vec<Expr>>, DashboardError> {
        let mut kept = Vec::with_capacity(parts.len());
        for part in parts {
            match self.resolved(part, negated)? {
                Some(expr) => kept.push(expr),
                None if all_or_nothing => return Ok(None),
                None => {}
            }
        }
        Ok((!kept.is_empty()).then_some(kept))
    }

    fn condition(&self, condition: &Condition) -> Result<Option<Expr>, DashboardError> {
        let field = condition.column().field();
        let op = condition.op();
        match condition.operand() {
            Operand::Nothing => is(field, op, Value::Nothing),
            Operand::One(FilterValue::Literal(scalar)) => is(field, op, Value::One(scalar.clone())),
            Operand::One(FilterValue::Variable(name)) => {
                let chosen = self.values(name);
                match chosen.as_slice() {
                    [] => Ok(None),
                    [one] if !matches!(op, Op::In | Op::NotIn) => {
                        is(field, op, Value::One(scalar(field, op, one)?))
                    }
                    _ => listed(field, op, &chosen),
                }
            }
            Operand::Many(items) => {
                let mut scalars = Vec::with_capacity(items.len());
                for item in items {
                    match item {
                        FilterValue::Literal(held) => scalars.push(held.clone()),
                        FilterValue::Variable(name) => {
                            for value in self.values(name) {
                                scalars.push(scalar(field, Op::Eq, value)?);
                            }
                        }
                    }
                }
                if scalars.is_empty() {
                    Ok(None)
                } else {
                    is(field, op, Value::Many(scalars))
                }
            }
        }
    }
}

fn is(field: &Field, op: Op, value: Value) -> Result<Option<Expr>, DashboardError> {
    Clause::new(field.clone(), op, value)
        .map(|clause| Some(Expr::Is(clause)))
        .map_err(|error| invalid(error.to_string()))
}

fn scalar(field: &Field, op: Op, text: &str) -> Result<Scalar, DashboardError> {
    let numeric = matches!(op, Op::Gt | Op::Gte | Op::Lt | Op::Lte)
        || matches!(field, Field::Duration | Field::HttpStatusCode);
    if !numeric {
        return Ok(Scalar::Text(text.into()));
    }
    text.trim()
        .parse::<f64>()
        .ok()
        .and_then(|number| Number::new(number).ok())
        .map(Scalar::Number)
        .ok_or_else(|| invalid("a variable used with this field holds a number"))
}

fn listed(field: &Field, op: Op, values: &[&str]) -> Result<Option<Expr>, DashboardError> {
    let scalars = |op| {
        values
            .iter()
            .map(|value| scalar(field, op, value))
            .collect::<Result<Vec<_>, _>>()
    };
    let each = |op: Op| {
        values
            .iter()
            .map(|value| is(field, op, Value::One(scalar(field, op, value)?)))
            .collect::<Result<Vec<_>, _>>()
            .map(|parts| parts.into_iter().flatten().collect::<Vec<_>>())
    };
    match op {
        Op::Eq | Op::In => is(field, Op::In, Value::Many(scalars(Op::Eq)?)),
        Op::Ne | Op::NotIn => is(field, Op::NotIn, Value::Many(scalars(Op::Eq)?)),
        Op::Contains => Ok(Some(Expr::Any(each(Op::Contains)?))),
        Op::NotContains => Ok(Some(Expr::All(each(Op::NotContains)?))),
        Op::Gt | Op::Gte | Op::Lt | Op::Lte | Op::Exists | Op::NotExists => Err(invalid(
            "a variable with several values needs `eq`, `ne`, `in`, `not_in` or `contains`",
        )),
    }
}
