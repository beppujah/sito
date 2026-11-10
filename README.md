# Portfolio

Minimal portfolio / blog for GitHub Pages. No dependencies: one Python script
turns the `content/` folder into a static site.

- Home: full screen cover photos, scrolled vertically, or a 3x3 grid.
- Top left info icon: about + contact page (a back arrow on inner pages).
- Top right icon: switch between full screen and grid.
- Each post has its own address: `posts/<name>/`.
- Anonymous reactions under each post (sun, moon, rain, cloud, leaf, water, wind).

## Layout of the project

```
content/
  site.json          site title, address, repository, contact links, reactions backend
  about.md           text of the about page
  posts/<name>/      one folder per post
    post.md          title, date, cover + text
    cover.jpg        cover photo
    ...              any other image, video or audio used in the text
src/                 style.css, app.js, admin.js
build.py             generator (builds into _site/)
reactions.sql        optional shared backend for reactions
.github/workflows/deploy.yml   builds and publishes on every push to main
```

## One-time setup

1. Push this folder to the GitHub repository (branch `main`).
2. In the repository: Settings > Pages > Source: **GitHub Actions**.
3. Check `url`, `repo` and the contact links in `content/site.json`.

Every push to `main` rebuilds and publishes the site in about a minute.

## Writing a post

`post.md`:

```
---
title: Sun over the ridge
date: 2026-11-10
cover: cover.jpg
---

Text of the post. A blank line starts a new paragraph.

![](photo-2.jpg)

https://www.youtube.com/watch?v=XXXXXXXXXXX
```

- `![](file)` on its own line places an image, a video (`.mp4`, `.webm`, `.mov`)
  or an audio file (`.mp3`, `.wav`, `.m4a`) from the post folder.
- A YouTube or Vimeo link on its own line becomes a player.
- `## Heading`, `**bold**`, `[text](https://...)`, `- list item`.
- `draft: true` in the header keeps a post off the site.
- The folder name is the address of the post. Do not rename it once shared.
- Posts are ordered by date, newest first.

### From a phone (or any browser)

Open `<site address>/admin/`. The first time, open **Connection** and paste a
GitHub access token:

GitHub > Settings > Developer settings > Fine-grained tokens > Generate new token,
Repository access: only this repository, Permissions: Contents: Read and write.

The token stays in that browser. Then pick "New post" (or an existing one), fill
in title, cover and text, add media, and press Publish. Large photos are scaled
to 2400 px before upload.

### From a computer

```
python3 build.py new "Post title" ~/Pictures/cover.jpg [more files ...]
```

creates the folder and a `post.md` to edit. Preview and publish:

```
python3 build.py serve        # http://localhost:8000, rebuilt on every reload
git add -A && git commit -m "Add post" && git push
```

## Reactions

One reaction per visitor per post; tapping the same one again removes it. The
visitor is a random id stored in the browser, so "per visitor" means per browser.

Out of the box the choice is only remembered on the visitor's own device. To
share totals between visitors, create a free Supabase project, run
`reactions.sql` in its SQL editor, and put the project URL and anon key in
`content/site.json` under `reactions`. To change the set of reactions, edit
`REACTIONS` and `ICONS` in `build.py` and the list in `reactions.sql`.

## Tweaking the look

Colours, font, column widths and icon size are variables at the top of
`src/style.css`. Icons are inline SVG in `ICONS` in `build.py`.
