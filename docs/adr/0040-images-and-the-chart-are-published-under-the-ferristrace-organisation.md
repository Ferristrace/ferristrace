# 0040. Images and the chart are published under the Ferristrace organisation

Status: accepted
Date: 2026-11-27

## Context
ADR 0014 and ADR 0025 named the images `ghcr.io/ferrislabs/ferristrace`, `ferristrace-mcp` and `ferristrace-mcp-gateway`, and the chart `oci://ghcr.io/ferrislabs/charts/ferristrace`, because the repository lived in the `ferrislabs` organisation. The repository has since moved to the `Ferristrace` organisation. A workflow's `GITHUB_TOKEN` can only write packages of the organisation that owns the repository, so the first tag after the move, `v0.0.9`, built every image and could push none: `denied: permission_denied: The requested installation does not exist`. Nothing was published.

## Decision
Every artefact a tag publishes lives under the organisation that owns the repository: the three images under `ghcr.io/ferristrace/`, the chart at `oci://ghcr.io/ferristrace/charts/ferristrace`. The workflows keep using `GITHUB_TOKEN`; no long-lived token enters the repository. The chart's default `image.repository` values, the compose guide, the runbook and the cosign identity (`github.com/Ferristrace/ferristrace`, anchored to `@refs/tags/v`) follow. The images already published under `ghcr.io/ferrislabs/` stay where they are, as ADR 0014 says a published tag is permanent; nothing new lands there.

## Alternatives rejected
- A personal access token with `write:packages` on `ferrislabs`, kept as a repository secret: it unblocks the release without touching an operator, at the price of a long-lived credential that nothing rotates, in a repository whose supply chain otherwise rests on short-lived OIDC identities.
- Moving the repository back under `ferrislabs`: the move was deliberate.

## Consequences
- Gains: a tag publishes again with the token GitHub Actions already gives it; the artefacts and the source share one owner, so the cosign identity in the guide is the one the certificate carries.
- Costs: an operator who pulls `ghcr.io/ferrislabs/ferristrace` or installs the chart from `ghcr.io/ferrislabs/charts` stops receiving releases and has to change one line. The hosted deployment (`ferrislabs/infra`) names the new locations in its own change. The packages are created on the first push and must be made public once in the organisation's package settings.
- What becomes harder: nothing new.
