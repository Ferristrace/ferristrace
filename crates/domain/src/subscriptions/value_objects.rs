use core::fmt;

macro_rules! opaque_ref {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Box<str>);

        impl $name {
            pub fn new(id: impl Into<Box<str>>) -> Self {
                Self(id.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

opaque_ref!(CustomerRef);
opaque_ref!(SubscriptionRef);
opaque_ref!(PriceRef);
opaque_ref!(BillingEventId);
opaque_ref!(PlanSlug);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriptionStatus {
    Active,
    PastDue,
    Canceled,
}

impl SubscriptionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::PastDue => "past_due",
            Self::Canceled => "canceled",
        }
    }

    pub fn parse(spelling: &str) -> Option<Self> {
        match spelling {
            "active" => Some(Self::Active),
            "past_due" => Some(Self::PastDue),
            "canceled" => Some(Self::Canceled),
            _ => None,
        }
    }

    pub fn keeps_the_paid_plan(self) -> bool {
        !matches!(self, Self::Canceled)
    }
}

impl fmt::Display for SubscriptionStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckoutUrl(Box<str>);

impl CheckoutUrl {
    pub fn new(url: impl Into<Box<str>>) -> Self {
        Self(url.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortalUrl(Box<str>);

impl PortalUrl {
    pub fn new(url: impl Into<Box<str>>) -> Self {
        Self(url.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
