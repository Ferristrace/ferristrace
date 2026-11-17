#[derive(Debug, thiserror::Error)]
pub enum WebhookError {
    #[error("the webhook signature does not match")]
    BadSignature,
    #[error("the webhook body could not be read")]
    Malformed,
}

#[derive(Debug, thiserror::Error)]
pub enum GatewayError {
    #[error("the billing gateway could not be reached")]
    Unreachable,
}

#[derive(Debug, thiserror::Error)]
pub enum SubscriptionsError {
    #[error("the control plane refused the subscription query")]
    ControlPlane,
}
