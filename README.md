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
  about/             the about page: post.md (title, text, looks) and its media
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

- `![description](file "caption")` on its own line places an image, a video
  or an audio file; description (read by screen readers) and caption are
  optional. Add ` loop` after a short video to play it like a living image:
  silent, looping, no controls. The editor writes these for you ("text").
- `![](file)` on its own line places an image, a video (`.mp4`, `.webm`, `.mov`)
  or an audio file (`.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg`) from the post folder.
  Consecutive media sit together with no gap between them.
- A YouTube or Vimeo link on its own line becomes a player.
- `## Heading`, `**bold**`, `[text](https://...)`, `- list item`.
- `draft: true` in the header hides a post: it is left out of the home page and
  the feed, but can be previewed at its address (not indexed by search engines).
- `pinned: true` keeps a post first on the home page, above newer ones.
- `background: photo.jpg` opens the post on that image, full screen; a tap (or
  scrolling down) shows the text over it. `background-style` sets how:
  `faded` (default: no colour, low contrast, blurred, dark text), `bw` (black
  and white, darkened, light text) or `difference` (image as it is, text in
  difference like the corner icons). The filters are `--bg-faded` and `--bg-bw`
  in `src/style.css`. `background: true` uses the cover.
- `background: #1d2a33` gives the post a solid colour instead.
- `text-color: #8a3b12` sets the text colour; without it each background picks
  black or white.
- `banner: photo.jpg` shows that image above the title. The cover itself is only
  used on the home page.
- `font: oswald` or `font: typewriter` (Courier Prime) changes the post's font;
  the default is Helvetica. Both are served from the site (`src/fonts/`, SIL Open
  Font License), not from Google.
- The folder name is the address of the post. Do not rename it once shared.
- Posts are ordered by date, newest first, unless an order is set in the editor.

### From a phone (or any browser)

Open `<site address>/admin/`. The first time, open **Connection** and paste a
GitHub access token:

GitHub > Settings > Developer settings > Fine-grained tokens > Generate new token,
Repository access: only this repository, Permissions: Contents: Read and write.

The token stays in that browser. Then pick "New post" (or an existing one), fill
in title, cover and text, add media, and press Publish. Large photos are scaled
to 2400 px before upload.

- **Hidden (draft)** saves the post without showing it on the site. Reopen it
  from the Post list, untick the box and publish when it is ready. The same
  box takes a published post offline again.
- **Pinned to the top** keeps the post first on the home page.
- **bg** and **banner** next to an image in the media list pick the background
  and the banner (one each, or none). **Font** picks the post's font.
- **About page** in the Post list edits the about page like a post (title, text,
  media, background, banner, font, text colour, no cover or date) and the
  contact links.
- **All posts** in the Post list hides, shows or deletes several posts at once,
  in a single save. Drag the handles to set the order of the posts on the site
  (saved as `order` in `content/site.json`); pinned posts stay first and new
  posts appear at the top until they are placed.
- **Site settings** in the Post list holds options for the whole site, saved
  in `content/site.json` under `options`. `home_reactions`: reactions over the
  home page photos (all of them on the right in full screen, the most chosen one
  in the grid). For one request instead of one per post, run the
  `reaction_summary` part of `reactions.sql` in Supabase.
- The **x** next to a media file takes it out of the post and out of the text;
  files already published are deleted when you press Publish.
- **Delete post** (two taps) removes the post folder. Earlier versions remain
  in the repository history.

The repository is public, so hidden posts can still be read there.

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

Colours, font, column widths, media size, icon size and the shape of the home
column on big screens (`--column-ratio`) are variables at the top of
`src/style.css`. The one-photo-per-gesture timing for mouse and trackpad
(`GESTURE_GAP`, `MIN_STEP`, `THRESHOLD`) is at the top of the home section in
`src/app.js`. Icons are inline SVG in `ICONS` in `build.py`.

## Images, video and the rest of the build

- Photos are published with WebP copies at 600, 1200 and 2000 px; each browser
  downloads the size it needs. `.mov` videos become `.mp4` with a poster frame.
  This needs `pip install -r requirements.txt` (the deploy workflow does it);
  without it the site still builds, with the original files. Results are kept
  in `.cache/`.
- The favicon is the repository owner's GitHub profile picture, cropped round,
  fetched at each deploy.
- `feed.xml` is an RSS feed of the published posts.
- The home page has three views, cycled by the top right icon: full screen,
  grid (titles appear on hover with a mouse) and index (titles and dates).

