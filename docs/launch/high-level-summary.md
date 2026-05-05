# Kanboard Whiteboard - high-level summary

**Repo:** https://github.com/bigmuzb/kanboard-whiteboard

**Hosted demo:** https://whiteboard-demo.notool.au

**One-liner:**

Kanboard Whiteboard is a small mobile-friendly front-end for Kanboard, designed for teams that want a simple whiteboard-style board view without replacing Kanboard.

## The problem

Kanboard is powerful and practical, but the default UI is not always ideal for quick daily task movement on phones, tablets, or wall-mounted displays.

Some teams need a simpler surface:

- big readable columns
- quick drag-and-drop task movement
- minimal clutter
- easy mobile access
- simple login links for non-technical users

## The approach

Kanboard remains the backend and source of truth. Kanboard Whiteboard is just a lightweight Node.js and vanilla JavaScript front-end that talks to Kanboard through its JSON-RPC API.

Architecture:

```text
Browser -> Kanboard Whiteboard -> Kanboard JSON-RPC API -> Kanboard database
```

The app does not touch the Kanboard database directly.

## Current features

- Kanban board view
- Drag-and-drop between columns
- Multi-project tabs
- Per-user project visibility
- Magic-link login
- Session cookies
- Admin panel for users and magic links
- Inline comments
- Dark/light theme
- PWA support
- Docker Compose setup

## Current boundaries

It deliberately does not try to replace Kanboard.

Out of scope for now:

- full admin replacement
- analytics/reporting
- attachments-heavy workflows
- subtasks/swimlanes UI
- real-time sync
- every Kanboard feature exposed in one interface

## Versioning and compatibility

The app uses semantic versioning for its own releases.

Kanboard compatibility is tracked separately in the README. Current documented tests:

- Kanboard `v1.2.52` - full live Docker smoke test
- Kanboard `v1.2.37` - older-image JSON-RPC compatibility smoke

## Positioning

This is a community-friendly open-source utility, not a SaaS bait-and-switch.

Managed or branded deployments may exist separately, but the core repository should stay generic, readable, and useful.

## Launch assets needed

Minimum before announcement:

1. Board overview screenshot
2. Mobile screenshot
3. Task comments screenshot
4. Admin magic-link screenshot
5. Optional short GIF of dragging a task
6. GitHub repo public
7. README reviewed
8. Release/tag created
9. AI disclosure included in forum post

## Recommended launch surface

Post first on Kanboard Discourse in the Plugins category:

https://kanboard.discourse.group/c/plugins/8

GitHub Discussions exists, but appears much quieter. Discourse has recent 2026 activity for plugins, themes, and Kanboard-adjacent tools.

Use Markdown plus uploaded screenshots. Avoid fancy HTML.
