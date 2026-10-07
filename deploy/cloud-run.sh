#!/usr/bin/env bash
# Deploy the ARC worker to Google Cloud Run.
#
#   deploy/cloud-run.sh <PROJECT_ID> <REGION>
#   PROJECT_ID=my-project REGION=europe-west4 deploy/cloud-run.sh
#
# Safe to run again: it reuses the service account and the token, and redeploys the service.
# It creates:
#   - a service account "arc-worker" with NO roles (it only gets to read its one secret),
#   - a secret "arc-cloud-token" holding a random worker token (created once, never printed),
#   - the Cloud Run service "arc-worker" built from the Dockerfile in this repository.
#
# The service is deployed with --allow-unauthenticated on purpose. Cloud Run's own IAM check would
# stop the ARC app, which cannot sign Google ID tokens; the gate is the worker's bearer token
# (at least 32 random characters, compared in constant time, failed attempts rate limited).
# ARC_REQUIRE_IAM=1 omits --allow-unauthenticated so Cloud Run's IAM check is in front. ARC does NOT
# support that yet (it cannot send a Google identity token), so the app will get 401/403 from Google
# until you put an authenticating proxy in between, e.g. `gcloud run services proxy`.
#
# The worker token is mounted as a FILE (/secrets/arc-token) and read from ARC_CLOUD_TOKEN_FILE, not
# passed as an environment variable: a file is not visible in /proc/<pid>/environ.
#
# Overridable: MEMORY (default 4Gi) and CPU (default 2). /data is memory-backed on Cloud Run, so repo
# size and npm installs count against MEMORY. For big repositories raise it (up to 32Gi) or use a VM.
#
# Sessions live in memory, so the service must stay on one always-on instance (max 1, min 1,
# CPU always allocated). That keeps billing: see deploy/README.md.
set -euo pipefail

SERVICE="arc-worker"
SERVICE_ACCOUNT_NAME="arc-worker"
SECRET_NAME="arc-cloud-token"
# One secret, one mount directory: Cloud Run does not allow two secrets to share a directory.
TOKEN_MOUNT="/secrets/arc-token"
APIS="run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com"

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: deploy/cloud-run.sh <PROJECT_ID> <REGION>
   or: PROJECT_ID=... REGION=... deploy/cloud-run.sh
example: deploy/cloud-run.sh my-project-123 europe-west4
USAGE
}

# Google project ids: 6 to 30 characters, lowercase letters, digits and hyphens, starting with a letter.
valid_project_id() { [[ "$1" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; }
# Regions look like europe-west4 or us-central1.
valid_region() { [[ "$1" =~ ^[a-z]+-[a-z]+[0-9]+$ ]]; }

main() {
  local project="${1:-${PROJECT_ID:-}}"
  local region="${2:-${REGION:-}}"
  if [[ -z "$project" || -z "$region" ]]; then
    usage
    die "PROJECT_ID and REGION are required"
  fi
  valid_project_id "$project" || die "PROJECT_ID '$project' does not look like a Google Cloud project id"
  valid_region "$region" || die "REGION '$region' does not look like a Cloud Run region (for example europe-west4)"
  command -v gcloud >/dev/null 2>&1 || die "gcloud is not installed or not on PATH"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate the worker token"

  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  [[ -f "$root/Dockerfile" ]] || die "no Dockerfile in $root"
  local sa_email="${SERVICE_ACCOUNT_NAME}@${project}.iam.gserviceaccount.com"

  echo "==> Enabling APIs in $project"
  # shellcheck disable=SC2086
  gcloud services enable $APIS --project "$project"

  echo "==> Service account $sa_email (no roles)"
  if ! gcloud iam service-accounts describe "$sa_email" --project "$project" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
      --display-name "ARC worker (no roles)" --project "$project"
  fi

  echo "==> Secret $SECRET_NAME"
  if ! gcloud secrets describe "$SECRET_NAME" --project "$project" >/dev/null 2>&1; then
    # Straight from openssl into Secret Manager: the token is never in a variable, an argument or the terminal.
    openssl rand -hex 32 | gcloud secrets create "$SECRET_NAME" \
      --data-file=- --replication-policy=automatic --project "$project"
  else
    echo "    already exists, keeping it"
  fi
  # Access to this one secret only. The service account still holds no project roles.
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member "serviceAccount:${sa_email}" --role roles/secretmanager.secretAccessor \
    --project "$project" >/dev/null

  local memory="${MEMORY:-4Gi}" cpu="${CPU:-2}"
  [[ "$memory" =~ ^[0-9]+(Mi|Gi)$ ]] || die "MEMORY '$memory' must look like 4Gi or 8192Mi"
  [[ "$cpu" =~ ^[0-9]+$ ]] || die "CPU '$cpu' must be a whole number"
  local auth_flag=(--allow-unauthenticated)
  if [[ "${ARC_REQUIRE_IAM:-}" == "1" ]]; then
    auth_flag=()
    echo "==> ARC_REQUIRE_IAM=1: deploying WITHOUT --allow-unauthenticated."
    echo "    Caveat: ARC cannot send a Google identity token yet, so the app cannot reach this service directly."
    echo "    Use an authenticating proxy (gcloud run services proxy ${SERVICE} --region ${region}) and point ARC at it."
  fi

  echo "==> Deploying $SERVICE to $region (this builds the image, a few minutes)"
  (
    cd "$root"
    gcloud run deploy "$SERVICE" \
      --source . \
      --project "$project" \
      --region "$region" \
      --service-account "$sa_email" \
      --set-secrets "${TOKEN_MOUNT}=${SECRET_NAME}:latest" \
      --set-env-vars "ARC_TRUST_PROXY=1,ARC_CLOUD_TOKEN_FILE=${TOKEN_MOUNT}" \
      --max-instances=1 \
      --min-instances=1 \
      --no-cpu-throttling \
      --timeout=3600 \
      --memory="$memory" \
      --cpu="$cpu" \
      ${auth_flag[@]+"${auth_flag[@]}"} \
      --quiet
  )

  # An older deploy of this script passed the token as the env var ARC_CLOUD_TOKEN. The file wins, but remove the old one.
  if gcloud run services describe "$SERVICE" --project "$project" --region "$region" --format 'value(spec.template.spec.containers[0].env)' 2>/dev/null | grep -q "'name': 'ARC_CLOUD_TOKEN'"; then
    echo "==> Removing the old ARC_CLOUD_TOKEN environment secret (the token is now a mounted file)"
    gcloud run services update "$SERVICE" --project "$project" --region "$region" --remove-secrets ARC_CLOUD_TOKEN --quiet
  fi

  local url
  url="$(gcloud run services describe "$SERVICE" --project "$project" --region "$region" --format 'value(status.url)')"
  echo
  echo "Worker URL:  $url"
  echo "Worker token (paste into ARC > Settings > Cloud), read it with:"
  echo "  gcloud secrets versions access latest --secret=${SECRET_NAME} --project ${project}"
  echo
  echo "Memory is ${memory}: /data lives in memory, so big repos or npm installs need more (MEMORY=8Gi deploy/cloud-run.sh ...)."
  echo "Reminder: min-instances=1 keeps this service billing around the clock. When you stop using it, delete the service:"
  echo "  gcloud run services delete ${SERVICE} --project ${project} --region ${region}"
}

# Only run when executed, so sourcing the file (to test the helpers) does nothing.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
