# ARC worker: deploy guide

```bash
deploy/cloud-run.sh <PROJECT_ID> <REGION>                                  # 1. deploy (a few minutes)
gcloud secrets versions access latest --secret=arc-cloud-token --project <PROJECT_ID>   # 2. print the token
# 3. ARC > Settings > Cloud: paste the Worker URL the script printed, and that token
```

Needs the `gcloud` CLI, signed in (`gcloud auth login`), and a project with billing. The first deploy may ask to
create an Artifact Registry repository; the script passes `--quiet` so it says yes for you. Run the three lines,
then create a GitHub token (see "Create the GitHub token") and paste it in the same ARC pane.

---

The ARC worker is the cloud half of AIVEN ARC: a small web server in a Docker image. When you start a cloud
session, it clones your GitHub repository, makes a branch called `arc/<name>-<4 hex>`, and runs the same agent
as the desktop app on that clone (same tools, same safety rules). It keeps working when your laptop sleeps.
You run it yourself; nothing is hosted by us.

## What runs where

- **Your Mac (ARC app):** the interface, your settings, and your three secrets in an encrypted store: worker
  token, GitHub token, Vertex API key.
- **The worker (Cloud Run or any Docker host):** the agent, the clone of your repository, the shell the agent
  uses, and the session transcript. It calls Vertex AI and GitHub from there.
- **GitHub:** the `arc/` branches the agent pushes, and pull requests you open from ARC.
- **Secret Manager (Cloud Run only):** the worker token, mounted into the container as a file.

## Trust model, in plain words

- The worker is **single-tenant**: it is one person's machine. The container is the boundary, not a separate
  user per session.
- Your **GitHub token** and **Vertex key** are sent by the app for each session, over HTTPS (the app refuses
  `http://` except for localhost). The worker keeps them in memory only: never on disk, never in the agent's
  environment, never in logs or events.
- The agent's shell cannot see them (its environment is scrubbed), but code running in the same container as the
  same user is not hardened against reading process memory. Assume everything the agent runs could in principle
  reach the secrets of the sessions on that container.
- So limit the damage up front: a **fine-grained GitHub token for only the repositories you chose**, a Cloud Run
  service account with **zero roles**, a small `ARC_MAX_SESSIONS`. The agent only pushes branches starting with
  `arc/`, never with force, never to your main branch.
- Anyone with the worker URL **and** token can start sessions that spend your Vertex quota and push `arc/`
  branches with the GitHub token you give the app. Keep the token private. The worker refuses a token shorter
  than 32 characters, compares in constant time, and rate limits failed attempts.
- **Where the worker token lives.** On Cloud Run the script mounts it as a file (`/secrets/arc-token`) and sets
  `ARC_CLOUD_TOKEN_FILE`. A file does not show up in `/proc/<pid>/environ`. With plain Docker you can use the
  same variable with a file you mount (recommended). `ARC_CLOUD_TOKEN` as an environment variable still works,
  but is the **weaker** option: the worker removes it from its own environment after start, but `/proc/<pid>/environ`
  keeps the original value for the life of the process, and `docker inspect` shows it. If both are set, the file wins.

## Deploy on Google Cloud Run

`deploy/cloud-run.sh <PROJECT_ID> <REGION>` (safe to run again). It:

1. turns on the Cloud Run, Cloud Build, Secret Manager and Artifact Registry APIs;
2. creates a service account `arc-worker` with **no roles**;
3. creates a random token in Secret Manager as `arc-cloud-token` (first time only, never printed) and lets that
   one service account read that one secret;
4. builds the image and deploys `arc-worker` with `--max-instances=1 --min-instances=1 --no-cpu-throttling
   --timeout=3600 --memory=4Gi --cpu=2`, the secret mounted at `/secrets/arc-token`;
5. prints the service URL and the command to read the token.

Why: sessions live in memory, so exactly one instance that stays on; the agent works between requests, so no CPU
throttling; event streams last up to an hour (the app reconnects).

**Memory.** Cloud Run's `/data` is memory-backed, so the cloned repository, `node_modules` and anything the agent
installs all count against `--memory`. 4 GiB suits small and medium repositories. For a big repository or heavy
npm/pip installs, raise it (`MEMORY=8Gi deploy/cloud-run.sh ...`, `CPU=4` likewise) or use a VM with a disk
(see "Docker on any host"). If a session dies with out-of-memory, this is why.

**Public URL and IAM.** The service is deployed with `--allow-unauthenticated` because Cloud Run's own IAM check
cannot be satisfied by ARC (it cannot sign a Google identity token yet). The gate is the worker token.
`ARC_REQUIRE_IAM=1 deploy/cloud-run.sh ...` omits that flag so Google's check is in front too, but then the app
cannot connect directly: you must use an authenticating proxy such as `gcloud run services proxy arc-worker
--region <REGION>` and give ARC the `http://localhost:...` address. Not supported by ARC itself.

## Update the worker

Run `deploy/cloud-run.sh <PROJECT_ID> <REGION>` again after pulling a new version of this repository. It builds a
new image and swaps it in. **Redeploying restarts the worker and ends every live session.** Push first: wait for
"Saved to GitHub" on running sessions (or push by hand) before you deploy. Pushed branches are safe.

## Rotate or revoke the worker token

```bash
openssl rand -hex 32 | gcloud secrets versions add arc-cloud-token --data-file=- --project <PROJECT_ID>
deploy/cloud-run.sh <PROJECT_ID> <REGION>     # redeploy so the new version is mounted
```

Then paste the new token in ARC > Settings > Cloud. Optionally disable the old version:
`gcloud secrets versions disable <N> --secret=arc-cloud-token`.

What this **does**: after the redeploy the old worker token stops working; anyone holding only the old token
and the URL is locked out. The redeploy also ends live sessions.

What it does **not** do: it does not revoke your **GitHub token** or **Vertex key**, which the app sends per
session and the worker only holds in memory. If you think those leaked, revoke the GitHub token at
github.com > Settings > Developer settings > Personal access tokens, and rotate the Vertex key in Google Cloud.
Until you redeploy, the old token still works (the mounted file is read once at start). To cut access at once,
delete the service (see Costs).

## Costs

`--min-instances=1` with always-on CPU means Cloud Run bills this service every hour of every day, used or not.
At 2 vCPU and 4 GiB that is a real monthly amount: check Cloud Run pricing for your region and set a budget
alert in Google Cloud Billing. Cloud Build and Artifact Registry add small amounts; Vertex calls are billed as
usual. When you stop using it:

```bash
gcloud run services delete arc-worker --project <PROJECT_ID> --region <REGION>
```

## Docker on any host

```bash
docker build -t arc-worker .
( umask 077; openssl rand -hex 32 > arc-worker.token )      # readable by you only

docker run -d --name arc-worker --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v arc-data:/data \
  -v "$PWD/arc-worker.token:/run/secrets/arc-token:ro" \
  -e ARC_CLOUD_TOKEN_FILE=/run/secrets/arc-token \
  arc-worker
```

The container user is uid 10001, so make the token file readable by it (`chown 10001 arc-worker.token`, or
`chmod 644` on a host only you use). Plain `-e ARC_CLOUD_TOKEN="$(cat arc-worker.token)"` also works but is the
weaker option (see the trust model). The image already runs `tini` as init.

`-v arc-data:/data` is a volume on disk, so unlike Cloud Run repository size is limited by disk, not memory.
Sessions still do not survive a restart.

**TLS.** The worker speaks plain HTTP. Put TLS in front and publish only the TLS port: the app will not send your
tokens over `http://` to anything but localhost. Simplest is Caddy, which gets a certificate for you:

```
arc.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

For any reverse proxy: turn off response buffering and allow long reads on `/v1/sessions/*/events` (nginx:
`proxy_buffering off; proxy_read_timeout 3600s;`), and set `-e ARC_TRUST_PROXY=1` so failed-login rate limiting
sees the real client address from `X-Forwarded-For`. Only set that when a proxy you control is in front.

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARC_CLOUD_TOKEN_FILE` | none | Path to a file holding the worker token. Preferred. Read once, whitespace trimmed. |
| `ARC_CLOUD_TOKEN` | none | The token as a variable (weaker). One of the two is required, 32 characters minimum. |
| `PORT` | `8080` | Port to listen on. |
| `ARC_DATA_DIR` | `/data` | Where clones and session files go. |
| `ARC_MAX_SESSIONS` | `4` | Sessions at the same time. |
| `ARC_IDLE_HOURS` | `24` | An idle session this long is ended and its files deleted. |
| `ARC_GITHUB_HOSTS` | `github.com` | Comma list of allowed repository hosts (GitHub Enterprise). |
| `ARC_GITHUB_API` | `https://api.github.com` | API address; for Enterprise `https://<host>/api/v3`. |
| `ARC_TRUST_PROXY` | off | `1` when a reverse proxy is in front. |

Script settings: `MEMORY` (default `4Gi`), `CPU` (default `2`), `ARC_REQUIRE_IAM=1`.

## Create the GitHub token

Use a **fine-grained personal access token**, not a classic one.

1. GitHub > avatar > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate.
2. Resource owner: you, or the organization that owns the repository (it may need to approve the token).
3. Expiration: a date you will remember; shorter is safer.
4. Repository access: **Only select repositories**, just the ones you want ARC on.
5. Permissions: **Contents: Read and write**, **Pull requests: Read and write**. Everything else "No access".
6. Generate and copy it; GitHub shows it once.

## Connect the app

ARC > Settings > Cloud: **Worker URL** (the Cloud Run URL, or your `https://` address), **Worker token**, **GitHub
token**. Press **Test**: it checks the worker, the token and GitHub, one line each. Then Sidebar > Cloud > **New
cloud session**: `owner/name` (or a GitHub link), optional base branch and name. The tokens are stored on your
Mac in the encrypted store, never in `settings.json`.

## What happens when the worker restarts

Sessions live in the worker's memory and disk. A restart (a deploy, a crash, Cloud Run maintenance, `docker
restart`) **ends every session**; ARC tells you, and pushed work is safe on GitHub. With auto-push on (the
default) that is every finished turn; you can lose a turn in progress, or all unpushed work if auto-push is off.
On start the worker deletes leftover clones. A graceful stop (`SIGTERM`) stops running turns and lets a queued
push finish for a few seconds.

## Troubleshooting

- **Worker unreachable.** Open `<worker URL>/health`: it must show `{"ok":true}`. The URL must be `https://`
  with no trailing path.
- **401 Unauthorized.** The token in ARC does not match. Copy it again without spaces or a line break. After
  rotating, you must redeploy (see above).
- **Worker will not start: `ARC_CLOUD_TOKEN_FILE could not be read`.** The file is missing or unreadable by the
  container user. On Cloud Run check the secret mount in the service's revision; with Docker check the path and
  the file's owner.
- **429 Too many failed attempts.** Ten wrong tokens in a minute block that address for a minute. On Cloud Run
  the script sets `ARC_TRUST_PROXY=1`; on your own proxy set it yourself.
- **"Your GitHub token cannot push to owner/name".** Missing Contents: Read and write on that repository, the
  repository was not selected, the token expired, or the organization has not approved it.
- **429 "already runs 4 sessions".** End one from the Cloud list, or raise `ARC_MAX_SESSIONS`.
- **Session vanished, or the worker was killed under load.** It was idle for `ARC_IDLE_HOURS`, the worker
  restarted, or on Cloud Run it ran out of memory: raise `MEMORY` (see above).
- **Event stream drops about every hour.** Expected on Cloud Run (`--timeout=3600`); the app reconnects and
  replays. If more than 10 000 events or 8 MB were missed, it reloads the conversation.
- **`gcloud run deploy --source` asks to create an Artifact Registry repository.** The first deploy in a
  region does this. The script passes `--quiet` to accept the default; if you run the command by hand, answer
  `y` or add `--quiet`.
- **`gcloud run deploy --source` permission error.** Newer projects need the default Cloud Build and compute
  service accounts to have build roles. Deploy once from the console (Cloud Run > Deploy from source), follow
  its "grant permissions" prompt, and run the script again.
- **`--allow-unauthenticated` refused.** An organization policy forbids public services. Ask for an
  exception, or use `ARC_REQUIRE_IAM=1` with `gcloud run services proxy`.
- **GitHub Enterprise.** Set `ARC_GITHUB_HOSTS=<host>` and `ARC_GITHUB_API=https://<host>/api/v3`; on Cloud Run
  `gcloud run services update arc-worker --update-env-vars ARC_GITHUB_HOSTS=...,ARC_GITHUB_API=...`.
- **Upgrading from an older deploy that used `ARC_CLOUD_TOKEN` as an env secret.** The script removes it for
  you; by hand: `gcloud run services update arc-worker --remove-secrets ARC_CLOUD_TOKEN`.
- **Logs.** `gcloud run services logs read arc-worker --region <REGION>`, or `docker logs arc-worker`: start-up
  lines and redacted errors, never tokens, prompts or code.

## First deploy checklist (cannot be verified from a Linux dev box)

- [ ] `deploy/cloud-run.sh` completes and prints a URL; `<URL>/health` shows `{"ok":true}`.
- [ ] ARC > Settings > Cloud > Test shows three green lines.
- [ ] Start a session on a throw-away repository; a turn finishes and "Saved to GitHub" appears.
- [ ] The `arc/` branch exists; Open pull request creates a PR.
- [ ] Close ARC, reopen: the session is listed and the transcript returns.
- [ ] `gcloud run services update arc-worker --update-env-vars X=1` (a restart): the app reports the session
      ended and the branch is intact.
- [ ] On the running revision, `ARC_CLOUD_TOKEN` is absent from the environment and the mount `/secrets/arc-token` exists.
