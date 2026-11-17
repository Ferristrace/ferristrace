use core::fmt;

pub(crate) struct StripeSecretKey(Box<str>);

impl StripeSecretKey {
    pub(crate) fn new(secret: impl Into<Box<str>>) -> Self {
        Self(secret.into())
    }

    pub(crate) fn exposed(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for StripeSecretKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StripeSecretKey(redacted)")
    }
}

pub(crate) struct WebhookSigningSecret(Box<str>);

impl WebhookSigningSecret {
    pub(crate) fn new(secret: impl Into<Box<str>>) -> Self {
        Self(secret.into())
    }

    pub(crate) fn exposed(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for WebhookSigningSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("WebhookSigningSecret(redacted)")
    }
}
