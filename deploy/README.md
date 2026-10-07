# ARC worker: deploy guide

The ARC worker is the cloud half of AIVEN ARC. It is a small web server in a Docker image. When you start a
cloud session in the app, the worker clones your GitHub repository, makes a branch called `arc/<name>-<4 hex>`,
and runs the same agent as the desktop app on that clone (same tools, same safety rules, same Spark and
Autopilot). It keeps working when your laptop sleeps or the app is closed. When you reopen ARC the session is
still there.

You run the worker yourself. Nothing is hosted by us. Google Cloud Run is the default, but any host that runs
Docker works.

## How far to trust it

Plain words:

- The worker is **single-tenant**: it is one person's machine. Everything on it belongs to you. The container
  is the boundary, not a separate user per session.
- It holds three secrets: the **worker token** (lets the app talk to the worker), your **GitHub token** and your
  **Vertex API key**. The app sends the last two to the worker for each session, over HTTPS (the app refuses
  plain `http://` except for localhost). The worker keeps them **in memory only**. They are never written to
  disk, never put in the agent's environment, and never appear in logs, events or the audit trail.
- The agent's shell cannot see these secrets: its environment is scrubbed and nothing is on disk. But code that
  runs inside the same container as the same user is not hardened against reading process memory. So treat the
  container as "everything the agent runs can in principle reach the secrets of the sessions on it".
- Because of that, limit the damage up front: use a **fine-grained GitHub token for only the repositories you
  chose**, run the Cloud Run service account with **zero roles**, and keep `ARC_MAX_SESSIONS` small. The agent
  can only ever push to branches that start with `arc/`, never with force, never to your main branch.
- Anyone who has the worker URL **and** the worker token can start sessions that spend your Vertex quota and
  push `arc/` branches with your GitHub token. Keep the token private. The worker refuses to start with a token
  shorter than 32 characters, compares it in constant time, and rate limits failed attempts.

## Deploy on Google Cloud Run

You need the `gcloud` CLI, signed in (`gcloud auth login`), and a project with billing enabled.

```bash
deploy/cloud-run.sh <PROJECT_ID> <REGION>
# example: deploy/cloud-run.sh my-project-123 europe-west4
```

The script:

1. turns on the Cloud Run, Cloud Build, Secret Manager and Artifact Registry APIs;
2. creates a service account `arc-worker` with **no roles**;
3. creates a random worker token, stores it in Secret Manager as `arc-cloud-token` (only the first time; it is
   never printed) and lets that one service account read that one secret;
4. builds the image from the `Dockerfile` and deploys the service `arc-worker` with `--max-instances=1
   --min-instances=1 --no-cpu-throttling --timeout=3600 --memory=2Gi --cpu=2`;
5. prints the service URL and the command to read the token.

Why those settings: sessions live in memory, so there must be exactly one instance and it must stay on; the
agent keeps working between requests, so the CPU must not be throttled; event streams can last up to an hour
(the app reconnects on its own after that).

Why `--allow-unauthenticated`: Cloud Run's own login check cannot be satisfied by the ARC app. The gate is the
worker's bearer token. If you want Google's check as well, deploy with `--no-allow-unauthenticated` and reach
the worker through `gcloud run services proxy arc-worker --region <REGION>` on your Mac (the app accepts
`http://localhost:...`), or grant `roles/run.invoker` to specific people and use your own authenticating proxy.

Read the worker token whenever you need it:

```bash
gcloud secrets versions access latest --secret=arc-cloud-token --project <PROJECT_ID>
```

Cloud Run keeps `/data` in memory, so it counts against the 2 GiB and is empty after every restart. That is
fine: sessions do not survive a restart anyway (see below). Big repositories need a larger `--memory`.

## Run it anywhere else (any Docker host)

```bash
docker build -t arc-worker .

# one random token, kept in a file only you can read
( umask 077; openssl rand -hex 32 > arc-worker.token )

docker run -d --name arc-worker --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v arc-data:/data \
  -e ARC_CLOUD_TOKEN="$(cat arc-worker.token)" \
  arc-worker
```

(`docker inspect` shows environment variables to anyone who can use Docker on that host. On a shared host use
Docker secrets or an env file with mode 600 instead.)

The worker speaks plain HTTP. **Put TLS in front of it** and publish only the TLS port: the app will not send
your GitHub token and Vertex key over `http://` to anything but localhost. The simplest option is Caddy, which
gets a certificate for you:

```
arc.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Notes for any reverse proxy:

- Turn off response buffering and allow long reads for `/v1/sessions/*/events` (nginx: `proxy_buffering off;
  proxy_read_timeout 3600s;`). The stream sends a `: ping` comment every 15 seconds.
- Add `-e ARC_TRUST_PROXY=1` so failed-login rate limiting counts the real client address from
  `X-Forwarded-For` instead of treating everyone behind the proxy as one address. Only set it when a proxy you
  control is really in front, otherwise a caller could fake that header.

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARC_CLOUD_TOKEN` | required | The worker token, at least 32 characters. Removed from the environment after start. |
| `PORT` | `8080` | Port to listen on. |
| `ARC_DATA_DIR` | `/data` | Where clones and session files go. |
| `ARC_MAX_SESSIONS` | `4` | Sessions at the same time. |
| `ARC_IDLE_HOURS` | `24` | A session that is not busy and untouched for this long is ended and its files deleted. |
| `ARC_GITHUB_HOSTS` | `github.com` | Comma list of hosts a repository may be on (GitHub Enterprise). |
| `ARC_GITHUB_API` | `https://api.github.com` | API address; for Enterprise use `https://<host>/api/v3`. |
| `ARC_TRUST_PROXY` | off | `1` when a reverse proxy is in front (see above). |

## Create the GitHub token

Use a **fine-grained personal access token**, not a classic one.

1. GitHub > your avatar > Settings > Developer settings > Personal access tokens > Fine-grained tokens >
   Generate new token.
2. Resource owner: you, or the organization that owns the repository (organizations may need to approve it).
3. Expiration: pick a date you will remember. A short one is safer.
4. Repository access: **Only select repositories**, and tick just the repositories you want ARC to work on.
5. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**. (Metadata: Read is
   added automatically.) Leave everything else on "No access".
6. Generate, and copy the token. GitHub shows it once.

A token that cannot push to the chosen repository makes "Start cloud session" stop with a plain message before
anything is cloned.

## Connect the app

In ARC: Settings > Cloud.

1. **Worker URL**: the Cloud Run URL the script printed (for example `https://arc-worker-abc123-ew.a.run.app`),
   or your own `https://` address.
2. **Worker token**: the output of the `gcloud secrets versions access ...` command, or the contents of
   `arc-worker.token`.
3. **GitHub token**: the token from the step above.
4. Press **Test**. It checks the worker, the token and GitHub, one line each.
5. Sidebar > Cloud > **New cloud session**: type `owner/name` (or a GitHub link), optionally a base branch and a
   short name, and start.

The two tokens are stored on your Mac in the same encrypted store as your Vertex key, never in `settings.json`.

## What happens when the worker restarts

Sessions live in the worker's memory and on its disk. A restart (a new deploy, a crash, Cloud Run maintenance,
`docker restart`) **ends every session**. When you next open ARC it says so: "The cloud session ended because the
worker restarted. Your pushed branch is safe on GitHub." Everything that was pushed is on GitHub. With auto-push
on (the default) that is every finished turn; what you can lose is a turn that was in progress, or all
unpushed work if you turned auto-push off. On start the worker deletes the clones left over from the previous
run. A graceful stop (`SIGTERM`, which Cloud Run and Docker send) stops running turns and lets a push that is
already queued finish for a few seconds.

## Costs: read this

`--min-instances=1` with CPU always allocated means **Cloud Run bills this service every hour of every day**,
whether or not you are using it. At 2 vCPU and 2 GiB that is a real monthly amount: check the current Cloud Run
pricing for your region and set a budget alert in Google Cloud Billing. Cloud Build and Artifact Registry
storage add small amounts, and every request the agent makes to Vertex is billed as usual. When you stop using
the worker, delete it:

```bash
gcloud run services delete arc-worker --project <PROJECT_ID> --region <REGION>
```

## Troubleshooting

- **The app says the worker is unreachable.** Open `<worker URL>/health` in a browser: it must show
  `{"ok":true}`. Check the URL is `https://` and has no trailing path.
- **401 Unauthorized.** The worker token in ARC does not match. Copy it again without spaces or a line break.
  Rotating the token: add a new secret version (`gcloud secrets versions add arc-cloud-token --data-file=-`),
  then redeploy so the new value is picked up.
- **429 Too many failed attempts.** Ten wrong tokens in a minute from one address blocks that address for a
  minute. Fix the token and wait. On Cloud Run the script sets `ARC_TRUST_PROXY=1` so this is counted per real
  client; on your own proxy set it yourself.
- **"Your GitHub token cannot push to owner/name".** The token is missing Contents: Read and write on that
  repository, was not given that repository, expired, or the organization has not approved it yet.
- **429 "already runs 4 sessions".** End one from the Cloud list in the sidebar, or raise `ARC_MAX_SESSIONS`.
- **The session disappeared.** It was idle for `ARC_IDLE_HOURS`, or the worker restarted (see above).
- **Event stream drops about every hour.** Expected on Cloud Run (`--timeout=3600`). The app reconnects and
  replays what it missed. If the worker held fewer events than it missed (more than 10 000 or 8 MB) the app
  reloads the conversation instead.
- **`gcloud run deploy --source` fails with a permission error.** Newer projects need the default Cloud Build
  and compute service accounts to have the build roles. Run it once from the console (Cloud Run > Deploy from
  source) and follow its "grant permissions" prompt, then run the script again.
- **`--allow-unauthenticated` is refused.** An organization policy forbids public services. Ask the
  administrator for an exception, or use the `gcloud run services proxy` route described above.
- **GitHub Enterprise.** Set `ARC_GITHUB_HOSTS=<host>` and `ARC_GITHUB_API=https://<host>/api/v3`. On Cloud Run
  add them with `gcloud run services update arc-worker --set-env-vars ARC_GITHUB_HOSTS=...,ARC_GITHUB_API=...`.
- **Logs.** `gcloud run services logs read arc-worker --region <REGION>`, or `docker logs arc-worker`.
  They hold start-up lines and redacted internal errors, never the tokens, prompts or code.

## First deploy checklist (cannot be verified from a Linux dev box)

- [ ] `deploy/cloud-run.sh` completes and prints a URL; `<URL>/health` shows `{"ok":true}`.
- [ ] ARC > Settings > Cloud > Test shows three green lines.
- [ ] Start a session on a throw-away repository; a turn finishes and "Saved to GitHub" appears.
- [ ] The `arc/` branch exists on GitHub; Open pull request creates a PR.
- [ ] Close ARC, reopen: the session is listed and the transcript comes back.
- [ ] `gcloud run services update arc-worker --update-env-vars X=1` (a restart): the app reports that the
      session ended and the branch is intact.
