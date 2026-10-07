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
# If you prefer Google's check in front as well, deploy with --no-allow-unauthenticated and reach
# the worker through an authenticating proxy (for example `gcloud run services proxy`), then point
# ARC at the proxy's local address. Granting roles/run.invoker to named people is the IAM alternative.
#
# Sessions live in memory, so the service must stay on one always-on instance (max 1, min 1,
# CPU always allocated). That keeps billing: see deploy/README.md.
set -euo pipefail

SERVICE="arc-worker"
SERVICE_ACCOUNT_NAME="arc-worker"
SECRET_NAME="arc-cloud-token"
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

  echo "==> Deploying $SERVICE to $region (this builds the image, a few minutes)"
  (
    cd "$root"
    gcloud run deploy "$SERVICE" \
      --source . \
      --project "$project" \
      --region "$region" \
      --service-account "$sa_email" \
      --set-secrets "ARC_CLOUD_TOKEN=${SECRET_NAME}:latest" \
      --set-env-vars "ARC_TRUST_PROXY=1" \
      --max-instances=1 \
      --min-instances=1 \
      --no-cpu-throttling \
      --timeout=3600 \
      --memory=2Gi \
      --cpu=2 \
      --allow-unauthenticated
  )

  local url
  url="$(gcloud run services describe "$SERVICE" --project "$project" --region "$region" --format 'value(status.url)')"
  echo
  echo "Worker URL:  $url"
  echo "Worker token (paste into ARC > Settings > Cloud), read it with:"
  echo "  gcloud secrets versions access latest --secret=${SECRET_NAME} --project ${project}"
  echo
  echo "Reminder: min-instances=1 keeps this service billing around the clock. When you stop using it, delete the service:"
  echo "  gcloud run services delete ${SERVICE} --project ${project} --region ${region}"
}

# Only run when executed, so sourcing the file (to test the helpers) does nothing.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
