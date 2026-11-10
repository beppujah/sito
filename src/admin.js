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
  var state = { posts: [], editing: null, cover: null, media: [], existing: [], removed: [], slugTouched: false };

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
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error('GitHub ' + response.status + ': ' + (data.message || response.statusText));
        return data;
      });
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

  // Take every "![...](name)" line for this file out of the text.
  var unlink = function (name) {
    var safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var line = new RegExp('^[ \\t]*!\\[[^\\]]*\\]\\(' + safe + '\\)[ \\t]*$', 'gm');
    $('text').value = $('text').value.replace(line, '').replace(/\n{3,}/g, '\n\n').trim();
  };

  var renderMedia = function () {
    var list = $('media-list');
    list.textContent = '';
    var rows = state.existing
      .filter(function (file) { return state.removed.indexOf(file.name) < 0; })
      .map(function (file) { return { name: file.name, size: file.size, existing: true }; })
      .concat(state.media.map(function (item) { return { name: item.name, size: item.blob.size, item: item }; }));
    rows.forEach(function (entry) {
      var row = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = entry.name;
      var size = document.createElement('span');
      size.className = 'size';
      size.textContent = kb(entry.size) + (entry.item ? ', new' : '');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '\u00d7';
      remove.setAttribute('aria-label', 'Remove ' + entry.name);
      remove.addEventListener('click', function () {
        if (entry.item) state.media.splice(state.media.indexOf(entry.item), 1);
        else state.removed.push(entry.name);
        unlink(entry.name);
        renderMedia();
        status(entry.name + ' removed' + (entry.existing ? '. It is deleted when you publish.' : '.'));
      });
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(remove);
      list.appendChild(row);
    });
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
    while (select.options.length > 1) select.remove(1);
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
    state.slugTouched = false;
    ['title', 'slug', 'text', 'cover', 'media'].forEach(function (id) { $(id).value = ''; });
    $('hidden').checked = false;
    $('pinned').checked = false;
    $('background').checked = true; // new posts open on their cover by default
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
    var path = '/contents/content/posts/' + encodeURIComponent(slug) + '/post.md?ref=' +
      encodeURIComponent($('branch').value.trim() || 'main');
    var folderPath = '/contents/content/posts/' + encodeURIComponent(slug) + '?ref=' +
      encodeURIComponent($('branch').value.trim() || 'main');
    Promise.all([gh(path), gh(folderPath)]).then(function (found) {
      var file = found[0];
      var bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), function (c) { return c.charCodeAt(0); });
      var parsed = parsePost(new TextDecoder().decode(bytes));
      state.editing = { slug: slug, cover: parsed.meta.cover || '', meta: parsed.meta };
      $('title').value = parsed.meta.title || '';
      $('date').value = (parsed.meta.date || today()).slice(0, 10);
      $('slug').value = slug;
      $('slug').disabled = true; // the address of a published post never changes
      $('text').value = parsed.body;
      $('hidden').checked = isTrue(parsed.meta.draft);
      $('pinned').checked = isTrue(parsed.meta.pinned);
      $('background').checked = isTrue(parsed.meta.background);
      $('delete').hidden = false;
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

  /* ---------------- publish ---------------- */

  $('publish').addEventListener('click', function () {
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
    if ($('background').checked) front.push('background: true');
    if (state.editing) {
      Object.keys(state.editing.meta).forEach(function (key) { // keep any other field
        if (['title', 'date', 'cover', 'draft', 'pinned', 'background'].indexOf(key) < 0) {
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
