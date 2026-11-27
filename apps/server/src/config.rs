use std::net::SocketAddr;
use std::num::{NonZeroU16, NonZeroU32};

use ferristrace_clickhouse::SpanStoreSettings;
use ferristrace_domain::DecompressedBytes;
use ferristrace_domain::telemetry::{
    Allowance, BYTES_PER_GB, BadCurrency, Currency, POINTS_PER_MILLION, PriceList, Split,
};
use ferristrace_env_file::EnvFile;
use ferristrace_infra::PhotoStoreSettings;
use ferristrace_postgres::SELF_HOSTED_PLAN;
use figment::Figment;
use figment::providers::{Env, Format, Serialized, Toml};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const FILE: &str = "ferristrace.toml";
const PREFIX: &str = "FERRISTRACE_";
const DEFAULT_DATABASE_CONNECTIONS: NonZeroU32 = NonZeroU32::new(10).unwrap();

fn default_database_connections() -> NonZeroU32 {
    DEFAULT_DATABASE_CONNECTIONS
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub grpc_address: SocketAddr,
    pub http_address: SocketAddr,
    #[serde(default)]
    pub database_url: Option<String>,
    #[serde(default = "default_database_connections")]
    pub database_connections: NonZeroU32,
    #[serde(default)]
    pub redis_url: Option<String>,
    #[serde(default)]
    pub spans: Option<SpansConfig>,
    #[serde(default)]
    pub web_root: Option<String>,
    #[serde(default)]
    pub tenants: Vec<TenantKey>,
    #[serde(default)]
    pub oidc: Option<OidcConfig>,
    #[serde(default)]
    pub agents: AgentsConfig,
    #[serde(default)]
    pub mcp: McpConfig,
    #[serde(default)]
    pub mail: Option<MailConfig>,
    #[serde(default)]
    pub objects: Option<ObjectsConfig>,
    #[serde(default)]
    pub secrets: Option<SecretsConfig>,
    #[serde(default)]
    pub alerts: AlertsConfig,
    #[serde(default)]
    pub billing: Option<BillingConfig>,
    #[serde(default)]
    pub stripe: Option<StripeConfig>,
    #[serde(default)]
    pub plans: Vec<PlanConfig>,
    #[serde(default)]
    pub default_plan: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StripeConfig {
    pub secret_key: String,
    pub webhook_secret: String,
    pub meter_event_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanConfig {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub ingest_gb: Option<NonZeroU32>,
    #[serde(default)]
    pub retention_days: Option<NonZeroU32>,
    #[serde(default)]
    pub overage: bool,
    #[serde(default)]
    pub price: Option<String>,
    #[serde(default)]
    pub overage_price: Option<String>,
    #[serde(default)]
    pub overage_grace_gb: u32,
    #[serde(default)]
    pub overage_cap_gb: Option<NonZeroU32>,
    #[serde(default)]
    pub included_spans_gb: Option<u32>,
    #[serde(default)]
    pub included_logs_gb: Option<u32>,
    #[serde(default)]
    pub included_metrics_million: Option<u32>,
}

fn a_month() -> u64 {
    30
}

pub(crate) fn default_retention_days(spans: Option<&SpansConfig>) -> u64 {
    spans.map_or_else(a_month, |spans| spans.retention_days)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpansConfig {
    pub url: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "a_month")]
    pub retention_days: u64,
    #[serde(default)]
    pub cold_after_days: Option<NonZeroU16>,
}

impl From<SpansConfig> for SpanStoreSettings {
    fn from(spans: SpansConfig) -> Self {
        Self {
            url: spans.url,
            database: spans.database,
            user: spans.user,
            password: spans.password,
            retention_days: spans.retention_days,
            cold_after_days: spans.cold_after_days,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MailConfig {
    pub relay: String,
    pub username: String,
    pub password: String,
    pub from: String,
    pub base_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectsConfig {
    pub endpoint: String,
    pub bucket: String,
    #[serde(default)]
    pub region: Option<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl From<ObjectsConfig> for PhotoStoreSettings {
    fn from(objects: ObjectsConfig) -> Self {
        Self {
            endpoint: objects.endpoint,
            bucket: objects.bucket,
            region: objects.region,
            access_key_id: objects.access_key_id,
            secret_access_key: objects.secret_access_key,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CurrencyCode(Currency);

impl TryFrom<String> for CurrencyCode {
    type Error = BadCurrency;

    fn try_from(code: String) -> Result<Self, BadCurrency> {
        Currency::try_from(code.as_str()).map(Self)
    }
}

impl From<CurrencyCode> for String {
    fn from(code: CurrencyCode) -> Self {
        code.0.code().to_owned()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BillingConfig {
    pub currency: CurrencyCode,
    pub spans_gb_micros: u64,
    pub logs_gb_micros: u64,
    pub metrics_million_micros: u64,
    #[serde(default)]
    pub included_spans_gb: u64,
    #[serde(default)]
    pub included_logs_gb: u64,
    #[serde(default)]
    pub included_metrics_million: u64,
}

impl From<BillingConfig> for PriceList {
    fn from(billing: BillingConfig) -> Self {
        Self {
            currency: billing.currency.0,
            spans_gb_micros: billing.spans_gb_micros,
            logs_gb_micros: billing.logs_gb_micros,
            metrics_million_micros: billing.metrics_million_micros,
            included: Split {
                spans_bytes: billing.included_spans_gb.saturating_mul(BYTES_PER_GB),
                logs_bytes: billing.included_logs_gb.saturating_mul(BYTES_PER_GB),
                metrics_points: billing
                    .included_metrics_million
                    .saturating_mul(POINTS_PER_MILLION),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretsConfig {
    pub at_rest_key: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlertsConfig {
    #[serde(default)]
    pub allow_private_webhooks: bool,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentsConfig {
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub audience: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpConfig {
    #[serde(default)]
    pub gateway_client_id: Option<String>,
    #[serde(default)]
    pub public_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentSetup {
    NoIssuer,
    NoAudience { issuer: String },
    On { issuer: String, audience: String },
}

impl AgentSetup {
    pub fn off_reason(&self) -> Option<String> {
        match self {
            Self::NoIssuer => Some(
                "no agent issuer is configured: set FERRISTRACE_AGENTS__ISSUER".to_owned(),
            ),
            Self::NoAudience { .. } => Some(
                "FERRISTRACE_AGENTS__AUDIENCE is not set: agents need an audience so that tokens issued to people cannot be used as agent tokens"
                    .to_owned(),
            ),
            Self::On { .. } => None,
        }
    }
}

impl Config {
    pub fn agent_issuer(&self) -> Option<&str> {
        self.agents
            .issuer
            .as_deref()
            .filter(|issuer| !issuer.is_empty())
            .or_else(|| self.oidc.as_ref().map(|oidc| oidc.issuer.as_str()))
    }

    pub fn agent_setup(&self) -> AgentSetup {
        let Some(issuer) = self.agent_issuer() else {
            return AgentSetup::NoIssuer;
        };
        match self
            .agents
            .audience
            .as_deref()
            .filter(|audience| !audience.is_empty())
        {
            Some(audience) => AgentSetup::On {
                issuer: issuer.to_owned(),
                audience: audience.to_owned(),
            },
            None => AgentSetup::NoAudience {
                issuer: issuer.to_owned(),
            },
        }
    }

    pub fn reserved_client_id(&self) -> Option<&str> {
        self.oidc.as_ref().map(|oidc| oidc.client_id.as_str())
    }

    pub fn new_org_plan(&self) -> anyhow::Result<&str> {
        let slug = self.default_plan.as_deref().unwrap_or(SELF_HOSTED_PLAN);
        if slug == SELF_HOSTED_PLAN {
            anyhow::ensure!(
                self.stripe.is_none(),
                "[stripe] needs default_plan, the plan a new organisation starts on, set to one of the [[plans]] (usually `free`)"
            );
            return Ok(slug);
        }
        anyhow::ensure!(
            self.plans.iter().any(|plan| plan.slug == slug),
            "default_plan `{slug}` is not one of the [[plans]]"
        );
        Ok(slug)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantKey {
    pub id: Uuid,
    #[serde(default)]
    pub allowance: TenantAllowance,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "bytes", rename_all = "snake_case")]
pub enum TenantAllowance {
    #[default]
    Unlimited,
    Capped(u64),
    Overage(u64),
}

impl From<TenantAllowance> for Allowance {
    fn from(allowance: TenantAllowance) -> Self {
        match allowance {
            TenantAllowance::Unlimited => Self::Unlimited,
            TenantAllowance::Capped(bytes) => Self::Capped(DecompressedBytes::new(bytes)),
            TenantAllowance::Overage(bytes) => Self::Overage(DecompressedBytes::new(bytes)),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            grpc_address: SocketAddr::from(([0, 0, 0, 0], 4317)),
            http_address: SocketAddr::from(([0, 0, 0, 0], 4318)),
            database_url: None,
            database_connections: default_database_connections(),
            redis_url: None,
            spans: None,
            web_root: None,
            tenants: Vec::new(),
            oidc: None,
            agents: AgentsConfig::default(),
            mcp: McpConfig::default(),
            mail: None,
            objects: None,
            secrets: None,
            alerts: AlertsConfig::default(),
            billing: None,
            stripe: None,
            plans: Vec::new(),
            default_plan: None,
        }
    }
}

pub fn figment() -> Figment {
    Figment::from(Serialized::defaults(Config::default()))
        .merge(Toml::file(FILE))
        .merge(EnvFile::prefixed(PREFIX))
        .merge(Env::prefixed(PREFIX).split("__"))
}

pub fn load() -> anyhow::Result<Config> {
    figment().extract().map_err(Into::into)
}

#[cfg(test)]
#[allow(clippy::result_large_err)]
mod tests {
    use std::num::NonZeroU16;

    use ferristrace_domain::telemetry::{PriceList, Split};

    use super::{
        AgentSetup, Config, FILE, McpConfig, OidcConfig, PlanConfig, StripeConfig, TenantAllowance,
        figment,
    };

    #[test]
    fn the_default_ports_are_the_otlp_ones() {
        figment::Jail::expect_with(|_jail| {
            let config: Config = figment().extract()?;

            assert_eq!(config.grpc_address.port(), 4317);
            assert_eq!(config.http_address.port(), 4318);
            assert!(config.tenants.is_empty());
            Ok(())
        });
    }

    #[test]
    fn the_control_plane_pool_holds_ten_connections_unless_told_otherwise() {
        figment::Jail::expect_with(|jail| {
            let config: Config = figment().extract()?;
            assert_eq!(config.database_connections.get(), 10);

            jail.set_env("FERRISTRACE_DATABASE_CONNECTIONS", "4");
            let config: Config = figment().extract()?;
            assert_eq!(config.database_connections.get(), 4);

            jail.set_env("FERRISTRACE_DATABASE_CONNECTIONS", "0");
            assert!(figment().extract::<Config>().is_err());
            Ok(())
        });
    }

    #[test]
    fn a_file_declares_tenant_keys() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                http_address = "127.0.0.1:9318"

                [[tenants]]
                id = "00000000-0000-0000-0000-000000000001"
                "#,
            )?;

            let config: Config = figment().extract()?;

            assert_eq!(config.http_address.port(), 9318);
            assert_eq!(config.grpc_address.port(), 4317);
            assert_eq!(config.tenants.len(), 1);
            Ok(())
        });
    }

    #[test]
    fn a_tenant_without_an_allowance_is_unlimited() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [[tenants]]
                id = "00000000-0000-0000-0000-000000000001"
                "#,
            )?;

            let config: Config = figment().extract()?;

            assert_eq!(config.tenants[0].allowance, TenantAllowance::Unlimited);
            Ok(())
        });
    }

    #[test]
    fn an_allowance_declares_its_kind_and_its_bytes() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [[tenants]]
                id = "00000000-0000-0000-0000-000000000002"
                allowance = { kind = "capped", bytes = 1048576 }

                [[tenants]]
                id = "00000000-0000-0000-0000-000000000003"
                allowance = { kind = "overage", bytes = 10485760 }
                "#,
            )?;

            let config: Config = figment().extract()?;

            assert_eq!(
                config.tenants[0].allowance,
                TenantAllowance::Capped(1_048_576)
            );
            assert_eq!(
                config.tenants[1].allowance,
                TenantAllowance::Overage(10_485_760)
            );
            Ok(())
        });
    }

    #[test]
    fn a_span_store_needs_only_its_url_and_keeps_a_month() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [spans]
                url = "http://clickhouse:8123"
                "#,
            )?;

            let config: Config = figment().extract()?;
            let spans = config.spans.expect("a span store");

            assert_eq!(spans.url, "http://clickhouse:8123");
            assert_eq!(spans.retention_days, 30);
            assert_eq!(spans.database, None);
            assert_eq!(spans.cold_after_days, None);
            Ok(())
        });
    }

    #[test]
    fn a_retention_in_the_file_wins_over_the_default() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [spans]
                url = "http://clickhouse:8123"
                database = "ferristrace"
                retention_days = 7
                "#,
            )?;

            let config: Config = figment().extract()?;
            let spans = config.spans.expect("a span store");

            assert_eq!(spans.retention_days, 7);
            assert_eq!(spans.database.as_deref(), Some("ferristrace"));
            Ok(())
        });
    }

    #[test]
    fn a_span_store_moves_parts_to_the_cold_volume_after_the_days_given() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [spans]
                url = "http://clickhouse:8123"
                cold_after_days = 7
                "#,
            )?;

            let config: Config = figment().extract()?;
            let spans = config.spans.expect("a span store");

            assert_eq!(spans.cold_after_days.map(NonZeroU16::get), Some(7));
            Ok(())
        });
    }

    #[test]
    fn zero_days_before_the_cold_volume_is_refused() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [spans]
                url = "http://clickhouse:8123"
                cold_after_days = 0
                "#,
            )?;

            assert!(figment().extract::<Config>().is_err());
            Ok(())
        });
    }

    #[test]
    fn a_photo_store_needs_its_endpoint_bucket_and_credentials() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [objects]
                endpoint = "https://abc123.r2.cloudflarestorage.com"
                bucket = "ferristrace-avatars"
                access_key_id = "AKIAEXAMPLE"
                secret_access_key = "a secret"
                "#,
            )?;

            let config: Config = figment().extract()?;
            let objects = config.objects.expect("an object store");

            assert_eq!(objects.bucket, "ferristrace-avatars");
            assert_eq!(
                objects.region, None,
                "r2 has one region and the store names it"
            );
            Ok(())
        });
    }

    #[test]
    fn a_deployment_keeps_no_photos_unless_a_store_is_declared() {
        figment::Jail::expect_with(|_jail| {
            let config: Config = figment().extract()?;

            assert!(config.objects.is_none());
            Ok(())
        });
    }

    #[test]
    fn a_deployment_keeps_no_sealed_secret_unless_a_key_at_rest_is_declared() {
        figment::Jail::expect_with(|_jail| {
            let config: Config = figment().extract()?;

            assert!(config.secrets.is_none());
            Ok(())
        });
    }

    #[test]
    fn a_key_at_rest_is_read_from_the_file() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [secrets]
                at_rest_key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
                "#,
            )?;

            let config: Config = figment().extract()?;
            let secrets = config.secrets.expect("a key");

            assert_eq!(secrets.at_rest_key.len(), 64);
            Ok(())
        });
    }

    #[test]
    fn webhooks_stay_off_private_addresses_unless_the_deployment_says_otherwise() {
        figment::Jail::expect_with(|jail| {
            let quiet: Config = figment().extract()?;
            jail.set_env("FERRISTRACE_ALERTS__ALLOW_PRIVATE_WEBHOOKS", "true");
            jail.set_env("FERRISTRACE_ALERTS__BASE_URL", "https://app.example.com");
            let open: Config = figment().extract()?;

            assert!(!quiet.alerts.allow_private_webhooks);
            assert_eq!(quiet.alerts.base_url, None);
            assert!(open.alerts.allow_private_webhooks);
            assert_eq!(
                open.alerts.base_url.as_deref(),
                Some("https://app.example.com")
            );
            Ok(())
        });
    }

    #[test]
    fn the_alert_settings_are_read_from_the_file() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                "
                [alerts]
                allow_private_webhooks = true
                ",
            )?;

            let config: Config = figment().extract()?;

            assert!(config.alerts.allow_private_webhooks);
            Ok(())
        });
    }

    #[test]
    fn a_mail_relay_is_declared_whole_or_not_at_all() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [mail]
                relay = "mail.example.com"
                username = "postmaster"
                password = "secret"
                from = "FerrisTrace <no-reply@example.com>"
                base_url = "https://app.example.com"
                "#,
            )?;

            let config: Config = figment().extract()?;
            let mail = config.mail.expect("a relay");

            assert_eq!(mail.relay, "mail.example.com");
            assert_eq!(mail.base_url, "https://app.example.com");
            Ok(())
        });
    }

    #[test]
    fn mcp_is_unconfigured_until_the_environment_names_the_gateway_and_its_url() {
        figment::Jail::expect_with(|jail| {
            assert_eq!(figment().extract::<Config>()?.mcp, McpConfig::default());

            jail.set_env("FERRISTRACE_MCP__GATEWAY_CLIENT_ID", "mcp-gateway");
            jail.set_env("FERRISTRACE_MCP__PUBLIC_URL", "https://mcp.example.com");
            let config: Config = figment().extract()?;

            assert_eq!(config.mcp.gateway_client_id.as_deref(), Some("mcp-gateway"));
            assert_eq!(
                config.mcp.public_url.as_deref(),
                Some("https://mcp.example.com")
            );
            Ok(())
        });
    }

    #[test]
    fn without_an_oidc_or_agents_issuer_agents_are_off() {
        figment::Jail::expect_with(|_jail| {
            let config: Config = figment().extract()?;

            assert_eq!(config.agent_issuer(), None);
            assert_eq!(config.agents.audience, None);
            Ok(())
        });
    }

    #[test]
    fn the_agent_issuer_defaults_to_the_oidc_issuer() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [oidc]
                issuer = "https://id.example.com/realms/ferris"
                client_id = "ferristrace"
                "#,
            )?;

            let config: Config = figment().extract()?;

            assert_eq!(
                config.agent_issuer(),
                Some("https://id.example.com/realms/ferris")
            );
            Ok(())
        });
    }

    #[test]
    fn the_environment_names_the_agent_issuer_and_audience() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [oidc]
                issuer = "https://id.example.com/realms/ferris"
                client_id = "ferristrace"
                "#,
            )?;
            jail.set_env(
                "FERRISTRACE_AGENTS__ISSUER",
                "https://agents.example.com/realms/bots",
            );
            jail.set_env("FERRISTRACE_AGENTS__AUDIENCE", "ferristrace");

            let config: Config = figment().extract()?;

            assert_eq!(
                config.agent_issuer(),
                Some("https://agents.example.com/realms/bots")
            );
            assert_eq!(config.agents.audience.as_deref(), Some("ferristrace"));
            Ok(())
        });
    }

    #[test]
    fn a_blank_agent_issuer_falls_back_to_oidc_or_nothing() {
        figment::Jail::expect_with(|jail| {
            jail.set_env("FERRISTRACE_AGENTS__ISSUER", "");

            let config: Config = figment().extract()?;

            assert_eq!(config.agent_issuer(), None);
            Ok(())
        });
    }

    #[test]
    fn an_issuer_without_an_audience_leaves_agents_off() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [oidc]
                issuer = "https://id.example.com/realms/ferris"
                client_id = "ferristrace"
                "#,
            )?;

            let config: Config = figment().extract()?;

            assert_eq!(
                config.agent_setup(),
                AgentSetup::NoAudience {
                    issuer: "https://id.example.com/realms/ferris".to_owned()
                }
            );
            assert!(config.agent_setup().off_reason().is_some());
            assert_eq!(config.reserved_client_id(), Some("ferristrace"));
            Ok(())
        });
    }

    #[test]
    fn an_issuer_with_an_audience_turns_agents_on_and_a_blank_audience_does_not() {
        figment::Jail::expect_with(|jail| {
            jail.set_env(
                "FERRISTRACE_AGENTS__ISSUER",
                "https://id.example.com/realms/bots",
            );
            jail.set_env("FERRISTRACE_AGENTS__AUDIENCE", "ferristrace");
            let on: Config = figment().extract()?;
            jail.set_env("FERRISTRACE_AGENTS__AUDIENCE", "");
            let blank: Config = figment().extract()?;

            assert_eq!(
                on.agent_setup(),
                AgentSetup::On {
                    issuer: "https://id.example.com/realms/bots".to_owned(),
                    audience: "ferristrace".to_owned()
                }
            );
            assert!(matches!(blank.agent_setup(), AgentSetup::NoAudience { .. }));
            Ok(())
        });
    }

    #[test]
    fn without_an_issuer_the_setup_says_so() {
        figment::Jail::expect_with(|_jail| {
            let config: Config = figment().extract()?;

            assert_eq!(config.agent_setup(), AgentSetup::NoIssuer);
            Ok(())
        });
    }

    #[test]
    fn the_keys_of_the_confidential_client_are_ignored_so_an_old_deployment_still_boots() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                cookie_secure = false
                after_sign_in = "/home"

                [oidc]
                issuer = "https://id.example.com/realms/ferris"
                client_id = "ferristrace-web"
                client_secret = "secret"
                redirect_uri = "https://app.example.com/callback"
                "#,
            )?;
            jail.set_env("FERRISTRACE_OIDC__CLIENT_SECRET", "other");
            jail.set_env(
                "FERRISTRACE_OIDC__REDIRECT_URI",
                "https://elsewhere.example.com",
            );
            jail.set_env("FERRISTRACE_COOKIE_SECURE", "false");

            let config: Config = figment().extract()?;

            assert_eq!(
                config.oidc,
                Some(OidcConfig {
                    issuer: "https://id.example.com/realms/ferris".to_owned(),
                    client_id: "ferristrace-web".to_owned(),
                })
            );
            Ok(())
        });
    }

    #[test]
    fn a_server_without_a_billing_section_has_no_prices() {
        figment::Jail::expect_with(|_jail| {
            let config: Config = figment().extract()?;

            assert_eq!(config.billing, None);
            Ok(())
        });
    }

    #[test]
    fn a_billing_section_prices_each_signal_and_includes_nothing_by_default() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [billing]
                currency = "eur"
                spans_gb_micros = 250000
                logs_gb_micros = 500000
                metrics_million_micros = 100000
                "#,
            )?;

            let config: Config = figment().extract()?;
            let prices = PriceList::from(config.billing.expect("prices"));

            assert_eq!(prices.currency.code(), "EUR");
            assert_eq!(prices.spans_gb_micros, 250_000);
            assert_eq!(prices.logs_gb_micros, 500_000);
            assert_eq!(prices.metrics_million_micros, 100_000);
            assert_eq!(prices.included, Split::default());
            Ok(())
        });
    }

    #[test]
    fn the_environment_sets_prices_and_allowances_in_decimal_units() {
        figment::Jail::expect_with(|jail| {
            jail.set_env("FERRISTRACE_BILLING__CURRENCY", "USD");
            jail.set_env("FERRISTRACE_BILLING__SPANS_GB_MICROS", "300000");
            jail.set_env("FERRISTRACE_BILLING__LOGS_GB_MICROS", "400000");
            jail.set_env("FERRISTRACE_BILLING__METRICS_MILLION_MICROS", "50000");
            jail.set_env("FERRISTRACE_BILLING__INCLUDED_SPANS_GB", "10");
            jail.set_env("FERRISTRACE_BILLING__INCLUDED_LOGS_GB", "5");
            jail.set_env("FERRISTRACE_BILLING__INCLUDED_METRICS_MILLION", "2");

            let config: Config = figment().extract()?;
            let prices = PriceList::from(config.billing.expect("prices"));

            assert_eq!(prices.currency.code(), "USD");
            assert_eq!(
                prices.included,
                Split {
                    spans_bytes: 10_000_000_000,
                    logs_bytes: 5_000_000_000,
                    metrics_points: 2_000_000,
                }
            );
            Ok(())
        });
    }

    #[test]
    fn a_currency_that_is_not_three_letters_stops_the_start() {
        figment::Jail::expect_with(|jail| {
            for refused in ["EURO", "E1", "€"] {
                jail.set_env("FERRISTRACE_BILLING__CURRENCY", refused);
                jail.set_env("FERRISTRACE_BILLING__SPANS_GB_MICROS", "1");
                jail.set_env("FERRISTRACE_BILLING__LOGS_GB_MICROS", "1");
                jail.set_env("FERRISTRACE_BILLING__METRICS_MILLION_MICROS", "1");

                assert!(figment().extract::<Config>().is_err(), "{refused}");
            }
            Ok(())
        });
    }

    #[test]
    fn plans_are_declared_in_the_file() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(
                FILE,
                r#"
                [[plans]]
                slug = "free"
                name = "Free"
                ingest_gb = 30
                retention_days = 7

                [[plans]]
                slug = "pro"
                name = "Pro"
                ingest_gb = 100
                retention_days = 30
                overage = true
                price = "price_test"
                included_spans_gb = 100
                included_metrics_million = 0
                "#,
            )?;

            let config: Config = figment().extract()?;

            assert_eq!(config.plans.len(), 2);
            assert!(!config.plans[0].overage);
            assert_eq!(config.plans[0].price, None);
            assert_eq!(config.plans[0].included_spans_gb, None);
            assert!(config.plans[1].overage);
            assert_eq!(config.plans[1].price.as_deref(), Some("price_test"));
            assert_eq!(config.plans[1].included_spans_gb, Some(100));
            assert_eq!(config.plans[1].included_logs_gb, None);
            assert_eq!(config.plans[1].included_metrics_million, Some(0));
            Ok(())
        });
    }

    #[test]
    fn plans_and_stripe_secrets_come_from_the_environment() {
        figment::Jail::expect_with(|jail| {
            jail.set_env(
                "FERRISTRACE_PLANS",
                r#"[{slug="free",name="Free",ingest_gb=30,retention_days=7},{slug="pro",name="Pro",ingest_gb=100,overage=true,price="price_test"}]"#,
            );
            jail.set_env("FERRISTRACE_STRIPE__SECRET_KEY", "sk_test");
            jail.set_env("FERRISTRACE_STRIPE__WEBHOOK_SECRET", "whsec_test");
            jail.set_env("FERRISTRACE_STRIPE__METER_EVENT_NAME", "ingested_bytes");

            let config: Config = figment().extract()?;

            assert_eq!(config.plans.len(), 2);
            assert_eq!(config.plans[1].price.as_deref(), Some("price_test"));
            assert_eq!(
                config.stripe.map(|stripe| stripe.secret_key).as_deref(),
                Some("sk_test")
            );
            Ok(())
        });
    }

    fn plan(slug: &str) -> PlanConfig {
        PlanConfig {
            slug: slug.to_owned(),
            name: slug.to_owned(),
            ingest_gb: None,
            retention_days: None,
            overage: false,
            price: None,
            overage_price: None,
            overage_grace_gb: 0,
            overage_cap_gb: None,
            included_spans_gb: None,
            included_logs_gb: None,
            included_metrics_million: None,
        }
    }

    fn stripe() -> StripeConfig {
        StripeConfig {
            secret_key: "sk_test".to_owned(),
            webhook_secret: "whsec_test".to_owned(),
            meter_event_name: "ingested_bytes".to_owned(),
        }
    }

    #[test]
    fn a_new_organisation_starts_self_hosted_when_nothing_is_configured() {
        let config = Config::default();

        assert_eq!(config.new_org_plan().expect("a plan"), "self-hosted");
    }

    #[test]
    fn a_new_organisation_starts_on_the_configured_default_plan() {
        let config = Config {
            plans: vec![plan("free"), plan("pro")],
            default_plan: Some("free".to_owned()),
            stripe: Some(stripe()),
            ..Config::default()
        };

        assert_eq!(config.new_org_plan().expect("a plan"), "free");
    }

    #[test]
    fn a_default_plan_outside_the_declared_plans_is_refused() {
        let config = Config {
            plans: vec![plan("free")],
            default_plan: Some("starter".to_owned()),
            ..Config::default()
        };

        assert!(config.new_org_plan().is_err());
    }

    #[test]
    fn stripe_without_a_default_plan_is_refused() {
        for default_plan in [None, Some("self-hosted".to_owned())] {
            let config = Config {
                plans: vec![plan("free"), plan("pro")],
                default_plan,
                stripe: Some(stripe()),
                ..Config::default()
            };

            assert!(config.new_org_plan().is_err());
        }
    }

    #[test]
    fn the_default_plan_comes_from_the_file_or_the_environment() {
        figment::Jail::expect_with(|jail| {
            jail.create_file(FILE, r#"default_plan = "free""#)?;
            let config: Config = figment().extract()?;
            assert_eq!(config.default_plan.as_deref(), Some("free"));

            jail.set_env("FERRISTRACE_DEFAULT_PLAN", "pro");
            let config: Config = figment().extract()?;
            assert_eq!(config.default_plan.as_deref(), Some("pro"));
            Ok(())
        });
    }
}
