use crate::access::ReadRefusal;
use crate::organisation::WhoamiError;
use crate::store::StoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Cap {
    #[error("a dashboard holds at most 30 panels")]
    Panels,
    #[error("a dashboard holds at most 20 variables")]
    Variables,
    #[error("a project holds at most 100 dashboards")]
    Dashboards,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DashboardError {
    #[error("no such dashboard")]
    NotFound,
    #[error("a dashboard of that name already exists in this project")]
    NameTaken,
    #[error("a dashboard document is at most 256 KB")]
    TooLarge,
    #[error("{0}")]
    TooMany(Cap),
    #[error("this schema_version is not one this server reads")]
    UnknownSchema,
    #[error("{0}")]
    Invalid(String),
    #[error("neither a live session, a live read key nor a live agent carries this credential")]
    NoSession,
    #[error("this agent holds no scope that allows this")]
    OutOfScope,
    #[error("a store could not be reached")]
    StoreUnreachable,
}

pub(super) fn invalid(reason: impl Into<String>) -> DashboardError {
    DashboardError::Invalid(reason.into())
}

impl From<ReadRefusal> for DashboardError {
    fn from(error: ReadRefusal) -> Self {
        match error {
            ReadRefusal::Unknown => Self::NoSession,
            ReadRefusal::NotYours => Self::NotFound,
            ReadRefusal::OutOfScope => Self::OutOfScope,
            ReadRefusal::StoreUnreachable => Self::StoreUnreachable,
        }
    }
}

impl From<WhoamiError> for DashboardError {
    fn from(error: WhoamiError) -> Self {
        match error {
            WhoamiError::NoSession => Self::NoSession,
            WhoamiError::StoreUnreachable => Self::StoreUnreachable,
        }
    }
}

impl From<StoreError> for DashboardError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Unreachable => Self::StoreUnreachable,
        }
    }
}
