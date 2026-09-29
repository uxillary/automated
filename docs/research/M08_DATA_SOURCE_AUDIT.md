# M08 Data-Source Audit

**Audit date:** 2026-09-29  
**Scope:** research only; no collectors, workflows, allow-lists, generated data, or dashboard UI changed.

## 1. Executive summary

The dashboard already has durable daily history for release-asset download counts and YouTube channel statistics, plus derived summaries and interface features for those datasets. It does not yet measure discovery upstream of a download: repository views/clones, website visits, or Google Search impressions/clicks.

The highest-value additions are (1) daily GitHub traffic snapshots, (2) website analytics for a small set of owned product sites, and (3) Google Search Console property-level performance data. Start GitHub traffic snapshotting first: GitHub documents these traffic endpoints as returning only the last 14 days. Older daily history cannot be recovered through those endpoints. The existing `API_GITHUB` token may work only if its repository permissions include read access to each repository's Administration settings; that has not been verified.

Recommended sequence: M08 establish project identity and snapshot GitHub repository attention/traffic; M09 publish Cloudflare Web Analytics aggregates for selected sites; M10 add Search Console aggregates after owner setup and privacy decisions; M11 join trends at project level without claiming individual attribution; M12 add restrained, evidence-based insights after sufficient comparable history exists.

## 2. Current architecture

| Area | Verified current behavior |
| --- | --- |
| GitHub release downloads | `scripts/github_release_config.js` explicitly allows `uxillary/font-size-tweak` and `uxillary/maintenance-goblin`. `.github/workflows/github-release-metrics.yml` runs daily at 02:41 UTC and manually, using `GH_TOKEN: secrets.API_GITHUB`. `scripts/github_release_metrics.js` stores cumulative asset counts as dated snapshots. |
| Release history | `docs/metrics/github_releases_history.json` is the durable snapshot series plus entity metadata. `docs/metrics/github_releases_summary.json` is regenerated for browser use. History begins at the first successful snapshot; no prior daily download data is backfilled. |
| Lifetime GitHub values | `.github/workflows/github-lifetime-stats.yml` runs daily at 02:23 UTC. `scripts/github_lifetime_stats.js` writes one-line totals to `docs/lifetime-contributions.txt` and `docs/release-downloads.txt`; it is not a history series. |
| YouTube | Several legacy workflows collect six channel totals daily, append CSV history and write current JSON. `.github/workflows/youtube-metrics-derived.yml` runs daily at 02:07 UTC, computes derived outputs under `data/metrics/`, then publishes copies under `docs/metrics/`. The summed and combined workflows also run daily. |
| Scheduling and publishing | Scheduled GitHub Actions workflows commit generated data back to the repository. GitHub Pages serves the public `docs/` tree. Schedules use UTC cron and generally permit `workflow_dispatch`. |
| Browser contract | Dashboard scripts fetch `docs/metrics/github_releases_summary.json` and `github_releases_history.json`; YouTube UI consumes `docs/metrics/youtube_summary.json`, `youtube_enriched.csv`, and legacy snapshots. The public output must be treated as public and credential-free. |

Relevant files inspected: `.github/workflows/`, `scripts/github_release_config.js`, `scripts/github_release_metrics.js`, `scripts/github_lifetime_stats.js`, `docs/metrics/`, `docs/js/`, `docs/index.html`, `package.json`, and `README.md`. Current collectors demonstrate append/upsert snapshot history, derived summary generation, validation, and commit-if-changed patterns that could be reused.

## 3. Existing GitHub tracking

The allow-list contains exactly:

| Repository | Current history | Published asset downloads |
| --- | --- | --- |
| [`uxillary/font-size-tweak`](https://github.com/uxillary/font-size-tweak) | 1,312 cumulative downloads in latest published summary dated 2026-09-28; four releases in current history | Yes; current history has Windows `.exe` and `.zip` assets plus checksums |
| [`uxillary/maintenance-goblin`](https://github.com/uxillary/maintenance-goblin) | 14 cumulative downloads in latest published summary dated 2026-09-28; two releases in current history | Yes; Windows `.exe` assets plus checksum |

Values above are read from the repository's generated summary and history, not queried live during this audit. Release-asset counts are cumulative per asset, not unique people or verified installs. GitHub-generated source archives are not uploaded release assets and are not represented by these counts.

## 4. Additional repository candidates

The public [uxillary repository listing](https://github.com/uxillary?tab=repositories) showed 56 repositories at audit time in its profile header, but its rendered list is paginated/stale (last-updated dates shown mostly in 2024–2025) and GitHub's public page omitted stars/forks for many entries. Network restrictions prevented an authenticated owner-wide API inventory. Consequently this is a candidate-screen, not a complete live repository census. Public GitHub pages and repository API metadata should be rechecked before changing the allow-list.

| Repository | What it appears to be | Releases / downloadable assets | Stars / forks visible in audit | Recommendation for release-download tracking |
| --- | --- | --- | --- | --- |
| `uxillary/codex-assist` | Python GUI using OpenAI models | No release/assets verified | Counts not exposed in listing | Not now: no published release evidence; potentially track attention if it becomes a maintained product |
| `uxillary/synthtax` | AI-assisted prompt-to-sound application/site | No release/assets verified | Counts not exposed | Not now: no release evidence; website analytics may be useful only if live and actively promoted |
| `uxillary/reddi` | Reddit interactive pet game for a hackathon | No release/assets verified | Counts not exposed | Not now: web-hosted project; release downloads unlikely to be meaningful |
| `uxillary/mcdungeons-data` | Public data repository for Minecraft Dungeons optimization project; listing showed 2 issues, 0 stars, 0 forks | No releases/assets verified | 0 stars, 0 forks shown | No: useful as content/data, but release downloads do not measure its value |
| `uxillary/greg-ai` | Scottish voice-model/TTS experimentation repository | No release/assets verified | Counts not exposed | No: model experimentation; absent a packaged model/app release, download metrics would not help |
| `uxillary/aspartameawareness` | Astro awareness website | No release/assets verified | Counts not exposed | No release downloads; consider website/Search Console only if still operated and useful to measure |
| `uxillary/font-size-tweak` | Windows font-size utility | Existing tracking | Current repo listing displayed 1 star; forks not visible there | Already tracked; clear fit |
| `uxillary/maintenance-goblin` | Windows PC maintenance app | Existing tracking | Counts not exposed in listing | Already tracked; clear fit |

The remaining visible repositories include practice collections, experiments, forks, templates, or archived material. They were not recommended solely for existing. The only additional candidate class with plausible future value is a maintained, deployed application that starts publishing end-user binaries or packages. No extra repository is recommended for the current release-download allow-list based on verifiable evidence in this audit. Public profile listing: [repositories](https://github.com/uxillary?tab=repositories); examples: [mcdungeons-data](https://github.com/uxillary/mcdungeons-data), [greg-ai](https://github.com/uxillary/greg-ai), [font-size-tweak](https://github.com/uxillary/font-size-tweak).

## 5. GitHub metric/API audit

| Metric | Source and access | History / snapshot need | Use and limits |
| --- | --- | --- | --- |
| Stars | `GET /repos/{owner}/{repo}` returns `stargazers_count`; public repository metadata can be read unauthenticated. Fine-grained token needs Metadata: read. | Current total only; snapshot to derive growth. Public endpoint rate limits are lower unauthenticated; reuse `API_GITHUB` to improve limits if authorized. | Useful approximate attention signal, not unique audience or usage. Stars can be removed and do not identify why someone starred. |
| Forks | Same repository endpoint returns `forks_count`/`forks`; Metadata: read for fine-grained token. | Current total only; snapshot for changes. | Indicates copying/contribution interest, but not necessarily active use; fork counts can change or be deleted. |
| Watchers/subscribers | Repository metadata `subscribers_count`; distinguish from `watchers_count`/`stargazers_count`, which are star counts in current REST response semantics. Read access to metadata. | Current total only; snapshot if retained. | Low-to-medium value; notifications subscriptions are not necessarily project users. Prefer call it “watchers/subscribers,” not “watchers” without definition. |
| Open issues | `GET /repos/{owner}/{repo}` provides `open_issues_count`, which may combine issues and pull requests; alternatively issue-list API. Metadata read for summary count. | Current total only; snapshot. | Useful maintenance/activity context, but issue count is ambiguous and may include PRs. Do not label as user demand without qualification. |
| Release count/latest release/assets | `GET /repos/{owner}/{repo}/releases`; list releases publicly. Fine-grained token: Contents read. API returns publication data and uploaded asset `download_count`. | Release objects persist while available; historical daily download changes do not. Existing snapshots provide long-term counts only from collector start. | Current asset-download collector already captures useful longitudinal data; cadence can detect release cadence/latest release. Release deletions/assets removal alter totals. |
| Repository views and unique visitors | `GET /repos/{owner}/{repo}/traffic/views`. Requires write/push access to repository (fine-grained token docs for traffic specify Administration: read). | Endpoint covers only last 14 days. Must snapshot daily immediately for durable history. | High value: measures people viewing the GitHub repository, not website visitors or product users. Unique counts are estimates and not identities. |
| Clones and unique cloners | `GET /repos/{owner}/{repo}/traffic/clones`. Same access model as traffic views. | Last 14 days; snapshot daily immediately. Clones mean full clones, not fetches. | Useful for code acquisition, but a clone does not prove build/use; automation can contribute. |
| Referring sites | `GET /repos/{owner}/{repo}/traffic/popular/referrers`; top 10 over last 14 days. Requires write access / Administration read. | Rolling 14-day window; snapshot if helpful. | Referrers exclude search engines and GitHub itself; short-lived top-10 list is incomplete and should not be treated as comprehensive attribution. |
| Popular content | `GET /repos/{owner}/{repo}/traffic/popular/paths`; top 10 over last 14 days. Same access. | Rolling 14-day window; snapshot if useful. | Useful for understanding which repository pages get attention, but not all requests/pages and can omit rows. |
| Repository activity/contributors | REST repository statistics endpoints: weekly commit activity (up to last year), contributors, commit counts; public metadata. Statistics may return `202 Accepted` while GitHub computes cache. | Some activity has up to one-year API window; snapshot for longer history. Contributors endpoint gives aggregate contributions, not private emails. | Activity and release cadence are supporting context, not direct discovery. Contributor lists may be noisy for small projects. |
| Account followers/public repos | `GET /users/{username}` yields followers and `public_repos`; public user data accessible without authentication. | Current totals only; snapshot for changes. | Account-wide context, but low project-level diagnostic value; follower changes are not attributable to any project. |

**Token finding:** the current release workflow uses `API_GITHUB` for releases; the lifetime script uses it for public owner repository enumeration and contribution data. No token permission manifest was available in the repository. The fine-grained GitHub docs now specify **Administration: read** for repository traffic endpoints. Verify the actual token type/scope and whether it has write/push access to each tracked repository before depending on it. Public repo metadata and release reads may work with current access, while traffic may return 403. Do not broaden scopes without need.

Traffic data facts are documented in [GitHub repository traffic API](https://docs.github.com/en/rest/metrics/traffic) and [Viewing traffic to a repository](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository). GitHub states traffic includes the past 14 days; views and clones update hourly, referral/path tables daily, and cloning counts exclude fetches. These APIs are rate-limited under standard REST API limits; one daily request per metric per selected repository is modest, but page referrers/paths should not be polled repeatedly. Standard authenticated REST limits are documented [here](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## 6. Website analytics audit

| Source | Metrics and API | Access, cost, retention | Fit and caveats |
| --- | --- | --- | --- |
| Cloudflare Web Analytics | Privacy-focused page views, visits, page paths, referrers, country/browser/device reports; browser beacon is an option. Cloudflare documents Web Analytics as free and privacy-first. Data export/API availability is distinct from merely enabling the dashboard; use GraphQL Analytics only for domains/zones whose traffic is proxied/available in the relevant dataset. | Free product. GraphQL Analytics requires Cloudflare API token/key, preferably a narrowly scoped token. Dataset availability and maximum query window vary by dataset, zone and plan; query `settings`/dataset schema instead of assuming permanent retention. | Good fit for selected custom-domain sites. For Pages sites, verify that each site/domain has Web Analytics enabled and can be associated with the zone; Pages hostname alone is not proof of a zone-scoped GraphQL dataset. Per-site domain/zone reporting is possible when datasets are available. Daily aggregation and snapshots are practical. Avoid enabling scripts until agreed; beacon collection needs site changes and disclosure review. |
| Cloudflare GraphQL Analytics API | Aggregated HTTP request metrics can include request counts, path/host, referrer, country and time dimensions depending on dataset. Not all request metrics equal human page views; filters/bots/cache and dataset definitions matter. | Bearer API token scoped to analytics/read and selected zone/account. GraphQL has documented rate limits (default 300 queries / 5 minutes); retention/query bounds are node/plan-specific and discoverable under settings. Free-tier suitability depends on current Cloudflare account/product and dataset; do not assume every useful dataset is available on Free. | Strong fit when a product site is already on Cloudflare and its applicable analytics dataset is available. Retention is not reliably one universal interval; snapshot daily if long-term history matters. |
| Google Analytics 4 (GA4) | Data API `runReport` can return sessions, views, active users, page paths, source/medium and daily dimensions, subject to configured collection/consent. | Requires a GA property, Google Cloud project with Analytics Data API enabled, OAuth/service account credentials and property access. Standard API quotas apply; no per-call fee for ordinary use, subject to current Google terms/quotas. GA4 retention setting mainly applies to user/event-level explorations; standard aggregated reports have distinct retention. Do not represent that as an archival guarantee. | Viable when GA4 is already installed and owner-controlled. Daily reporting is practical. No GA4 tag or installation was found in inspected dashboard files; this does not prove project sites lack GA4. Need an inventory of sites/properties. Publishing aggregates is safer than event or user-level data. |
| GitHub Pages | GitHub Pages has no built-in site-traffic analytics endpoint documented as part of Pages. GitHub repository traffic API measures repository page traffic, not Pages site traffic. | Can add an external analytics provider or route a custom domain through Cloudflare. Requires provider setup and potentially site instrumentation. | Do not infer website sessions from GitHub repository views. GitHub Pages' default hostname by itself does not supply page-view/referrer histories through the GitHub traffic API. |

Useful official references: [Cloudflare Web Analytics overview](https://developers.cloudflare.com/web-analytics/), [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/), [authentication](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/), [limits and dataset availability](https://developers.cloudflare.com/analytics/graphql-api/limits/), [GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1), [GA4 Data API quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas), and [GA4 data retention](https://support.google.com/analytics/answer/7667196).

## 7. Search Console audit

Google Search Console Search Analytics can return clicks, impressions, CTR and average position, grouped/filtered by date, query, page, country, device and search type. It is specifically Google Search performance, not all web search or site visits. The API is `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`.

| Concern | Finding |
| --- | --- |
| Authentication | OAuth 2.0 is required for private Search Console data; authenticated principal needs access to each verified property. A service account is not automatically an owner: it must be explicitly granted property access. |
| Setup | Enable Search Console API in a Google Cloud project, configure OAuth/service account credential flow, verify each relevant property, grant access, and store credentials as GitHub Actions secrets. The repo owner should choose a maintainable credential lifecycle before automation. |
| Free / quota | API use is free subject to quota. Search Analytics has per-site/per-user/per-project QPS/QPM/QPD plus load quotas. Google specifically advises avoiding repeated expensive wide-range queries; daily one-day queries are the recommended pattern. Up to 50,000 rows per day per search type are exposed, sorted by clicks. |
| Delay/history | Data is typically available after 2–3 days. Search Console UI/API supports a historical range of up to 16 months for Search results performance; only that finite source window can be queried. Daily snapshots should query a delayed completed date and upsert/reconcile a few recent days as data can mature. Long-term retention requires our own snapshots. |
| Aggregation/privacy | Start with date + page or property-level aggregates. Query strings may disclose sensitive user intent and low-volume queries; do not publish raw queries. Consider private storage or suppress/aggregate query terms, especially rare terms. Countries/devices should be broad aggregate dimensions only. Public dashboard can safely show totals and trend percentages after review. |
| Attribution | Search clicks can be compared with site sessions/download totals by time, but the API does not identify which search visitor downloaded a release. Correlation is not person-level attribution. |

Official sources: [API overview](https://developers.google.com/webmaster-tools), [OAuth authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing), [Search Analytics query](https://developers.google.com/webmaster-tools/v1/how-tos/search_analytics), [daily data guidance and row limits](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data), [quotas](https://developers.google.com/webmaster-tools/limits), and [Search Console data retention](https://support.google.com/webmasters/answer/96568).

## 8. Cross-source project identity

A small manifest is justified before adding multiple sources. Keep IDs explicit and stable; do not infer website/property relationships from repository names. Suggested future shape (not implemented):

```json
{
  "projects": [
    {
      "id": "font-size-tweak",
      "name": "Font Size Tweak",
      "github": "uxillary/font-size-tweak",
      "website": "https://uxillary.github.io/font-size-tweak/",
      "cloudflareZoneId": null,
      "cloudflareAnalyticsSite": null,
      "ga4PropertyId": null,
      "searchConsoleProperty": "sc-domain:example.com",
      "releaseDownloads": true
    }
  ]
}
```

Only populate properties that exist and are verified. If a project has multiple sites, use a `websites` array with each provider property on the site object. Keep credential names/references in deployment configuration rather than this public manifest. Join datasets by stable project/site ID and date, retaining source provenance and distinct metric definitions.

## 9. Other useful sources

| Source | Value and recommendation |
| --- | --- |
| GitHub Actions/release cadence | Release dates and repository activity already exist or are public via GitHub APIs. Useful as context for interpreting downloads/attention; no separate usage source needed. Add cadence as derived data only when comparison UI is planned. |
| npm downloads | No owned published npm package was verified in this focused review; `package.json` describes the dashboard's private workflow tooling and its dependencies, not evidence of an owned public package. Do not add npm metrics absent a confirmed owned package users install. |
| Cloudflare deployment events | Could measure deployment health/cadence, but does not answer discovery or adoption. Low priority unless deployments themselves become an operational dashboard goal. |
| App telemetry | No opt-in usage telemetry was found in inspected files. Adding it would create product privacy, consent, and maintenance obligations; do not add merely to count users. |

## 10. START COLLECTING NOW

1. **GitHub traffic daily totals:** views + unique visitors; clones + unique cloners, for the two currently tracked repositories. Endpoints retain only the last 14 days. A later start permanently loses older daily traffic history. Verify token permissions first; if current `API_GITHUB` cannot read traffic, grant only the minimum required repository access or use a dedicated token.
2. **GitHub referrer/path snapshots (optional within same collector):** these are top-10 summaries for the same rolling 14 days, so daily snapshots preserve the opportunity to compare referral/content patterns. Their incompleteness makes them lower priority than totals; store only aggregate values and avoid exposing potentially sensitive paths/referrer strings without review.
3. **Repository stars/forks/subscribers totals:** GitHub exposes current totals, not a historical series. Snapshotting now is required for long-term growth curves; these are lower urgency than the hard 14-day traffic expiration but cheap to collect alongside it.
4. **Any already-enabled website analytics data:** determine immediately which owned properties already collect GA4/Cloudflare data and export/backfill the available source history before it ages out or configuration changes. No reliable site-by-site installation inventory was available in the repository.
5. **Search Console:** no known 14-day cliff; up to 16 months are queryable. Setup/credential preparation can wait until M10, but establish properties and preserve daily snapshots once collection begins to avoid losing data beyond the finite window.

## 11. Current data gaps

| Category | What can be measured | What remains unknown |
| --- | --- | --- |
| A. Direct observations | GitHub repository traffic (after collection), stars/forks, release asset download totals, website analytics sessions/page views, Search Console impressions/clicks, YouTube channel totals. | A release download count is not an install count or unique-person count. GitHub clone count is not application use. Analytics definitions vary by provider. |
| B. Approximate correlation | Compare date-aligned project search clicks, site sessions, GitHub views/stars and release-download deltas; compare release-date changes with subsequent discovery/download trends. | These can show that metrics moved together, but cannot reliably identify a path or causal lift. Cross-source attribution is approximate unless explicitly instrumented with consented links/campaign parameters and compatible analytics. |
| C. Unsupported attribution | “This Google query/user/referrer caused this download” or “this many people installed/used the app.” | No existing collector ties an identified website session to a GitHub asset download; GitHub download counters provide aggregate counts only. Do not make such claims. |

The dashboard currently cannot answer whether people saw a project in Google, visited a project website, viewed/cloned its GitHub repository, or whether discovery coincided with rising downloads. It can already answer uploaded GitHub release asset download totals/history and YouTube channel growth.

## 12. Recommended M08–M12 roadmap

### M08 — Discovery collector foundation

**Why now:** GitHub traffic expires after 14 days; establish durable history before building more UI.  
**Data:** per-project daily GitHub views/uniques, clones/unique cloners, stars/forks/subscribers, release metadata; optionally retain top-10 referrer/path summaries privately or after aggregation.  
**Manual setup:** check `API_GITHUB` token type and repository access; grant traffic read access or create a narrowly scoped replacement. Confirm exactly which products qualify in the project manifest.  
**Implementation scope:** add an internal project identity manifest and daily snapshot collector, history JSON/CSV and summary contract following release collector patterns. Validate data and commit only changed outputs. No UI requirement for first collector release.

### M09 — Website traffic for selected projects

**Why next:** answers whether users reach owned project sites.  
**Data:** sessions/visits, page views, landing/top pages, referrer categories and daily trends from already-installed GA4 or Cloudflare analytics. Start with 1–3 verified product sites.  
**Manual setup:** inventory domains/hosting and existing GA4; enable Cloudflare Web Analytics or choose GA4; provide site/property IDs and credential. Review whether adding a beacon/disclosure is needed.  
**Implementation scope:** one provider adapter initially, normalized daily aggregate snapshots, provider/source labels. Publish aggregate-only project totals.

### M10 — Google Search Console

**Why next:** directly measures Google search discovery and ties data to verified pages.  
**Data:** date/page or property clicks, impressions, CTR and position; add country/device only if useful. Keep query terms private by default.  
**Manual setup:** verify Search Console properties, enable API, establish OAuth or service-account access, add credentials as Actions secrets.  
**Implementation scope:** query completed dates with a 2–3 day delay; re-query a short recent correction window; preserve source aggregates and avoid publishing raw queries.

### M11 — Project performance comparison

**Why next:** after enough concurrent history exists, answer which projects are gaining traction and whether discovery coincides with downloads.  
**Data:** common project/date series for GitHub attention, website sessions, Search Console clicks/impressions and GitHub release downloads.  
**Manual setup:** confirm site/property mappings and which projects should be publicly compared.  
**Implementation scope:** derived comparisons, explicit coverage/missing-data states, metric definitions and non-causal language. No inferred user journey claims.

### M12 — Evidence-based automated insights

**Why later:** insights require stable, comparable series and enough baseline history; automated prose before that risks inventing explanations.  
**Data:** robust week-over-week/month-over-month changes, release-window comparisons, confidence/coverage context and notable milestones.  
**Manual setup:** choose which summary categories are useful and approve public privacy thresholds.  
**Implementation scope:** deterministic, explainable observations first; state evidence and uncertainty, distinguish correlation from attribution, and suppress low-volume sensitive dimensions.

## 13. Manual owner actions

### Required now for M08 readiness

- Confirm `API_GITHUB` is authorized for each currently tracked repository and whether its token type can use GitHub traffic endpoints. Existing secret value must not be exposed or printed.
- Decide whether to start GitHub traffic snapshots for both already tracked repositories (recommended). If access fails, create a minimal-scope token and replace/add a GitHub Actions secret.
- Identify current owned product websites and whether any already use Cloudflare Web Analytics or GA4; the dashboard repository alone cannot establish site installations.

### Required only when that milestone begins

- **M09:** choose Cloudflare or existing GA4 per site; provide zone/site or GA4 property IDs; enable access and add narrowly scoped credential secrets; install/configure analytics where absent and review required notice/consent.
- **M10:** verify each Search Console property, enable the API in a Google Cloud project, grant a service identity/OAuth principal property access, configure token refresh/credentials as repository secrets, and decide query-data privacy policy.
- **M11–M12:** approve project/site mappings, comparison definitions, publication thresholds, and wording policy for correlation and uncertainty.

No credential values are requested or included here.

## 14. Security and privacy

- GitHub Pages and generated JSON are public. Never publish GitHub/Cloudflare/Google credentials, OAuth refresh tokens, raw private API payloads, email/user identifiers, or analytics event-level records.
- Publish only aggregate date/project metrics. Keep raw Search Console queries and detailed referrer/path strings private until reviewed; low-volume query terms may reveal sensitive intent, and URLs/referrers can contain query parameters or identifying information.
- Use GitHub Actions secrets and minimum necessary permissions. Prefer short-lived/narrowly scoped credentials where supported; never put credentials into checked-in config, browser JavaScript, generated summaries, logs, or workflow artifacts.
- GitHub traffic itself is aggregate and limited-window; do not retain user-level identifiers because endpoints do not provide them.
- Document definitions and time zone (UTC) for each source; “views,” “visitors,” “sessions,” “clicks,” and “downloads” are not interchangeable.

## 15. Open questions / assumptions

1. What is the actual token type and permission set of `API_GITHUB`, and does it cover repository traffic for both current repositories?
2. Which of the 56 public repositories are actively owned products rather than experiments, forks, archives, or data sources? A complete current API inventory and release/star/fork audit was not possible through available access; the public profile page is stale/incomplete.
3. Which product websites are active, and which use custom domains, GitHub Pages, Cloudflare Pages, Cloudflare proxying, GA4, or another analytics service?
4. Does the owner want website/Search Console aggregates on the public dashboard, or should they remain private until reviewed?
5. Which Search Console sites are verified and who can grant programmatic access?
6. Are all current GitHub Pages outputs intended to be public? This audit assumes yes, per request.

## 16. Sources

All API facts below were checked against official documentation on 2026-09-29; provider retention and limits can vary by endpoint, dataset, account plan and change over time.

- GitHub: [Traffic REST endpoints and 14-day windows](https://docs.github.com/en/rest/metrics/traffic); [traffic graph access and update behavior](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository); [repository metadata API](https://docs.github.com/en/rest/repos/repos); [star/watch count semantics](https://docs.github.com/en/rest/activity/starring); [release API and asset download counts](https://docs.github.com/en/rest/releases/releases); [repository statistics endpoints](https://docs.github.com/en/rest/metrics); [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- Cloudflare: [Web Analytics](https://developers.cloudflare.com/web-analytics/); [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/); [authentication](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/); [dataset and query limits](https://developers.cloudflare.com/analytics/graphql-api/limits/); [HTTP request analytics fields](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-firewall-events/).
- Google: [Search Console API](https://developers.google.com/webmaster-tools); [OAuth authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing); [Search Analytics query](https://developers.google.com/webmaster-tools/v1/how-tos/search_analytics); [daily collection guidance/row limits](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data); [quotas](https://developers.google.com/webmaster-tools/limits); [Search Console performance retention](https://support.google.com/webmasters/answer/96568); [GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1); [GA4 API quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas); [GA4 retention settings](https://support.google.com/analytics/answer/7667196).
- Account/repository discovery: [uxillary public repository listing](https://github.com/uxillary?tab=repositories); [mcdungeons-data](https://github.com/uxillary/mcdungeons-data); [greg-ai](https://github.com/uxillary/greg-ai).
