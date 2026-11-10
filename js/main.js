/*
 * main.js — home page: scroll progress and the clickable buttons on the tree.
 */
(function () {
  var cfg = window.SITE_CONFIG;
  var root = document.documentElement;
  var stage = document.getElementById("stage");
  var view = document.getElementById("view");
  var labels = document.getElementById("labels");
  var hint = document.getElementById("hint");

  var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
  var smooth = function (t) { t = clamp01(t); return t * t * (3 - 2 * t); };

  // Tree buttons are real links, positioned over the canvas every frame.
  var els = {};
  cfg.nodes.forEach(function (n) {
    var el = document.createElement("div");
    el.className = "node " + (n.side === "root" ? "down" : "up");
    var a = document.createElement("a");
    a.href = n.href || ("#" + n.id);
    a.textContent = n.label;
    el.appendChild(a);
    labels.appendChild(el);
    els[n.id] = { el: el, a: a, half: 40 };
  });

  var scene = null;
  try { scene = window.TreeScene(document.getElementById("tree"), cfg); }
  catch (e) { if (window.console) console.error("Tree could not start:", e); }
  if (!scene) { root.classList.add("no-tree"); return; }   // buttons stay, as a plain list
  root.setAttribute("data-renderer", scene.mode);

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  stage.style.setProperty("--screens", reduced ? 1 : cfg.scroll.screens);

  var W = 1, H = 1;
  function measure() {
    W = view.clientWidth; H = view.clientHeight;
    scene.resize(W, H);
    for (var id in els) els[id].half = els[id].a.offsetWidth / 2;
  }
  measure();
  if (window.ResizeObserver) new ResizeObserver(measure).observe(view);
  else window.addEventListener("resize", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  // Follow the page theme.
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", scene.recolor);
  new MutationObserver(scene.recolor).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  // Mouse parallax (mouse only: touch scrolling should not move the camera).
  var pointer = { x: 0, y: 0 }, pointerTarget = { x: 0, y: 0 };
  window.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  function target() {
    if (reduced) return 1;
    var total = stage.offsetHeight - H;
    return total > 0 ? clamp01(-stage.getBoundingClientRect().top / total) : 0;
  }

  // "index.html#grown" (used by the Back links) opens the tree already complete.
  if (location.hash === "#grown" && !reduced) window.scrollTo(0, stage.offsetHeight - H);

  var progress = null;
  function frame(ms) {
    requestAnimationFrame(frame);
    var t = target();
    if (progress === null) progress = t;      // no replay when the page opens part-way down
    progress += (t - progress) * cfg.scroll.smoothing;
    if (Math.abs(t - progress) < 0.0004) progress = t;
    pointer.x += (pointerTarget.x - pointer.x) * 0.05;
    pointer.y += (pointerTarget.y - pointer.y) * 0.05;

    scene.update(progress, ms / 1000, pointer);

    var h = cfg.timeline.hint;
    hint.style.opacity = 1 - smooth((progress - h[0]) / (h[1] - h[0]));

    var gutter = 8;
    scene.nodes.forEach(function (n) {
      var L = els[n.id];
      var x = Math.max(gutter + L.half, Math.min(W - gutter - L.half, n.x));
      L.el.style.transform = "translate3d(" + x.toFixed(1) + "px," + n.y.toFixed(1) + "px,0)";
      L.el.style.opacity = n.s;
      L.el.style.visibility = n.s < 0.01 ? "hidden" : "visible";
      L.el.style.pointerEvents = n.s > 0.6 ? "auto" : "none";
    });
  }
  requestAnimationFrame(frame);
})();
