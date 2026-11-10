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
     Home: full screen <-> grid. The page itself scrolls (no inner scroll
     box) so mobile browsers can shrink their bars while scrolling down.
     ------------------------------------------------------------------ */
  var feed = document.getElementById('feed');
  var modeButton = document.getElementById('mode');

  if (feed && modeButton) {
    var items = Array.prototype.slice.call(feed.querySelectorAll('.item'));
    var STORE = 'feed-index';

    var currentIndex = function () {
      var top = window.scrollY;
      for (var i = 0; i < items.length; i++) {
        if (items[i].offsetTop + items[i].offsetHeight > top + 1) return i;
      }
      return 0;
    };

    var goTo = function (index, smooth) {
      if (!items[index]) return;
      window.scrollTo({ top: items[index].offsetTop, behavior: smooth ? 'smooth' : 'auto' });
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

    /* Mouse wheel and trackpad, full screen only: one photo per gesture.
       A flick moves exactly one photo; the next move needs a new gesture
       (a short pause in the wheel events), so photos do not fly past.
       Touch screens keep the native snapping. */
    var GESTURE_GAP = 180;  // ms without wheel events that ends a gesture
    var MIN_STEP = 650;     // ms a photo stays put at least
    var THRESHOLD = 20;     // wheel distance needed to move
    var lastWheel = 0;
    var lockedAt = 0;
    var locked = false;
    var travel = 0;

    window.addEventListener('wheel', function (event) {
      if (root.dataset.mode !== 'full' || event.ctrlKey) return; // ctrl: pinch zoom
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      var now = Date.now();
      var gap = now - lastWheel;
      lastWheel = now;
      if (gap > GESTURE_GAP) travel = 0;
      if (locked) {
        if (gap > GESTURE_GAP && now - lockedAt > MIN_STEP) locked = false;
        else return;
      }
      travel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      if (Math.abs(travel) < THRESHOLD) return;
      var height = items[0] ? items[0].offsetHeight : window.innerHeight;
      var index = Math.round(window.scrollY / height) + (travel > 0 ? 1 : -1);
      travel = 0;
      locked = true;
      lockedAt = now;
      if (index >= 0 && index < items.length) goTo(index, true);
    }, { passive: false });

    // Remember the position within this tab, so "back" from a post lands on the same photo.
    var ticking = false;
    window.addEventListener('scroll', function () {
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
      if (saved && window.scrollY < 2) goTo(saved);
    };
    var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (nav && nav.type === 'back_forward') restore();
    window.addEventListener('pageshow', function (event) { if (event.persisted) restore(); });
    label();
  }

  /* ------------------------------------------------------------------
     Reactions note: shown on hover, or toggled by tapping the asterisk.
     ------------------------------------------------------------------ */
  var info = document.querySelector('.reactions-info');
  if (info) {
    info.addEventListener('click', function () {
      var open = info.closest('.reactions-box').classList.toggle('open');
      info.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
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
