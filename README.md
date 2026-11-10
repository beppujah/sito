# Personal site

A static personal site (portfolio, about page, personal toolbox) whose menu is a
tree that grows as you scroll. Built with three.js, no build step.

## Structure

The home page is only the tree. Each button opens its own page.

| File | What it is | Edit it? |
| --- | --- | --- |
| `js/config.js` | Menu entries, tree shape, scroll timeline, camera, atmosphere, YouTube | Yes, this is the main control panel |
| `css/style.css` | Colors (top `:root` block, light and dark), font, layout | Yes, for colors and type |
| `index.html` | Home page: the tree | Rarely |
| `about.html`, `videos.html`, `links.html`, `resources.html`, `toolbox.html` | Section pages | Yes, for content |
| `projects/*.html` | One page per project, each with its own shareable link | Yes, for content |
| `js/video.js` | Click-to-play YouTube embeds | Rarely |
| `js/vendor/three.min.js` | three.js r128, bundled so the site has no external script dependency | No |
| `js/tree.js` | Procedural tree generator | Only to change how the tree is drawn |
| `js/scene.js` | Camera and drawing: WebGL when available, 2D canvas otherwise | Rarely |
| `js/main.js` | Scroll progress and tree buttons | Rarely |

## Adding a project with its own link

1. Copy `projects/_template.html` to `projects/my-project.html` and fill it in.
2. Add an entry to `nodes` in `js/config.js` with `href: "projects/my-project.html"`.

The shareable link is `https://<username>.github.io/<repo>/projects/my-project`
(the `.html` ending is optional on GitHub Pages).

Back links point to `index.html#grown`, which opens the tree already complete.

## Videos

Set `youtube.channelId` in `js/config.js` to list the channel's latest uploads
automatically, and/or add hand-picked videos to `youtube.videos`. On any page that
loads `js/video.js`, `<div class="yt" data-id="VIDEO_ID" data-title="Title"></div>`
embeds a video.

## Cache

Browsers keep the CSS and JS files for a while. Every file is loaded with a
version suffix (`?v=5`): after changing CSS or JS, raise that number in
every `.html` file so visitors get the new files at once.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Publish on GitHub Pages

1. Create a repository named `<username>.github.io` and push these files to `main`.
2. In the repository: Settings > Pages > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The site is served at `https://<username>.github.io`.
