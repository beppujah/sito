(function () {
  'use strict';

  var root = document.documentElement;

  /* ------------------------------------------------------------------
     Back arrow: return to where the visitor came from (same view and
     scroll position) when they arrived from inside the site.
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-back]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var from = document.referrer;
      if (from && from.indexOf(location.origin) === 0 && history.length > 1) {
        event.preventDefault();
        history.back();
      }
    });
  });

  /* ------------------------------------------------------------------
     Corner icons: hidden while scrolling down, shown again on any scroll
     up, even a small one. "rest" tells whether a position is one where
     the view can settle, so the snap back after a short upward drag in
     full screen mode does not hide the icons again.
     ------------------------------------------------------------------ */
  var HIDE_AFTER = 12; // pixels scrolled down before the icons hide

  var autoHide = function (target, getTop, rest) {
    var last = Math.max(0, getTop());
    var anchor = last;
    var timer;
    var set = function (hidden) { root.classList.toggle('icons-hidden', hidden); };
    target.addEventListener('scroll', function () {
      var top = Math.max(0, getTop());
      if (top <= 0 || top < last - 1) set(false);
      else if (top > anchor + HIDE_AFTER) set(true);
      last = top;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!rest || rest(last)) anchor = last;
      }, 160);
    }, { passive: true });
    return function () { // call after a programmatic jump
      last = anchor = Math.max(0, getTop());
      set(false);
    };
  };

  /* ------------------------------------------------------------------
     Home: full screen <-> grid
     ------------------------------------------------------------------ */
  var feed = document.getElementById('feed');
  var modeButton = document.getElementById('mode');

  if (feed && modeButton) {
    var items = Array.prototype.slice.call(feed.querySelectorAll('.item'));
    var STORE = 'feed-index';

    var currentIndex = function () {
      var top = feed.scrollTop;
      for (var i = 0; i < items.length; i++) {
        if (items[i].offsetTop + items[i].offsetHeight > top + 1) return i;
      }
      return 0;
    };

    var showIcons = autoHide(feed, function () { return feed.scrollTop; }, function (top) {
      if (root.dataset.mode !== 'full') return true;
      var height = feed.clientHeight || 1;
      return Math.abs(top - Math.round(top / height) * height) < 2; // resting on a photo
    });

    var goTo = function (index) {
      if (items[index]) feed.scrollTop = items[index].offsetTop;
      showIcons();
    };

    var label = function () {
      modeButton.setAttribute(
        'aria-label',
        root.dataset.mode === 'grid' ? 'Switch to full screen view' : 'Switch to grid view'
      );
    };

    var setMode = function (mode) {
      var index = currentIndex();
      root.dataset.mode = mode;
      history.replaceState(null, '', mode === 'grid' ? '#grid' : location.pathname + location.search);
      goTo(index); // keep the same post in view
      label();
    };

    modeButton.addEventListener('click', function () {
      setMode(root.dataset.mode === 'grid' ? 'full' : 'grid');
    });

    window.addEventListener('hashchange', function () {
      var mode = location.hash === '#grid' ? 'grid' : 'full';
      if (mode !== root.dataset.mode) setMode(mode);
    });

    // Remember the position within this tab, so "back" from a post lands on the same photo.
    var ticking = false;
    feed.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        try { sessionStorage.setItem(STORE, String(currentIndex())); } catch (e) {}
      });
    }, { passive: true });

    var restore = function () {
      var saved = 0;
      try { saved = parseInt(sessionStorage.getItem(STORE), 10) || 0; } catch (e) {}
      if (saved) goTo(saved);
    };
    restore();
    window.addEventListener('pageshow', function (event) { if (event.persisted) restore(); });
    label();
  } else {
    autoHide(window, function () { return window.scrollY; });
  }

  /* ------------------------------------------------------------------
     Reactions: one per visitor per post, anonymous.
     The visitor is a random id kept in this browser. Without a backend
     (see reactions.sql) the choice is only remembered on this device.
     ------------------------------------------------------------------ */
  var box = document.querySelector('.reactions');

  if (box) {
    var post = box.dataset.post;
    var config = window.SITE_REACTIONS || {};
    var remote = !!(config.url && config.key);
    var buttons = Array.prototype.slice.call(box.querySelectorAll('.reaction'));
    var counts = {};

    var uuid = function () {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });
    };

    var state;
    try { state = JSON.parse(localStorage.getItem('reactions') || '{}'); } catch (e) { state = {}; }
    if (!state || typeof state !== 'object') state = {};
    state.picks = state.picks || {};
    state.voter = state.voter || uuid();

    var save = function () {
      try { localStorage.setItem('reactions', JSON.stringify(state)); } catch (e) {}
    };
    save();

    var render = function () {
      buttons.forEach(function (button) {
        var kind = button.dataset.kind;
        button.setAttribute('aria-pressed', state.picks[post] === kind ? 'true' : 'false');
        button.querySelector('.count').textContent = remote && counts[kind] > 0 ? counts[kind] : '';
      });
    };

    var rpc = function (name, body) {
      return fetch(config.url + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.key,
          Authorization: 'Bearer ' + config.key
        },
        body: JSON.stringify(body)
      }).then(function (response) {
        if (!response.ok) throw new Error('reactions: ' + response.status);
        return response.status === 204 ? null : response.json();
      });
    };

    var refresh = function () {
      return rpc('reaction_counts', { p_post: post }).then(function (rows) {
        counts = {};
        (rows || []).forEach(function (row) { counts[row.kind] = Number(row.count); });
        render();
      }).catch(function () {});
    };

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var kind = button.dataset.kind;
        var previous = state.picks[post] || null;
        var next = previous === kind ? null : kind; // tap again to remove
        if (previous) counts[previous] = Math.max(0, (counts[previous] || 0) - 1);
        if (next) {
          counts[next] = (counts[next] || 0) + 1;
          state.picks[post] = next;
        } else {
          delete state.picks[post];
        }
        save();
        render();
        if (remote) {
          rpc('react', { p_post: post, p_voter: state.voter, p_kind: next }).then(refresh).catch(function () {});
        }
      });
    });

    render();
    if (remote) refresh();
  }
})();
