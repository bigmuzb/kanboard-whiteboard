# Demo Setup

This repo includes a reusable demo pack for screenshots, local evaluation, and launch posts.

The demo uses fake data only. Do not use real client projects, real names, live magic links, production URLs, or private tasks in public screenshots.

## Local Docker demo

Start a fresh demo stack:

```bash
docker compose -f docker-compose.demo.yml up -d --build
```

Read the generated admin magic link:

```bash
docker compose -f docker-compose.demo.yml logs demo-seed
```

Open the printed login link in your browser.

Default board URL:

```text
http://localhost:3000
```

In `DEMO_MODE=true`, `/` and `/login` redirect into the public demo flow automatically. `/demo-login` is still available directly.

Use another host port if needed:

```bash
DEMO_PORT=3010 docker compose -f docker-compose.demo.yml up -d --build
```

## Reset demo data

The demo is designed to be disposable.

```bash
docker compose -f docker-compose.demo.yml down -v
docker compose -f docker-compose.demo.yml up -d --build
```

That removes the demo Kanboard database and the whiteboard auth database, then reseeds everything.

## Sample data

Sample data lives in:

```text
demo/sample-data.json
```

It contains fake users, fake projects, fake tasks, and fake comments. The tone is deliberately a bit silly so nobody mistakes it for real client data.

Names include:

- Ben Dover
- Harry Highpants
- Ralph Longbottom
- Elvis Parsley
- Sammy APIman
- Dazza Modelton

Keep public demo data fictional. Avoid jokes that rely on real living people, real companies, politics, private clients, or anything that makes the project look like a gripe session.

## Screenshots

Recommended screenshots:

1. Desktop board overview
2. Mobile board view
3. Task comments panel
4. Admin magic-link panel, with tokens hidden or cropped
5. Optional short GIF of dragging a task between columns

Store launch screenshots under:

```text
docs/assets/screenshots/
```

## Public sandbox option

For a public writeable sandbox, use a separate hosted demo stack and reset it regularly.

Recommended reset cadence:

- hourly for a busy public demo
- nightly for a quiet demo

Example host cron:

```cron
0 * * * * cd /path/to/kanboard-whiteboard && docker compose -f docker-compose.demo.yml down -v && docker compose -f docker-compose.demo.yml up -d --build
```

Public sandbox safety rules:

- never reuse production API tokens
- no email sending
- no webhooks
- no private networks exposed
- no real user accounts
- no real client data
- clear banner or README note: "Public demo. Data resets regularly. Do not enter private information."

Current hosted sandbox:

```text
https://whiteboard-demo.notool.au
```

The hosted sandbox runs behind Cloudflare Tunnel, not an exposed origin port. It uses fake data, allows public visitors to move cards, blocks admin/destructive API actions, and resets regularly. Do not enter private information.


## Optional analytics for a hosted demo

The app supports optional Umami tracking for instance operators. Leave these unset for normal local/self-hosted use.

```yaml
environment:
  - UMAMI_SCRIPT_URL=https://analytics.example.com/script.js
  - UMAMI_WEBSITE_ID=your-website-id
  - UMAMI_DOMAINS=your-demo.example.com
```

Only set these on infrastructure you operate. Do not track other people's self-hosted deployments.
