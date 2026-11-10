(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
     Home: full screen -> grid -> index. The page itself scrolls (no inner scroll
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

    var STEP_TIME = 550; // ms for the slide from one photo to the next
    var animating = false;

    var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

    // Slide to a photo with our own animation. Snapping is paused meanwhile:
    // some browsers (Safari) cancel a smooth scroll on a snapping page.
    var slideTo = function (target) {
      if (reduceMotion) return window.scrollTo(0, target);
      var start = window.scrollY;
      var distance = target - start;
      var began = null;
      animating = true;
      root.style.scrollSnapType = 'none';
      var frame = function (now) {
        if (began === null) began = now;
        var t = Math.min(1, (now - began) / STEP_TIME);
        window.scrollTo(0, start + distance * ease(t));
        if (t < 1) return requestAnimationFrame(frame);
        window.scrollTo(0, target);
        root.style.scrollSnapType = '';
        animating = false;
      };
      requestAnimationFrame(frame);
    };

    // A click or tap while the photos are moving (our slide, or the phone's
    // own scrolling and snapping): the browser would not open anything, as
    // the press and release land on different photos, or the phone uses the
    // first tap just to stop the scroll. Open the photo that was pressed.
    var lastScroll = 0;
    window.addEventListener('scroll', function () { lastScroll = Date.now(); }, { passive: true });
    var pressed = null;
    feed.addEventListener('pointerdown', function (event) {
      var item = event.target.closest('.item');
      // On touch screens every short tap is handled here: iOS may otherwise
      // spend it on settling the page instead of opening the photo.
      var moving = animating || Date.now() - lastScroll < 150 || event.pointerType === 'touch';
      pressed = moving && item && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey
        ? { href: item.href, x: event.clientX, y: event.clientY, at: Date.now() } : null;
    });
    window.addEventListener('pointercancel', function () { pressed = null; });
    window.addEventListener('pointerup', function (event) {
      var press = pressed;
      pressed = null;
      if (press && Date.now() - press.at < 600 &&
          Math.abs(event.clientX - press.x) < 12 && Math.abs(event.clientY - press.y) < 12) {
        location.href = press.href;
      }
    });

    var goTo = function (index, smooth) {
      if (!items[index]) return;
      if (smooth) slideTo(items[index].offsetTop);
      else window.scrollTo(0, items[index].offsetTop);
    };

    var NEXT = { full: 'grid', grid: 'index', index: 'full' };
    var NAMES = { full: 'full screen view', grid: 'grid view', index: 'index of titles' };
    var lastIndex = 0; // photo in view before switching to the index

    var label = function () {
      modeButton.setAttribute('aria-label', 'Switch to ' + NAMES[NEXT[root.dataset.mode] || 'grid']);
    };

    // Image sizes for the browser to pick the right file: large in full screen, small in the grid.
    var sizes = function () {
      var value = root.dataset.mode === 'grid' ? '(min-width: 768px) 25vh, 34vw' : '(min-width: 768px) 75vh, 100vw';
      items.forEach(function (item) {
        var img = item.querySelector('img[srcset]');
        if (img && img.getAttribute('sizes') !== value) img.setAttribute('sizes', value);
      });
    };

    var setMode = function (mode) {
      var index = root.dataset.mode === 'index' ? lastIndex : currentIndex();
      if (mode === 'index') lastIndex = index;
      root.dataset.mode = mode;
      history.replaceState(null, '', mode === 'full' ? location.pathname + location.search : '#' + mode);
      sizes();
      if (mode === 'index') window.scrollTo(0, 0);
      else goTo(index); // keep the same post in view
      label();
    };

    modeButton.addEventListener('click', function () {
      setMode(NEXT[root.dataset.mode] || 'grid');
    });

    window.addEventListener('hashchange', function () {
      var mode = { '#grid': 'grid', '#index': 'index' }[location.hash] || 'full';
      if (mode !== root.dataset.mode) setMode(mode);
    });
    sizes();

    /* Mouse wheel and trackpad, full screen only: one photo per gesture.
       A swipe moves exactly one photo. After a trackpad swipe the system
       keeps sending fading "inertia" events for a second or so; those are
       ignored. A new gesture is recognised by a pause in the events, a
       change of direction, or the movement speeding up again (a new swipe
       started while the inertia of the previous one was still fading).
       Touch screens keep the native snapping. */
    var GESTURE_GAP = 160;  // ms without wheel events that ends a gesture
    var MIN_STEP = 600;     // ms between two moves at least (includes the slide)
    var THRESHOLD = 20;     // wheel distance needed to move
    var SPEED_UP = 1.4;     // a delta this much larger than the recent ones starts a new gesture
    var lastWheel = 0;
    var lastSign = 0;
    var recent = [];        // the last few wheel deltas (absolute)
    var lockedAt = 0;
    var locked = false;
    var travel = 0;

    window.addEventListener('wheel', function (event) {
      if (root.dataset.mode !== 'full' || event.ctrlKey) return; // ctrl: pinch zoom
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      var size = Math.abs(delta);
      var sign = delta > 0 ? 1 : delta < 0 ? -1 : 0;
      var now = Date.now();
      var gap = now - lastWheel;
      var peak = Math.max.apply(null, recent.concat([0]));
      var fresh = gap > GESTURE_GAP ||
        (sign && lastSign && sign !== lastSign) ||
        (size > 8 && size > peak * SPEED_UP);
      lastWheel = now;
      if (sign) lastSign = sign;
      recent = (gap > GESTURE_GAP ? [] : recent.slice(-3)).concat([size]);

      if (fresh) travel = 0;
      if (animating) return;
      if (locked) {
        if (fresh && now - lockedAt > MIN_STEP) locked = false;
        else return;
      }
      travel += delta;
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
     Images: mark them once loaded, so the loading spinner behind them
     goes away (it would show through transparent images).
     ------------------------------------------------------------------ */
  Array.prototype.forEach.call(document.images, function (img) {
    var done = function () { img.classList.add('loaded'); };
    if (img.complete && img.naturalWidth) done();
    else img.addEventListener('load', done, { once: true });
  });

  /* ------------------------------------------------------------------
     Short looping clips: for visitors who asked for less motion they do
     not start by themselves; they get the usual controls instead.
     ------------------------------------------------------------------ */
  if (reduceMotion) {
    Array.prototype.forEach.call(document.querySelectorAll('.loop video'), function (video) {
      video.removeAttribute('autoplay');
      video.pause();
      video.controls = true;
      video.style.pointerEvents = 'auto';
    });
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
