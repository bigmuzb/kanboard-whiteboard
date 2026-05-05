# Kanboard forum intro post

Suggested venue:

**Kanboard Discourse → Plugins**

https://kanboard.discourse.group/c/plugins/8

Suggested title:

**Kanboard Whiteboard - a small companion board UI for Kanboard**

Suggested post:

Hi everyone,

I have just published a small open-source companion interface for Kanboard:

https://github.com/bigmuzb/kanboard-whiteboard

Hosted public demo, with fake data that resets regularly:

https://whiteboard-demo.notool.au

It is called **Kanboard Whiteboard**. The idea is simple: keep Kanboard as the backend and source of truth, but wrap everyday task movement in a cleaner whiteboard-style front-end.

I built it for my own business because I wanted something that worked well on phones, tablets, and wall-mounted screens without replacing Kanboard or trying to expose every Kanboard feature.

## What it does

- Shows Kanboard projects as simple kanban boards
- Lets users drag tasks between columns
- Supports multiple projects with per-user project visibility
- Uses magic-link login rather than passwords
- Includes a small admin panel for users and login links
- Works as a PWA on phones/tablets
- Supports dark/light themes
- Runs with Docker Compose

## What it is not

This is not a Kanboard replacement, and it is not trying to be a full project management suite.

Kanboard still does the serious work: projects, tasks, workflow, storage, API, users, and permissions. This app is just a lightweight front-end that wraps the everyday board experience and talks to the Kanboard JSON-RPC API.

If you need every Kanboard feature, use Kanboard itself. If you want a simple board view that non-technical users can leave open on a TV or use quickly on a phone, this may be useful.

## Screenshots

Board overview:

![Board overview](https://raw.githubusercontent.com/bigmuzb/kanboard-whiteboard/master/docs/assets/screenshots/01-board-overview.png)

Mobile column view:

![Mobile column view](https://raw.githubusercontent.com/bigmuzb/kanboard-whiteboard/master/docs/assets/screenshots/02-mobile-board.png)

Task comments:

![Task comments](https://raw.githubusercontent.com/bigmuzb/kanboard-whiteboard/master/docs/assets/screenshots/03-task-comments.png)

## AI disclosure

This was built with AI-assisted tooling, mainly Claude via OpenClaw. I directed the architecture, tested it against real Kanboard use, and made the product/scope decisions. The code is plain Node/vanilla JavaScript, no framework and no build step.

I am disclosing that up front so people can make an informed choice. If you avoid AI-assisted software on principle, fair enough - this may not be for you. I am not here to relitigate AI use, but I am happy to answer technical questions about the project.

## Tested with

- Kanboard `v1.2.52` - full Docker smoke test against `kanboard/kanboard:latest` as of May 2026
- Kanboard `v1.2.37` - compatibility smoke against an older Docker image

The app uses standard JSON-RPC methods such as `getAllProjects`, `getBoard`, `createTask`, `moveTaskPosition`, and `createComment`.

## Why I am sharing it

Kanboard is excellent because it is practical, self-hostable, and not full of SaaS nonsense. This little wrapper exists because Kanboard already provides the solid foundation.

If it helps someone else make Kanboard easier for a small team to use, great. If not, no harm done.

Feedback welcome, especially around:

- install friction
- Kanboard version compatibility
- Docker setup clarity
- mobile usability
- whether the scope feels sensible

Repo:

https://github.com/bigmuzb/kanboard-whiteboard

Demo:

https://whiteboard-demo.notool.au

Background/build notes, once the project page is live:

https://notool.au/open-source/kanboard-whiteboard

Thanks to Frédéric Guillot and the Kanboard contributors for building the thing that makes this possible.

## Posting notes

Use Markdown, not fancy raw HTML. Discourse sanitises HTML and Markdown is easier to read, quote, and maintain. Upload screenshots directly to Discourse if possible; otherwise the GitHub raw image URLs above will work once the repo is public.

Do not lead with NOTOOL. Lead with Kanboard usefulness, the repo, the demo, and thanks to the upstream project.
