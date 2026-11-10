/*
 * main.js — wires the page together: scroll progress, tree labels, hero fade.
 */
(function () {
  var cfg = window.SITE_CONFIG;
  var root = document.documentElement;
  var stage = document.getElementById("stage");
  var view = document.getElementById("view");
  var canvas = document.getElementById("tree");
  var labels = document.getElementById("labels");
  var hero = document.getElementById("hero");
  var hint = document.getElementById("hint");
  var spec = document.getElementById("spec");

  var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
  var smooth = function (t) { t = clamp01(t); return t * t * (3 - 2 * t); };

  spec.textContent = "seed " + String(cfg.tree.seed).padStart(2, "0") + " · " + cfg.nodes.length + " buds";

  var scene = null;
  var failure = "";
  try { scene = window.TreeScene(canvas, cfg); } catch (e) { scene = null; failure = e && e.message ? e.message : String(e); }
  if (!scene) {
    // The page still works as a plain page; say why the tree is missing.
    root.classList.add("no-webgl");
    var note = document.getElementById("tree-error");
    note.textContent = (window.THREE ? "3D tree unavailable: WebGL could not start in this browser. " : "3D tree unavailable: three.js did not load. ") + failure;
    note.hidden = false;
    if (window.console) console.error("Tree scene failed:", failure);
    return;
  }

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  stage.style.setProperty("--screens", reduced ? 1 : cfg.scroll.screens);

  // Tree buttons are real links, positioned over the canvas every frame.
  var els = {};
  cfg.nodes.forEach(function (n) {
    var el = document.createElement("div");
    el.className = "node " + (n.side === "root" ? "down" : "up");
    var a = document.createElement("a");
    a.href = n.href || ("#" + n.id);
    var name = document.createElement("span"); name.className = "name"; name.textContent = n.label;
    var kind = document.createElement("span"); kind.className = "kind"; kind.textContent = n.kind;
    a.appendChild(name); a.appendChild(kind); el.appendChild(a);
    labels.appendChild(el);
    els[n.id] = { el: el, a: a, half: 50 };
  });

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

  var progress = reduced ? 1 : 0;
  function target() {
    if (reduced) return 1;
    var r = stage.getBoundingClientRect();
    var total = r.height - H;
    return total > 0 ? clamp01(-r.top / total) : 0;
  }

  function frame(ms) {
    requestAnimationFrame(frame);
    if (stage.getBoundingClientRect().bottom < -40) return;   // tree is off screen: rest

    var t = target();
    progress += (t - progress) * cfg.scroll.smoothing;
    if (Math.abs(t - progress) < 0.0004) progress = t;
    pointer.x += (pointerTarget.x - pointer.x) * 0.05;
    pointer.y += (pointerTarget.y - pointer.y) * 0.05;

    scene.update(progress, ms / 1000, pointer);

    var fade = 1 - smooth((progress - cfg.timeline.title[0]) / (cfg.timeline.title[1] - cfg.timeline.title[0]));
    hero.style.opacity = fade;
    hero.style.transform = "translate3d(0," + (-(1 - fade) * 36) + "px,0)";
    hero.style.visibility = fade < 0.01 ? "hidden" : "visible";
    hint.style.opacity = fade;

    var gutter = 12;
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
