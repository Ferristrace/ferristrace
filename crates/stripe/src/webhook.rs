use ferristrace_domain::{
    BillingEventId, CustomerRef, PriceRef, SubscriptionChange, SubscriptionRef, SubscriptionStatus,
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
        .map(BillingEventId::new)
        .ok_or(WebhookError::Malformed)?;
    let kind = envelope
        .get("type")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    if !SUBSCRIPTION_EVENTS.contains(&kind) {
        return Ok(WebhookEvent::Ignored { event });
    }
    let at = envelope
        .get("created")
        .and_then(Value::as_i64)
        .ok_or(WebhookError::Malformed)?;
    let object = envelope
        .get("data")
        .and_then(|data| data.get("object"))
        .ok_or(WebhookError::Malformed)?;
    let spelling = object
        .get("status")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let status = if kind == SUBSCRIPTION_DELETED {
        Some(SubscriptionStatus::Canceled)
    } else {
        status_of(spelling)
    };
    let Some(status) = status else {
        return Ok(WebhookEvent::Ignored { event });
    };
    Ok(WebhookEvent::Changed {
        event,
        change: change_of(at, status, object)?,
    })
}

const SUBSCRIPTION_DELETED: &str = "customer.subscription.deleted";

const SUBSCRIPTION_EVENTS: [&str; 3] = [
    "customer.subscription.created",
    "customer.subscription.updated",
    SUBSCRIPTION_DELETED,
];

fn status_of(spelling: &str) -> Option<SubscriptionStatus> {
    match spelling {
        "active" | "trialing" => Some(SubscriptionStatus::Active),
        "past_due" => Some(SubscriptionStatus::PastDue),
        "unpaid" | "canceled" | "incomplete_expired" | "paused" => {
            Some(SubscriptionStatus::Canceled)
        }
        _ => None,
    }
}

fn change_of(
    at: i64,
    status: SubscriptionStatus,
    object: &Value,
) -> Result<SubscriptionChange, WebhookError> {
    let subscription = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or(WebhookError::Malformed)?;
    let customer = object
        .get("customer")
        .and_then(|customer| customer.as_str().or_else(|| customer.get("id")?.as_str()))
        .ok_or(WebhookError::Malformed)?;
    let org = object
        .get("metadata")
        .and_then(|metadata| metadata.get("org"))
        .and_then(Value::as_str)
        .and_then(|org| Uuid::parse_str(org).ok())
        .map(TenantId::new);
    let items = object
        .get("items")
        .and_then(|items| items.get("data"))
        .and_then(Value::as_array);
    let item = items.and_then(|data| {
        data.iter()
            .find(|entry| {
                entry
                    .pointer("/price/recurring/usage_type")
                    .and_then(Value::as_str)
                    != Some("metered")
            })
            .or_else(|| data.first())
    });
    let price = item
        .and_then(|item| item.get("price"))
        .and_then(|price| price.get("id"))
        .and_then(Value::as_str)
        .map(PriceRef::new);
    let period_end = object
        .get("current_period_end")
        .or_else(|| item?.get("current_period_end"))
        .and_then(Value::as_i64);
    Ok(SubscriptionChange {
        at,
        org,
        customer: CustomerRef::new(customer),
        subscription: SubscriptionRef::new(subscription),
        price,
        status,
        period_end,
    })
}

#[cfg(test)]
mod tests {
    use ferristrace_domain::{
        BillingEventId, CustomerRef, PriceRef, SubscriptionChange, SubscriptionRef,
        SubscriptionStatus, TenantId, WebhookError, WebhookEvent,
    };
    use serde_json::{Value, json};
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

    fn event(kind: &str, object: Value) -> Vec<u8> {
        let mut envelope = json!({
            "id": "evt_1",
            "type": kind,
            "created": 1_700_000_100,
            "data": {}
        });
        envelope["data"]["object"] = object;
        envelope.to_string().into_bytes()
    }

    fn subscription(status: &str, org: Option<Uuid>) -> Value {
        let metadata = org.map_or_else(|| json!({}), |org| json!({"org": org.to_string()}));
        json!({
            "id": "sub_1",
            "object": "subscription",
            "customer": "cus_1",
            "status": status,
            "metadata": metadata,
            "items": {"data": [{
                "price": {"id": "price_pro"},
                "current_period_end": 1_702_592_000
            }]}
        })
    }

    fn signed(body: &[u8]) -> Result<WebhookEvent, WebhookError> {
        verify(SECRET, &header(SECRET, now(), body), body)
    }

    fn change(status: SubscriptionStatus, org: Option<Uuid>) -> WebhookEvent {
        WebhookEvent::Changed {
            event: BillingEventId::new("evt_1"),
            change: SubscriptionChange {
                at: 1_700_000_100,
                org: org.map(TenantId::new),
                customer: CustomerRef::new("cus_1"),
                subscription: SubscriptionRef::new("sub_1"),
                price: Some(PriceRef::new("price_pro")),
                status,
                period_end: Some(1_702_592_000),
            },
        }
    }

    #[test]
    fn a_created_subscription_carries_its_org_price_and_period() {
        let org = Uuid::from_u128(42);
        let body = event(
            "customer.subscription.created",
            subscription("active", Some(org)),
        );

        assert_eq!(
            signed(&body).expect("verifies"),
            change(SubscriptionStatus::Active, Some(org))
        );
    }

    #[test]
    fn the_period_end_is_read_from_the_subscription_on_older_api_versions() {
        let mut object = subscription("active", None);
        object["current_period_end"] = json!(1_702_000_000);
        let body = event("customer.subscription.updated", object);

        let WebhookEvent::Changed { change, .. } = signed(&body).expect("verifies") else {
            panic!("a subscription update is a change");
        };

        assert_eq!(change.period_end, Some(1_702_000_000));
    }

    #[test]
    fn an_expanded_customer_object_is_read_by_its_id() {
        let mut object = subscription("active", None);
        object["customer"] = json!({"id": "cus_1", "object": "customer"});
        let body = event("customer.subscription.updated", object);

        assert_eq!(
            signed(&body).expect("verifies"),
            change(SubscriptionStatus::Active, None)
        );
    }

    #[test]
    fn statuses_map_to_keep_or_end_the_paid_plan() {
        for (spelling, expected) in [
            ("trialing", SubscriptionStatus::Active),
            ("past_due", SubscriptionStatus::PastDue),
            ("unpaid", SubscriptionStatus::Canceled),
            ("canceled", SubscriptionStatus::Canceled),
            ("incomplete_expired", SubscriptionStatus::Canceled),
            ("paused", SubscriptionStatus::Canceled),
        ] {
            let body = event(
                "customer.subscription.updated",
                subscription(spelling, None),
            );
            assert_eq!(signed(&body).expect("verifies"), change(expected, None));
        }
    }

    #[test]
    fn an_incomplete_subscription_changes_nothing_yet() {
        let body = event(
            "customer.subscription.created",
            subscription("incomplete", None),
        );

        assert_eq!(
            signed(&body).expect("verifies"),
            WebhookEvent::Ignored {
                event: BillingEventId::new("evt_1"),
            }
        );
    }

    #[test]
    fn a_deleted_subscription_ends_the_paid_plan() {
        let body = event(
            "customer.subscription.deleted",
            subscription("active", None),
        );

        assert_eq!(
            signed(&body).expect("verifies"),
            change(SubscriptionStatus::Canceled, None)
        );
    }

    #[test]
    fn an_unrecognised_type_is_ignored() {
        let body = event("invoice.paid", json!({}));

        assert_eq!(
            signed(&body).expect("verifies"),
            WebhookEvent::Ignored {
                event: BillingEventId::new("evt_1"),
            }
        );
    }

    #[test]
    fn a_subscription_event_without_a_customer_is_malformed() {
        let mut object = subscription("active", None);
        object
            .as_object_mut()
            .expect("an object")
            .remove("customer");
        let body = event("customer.subscription.updated", object);

        assert!(matches!(signed(&body), Err(WebhookError::Malformed)));
    }

    #[test]
    fn a_tampered_body_is_rejected() {
        let body = event(
            "customer.subscription.created",
            subscription("active", None),
        );
        let signature = header(SECRET, now(), &body);
        let mut tampered = body.clone();
        tampered.push(b' ');

        assert!(matches!(
            verify(SECRET, &signature, &tampered),
            Err(WebhookError::BadSignature)
        ));
    }

    #[test]
    fn a_stale_timestamp_is_rejected() {
        let body = event(
            "customer.subscription.created",
            subscription("active", None),
        );
        let signature = header(SECRET, now() - 301, &body);

        assert!(matches!(
            verify(SECRET, &signature, &body),
            Err(WebhookError::BadSignature)
        ));
    }

    #[test]
    fn a_malformed_header_is_rejected() {
        let body = event(
            "customer.subscription.created",
            subscription("active", None),
        );

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
        let body = event(
            "customer.subscription.created",
            subscription("active", None),
        );
        let timestamp = now();
        let correct = sign(SECRET, timestamp, &body);
        let signature = format!("t={timestamp},v1=deadbeef,v1={correct}");

        assert!(verify(SECRET, &signature, &body).is_ok());
    }

    #[test]
    fn a_hybrid_subscription_picks_the_licensed_plan_price_over_the_metered_item() {
        let payload = json!({
            "id": "sub_hybrid",
            "object": "subscription",
            "customer": "cus_1",
            "status": "active",
            "metadata": {},
            "items": {"data": [
                {
                    "price": {
                        "id": "price_overage",
                        "recurring": {"usage_type": "metered"}
                    },
                    "current_period_end": 1_702_592_000
                },
                {
                    "price": {
                        "id": "price_pro",
                        "recurring": {"usage_type": "licensed"}
                    },
                    "current_period_end": 1_702_592_000
                }
            ]}
        });
        let body = event("customer.subscription.updated", payload);
        let timestamp = now();
        let signature = header(SECRET, timestamp, &body);

        let parsed = verify(SECRET, &signature, &body).expect("valid webhook");
        match parsed {
            WebhookEvent::Changed { change, .. } => {
                assert_eq!(change.price, Some(PriceRef::new("price_pro")));
            }
            WebhookEvent::Ignored { .. } => panic!("expected subscription change"),
        }
    }
}
