/* Editor: creates or updates a post by committing to the GitHub repository.
   The push triggers the deploy workflow, which rebuilds the site. */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var MAX_IMAGE = 2000;            // longest side, in pixels, for uploaded images
  // What uploaded images are converted to ("Image format" in the editor).
  // quality: 0 to 1, for the formats that lose detail to save space.
  var FORMATS = {
    webp: { type: 'image/webp', ext: 'webp', quality: 0.8 },
    jpeg: { type: 'image/jpeg', ext: 'jpg', quality: 0.86 },
    png: { type: 'image/png', ext: 'png' }
  };
  var DEFAULT_FORMAT = 'webp';
  // An image already in the chosen format, no larger than MAX_IMAGE and below
  // this many bytes is uploaded as it is, not compressed a second time.
  var KEEP_BELOW = 1500000;
  var HEIC_DECODER = 'vendor/heic-to.js'; // loaded only when the browser cannot read a HEIC photo
  var MAX_FILE = 25 * 1024 * 1024; // per-file limit for video and audio, after conversion
  // Every video is converted to MP4 (H.264 + AAC) before upload, scaled to
  // MAX_VIDEO on its longest side. A longer video needs a lower VIDEO_BITRATE
  // to stay under MAX_FILE: 2.5 Mbit/s is about 75 seconds.
  var MAX_VIDEO = 1280;            // longest side, in pixels
  var VIDEO_BITRATE = 2500000;     // picture, bits per second
  var AUDIO_BITRATE = 160000;      // sound, bits per second (only when it has to be re-encoded)
  var VIDEO_FPS = 30;              // faster videos are slowed to this many frames per second
  var VIDEO_CONVERTER = 'vendor/mediabunny.min.mjs'; // loaded only when a video is chosen
  // Shapes offered when cropping an image (width / height). 0: any shape.
  var CROP_SHAPES = [['Free', 0], ['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['16:9', 16 / 9], ['9:16', 9 / 16]];

  var config = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  // media: new files to upload. existing: files already in the post folder.
  // removed: names of existing files to delete on publish.
  // flags: which image is the background and which the banner ("@cover" = the cover).
  var state = {
    posts: [], editing: null, cover: null, media: [], existing: [], removed: [],
    flags: { background: null, banner: null }, about: null, slugTouched: false, lang: 'en'
  };

  /* ---------------- languages ---------------- */

  var switchLang = function (lang) {
    state.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('.lang-en'), function (el) { el.hidden = lang !== 'en'; });
    Array.prototype.forEach.call(document.querySelectorAll('.lang-it'), function (el) { el.hidden = lang !== 'it'; });
    $('tab-en').setAttribute('aria-selected', lang === 'en' ? 'true' : 'false');
    $('tab-it').setAttribute('aria-selected', lang === 'it' ? 'true' : 'false');
    if (typeof renderMedia === 'function') renderMedia(); // descriptions follow the language
  };
  $('tab-en').addEventListener('click', function () { switchLang('en'); });
  $('tab-it').addEventListener('click', function () { switchLang('it'); });

  // Automatic translation, English -> Italian, with MyMemory (free, no key).
  // Media lines, bare links and link addresses are kept as they are.
  var translateText = function (text) {
    if (!text.trim()) return Promise.resolve(text);
    var kept = [];
    var keep = function (part) { kept.push(part); return '\u27e6' + (kept.length - 1) + '\u27e7'; };
    var protect = function (block) {
      return block
        .replace(/\]\([^)\s]+\)/g, function (m) { return ']' + keep(m.slice(1)); })
        .replace(/https?:\/\/[^\s)]+/g, keep);
    };
    var restore = function (block) {
      return block.replace(/\u27e6\s*(\d+)\s*\u27e7/g, function (m, i) { return kept[+i]; });
    };
    var chunks = function (block) { // under 450 characters each, cut at sentence ends
      var out = [''];
      block.split(/(?<=[.!?;:])\s+/).forEach(function (sentence) {
        if ((out[out.length - 1] + ' ' + sentence).length > 450 && out[out.length - 1]) out.push(sentence);
        else out[out.length - 1] = (out[out.length - 1] ? out[out.length - 1] + ' ' : '') + sentence;
      });
      return out;
    };
    var decodeEntities = function (value) {
      var box = document.createElement('textarea');
      box.innerHTML = value;
      return box.value;
    };
    var ask = function (piece) {
      if (!piece.trim()) return Promise.resolve(piece);
      return fetch('https://api.mymemory.translated.net/get?langpair=en|it&q=' + encodeURIComponent(piece))
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (!data || data.responseStatus != 200) throw new Error('Translation: ' + ((data && data.responseDetails) || 'no answer'));
          return decodeEntities(data.responseData.translatedText);
        });
    };
    var blocks = text.split(/\n\s*\n/);
    var result = [];
    var chain = Promise.resolve();
    blocks.forEach(function (block, index) {
      chain = chain.then(function () {
        var trimmed = block.trim();
        var media = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)(\s+loop)?$/.exec(trimmed);
        if (media) { // translate the description and the caption, keep the file
          return Promise.all([ask(media[1] || ''), ask(media[3] || '')]).then(function (words) {
            result[index] = '![' + words[0].replace(/[\[\]]/g, ' ') + '](' + media[2] +
              (media[3] ? ' "' + words[1].replace(/"/g, '\u201d') + '"' : '') + ')' + (media[4] ? ' loop' : '');
          });
        }
        if (/^(<|https?:\/\/\S+$)/.test(trimmed)) { result[index] = block; return; } // html, embeds
        status('Translating ' + (index + 1) + ' of ' + blocks.length + '…');
        var heading = (/^(#{1,3}\s+)/.exec(trimmed) || [''])[0];
        var lines = trimmed.slice(heading.length).split('\n');
        var done = [];
        var inner = Promise.resolve();
        lines.forEach(function (line, n) {
          inner = inner.then(function () {
            var bullet = (/^([-*]\s+)/.exec(line) || [''])[0];
            var parts = chunks(protect(line.slice(bullet.length)));
            return Promise.all(parts.map(ask)).then(function (translated) {
              done[n] = bullet + restore(translated.join(' '));
            });
          });
        });
        return inner.then(function () { result[index] = heading + done.join('\n'); });
      });
    });
    return chain.then(function () { return result.join('\n\n'); });
  };

  $('translate').addEventListener('click', function () {
    var button = $('translate');
    var sections = state.about ? document.querySelectorAll('#sections .section') : [];
    var filled = $('title-it').value.trim() || $('text-it').value.trim() ||
      Array.prototype.some.call(sections, function (box) {
        return box.querySelector('.section-title-it').value.trim() || box.querySelector('.section-text-it').value.trim();
      });
    if (filled && !button.classList.contains('danger')) { // first tap arms when it would overwrite
      button.textContent = 'Tap again to replace the Italian text';
      button.classList.add('danger');
      return;
    }
    button.textContent = 'Translate from English';
    button.classList.remove('danger');
    button.disabled = true;
    var title = $('title').value.trim();
    translateText(title).then(function (titleIt) {
      $('title-it').value = titleIt;
      return translateText($('text').value);
    }).then(function (textIt) {
      $('text-it').value = textIt;
      var chain = Promise.resolve(); // about page: its sections too, one after the other
      Array.prototype.forEach.call(sections, function (box) {
        chain = chain.then(function () {
          return translateText(box.querySelector('.section-title').value.trim());
        }).then(function (titleIt) {
          box.querySelector('.section-title-it').value = titleIt;
          return translateText(box.querySelector('.section-text').value);
        }).then(function (sectionIt) {
          box.querySelector('.section-text-it').value = sectionIt;
        });
      });
      return chain;
    }).then(function () {
      status('Translated. Read it through, then publish.');
    }).catch(function (error) {
      status(error.message + '. You can write the Italian text by hand.', true);
    }).then(function () { button.disabled = false; });
  });

  /* ---------------- settings ---------------- */

  var stored = function (key, fallback) {
    try { return localStorage.getItem('admin-' + key) || fallback; } catch (e) { return fallback; }
  };
  $('repo').value = stored('repo', config.repo || '');
  $('branch').value = stored('branch', config.branch || 'main');
  $('token').value = stored('token', '');
  $('settings').open = !$('token').value || !$('repo').value;
  ['repo', 'branch', 'token'].forEach(function (key) {
    $(key).addEventListener('change', function () {
      try { localStorage.setItem('admin-' + key, $(key).value.trim()); } catch (e) {}
    });
  });

  // The image format is remembered in this browser, like the connection.
  $('image-format').value = FORMATS[stored('image-format', '')] ? stored('image-format', '') : DEFAULT_FORMAT;
  $('image-format').addEventListener('change', function () {
    try { localStorage.setItem('admin-image-format', $('image-format').value); } catch (e) {}
    showFormat();
  });
  var showFormat = function () {
    $('format-note').textContent = 'Every image chosen from now on is converted to this format and scaled to ' +
      MAX_IMAGE + ' px before upload, whatever it was (HEIC from a phone included). Animated GIF and SVG are left as they are.' +
      ($('image-format').value === 'webp' && !canWriteWebp ? ' This browser cannot write WebP: JPEG is used instead.' : '') +
      ($('image-format').value === 'png' ? ' PNG keeps every detail but photos become several times heavier.' : '');
  };

  var status = function (message, isError) {
    $('status').textContent = message;
    $('status').className = isError ? 'error' : '';
  };

  /* ---------------- GitHub ---------------- */

  var gh = function (path, method, body) {
    var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    var token = $('token').value.trim();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(API + '/repos/' + $('repo').value.trim() + path, {
      method: method || 'GET',
      cache: 'no-store', // never reuse an old answer: a stale branch head breaks the next save (422)
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error('GitHub ' + response.status + ': ' + (data.message || response.statusText));
        return data;
      });
    });
  };

  // One commit with the given tree entries, on top of the latest version of
  // the branch. If the branch moved meanwhile (GitHub 422), try again once.
  var commitTree = function (entries, message, retried) {
    var branch = $('branch').value.trim() || 'main';
    var head;
    return gh('/git/ref/heads/' + encodeURIComponent(branch)).then(function (ref) {
      head = ref.object.sha;
      return gh('/git/commits/' + head);
    }).then(function (commit) {
      return gh('/git/trees', 'POST', { base_tree: commit.tree.sha, tree: entries });
    }).then(function (tree) {
      return gh('/git/commits', 'POST', { message: message, tree: tree.sha, parents: [head] });
    }).then(function (commit) {
      return gh('/git/refs/heads/' + encodeURIComponent(branch), 'PATCH', { sha: commit.sha });
    }).catch(function (error) {
      if (!retried && /GitHub 422/.test(error.message)) return commitTree(entries, message, true);
      throw error;
    });
  };

  var toBase64 = function (blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = function () { reject(new Error('Could not read a file.')); };
      reader.readAsDataURL(blob);
    });
  };

  /* ---------------- helpers ---------------- */

  var slugify = function (text) {
    return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };

  var cleanName = function (name) {
    var dot = name.lastIndexOf('.');
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    return (slugify(stem) || 'file') + (ext ? '.' + ext : '');
  };

  var extension = function (name) { return name.slice(name.lastIndexOf('.') + 1); };

  /* ---------------- image conversion ---------------- */

  // Every image is converted to the chosen format and scaled to MAX_IMAGE
  // before upload, whatever it was: JPEG, PNG, WebP, AVIF, HEIC, BMP, TIFF...
  // SVG (a drawing, not pixels) and animated GIF are uploaded as they are.

  var CONVERTIBLE = /\.(jpe?g|jfif|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i;
  var extensionType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  // Not every browser can write WebP (Safari writes a PNG instead).
  var canWriteWebp = (function () {
    try {
      var probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      return probe.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { return false; }
  })();
  showFormat();

  var chosenFormat = function () {
    var key = $('image-format').value;
    if (!FORMATS[key]) key = DEFAULT_FORMAT;
    if (key === 'webp' && !canWriteWebp) key = 'jpeg';
    return FORMATS[key];
  };

  // The browser often gives no type for .heic files: go by the name as well.
  var isHeicFile = function (file) {
    return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  };

  var isAnimatedGif = function (file) {
    if (file.type !== 'image/gif' && !/\.gif$/i.test(file.name)) return Promise.resolve(false);
    return file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var frames = 0;
      // Each frame starts with a graphic control extension: 21 F9 04.
      for (var i = 0; i < bytes.length - 2 && frames < 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xF9 && bytes[i + 2] === 0x04) frames++;
      }
      return frames > 1;
    }).catch(function () { return false; });
  };

  var heicDecoder = null;
  var loadHeicDecoder = function () {
    if (!heicDecoder) {
      heicDecoder = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = HEIC_DECODER;
        script.onload = function () { window.HeicTo ? resolve(window.HeicTo) : reject(new Error('HEIC decoder missing.')); };
        script.onerror = function () { heicDecoder = null; reject(new Error('Could not load the HEIC decoder.')); };
        document.head.appendChild(script);
      });
    }
    return heicDecoder;
  };

  // The pixels of an image file: { source, width, height }.
  var decodeImage = function (file) {
    var asPicture = function (bitmap) { return { source: bitmap, width: bitmap.width, height: bitmap.height }; };
    var withBitmap = function () {
      if (!window.createImageBitmap) return Promise.reject(new Error('No createImageBitmap.'));
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(asPicture);
    };
    var withElement = function () {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var image = new Image();
        image.onload = function () {
          URL.revokeObjectURL(url);
          image.naturalWidth ? resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight })
            : reject(new Error('Empty image.'));
        };
        image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Unreadable image.')); };
        image.src = url;
      });
    };
    var withHeicDecoder = function () {
      if (!isHeicFile(file)) return Promise.reject(new Error('Unreadable image.'));
      status('Reading ' + file.name + '…');
      return loadHeicDecoder().then(function (heicTo) {
        return heicTo({ blob: file, type: 'bitmap' });
      }).then(asPicture);
    };
    return withBitmap().catch(withElement).catch(withHeicDecoder);
  };

  // Resolves to { name, blob } ready for upload. Rejects when the file looks
  // like an image but this browser cannot read it.
  var prepare = function (file, name) {
    var keep = { name: name, blob: file };
    var looksLikeImage = /^image\//.test(file.type) || CONVERTIBLE.test(file.name);
    if (!looksLikeImage || file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name)) return Promise.resolve(keep);
    return isAnimatedGif(file).then(function (animated) {
      if (animated) return keep;
      var format = chosenFormat();
      return decodeImage(file).then(function (picture) {
        return askCrop(picture, file.name).then(function (crop) { return { picture: picture, crop: crop }; });
      }, function () {
        throw new Error(file.name + ' could not be read as an image in this browser. Convert it to JPEG or PNG first.');
      }).then(function (chosen) {
        var picture = chosen.picture;
        var crop = chosen.crop || { x: 0, y: 0, width: picture.width, height: picture.height };
        var longest = Math.max(crop.width, crop.height);
        var sameFormat = (file.type || extensionType[extension(name)]) === format.type;
        if (!chosen.crop && sameFormat && longest <= MAX_IMAGE && file.size <= KEEP_BELOW) return keep;
        var scale = Math.min(1, MAX_IMAGE / longest);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(crop.width * scale));
        canvas.height = Math.max(1, Math.round(crop.height * scale));
        var context = canvas.getContext('2d');
        if (format.type === 'image/jpeg') { // JPEG has no transparency
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.imageSmoothingQuality = 'high';
        context.drawImage(picture.source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        if (picture.source.close) picture.source.close();
        return new Promise(function (resolve) { canvas.toBlob(resolve, format.type, format.quality); })
          .then(function (blob) {
            if (!blob || blob.type !== format.type) throw new Error('Could not write ' + format.ext + '.');
            return { name: name.replace(/\.[^.]+$/, '') + '.' + format.ext, blob: blob };
          });
      });
    });
  };

  /* ---------------- image crop ---------------- */

  // Shown for each image as it is chosen. Resolves to the part to keep, in
  // the pixels of the image ({ x, y, width, height }), or null for all of it.
  var cropAll = false; // "Whole image for all": no more questions for this batch
  var cropLeft = 0;    // files of this batch still to come after the one shown

  var askCrop = function (picture, label) {
    if (cropAll) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var make = function (tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        if (tag === 'button') node.type = 'button';
        return node;
      };
      var box = make('div', 'crop');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Crop ' + label);
      var title = make('p', 'crop-title', label);
      var stage = make('div', 'crop-stage');
      var frame = make('div', 'crop-frame');
      var canvas = make('canvas');
      var area = make('div', 'crop-area');
      ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
        var handle = make('span', 'crop-handle ' + corner);
        handle.setAttribute('data-corner', corner);
        area.appendChild(handle);
      });
      frame.appendChild(canvas);
      frame.appendChild(area);
      stage.appendChild(frame);
      var shapes = make('div', 'crop-shapes');
      var buttons = make('div', 'crop-buttons');
      var whole = make('button', 'button quiet', 'Whole image');
      var all = make('button', 'button quiet', 'Whole image for all');
      var done = make('button', 'button', 'Crop');
      buttons.appendChild(whole);
      if (cropLeft > 0) buttons.appendChild(all);
      buttons.appendChild(done);
      [title, stage, shapes, buttons].forEach(function (node) { box.appendChild(node); });
      document.body.appendChild(box);
      document.documentElement.classList.add('cropping');

      // The picture is shown as large as the space allows; rect is in those pixels.
      var room = stage.getBoundingClientRect();
      var fit = Math.min(room.width / picture.width, room.height / picture.height);
      var W = Math.max(1, Math.round(picture.width * fit));
      var H = Math.max(1, Math.round(picture.height * fit));
      var density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * density);
      canvas.height = Math.round(H * density);
      frame.style.width = W + 'px';
      frame.style.height = H + 'px';
      canvas.getContext('2d').drawImage(picture.source, 0, 0, canvas.width, canvas.height);

      var MIN = Math.min(40, W, H);
      var rect = { x: 0, y: 0, w: W, h: H };
      var ratio = 0;
      var draw = function () {
        area.style.left = rect.x + 'px';
        area.style.top = rect.y + 'px';
        area.style.width = rect.w + 'px';
        area.style.height = rect.h + 'px';
      };
      // The largest area of that shape, in the middle of the picture.
      var setShape = function (value) {
        ratio = value;
        if (ratio) {
          var w = Math.min(W, H * ratio);
          rect = { x: (W - w) / 2, y: (H - w / ratio) / 2, w: w, h: w / ratio };
        }
        Array.prototype.forEach.call(shapes.children, function (button) {
          button.setAttribute('aria-pressed', Number(button.getAttribute('data-ratio')) === ratio ? 'true' : 'false');
        });
        draw();
      };
      CROP_SHAPES.forEach(function (shape) {
        var button = make('button', 'flag', shape[0]);
        button.setAttribute('data-ratio', shape[1]);
        button.addEventListener('click', function () { setShape(shape[1]); });
        shapes.appendChild(button);
      });
      setShape(0);

      var drag = null;
      area.addEventListener('pointerdown', function (event) {
        var corner = event.target.getAttribute('data-corner');
        drag = { x: event.clientX, y: event.clientY, start: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, corner: corner };
        area.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      area.addEventListener('pointermove', function (event) {
        if (!drag) return;
        var dx = event.clientX - drag.x;
        var dy = event.clientY - drag.y;
        var from = drag.start;
        if (!drag.corner) { // move the whole area
          rect.x = Math.min(Math.max(0, from.x + dx), W - from.w);
          rect.y = Math.min(Math.max(0, from.y + dy), H - from.h);
          return draw();
        }
        // The opposite corner stays where it is.
        var left = drag.corner.charAt(1) === 'w';
        var top = drag.corner.charAt(0) === 'n';
        var anchorX = left ? from.x + from.w : from.x;
        var anchorY = top ? from.y + from.h : from.y;
        var maxW = left ? anchorX : W - anchorX;
        var maxH = top ? anchorY : H - anchorY;
        var w = Math.min(Math.max(MIN, left ? from.w - dx : from.w + dx), maxW);
        var h = Math.min(Math.max(MIN, top ? from.h - dy : from.h + dy), maxH);
        if (ratio) {
          h = w / ratio;
          if (h > maxH) { h = maxH; w = h * ratio; }
          if (h < MIN && MIN * ratio <= maxW) { h = MIN; w = h * ratio; }
        }
        rect = { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, w: w, h: h };
        draw();
      });
      var release = function () { drag = null; };
      area.addEventListener('pointerup', release);
      area.addEventListener('pointercancel', release);

      var close = function (result) {
        document.removeEventListener('keydown', onKey);
        document.documentElement.classList.remove('cropping');
        box.remove();
        resolve(result);
      };
      var onKey = function (event) { if (event.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      whole.addEventListener('click', function () { close(null); });
      all.addEventListener('click', function () { cropAll = true; close(null); });
      done.addEventListener('click', function () {
        if (rect.w >= W - 1 && rect.h >= H - 1) return close(null);
        var x = Math.round(rect.x / fit);
        var y = Math.round(rect.y / fit);
        close({
          x: x, y: y,
          width: Math.max(1, Math.min(picture.width - x, Math.round(rect.w / fit))),
          height: Math.max(1, Math.min(picture.height - y, Math.round(rect.h / fit)))
        });
      });
      done.focus();
    });
  };

  /* ---------------- video conversion ---------------- */

  // Every video becomes an MP4 any browser plays (H.264 + AAC), no larger
  // than MAX_VIDEO: a .mov straight from a phone included. A video that is
  // already like that is uploaded as it is. Where the browser cannot convert
  // (no WebCodecs), the file is uploaded untouched and the deploy converts it.

  var looksLikeVideo = function (file) {
    return /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv|mkv|avi|3gp)$/i.test(file.name);
  };

  var videoConverter = null;
  var loadVideoConverter = function () {
    if (!videoConverter) {
      videoConverter = import(new URL(VIDEO_CONVERTER, document.baseURI).href)
        .catch(function (error) { videoConverter = null; throw error; });
    }
    return videoConverter;
  };

  // Resolves to { name, blob }; never rejects: on any trouble the file is kept
  // as it is, with a note saying so. mute: leave the sound out (video covers).
  var prepareVideo = function (file, name, mute) {
    var keep = { name: name, blob: file };
    var unconverted = function () {
      return {
        name: name, blob: file,
        note: file.name + ' could not be converted in this browser: it is uploaded as it is' +
          (/\.(mov|m4v)$/i.test(name) ? ' and converted when the site is published.' : '.')
      };
    };
    if (!window.VideoEncoder || !window.VideoDecoder) return Promise.resolve(unconverted());
    status('Reading ' + file.name + '…');
    return loadVideoConverter().then(function (mb) {
      var input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
      var finish = function (result) { if (input.dispose) input.dispose(); return result; };
      return Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(), input.getFormat(), input.computeDuration()])
        .then(function (found) {
          var video = found[0], audio = found[1], container = found[2], duration = found[3];
          if (!video) return keep;
          return Promise.all([
            video.getCodec(), audio ? audio.getCodec() : null,
            video.getDisplayWidth(), video.getDisplayHeight(), video.computePacketStats(120)
          ]).then(function (facts) {
            var longest = Math.max(facts[2], facts[3]);
            var tooBig = longest > MAX_VIDEO;
            var tooFast = facts[4].averagePacketRate > VIDEO_FPS + 1;
            var tooHeavy = duration > 0 && file.size * 8 / duration > (VIDEO_BITRATE + AUDIO_BITRATE) * 1.3;
            var reencode = facts[0] !== 'avc' || tooBig || tooFast || tooHeavy;
            var isMp4 = container instanceof mb.Mp4InputFormat && !(container instanceof mb.QuickTimeInputFormat);
            if (!reencode && isMp4 && (!audio || (facts[1] === 'aac' && !mute))) return keep;

            var options = { codec: 'avc' }; // nothing else: the picture is copied, not compressed again
            if (reencode) {
              var scale = Math.min(1, MAX_VIDEO / longest);
              options = {
                codec: 'avc', bitrate: VIDEO_BITRATE, fit: 'fill',
                width: Math.max(2, Math.round(facts[2] * scale / 2) * 2), // H.264 wants even sizes
                height: Math.max(2, Math.round(facts[3] * scale / 2) * 2)
              };
              if (tooFast) options.frameRate = VIDEO_FPS;
            }
            var output = new mb.Output({
              format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), // plays before it is fully downloaded
              target: new mb.BufferTarget()
            });
            return mb.Conversion.init({
              input: input, output: output, video: options,
              audio: mute ? { discard: true } : facts[1] === 'aac' ? { codec: 'aac' } : { codec: 'aac', bitrate: AUDIO_BITRATE }
            }).then(function (conversion) {
              var used = function (track) { return !track || conversion.utilizedTracks.indexOf(track) >= 0; };
              // Never lose the picture or the sound without saying so: upload the original instead.
              if (!conversion.isValid || !used(video) || !(mute || used(audio))) return unconverted();
              conversion.onProgress = function (progress) {
                status((reencode ? 'Converting ' : 'Repacking ') + file.name + '… ' + Math.round(progress * 100) + '%');
              };
              return conversion.execute().then(function () {
                var blob = new Blob([output.target.buffer], { type: 'video/mp4' });
                if (isMp4 && !mute && blob.size >= file.size) return keep;
                return { name: name.replace(/\.[^.]+$/, '') + '.mp4', blob: blob };
              });
            });
          });
        }).then(finish, function (error) { finish(); throw error; });
    }).catch(unconverted);
  };

  var parsePost = function (raw) {
    var meta = {};
    var match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/.exec(raw.replace(/\r\n/g, '\n'));
    if (!match) return { meta: meta, body: raw };
    match[1].split('\n').forEach(function (line) {
      var at = line.indexOf(':');
      if (at > 0) meta[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    });
    return { meta: meta, body: match[2].replace(/^\n+/, '') };
  };

  var today = function () {
    var now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  /* ---------------- form ---------------- */

  var showSlug = function () {
    $('slug-note').textContent = $('slug').value ? 'Link: posts/' + $('slug').value + '/' : '';
  };

  var kb = function (bytes) { return Math.max(1, Math.round(bytes / 1024)) + ' KB'; };

  // A media line in the text: ![description](file "caption") loop
  // The text field of the language being edited.
  var activeText = function () { return $(state.lang === 'it' ? 'text-it' : 'text'); };

  var mediaLine = function (name, flags) {
    var safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^[ \\t]*!\\[([^\\]]*)\\]\\(' + safe + '(?:\\s+"([^"]*)")?\\)(\\s+loop)?[ \\t]*$', flags || 'm');
  };

  // Take every line for this file out of the text.
  var unlink = function (name) {
    ['text', 'text-it'].forEach(function (id) {
      $(id).value = $(id).value.replace(mediaLine(name, 'gm'), '').replace(/\n{3,}/g, '\n\n').trim();
    });
  };

  var readLine = function (name) {
    var match = mediaLine(name).exec(activeText().value);
    return match ? { alt: match[1], caption: match[2] || '', loop: !!match[3] } : null;
  };

  var writeLine = function (name, data) {
    var line = '![' + data.alt.replace(/[\[\]\n]/g, ' ') + '](' + name +
      (data.caption ? ' "' + data.caption.replace(/\n/g, ' ').replace(/"/g, '\u201d') + '"' : '') + ')' + (data.loop ? ' loop' : '');
    activeText().value = activeText().value.replace(mediaLine(name), line);
  };

  var isVideo = function (name) { return /\.(mp4|webm|mov|m4v|ogv)$/i.test(name); };
  var openDetails = {}; // media rows whose description fields are open

  var isImage = function (name) { return /\.(jpe?g|png|webp|gif|avif|svg|heic|heif)$/i.test(name); };

  var coverName = function () {
    return state.cover ? state.cover.name : (state.editing ? state.editing.cover : '');
  };

  var FLAGS = [['background', 'bg'], ['banner', 'banner']];

  var renderMedia = function () {
    var list = $('media-list');
    list.textContent = '';
    var rows = [];
    if (coverName()) rows.push({ name: coverName(), key: '@cover', cover: true, size: state.cover ? state.cover.blob.size : null });
    rows = rows.concat(state.existing
      .filter(function (file) { return state.removed.indexOf(file.name) < 0; })
      .map(function (file) { return { name: file.name, key: file.name, size: file.size, existing: true }; }))
      .concat(state.media.map(function (item) { return { name: item.name, key: item.name, size: item.blob.size, item: item }; }));
    rows.forEach(function (entry) {
      var row = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name;
      var size = document.createElement('span');
      size.className = 'size';
      size.textContent = entry.cover ? 'cover' : kb(entry.size) + (entry.item ? ', new' : '');
      row.appendChild(name);
      row.appendChild(size);
      if (isImage(entry.name)) {
        FLAGS.forEach(function (flag) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'flag';
          button.textContent = flag[1];
          var on = state.flags[flag[0]] === entry.key;
          button.setAttribute('aria-pressed', on ? 'true' : 'false');
          button.setAttribute('aria-label', 'Use ' + entry.name + ' as ' + flag[0]);
          button.addEventListener('click', function () {
            if (on) {
              state.flags[flag[0]] = null;
              status(entry.name + ' is no longer the ' + flag[0] + '.');
            } else {
              state.flags[flag[0]] = entry.key;
              if (!entry.cover) unlink(entry.name);
              if (flag[0] === 'background' && !/^(faded|bw|difference)$/.test($('bg-style').value)) {
                $('bg-style').value = 'faded';
                showBackground();
              }
              status(entry.name + ' is the ' + flag[0] + (entry.cover ? '.' : ', and was taken out of the text.'));
            }
            renderMedia();
            showBackground();
          });
          row.appendChild(button);
        });
      }
      var details = null;
      var describable = !entry.cover && (isImage(entry.name) || isVideo(entry.name) || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(entry.name));
      if (describable) {
        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'flag';
        edit.textContent = 'text';
        edit.setAttribute('aria-label', 'Description and caption of ' + entry.name);
        edit.setAttribute('aria-expanded', openDetails[entry.name] ? 'true' : 'false');
        edit.addEventListener('click', function () {
          openDetails[entry.name] = !openDetails[entry.name];
          renderMedia();
        });
        row.appendChild(edit);
        if (openDetails[entry.name]) details = describe(entry.name);
      }
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '\u00d7';
      remove.setAttribute('aria-label', 'Remove ' + entry.name);
      if (entry.cover) remove.style.visibility = 'hidden'; // the cover can only be replaced
      remove.addEventListener('click', function () {
        if (entry.item) state.media.splice(state.media.indexOf(entry.item), 1);
        else state.removed.push(entry.name);
        FLAGS.forEach(function (flag) { if (state.flags[flag[0]] === entry.key) state.flags[flag[0]] = null; });
        unlink(entry.name);
        renderMedia();
        status(entry.name + ' removed' + (entry.existing ? '. It is deleted when you publish.' : '.'));
      });
      row.appendChild(remove);
      list.appendChild(row);
      if (details) list.appendChild(details);
    });
  };

  // Fields for one media line: description (alt text), caption, loop for videos.
  var describe = function (name) {
    var box = document.createElement('li');
    box.className = 'details';
    var data = readLine(name);
    if (!data) {
      box.textContent = 'This file is not in the text (add its line to describe it).';
      return box;
    }
    var field = function (label, value, hint, key) {
      var wrap = document.createElement('label');
      wrap.textContent = label;
      var input = document.createElement('input');
      input.value = value;
      input.placeholder = hint;
      input.addEventListener('input', function () {
        var current = readLine(name);
        if (!current) return;
        current[key] = input.value;
        writeLine(name, current);
      });
      wrap.appendChild(input);
      box.appendChild(wrap);
    };
    field('Description, for people who cannot see it', data.alt, 'What the image shows', 'alt');
    field('Caption, shown under it (optional)', data.caption, '', 'caption');
    if (isVideo(name)) {
      var check = document.createElement('label');
      check.className = 'check';
      var box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.checked = data.loop;
      box2.addEventListener('change', function () {
        var current = readLine(name);
        if (!current) return;
        current.loop = box2.checked;
        writeLine(name, current);
      });
      check.appendChild(box2);
      check.appendChild(document.createTextNode('Loop without sound or controls (short clips)'));
      box.appendChild(check);
    }
    return box;
  };

  // Switch the form between a post and the about page.
  // Switch the form between a post, the about page and the site settings.
  var showSection = function (name) {
    // The about page uses the post form too, without cover, date, address,
    // hidden and pinned, and with the sections under the text (Contact, ...).
    ['post', 'about', 'settings', 'bulk', 'stats'].forEach(function (section) {
      Array.prototype.forEach.call(document.querySelectorAll('.' + section + '-only'), function (el) {
        el.hidden = !(section === name || (section === 'post' && name === 'about'));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.not-about'), function (el) {
      el.hidden = name === 'about';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.text-block'), function (el) {
      el.hidden = name === 'settings' || name === 'bulk' || name === 'stats';
    });
    $('publish').parentNode.hidden = name === 'bulk' || name === 'stats';
    if (name !== 'post') $('delete').hidden = true;
  };
  var showAbout = function (on) { showSection(on ? 'about' : 'post'); };

  // Background and text colour controls.
  var showBackground = function () {
    var style = $('bg-style').value;
    var image = /^(faded|bw|difference)$/.test(style);
    $('bg-color-row').hidden = style !== 'color';
    var key = state.flags.background;
    $('bg-note').textContent = image
      ? (key && key !== '@cover' ? 'Image: ' + key + '.'
        : coverName() ? 'Image: ' + (isVideo(coverName()) ? 'a still frame of the cover video' : coverName() + ' (the cover)') +
          '. Pick another with "bg" in the list above.'
        : 'Pick the image with "bg" in the list above.')
      : '';
  };
  $('bg-style').addEventListener('change', function () {
    if (!/^(faded|bw|difference)$/.test($('bg-style').value)) state.flags.background = null;
    renderMedia();
    showBackground();
  });
  var showTextColor = function () {
    $('text-color-row').hidden = $('text-color-mode').value !== 'custom';
  };
  $('text-color-mode').addEventListener('change', showTextColor);

  var decode = function (file) {
    var bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  };

  var isTrue = function (value) { return /^(true|yes|1)$/i.test(value || ''); };

  var labelPublish = function () {
    $('publish').textContent = $('hidden').checked ? 'Save as hidden' : 'Publish';
  };
  $('hidden').addEventListener('change', labelPublish);

  var disarmDelete = function () {
    $('delete').textContent = 'Delete post';
    $('delete').classList.remove('danger');
  };

  // Rebuild the "Post" list from state.posts.
  var listPosts = function () {
    var select = $('post');
    while (select.options.length > 5) select.remove(5); // keep the first five entries
    state.posts.forEach(function (post) {
      var option = document.createElement('option');
      option.value = post.slug;
      option.textContent = post.date + '  ' + post.title +
        (post.pinned ? '  (pinned)' : '') + (post.hidden ? '  (hidden)' : '');
      select.appendChild(option);
    });
  };

  var reset = function () {
    state.editing = null;
    state.cover = null;
    state.media = [];
    state.existing = [];
    state.removed = [];
    state.flags = { background: null, banner: null };
    state.about = null;
    state.settings = null;
    state.bulk = false;
    openDetails = {};
    $('preview').hidden = true;
    state.slugTouched = false;
    showAbout(false);
    $('font').value = 'helvetica';
    $('title-it').value = '';
    $('text-it').value = '';
    $('translate').textContent = 'Translate from English';
    $('translate').classList.remove('danger');
    switchLang('en');
    $('bg-style').value = '';
    $('text-color-mode').value = '';
    showBackground();
    showTextColor();
    $('sections').textContent = '';
    ['title', 'slug', 'text', 'cover', 'media'].forEach(function (id) { $(id).value = ''; });
    $('hidden').checked = false;
    $('pinned').checked = false;
    $('delete').hidden = true;
    disarmDelete();
    labelPublish();
    $('date').value = today();
    $('slug').disabled = false;
    $('cover-note').textContent = '';
    renderMedia();
    showSlug();
  };

  $('title').addEventListener('input', function () {
    if (!state.editing && !state.slugTouched) {
      $('slug').value = slugify($('title').value);
      showSlug();
    }
  });
  $('slug').addEventListener('input', function () {
    state.slugTouched = true;
    $('slug').value = $('slug').value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    showSlug();
  });

  // Emptied on each tap, so the same file can be chosen again (after changing the image format, say).
  $('cover').addEventListener('click', function () { $('cover').value = ''; });
  $('cover').addEventListener('change', function () {
    var file = $('cover').files[0];
    if (!file) { state.cover = null; return; }
    cropAll = false;
    cropLeft = 0;
    // A short video can be the cover: its first moments are the still image
    // of the grid, and it plays in a loop, without sound, in full screen.
    var video = looksLikeVideo(file);
    var name = 'cover.' + (extension(cleanName(file.name)) || (video ? 'mp4' : 'jpg'));
    (video ? prepareVideo(file, name, true) : prepare(file, name)).then(function (item) {
      if (video && item.blob.size > MAX_FILE) {
        throw new Error(file.name + ' is ' + Math.round(item.blob.size / 1048576) + ' MB after conversion (25 MB at most): choose a shorter video.');
      }
      var note = item.note || '';
      delete item.note;
      state.cover = item;
      $('cover-note').textContent = 'New cover: ' + item.name + ', ' + Math.round(item.blob.size / 1024) + ' KB' +
        (video ? '. In the grid: a still frame. In full screen: the video in a loop, without sound.' : '');
      status(note);
      renderMedia();
      showBackground();
    }).catch(function (error) {
      state.cover = null;
      $('cover').value = '';
      $('cover-note').textContent = '';
      status(error.message, true);
      renderMedia();
      showBackground();
    });
  });

  var insertAtCursor = function (snippet) {
    var area = activeText();
    var start = area.selectionStart == null ? area.value.length : area.selectionStart;
    var before = area.value.slice(0, start);
    var after = area.value.slice(area.selectionEnd == null ? start : area.selectionEnd);
    var lead = before && !/\n\n$/.test(before) ? (/\n$/.test(before) ? '\n' : '\n\n') : '';
    var trail = /^\n\n/.test(after) ? '' : (/^\n/.test(after) ? '\n' : '\n\n');
    area.value = before + lead + snippet + trail + after;
    var caret = (before + lead + snippet + trail).length;
    area.selectionStart = area.selectionEnd = caret;
  };

  $('media').addEventListener('change', function () {
    var files = Array.prototype.slice.call($('media').files);
    var chain = Promise.resolve();
    var failed = [];
    var notes = [];
    cropAll = false;
    files.forEach(function (file, index) {
      chain = chain.then(function () {
        cropLeft = files.length - 1 - index;
        var video = looksLikeVideo(file);
        if (file.size > MAX_FILE && !video && !/^image\//.test(file.type)) {
          failed.push(file.name + ' is larger than 25 MB.');
          return;
        }
        return (video ? prepareVideo(file, cleanName(file.name)) : prepare(file, cleanName(file.name))).then(function (item) {
          if (video && item.blob.size > MAX_FILE) {
            throw new Error(file.name + ' is still ' + Math.round(item.blob.size / 1048576) + ' MB after conversion (25 MB at most). ' +
              'Host long videos on YouTube and paste the link instead.');
          }
          if (item.note) notes.push(item.note);
          delete item.note;
          var taken = function (name) {
            return name === 'post.md' || name === 'post.it.md' || /^cover\./.test(name) ||
              state.media.some(function (other) { return other.name === name; }) ||
              state.existing.some(function (file) {
                return file.name === name && state.removed.indexOf(name) < 0;
              });
          };
          var base = item.name.replace(/\.[^.]+$/, '');
          var ext = extension(item.name);
          for (var n = 2; taken(item.name); n++) item.name = base + '-' + n + '.' + ext;
          state.media.push(item);
          insertAtCursor('![](' + item.name + ')');
        }).catch(function (error) { failed.push(error.message); });
      });
    });
    chain.then(function () {
      $('media').value = '';
      renderMedia();
      status(failed.concat(notes).join(' '), failed.length > 0);
    });
  });

  /* ---------------- reactions and views ---------------- */

  // Read from the same backend as the reactions (see reactions.sql).
  var backend = config.backend || {};
  var rpc = function (name, body) {
    if (!backend.url || !backend.key) return Promise.reject(new Error('No reactions backend in content/site.json.'));
    return fetch(backend.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: backend.key, Authorization: 'Bearer ' + backend.key },
      body: JSON.stringify(body || {})
    }).then(function (response) {
      if (response.status === 404) {
        throw new Error('The backend is missing "' + name + '": run reactions.sql again in the Supabase SQL editor.');
      }
      if (!response.ok) throw new Error('Backend: ' + response.status);
      return response.json();
    });
  };

  var pageTitle = function (name) {
    if (name === '@home') return 'Home';
    if (name === '@about') return 'About';
    var post = state.posts.filter(function (post) { return post.slug === name; })[0];
    return post ? post.title : name;
  };

  // rows of { post, kind, count } -> { post: 'sun 2 · leaf 1' }
  var reactionText = function (rows) {
    var text = {};
    (rows || []).forEach(function (row) {
      text[row.post] = (text[row.post] ? text[row.post] + ' \u00b7 ' : '') + row.kind + ' ' + row.count;
    });
    return text;
  };

  // New reactions since they were last marked as seen in this browser.
  var news = null; // { since, rows } once the backend has answered
  var showNews = function () {
    if (!news) return;
    var when = new Date(news.since).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    var text = reactionText(news.rows);
    var posts = Object.keys(text);
    $('news-text').textContent = posts.length
      ? 'New reactions since ' + when + ': ' + posts.map(function (post) { return pageTitle(post) + ' (' + text[post] + ')'; }).join(', ') + '.'
      : 'No new reactions since ' + when + '.';
    $('news-seen').hidden = !posts.length;
    $('news').hidden = false;
  };
  var markSeen = function () {
    var now = new Date().toISOString();
    try { localStorage.setItem('admin-reactions-seen', now); } catch (e) {}
    return now;
  };
  var checkNews = function () {
    if (!backend.url || !backend.key) return;
    var since = stored('reactions-seen', '');
    if (!since) { // first time here: start counting from now
      news = { since: markSeen(), rows: [] };
      return showNews();
    }
    rpc('reactions_since', { p_since: since }).then(function (rows) {
      news = { since: since, rows: rows };
      showNews();
    }).catch(function (error) {
      $('news-text').textContent = error.message;
      $('news-seen').hidden = true;
      $('news').hidden = false;
    });
  };
  $('news-seen').addEventListener('click', function () {
    news = { since: markSeen(), rows: [] };
    showNews();
  });
  checkNews();

  // Views of each page (today, last 7 days, ever) and its reactions.
  var loadStats = function () {
    showSection('stats');
    var body = $('stats').tBodies[0];
    body.textContent = '';
    Promise.all([
      rpc('view_counts'),
      rpc('reaction_summary').catch(function () { return []; })
    ]).then(function (found) {
      var views = {};
      found[0].forEach(function (row) { views[row.page] = row; });
      var reactions = reactionText(found[1]);
      var names = ['@home', '@about'].concat(state.posts.map(function (post) { return post.slug; }));
      Object.keys(views).concat(Object.keys(reactions)).forEach(function (name) { // pages no longer on the site
        if (names.indexOf(name) < 0) names.push(name);
      });
      var sum = { today: 0, week: 0, total: 0 };
      var addRow = function (title, row, note) {
        var line = body.insertRow();
        var head = document.createElement('th');
        head.scope = 'row';
        head.textContent = title;
        if (note) {
          var small = document.createElement('small');
          small.textContent = note;
          head.appendChild(small);
        }
        line.appendChild(head);
        ['today', 'week', 'total'].forEach(function (key) { line.insertCell().textContent = row[key] || 0; });
      };
      names.forEach(function (name) {
        var row = views[name] || {};
        ['today', 'week', 'total'].forEach(function (key) { sum[key] += Number(row[key] || 0); });
        addRow(pageTitle(name), row, reactions[name]);
      });
      addRow('All pages', sum);
      status('');
    }).catch(function (error) { status(error.message, true); });
  };

  /* ---------------- existing posts ---------------- */

  fetch('../posts.json', { cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : []; })
    .catch(function () { return []; })
    .then(function (posts) {
      state.posts = posts;
      listPosts();
      showNews(); // with the titles of the posts
    });

  $('post').addEventListener('change', function () {
    var slug = $('post').value;
    reset();
    if (!slug) return;
    status('Loading…');
    if (slug === '@about') return loadEntry('about', 'content/about');
    if (slug === '@settings') return loadSettings();
    if (slug === '@bulk') return loadBulk();
    if (slug === '@stats') return loadStats();
    loadEntry(slug, 'content/posts/' + slug);
  });

  // Load a post, or the about page (base "content/about"), into the form.
  var loadEntry = function (slug, base) {
    var about = base === 'content/about';
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    var path = '/contents/' + base.split('/').map(encodeURIComponent).join('/');
    var legacy = false;
    Promise.all([
      gh(path + '/post.md' + ref).catch(function (error) {
        if (!about) throw error;
        legacy = true; // older layout: the about text alone in content/about.md
        return gh('/contents/content/about.md' + ref).then(function (file) {
          return { content: btoa(unescape(encodeURIComponent('---\ntitle: About\n---\n\n' + decode(file)))) };
        }).catch(function () { return { content: btoa('---\ntitle: About\n---\n\n') }; });
      }),
      gh(path + ref).catch(function () { return []; }),
      about ? gh('/contents/content/site.json' + ref) : null,
      gh(path + '/post.it.md' + ref).catch(function () { return null; })
    ]).then(function (found) {
      var parsed = parsePost(decode(found[0]));
      state.editing = { slug: slug, cover: about ? '' : parsed.meta.cover || '', meta: parsed.meta,
        folder: base + '/', about: about, legacy: legacy, hasIt: !!found[3] };
      if (found[3]) {
        var italian = parsePost(decode(found[3]));
        $('title-it').value = italian.meta.title || '';
        $('text-it').value = italian.body;
      }
      if (about) {
        state.about = { site: JSON.parse(decode(found[2])) };
        $('sections').textContent = '';
        siteSections(state.about.site).forEach(addSection);
        showSection('about');
      }
      $('title').value = parsed.meta.title || '';
      $('date').value = (parsed.meta.date || today()).slice(0, 10);
      $('slug').value = slug;
      $('slug').disabled = true; // the address of a published post never changes
      $('text').value = parsed.body;
      $('hidden').checked = isTrue(parsed.meta.draft);
      $('pinned').checked = isTrue(parsed.meta.pinned);
      var cover = state.editing.cover;
      FLAGS.forEach(function (flag) {
        var value = parsed.meta[flag[0]] || '';
        state.flags[flag[0]] = !value || /^(false|no|0|none)$/i.test(value) ? null
          : isTrue(value) || value === cover ? '@cover' : value;
      });
      var bg = state.flags.background;
      if (bg && /^#[0-9a-f]{3,6}$/i.test(bg)) {
        $('bg-style').value = 'color';
        $('bg-color').value = bg.length === 4 ? '#' + bg[1] + bg[1] + bg[2] + bg[2] + bg[3] + bg[3] : bg;
        state.flags.background = null;
      } else if (bg) {
        var style = (parsed.meta['background-style'] || '').toLowerCase();
        $('bg-style').value = /^(bw|difference)$/.test(style) ? style : 'faded';
      }
      var ink = (parsed.meta['text-color'] || '').toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(ink)) {
        var preset = ['#111111', '#ffffff', '#8c8c8c'].indexOf(ink) >= 0;
        $('text-color-mode').value = preset ? ink : 'custom';
        $('text-color').value = ink;
      }
      showBackground();
      showTextColor();
      $('font').value = /^(oswald|typewriter)$/.test(parsed.meta.font || '') ? parsed.meta.font : 'helvetica';
      $('delete').hidden = about;
      if (isTrue(parsed.meta.draft)) {
        $('preview').href = '../posts/' + slug + '/';
        $('preview').hidden = false;
      }
      labelPublish();
      if (!about) $('cover-note').textContent = 'Current cover: ' + state.editing.cover + '. Choose a file only to replace it.';
      state.existing = (Array.isArray(found[1]) ? found[1] : []).filter(function (entry) {
        return entry.type === 'file' && entry.name !== 'post.md' && entry.name !== 'post.it.md' &&
          entry.name !== state.editing.cover;
      }).map(function (entry) { return { name: entry.name, size: entry.size }; });
      renderMedia();
      showSlug();
      status('');
    }).catch(function (error) {
      $('post').value = '';
      showSection('post');
      status(error.message, true);
    });
  };

  /* ---------------- about page ---------------- */

  // Sections under the about text: site.json "sections", each with a title
  // and a text in Markdown, plus optional Italian versions. Older sites have
  // "contact" instead (label + url): shown as one Contact section.
  var siteSections = function (site) {
    if (Array.isArray(site.sections)) return site.sections;
    var lines = (site.contact || []).map(function (link) {
      return /^(https?:\/\/|mailto:|tel:|www\.)\S+$/.test(link.url || '')
        ? '- [' + link.label + '](' + link.url + ')' : '- ' + link.label + ': ' + link.url;
    });
    return lines.length ? [{ title: 'Contact', title_it: 'Contatti', text: lines.join('\n') }] : [];
  };

  // One section of the editor: title and text in both languages, move up, remove.
  var addSection = function (section) {
    section = section || {};
    var box = document.createElement('div');
    box.className = 'section';
    var field = function (lang, label, tag, cls, value) {
      var wrap = document.createElement('label');
      wrap.className = 'lang-' + lang;
      wrap.hidden = state.lang !== lang;
      wrap.appendChild(document.createTextNode(label));
      var input = document.createElement(tag);
      input.className = cls;
      input.value = value || '';
      if (lang === 'it') input.lang = 'it';
      if (tag === 'textarea') input.rows = 5;
      else input.autocomplete = 'off';
      wrap.appendChild(input);
      box.appendChild(wrap);
    };
    field('en', 'Section title', 'input', 'section-title', section.title);
    field('it', 'Titolo della sezione (italiano)', 'input', 'section-title-it', section.title_it);
    field('en', 'Section text', 'textarea', 'section-text', section.text);
    field('it', 'Testo della sezione (italiano)', 'textarea', 'section-text-it', section.text_it);
    var tools = document.createElement('p');
    tools.className = 'bulk-tools';
    var button = function (label, action) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'flag';
      el.textContent = label;
      el.addEventListener('click', action);
      tools.appendChild(el);
      return el;
    };
    button('Move up', function () {
      if (box.previousElementSibling) box.parentNode.insertBefore(box, box.previousElementSibling);
    });
    var remove = button('Remove section', function () {
      var empty = !Array.prototype.some.call(box.querySelectorAll('input, textarea'), function (el) { return el.value.trim(); });
      if (empty || remove.classList.contains('danger')) return box.remove();
      remove.textContent = 'Tap again to remove'; // first tap arms when there is text to lose
      remove.classList.add('danger');
    });
    box.appendChild(tools);
    $('sections').appendChild(box);
    return box;
  };
  $('add-section').addEventListener('click', function () {
    addSection().querySelector(state.lang === 'it' ? '.section-title-it' : '.section-title').focus();
  });

  // The sections as they are in the form; empty ones are left out.
  var readSections = function () {
    var sections = [];
    Array.prototype.forEach.call(document.querySelectorAll('#sections .section'), function (box) {
      var value = function (cls) { return box.querySelector('.' + cls).value.trim(); };
      var section = { title: value('section-title').replace(/\s+/g, ' '), text: value('section-text') };
      var titleIt = value('section-title-it').replace(/\s+/g, ' ');
      var textIt = value('section-text-it');
      if (titleIt) section.title_it = titleIt;
      if (textIt) section.text_it = textIt;
      if (section.title || section.text || titleIt || textIt) sections.push(section);
    });
    return sections;
  };

  /* ---------------- all posts: hide, show, delete ---------------- */

  var renderBulk = function () {
    var list = $('bulk-list');
    list.textContent = '';
    state.posts.forEach(function (post) {
      var row = document.createElement('li');
      row.dataset.slug = post.slug;
      var handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'handle';
      handle.setAttribute('aria-label', 'Move ' + post.title + ' (drag, or arrow keys)');
      handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      row.appendChild(handle);
      var label = document.createElement('label');
      label.className = 'check';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = post.slug;
      label.appendChild(box);
      label.appendChild(document.createTextNode(post.date + '  ' + post.title +
        (post.pinned ? '  (pinned)' : '') + (post.hidden ? '  (hidden)' : '')));
      row.appendChild(label);
      list.appendChild(row);
    });
    if (!state.posts.length) list.textContent = 'No posts.';
    $('bulk-order').disabled = true;
  };

  /* Order by dragging: pointer events, so it works with a finger and a mouse. */
  var orderChanged = function () {
    $('bulk-order').disabled = false;
    status('Order changed. Press "Save order" to publish it.');
  };

  (function () {
    var list = $('bulk-list');
    var drag = null;
    list.addEventListener('pointerdown', function (event) {
      var handle = event.target.closest('.handle');
      if (!handle) return;
      event.preventDefault();
      var row = handle.parentNode;
      handle.setPointerCapture(event.pointerId);
      drag = { row: row, handle: handle, moved: false };
      row.classList.add('dragging');
    });
    list.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var rows = Array.prototype.slice.call(list.children);
      var y = event.clientY;
      var target = null;
      rows.forEach(function (other) {
        if (other === drag.row || target) return;
        var box = other.getBoundingClientRect();
        if (y < box.top + box.height / 2) target = other;
      });
      var before = target || null;
      if (before !== drag.row.nextSibling) {
        list.insertBefore(drag.row, before);
        drag.moved = true;
      }
      // Scroll the page when dragging near the top or bottom edge.
      if (y < 60) window.scrollBy(0, -12);
      else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
    });
    var stop = function () {
      if (!drag) return;
      drag.row.classList.remove('dragging');
      if (drag.moved) orderChanged();
      drag = null;
    };
    list.addEventListener('pointerup', stop);
    list.addEventListener('pointercancel', stop);
    list.addEventListener('keydown', function (event) {
      var handle = event.target.closest('.handle');
      if (!handle || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      var row = handle.parentNode;
      if (event.key === 'ArrowUp' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      else if (event.key === 'ArrowDown' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
      else return;
      handle.focus();
      orderChanged();
    });
  })();

  $('bulk-order').addEventListener('click', function () {
    if (needToken()) return;
    var order = Array.prototype.map.call($('bulk-list').children, function (row) { return row.dataset.slug; });
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    bulkBusy(true);
    $('bulk-order').disabled = true;
    status('Saving the order…');
    gh('/contents/content/site.json' + ref).then(function (file) {
      var site = JSON.parse(decode(file));
      site.order = order;
      return commitTree([{ path: 'content/site.json', mode: '100644', type: 'blob', content: JSON.stringify(site, null, 2) + '\n' }],
        'Reorder posts');
    }).then(function () {
      var bySlug = {};
      state.posts.forEach(function (post) { bySlug[post.slug] = post; });
      state.posts = order.map(function (slug) { return bySlug[slug]; }).filter(Boolean);
      listPosts();
      $('post').value = '@bulk';
      status('Order saved. The site updates in about a minute.');
    }).catch(function (error) {
      $('bulk-order').disabled = false;
      status(error.message, true);
    }).then(function () { bulkBusy(false); });
  });

  var loadBulk = function () {
    state.bulk = true;
    showSection('bulk');
    renderBulk();
    disarmBulk();
    status('');
  };

  var chosen = function () {
    return Array.prototype.filter.call($('bulk-list').querySelectorAll('input'), function (box) { return box.checked; })
      .map(function (box) { return box.value; });
  };
  $('bulk-all').addEventListener('click', function () {
    Array.prototype.forEach.call($('bulk-list').querySelectorAll('input'), function (box) { box.checked = true; });
  });
  $('bulk-none').addEventListener('click', function () {
    Array.prototype.forEach.call($('bulk-list').querySelectorAll('input'), function (box) { box.checked = false; });
  });

  var disarmBulk = function () {
    $('bulk-delete').textContent = 'Delete';
    $('bulk-delete').classList.remove('danger');
  };

  var bulkBusy = function (busy) {
    ['bulk-hide', 'bulk-show', 'bulk-delete'].forEach(function (id) { $(id).disabled = busy; });
  };

  var needToken = function () {
    if ($('token').value.trim()) return false;
    $('settings').open = true;
    status('Set the access token under Connection.', true);
    return true;
  };

  // Hide or show: set or remove "draft: true" in each post's header.
  var bulkVisibility = function (hide) {
    var slugs = chosen();
    if (!slugs.length) return status('Tick at least one post.', true);
    if (needToken()) return;
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    bulkBusy(true);
    status('Reading ' + slugs.length + ' post' + (slugs.length > 1 ? 's' : '') + '…');
    Promise.all(slugs.map(function (slug) {
      return gh('/contents/content/posts/' + encodeURIComponent(slug) + '/post.md' + ref).then(function (file) {
        var text = decode(file).replace(/\r\n/g, '\n');
        var end = text.indexOf('\n---', 3);
        if (!/^---/.test(text) || end < 0) throw new Error(slug + ': no header found');
        var head = text.slice(0, end).replace(/\ndraft:[^\n]*/g, '');
        if (hide) head += '\ndraft: true';
        return { path: 'content/posts/' + slug + '/post.md', mode: '100644', type: 'blob', content: head + text.slice(end) };
      });
    })).then(function (entries) {
      status('Saving…');
      return commitTree(entries, (hide ? 'Hide ' : 'Show ') + slugs.length + ' post' + (slugs.length > 1 ? 's' : '') +
        ': ' + slugs.join(', '));
    }).then(function () {
      state.posts.forEach(function (post) { if (slugs.indexOf(post.slug) >= 0) post.hidden = hide; });
      listPosts();
      $('post').value = '@bulk';
      renderBulk();
      status((hide ? 'Hidden' : 'Shown') + ': ' + slugs.length + '. The site updates in about a minute.');
    }).catch(function (error) {
      status(error.message, true);
    }).then(function () { bulkBusy(false); });
  };
  $('bulk-hide').addEventListener('click', function () { disarmBulk(); bulkVisibility(true); });
  $('bulk-show').addEventListener('click', function () { disarmBulk(); bulkVisibility(false); });

  $('bulk-delete').addEventListener('click', function () {
    var slugs = chosen();
    if (!slugs.length) return status('Tick at least one post.', true);
    if (needToken()) return;
    if (!$('bulk-delete').classList.contains('danger')) { // first tap arms, second tap deletes
      $('bulk-delete').textContent = 'Tap again to delete ' + slugs.length;
      $('bulk-delete').classList.add('danger');
      status('This removes ' + slugs.length + ' post' + (slugs.length > 1 ? 's' : '') + ' with their images and media.');
      return;
    }
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    bulkBusy(true);
    status('Deleting…');
    Promise.all(slugs.map(function (slug) {
      return gh('/contents/content/posts/' + encodeURIComponent(slug) + ref).then(function (files) {
        return (Array.isArray(files) ? files : []).filter(function (entry) { return entry.type === 'file'; })
          .map(function (entry) { return { path: entry.path, mode: '100644', type: 'blob', sha: null }; });
      });
    })).then(function (groups) {
      var entries = [].concat.apply([], groups);
      if (!entries.length) throw new Error('Nothing to delete: the post folders are empty or missing.');
      return commitTree(entries, 'Delete ' + slugs.length + ' post' + (slugs.length > 1 ? 's' : '') + ': ' + slugs.join(', '));
    }).then(function () {
      state.posts = state.posts.filter(function (post) { return slugs.indexOf(post.slug) < 0; });
      listPosts();
      $('post').value = '@bulk';
      renderBulk();
      disarmBulk();
      status('Deleted: ' + slugs.length + '. The site updates in about a minute.');
    }).catch(function (error) {
      disarmBulk();
      status(error.message, true);
    }).then(function () { bulkBusy(false); });
  });

  /* ---------------- site settings ---------------- */

  // Options shown as checkboxes: element id -> key in site.json "options".
  var OPTIONS = { 'opt-home-reactions': 'home_reactions' };

  // Home colours, picked like the colours of a post: site.json "options"
  // "home_background" and "home_text_color" ('' = black or white, from the background).
  var HOME_BG = '#000000';
  var sixDigits = function (value) {
    value = String(value || '').toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(value)) value = '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
    return /^#[0-9a-f]{6}$/.test(value) ? value : '';
  };
  var showHomeInk = function () {
    $('home-ink-row').hidden = $('home-ink-mode').value !== 'custom';
  };
  $('home-ink-mode').addEventListener('change', showHomeInk);

  var loadSettings = function () {
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    gh('/contents/content/site.json' + ref).then(function (file) {
      var site = JSON.parse(decode(file));
      state.settings = { site: site };
      Object.keys(OPTIONS).forEach(function (id) {
        $(id).checked = !!(site.options && site.options[OPTIONS[id]]);
      });
      var options = site.options || {};
      $('home-bg').value = sixDigits(options.home_background) || HOME_BG;
      var ink = sixDigits(options.home_text_color);
      $('home-ink-mode').value = !ink ? '' : ['#111111', '#ffffff', '#8c8c8c'].indexOf(ink) >= 0 ? ink : 'custom';
      $('home-ink').value = ink || '#ffffff';
      showHomeInk();
      showSection('settings');
      labelPublish();
      status('');
    }).catch(function (error) {
      $('post').value = '';
      showSection('post');
      status(error.message, true);
    });
  };

  var publishSettings = function () {
    if (!$('token').value.trim()) {
      $('settings').open = true;
      return status('Set the access token under Connection.', true);
    }
    var site = state.settings.site;
    site.options = site.options || {};
    Object.keys(OPTIONS).forEach(function (id) { site.options[OPTIONS[id]] = $(id).checked; });
    site.options.home_background = $('home-bg').value;
    site.options.home_text_color = $('home-ink-mode').value === 'custom' ? $('home-ink').value : $('home-ink-mode').value;
    var branch = $('branch').value.trim() || 'main';
    var head;
    $('publish').disabled = true;
    status('Saving…');
    gh('/git/ref/heads/' + encodeURIComponent(branch)).then(function (ref) {
      head = ref.object.sha;
      return gh('/git/commits/' + head);
    }).then(function (commit) {
      return gh('/git/trees', 'POST', { base_tree: commit.tree.sha, tree: [
        { path: 'content/site.json', mode: '100644', type: 'blob', content: JSON.stringify(site, null, 2) + '\n' }
      ] });
    }).then(function (tree) {
      return gh('/git/commits', 'POST', { message: 'Update site settings', tree: tree.sha, parents: [head] });
    }).then(function (commit) {
      return gh('/git/refs/heads/' + encodeURIComponent(branch), 'PATCH', { sha: commit.sha });
    }).then(function () {
      status('Saved. The site updates in about a minute.');
    }).catch(function (error) {
      status(error.message, true);
    }).then(function () {
      $('publish').disabled = false;
    });
  };

  /* ---------------- publish ---------------- */

  $('publish').addEventListener('click', function () {
    if (state.settings) return publishSettings();
    var about = !!(state.editing && state.editing.about);
    var title = $('title').value.trim().replace(/\s+/g, ' ') || (about ? 'About' : '');
    var slug = state.editing ? state.editing.slug : slugify($('slug').value);
    var date = $('date').value || today();
    var branch = $('branch').value.trim() || 'main';
    var problem =
      !$('repo').value.trim() ? 'Set the repository under Connection.' :
      !$('token').value.trim() ? 'Set the access token under Connection.' :
      !title ? 'The post needs a title.' :
      about && /^(faded|bw|difference)$/.test($('bg-style').value) && !state.flags.background
        ? 'Pick the background image with "bg" in the media list.' :
      !slug ? 'The post needs an address.' :
      !state.editing && !state.cover ? 'Choose a cover image or video.' :
      !state.editing && state.posts.some(function (p) { return p.slug === slug; })
        ? 'A post with this address already exists. Pick it from the Post list to edit it.' : '';
    if (problem) {
      if (/Connection/.test(problem)) $('settings').open = true;
      status(problem, true);
      return;
    }

    var folder = state.editing && state.editing.folder || 'content/posts/' + slug + '/';
    var coverName = state.cover ? state.cover.name : state.editing.cover;
    var hidden = !about && $('hidden').checked;
    var pinned = !about && $('pinned').checked;
    var front = about ? ['title: ' + title] : ['title: ' + title, 'date: ' + date, 'cover: ' + coverName];
    if (hidden) front.push('draft: true');
    if (pinned) front.push('pinned: true');
    var bgStyle = $('bg-style').value;
    if (bgStyle === 'color') {
      front.push('background: ' + $('bg-color').value);
    } else if (bgStyle) {
      var bgKey = state.flags.background || '@cover';
      front.push('background: ' + (bgKey === '@cover' ? coverName : bgKey));
      front.push('background-style: ' + bgStyle);
    }
    if (state.flags.banner) front.push('banner: ' + (state.flags.banner === '@cover' ? coverName : state.flags.banner));
    var ink = $('text-color-mode').value === 'custom' ? $('text-color').value : $('text-color-mode').value;
    if (ink) front.push('text-color: ' + ink);
    if ($('font').value !== 'helvetica') front.push('font: ' + $('font').value);
    if (state.editing) {
      Object.keys(state.editing.meta).forEach(function (key) { // keep any other field
        if (['title', 'date', 'cover', 'draft', 'pinned', 'background', 'background-style', 'banner',
             'text-color', 'font'].indexOf(key) < 0) {
          front.push(key + ': ' + state.editing.meta[key]);
        }
      });
    }
    var markdown = '---\n' + front.join('\n') + '\n---\n\n' + $('text').value.trim() + '\n';

    var uploads = state.media.slice();
    if (state.cover) uploads.unshift(state.cover);
    var tree = [{ path: folder + 'post.md', mode: '100644', type: 'blob', content: markdown }];
    var titleIt = $('title-it').value.trim().replace(/\s+/g, ' ');
    var textIt = $('text-it').value.trim();
    if (titleIt || textIt) {
      tree.push({ path: folder + 'post.it.md', mode: '100644', type: 'blob',
        content: '---\ntitle: ' + (titleIt || title) + '\n---\n\n' + textIt + '\n' });
    } else if (state.editing && state.editing.hasIt) {
      tree.push({ path: folder + 'post.it.md', mode: '100644', type: 'blob', sha: null }); // Italian version removed
    }
    if (state.editing && state.cover && state.editing.cover && state.editing.cover !== coverName) {
      tree.push({ path: folder + state.editing.cover, mode: '100644', type: 'blob', sha: null }); // remove old cover
    }
    state.removed.forEach(function (name) { // media taken out with the x
      var replaced = uploads.some(function (item) { return item.name === name; });
      if (!replaced) tree.push({ path: folder + name, mode: '100644', type: 'blob', sha: null });
    });
    if (about) {
      var site = state.about.site;
      site.sections = readSections();
      delete site.contact; // older layout, now a section
      tree.push({ path: 'content/site.json', mode: '100644', type: 'blob', content: JSON.stringify(site, null, 2) + '\n' });
      if (state.editing.legacy) tree.push({ path: 'content/about.md', mode: '100644', type: 'blob', sha: null });
    }

    $('publish').disabled = true;
    var head;
    var wasEditing = !!state.editing;
    status('Connecting…');
    gh('/git/ref/heads/' + encodeURIComponent(branch)).then(function (ref) {
      head = ref.object.sha;
      return gh('/git/commits/' + head);
    }).then(function (commit) {
      var chain = Promise.resolve();
      uploads.forEach(function (item, index) {
        chain = chain.then(function () {
          status('Uploading ' + (index + 1) + ' of ' + uploads.length + '…');
          return toBase64(item.blob);
        }).then(function (content) {
          return gh('/git/blobs', 'POST', { content: content, encoding: 'base64' });
        }).then(function (blob) {
          tree.push({ path: folder + item.name, mode: '100644', type: 'blob', sha: blob.sha });
        });
      });
      return chain.then(function () {
        status('Saving…');
        return gh('/git/trees', 'POST', { base_tree: commit.tree.sha, tree: tree });
      });
    }).then(function (created) {
      return gh('/git/commits', 'POST', {
        message: about ? 'Update about page' : (state.editing ? 'Update post: ' : 'Add post: ') + title,
        tree: created.sha,
        parents: [head]
      });
    }).then(function (commit) {
      return gh('/git/refs/heads/' + encodeURIComponent(branch), 'PATCH', { sha: commit.sha });
    }).then(function () {
      if (about) {
        $('post').value = '';
        reset();
        return status('Published. The about page updates in about a minute.');
      }
      state.posts = state.posts.filter(function (post) { return post.slug !== slug; });
      state.posts.unshift({ slug: slug, title: title, date: date, cover: coverName, hidden: hidden, pinned: pinned });
      listPosts();
      $('post').value = '';
      reset();
      status(hidden
        ? 'Saved as hidden. It ' + (wasEditing ? 'leaves the site in about a minute.' : 'is not on the site.')
        : 'Published. The site updates in about a minute: posts/' + slug + '/');
    }).catch(function (error) {
      status(error.message, true);
    }).then(function () {
      $('publish').disabled = false;
    });
  });

  /* ---------------- delete ---------------- */

  $('delete').addEventListener('click', function () {
    if (!state.editing) return;
    if (!$('token').value.trim()) {
      $('settings').open = true;
      status('Set the access token under Connection.', true);
      return;
    }
    if (!$('delete').classList.contains('danger')) { // first tap arms, second tap deletes
      $('delete').textContent = 'Tap again to delete';
      $('delete').classList.add('danger');
      status('This removes the post, its cover and its media from the site.');
      return;
    }
    var slug = state.editing.slug;
    var title = $('title').value.trim() || slug;
    var branch = $('branch').value.trim() || 'main';
    var head;
    $('delete').disabled = $('publish').disabled = true;
    status('Deleting…');
    gh('/git/ref/heads/' + encodeURIComponent(branch)).then(function (ref) {
      head = ref.object.sha;
      return Promise.all([
        gh('/git/commits/' + head),
        gh('/contents/content/posts/' + encodeURIComponent(slug) + '?ref=' + head)
      ]);
    }).then(function (found) {
      var files = (Array.isArray(found[1]) ? found[1] : []).filter(function (entry) { return entry.type === 'file'; });
      if (!files.length) throw new Error('Nothing to delete: the post folder is empty or missing.');
      return gh('/git/trees', 'POST', {
        base_tree: found[0].tree.sha,
        tree: files.map(function (entry) { return { path: entry.path, mode: '100644', type: 'blob', sha: null }; })
      });
    }).then(function (created) {
      return gh('/git/commits', 'POST', { message: 'Delete post: ' + title, tree: created.sha, parents: [head] });
    }).then(function (commit) {
      return gh('/git/refs/heads/' + encodeURIComponent(branch), 'PATCH', { sha: commit.sha });
    }).then(function () {
      state.posts = state.posts.filter(function (post) { return post.slug !== slug; });
      listPosts();
      $('post').value = '';
      reset();
      status('Deleted. It leaves the site in about a minute.');
    }).catch(function (error) {
      disarmDelete();
      status(error.message, true);
    }).then(function () {
      $('delete').disabled = $('publish').disabled = false;
    });
  });

  reset();
})();
