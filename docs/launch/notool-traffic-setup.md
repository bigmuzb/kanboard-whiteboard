# NOTOOL traffic setup for Kanboard Whiteboard

Goal: let useful open-source attention flow back to NOTOOL without making the repo feel like a sales funnel.

## Recommended link target

Do not send launch traffic to the generic NOTOOL homepage if we can avoid it.

Use a dedicated project page instead:

```text
https://notool.au/open-source/kanboard-whiteboard
```

That page can explain the project, track traffic with Umami, and link out to GitHub without muddying the repo itself.

Do not add this URL publicly until the page or redirect exists.

## Where to link from

Use a light touch:

1. README author/credit section
   - "Built by Murray Booth / NOTOOL"
   - Link to the dedicated project page once live

2. GitHub repo sidebar website field
   - Prefer demo page if live
   - Otherwise use the dedicated NOTOOL project page

3. Forum launch post
   - Main link is always GitHub
   - One secondary line: "Background/build notes are on the NOTOOL project page"

4. Demo footer or demo banner
   - "Demo by NOTOOL" or "Built by NOTOOL"
   - Keep it small

Do not add NOTOOL branding to every file, every screenshot, or every paragraph.

## Suggested NOTOOL page structure

Page title:

**Kanboard Whiteboard**

Hero:

**A simpler whiteboard-style front-end for Kanboard**

Intro copy:

Kanboard Whiteboard is a small open-source companion interface for Kanboard. It keeps Kanboard as the source of truth and adds a cleaner board view for phones, tablets, and wall-mounted displays.

It was built by Murray Booth at NOTOOL for practical day-to-day task handling, then cleaned up and released because it may help other small teams using Kanboard.

Primary CTA:

**View the GitHub repo**

Secondary CTA:

**Read the setup notes**

Sections:

- What it does
- Why Kanboard stays the backend
- Screenshots
- Demo notes
- Tested Kanboard versions
- How to deploy it
- About NOTOOL

About NOTOOL copy:

NOTOOL builds practical AI and workflow tools for construction and operations teams. The common thread is simple: reduce document grind, preserve hard-won business knowledge, and give small teams better leverage without forcing them into bloated software.

## Umami tracking

Track the dedicated page like any other NOTOOL page.

Recommended events:

- `kw-page-view`
- `kw-github-click`
- `kw-demo-click`
- `kw-copy-compose-click`
- `kw-screenshot-click`

Recommended UTM links from GitHub/forum back to NOTOOL:

```text
https://notool.au/open-source/kanboard-whiteboard?utm_source=github&utm_medium=readme&utm_campaign=kanboard-whiteboard
https://notool.au/open-source/kanboard-whiteboard?utm_source=kanboard-forum&utm_medium=community&utm_campaign=kanboard-whiteboard
```

Recommended GitHub outbound link from NOTOOL:

```text
https://github.com/bigmuzb/kanboard-whiteboard?utm_source=notool&utm_medium=project-page&utm_campaign=kanboard-whiteboard
```

## What not to do

- Do not buy stars.
- Do not use README tracking pixels.
- Do not make the open-source repo look like a sales brochure.
- Do not imply Kanboard endorsement.
- Do not bury the GitHub link below NOTOOL marketing.
- Do not track individual users beyond normal aggregate analytics on NOTOOL-owned pages.

## Launch-safe README wording

Use this once the dedicated NOTOOL page is live:

> Built by Murray Booth / [NOTOOL](https://notool.au/open-source/kanboard-whiteboard) for a real internal workflow, then cleaned up and released because it may help other Kanboard users.

If the dedicated page is not live yet, use the plain homepage link temporarily:

> Built for my own business ([notool.au](https://notool.au)). Shared because it solved a real problem and might solve yours too.
