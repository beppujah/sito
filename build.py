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
    # Geometric shapes drawn as if by hand: fixed small irregularities
    # (made with a seeded generator, so they stay the same between builds).
    # Circled "i": opens the about + contact page.
    "info": svg('<path d="M8.99 3.74C9.73 3.66 11.96 3.09 13.39 3.28C14.83 3.46 16.43 3.99 17.61 4.85C18.8 5.71 19.91 7.08 20.49 8.44C21.07 9.8 21.28 11.53 21.11 13.01C20.93 14.48 20.32 16.09 19.46 17.3C18.6 18.51 17.29 19.64 15.95 20.26C14.61 20.89 12.91 21.16 11.44 21.05C9.97 20.93 8.4 20.37 7.14 19.59C5.88 18.81 4.66 17.66 3.89 16.37C3.11 15.08 2.52 13.38 2.51 11.87C2.5 10.36 3.01 8.58 3.8 7.3C4.6 6.01 5.96 4.88 7.27 4.15C8.58 3.43 10.95 3.14 11.68 2.94"/><path d="M12.1 10.8Q11.97 13.85 11.9 16.9"/><circle cx="12.15" cy="7.7" r="0.6" fill="currentColor" stroke="none"/>'),
    # Back to the posts: a small stack of photos.
    "back": svg('<path d="M5.5 9.05l13.03-.18.12 11.08-13.1.08z"/><path d="M7.4 6.1Q12 6.14 16.6 5.9"/><path d="M9.6 3.6Q12.05 3.44 14.5 3.4"/>'),
    # Grid view.
    "grid": svg('<path d="M4.6 4.6l6-.15.1 6.05-6.05.05z"/><path d="M13.4 4.5l6.05.12-.08 6-5.97-.08z"/><path d="M4.5 13.55l6.03.08-.08 5.92-5.9.1z"/><path d="M13.5 13.45l5.95.12.07 5.98-6.02.03z"/>', cls="icon-grid"),
    # Index: a list of lines.
    "list": svg('<path d="M4.5 7.1Q12 6.92 19.5 6.85"/><path d="M4.5 12Q11.9 12.34 19.3 12.2"/><path d="M4.6 17.05Q12.1 16.75 19.6 16.9"/>', cls="icon-list"),
    # Full screen: two diagonal arrows.
    "expand": svg('<path d="M14.5 4.5l5.05-.05.02 5.05"/><path d="M19.55 4.45l-6.05 6.08"/><path d="M9.5 19.55l-5.05.02.02-5.05"/><path d="M4.47 19.55l6.05-6.03"/>', cls="icon-expand"),
    "sun": svg('<path d="M15.86 5.32C16.34 5.76 18.06 6.88 18.76 7.95C19.46 9.02 19.99 10.46 20.04 11.74C20.09 13.02 19.7 14.53 19.07 15.64C18.44 16.75 17.35 17.74 16.28 18.42C15.2 19.09 13.88 19.54 12.62 19.67C11.36 19.81 9.9 19.71 8.71 19.24C7.52 18.76 6.25 17.86 5.47 16.83C4.68 15.79 4.15 14.33 4.01 13.04C3.87 11.74 4.12 10.26 4.61 9.06C5.1 7.86 5.97 6.65 6.96 5.83C7.96 5.01 9.32 4.38 10.59 4.15C11.86 3.92 13.35 4.07 14.58 4.47C15.81 4.88 17.42 6.25 17.99 6.61"/><path d="M13.61 13.99C13.26 14.26 12.83 14.57 12.39 14.65C11.94 14.73 11.34 14.7 10.93 14.5C10.52 14.3 10.13 13.84 9.91 13.44C9.69 13.04 9.6 12.53 9.59 12.08C9.58 11.63 9.66 11.14 9.84 10.75C10.03 10.35 10.35 9.94 10.71 9.69C11.07 9.43 11.57 9.28 12.02 9.24C12.47 9.2 12.98 9.26 13.41 9.44C13.83 9.61 14.31 9.93 14.56 10.31C14.82 10.69 14.97 11.26 14.96 11.71C14.94 12.16 14.7 12.64 14.48 13.02C14.26 13.4 13.95 13.72 13.61 13.99z" fill="currentColor" stroke="none"/>'),
    "moon": svg('<path d="M10.65 19.67C10.02 19.41 7.88 18.96 6.86 18.13C5.84 17.31 4.93 15.96 4.53 14.72C4.12 13.48 4.16 11.93 4.44 10.67C4.71 9.4 5.37 8.12 6.18 7.12C7 6.12 8.14 5.18 9.34 4.69C10.54 4.2 12.09 3.98 13.38 4.2C14.66 4.41 16.07 5.11 17.06 5.97C18.06 6.82 18.91 8.1 19.34 9.33C19.78 10.56 19.93 12.08 19.69 13.36C19.45 14.63 18.77 16 17.92 16.97C17.07 17.94 15.83 18.74 14.62 19.19C13.4 19.64 11.62 19.66 10.65 19.67C9.68 19.67 9.1 19.29 8.79 19.22"/><path d="M12 19.72C11.5 19.65 9.93 19.63 8.98 19.29C8.04 18.95 7.05 18.38 6.33 17.67C5.61 16.96 4.99 15.99 4.64 15.05C4.29 14.1 4.17 12.99 4.23 12C4.29 11.01 4.58 9.99 4.98 9.09C5.37 8.19 5.94 7.33 6.62 6.62C7.29 5.91 8.13 5.25 9.03 4.83C9.93 4.41 11.5 4.22 12 4.1Q12.45 12 12 19.72z" fill="currentColor" stroke="none"/>'),
    "rain": svg('<path d="M7.1 5.2Q6.98 9.45 6.8 13.7"/><path d="M12.1 8.2Q12.12 13.6 11.8 19"/><path d="M16.9 4.9Q16.91 8.36 16.6 11.8"/>'),
    "cloud": svg('<path d="M7.7 8.55h8.75c2 0 3.75 1.55 3.75 3.5s-1.7 3.5-3.7 3.5H7.5c-2 0-3.7-1.55-3.7-3.5S5.5 8.5 7.9 8.5h1"/>'),
    "leaf": svg('<path d="M5.1 19C4.8 10.7 10.3 5.1 18.95 4.95c.35 8.4-5 14-13.6 14.1-.3 0-.55 0-.85-.05"/>'),
    "water": svg('<path d="M3 12.2C3.38 11.84 4.5 10.07 5.25 10.05C6 10.03 6.74 11.43 7.5 12.1C8.26 12.77 9.04 14.07 9.8 14.05C10.56 14.03 11.29 12.68 12.05 12C12.81 11.32 13.59 9.94 14.35 9.95C15.11 9.96 15.84 11.38 16.6 12.05C17.36 12.72 18.17 13.94 18.9 13.95C19.63 13.96 20.65 12.41 21 12.1"/>'),
    "wind": svg('<path d="M4 8.1Q10.1 7.91 16.2 7.8"/><path d="M4.1 12Q12.1 12.32 20.1 12.25"/><path d="M4 16.1Q8.2 15.85 12.4 15.9"/>'),
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
        if not item.is_file() or item.name in ("post.md", "post.it.md") or item.name.startswith("."):
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


def _link(match):
    url = match.group(2)
    if url.lower().startswith("www."):  # [text](www.example.com) is not a page of this site
        url = "https://" + url
    return f'<a href="{url}">{match.group(1)}</a>'


def inline(text):
    text = esc(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", _link, text)
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


def expand_hex(color):
    """#abc -> #aabbcc (the colour fields of the editor only take six digits)."""
    if len(color) == 4:
        return "#" + "".join(c * 2 for c in color[1:])
    return color


def home_colors(site):
    """Background and text / icon colour of the home page (site.json "options":
    "home_background", "home_text_color"). Without a text colour, black or
    white is picked from the background, as on posts."""
    options = site.get("options") or {}
    background = str(options.get("home_background") or "")
    background = expand_hex(background).lower() if HEX_COLOR.match(background) else "#000000"
    ink = str(options.get("home_text_color") or "")
    ink = expand_hex(ink).lower() if HEX_COLOR.match(ink) else ("#ffffff" if is_dark(background) else "#111111")
    return background, ink


def page_looks(folder, meta, cover=""):
    """Background, banner, text colour and font of a post or of the about page."""
    # background / banner: a file of the folder, or "true" for the cover.
    # background can also be a solid colour such as #1d2a33.
    def pick(key):
        value = meta.get(key, "")
        if not value or value.lower() in ("false", "no", "0", "none"):
            return ""
        if key == "background" and HEX_COLOR.match(value):
            return value
        name = cover if value.lower() in TRUE else value
        if not name or not (folder / name).exists():
            warn(f"{folder.name}: {key} image {name or '(none)'} not found, ignored")
            return ""
        return name
    bg_style = meta.get("background-style", "").lower()
    text_color = meta.get("text-color", "")
    font = meta.get("font", "").lower()
    return {
        "background": pick("background"),
        "banner": pick("banner"),
        "bg_style": bg_style if bg_style in BG_STYLES else "faded",
        "text_color": text_color if HEX_COLOR.match(text_color) else "",
        "font": font if font in FONTS else "helvetica",
    }


# Second language. A post (or the about page) is translated when its folder
# has post.it.md: a header with the title, then the text. Media, background,
# banner, font and colours come from post.md.
LANGS = {"en": "English", "it": "Italiano"}
WORDS = {
    "en": {"contact": "Contact", "back": "Back to the posts",
           "note": "Non-binary reactions.<br>Leave one, if you wish.<br>Anonymously."},
    "it": {"contact": "Contatti", "back": "Torna ai post",
           "note": "Reazioni non binarie.<br>Lasciane una, se vuoi.<br>In forma anonima."},
}
MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
             "settembre", "ottobre", "novembre", "dicembre"]


def load_translation(folder):
    source = folder / "post.it.md" if folder else None
    if not source or not source.exists():
        return None
    meta, body = split_front_matter(source.read_text("utf-8"))
    if not body.strip() and not meta.get("title"):
        return None
    return {"title": meta.get("title", ""), "body": body, "description": plain_summary(body)}


def long_date(date, lang):
    if lang == "it":
        return f"{date.day} {MONTHS_IT[date.month - 1]} {date.year}"
    return f"{date.day} {date.strftime('%B %Y')}"


def lang_switch(current, has_it):
    """EN / IT in the top right corner; the other language links to its page."""
    if not has_it:
        return ""
    other = "./" if current == "it" else "it/"  # Italian pages use <base href="../">
    links = "".join(
        f'<a lang="{code}" hreflang="{code}" aria-current="page">{code.upper()}</a>' if code == current
        else f'<a href="{other}" lang="{code}" hreflang="{code}" data-lang="{code}" aria-label="{LANGS[code]}">{code.upper()}</a>'
        for code in LANGS
    )
    return f'<nav class="corner corner-right lang-switch" aria-label="Language">{links}</nav>\n'


def sort_posts(posts, order):
    """Pinned posts first; then posts not yet placed by hand (newest first);
    then the order set in the editor (site.json "order")."""
    rank = {slug: index for index, slug in enumerate(order)}
    return sorted(posts, key=lambda p: (
        not p["pinned"],
        p["slug"] in rank,
        rank.get(p["slug"], 0),
        -p["date"].toordinal(),
        p["slug"],
    ))


def load_about():
    """The about page: content/about/post.md with its own media (or the older content/about.md)."""
    folder = CONTENT / "about"
    source = folder / "post.md"
    if not source.exists():
        legacy = CONTENT / "about.md"
        return {"title": "About", "body": legacy.read_text("utf-8") if legacy.exists() else "", "folder": None,
                "it": None, **page_looks(folder, {})}
    meta, body = split_front_matter(source.read_text("utf-8"))
    return {"title": meta.get("title") or "About", "body": body, "folder": folder, "it": load_translation(folder),
            **page_looks(folder, meta)}


def about_sections(site):
    """Sections under the about text (site.json "sections"): a title and a text
    in Markdown each, with optional Italian versions (title_it, text_it).
    Older sites have "contact" instead, a list of label + url: one Contact section."""
    if isinstance(site.get("sections"), list):
        return [s for s in site["sections"] if isinstance(s, dict)]
    lines = []
    for link in site.get("contact") or []:
        label, url = link.get("label", ""), link.get("url", "")
        is_link = re.match(r"^(https?://|mailto:|tel:|www\.)\S+$", url)
        lines.append(f"- [{label}]({url})" if is_link else f"- {label}: {url}")
    if not lines:
        return []
    return [{"title": WORDS["en"]["contact"], "title_it": WORDS["it"]["contact"], "text": "\n".join(lines)}]


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
        looks = page_looks(folder, meta, cover)
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
                "it": load_translation(folder),
                "hidden": hidden,
                "pinned": pinned,
                **looks,
            }
        )
    # Pinned posts first, then newest first.
    posts.sort(key=lambda post: (post["pinned"], post["date"], post["slug"]), reverse=True)
    return posts


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------

def page(site, *, title, description, root, body, body_class, version, path="", image="", head="", foot="",
         body_style="", robots="", lang="en", base=""):
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
    # Add to Home Screen: name, icons and colours of the installed site (see make_manifest, src/sw.js).
    meta.append(f'<link rel="manifest" href="{root}manifest.webmanifest">')
    meta.append('<meta name="mobile-web-app-capable" content="yes">')
    meta.append('<meta name="apple-mobile-web-app-capable" content="yes">')
    # Installed on an iPhone: the page runs under the status bar (white clock and
    # battery). Full screen photos reach the top edge; elsewhere style.css puts a
    # black strip behind the status bar.
    meta.append('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')
    meta.append(f'<meta name="apple-mobile-web-app-title" content="{esc(site["title"])}">')
    meta.append(f'<link rel="alternate" type="application/rss+xml" title="{esc(site["title"])}" href="{root}feed.xml">')
    base_tag = f'<base href="{base}">\n' if base else ""
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
{base_tag}<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
    background, ink = home_colors(site)
    if (background, ink) != ("#000000", "#ffffff"):  # the defaults are in style.css
        head += f"<style>:root{{--home-bg:{background};--home-ink:{ink}}}</style>\n"
    image = f'posts/{quote(posts[0]["slug"])}/{quote(posts[0]["cover"])}' if posts else ""
    foot = reactions_config(site) if with_reactions else ""
    return page(site, title="", description=site["description"], root="", body=body,
                body_class="home", version=version, image=image, head=head, foot=foot)


def reactions_config(site):
    config = site.get("reactions") or {}
    return "<script>window.SITE_REACTIONS=" + json.dumps(
        {"url": config.get("supabase_url", "").rstrip("/"), "key": config.get("supabase_anon_key", "")}
    ) + "</script>\n"


def reactions_html(slug, lang="en"):
    buttons = "".join(
        f'<button class="reaction" type="button" data-kind="{kind}" aria-pressed="false" '
        f'aria-label="{kind.capitalize()}" title="{kind.capitalize()}">{ICONS[kind]}'
        '<span class="count"></span></button>'
        for kind in REACTIONS
    )
    note = WORDS[lang]["note"]
    return (
        f'<section class="reactions-box"><div class="reactions" data-post="{esc(slug)}" role="group" '
        f'aria-label="Reactions" aria-describedby="reactions-note">{buttons}'
        '<button class="reactions-info" type="button" aria-expanded="false" aria-controls="reactions-note" '
        'aria-label="About these reactions">*</button></div>'
        f'<p class="reactions-note" id="reactions-note">{note}</p></section>'
    )


def apply_looks(item, version, root):
    """Classes, inline style, head tags, background and banner blocks for a page's looks."""
    folder = item["folder"]
    body_class = f"page font-{item['font']}"
    style = []
    head = ""
    if item["font"] != "helvetica":
        head += f'<link rel="stylesheet" href="{root}assets/fonts/fonts.css?v={version}">\n'
    intro = ""
    background = item["background"]
    text_color = item["text_color"]
    if background and HEX_COLOR.match(background):
        # Solid colour.
        body_class += " bg-color"
        style.append(f"--page-bg:{background}")
        text_color = text_color or ("#ffffff" if is_dark(background) else "#111111")
    elif background:
        # The image fills the screen behind the text, in the chosen style.
        intro = f'<div class="post-bg" aria-hidden="true">{img_tag(background, "", folder, lazy=False, sizes="100vw")}</div>\n'
        body_class += f" has-bg bg-{item['bg_style']}"
    if text_color:
        style.append(f"--post-ink:{text_color}")
    banner_block = ""
    if item["banner"]:
        banner_block = f'<div class="post-banner">{img_tag(item["banner"], "", folder, lazy=False)}</div>\n'
        body_class += " has-banner"
    return body_class, style, head, intro, banner_block


def post_page(site, post, version, lang="en"):
    date = post["date"]
    cover = quote(post["cover"])
    folder = post["folder"]
    it = post["it"] if lang == "it" else None
    title = (it and it["title"]) or post["title"]
    text = it["body"] if it else post["body"]
    body_class, style, head, intro, banner_block = apply_looks(post, version, "../../")
    body = f"""<a class="corner corner-left" href="../../" data-back aria-label="{WORDS[lang]["back"]}">{ICONS["back"]}</a>
{lang_switch(lang, bool(post["it"]))}{intro}<main id="post">
<article class="post">
{banner_block}<header class="post-head">
<h1>{esc(title)}</h1>
<time datetime="{date.isoformat()}">{long_date(date, lang)}</time>
</header>
<div class="post-body">
{render_markdown(text, folder)}
</div>
</article>
{reactions_html(post["slug"], lang)}
</main>"""
    foot = reactions_config(site)
    slug = quote(post["slug"])
    return page(site, title=title, description=it["description"] if it else post["description"], root="../../",
                body=body, body_class=body_class, version=version,
                path=f"posts/{slug}/" + ("it/" if lang == "it" else ""),
                image=f"posts/{slug}/{cover}", head=head, foot=foot, body_style=";".join(style),
                robots="noindex" if post["hidden"] else "", lang=lang, base="../" if lang == "it" else "")


def about_page(site, about, version, lang="en"):
    it = about["it"] if lang == "it" else None
    title = (it and it["title"]) or about["title"]
    text = it["body"] if it else about["body"]
    body_class, style, head, intro, banner_block = apply_looks(about, version, "../")
    sections = []
    for section in about_sections(site):
        # Italian page: the Italian title and text, or the English ones where missing.
        heading = (lang == "it" and section.get("title_it")) or section.get("title") or ""
        words = (lang == "it" and section.get("text_it")) or section.get("text") or ""
        if not (heading.strip() or words.strip()):
            continue
        html = render_markdown(words, about["folder"]).replace("<ul>", '<ul class="links">')
        sections.append((f"<h2>{inline(heading.strip())}</h2>\n" if heading.strip() else "") + html)
    extra = "\n".join(sections)
    body = f"""<a class="corner corner-left" href="../" data-back aria-label="{WORDS[lang]["back"]}">{ICONS["back"]}</a>
{lang_switch(lang, bool(about["it"]))}{intro}<main id="post">
<article class="post">
{banner_block}<header class="post-head">
<h1>{esc(title)}</h1>
</header>
<div class="post-body">
{render_markdown(text, about["folder"])}
{extra}
</div>
</article>
</main>"""
    return page(site, title=title, description=site["description"], root="../", body=body,
                body_class=body_class, version=version, path="about/" + ("it/" if lang == "it" else ""),
                head=head, body_style=";".join(style), lang=lang, base="../" if lang == "it" else "")


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
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
<label>Post<select id="post"><option value="">New post</option><option value="@about">About page</option><option value="@settings">Site settings</option><option value="@bulk">All posts: hide, show, delete</option></select></label>
<div class="post-only">
<div class="lang-tabs" role="tablist" aria-label="Language of title and text">
<button type="button" role="tab" id="tab-en" aria-selected="true">English</button>
<button type="button" role="tab" id="tab-it" aria-selected="false">Italiano</button>
</div>
<label class="lang-en">Title<input id="title" autocomplete="off"></label>
<label class="lang-it" hidden>Titolo (italiano)<input id="title-it" autocomplete="off" lang="it"></label>
<div class="not-about">
<label>Date<input id="date" type="date"></label>
<label>Address<input id="slug" autocapitalize="off" autocomplete="off"></label>
<p class="hint" id="slug-note"></p>
</div>
<label>Image format<select id="image-format">
<option value="webp">WebP (lightest)</option>
<option value="jpeg">JPEG</option>
<option value="png">PNG (no loss, heaviest)</option>
</select></label>
<p class="hint" id="format-note"></p>
<div class="not-about">
<label>Cover image (home page)<input id="cover" type="file" accept="image/*,.heic,.heif"></label>
<p class="hint" id="cover-note"></p>
</div>
</div>
<div class="text-block">
<label class="lang-en">Text<textarea id="text" rows="14"></textarea></label>
<label class="lang-it" hidden>Testo (italiano)<textarea id="text-it" rows="14" lang="it"></textarea></label>
<div class="lang-it" hidden>
<button class="button quiet" id="translate" type="button">Translate from English</button>
<p class="hint">Automatic translation (MyMemory, free). Check it before publishing. Leave both Italian fields empty for no Italian version.</p>
</div>
<p class="hint">Blank line for a new paragraph. **bold**, [link text](https://…), ## heading. A YouTube or Vimeo link on its own line becomes a player. Use "text" next to a file below for its description and caption.</p>
</div>
<div class="settings-only" hidden>
<label class="check"><input id="opt-home-reactions" type="checkbox">Reactions on the home page: all of them on the right of each photo in full screen, the most chosen one on each photo in the grid</label>
<label>Home background colour<input id="home-bg" type="color" value="#000000"></label>
<label>Home text and icon colour<select id="home-ink-mode">
<option value="">Automatic</option>
<option value="#111111">Black</option>
<option value="#ffffff">White</option>
<option value="#8c8c8c">Grey</option>
<option value="custom">Custom</option>
</select></label>
<label id="home-ink-row" hidden>Custom text and icon colour<input id="home-ink" type="color" value="#ffffff"></label>
<p class="hint">Home page only (full screen, grid and index): the background, and the colour of the corner icons, the index text and the reactions over the photos. Automatic picks black or white from the background. Posts and the about page keep their own colours.</p>
</div>
<div class="about-only" hidden>
<p class="hint">Sections shown under the text, each with its own title (Contact, for example). The text is written like the text above: plain words, [link text](https://…), **bold**, "- " for a list.</p>
<div id="sections"></div>
<button class="button quiet" id="add-section" type="button">Add section</button>
</div>
<div class="post-only">
<label>Add images, video or audio at the cursor<input id="media" type="file" multiple accept="image/*,.heic,.heif,video/*,audio/*"></label>
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
<div class="not-about">
<label class="check"><input id="hidden" type="checkbox">Hidden (draft): saved, but not shown on the site</label>
<label class="check"><input id="pinned" type="checkbox">Pinned to the top</label>
</div>
</div>
<div class="bulk-only" hidden>
<p class="hint">Tick the posts, then choose what to do. Everything happens in one save. Drag the handle (or use the arrow keys on it) to change the order of the posts on the site, then save the order. Pinned posts stay first; new posts appear at the top.</p>
<p class="bulk-tools"><button class="flag" id="bulk-all" type="button">Select all</button> <button class="flag" id="bulk-none" type="button">Select none</button></p>
<ul class="links" id="bulk-list"></ul>
<div class="bulk-actions">
<button class="button quiet" id="bulk-hide" type="button">Hide</button>
<button class="button quiet" id="bulk-show" type="button">Show</button>
<button class="button quiet" id="bulk-delete" type="button">Delete</button>
<button class="button" id="bulk-order" type="button" disabled>Save order</button>
</div>
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
        # Home screen icons (manifest.webmanifest): square, the picture well inside the
        # area that phones may crop to a circle or a rounded square.
        for size in (192, 512):
            inner = round(size * 0.72)
            icon = Image.new("RGB", (size, size), "black")
            icon.paste(avatar.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2,
                       mask.resize((inner, inner), Image.LANCZOS))
            icon.save(OUT / f"icon-{size}.png")
    return True


def make_manifest(site):
    """Web app manifest: lets phones add the site to the home screen and open it like an app."""
    manifest = {
        "name": site["title"],
        "short_name": site["title"],
        "description": site.get("description") or "",
        "id": "./",
        "start_url": "./",
        "scope": "./",
        "display": "standalone",
        "background_color": home_colors(site)[0],
        "theme_color": home_colors(site)[0],
        "icons": [],
    }
    if site.get("_favicon"):
        for size in (192, 512):
            manifest["icons"].append({"src": f"icon-{size}.png", "sizes": f"{size}x{size}", "type": "image/png"})
        manifest["icons"].append({"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"})
    return json.dumps(manifest, ensure_ascii=False, indent=1)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, "utf-8")


def build():
    site = load_site()
    everything = sort_posts(load_posts(), site.get("order") or [])
    posts = [post for post in everything if not post["hidden"]]  # hidden posts are not published
    digest = hashlib.sha1()
    for name in ("style.css", "app.js", "admin.js", "fonts/fonts.css", "sw.js"):
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
    write(OUT / "manifest.webmanifest", make_manifest(site))
    # The service worker has to sit at the site root to cover every page.
    write(OUT / "sw.js", (SRC / "sw.js").read_text("utf-8").replace("__VERSION__", version))

    # Hidden posts are built too, at an unlisted address (noindex) so they can be
    # previewed; they are left out of the home page and the feed.
    for post in everything:
        publish_files(post["folder"], OUT / "posts" / post["slug"])

    write(OUT / "index.html", home_page(site, posts, version))
    write(OUT / "feed.xml", feed_xml(site, posts))
    about = load_about()
    if about["folder"]:
        publish_files(about["folder"], OUT / "about")
    write(OUT / "about" / "index.html", about_page(site, about, version))
    if about["it"]:
        write(OUT / "about" / "it" / "index.html", about_page(site, about, version, "it"))
    write(OUT / "404.html", not_found_page(site, version))
    write(OUT / "admin" / "index.html", admin_page(site, version))
    shutil.copy2(SRC / "admin.js", OUT / "admin" / "admin.js")
    shutil.copytree(SRC / "vendor", OUT / "admin" / "vendor")  # HEIC decoder, loaded on demand

    for post in everything:
        write(OUT / "posts" / post["slug"] / "index.html", post_page(site, post, version))
        if post["it"]:
            write(OUT / "posts" / post["slug"] / "it" / "index.html", post_page(site, post, version, "it"))

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
