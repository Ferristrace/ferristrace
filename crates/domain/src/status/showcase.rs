use core::future::Future;

use super::derivation::{
    alert_days_from_state, derive, derive_days, overall, public_updates, redacted,
    service_days_from_points, shown,
};
use super::entities::{
    Link, Observed, PublicComponent, PublicIncident, PublicPostmortem, PublicView, ServiceHistory,
    ServiceLoad, StatusPage,
};
use super::errors::StatusError;
use super::ports::StatusPages;
use super::value_objects::{SERVICE_WINDOW_SECS, Slug, StatusPageId, UPTIME_DAYS};
use crate::access::{ApiKeys, Reader, Readers};
use crate::alerts::{AlertEvent, AlertEvents, AlertRules, AlertStates, AlertStatus, RuleId};
use crate::catalogue::ProjectId;
use crate::clock::UnixSeconds;
use crate::explore::{ServiceFilter, SpanReader, Window};
use crate::identity::SessionStore;
use crate::incidents::{IncidentFilter, IncidentId, IncidentScope, IncidentTimeline, Incidents};
use crate::organisation::Memberships;
use crate::postmortems::{PostmortemStatus, Postmortems};
use crate::store::StoreError;
use crate::telemetry::TenantId;

const DAY_SECS: u64 = 86_400;
const DAY_MS: u64 = 86_400_000;
const MILLIS_PER_SECOND: u64 = 1_000;
const NANOS_PER_SECOND: u64 = 1_000_000_000;
const ALERT_HISTORY_LIMIT: u32 = 500;

pub trait AlertHistory {
    fn events_for(
        &self,
        org: TenantId,
        rule: RuleId,
        from_ms: u64,
        to_ms: u64,
    ) -> impl Future<Output = Result<Vec<AlertEvent>, StoreError>> + Send;
}

impl AlertHistory for () {
    async fn events_for(
        &self,
        _org: TenantId,
        _rule: RuleId,
        _from_ms: u64,
        _to_ms: u64,
    ) -> Result<Vec<AlertEvent>, StoreError> {
        Ok(Vec::new())
    }
}

impl<E: AlertEvents + Sync> AlertHistory for E {
    async fn events_for(
        &self,
        org: TenantId,
        rule: RuleId,
        from_ms: u64,
        to_ms: u64,
    ) -> Result<Vec<AlertEvent>, StoreError> {
        self.history(org, rule, from_ms, to_ms, ALERT_HISTORY_LIMIT)
            .await
    }
}

#[derive(Debug)]
pub struct Showcase<'a, Pg, I, L, Pm, R, T, Sp, Ev = ()> {
    pages: Pg,
    incidents: I,
    timeline: L,
    postmortems: Pm,
    rules: R,
    states: T,
    spans: Option<&'a Sp>,
    events: Ev,
}

impl<'a, Pg, I, L, Pm, R, T, Sp> Showcase<'a, Pg, I, L, Pm, R, T, Sp, ()>
where
    Pg: StatusPages + Sync,
    I: Incidents,
    L: IncidentTimeline,
    Pm: Postmortems,
    R: AlertRules,
    T: AlertStates,
    Sp: SpanReader + Sync,
{
    pub fn new(
        pages: Pg,
        incidents: I,
        timeline: L,
        postmortems: Pm,
        rules: R,
        states: T,
        spans: Option<&'a Sp>,
    ) -> Self {
        Self {
            pages,
            incidents,
            timeline,
            postmortems,
            rules,
            states,
            spans,
            events: (),
        }
    }
}

impl<'a, Pg, I, L, Pm, R, T, Sp, Ev> Showcase<'a, Pg, I, L, Pm, R, T, Sp, Ev>
where
    Pg: StatusPages + Sync,
    I: Incidents,
    L: IncidentTimeline,
    Pm: Postmortems,
    R: AlertRules,
    T: AlertStates,
    Sp: SpanReader + Sync,
    Ev: AlertHistory + Sync,
{
    pub fn with_events<NextEv: AlertHistory + Sync>(
        self,
        events: NextEv,
    ) -> Showcase<'a, Pg, I, L, Pm, R, T, Sp, NextEv> {
        Showcase {
            pages: self.pages,
            incidents: self.incidents,
            timeline: self.timeline,
            postmortems: self.postmortems,
            rules: self.rules,
            states: self.states,
            spans: self.spans,
            events,
        }
    }

    pub async fn view(&self, slug: &Slug, now: UnixSeconds) -> Result<PublicView, StatusError> {
        let page = self.public_page(slug).await?;
        self.render(&page, now).await
    }

    pub async fn view_in_org(
        &self,
        org_slug: &Slug,
        slug: &Slug,
        now: UnixSeconds,
    ) -> Result<PublicView, StatusError> {
        let page = self.public_page_in_org(org_slug, slug).await?;
        self.render(&page, now).await
    }

    pub async fn preview<S, G, K>(
        &self,
        readers: &Readers<S, G, K>,
        who: &Reader,
        org: TenantId,
        id: StatusPageId,
        now: UnixSeconds,
    ) -> Result<PublicView, StatusError>
    where
        S: SessionStore,
        G: Memberships,
        K: ApiKeys,
    {
        readers.grant(who, org).await?;
        let page = self
            .pages
            .get(org, id)
            .await?
            .ok_or(StatusError::NoSuchPage)?;
        self.render(&page, now).await
    }

    pub async fn render(
        &self,
        page: &StatusPage,
        now: UnixSeconds,
    ) -> Result<PublicView, StatusError> {
        let org_slug = self.pages.org_slug(page.org).await?;
        let components: Vec<_> = self
            .pages
            .components(page.org, page.id)
            .await?
            .into_iter()
            .filter(|component| component.public)
            .collect();
        let links: Vec<&Link> = components.iter().map(|component| &component.link).collect();
        let now_ms = now.get().saturating_mul(MILLIS_PER_SECOND);
        let observed = self.observe(page, &links, now).await?;
        let shown_components: Vec<PublicComponent> = components
            .iter()
            .map(|component| {
                let status = derive(&component.link, component.manual_status, &observed);
                let days = derive_days(&component.link, status, &observed, page.created_ms, now_ms);
                PublicComponent {
                    name: component.name.clone(),
                    status,
                    days,
                }
            })
            .collect();
        let incidents = self.incidents(page, now).await?;
        let open = incidents.iter().any(|incident| incident.status.is_open());
        Ok(PublicView {
            org_slug,
            name: page.name.clone(),
            slug: page.slug.clone(),
            theme: page.theme,
            intro: page.intro.clone(),
            hide_from_search: page.hide_from_search,
            updated_ms: page.updated_ms,
            overall: overall(&shown_components, open),
            components: shown_components,
            incidents,
        })
    }

    pub async fn postmortem(
        &self,
        slug: &Slug,
        incident: IncidentId,
    ) -> Result<PublicPostmortem, StatusError> {
        let page = self.public_page(slug).await?;
        self.load_postmortem(&page, incident).await
    }

    pub async fn postmortem_in_org(
        &self,
        org_slug: &Slug,
        slug: &Slug,
        incident: IncidentId,
    ) -> Result<PublicPostmortem, StatusError> {
        let page = self.public_page_in_org(org_slug, slug).await?;
        self.load_postmortem(&page, incident).await
    }

    async fn load_postmortem(
        &self,
        page: &StatusPage,
        incident: IncidentId,
    ) -> Result<PublicPostmortem, StatusError> {
        let held = self
            .incidents
            .get(page.org, incident)
            .await?
            .filter(|held| held.public)
            .ok_or(StatusError::NoSuchPostmortem)?;
        let postmortem = self
            .postmortems
            .of(page.org, incident)
            .await?
            .filter(|postmortem| postmortem.status == PostmortemStatus::Published)
            .ok_or(StatusError::NoSuchPostmortem)?;
        Ok(PublicPostmortem {
            title: held.title,
            body: redacted(postmortem.body.as_str()).into(),
            published_ms: postmortem.published_ms.unwrap_or(postmortem.updated_ms),
        })
    }

    async fn public_page(&self, slug: &Slug) -> Result<StatusPage, StatusError> {
        self.pages
            .by_slug(slug)
            .await?
            .filter(|page| page.public)
            .ok_or(StatusError::NoSuchPage)
    }

    async fn public_page_in_org(
        &self,
        org_slug: &Slug,
        slug: &Slug,
    ) -> Result<StatusPage, StatusError> {
        self.pages
            .by_org_and_slug(org_slug, slug)
            .await?
            .filter(|page| page.public)
            .ok_or(StatusError::NoSuchPage)
    }

    async fn incidents(
        &self,
        page: &StatusPage,
        now: UnixSeconds,
    ) -> Result<Vec<PublicIncident>, StatusError> {
        let now_ms = now.get().saturating_mul(MILLIS_PER_SECOND);
        let held = self
            .incidents
            .list(
                page.org,
                &IncidentFilter {
                    scope: IncidentScope::All,
                    project: None,
                },
            )
            .await?;
        let mut shown_incidents = Vec::new();
        for incident in held.into_iter().filter(|held| shown(held, now_ms)) {
            let entries = self.timeline.of(page.org, incident.id).await?;
            let postmortem = self
                .postmortems
                .of(page.org, incident.id)
                .await?
                .is_some_and(|postmortem| postmortem.status == PostmortemStatus::Published);
            shown_incidents.push(PublicIncident {
                id: incident.id,
                title: incident.title,
                status: incident.status,
                severity: incident.severity,
                opened_ms: incident.opened_ms,
                resolved_ms: incident.resolved_ms,
                updates: public_updates(&entries),
                postmortem,
            });
        }
        Ok(shown_incidents)
    }

    async fn observe(
        &self,
        page: &StatusPage,
        links: &[&Link],
        now: UnixSeconds,
    ) -> Result<Observed, StatusError> {
        let mut observed = Observed::default();
        self.observe_alerts(page, links, now, &mut observed).await?;
        self.observe_services(page, links, now, &mut observed).await;
        Ok(observed)
    }

    async fn observe_alerts(
        &self,
        page: &StatusPage,
        links: &[&Link],
        now: UnixSeconds,
        observed: &mut Observed,
    ) -> Result<(), StatusError> {
        let now_ms = now.get().saturating_mul(MILLIS_PER_SECOND);
        let from_ms = now_ms.saturating_sub((UPTIME_DAYS as u64) * DAY_MS);
        let mut alert_rules: Vec<RuleId> = links
            .iter()
            .filter_map(|link| match link {
                Link::Alert(rule) => Some(*rule),
                Link::Manual | Link::Service { .. } => None,
            })
            .collect();
        alert_rules.sort_unstable();
        alert_rules.dedup();
        if alert_rules.is_empty() {
            return Ok(());
        }
        let rules = self.rules.list(page.org).await?;
        let states = self.states.of_org(page.org).await?;
        for (rule, series) in &states {
            if series.state.status != AlertStatus::Firing {
                continue;
            }
            if let Some(held) = rules.iter().find(|held| held.id == *rule) {
                observed.firing.push((*rule, held.definition.severity()));
            }
        }
        for rule in alert_rules {
            let Some(held) = rules.iter().find(|held| held.id == rule) else {
                continue;
            };
            let firing_since = states
                .iter()
                .filter(|(id, series)| *id == rule && series.state.status == AlertStatus::Firing)
                .map(|(_, series)| series.state.since_ms)
                .min();
            let events = self
                .events
                .events_for(page.org, rule, from_ms, now_ms)
                .await
                .unwrap_or_default();
            let days = alert_days_from_state(
                held.definition.severity(),
                firing_since.is_some(),
                firing_since.unwrap_or_default(),
                held.created_ms,
                &events,
                now_ms,
            );
            observed.alert_days.push((rule, days));
        }
        Ok(())
    }

    async fn observe_services(
        &self,
        page: &StatusPage,
        links: &[&Link],
        now: UnixSeconds,
        observed: &mut Observed,
    ) {
        let mut projects: Vec<Option<ProjectId>> = links
            .iter()
            .filter_map(|link| match link {
                Link::Service { project, .. } => Some(*project),
                Link::Alert(_) | Link::Manual => None,
            })
            .collect();
        projects.sort_unstable();
        projects.dedup();
        let (Some(spans), false) = (self.spans, projects.is_empty()) else {
            return;
        };
        let to = now.get().saturating_mul(NANOS_PER_SECOND);
        let from = to.saturating_sub(SERVICE_WINDOW_SECS * NANOS_PER_SECOND);
        let Ok(window) = Window::new(from, to) else {
            return;
        };
        for project in projects {
            let mut filter = ServiceFilter::over(window);
            filter.project = project;
            let Ok(services) = spans.services(page.org, &filter).await else {
                continue;
            };
            observed
                .services
                .extend(services.into_iter().map(|summary| ServiceLoad {
                    name: summary.name,
                    project,
                    requests: summary.requests,
                    errors: summary.errors,
                }));
        }
        let history_from = to.saturating_sub((UPTIME_DAYS as u64) * DAY_SECS * NANOS_PER_SECOND);
        let Ok(history_window) = Window::new(history_from, to) else {
            return;
        };
        let mut service_links: Vec<(&str, Option<ProjectId>)> = links
            .iter()
            .filter_map(|link| match link {
                Link::Service { name, project } => Some((name.as_str(), *project)),
                Link::Alert(_) | Link::Manual => None,
            })
            .collect();
        service_links.sort_unstable();
        service_links.dedup();
        for (name, project) in service_links {
            let mut filter = ServiceFilter::over(history_window);
            filter.project = project;
            let Ok(series) = spans.series(page.org, Some(name), &filter).await else {
                continue;
            };
            if series.points.is_empty() {
                continue;
            }
            observed.service_days.push(ServiceHistory {
                name: name.into(),
                project,
                days: service_days_from_points(&series.points, history_from),
            });
        }
    }
}
