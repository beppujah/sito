#!/usr/bin/env python3
"""Static site generator for the portfolio. Standard library only.

Optional, for smaller images and web-ready video (installed on GitHub by the
deploy workflow): pip install pillow imageio-ffmpeg

Usage:
  python3 build.py                      build the site into _site/
  python3 build.py serve [port]         build and preview at http://localhost:8000
  python3 build.py new "Title" cover.jpg [media ...]
                                        create a new post folder in content/posts/
"""
import datetime
import hashlib
import html
import json
import re
import shutil
import struct
import subprocess
import sys
import urllib.request
from email.utils import format_datetime
import unicodedata
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
POSTS = CONTENT / "posts"
SRC = ROOT / "src"
OUT = ROOT / "_site"
CACHE = ROOT / ".cache"  # resized images, converted videos, favicon (rebuilt when missing)

try:
    from PIL import Image, ImageDraw, ImageOps
except ImportError:  # the site still builds, with the original files only
    Image = None

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
AUDIO_EXT = {".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus"}

# Reaction kinds, in display order. Keep in sync with reactions.sql.
TRUE = ("true", "yes", "1")

# Fonts a post can use. Oswald and Courier Prime are served from assets/fonts/.
FONTS = ("helvetica", "oswald", "typewriter")

# How a background image sits behind the text once the text is shown.
BG_STYLES = ("faded", "bw", "difference")

HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}){1,2}$")


def is_dark(color):
    """True for a dark hex colour (so white text reads better on it)."""
    value = color.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    r, g, b = (int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5

REACTIONS = ["sun", "moon", "rain", "cloud", "leaf", "water", "wind"]


# --------------------------------------------------------------------------
# Icons (inline SVG, drawn with the current text colour)
# --------------------------------------------------------------------------

def svg(inner, box=24, cls=""):
    return (
        f'<svg class="{cls}" viewBox="0 0 {box} {box}" fill="none" stroke="currentColor" '
        f'stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" '
        f'aria-hidden="true">{inner}</svg>'
    )


ICONS = {
    # Circled "i": opens the about + contact page.
    "info": svg(
        '<circle cx="12" cy="12" r="9.25"/><path d="M12 10.75v6"/>'
        '<circle cx="12" cy="7.75" r="0.55" fill="currentColor" stroke="none"/>'
    ),
    "back": svg('<path d="M19.5 12H4.5"/><path d="M10 6.5L4.5 12l5.5 5.5"/>'),
    "grid": svg(
        '<rect x="4.5" y="4.5" width="6" height="6"/><rect x="13.5" y="4.5" width="6" height="6"/>'
        '<rect x="4.5" y="13.5" width="6" height="6"/><rect x="13.5" y="13.5" width="6" height="6"/>',
        cls="icon-grid",
    ),
    # Index: a list of lines.
    "list": svg('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>', cls="icon-list"),
    # Full screen: two diagonal arrows.
    "expand": svg(
        '<path d="M14.5 4.5h5v5"/><path d="M19.5 4.5l-6 6"/>'
        '<path d="M9.5 19.5h-5v-5"/><path d="M4.5 19.5l6-6"/>',
        cls="icon-expand",
    ),
    "sun": svg(
        '<circle cx="12" cy="12" r="3.8"/>'
        '<path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4'
        'M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'
    ),
    "moon": svg('<path d="M20 14.2A8.2 8.2 0 1 1 9.8 4 6.6 6.6 0 0 0 20 14.2z"/>'),
    "rain": svg(
        '<path d="M7.2 14.5h9.6a3.6 3.6 0 0 0 .5-7.2 5.4 5.4 0 0 0-10.5 1.2 3.1 3.1 0 0 0 .4 6z"/>'
        '<path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>'
    ),
    "cloud": svg(
        '<path d="M7 18.5h10.2a4.2 4.2 0 0 0 .6-8.4A6.3 6.3 0 0 0 5.6 11.5 3.6 3.6 0 0 0 7 18.5z"/>'
    ),
    "leaf": svg('<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z"/><path d="M5 19l8.5-8.5"/>'),
    "water": svg(
        '<path d="M3 7.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"/>'
        '<path d="M3 12c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"/>'
        '<path d="M3 16.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"/>'
    ),
    "wind": svg(
        '<path d="M3 9h10.5a2.8 2.8 0 1 0-2.8-2.8"/>'
        '<path d="M3 13h14.5a2.8 2.8 0 1 1-2.8 2.8"/>'
        '<path d="M3 17h6.5"/>'
    ),
}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def esc(value):
    return html.escape(str(value), quote=True)


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "post"


def warn(message):
    print(f"  warning: {message}", file=sys.stderr)


def split_front_matter(raw):
    """Return (meta, body) from a file that starts with a '---' block."""
    raw = raw.lstrip("﻿").replace("\r\n", "\n")
    match = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*\n?(.*)$", raw, re.S)
    if not match:
        return {}, raw
    meta = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'" and value.count(value[0]) == 2:
            value = value[1:-1]
        meta[key.strip().lower()] = value
    return meta, match.group(2)


# --------------------------------------------------------------------------
# Image sizes, read from the file headers (so the page can reserve the space
# and show a loading indicator before the image arrives)
# --------------------------------------------------------------------------

def _jpeg_orientation(app1):
    """EXIF orientation from a JPEG APP1 segment, 1 when absent."""
    if not app1.startswith(b"Exif\0\0"):
        return 1
    tiff = app1[6:]
    order = "<" if tiff[:2] == b"II" else ">"
    try:
        offset = struct.unpack(order + "I", tiff[4:8])[0]
        count = struct.unpack(order + "H", tiff[offset:offset + 2])[0]
        for i in range(count):
            entry = tiff[offset + 2 + i * 12: offset + 14 + i * 12]
            if struct.unpack(order + "H", entry[:2])[0] == 0x0112:
                return struct.unpack(order + "H", entry[8:10])[0]
    except (struct.error, IndexError):
        pass
    return 1


def image_size(path):
    """(width, height) as displayed, or None if unknown."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", data[16:24])
        if data[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", data[6:10])
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            kind = data[12:16]
            if kind == b"VP8X":
                return (int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1)
            if kind == b"VP8 ":
                w, h = struct.unpack("<HH", data[26:30])
                return (w & 0x3FFF, h & 0x3FFF)
            if kind == b"VP8L":
                bits = int.from_bytes(data[21:25], "little")
                return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        if data[:2] == b"\xff\xd8":
            i, orientation = 2, 1
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                length = struct.unpack(">H", data[i + 2:i + 4])[0]
                if marker == 0xE1 and orientation == 1:
                    orientation = _jpeg_orientation(data[i + 4:i + 2 + length])
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return (h, w) if orientation >= 5 else (w, h)
                i += 2 + length
        if path.suffix.lower() == ".svg":
            match = re.search(rb'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', data[:2000])
            if match:
                return (round(float(match.group(1))), round(float(match.group(2))))
    except (struct.error, ValueError):
        pass
    return None


# --------------------------------------------------------------------------
# Media processing: smaller WebP copies of photos, MP4 + poster for videos
# --------------------------------------------------------------------------

WIDTHS = (600, 1200, 2000)               # widths of the WebP copies
RASTER = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
CONVERT_VIDEO = {".mov", ".m4v"}         # turned into .mp4 for every browser
VARIANTS = {}  # source path -> [(width, file name)]
VIDEOS = {}    # source path -> {"file", "poster", "size"}
_warned = set()


def warn_once(key, message):
    if key not in _warned:
        _warned.add(key)
        warn(message)


def file_hash(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:16]


def make_variants(source, target):
    """WebP copies of a photo at a few widths, cached in .cache/media."""
    if Image is None:
        warn_once("pillow", "Pillow is not installed: images are published at full size only")
        return []
    stem = source.stem
    cache = CACHE / "media" / file_hash(source)
    done = []
    try:
        if not (cache / "done").exists():
            cache.mkdir(parents=True, exist_ok=True)
            with Image.open(source) as image:
                image = ImageOps.exif_transpose(image)
                if image.mode not in ("RGB", "RGBA"):
                    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                width, height = image.size
                for w in sorted({min(x, width) for x in WIDTHS}):
                    copy = image if w == width else image.resize((w, round(height * w / width)), Image.LANCZOS)
                    copy.save(cache / f"{w}.webp", "WEBP", quality=80, method=4)
            (cache / "done").write_text("")
        for file in sorted(cache.glob("*.webp"), key=lambda f: int(f.stem)):
            name = f"{stem}-{file.stem}.webp"
            shutil.copy2(file, target / name)
            done.append((int(file.stem), name))
    except (OSError, ValueError) as error:
        warn(f"{source.parent.name}/{source.name}: could not resize ({error})")
        return []
    return done


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if not exe:
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            exe = None
    if not exe:
        warn_once("ffmpeg", "ffmpeg is not available: videos are published as they are, without a poster")
    return exe


def make_video(source, target):
    """MP4 (when needed) and a poster frame, cached in .cache/media. Returns VIDEOS entry."""
    exe = ffmpeg()
    convert = source.suffix.lower() in CONVERT_VIDEO
    name = source.stem + ".mp4" if convert else source.name
    entry = {"file": source.name, "poster": None, "size": None}
    if not exe:
        shutil.copy2(source, target / source.name)
        return entry
    cache = CACHE / "media" / file_hash(source)
    cache.mkdir(parents=True, exist_ok=True)
    run = lambda args: subprocess.run([exe, "-v", "error", "-y", *args], capture_output=True, timeout=900)
    try:
        if convert and not (cache / "video.mp4").exists():
            probe = subprocess.run([exe, "-i", str(source)], capture_output=True, text=True).stderr
            video = "copy" if re.search(r"Video: h264", probe) else "libx264"
            audio = "copy" if re.search(r"Audio: aac", probe) else "aac"
            args = ["-i", str(source), "-map", "0:v:0", "-map", "0:a?", "-c:v", video, "-c:a", audio]
            if video == "libx264":
                args += ["-crf", "23", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
            result = run(args + ["-movflags", "+faststart", str(cache / "tmp.mp4")])
            if result.returncode:
                raise OSError(result.stderr.decode(errors="ignore")[-300:])
            (cache / "tmp.mp4").rename(cache / "video.mp4")
        if not (cache / "poster.jpg").exists():
            run(["-ss", "0.3", "-i", str(source), "-frames:v", "1", "-vf", "scale='min(1200,iw)':-2",
                 "-q:v", "4", str(cache / "poster.jpg")])
        if convert:
            shutil.copy2(cache / "video.mp4", target / name)
        else:
            shutil.copy2(source, target / name)
        entry["file"] = name
        if (cache / "poster.jpg").exists():
            entry["poster"] = source.stem + "-poster.jpg"
            shutil.copy2(cache / "poster.jpg", target / entry["poster"])
            entry["size"] = image_size(cache / "poster.jpg")
    except (OSError, subprocess.SubprocessError) as error:
        warn(f"{source.parent.name}/{source.name}: video not converted ({error})")
        if not (target / source.name).exists():
            shutil.copy2(source, target / source.name)
        entry["file"] = source.name
    return entry


def publish_files(folder, target):
    """Copy a post's files to the site, with resized photos and converted videos."""
    target.mkdir(parents=True, exist_ok=True)
    for item in sorted(folder.iterdir()):
        if not item.is_file() or item.name == "post.md" or item.name.startswith("."):
            continue
        ext = item.suffix.lower()
        if ext in VIDEO_EXT:
            VIDEOS[item] = make_video(item, target)
            continue
        shutil.copy2(item, target / item.name)
        if ext in RASTER:
            VARIANTS[item] = make_variants(item, target)


SIZES_MEDIA = "(min-width: 768px) 46rem, 100vw"


def img_tag(src, alt="", folder=None, lazy=True, cls="", sizes=SIZES_MEDIA, prefix=""):
    """<img> with width/height (and a --ratio for CSS) and WebP copies when available."""
    attrs = f' class="{cls}"' if cls else ""
    local = folder / src if folder and "/" not in src and ":" not in src else None
    size = image_size(local) if local else None
    if size and size[0] and size[1]:
        attrs += f' width="{size[0]}" height="{size[1]}" style="--ratio:{size[0] / size[1]:.4f}"'
    variants = VARIANTS.get(local) if local else None
    if variants:
        srcset = ", ".join(f"{esc(prefix + quote(name))} {width}w" for width, name in variants)
        attrs += f' srcset="{srcset}" sizes="{sizes}"'
    if lazy:
        attrs += ' loading="lazy"'
    attrs += ' decoding="async"'
    return f'<img src="{esc(prefix + quote(src))}" alt="{esc(alt)}"{attrs}>'


# --------------------------------------------------------------------------
# Markdown (small subset: paragraphs, headings, lists, links, bold, code,
# images / video / audio on their own line, YouTube and Vimeo links)
# --------------------------------------------------------------------------

YOUTUBE = re.compile(
    r"^https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:\S*?&)?v=|shorts/|embed/)|youtu\.be/)([\w-]{11})\S*$"
)
VIMEO = re.compile(r"^https?://(?:www\.)?vimeo\.com/(\d+)\S*$")
# ![description](file "caption") loop   (caption and loop are optional)
MEDIA_LINE = re.compile(r'^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)(\s+loop)?$')


def _autolink(match):
    url = match.group(1)
    tail = ""
    while url and url[-1] in ".,;:!?)":
        url, tail = url[:-1], url[-1] + tail
    return f'<a href="{url}">{url}</a>{tail}'


def inline(text):
    text = esc(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"(?<![\"=\w/>])(https?://[^\s<]+)", _autolink, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    # Single asterisks would be italics: the design has none, so drop the marks.
    text = re.sub(r"(?<![*\w])\*(?!\s)([^*]+?)\*(?![*\w])", r"\1", text)
    return text


def media_html(src, alt="", folder=None, caption="", loop=False):
    ext = Path(src.split("?")[0]).suffix.lower()
    label = f' aria-label="{esc(alt)}"' if alt else ""
    note = f"<figcaption>{inline(caption)}</figcaption>" if caption else ""
    if ext in VIDEO_EXT:
        video = VIDEOS.get(folder / src) if folder else None
        source = esc(quote(video["file"] if video else src))
        extra = f' poster="{esc(quote(video["poster"]))}"' if video and video["poster"] else ""
        if video and video["size"]:
            extra += f' width="{video["size"][0]}" height="{video["size"][1]}" style="--ratio:{video["size"][0] / video["size"][1]:.4f}"'
        if loop:  # a short clip that plays like a living image
            return (f'<figure class="loop"><video src="{source}"{extra}{label} autoplay muted loop playsinline '
                    f'preload="auto"></video>{note}</figure>')
        return f'<figure><video src="{source}"{extra}{label} controls playsinline preload="metadata"></video>{note}</figure>'
    if ext in AUDIO_EXT:
        return f'<figure class="audio"><audio src="{esc(src)}"{label} controls preload="metadata"></audio>{note}</figure>'
    return f"<figure>{img_tag(src, alt, folder)}{note}</figure>"


def embed_html(url):
    return (
        f'<figure class="embed"><iframe src="{esc(url)}" title="Video" loading="lazy" '
        'allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" '
        "allowfullscreen></iframe></figure>"
    )


def render_markdown(body, folder=None):
    out, para, items = [], [], []

    def flush():
        if para:
            out.append("<p>" + "<br>\n".join(inline(line) for line in para) + "</p>")
            para.clear()
        if items:
            out.append("<ul>" + "".join(f"<li>{inline(item)}</li>" for item in items) + "</ul>")
            items.clear()

    for line in body.replace("\r\n", "\n").split("\n"):
        text = line.strip()
        if not text:
            flush()
            continue
        match = MEDIA_LINE.match(text)
        if match:
            flush()
            out.append(media_html(match.group(2), match.group(1), folder, match.group(3) or "", bool(match.group(4))))
            continue
        match = YOUTUBE.match(text)
        if match:
            flush()
            out.append(embed_html(f"https://www.youtube-nocookie.com/embed/{match.group(1)}"))
            continue
        match = VIMEO.match(text)
        if match:
            flush()
            out.append(embed_html(f"https://player.vimeo.com/video/{match.group(1)}"))
            continue
        match = re.match(r"^(#{1,3})\s+(.*)$", text)
        if match:
            flush()
            tag = "h3" if len(match.group(1)) == 3 else "h2"
            out.append(f"<{tag}>{inline(match.group(2))}</{tag}>")
            continue
        match = re.match(r"^[-*]\s+(.*)$", text)
        if match:
            if para:
                flush()
            items.append(match.group(1))
            continue
        if text.startswith("<"):  # raw HTML line, passed through untouched
            flush()
            out.append(text)
            continue
        if items:
            flush()
        para.append(text)
    flush()
    # Consecutive media (with only blank lines between them) form one block.
    grouped, run = [], []
    for block in out + [""]:
        if block.startswith("<figure"):
            run.append(block)
            continue
        if run:
            grouped.append('<div class="media">' + "".join(run) + "</div>")
            run = []
        if block:
            grouped.append(block)
    return "\n".join(grouped)


def plain_summary(body, limit=160):
    for block in re.split(r"\n\s*\n", body):
        text = block.strip()
        if not text or text.startswith(("!", "#", "<", "http")):
            continue
        text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
        text = re.sub(r"[*`]", "", text)
        text = " ".join(text.split())
        return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
    return ""


# --------------------------------------------------------------------------
# Content loading
# --------------------------------------------------------------------------

def load_site():
    site = json.loads((CONTENT / "site.json").read_text("utf-8"))
    site.setdefault("title", "Portfolio")
    site.setdefault("description", "")
    site["url"] = site.get("url", "").rstrip("/")
    return site


def load_posts():
    posts = []
    if not POSTS.exists():
        return posts
    for folder in sorted(p for p in POSTS.iterdir() if p.is_dir() and not p.name.startswith(".")):
        source = folder / "post.md"
        if not source.exists():
            warn(f"{folder.name}: no post.md, skipped")
            continue
        meta, body = split_front_matter(source.read_text("utf-8"))
        hidden = meta.get("draft", "").lower() in TRUE
        pinned = meta.get("pinned", "").lower() in TRUE
        cover = meta.get("cover", "")
        if not cover:
            found = sorted(f.name for f in folder.glob("cover.*"))
            cover = found[0] if found else ""
        if not cover or not (folder / cover).exists():
            warn(f"{folder.name}: cover image missing, skipped")
            continue
        # background / banner: a file of the post folder, or "true" for the cover.
        # background can also be a solid colour such as #1d2a33.
        def pick(key):
            value = meta.get(key, "")
            if not value or value.lower() in ("false", "no", "0", "none"):
                return ""
            if key == "background" and HEX_COLOR.match(value):
                return value
            name = cover if value.lower() in TRUE else value
            if not (folder / name).exists():
                warn(f"{folder.name}: {key} image {name} not found, ignored")
                return ""
            return name
        background, banner = pick("background"), pick("banner")
        bg_style = meta.get("background-style", "").lower()
        if bg_style not in BG_STYLES:
            bg_style = "faded"
        text_color = meta.get("text-color", "")
        if not HEX_COLOR.match(text_color):
            text_color = ""
        font = meta.get("font", "").lower()
        if font not in FONTS:
            font = "helvetica"
        try:
            date = datetime.date.fromisoformat(meta.get("date", "")[:10])
        except ValueError:
            date = datetime.date.fromtimestamp(source.stat().st_mtime)
            warn(f"{folder.name}: no valid date (YYYY-MM-DD), using the file date")
        posts.append(
            {
                "slug": folder.name,
                "title": meta.get("title") or folder.name,
                "date": date,
                "cover": cover,
                "body": body,
                "description": meta.get("description") or plain_summary(body),
                "folder": folder,
                "hidden": hidden,
                "pinned": pinned,
                "background": background,
                "banner": banner,
                "bg_style": bg_style,
                "text_color": text_color,
                "font": font,
            }
        )
    # Pinned posts first, then newest first.
    posts.sort(key=lambda post: (post["pinned"], post["date"], post["slug"]), reverse=True)
    return posts


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------

def page(site, *, title, description, root, body, body_class, version, path="", image="", head="", foot="",
         body_style="", robots=""):
    full_title = site["title"] if not title else f"{title} — {site['title']}"
    meta = [f'<meta property="og:title" content="{esc(title or site["title"])}">']
    if description:
        meta.insert(0, f'<meta name="description" content="{esc(description)}">')
        meta.append(f'<meta property="og:description" content="{esc(description)}">')
    if site["url"]:
        meta.append(f'<meta property="og:url" content="{esc(site["url"] + "/" + path)}">')
        meta.append(f'<link rel="canonical" href="{esc(site["url"] + "/" + path)}">')
        if image:
            meta.append(f'<meta property="og:image" content="{esc(site["url"] + "/" + image)}">')
            meta.append('<meta name="twitter:card" content="summary_large_image">')
    if robots:
        meta.append(f'<meta name="robots" content="{robots}">')
    if site.get("_favicon"):
        meta.append(f'<link rel="icon" type="image/png" href="{root}favicon.png">')
        meta.append(f'<link rel="apple-touch-icon" href="{root}apple-touch-icon.png">')
    meta.append(f'<link rel="alternate" type="application/rss+xml" title="{esc(site["title"])}" href="{root}feed.xml">')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(full_title)}</title>
{chr(10).join(meta)}
<link rel="stylesheet" href="{root}assets/style.css?v={version}">
{head}</head>
<body class="{body_class}"{f' style="{body_style}"' if body_style else ""}>
{body}
{foot}<script src="{root}assets/app.js?v={version}"></script>
</body>
</html>
"""


SIZES_FULL = "(min-width: 768px) 75vh, 100vw"  # home, full screen (app.js switches it for the grid)


def home_page(site, posts, version):
    with_reactions = bool((site.get("options") or {}).get("home_reactions"))
    if posts:
        def overlay(p):
            if not with_reactions:
                return ""
            buttons = "".join(
                f'<button class="reaction" type="button" data-kind="{kind}" aria-pressed="false" '
                f'aria-label="{kind.capitalize()}">{ICONS[kind]}<span class="count"></span></button>'
                for kind in REACTIONS
            )
            return (f'<div class="item-reactions" data-post="{esc(p["slug"])}" role="group" '
                    f'aria-label="Reactions to {esc(p["title"])}">{buttons}</div>'
                    '<span class="item-top" aria-hidden="true"></span>')
        items = "\n".join(
            f'<div class="item"><a class="item-link" href="posts/{quote(p["slug"])}/">'
            + img_tag(p["cover"], p["title"], p["folder"], lazy=index > 0, sizes=SIZES_FULL,
                      prefix=f'posts/{quote(p["slug"])}/')
            + f'<span class="item-title" aria-hidden="true">{esc(p["title"])}</span></a>{overlay(p)}</div>'
            for index, p in enumerate(posts)
        )
        rows = "\n".join(
            f'<li><a href="posts/{quote(p["slug"])}/"><span>{esc(p["title"])}</span>'
            f'<time datetime="{p["date"].isoformat()}">{p["date"].strftime("%d.%m.%Y")}</time></a></li>'
            for p in posts
        )
    else:
        items = '<p class="empty">No posts yet.</p>'
        rows = ""
    body = f"""<a class="corner corner-left" href="about/" aria-label="About and contact">{ICONS["info"]}</a>
<button class="corner corner-right" id="mode" type="button" aria-label="Switch view">{ICONS["grid"]}{ICONS["list"]}{ICONS["expand"]}</button>
<h1 class="visually-hidden">{esc(site["title"])}</h1>
<main class="feed" id="feed">
{items}
</main>
<nav class="index" id="index" aria-label="All posts">
<ol>
{rows}
</ol>
</nav>"""
    head = ('<script>document.documentElement.dataset.mode='
            '{"#grid":"grid","#index":"index"}[location.hash]||"full"</script>\n')
    image = f'posts/{quote(posts[0]["slug"])}/{quote(posts[0]["cover"])}' if posts else ""
    foot = reactions_config(site) if with_reactions else ""
    return page(site, title="", description=site["description"], root="", body=body,
                body_class="home", version=version, image=image, head=head, foot=foot)


def reactions_config(site):
    config = site.get("reactions") or {}
    return "<script>window.SITE_REACTIONS=" + json.dumps(
        {"url": config.get("supabase_url", "").rstrip("/"), "key": config.get("supabase_anon_key", "")}
    ) + "</script>\n"


def reactions_html(slug):
    buttons = "".join(
        f'<button class="reaction" type="button" data-kind="{kind}" aria-pressed="false" '
        f'aria-label="{kind.capitalize()}" title="{kind.capitalize()}">{ICONS[kind]}'
        '<span class="count"></span></button>'
        for kind in REACTIONS
    )
    note = (
        "Non-binary reactions: no likes, no dislikes. Pick the weather this post leaves you in. "
        "One per visitor, anonymous. Tap it again to take it back."
    )
    return (
        f'<section class="reactions-box"><div class="reactions" data-post="{esc(slug)}" role="group" '
        f'aria-label="Reactions" aria-describedby="reactions-note">{buttons}'
        '<button class="reactions-info" type="button" aria-expanded="false" aria-controls="reactions-note" '
        'aria-label="About these reactions">*</button></div>'
        f'<p class="reactions-note" id="reactions-note">{esc(note)}</p></section>'
    )


def post_page(site, post, version):
    date = post["date"]
    cover = quote(post["cover"])
    folder = post["folder"]
    body_class = f"page font-{post['font']}"
    style = []
    head = ""
    if post["font"] != "helvetica":
        head += f'<link rel="stylesheet" href="../../assets/fonts/fonts.css?v={version}">\n'
    intro = ""
    background = post["background"]
    text_color = post["text_color"]
    if background and HEX_COLOR.match(background):
        # Solid colour: the text shows straight away.
        body_class += " bg-color"
        style.append(f"--page-bg:{background}")
        text_color = text_color or ("#ffffff" if is_dark(background) else "#111111")
    elif background:
        # The image fills the screen behind the text, in the chosen style.
        intro = f'<div class="post-bg" aria-hidden="true">{img_tag(background, "", folder, lazy=False, sizes="100vw")}</div>\n'
        body_class += f" has-bg bg-{post['bg_style']}"
    if text_color:
        style.append(f"--post-ink:{text_color}")
    banner_block = ""
    if post["banner"]:
        banner_block = f'<div class="post-banner">{img_tag(post["banner"], "", folder, lazy=False)}</div>\n'
        body_class += " has-banner"
    body = f"""<a class="corner corner-left" href="../../" data-back aria-label="Back">{ICONS["back"]}</a>
{intro}<main id="post">
<article class="post">
{banner_block}<header class="post-head">
<h1>{esc(post["title"])}</h1>
<time datetime="{date.isoformat()}">{date.day} {date.strftime("%B %Y")}</time>
</header>
<div class="post-body">
{render_markdown(post["body"], folder)}
</div>
</article>
{reactions_html(post["slug"])}
</main>"""
    foot = reactions_config(site)
    slug = quote(post["slug"])
    return page(site, title=post["title"], description=post["description"], root="../../", body=body,
                body_class=body_class, version=version, path=f"posts/{slug}/",
                image=f"posts/{slug}/{cover}", head=head, foot=foot, body_style=";".join(style),
                robots="noindex" if post["hidden"] else "")


def about_page(site, version):
    source = CONTENT / "about.md"
    text = render_markdown(source.read_text("utf-8")) if source.exists() else ""
    links = "".join(
        f'<li><a href="{esc(link.get("url", ""))}">{esc(link.get("label", ""))}</a></li>'
        for link in site.get("contact", [])
    )
    contact = f'<h2 id="contact">Contact</h2>\n<ul class="links">{links}</ul>' if links else ""
    body = f"""<a class="corner corner-left" href="../" data-back aria-label="Back">{ICONS["back"]}</a>
<main class="prose">
<h1>About</h1>
{text}
{contact}
</main>"""
    return page(site, title="About", description=site["description"], root="../", body=body,
                body_class="page", version=version, path="about/")


def not_found_page(site, version):
    body = f"""<a class="corner corner-left" href="./" aria-label="Home">{ICONS["back"]}</a>
<main class="prose"><h1>Not found</h1><p>This page does not exist.</p></main>"""
    return page(site, title="Not found", description="", root="", body=body, body_class="page", version=version)


def admin_page(site, version):
    config = json.dumps({"repo": site.get("repo", ""), "branch": site.get("branch", "main")})
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Editor — {esc(site["title"])}</title>
<link rel="stylesheet" href="../assets/style.css?v={version}">
</head>
<body class="page admin">
<a class="corner corner-left" href="../" aria-label="Back to the site">{ICONS["back"]}</a>
<main class="prose">
<h1>Editor</h1>
<details id="settings">
<summary>Connection</summary>
<label>Repository<input id="repo" placeholder="owner/name" autocapitalize="off" autocomplete="off"></label>
<label>Branch<input id="branch" autocapitalize="off" autocomplete="off"></label>
<label>Access token<input id="token" type="password" autocomplete="off"></label>
<p class="hint">A fine-grained GitHub token limited to this repository, with read and write access to Contents. It is kept in this browser only and sent only to api.github.com.</p>
</details>
<label>Post<select id="post"><option value="">New post</option><option value="@about">About page</option><option value="@settings">Site settings</option></select></label>
<div class="post-only">
<label>Title<input id="title" autocomplete="off"></label>
<label>Date<input id="date" type="date"></label>
<label>Address<input id="slug" autocapitalize="off" autocomplete="off"></label>
<p class="hint" id="slug-note"></p>
<label>Cover image (home page)<input id="cover" type="file" accept="image/*"></label>
<p class="hint" id="cover-note"></p>
</div>
<div class="text-block">
<label>Text<textarea id="text" rows="14"></textarea></label>
<p class="hint">Blank line for a new paragraph. **bold**, [link text](https://…), ## heading. A YouTube or Vimeo link on its own line becomes a player. Use "text" next to a file below for its description and caption.</p>
</div>
<div class="settings-only" hidden>
<label class="check"><input id="opt-home-reactions" type="checkbox">Reactions on the home page: all of them on the right of each photo in full screen, the most chosen one on each photo in the grid</label>
</div>
<div class="about-only" hidden>
<label>Contact links, one per line: label | address<textarea id="contacts" rows="5" autocapitalize="off"></textarea></label>
<p class="hint">For example: Email | mailto:name@example.com</p>
</div>
<div class="post-only">
<label>Add images, video or audio at the cursor<input id="media" type="file" multiple accept="image/*,video/*,audio/*"></label>
<ul class="links" id="media-list"></ul>
<p class="hint">bg: the image used by the Background option below (without one, the cover). banner: shown above the title. Flagged images are taken out of the text.</p>
<label>Font<select id="font">
<option value="helvetica">Helvetica</option>
<option value="oswald">Oswald</option>
<option value="typewriter">Typewriter (Courier Prime)</option>
</select></label>
<label>Background<select id="bg-style">
<option value="">None (white page)</option>
<option value="faded">Image, faded and blurred</option>
<option value="bw">Image, black and white, darkened</option>
<option value="difference">Image as it is, text in difference</option>
<option value="color">Solid colour</option>
</select></label>
<p class="hint" id="bg-note"></p>
<label id="bg-color-row" hidden>Background colour<input id="bg-color" type="color" value="#1d2a33"></label>
<label>Text colour<select id="text-color-mode">
<option value="">Automatic</option>
<option value="#111111">Black</option>
<option value="#ffffff">White</option>
<option value="#8c8c8c">Grey</option>
<option value="custom">Custom</option>
</select></label>
<label id="text-color-row" hidden>Custom text colour<input id="text-color" type="color" value="#111111"></label>
<label class="check"><input id="hidden" type="checkbox">Hidden (draft): saved, but not shown on the site</label>
<label class="check"><input id="pinned" type="checkbox">Pinned to the top</label>
</div>
<div class="actions">
<button class="button" id="publish" type="button">Publish</button>
<button class="button quiet" id="delete" type="button" hidden>Delete post</button>
</div>
<p class="hint"><a id="preview" href="#" target="_blank" rel="noopener" hidden>Preview this hidden post (address not listed anywhere)</a></p>
<p id="status" role="status"></p>
</main>
<script>window.SITE_CONFIG={config};</script>
<script src="admin.js?v={version}"></script>
</body>
</html>
"""


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def feed_xml(site, posts):
    """RSS 2.0 feed of the published posts."""
    base = site["url"]
    items = []
    for p in posts[:30]:
        link = f'{base}/posts/{quote(p["slug"])}/'
        when = datetime.datetime.combine(p["date"], datetime.time(12), datetime.timezone.utc)
        cover = f'{base}/posts/{quote(p["slug"])}/{quote(p["cover"])}'
        summary = esc(f'<p><img src="{cover}" alt=""></p><p>{esc(p["description"])}</p>')
        items.append(f"""<item>
<title>{esc(p["title"])}</title>
<link>{link}</link>
<guid>{link}</guid>
<pubDate>{format_datetime(when)}</pubDate>
<description>{summary}</description>
</item>""")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
<channel>
<title>{esc(site["title"])}</title>
<link>{base}/</link>
<description>{esc(site["description"])}</description>
{chr(10).join(items)}
</channel>
</rss>
"""


def make_favicon(site):
    """Round favicon from the GitHub profile picture of the repository owner."""
    owner = (site.get("repo") or "").split("/")[0]
    if not owner or Image is None:
        return False
    cache = CACHE / "favicon"
    source = cache / "avatar.png"
    try:
        cache.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"https://github.com/{quote(owner)}.png?size=360", timeout=15) as response:
            source.write_bytes(response.read())
    except OSError:
        if not source.exists():
            warn_once("favicon", "could not fetch the GitHub profile picture: no favicon")
            return False
    with Image.open(source) as avatar:
        avatar = ImageOps.fit(avatar.convert("RGB"), (360, 360))
        mask = Image.new("L", (1440, 1440), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 1439, 1439), fill=255)
        mask = mask.resize((360, 360), Image.LANCZOS)  # smooth edge
        round_icon = avatar.copy()
        round_icon.putalpha(mask)
        round_icon.resize((64, 64), Image.LANCZOS).save(OUT / "favicon.png")
        touch = Image.new("RGB", (360, 360), "black")
        touch.paste(avatar, (0, 0), mask)
        touch.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    return True


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, "utf-8")


def build():
    site = load_site()
    everything = load_posts()
    posts = [post for post in everything if not post["hidden"]]  # hidden posts are not published
    digest = hashlib.sha1()
    for name in ("style.css", "app.js", "admin.js", "fonts/fonts.css"):
        digest.update((SRC / name).read_bytes())
    version = digest.hexdigest()[:8]

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    (OUT / ".nojekyll").write_text("")
    shutil.copy2(SRC / "style.css", OUT / "assets" / "style.css")
    shutil.copy2(SRC / "app.js", OUT / "assets" / "app.js")
    shutil.copytree(SRC / "fonts", OUT / "assets" / "fonts")

    static = CONTENT / "static"  # optional: favicon, CNAME, robots.txt ...
    if static.exists():
        shutil.copytree(static, OUT, dirs_exist_ok=True)

    site["_favicon"] = make_favicon(site)

    # Hidden posts are built too, at an unlisted address (noindex) so they can be
    # previewed; they are left out of the home page and the feed.
    for post in everything:
        publish_files(post["folder"], OUT / "posts" / post["slug"])

    write(OUT / "index.html", home_page(site, posts, version))
    write(OUT / "feed.xml", feed_xml(site, posts))
    write(OUT / "about" / "index.html", about_page(site, version))
    write(OUT / "404.html", not_found_page(site, version))
    write(OUT / "admin" / "index.html", admin_page(site, version))
    shutil.copy2(SRC / "admin.js", OUT / "admin" / "admin.js")

    for post in everything:
        write(OUT / "posts" / post["slug"] / "index.html", post_page(site, post, version))

    # Read by the editor; hidden posts are listed here so they can be reopened.
    index = [
        {"slug": p["slug"], "title": p["title"], "date": p["date"].isoformat(), "cover": p["cover"],
         "hidden": p["hidden"], "pinned": p["pinned"]}
        for p in everything
    ]
    write(OUT / "posts.json", json.dumps(index, ensure_ascii=False, indent=1))
    hidden = len(everything) - len(posts)
    print(f"Built {len(posts)} posts into {OUT.name}/" + (f" ({hidden} hidden)" if hidden else ""))


def serve(port):
    from functools import partial
    from http.server import HTTPServer, SimpleHTTPRequestHandler

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0].endswith("/"):
                build()  # pick up edits on every page load
            super().do_GET()

        def log_message(self, *args):
            pass

    build()
    print(f"Preview at http://localhost:{port}  (Ctrl+C to stop)")
    try:
        HTTPServer(("", port), partial(Handler, directory=str(OUT))).serve_forever()
    except KeyboardInterrupt:
        pass


def new_post(title, cover, media):
    cover = Path(cover).expanduser()
    files = [Path(item).expanduser() for item in media]
    for item in [cover, *files]:
        if not item.is_file():
            sys.exit(f"File not found: {item}")
    slug = base = slugify(title)
    counter = 2
    while (POSTS / slug).exists():
        slug = f"{base}-{counter}"
        counter += 1
    folder = POSTS / slug
    folder.mkdir(parents=True)
    cover_name = "cover" + cover.suffix.lower()
    shutil.copy2(cover, folder / cover_name)
    lines = ["Write the text here.", ""]
    for item in files:
        name = re.sub(r"[^a-z0-9.]+", "-", item.name.lower()).strip("-")
        shutil.copy2(item, folder / name)
        lines += [f"![]({name})", ""]
    front = f"---\ntitle: {title}\ndate: {datetime.date.today().isoformat()}\ncover: {cover_name}\n---\n\n"
    (folder / "post.md").write_text(front + "\n".join(lines), "utf-8")
    print(f"Created {folder.relative_to(ROOT)}/post.md")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        build()
    elif args[0] == "serve":
        serve(int(args[1]) if len(args) > 1 else 8000)
    elif args[0] == "new" and len(args) >= 3:
        new_post(args[1], args[2], args[3:])
    else:
        sys.exit(__doc__)
