use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    #[serde(default)]
    pub policy: Option<CategoryPolicy>,
    #[serde(default)]
    pub duration_minutes: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: String,
    pub name: String,
    pub domain: String,
    pub category_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub custom_icon: Option<String>,
    #[serde(default)]
    pub duration_minutes: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category_id: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Protection {
    pub phrase_enabled: bool,
    pub phrase: String,
    pub steps: u8,
    pub wait_minutes: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPolicy {
    pub protection: Protection,
    pub keyword_filter_enabled: bool,
    pub blocked_keywords: Vec<String>,
    pub strict_network_guard: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnlockProgress {
    pub step: u8,
    pub ready_at: i64,
    pub total: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub site_ids: Vec<String>,
    pub domains: Vec<String>,
    pub started_at: i64,
    pub ends_at: i64,
    pub test_mode: bool,
    pub protection: Protection,
    #[serde(default)]
    pub app_ids: Vec<String>,
    #[serde(default)]
    pub app_paths: Vec<String>,
    #[serde(default)]
    pub category_ids: Vec<String>,
    #[serde(default)]
    pub unlock: Option<UnlockProgress>,
    #[serde(default)]
    pub policy_category_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub blocked_keywords: Vec<String>,
    #[serde(default)]
    pub strict_network_guard: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub category_ids: Vec<String>,
    pub days: Vec<u8>,
    pub start: String,
    pub end: String,
    pub enabled: bool,
    #[serde(default)]
    pub skip_until: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLog {
    pub id: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub planned_end: i64,
    pub site_count: usize,
    pub completed: bool,
    pub test_mode: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    pub protection: Protection,
    pub test_mode: bool,
    #[serde(default)]
    pub saved_accents: Vec<String>,
    #[serde(default = "default_presets")]
    pub duration_presets: Vec<u32>,
    #[serde(default)]
    pub duration_usage: std::collections::BTreeMap<String, u64>,
    #[serde(default = "default_website_icons")]
    pub website_icons: String,
    #[serde(default)]
    pub keyword_filter_enabled: bool,
    #[serde(default = "default_keywords")]
    pub blocked_keywords: Vec<String>,
    #[serde(default)]
    pub strict_network_guard: bool,
}
fn default_website_icons() -> String {
    "svg".into()
}
fn default_keywords() -> Vec<String> {
    vec!["porn".into(), "sex".into(), "hentai".into(), "fuck".into()]
}
fn default_presets() -> Vec<u32> {
    vec![25, 45, 60]
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub version: u8,
    #[serde(default)]
    pub revision: u64,
    pub categories: Vec<Category>,
    pub sites: Vec<Site>,
    #[serde(default)]
    pub apps: Vec<Application>,
    pub schedules: Vec<Schedule>,
    #[serde(default)]
    pub session: Option<Session>,
    #[serde(default)]
    pub sessions: Vec<Session>,
    pub history: Vec<SessionLog>,
    pub settings: Settings,
}

impl Default for AppState {
    fn default() -> Self {
        let mut state: Self = serde_json::from_str(include_str!("../default-state.json"))
            .expect("valid bundled defaults");
        state.migrate();
        state
    }
}
pub fn timestamp() -> i64 {
    Local::now().timestamp_millis()
}
pub fn time_minutes(time: &str) -> Option<u32> {
    let (h, m) = time.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let h = h.parse::<u32>().ok()?;
    let m = m.parse::<u32>().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}
pub fn schedule_active_at(schedule: &Schedule, day: u8, minute: u32) -> bool {
    if !schedule.enabled {
        return false;
    }
    let (Some(start), Some(end)) = (time_minutes(&schedule.start), time_minutes(&schedule.end))
    else {
        return false;
    };
    if start == end {
        return false;
    }
    if start < end {
        schedule.days.contains(&day) && minute >= start && minute < end
    } else {
        (schedule.days.contains(&day) && minute >= start)
            || (schedule.days.contains(&((day + 6) % 7)) && minute < end)
    }
}
pub fn schedule_active(schedule: &Schedule, now: DateTime<Local>) -> bool {
    now.timestamp_millis() >= schedule.skip_until
        && schedule_active_at(
            schedule,
            now.weekday().num_days_from_sunday() as u8,
            now.hour() * 60 + now.minute(),
        )
}
pub fn blocked_domains(state: &AppState, now: DateTime<Local>) -> BTreeSet<String> {
    let mut domains = BTreeSet::new();
    for session in state.sessions.iter().chain(state.session.iter()) {
        if session.ends_at > now.timestamp_millis() {
            domains.extend(session.domains.clone());
        }
    }
    for schedule in state.schedules.iter().filter(|s| schedule_active(s, now)) {
        domains.extend(
            state
                .sites
                .iter()
                .filter(|s| schedule.category_ids.contains(&s.category_id))
                .map(|s| s.domain.clone()),
        );
    }
    domains
}
pub fn valid_domain(domain: &str) -> bool {
    domain.len() <= 253
        && domain.contains('.')
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}
pub fn schedule_occurrence_end(schedule: &Schedule, now: DateTime<Local>) -> i64 {
    let Some(end) = time_minutes(&schedule.end) else {
        return now.timestamp_millis();
    };
    let start = time_minutes(&schedule.start).unwrap_or(0);
    let minute = now.hour() * 60 + now.minute();
    let mut date = now.date_naive();
    if start > end && minute >= start {
        date += Duration::days(1);
    }
    let Some(naive) = date.and_hms_opt(end / 60, end % 60, 0) else {
        return now.timestamp_millis();
    };
    // A local end time in a spring DST gap moves to the first valid minute.
    for offset in 0..=180 {
        if let Some(end) = Local
            .from_local_datetime(&(naive + Duration::minutes(offset)))
            .latest()
        {
            return end.timestamp_millis();
        }
    }
    now.timestamp_millis()
}
pub fn blocked_app_paths(state: &AppState, now: DateTime<Local>) -> BTreeSet<String> {
    let mut paths = BTreeSet::new();
    for s in state.sessions.iter().chain(state.session.iter()) {
        if s.ends_at > now.timestamp_millis() {
            paths.extend(s.app_paths.iter().map(|p| p.to_lowercase()));
        }
    }
    for s in state.schedules.iter().filter(|s| schedule_active(s, now)) {
        paths.extend(
            state
                .apps
                .iter()
                .filter(|a| s.category_ids.contains(&a.category_id))
                .map(|a| a.path.to_lowercase()),
        );
    }
    paths
}
pub fn countdown_until(state: &AppState, now: DateTime<Local>) -> Option<i64> {
    let mut ends = Vec::new();
    for s in state.sessions.iter().chain(state.session.iter()) {
        if s.ends_at > now.timestamp_millis() {
            ends.push(s.ends_at);
        }
    }
    for s in state.schedules.iter().filter(|s| schedule_active(s, now)) {
        ends.push(schedule_occurrence_end(s, now));
    }
    ends.into_iter().max()
}
// Keep the previous companion useful while its managed folder reloads.
// This projection is read-only; persisted timers remain independent.
pub fn legacy_companion_state(mut state: AppState) -> AppState {
    let now = Local::now();
    let active: Vec<_> = state
        .sessions
        .iter()
        .filter(|s| s.ends_at > now.timestamp_millis())
        .cloned()
        .collect();
    let mut keywords: BTreeSet<_> = active
        .iter()
        .flat_map(|s| s.blocked_keywords.clone())
        .collect();
    for schedule in state.schedules.iter().filter(|s| schedule_active(s, now)) {
        for id in &schedule.category_ids {
            let p = state.policy(id);
            if p.keyword_filter_enabled {
                keywords.extend(p.blocked_keywords);
            }
        }
    }
    state.settings.keyword_filter_enabled = !keywords.is_empty();
    state.settings.blocked_keywords = keywords.into_iter().collect();
    state.settings.strict_network_guard = strict_until(&state, now).is_some();
    state.session = active.first().cloned().map(|mut s| {
        s.domains = active
            .iter()
            .flat_map(|s| s.domains.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        s.ends_at = active.iter().map(|s| s.ends_at).max().unwrap();
        s
    });
    state
}
pub fn strict_until(state: &AppState, now: DateTime<Local>) -> Option<i64> {
    let mut ends: Vec<_> = state
        .sessions
        .iter()
        .chain(state.session.iter())
        .filter(|s| {
            s.ends_at > now.timestamp_millis()
                && !s.test_mode
                && (s.strict_network_guard
                    || (s.label.is_empty() && state.settings.strict_network_guard))
        })
        .map(|s| s.ends_at)
        .collect();
    if !state.settings.test_mode {
        for s in state.schedules.iter().filter(|s| {
            schedule_active(s, now)
                && s.category_ids
                    .iter()
                    .any(|id| state.policy(id).strict_network_guard)
        }) {
            ends.push(schedule_occurrence_end(s, now));
        }
    }
    ends.into_iter().max()
}
pub fn valid_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}
impl AppState {
    pub fn policy(&self, id: &str) -> CategoryPolicy {
        self.categories
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.policy.clone())
            .unwrap_or(CategoryPolicy {
                protection: self.settings.protection.clone(),
                keyword_filter_enabled: self.settings.keyword_filter_enabled,
                blocked_keywords: self.settings.blocked_keywords.clone(),
                strict_network_guard: self.settings.strict_network_guard,
            })
    }
    pub fn migrate(&mut self) {
        if let Some(mut s) = self.session.take() {
            if !self.sessions.iter().any(|existing| existing.id == s.id) {
                if s.category_ids.is_empty() {
                    s.category_ids = self
                        .sites
                        .iter()
                        .filter(|x| s.site_ids.contains(&x.id))
                        .map(|x| x.category_id.clone())
                        .chain(
                            self.apps
                                .iter()
                                .filter(|x| s.app_ids.contains(&x.id))
                                .map(|x| x.category_id.clone()),
                        )
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect();
                }
                s.strict_network_guard = self.settings.strict_network_guard;
                s.blocked_keywords = if self.settings.keyword_filter_enabled {
                    self.settings.blocked_keywords.clone()
                } else {
                    vec![]
                };
                s.label = "Existing focus session".into();
                self.sessions.push(s);
            }
        }
        for i in 0..self.categories.len() {
            if self.categories[i].policy.is_none() {
                self.categories[i].policy = Some(self.policy(&self.categories[i].id));
            }
        }
    }
    pub fn policy_locked(&self, id: &str, now: DateTime<Local>) -> bool {
        self.sessions.iter().any(|s| {
            s.ends_at > now.timestamp_millis()
                && !s.test_mode
                && (s.policy_category_id == id || s.category_ids.iter().any(|c| c == id))
        }) || (!self.settings.test_mode
            && self
                .schedules
                .iter()
                .any(|s| s.category_ids.iter().any(|c| c == id) && schedule_active(s, now)))
    }
    pub fn inherit_active_categories(&mut self, before: &AppState) {
        for s in &mut self.sessions {
            if s.ends_at <= timestamp() {
                continue;
            }
            for site in &self.sites {
                if s.category_ids.contains(&site.category_id)
                    && !before.sites.iter().any(|old| {
                        old.id == site.id
                            && old.domain == site.domain
                            && old.category_id == site.category_id
                    })
                {
                    if !s.domains.contains(&site.domain) {
                        s.domains.push(site.domain.clone());
                    }
                    if !s.site_ids.contains(&site.id) {
                        s.site_ids.push(site.id.clone());
                    }
                }
            }
            for app in &self.apps {
                if s.category_ids.contains(&app.category_id)
                    && !before.apps.iter().any(|old| {
                        old.id == app.id
                            && old.path == app.path
                            && old.category_id == app.category_id
                    })
                {
                    if !s.app_paths.contains(&app.path) {
                        s.app_paths.push(app.path.clone());
                    }
                    if !s.app_ids.contains(&app.id) {
                        s.app_ids.push(app.id.clone());
                    }
                }
            }
        }
    }
    pub fn start_timers(
        &mut self,
        site_ids: &[String],
        app_ids: &[String],
        category_ids: &[String],
        minutes: f64,
        test_mode: bool,
    ) -> Result<(), String> {
        self.expire();
        if !minutes.is_finite() || minutes.fract() != 0.0 || !(1.0..=1440.0).contains(&minutes) {
            return Err("Choose between 1 and 1,440 whole minutes.".into());
        }
        if test_mode != self.settings.test_mode {
            return Err("Save test mode before starting a timer.".into());
        }
        let targets: Vec<_> = if !category_ids.is_empty() {
            category_ids.iter().map(|id| (id, true)).collect()
        } else {
            site_ids
                .iter()
                .chain(app_ids)
                .map(|id| (id, false))
                .collect()
        };
        if targets.is_empty() || targets.len() + self.sessions.len() > 2200 {
            return Err("Choose at least one target (up to 2,200 active timers).".into());
        }
        let mut additions = Vec::new();
        for (id, category) in targets {
            if self
                .sessions
                .iter()
                .chain(additions.iter())
                .any(|s: &Session| {
                    if category {
                        s.category_ids.contains(id)
                    } else {
                        s.category_ids.is_empty()
                            && (s.site_ids.contains(id) || s.app_ids.contains(id))
                    }
                })
            {
                return Err("This target already has a timer.".into());
            }
            let sites: Vec<_> = self
                .sites
                .iter()
                .filter(|s| {
                    if category {
                        s.category_id == *id
                    } else {
                        s.id == *id
                    }
                })
                .collect();
            let apps: Vec<_> = self
                .apps
                .iter()
                .filter(|a| {
                    if category {
                        a.category_id == *id
                    } else {
                        a.id == *id
                    }
                })
                .collect();
            if sites.is_empty() && apps.is_empty() {
                return Err("This target has no websites or applications.".into());
            }
            let category_id = if category {
                id.clone()
            } else {
                sites
                    .first()
                    .map(|s| s.category_id.clone())
                    .unwrap_or_else(|| apps[0].category_id.clone())
            };
            let policy = self.policy(&category_id);
            let label = if category {
                self.categories
                    .iter()
                    .find(|c| c.id == *id)
                    .ok_or("Category not found.")?
                    .name
                    .clone()
            } else {
                sites
                    .first()
                    .map(|s| s.name.clone())
                    .unwrap_or_else(|| apps[0].name.clone())
            };
            additions.push(Session {
                id: uuid::Uuid::new_v4().to_string(),
                site_ids: sites.iter().map(|s| s.id.clone()).collect(),
                domains: sites
                    .iter()
                    .map(|s| s.domain.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
                started_at: timestamp(),
                ends_at: timestamp() + (minutes * 60000.0) as i64,
                test_mode,
                protection: policy.protection,
                app_ids: apps.iter().map(|a| a.id.clone()).collect(),
                app_paths: apps.iter().map(|a| a.path.clone()).collect(),
                category_ids: if category { vec![id.clone()] } else { vec![] },
                unlock: None,
                policy_category_id: category_id,
                label,
                blocked_keywords: if policy.keyword_filter_enabled {
                    policy.blocked_keywords
                } else {
                    vec![]
                },
                strict_network_guard: policy.strict_network_guard,
            });
        }
        self.sessions.extend(additions);
        for c in &mut self.categories {
            if category_ids.contains(&c.id) {
                c.duration_minutes = Some(minutes as u32);
            }
        }
        for s in &mut self.sites {
            if site_ids.contains(&s.id) {
                s.duration_minutes = Some(minutes as u32);
            }
        }
        *self
            .settings
            .duration_usage
            .entry(minutes.to_string())
            .or_insert(0) += 1;
        Ok(())
    }
    pub fn validate(&self) -> Result<(), String> {
        if !["svg", "custom"].contains(&self.settings.website_icons.as_str())
            || self.settings.blocked_keywords.len() > 200
            || self.settings.blocked_keywords.iter().any(|word| {
                word.trim().is_empty()
                    || word.chars().count() > 48
                    || word.chars().any(char::is_control)
            })
        {
            return Err("Use up to 200 URL keywords, each from 1 to 48 characters.".into());
        }
        if self.version != 1
            || self.sites.len() > 2000
            || self.categories.len() > 100
            || self.schedules.len() > 100
            || self.apps.len() > 200
        {
            return Err("This configuration exceeds the supported limits.".into());
        }
        let unique = |ids: Vec<&str>| ids.iter().collect::<BTreeSet<_>>().len() == ids.len();
        if !unique(self.sites.iter().map(|s| s.id.as_str()).collect())
            || !unique(self.apps.iter().map(|s| s.id.as_str()).collect())
            || !unique(self.categories.iter().map(|s| s.id.as_str()).collect())
            || !unique(self.schedules.iter().map(|s| s.id.as_str()).collect())
        {
            return Err("Duplicate item IDs are not allowed.".into());
        }
        if self
            .categories
            .iter()
            .any(|c| c.name.trim().is_empty() || c.name.len() > 160 || !valid_color(&c.color))
            || self.sites.iter().any(|s| {
                !valid_domain(&s.domain) || !self.categories.iter().any(|c| c.id == s.category_id)
            })
        {
            return Err("Invalid website or category.".into());
        }
        for app in &self.apps {
            if app.name.trim().is_empty()
                || !self.categories.iter().any(|c| c.id == app.category_id)
            {
                return Err("Invalid application category or name.".into());
            }
            crate::app_guard::validate_path(&app.path)?;
        }
        if self.settings.saved_accents.len() > 20
            || self.settings.saved_accents.iter().any(|c| !valid_color(c))
            || self.settings.duration_presets.is_empty()
            || self.settings.duration_presets.len() > 12
            || self
                .settings
                .duration_presets
                .iter()
                .any(|n| !(1..=1440).contains(n))
        {
            return Err(
                "Use valid saved colors and 1–1,440 minute duration presets (up to 12).".into(),
            );
        }
        for category in &self.categories {
            let policy = self.policy(&category.id);
            let p = &policy.protection;
            if p.steps > 10
                || p.wait_minutes > 30
                || p.phrase.len() > 1000
                || (p.phrase_enabled && p.phrase.trim().is_empty())
                || policy.blocked_keywords.len() > 200
                || policy.blocked_keywords.iter().any(|w| {
                    w.trim().is_empty() || w.chars().count() > 48 || w.chars().any(char::is_control)
                })
                || category
                    .duration_minutes
                    .is_some_and(|n| !(1..=1440).contains(&n))
            {
                return Err("Invalid category filtering, duration, or unlock protection.".into());
            }
        }
        let p = &self.settings.protection;
        if p.steps > 10
            || p.wait_minutes > 30
            || p.phrase.len() > 1000
            || (p.phrase_enabled && p.phrase.trim().is_empty())
        {
            return Err("Invalid unlock protection settings.".into());
        }
        if !["dark", "light", "system"].contains(&self.settings.theme.as_str())
            || self.settings.accent.len() != 7
            || !self.settings.accent.starts_with('#')
            || !self.settings.accent[1..]
                .chars()
                .all(|c| c.is_ascii_hexdigit())
        {
            return Err("Invalid appearance settings.".into());
        }
        for schedule in &self.schedules {
            if time_minutes(&schedule.start).is_none()
                || time_minutes(&schedule.end).is_none()
                || schedule.start == schedule.end
                || schedule.days.is_empty()
                || schedule.days.iter().any(|d| *d > 6)
                || schedule.category_ids.is_empty()
                || schedule
                    .category_ids
                    .iter()
                    .any(|id| !self.categories.iter().any(|c| c.id == *id))
            {
                return Err(
                    "A schedule needs valid days, categories, and different start and end times."
                        .into(),
                );
            }
        }
        Ok(())
    }
    pub fn finish_session(&mut self, id: &str, ended_at: i64, completed: bool) {
        if let Some(index) = self.sessions.iter().position(|s| s.id == id) {
            let s = self.sessions.remove(index);
            self.history.insert(
                0,
                SessionLog {
                    id: s.id,
                    started_at: s.started_at,
                    ended_at,
                    planned_end: s.ends_at,
                    site_count: s.domains.len(),
                    completed,
                    test_mode: s.test_mode,
                },
            );
            self.history.truncate(1000);
        }
    }
    pub fn expire(&mut self) -> bool {
        let expired: Vec<_> = self
            .sessions
            .iter()
            .filter(|s| s.ends_at <= timestamp())
            .map(|s| (s.id.clone(), s.ends_at))
            .collect();
        for (id, end) in &expired {
            self.finish_session(id, *end, true);
        }
        !expired.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn schedule(start: &str, end: &str) -> Schedule {
        Schedule {
            id: "a".into(),
            name: "Work".into(),
            category_ids: vec!["social".into()],
            days: vec![1],
            start: start.into(),
            end: end.into(),
            enabled: true,
            skip_until: 0,
        }
    }
    #[test]
    fn concurrent_category_and_site_timers_expire_and_unlock_independently() {
        let mut s = AppState::default();
        s.settings.test_mode = true;
        s.start_timers(&[], &[], &["social".into()], 2.0, true)
            .unwrap();
        s.start_timers(&[], &[], &["entertainment".into()], 5.0, true)
            .unwrap();
        s.start_timers(&["instagram".into()], &[], &[], 10.0, true)
            .unwrap();
        assert_eq!(s.sessions.len(), 3);
        assert_eq!(blocked_domains(&s, Local::now()).len(), 7);
        let social_id = s.sessions[0].id.clone();
        s.finish_session(&social_id, timestamp(), false);
        assert!(!blocked_domains(&s, Local::now()).contains("reddit.com"));
        assert!(blocked_domains(&s, Local::now()).contains("instagram.com"));
        s.sessions[0].ends_at = timestamp() - 1000;
        assert!(s.expire());
        assert_eq!(s.sessions.len(), 1);
        assert_eq!(blocked_domains(&s, Local::now()).len(), 1);
        assert_eq!(s.history.len(), 2);
        assert_eq!(s.categories[0].duration_minutes, Some(2));
        assert_eq!(s.sites[0].duration_minutes, Some(10));
    }
    #[test]
    fn timer_policies_are_scoped_and_site_timers_do_not_inherit_the_category() {
        let mut s = AppState::default();
        let mut policy = s.policy("social");
        policy.blocked_keywords = vec!["social-word".into()];
        policy.keyword_filter_enabled = true;
        policy.protection.wait_minutes = 5;
        s.categories[0].policy = Some(policy);
        s.start_timers(&["instagram".into()], &[], &[], 25.0, false)
            .unwrap();
        assert!(s.policy_locked("social", Local::now()));
        assert!(!s.policy_locked("entertainment", Local::now()));
        assert_eq!(s.sessions[0].blocked_keywords, vec!["social-word"]);
        assert_eq!(s.sessions[0].protection.wait_minutes, 5);
        assert_eq!(strict_until(&s, Local::now()), None);
        let before = s.clone();
        s.sites[1].domain = "new.example".into();
        s.inherit_active_categories(&before);
        assert!(!s.sessions[0].domains.contains(&"new.example".into()));
        assert!(s
            .start_timers(&["instagram".into()], &[], &[], 30.0, false)
            .is_err());
        s.start_timers(&[], &[], &["entertainment".into()], 30.0, false)
            .unwrap();
        assert_ne!(s.sessions[0].protection, s.sessions[1].protection);
    }
    #[test]
    fn strict_guard_observes_only_strict_category_deadlines() {
        let mut s = AppState::default();
        let mut policy = s.policy("social");
        policy.strict_network_guard = true;
        s.categories[0].policy = Some(policy);
        s.start_timers(&[], &[], &["entertainment".into()], 60.0, false)
            .unwrap();
        assert_eq!(strict_until(&s, Local::now()), None);
        s.start_timers(&[], &[], &["social".into()], 10.0, false)
            .unwrap();
        assert_eq!(strict_until(&s, Local::now()), Some(s.sessions[1].ends_at));
        let id = s.sessions[1].id.clone();
        s.finish_session(&id, timestamp(), false);
        assert_eq!(strict_until(&s, Local::now()), None);
    }
    #[test]
    fn migration_preserves_deadlines_and_unlock_progress_and_is_idempotent() {
        let mut s = AppState::default();
        s.start_timers(&[], &[], &["social".into()], 25.0, false)
            .unwrap();
        let mut old = s.sessions.pop().unwrap();
        let end = old.ends_at;
        old.unlock = Some(UnlockProgress {
            step: 1,
            total: 2,
            ready_at: timestamp() + 10000,
        });
        let progress = old.unlock.clone();
        old.label.clear();
        old.category_ids.clear();
        s.session = Some(old);
        s.settings.keyword_filter_enabled = true;
        s.settings.blocked_keywords = vec!["legacy-word".into()];
        for c in &mut s.categories {
            c.policy = None;
        }
        s.migrate();
        s.migrate();
        assert!(s.session.is_none());
        assert_eq!(s.sessions.len(), 1);
        assert_eq!(s.sessions[0].ends_at, end);
        assert_eq!(s.sessions[0].unlock, progress);
        assert_eq!(s.sessions[0].blocked_keywords, vec!["legacy-word"]);
        assert!(s.sessions[0].category_ids.contains(&"social".into()));
        assert_eq!(
            s.policy("entertainment").blocked_keywords,
            vec!["legacy-word"]
        );
        let legacy = legacy_companion_state(s.clone());
        assert_eq!(legacy.session.unwrap().ends_at, end);
        assert_eq!(legacy.settings.blocked_keywords, vec!["legacy-word"]);
    }
    #[test]
    fn overnight_respects_start_day() {
        let s = schedule("22:00", "06:00");
        assert!(schedule_active_at(&s, 1, 23 * 60));
        assert!(schedule_active_at(&s, 2, 5 * 60));
        assert!(!schedule_active_at(&s, 1, 5 * 60));
        assert!(!schedule_active_at(&s, 2, 6 * 60));
    }
    #[test]
    fn day_schedule_boundaries() {
        let s = schedule("09:00", "12:00");
        assert!(schedule_active_at(&s, 1, 540));
        assert!(!schedule_active_at(&s, 1, 720));
        assert!(!schedule_active_at(&s, 0, 600));
    }
    #[test]
    fn defaults_are_valid() {
        AppState::default().validate().unwrap();
    }
    #[test]
    fn reject_malformed_domains() {
        assert!(!valid_domain("youtube.com/path"));
        assert!(!valid_domain("-example.com"));
        assert!(!valid_domain("example..com"));
        assert!(valid_domain("music.youtube.com"));
    }
    #[test]
    fn schedules_cover_disabled_sites_and_apps_and_respect_skip() {
        let mut state = AppState::default();
        for site in &mut state.sites {
            site.enabled = false;
        }
        let now = Local.with_ymd_and_hms(2026, 11, 9, 10, 0, 0).unwrap();
        let s = schedule("09:00", "12:00");
        state.schedules.push(s);
        state.apps.push(Application {
            id: "app".into(),
            name: "Example".into(),
            path: r"C:\Apps\Example.exe".into(),
            category_id: "social".into(),
            enabled: false,
        });
        assert_eq!(blocked_domains(&state, now).len(), 4);
        assert_eq!(blocked_app_paths(&state, now).len(), 1);
        let end = schedule_occurrence_end(&state.schedules[0], now);
        assert_eq!(
            end,
            Local
                .with_ymd_and_hms(2026, 11, 9, 12, 0, 0)
                .unwrap()
                .timestamp_millis()
        );
        state.schedules[0].skip_until = end;
        assert!(blocked_domains(&state, now).is_empty());
        assert!(!schedule_active(&state.schedules[0], now));
        assert!(schedule_active(
            &state.schedules[0],
            now + Duration::days(7)
        ));
    }
}
