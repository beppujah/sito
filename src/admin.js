/* Editor: creates or updates a post by committing to the GitHub repository.
   The push triggers the deploy workflow, which rebuilds the site. */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var MAX_IMAGE = 2400;            // longest side, in pixels, for uploaded photos
  var MAX_FILE = 25 * 1024 * 1024; // per-file limit for video and audio

  var config = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  // media: new files to upload. existing: files already in the post folder.
  // removed: names of existing files to delete on publish.
  // flags: which image is the background and which the banner ("@cover" = the cover).
  var state = {
    posts: [], editing: null, cover: null, media: [], existing: [], removed: [],
    flags: { background: null, banner: null }, about: null, slugTouched: false
  };

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

  // Photos straight from a phone are large: scale them down before upload.
  var prepare = function (file, name) {
    var keep = { name: name, blob: file };
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || !window.createImageBitmap) {
      return Promise.resolve(keep);
    }
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bitmap) {
      var longest = Math.max(bitmap.width, bitmap.height);
      var isHeic = /hei[cf]/.test(file.type);
      if (longest <= MAX_IMAGE && file.size <= 1500000 && !isHeic) return keep;
      var scale = Math.min(1, MAX_IMAGE / longest);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      var context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.86); })
        .then(function (blob) {
          return blob ? { name: name.replace(/\.[^.]+$/, '') + '.jpg', blob: blob } : keep;
        });
    }).catch(function () { return keep; });
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
  var mediaLine = function (name, flags) {
    var safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^[ \\t]*!\\[([^\\]]*)\\]\\(' + safe + '(?:\\s+"([^"]*)")?\\)(\\s+loop)?[ \\t]*$', flags || 'm');
  };

  // Take every line for this file out of the text.
  var unlink = function (name) {
    $('text').value = $('text').value.replace(mediaLine(name, 'gm'), '').replace(/\n{3,}/g, '\n\n').trim();
  };

  var readLine = function (name) {
    var match = mediaLine(name).exec($('text').value);
    return match ? { alt: match[1], caption: match[2] || '', loop: !!match[3] } : null;
  };

  var writeLine = function (name, data) {
    var line = '![' + data.alt.replace(/[\[\]\n]/g, ' ') + '](' + name +
      (data.caption ? ' "' + data.caption.replace(/\n/g, ' ').replace(/"/g, '\u201d') + '"' : '') + ')' + (data.loop ? ' loop' : '');
    $('text').value = $('text').value.replace(mediaLine(name), line);
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
    ['post', 'about', 'settings', 'bulk'].forEach(function (section) {
      Array.prototype.forEach.call(document.querySelectorAll('.' + section + '-only'), function (el) {
        el.hidden = section !== name;
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.text-block'), function (el) {
      el.hidden = name === 'settings' || name === 'bulk';
    });
    $('publish').parentNode.hidden = name === 'bulk';
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
      ? 'Image: ' + (key && key !== '@cover' ? key : (coverName() || 'the cover') + ' (the cover)') +
        '. The post opens on it; a tap shows the text.'
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
    while (select.options.length > 4) select.remove(4); // keep the first four entries
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
    $('bg-style').value = '';
    $('text-color-mode').value = '';
    showBackground();
    showTextColor();
    $('contacts').value = '';
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

  $('cover').addEventListener('change', function () {
    var file = $('cover').files[0];
    if (!file) { state.cover = null; return; }
    prepare(file, 'cover.' + (extension(cleanName(file.name)) || 'jpg')).then(function (item) {
      state.cover = item;
      $('cover-note').textContent = 'New cover: ' + Math.round(item.blob.size / 1024) + ' KB';
      renderMedia();
      showBackground();
    });
  });

  var insertAtCursor = function (snippet) {
    var area = $('text');
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
    files.forEach(function (file) {
      chain = chain.then(function () {
        if (file.size > MAX_FILE && !/^image\//.test(file.type)) {
          status(file.name + ' is larger than 25 MB. Host long videos on YouTube and paste the link instead.', true);
          return;
        }
        return prepare(file, cleanName(file.name)).then(function (item) {
          var taken = function (name) {
            return name === 'post.md' || /^cover\./.test(name) ||
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
        });
      });
    });
    chain.then(function () { $('media').value = ''; renderMedia(); });
  });

  /* ---------------- existing posts ---------------- */

  fetch('../posts.json', { cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : []; })
    .catch(function () { return []; })
    .then(function (posts) {
      state.posts = posts;
      listPosts();
    });

  $('post').addEventListener('change', function () {
    var slug = $('post').value;
    reset();
    if (!slug) return;
    status('Loading…');
    if (slug === '@about') return loadAbout();
    if (slug === '@settings') return loadSettings();
    if (slug === '@bulk') return loadBulk();
    var path = '/contents/content/posts/' + encodeURIComponent(slug) + '/post.md?ref=' +
      encodeURIComponent($('branch').value.trim() || 'main');
    var folderPath = '/contents/content/posts/' + encodeURIComponent(slug) + '?ref=' +
      encodeURIComponent($('branch').value.trim() || 'main');
    Promise.all([gh(path), gh(folderPath)]).then(function (found) {
      var parsed = parsePost(decode(found[0]));
      state.editing = { slug: slug, cover: parsed.meta.cover || '', meta: parsed.meta };
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
      $('delete').hidden = false;
      if (isTrue(parsed.meta.draft)) {
        $('preview').href = '../posts/' + slug + '/';
        $('preview').hidden = false;
      }
      labelPublish();
      $('cover-note').textContent = 'Current cover: ' + state.editing.cover + '. Choose a file only to replace it.';
      state.existing = (Array.isArray(found[1]) ? found[1] : []).filter(function (entry) {
        return entry.type === 'file' && entry.name !== 'post.md' && entry.name !== state.editing.cover;
      }).map(function (entry) { return { name: entry.name, size: entry.size }; });
      renderMedia();
      showSlug();
      status('');
    }).catch(function (error) {
      $('post').value = '';
      status(error.message, true);
    });
  });

  /* ---------------- about page ---------------- */

  var loadAbout = function () {
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    Promise.all([
      gh('/contents/content/about.md' + ref).catch(function () { return null; }),
      gh('/contents/content/site.json' + ref)
    ]).then(function (found) {
      var site = JSON.parse(decode(found[1]));
      state.about = { site: site };
      showAbout(true);
      $('text').value = found[0] ? decode(found[0]).trim() : '';
      $('contacts').value = (site.contact || []).map(function (link) {
        return link.label + ' | ' + link.url;
      }).join('\n');
      labelPublish();
      status('');
    }).catch(function (error) {
      $('post').value = '';
      showAbout(false);
      status(error.message, true);
    });
  };

  var publishAbout = function () {
    if (!$('token').value.trim()) {
      $('settings').open = true;
      return status('Set the access token under Connection.', true);
    }
    var contacts = [];
    var bad = '';
    $('contacts').value.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var at = line.indexOf('|');
      var label = at > 0 ? line.slice(0, at).trim() : '';
      var url = at > 0 ? line.slice(at + 1).trim() : '';
      if (!label || !url) bad = bad || line.trim();
      else contacts.push({ label: label, url: url });
    });
    if (bad) return status('This contact line needs "label | address": ' + bad, true);
    var site = state.about.site;
    site.contact = contacts;
    var branch = $('branch').value.trim() || 'main';
    var head;
    $('publish').disabled = true;
    status('Saving…');
    gh('/git/ref/heads/' + encodeURIComponent(branch)).then(function (ref) {
      head = ref.object.sha;
      return gh('/git/commits/' + head);
    }).then(function (commit) {
      return gh('/git/trees', 'POST', { base_tree: commit.tree.sha, tree: [
        { path: 'content/about.md', mode: '100644', type: 'blob', content: $('text').value.trim() + '\n' },
        { path: 'content/site.json', mode: '100644', type: 'blob', content: JSON.stringify(site, null, 2) + '\n' }
      ] });
    }).then(function (tree) {
      return gh('/git/commits', 'POST', { message: 'Update about page', tree: tree.sha, parents: [head] });
    }).then(function (commit) {
      return gh('/git/refs/heads/' + encodeURIComponent(branch), 'PATCH', { sha: commit.sha });
    }).then(function () {
      status('Published. The about page updates in about a minute.');
    }).catch(function (error) {
      status(error.message, true);
    }).then(function () {
      $('publish').disabled = false;
    });
  };

  /* ---------------- all posts: hide, show, delete ---------------- */

  var renderBulk = function () {
    var list = $('bulk-list');
    list.textContent = '';
    state.posts.forEach(function (post) {
      var row = document.createElement('li');
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
  };

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

  var loadSettings = function () {
    var ref = '?ref=' + encodeURIComponent($('branch').value.trim() || 'main');
    gh('/contents/content/site.json' + ref).then(function (file) {
      var site = JSON.parse(decode(file));
      state.settings = { site: site };
      Object.keys(OPTIONS).forEach(function (id) {
        $(id).checked = !!(site.options && site.options[OPTIONS[id]]);
      });
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
    if (state.about) return publishAbout();
    var title = $('title').value.trim().replace(/\s+/g, ' ');
    var slug = state.editing ? state.editing.slug : slugify($('slug').value);
    var date = $('date').value || today();
    var branch = $('branch').value.trim() || 'main';
    var problem =
      !$('repo').value.trim() ? 'Set the repository under Connection.' :
      !$('token').value.trim() ? 'Set the access token under Connection.' :
      !title ? 'The post needs a title.' :
      !slug ? 'The post needs an address.' :
      !state.editing && !state.cover ? 'Choose a cover image.' :
      !state.editing && state.posts.some(function (p) { return p.slug === slug; })
        ? 'A post with this address already exists. Pick it from the Post list to edit it.' : '';
    if (problem) {
      if (/Connection/.test(problem)) $('settings').open = true;
      status(problem, true);
      return;
    }

    var folder = 'content/posts/' + slug + '/';
    var coverName = state.cover ? state.cover.name : state.editing.cover;
    var hidden = $('hidden').checked;
    var pinned = $('pinned').checked;
    var front = ['title: ' + title, 'date: ' + date, 'cover: ' + coverName];
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
    if (state.editing && state.cover && state.editing.cover && state.editing.cover !== coverName) {
      tree.push({ path: folder + state.editing.cover, mode: '100644', type: 'blob', sha: null }); // remove old cover
    }
    state.removed.forEach(function (name) { // media taken out with the x
      var replaced = uploads.some(function (item) { return item.name === name; });
      if (!replaced) tree.push({ path: folder + name, mode: '100644', type: 'blob', sha: null });
    });

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
        message: (state.editing ? 'Update post: ' : 'Add post: ') + title,
        tree: created.sha,
        parents: [head]
      });
    }).then(function (commit) {
      return gh('/git/refs/heads/' + encodeURIComponent(branch), 'PATCH', { sha: commit.sha });
    }).then(function () {
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
