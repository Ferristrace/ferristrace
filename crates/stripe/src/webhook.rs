use ferristrace_domain::{
    StripeCustomerId, StripeEventId, StripePriceId, StripeSubscriptionId, SubscriptionStatus,
    TenantId, WebhookError, WebhookEvent,
};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use time::OffsetDateTime;
use uuid::Uuid;

const SIGNATURE_TOLERANCE_SECONDS: i64 = 300;

pub(crate) fn verify(
    secret: &str,
    signature: &str,
    body: &[u8],
) -> Result<WebhookEvent, WebhookError> {
    let (timestamp, candidates) = parse_header(signature).ok_or(WebhookError::Malformed)?;
    let now = OffsetDateTime::now_utc().unix_timestamp();
    if (now - timestamp).abs() > SIGNATURE_TOLERANCE_SECONDS {
        return Err(WebhookError::BadSignature);
    }
    let expected = sign(secret, timestamp, body);
    let matches = candidates
        .iter()
        .any(|candidate| bool::from(candidate.as_bytes().ct_eq(expected.as_bytes())));
    if !matches {
        return Err(WebhookError::BadSignature);
    }
    parse_event(body)
}

fn parse_header(header: &str) -> Option<(i64, Vec<String>)> {
    let mut timestamp = None;
    let mut candidates = Vec::new();
    for part in header.split(',') {
        let (key, value) = part.split_once('=')?;
        match key.trim() {
            "t" => timestamp = value.trim().parse::<i64>().ok(),
            "v1" => candidates.push(value.trim().to_owned()),
            _ => {}
        }
    }
    let timestamp = timestamp?;
    if candidates.is_empty() {
        None
    } else {
        Some((timestamp, candidates))
    }
}

pub(crate) fn sign(secret: &str, timestamp: i64, body: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(secret.as_bytes())
        .expect("hmac takes a key of any length");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

fn parse_event(body: &[u8]) -> Result<WebhookEvent, WebhookError> {
    let envelope: Value = serde_json::from_slice(body).map_err(|_| WebhookError::Malformed)?;
    let event = envelope
        .get("id")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let event = StripeEventId::new(event);
    let kind = envelope
        .get("type")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let object = envelope
        .get("data")
        .and_then(|data| data.get("object"))
        .ok_or(WebhookError::Malformed)?;
    match kind {
        "checkout.session.completed" => activated(event, object),
        "customer.subscription.deleted" => retries_exhausted(event, object),
        _ => Ok(WebhookEvent::Ignored { event }),
    }
}

fn activated(event: StripeEventId, object: &Value) -> Result<WebhookEvent, WebhookError> {
    let org = object
        .get("client_reference_id")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let org = Uuid::parse_str(org).map_err(|_| WebhookError::Malformed)?;
    let customer = object
        .get("customer")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let subscription = object
        .get("subscription")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let period_end = object
        .get("expires_at")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let price = object
        .get("metadata")
        .and_then(|metadata| metadata.get("price_id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok(WebhookEvent::Activated {
        event,
        org: TenantId::new(org),
        customer: StripeCustomerId::new(customer),
        subscription: StripeSubscriptionId::new(subscription),
        price: StripePriceId::new(price),
        status: SubscriptionStatus::Active,
        period_end,
    })
}

fn retries_exhausted(event: StripeEventId, object: &Value) -> Result<WebhookEvent, WebhookError> {
    let customer = object
        .get("customer")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    Ok(WebhookEvent::RetriesExhausted {
        event,
        customer: StripeCustomerId::new(customer),
    })
}

#[cfg(test)]
mod tests {
    use ferristrace_domain::{
        StripeCustomerId, StripeEventId, StripePriceId, StripeSubscriptionId, SubscriptionStatus,
        TenantId, WebhookError, WebhookEvent,
    };
    use time::OffsetDateTime;
    use uuid::Uuid;

    use super::{sign, verify};

    const SECRET: &str = "whsec_test";

    fn now() -> i64 {
        OffsetDateTime::now_utc().unix_timestamp()
    }

    fn header(secret: &str, timestamp: i64, body: &[u8]) -> String {
        format!("t={timestamp},v1={}", sign(secret, timestamp, body))
    }

    fn checkout_completed(org: Uuid) -> Vec<u8> {
        serde_json::json!({
            "id": "evt_1",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "client_reference_id": org.to_string(),
                    "customer": "cus_1",
                    "subscription": "sub_1",
                    "expires_at": 1_700_000_000,
                }
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn a_correctly_signed_recent_header_is_accepted_and_mapped_to_activated() {
        let org = Uuid::from_u128(42);
        let body = checkout_completed(org);
        let timestamp = now();
        let signature = header(SECRET, timestamp, &body);

        let event = verify(SECRET, &signature, &body).expect("a valid signature verifies");

        assert_eq!(
            event,
            WebhookEvent::Activated {
                event: StripeEventId::new("evt_1"),
                org: TenantId::new(org),
                customer: StripeCustomerId::new("cus_1"),
                subscription: StripeSubscriptionId::new("sub_1"),
                price: StripePriceId::new(""),
                status: SubscriptionStatus::Active,
                period_end: 1_700_000_000,
            }
        );
    }

    #[test]
    fn a_tampered_body_is_rejected() {
        let body = checkout_completed(Uuid::from_u128(1));
        let timestamp = now();
        let signature = header(SECRET, timestamp, &body);
        let mut tampered = body.clone();
        tampered.push(b' ');

        assert!(matches!(
            verify(SECRET, &signature, &tampered),
            Err(WebhookError::BadSignature)
        ));
    }

    #[test]
    fn a_stale_timestamp_is_rejected() {
        let body = checkout_completed(Uuid::from_u128(1));
        let timestamp = now() - 301;
        let signature = header(SECRET, timestamp, &body);

        assert!(matches!(
            verify(SECRET, &signature, &body),
            Err(WebhookError::BadSignature)
        ));
    }

    #[test]
    fn a_malformed_header_is_rejected() {
        let body = checkout_completed(Uuid::from_u128(1));

        assert!(matches!(
            verify(SECRET, "not-a-signature", &body),
            Err(WebhookError::Malformed)
        ));
        assert!(matches!(
            verify(SECRET, "t=notanumber,v1=abc", &body),
            Err(WebhookError::Malformed)
        ));
        assert!(matches!(
            verify(SECRET, "t=1700000000", &body),
            Err(WebhookError::Malformed)
        ));
    }

    #[test]
    fn any_matching_v1_in_a_rotated_header_is_accepted() {
        let body = checkout_completed(Uuid::from_u128(1));
        let timestamp = now();
        let correct = sign(SECRET, timestamp, &body);
        let signature = format!("t={timestamp},v1=deadbeef,v1={correct}");

        assert!(verify(SECRET, &signature, &body).is_ok());
    }

    #[test]
    fn a_subscription_deletion_reports_retries_exhausted() {
        let body = serde_json::json!({
            "id": "evt_2",
            "type": "customer.subscription.deleted",
            "data": {"object": {"customer": "cus_2"}}
        })
        .to_string()
        .into_bytes();
        let timestamp = now();
        let signature = header(SECRET, timestamp, &body);

        let event = verify(SECRET, &signature, &body).expect("verifies");

        assert_eq!(
            event,
            WebhookEvent::RetriesExhausted {
                event: StripeEventId::new("evt_2"),
                customer: StripeCustomerId::new("cus_2"),
            }
        );
    }

    #[test]
    fn an_unrecognised_type_is_ignored() {
        let body = serde_json::json!({
            "id": "evt_3",
            "type": "invoice.paid",
            "data": {"object": {}}
        })
        .to_string()
        .into_bytes();
        let timestamp = now();
        let signature = header(SECRET, timestamp, &body);

        let event = verify(SECRET, &signature, &body).expect("verifies");

        assert_eq!(
            event,
            WebhookEvent::Ignored {
                event: StripeEventId::new("evt_3"),
            }
        );
    }
}
