use core::fmt;

use ferristrace_domain::{
    BillingGateway, BillingHour, CheckoutUrl, DecompressedBytes, GatewayError, PortalUrl,
    StripeCustomerId, TenantId, WebhookError, WebhookEvent,
};
use serde::Deserialize;

use crate::secret::{StripeSecretKey, WebhookSigningSecret};
use crate::webhook;

const STRIPE_API_BASE: &str = "https://api.stripe.com";
const NANOS_PER_SECOND: i64 = 1_000_000_000;

pub struct StripeGatewaySettings {
    pub secret_key: String,
    pub webhook_secret: String,
    pub meter_event_name: String,
    pub pro_price_id: String,
}

impl fmt::Debug for StripeGatewaySettings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StripeGatewaySettings")
            .field("secret_key", &"redacted")
            .field("webhook_secret", &"redacted")
            .field("meter_event_name", &self.meter_event_name)
            .field("pro_price_id", &self.pro_price_id)
            .finish()
    }
}

pub struct StripeGateway {
    client: reqwest::Client,
    base_url: Box<str>,
    secret_key: StripeSecretKey,
    webhook_secret: WebhookSigningSecret,
    meter_event_name: Box<str>,
    pro_price_id: Box<str>,
}

impl fmt::Debug for StripeGateway {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StripeGateway(..)")
    }
}

#[derive(Deserialize)]
struct CheckoutSessionResponse {
    url: String,
    customer: String,
}

#[derive(Deserialize)]
struct PortalSessionResponse {
    url: String,
}

impl StripeGateway {
    pub fn new(settings: StripeGatewaySettings) -> Self {
        Self::at(settings, STRIPE_API_BASE)
    }

    fn at(settings: StripeGatewaySettings, base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.into(),
            secret_key: StripeSecretKey::new(settings.secret_key),
            webhook_secret: WebhookSigningSecret::new(settings.webhook_secret),
            meter_event_name: settings.meter_event_name.into(),
            pro_price_id: settings.pro_price_id.into(),
        }
    }

    async fn post(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<reqwest::Response, GatewayError> {
        let url = format!("{}{path}", self.base_url);
        let response = self
            .client
            .post(url)
            .bearer_auth(self.secret_key.exposed())
            .form(form)
            .send()
            .await
            .map_err(|error| {
                tracing::error!(%error, "the stripe api could not be reached");
                GatewayError::Unreachable
            })?;
        if response.status().is_success() {
            Ok(response)
        } else {
            tracing::error!(status = %response.status(), "the stripe api answered with an error");
            Err(GatewayError::Unreachable)
        }
    }

    async fn post_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<T, GatewayError> {
        self.post(path, form)
            .await?
            .json::<T>()
            .await
            .map_err(|error| {
                tracing::error!(%error, "the stripe api response did not parse as json");
                GatewayError::Unreachable
            })
    }
}

impl BillingGateway for StripeGateway {
    async fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&StripeCustomerId>,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<(CheckoutUrl, StripeCustomerId), GatewayError> {
        let org = org.as_uuid().to_string();
        let mut form: Vec<(&str, &str)> = vec![
            ("mode", "subscription"),
            ("line_items[0][price]", &self.pro_price_id),
            ("client_reference_id", &org),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
        ];
        if let Some(customer) = customer {
            form.push(("customer", customer.as_str()));
        }
        let response: CheckoutSessionResponse =
            self.post_json("/v1/checkout/sessions", &form).await?;
        Ok((
            CheckoutUrl::new(response.url),
            StripeCustomerId::new(response.customer),
        ))
    }

    async fn portal_url(
        &self,
        customer: &StripeCustomerId,
        return_url: &str,
    ) -> Result<PortalUrl, GatewayError> {
        let form = [("customer", customer.as_str()), ("return_url", return_url)];
        let response: PortalSessionResponse =
            self.post_json("/v1/billing_portal/sessions", &form).await?;
        Ok(PortalUrl::new(response.url))
    }

    async fn report_usage(
        &self,
        customer: &StripeCustomerId,
        hour: BillingHour,
        over_by: DecompressedBytes,
    ) -> Result<(), GatewayError> {
        let value = over_by.get().to_string();
        let timestamp = (hour.start_nanos() / NANOS_PER_SECOND).to_string();
        let identifier = hour.key();
        let form = [
            ("event_name", &*self.meter_event_name),
            ("payload[stripe_customer_id]", customer.as_str()),
            ("payload[value]", value.as_str()),
            ("identifier", identifier.as_str()),
            ("timestamp", timestamp.as_str()),
        ];
        self.post("/v1/billing/meter_events", &form).await?;
        Ok(())
    }

    fn verify(&self, signature: &str, body: &[u8]) -> Result<WebhookEvent, WebhookError> {
        webhook::verify(self.webhook_secret.exposed(), signature, body)
    }
}

#[cfg(test)]
mod tests {
    use ferristrace_domain::{
        BillingGateway, BillingHour, DecompressedBytes, GatewayError, StripeCustomerId, TenantId,
        UnixSeconds,
    };
    use uuid::Uuid;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::{StripeGateway, StripeGatewaySettings};

    fn settings() -> StripeGatewaySettings {
        StripeGatewaySettings {
            secret_key: "sk_test".into(),
            webhook_secret: "whsec_test".into(),
            meter_event_name: "decompressed_bytes".into(),
            pro_price_id: "price_pro".into(),
        }
    }

    #[tokio::test]
    async fn checkout_url_parses_the_session_url_and_customer() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/checkout/sessions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "url": "https://checkout.stripe.com/pay/cs_test",
                "customer": "cus_new",
            })))
            .mount(&server)
            .await;
        let gateway = StripeGateway::at(settings(), &server.uri());

        let (url, customer) = gateway
            .checkout_url(
                TenantId::new(Uuid::from_u128(1)),
                None,
                "https://app.test/success",
                "https://app.test/cancel",
            )
            .await
            .expect("checkout session created");

        assert_eq!(url.as_str(), "https://checkout.stripe.com/pay/cs_test");
        assert_eq!(customer, StripeCustomerId::new("cus_new"));
    }

    #[tokio::test]
    async fn portal_url_parses_the_session_url() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/billing_portal/sessions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "url": "https://billing.stripe.com/session/bps_test",
            })))
            .mount(&server)
            .await;
        let gateway = StripeGateway::at(settings(), &server.uri());

        let url = gateway
            .portal_url(&StripeCustomerId::new("cus_1"), "https://app.test/account")
            .await
            .expect("portal session created");

        assert_eq!(url.as_str(), "https://billing.stripe.com/session/bps_test");
    }

    #[tokio::test]
    async fn report_usage_posts_a_meter_event() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/billing/meter_events"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": "me_1"})),
            )
            .mount(&server)
            .await;
        let gateway = StripeGateway::at(settings(), &server.uri());

        gateway
            .report_usage(
                &StripeCustomerId::new("cus_1"),
                BillingHour::containing(UnixSeconds::new(1_700_000_000)),
                DecompressedBytes::new(1024),
            )
            .await
            .expect("usage reported");
    }

    #[tokio::test]
    async fn an_unreachable_server_is_reported_as_unreachable() {
        let gateway = StripeGateway::at(settings(), "http://127.0.0.1:1");

        let result = gateway
            .portal_url(&StripeCustomerId::new("cus_1"), "https://app.test/account")
            .await;

        assert!(matches!(result, Err(GatewayError::Unreachable)));
    }
}
