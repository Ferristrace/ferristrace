use core::fmt;

use ferristrace_domain::{
    BillingGateway, BillingHour, CheckoutUrl, CustomerRef, DecompressedBytes, GatewayError,
    PortalUrl, PriceRef, TenantId, WebhookError, WebhookEvent,
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
}

impl fmt::Debug for StripeGatewaySettings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StripeGatewaySettings")
            .field("secret_key", &"redacted")
            .field("webhook_secret", &"redacted")
            .field("meter_event_name", &self.meter_event_name)
            .finish()
    }
}

pub struct StripeGateway {
    client: reqwest::Client,
    base_url: Box<str>,
    secret_key: StripeSecretKey,
    webhook_secret: WebhookSigningSecret,
    meter_event_name: Box<str>,
}

impl fmt::Debug for StripeGateway {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StripeGateway(..)")
    }
}

#[derive(Deserialize)]
struct CustomerResponse {
    id: String,
}

#[derive(Deserialize)]
struct CheckoutSessionResponse {
    url: String,
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

impl StripeGateway {
    async fn create_customer(&self, org: &str) -> Result<CustomerRef, GatewayError> {
        let form = [("metadata[org]", org)];
        let response: CustomerResponse = self.post_json("/v1/customers", &form).await?;
        Ok(CustomerRef::new(response.id))
    }
}

impl BillingGateway for StripeGateway {
    async fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&CustomerRef>,
        price: &PriceRef,
        overage_price: Option<&PriceRef>,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<(CheckoutUrl, CustomerRef), GatewayError> {
        let org = org.as_uuid().to_string();
        let customer = match customer {
            Some(customer) => customer.clone(),
            None => self.create_customer(&org).await?,
        };
        let mut form = vec![
            ("mode", "subscription"),
            ("customer", customer.as_str()),
            ("line_items[0][price]", price.as_str()),
            ("line_items[0][quantity]", "1"),
            ("client_reference_id", org.as_str()),
            ("subscription_data[metadata][org]", org.as_str()),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
        ];
        if let Some(overage) = overage_price {
            form.push(("line_items[1][price]", overage.as_str()));
        }
        let response: CheckoutSessionResponse =
            self.post_json("/v1/checkout/sessions", &form).await?;
        Ok((CheckoutUrl::new(response.url), customer))
    }

    async fn portal_url(
        &self,
        customer: &CustomerRef,
        return_url: &str,
    ) -> Result<PortalUrl, GatewayError> {
        let form = [("customer", customer.as_str()), ("return_url", return_url)];
        let response: PortalSessionResponse =
            self.post_json("/v1/billing_portal/sessions", &form).await?;
        Ok(PortalUrl::new(response.url))
    }

    async fn report_usage(
        &self,
        customer: &CustomerRef,
        hour: BillingHour,
        over_by: DecompressedBytes,
    ) -> Result<(), GatewayError> {
        let value = over_by.get().to_string();
        let timestamp = (hour.start_nanos() / NANOS_PER_SECOND).to_string();
        let identifier = format!("{}:{}", customer.as_str(), hour.key());
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
        BillingGateway, BillingHour, CustomerRef, DecompressedBytes, GatewayError, PriceRef,
        TenantId, UnixSeconds,
    };
    use uuid::Uuid;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::{StripeGateway, StripeGatewaySettings};

    fn settings() -> StripeGatewaySettings {
        StripeGatewaySettings {
            secret_key: "sk_test".into(),
            webhook_secret: "whsec_test".into(),
            meter_event_name: "decompressed_bytes".into(),
        }
    }

    #[tokio::test]
    async fn a_first_checkout_creates_the_customer_and_buys_the_given_price() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/customers"))
            .and(body_string_contains("metadata%5Borg%5D="))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": "cus_new"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/checkout/sessions"))
            .and(body_string_contains("customer=cus_new"))
            .and(body_string_contains(
                "line_items%5B0%5D%5Bprice%5D=price_pro",
            ))
            .and(body_string_contains(
                "subscription_data%5Bmetadata%5D%5Borg%5D=",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "url": "https://checkout.stripe.com/pay/cs_test",
                "customer": null,
            })))
            .expect(1)
            .mount(&server)
            .await;
        let gateway = StripeGateway::at(settings(), &server.uri());

        let (url, customer) = gateway
            .checkout_url(
                TenantId::new(Uuid::from_u128(1)),
                None,
                &PriceRef::new("price_pro"),
                None,
                "https://app.test/success",
                "https://app.test/cancel",
            )
            .await
            .expect("checkout session created");

        assert_eq!(url.as_str(), "https://checkout.stripe.com/pay/cs_test");
        assert_eq!(customer, CustomerRef::new("cus_new"));
    }

    #[tokio::test]
    async fn a_known_customer_is_reused_without_creating_another() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/customers"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/checkout/sessions"))
            .and(body_string_contains("customer=cus_known"))
            .and(body_string_contains(
                "line_items%5B1%5D%5Bprice%5D=price_overage",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "url": "https://checkout.stripe.com/pay/cs_again",
            })))
            .expect(1)
            .mount(&server)
            .await;
        let gateway = StripeGateway::at(settings(), &server.uri());

        let (_, customer) = gateway
            .checkout_url(
                TenantId::new(Uuid::from_u128(1)),
                Some(&CustomerRef::new("cus_known")),
                &PriceRef::new("price_pro"),
                Some(&PriceRef::new("price_overage")),
                "https://app.test/success",
                "https://app.test/cancel",
            )
            .await
            .expect("checkout session created");

        assert_eq!(customer, CustomerRef::new("cus_known"));
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
            .portal_url(&CustomerRef::new("cus_1"), "https://app.test/account")
            .await
            .expect("portal session created");

        assert_eq!(url.as_str(), "https://billing.stripe.com/session/bps_test");
    }

    #[tokio::test]
    async fn report_usage_posts_a_meter_event() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/billing/meter_events"))
            .and(body_string_contains("identifier=cus_1%3A2023111422"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": "me_1"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let gateway = StripeGateway::at(settings(), &server.uri());

        gateway
            .report_usage(
                &CustomerRef::new("cus_1"),
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
            .portal_url(&CustomerRef::new("cus_1"), "https://app.test/account")
            .await;

        assert!(matches!(result, Err(GatewayError::Unreachable)));
    }
}
