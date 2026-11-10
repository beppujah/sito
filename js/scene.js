/*
 * scene.js — three.js setup. You rarely need to touch this file:
 * shape, timing and camera are driven by js/config.js, colors by css/style.css.
 */
window.TreeScene = function (canvas, cfg) {
  var THREE = window.THREE;
  var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { t = clamp01(t); return t * t * (3 - 2 * t); };
  var backOut = function (t) { var c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
  var rad = function (d) { return d * Math.PI / 180; };

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0xffffff, 1, 10);
  var camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.1, 100);

  var A = cfg.atmosphere, TL = cfg.timeline;
  var tree = window.TreeBuilder.build(cfg);

  // Flat "ink" materials: depth comes from fog and parallax, not from lighting.
  var inkMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  var budMat = new THREE.MeshBasicMaterial();
  var ringMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.28 });
  var dustMat = new THREE.PointsMaterial({ size: A.particleSize, transparent: true, opacity: 0.3, sizeAttenuation: true });

  // Limbs
  var budGeo = new THREE.SphereGeometry(A.budSize, 18, 12);
  var nodes = [];
  tree.limbs.forEach(function (limb) {
    var twig = limb.kind === "twig";
    var geo = window.TreeBuilder.tube(limb,
      twig ? Math.max(8, Math.round(cfg.tree.segments / 3)) : cfg.tree.segments,
      twig ? 5 : cfg.tree.radialSegments);
    geo.setDrawRange(0, 0);
    limb.mesh = new THREE.Mesh(geo, inkMat);
    limb.mesh.visible = false;
    scene.add(limb.mesh);
    if (limb.node) {
      var bud = new THREE.Mesh(budGeo, budMat);
      bud.position.copy(limb.tip);
      bud.visible = false;
      scene.add(bud);
      nodes.push({ id: limb.node.id, tip: limb.tip, limb: limb, bud: bud, s: 0, x: 0, y: 0 });
    }
  });

  // Seed: the only thing visible before scrolling.
  var seed = new THREE.Mesh(budGeo, budMat);
  seed.position.set(0, 0, 0);
  scene.add(seed);

  // Soil line
  if (A.groundRing > 0) {
    var pts = [];
    for (var i = 0; i < 128; i++) {
      var ang = i / 128 * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(ang) * A.groundRing, 0, Math.sin(ang) * A.groundRing));
    }
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  }

  // Floating specks
  var dust = null;
  if (A.particles > 0) {
    var arr = new Float32Array(A.particles * 3);
    for (var p = 0; p < A.particles; p++) {
      arr[p * 3] = (Math.random() - 0.5) * 7;
      arr[p * 3 + 1] = tree.bounds.minY - 0.5 + Math.random() * (tree.bounds.maxY - tree.bounds.minY + 1);
      arr[p * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    var dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    dust = new THREE.Points(dg, dustMat);
    scene.add(dust);
  }

  // Colors come from the CSS tokens, so the scene follows the page theme.
  function recolor() {
    var cs = getComputedStyle(document.documentElement);
    var get = function (name) { return cs.getPropertyValue(name).trim(); };
    scene.background.set(get("--paper"));
    scene.fog.color.set(get("--paper"));
    inkMat.color.set(get("--ink"));
    ringMat.color.set(get("--ink"));
    dustMat.color.set(get("--ink"));
    budMat.color.set(get("--pollen"));
  }
  recolor();

  var width = 1, height = 1, fitDistance = 10;
  function resize(w, h) {
    width = Math.max(1, w); height = Math.max(1, h);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    var F = cfg.camera.framing, b = tree.bounds, tanF = Math.tan(rad(cfg.camera.fov) / 2);
    var halfH = (b.maxY - b.minY) / 2 + F.padY, halfW = b.maxX + F.padX;
    fitDistance = Math.max(halfH / tanF, halfW / (tanF * camera.aspect)) * F.margin;
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
    scene.fog.near = Math.max(0.1, d + A.fogStart);
    scene.fog.far = scene.fog.near + A.fogDepth;
  }

  var v = new THREE.Vector3();
  function update(p, time, pointer) {
    tree.limbs.forEach(function (limb) {
      var g = clamp01((p - limb.a) / (limb.b - limb.a));
      var ud = limb.mesh.geometry.userData;
      var count = Math.round(g * ud.segs) * ud.perSeg;
      limb.mesh.geometry.setDrawRange(0, count);
      limb.mesh.visible = count > 0;
    });

    var seedScale = (1 - smooth((p - TL.trunk[0]) / 0.12)) * (1 + 0.18 * Math.sin(time * 2.2));
    seed.visible = seedScale > 0.01;
    seed.scale.setScalar(Math.max(0.001, seedScale));

    if (dust) { dust.rotation.y = time * 0.02; dust.position.y = Math.sin(time * 0.1) * 0.12; }

    cameraAt(p, time, pointer);
    camera.updateMatrixWorld();

    nodes.forEach(function (n) {
      n.s = clamp01((p - n.limb.b) / TL.labelFade);
      n.bud.visible = n.s > 0;
      n.bud.scale.setScalar(Math.max(0.001, backOut(n.s)));
      v.copy(n.tip).project(camera);
      n.x = (v.x * 0.5 + 0.5) * width;
      n.y = (-v.y * 0.5 + 0.5) * height;
    });

    renderer.render(scene, camera);
  }

  return { update: update, resize: resize, recolor: recolor, nodes: nodes, tree: tree };
};
