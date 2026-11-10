/*
 * scene.js — draws the tree. You rarely need to touch this file:
 * shape, timing and camera are driven by js/config.js, colors by css/style.css.
 *
 * Two renderers share the same tree, camera and timeline:
 *   "webgl"  : three.js WebGLRenderer (used when the browser supports WebGL)
 *   "canvas" : plain 2D canvas, same 3D projection done by hand
 *              (used on machines where WebGL cannot start)
 */
window.TreeScene = function (canvas, cfg) {
  var THREE = window.THREE;
  var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { t = clamp01(t); return t * t * (3 - 2 * t); };
  var backOut = function (t) { var c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
  var rad = function (d) { return d * Math.PI / 180; };

  var A = cfg.atmosphere, TL = cfg.timeline;
  var tree = window.TreeBuilder.build(cfg);
  var camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.1, 100);
  var tanF = Math.tan(rad(cfg.camera.fov) / 2);
  var fog = { near: 1, far: 10 };
  var colors = { paper: new THREE.Color(), ink: new THREE.Color(), pollen: new THREE.Color() };
  var width = 1, height = 1, fitDistance = 10;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var nodes = [];
  tree.limbs.forEach(function (limb) {
    if (limb.node) nodes.push({ id: limb.node.id, tip: limb.tip, limb: limb, s: 0, x: 0, y: 0 });
  });

  // Specks floating around the tree (shared by both renderers).
  var dustPts = new Float32Array(A.particles * 3);
  for (var p = 0; p < A.particles; p++) {
    dustPts[p * 3] = (Math.random() - 0.5) * 7;
    dustPts[p * 3 + 1] = tree.bounds.minY - 0.5 + Math.random() * (tree.bounds.maxY - tree.bounds.minY + 1);
    dustPts[p * 3 + 2] = (Math.random() - 0.5) * 5;
  }
  var ringPts = [];
  if (A.groundRing > 0) {
    for (var i = 0; i < 128; i++) {
      var ang = i / 128 * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(ang) * A.groundRing, 0, Math.sin(ang) * A.groundRing));
    }
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors.paper.set(cs.getPropertyValue("--paper").trim());
    colors.ink.set(cs.getPropertyValue("--ink").trim());
    colors.pollen.set(cs.getPropertyValue("--pollen").trim());
  }

  function cameraAt(p, time, pointer) {
    var keys = cfg.camera.keys, k0 = keys[0], k1 = keys[keys.length - 1];
    for (var i = 0; i < keys.length - 1; i++) {
      if (p >= keys[i].at && p <= keys[i + 1].at) { k0 = keys[i]; k1 = keys[i + 1]; break; }
    }
    var span = k1.at - k0.at, u = span > 0 ? smooth((p - k0.at) / span) : 0;
    var ly = function (k) { return k.lookY === "center" ? tree.bounds.centerY : k.lookY; };
    var d = fitDistance * lerp(k0.zoom, k1.zoom, u);
    var lookY = lerp(ly(k0), ly(k1), u);
    var sway = cfg.camera.sway, ptr = cfg.camera.pointer.degrees;
    var orbit = rad(lerp(k0.orbit, k1.orbit, u) + Math.sin(time * sway.speed) * sway.degrees + pointer.x * ptr);
    var tilt = rad(lerp(k0.tilt || 0, k1.tilt || 0, u) - pointer.y * ptr * 0.5);
    camera.position.set(Math.sin(orbit) * Math.cos(tilt) * d, lookY + Math.sin(tilt) * d, Math.cos(orbit) * Math.cos(tilt) * d);
    camera.lookAt(0, lookY, 0);
    camera.updateMatrixWorld();
    fog.near = Math.max(0.1, d + A.fogStart);
    fog.far = fog.near + A.fogDepth;
  }

  function fit(w, h) {
    width = Math.max(1, w); height = Math.max(1, h);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    var F = cfg.camera.framing, b = tree.bounds;
    var halfH = (b.maxY - b.minY) / 2 + F.padY, halfW = b.maxX + F.padX;
    fitDistance = Math.max(halfH / tanF, halfW / (tanF * camera.aspect)) * F.margin;
  }

  var v = new THREE.Vector3();
  function placeNodes(p) {
    nodes.forEach(function (n) {
      n.s = clamp01((p - n.limb.b) / TL.labelFade);
      v.copy(n.tip).project(camera);
      n.x = (v.x * 0.5 + 0.5) * width;
      n.y = (-v.y * 0.5 + 0.5) * height;
    });
  }
  function seedScale(p, time) {
    return (1 - smooth((p - TL.trunk[0]) / 0.12)) * (1 + 0.18 * Math.sin(time * 2.2));
  }

  /* ---------------------------------------------------------------- WebGL */
  function webgl() {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(dpr);
    var scene = new THREE.Scene();
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(0xffffff, 1, 10);

    // Flat "ink" materials: depth comes from fog and parallax, not from lighting.
    var inkMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    var budMat = new THREE.MeshBasicMaterial();
    var ringMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.28 });
    var dustMat = new THREE.PointsMaterial({ size: A.particleSize, transparent: true, opacity: 0.3, sizeAttenuation: true });
    var budGeo = new THREE.SphereGeometry(A.budSize, 18, 12);

    tree.limbs.forEach(function (limb) {
      var twig = limb.kind === "twig";
      var geo = window.TreeBuilder.tube(limb,
        twig ? Math.max(8, Math.round(cfg.tree.segments / 3)) : cfg.tree.segments,
        twig ? 5 : cfg.tree.radialSegments);
      geo.setDrawRange(0, 0);
      limb.mesh = new THREE.Mesh(geo, inkMat);
      limb.mesh.visible = false;
      scene.add(limb.mesh);
    });
    nodes.forEach(function (n) {
      n.bud = new THREE.Mesh(budGeo, budMat);
      n.bud.position.copy(n.tip);
      n.bud.visible = false;
      scene.add(n.bud);
    });
    var seed = new THREE.Mesh(budGeo, budMat);
    scene.add(seed);
    if (ringPts.length) scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat));
    var dust = null;
    if (A.particles > 0) {
      var dg = new THREE.BufferGeometry();
      dg.setAttribute("position", new THREE.BufferAttribute(dustPts, 3));
      dust = new THREE.Points(dg, dustMat);
      scene.add(dust);
    }

    return {
      recolor: function () {
        scene.background.copy(colors.paper); scene.fog.color.copy(colors.paper);
        inkMat.color.copy(colors.ink); ringMat.color.copy(colors.ink); dustMat.color.copy(colors.ink);
        budMat.color.copy(colors.pollen);
      },
      resize: function () { renderer.setSize(width, height, false); },
      draw: function (p, time) {
        tree.limbs.forEach(function (limb) {
          var g = clamp01((p - limb.a) / (limb.b - limb.a));
          var ud = limb.mesh.geometry.userData;
          var count = Math.round(g * ud.segs) * ud.perSeg;
          limb.mesh.geometry.setDrawRange(0, count);
          limb.mesh.visible = count > 0;
        });
        var ss = seedScale(p, time);
        seed.visible = ss > 0.01;
        seed.scale.setScalar(Math.max(0.001, ss));
        if (dust) { dust.rotation.y = time * 0.02; dust.position.y = Math.sin(time * 0.1) * 0.12; }
        nodes.forEach(function (n) {
          n.bud.visible = n.s > 0;
          n.bud.scale.setScalar(Math.max(0.001, backOut(n.s)));
        });
        scene.fog.near = fog.near; scene.fog.far = fog.far;
        renderer.render(scene, camera);
      }
    };
  }

  /* ------------------------------------------------------------ 2D canvas */
  function canvas2d() {
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context");
    var tmp = new THREE.Color(), q = new THREE.Vector3();

    // Sample every limb once: points along the curve and the radius at each.
    tree.limbs.forEach(function (limb) {
      var n = limb.kind === "twig" ? Math.max(8, Math.round(cfg.tree.segments / 3)) : cfg.tree.segments;
      var pts = new Float32Array((n + 1) * 3), radii = new Float32Array(n + 1);
      for (var i = 0; i <= n; i++) {
        limb.curve.getPointAt(i / n, q);
        pts[i * 3] = q.x; pts[i * 3 + 1] = q.y; pts[i * 3 + 2] = q.z;
        radii[i] = lerp(limb.r0, limb.r1, i / n);
      }
      limb.samples = { n: n, pts: pts, radii: radii, sx: new Float32Array(n + 1), sy: new Float32Array(n + 1), sr: new Float32Array(n + 1) };
      limb.depth = 0;
    });

    // World point -> screen x, y, depth (distance in front of the camera).
    var out = { x: 0, y: 0, d: 0 };
    function project(x, y, z) {
      q.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      out.d = -q.z;
      q.applyMatrix4(camera.projectionMatrix);
      out.x = (q.x * 0.5 + 0.5) * width;
      out.y = (-q.y * 0.5 + 0.5) * height;
      return out;
    }
    var pixels = function (r, d) { return r * (height / 2) / (tanF * Math.max(d, 0.05)); };
    var fogAt = function (d) { return smooth((d - fog.near) / (fog.far - fog.near)); };
    var shade = function (color, d) { return "#" + tmp.copy(color).lerp(colors.paper, fogAt(d)).getHexString(); };

    function drawLimb(limb, p) {
      var S = limb.samples;
      var m = Math.round(clamp01((p - limb.a) / (limb.b - limb.a)) * S.n);
      if (m < 1) return;
      var i, o;
      for (i = 0; i <= m; i++) {
        o = project(S.pts[i * 3], S.pts[i * 3 + 1], S.pts[i * 3 + 2]);
        if (o.d <= 0.05) return;
        // While a limb is still growing, its tip tapers to a point instead of ending blunt.
        var taper = m < S.n ? Math.min(1, 0.12 + (m - i) / 8) : 1;
        S.sx[i] = o.x; S.sy[i] = o.y; S.sr[i] = Math.max(0.45, pixels(S.radii[i], o.d) * taper);
      }
      ctx.fillStyle = shade(colors.ink, limb.depth);
      ctx.beginPath();
      var nx, ny, len, a, b;
      for (i = 0; i <= m; i++) {            // one side, base to tip
        a = Math.max(0, i - 1); b = Math.min(m, i + 1);
        nx = -(S.sy[b] - S.sy[a]); ny = S.sx[b] - S.sx[a]; len = Math.sqrt(nx * nx + ny * ny) || 1;
        ctx.lineTo(S.sx[i] + nx / len * S.sr[i], S.sy[i] + ny / len * S.sr[i]);
      }
      for (i = m; i >= 0; i--) {            // other side, tip to base
        a = Math.max(0, i - 1); b = Math.min(m, i + 1);
        nx = -(S.sy[b] - S.sy[a]); ny = S.sx[b] - S.sx[a]; len = Math.sqrt(nx * nx + ny * ny) || 1;
        ctx.lineTo(S.sx[i] - nx / len * S.sr[i], S.sy[i] - ny / len * S.sr[i]);
      }
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(S.sx[m], S.sy[m], S.sr[m], 0, Math.PI * 2); ctx.fill();   // round tip
    }

    function dot(pos, radius, scale, color) {
      var o = project(pos.x, pos.y, pos.z);
      if (o.d <= 0.05 || scale <= 0.01) return;
      ctx.fillStyle = shade(color, o.d);
      ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(1.5, pixels(radius, o.d)) * scale, 0, Math.PI * 2); ctx.fill();
    }

    var origin = new THREE.Vector3(0, 0, 0);
    var sorted = tree.limbs.slice();

    return {
      recolor: function () {},
      resize: function () { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); },
      draw: function (p, time) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#" + colors.paper.getHexString();
        ctx.fillRect(0, 0, width, height);
        var ink = "#" + colors.ink.getHexString(), i, o;

        // Soil line
        if (ringPts.length) {
          ctx.beginPath();
          for (i = 0; i < ringPts.length; i++) {
            o = project(ringPts[i].x, ringPts[i].y, ringPts[i].z);
            if (o.d <= 0.05) continue;
            ctx.lineTo(o.x, o.y);
          }
          ctx.closePath();
          ctx.globalAlpha = 0.28; ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
        }

        // Specks
        if (A.particles > 0) {
          var rot = time * 0.02, cr = Math.cos(rot), sr = Math.sin(rot), dy = Math.sin(time * 0.1) * 0.12;
          ctx.fillStyle = ink;
          for (i = 0; i < A.particles; i++) {
            var x = dustPts[i * 3], z = dustPts[i * 3 + 2];
            o = project(x * cr + z * sr, dustPts[i * 3 + 1] + dy, -x * sr + z * cr);
            if (o.d <= 0.05) continue;
            var s = Math.max(1, pixels(A.particleSize * 0.5, o.d));
            ctx.globalAlpha = 0.3 * (1 - fogAt(o.d));
            ctx.fillRect(o.x - s / 2, o.y - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        }

        // Limbs, farthest first so nearer ones paint over them.
        sorted.forEach(function (limb) {
          var S = limb.samples, mid = Math.floor(S.n / 2) * 3;
          limb.depth = project(S.pts[mid], S.pts[mid + 1], S.pts[mid + 2]).d;
        });
        sorted.sort(function (a, b) { return b.depth - a.depth; });
        sorted.forEach(function (limb) { drawLimb(limb, p); });

        dot(origin, A.budSize, seedScale(p, time), colors.pollen);
        nodes.forEach(function (n) { if (n.s > 0) dot(n.tip, A.budSize, backOut(n.s), colors.pollen); });
      }
    };
  }

  /* ------------------------------------------------------- pick renderer */
  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (e) { return false; }
  }

  var want = (cfg.render && cfg.render.mode) || "auto";
  var mode = (want === "canvas" || (want === "auto" && !hasWebGL())) ? "canvas" : "webgl";
  var impl;
  if (mode === "webgl") {
    try { impl = webgl(); }
    catch (e) {
      // A canvas that was asked for WebGL cannot be reused for 2D: swap in a fresh one.
      var fresh = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh; mode = "canvas";
    }
  }
  if (mode === "canvas") impl = canvas2d();

  readColors(); impl.recolor();

  return {
    mode: mode,
    nodes: nodes,
    tree: tree,
    recolor: function () { readColors(); impl.recolor(); },
    resize: function (w, h) { fit(w, h); impl.resize(); },
    update: function (p, time, pointer) {
      cameraAt(p, time, pointer);
      placeNodes(p);
      impl.draw(p, time);
    }
  };
};
