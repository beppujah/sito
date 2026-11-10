/*
 * tree.js — procedural tree generator.
 * Turns SITE_CONFIG into a list of "limbs": each limb is a 3D curve with a
 * tapering radius and a growth window [a, b] on the scroll timeline.
 * Replace build() later if the tree comes from your own SVG drawings: the
 * scene only needs { limbs, bounds } in the same shape.
 */
(function () {
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rad = function (d) { return d * Math.PI / 180; };

  // Small seeded random generator, so the same seed always gives the same tree.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function build(cfg) {
    var T = cfg.tree, TL = cfg.timeline;
    var R = rng(T.seed);
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var range = function (r) { return lerp(r[0], r[1], R()); };
    var jit = function (s) { return (R() - 0.5) * 2 * s; };
    var limbs = [];

    function add(pts, radius, a, b, extra) {
      var limb = {
        curve: new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5),
        r0: radius[0], r1: radius[1], a: a, b: b,
        tip: pts[pts.length - 1].clone(), kind: "limb", node: null
      };
      for (var k in extra) limb[k] = extra[k];
      limbs.push(limb);
      return limb;
    }

    var branchNodes = cfg.nodes.filter(function (n) { return n.side === "branch"; });
    var rootNodes = cfg.nodes.filter(function (n) { return n.side === "root"; });
    var leader = cfg.nodes.filter(function (n) { return n.side === "leader"; })[0] || null;

    // Trunk
    var H = T.trunkHeight, lean = T.trunkLean;
    var trunk = add([
      V(0, -0.05, 0),
      V(jit(lean * 0.5), H * 0.30, jit(lean * 0.5)),
      V(jit(lean), H * 0.62, jit(lean * 0.7)),
      V(jit(lean), H * 0.85, jit(lean * 0.7)),
      V(jit(lean * 0.8), H, jit(lean * 0.5))
    ], T.trunkRadius, TL.trunk[0], TL.trunk[1], { kind: "trunk", node: leader });

    var mains = [];

    // Branches: alternate left/right, climbing up the trunk.
    var nb = branchNodes.length, B = T.branch;
    branchNodes.forEach(function (node, i) {
      var f = nb > 1 ? i / (nb - 1) : 0.5;
      var t = lerp(B.attach[0], B.attach[1], f);
      var p0 = trunk.curve.getPointAt(t);
      var side = (i % 2 === 0 ? 1 : -1) * (T.firstBranchSide < 0 ? -1 : 1);
      var az = rad((side > 0 ? 0 : 180) + jit(B.depthSpread));
      var dir = V(Math.cos(az), 0, Math.sin(az));
      var L = range(B.length) * lerp(1, 0.9, f);
      var up = L * B.rise;
      var at = function (along, rise, wobble) {
        return p0.clone().addScaledVector(dir, L * along)
          .add(V(jit(wobble), up * rise + jit(wobble), jit(wobble)));
      };
      var a = lerp(TL.trunk[0], TL.trunk[1], t);
      var r0 = Math.min(B.radius[0], lerp(trunk.r0, trunk.r1, t) * 0.8);
      mains.push(add([p0, at(0.33, 0.10, 0.05), at(0.70, 0.45, 0.05), at(1, 1, 0)],
        [r0, B.radius[1]], a, a + TL.branchDuration, { kind: "branch", node: node }));
    });

    // Roots: fan out below the soil line.
    var nr = rootNodes.length, Ro = T.root, stagger = 0.025;
    rootNodes.forEach(function (node, i) {
      var f = nr > 1 ? i / (nr - 1) : 0.5;
      var phi = rad(lerp(-Ro.fan, Ro.fan, f) + jit(6));
      var L = range(Ro.length);
      var z = Math.sin(rad(jit(Ro.depthSpread))) * L * 0.6;
      var end = V(Math.sin(phi) * L, -(Math.cos(phi) * L * 0.85 + 0.25), z);
      var straight = Math.abs(end.x) < 0.3 ? 0.15 : 0;   // give a tap root some wiggle
      mains.push(add([
        V(0, 0.02, 0),
        V(end.x * 0.40 + jit(0.06 + straight), end.y * 0.12 - 0.05, z * 0.3),
        V(end.x * 0.75 + jit(0.06 + straight), end.y * 0.55, z * 0.7 + jit(0.05)),
        end
      ], Ro.radius, TL.roots[0] + i * stagger, TL.roots[1] - (nr - 1 - i) * stagger,
        { kind: "root", node: node }));
    });

    // Decorative twigs on every main limb, and on the upper trunk.
    var W = T.twigs;
    function twigs(limb, from, to, sign) {
      for (var k = 0; k < W.perLimb; k++) {
        var t = lerp(from, to, (k + R()) / W.perLimb);
        var p = limb.curve.getPointAt(t);
        var tan = limb.curve.getTangentAt(t);
        var rv = V(jit(1), jit(0.6), jit(1)).normalize();
        var dir = tan.multiplyScalar(0.55).addScaledVector(rv, 0.8).add(V(0, 0.35 * sign, 0)).normalize();
        var l = range(W.length) * (1 - 0.4 * t);
        var a = lerp(limb.a, limb.b, t);
        add([
          p,
          p.clone().addScaledVector(dir, l * 0.5).add(V(jit(0.03), jit(0.03), jit(0.03))),
          p.clone().addScaledVector(dir, l).add(V(0, sign * l * 0.22, 0))
        ], [lerp(limb.r0, limb.r1, t) * 0.7, 0.004], a, a + TL.twigDuration, { kind: "twig" });
      }
    }
    mains.forEach(function (m) { twigs(m, 0.3, 0.9, m.kind === "root" ? -1 : 1); });
    twigs(trunk, 0.5, 0.95, 1);

    // Bounding box of the whole tree, used to frame the camera.
    var b = { minY: Infinity, maxY: -Infinity, maxX: 0 };
    limbs.forEach(function (l) {
      b.minY = Math.min(b.minY, l.tip.y); b.maxY = Math.max(b.maxY, l.tip.y);
      b.maxX = Math.max(b.maxX, Math.abs(l.tip.x));
    });
    b.centerY = (b.minY + b.maxY) / 2;

    return { limbs: limbs, bounds: b };
  }

  // Tapered tube along a limb. Triangles are ordered base-to-tip, so drawing
  // only the first N of them makes the limb "grow".
  function tube(limb, segs, radial) {
    var frames = limb.curve.computeFrenetFrames(segs, false);
    var pos = new Float32Array((segs + 1) * radial * 3);
    var P = new THREE.Vector3();
    for (var i = 0; i <= segs; i++) {
      var u = i / segs;
      limb.curve.getPointAt(u, P);
      var r = lerp(limb.r0, limb.r1, u), N = frames.normals[i], Bn = frames.binormals[i];
      for (var j = 0; j < radial; j++) {
        var ang = j / radial * Math.PI * 2, c = Math.cos(ang) * r, s = Math.sin(ang) * r;
        var o = (i * radial + j) * 3;
        pos[o] = P.x + c * N.x + s * Bn.x;
        pos[o + 1] = P.y + c * N.y + s * Bn.y;
        pos[o + 2] = P.z + c * N.z + s * Bn.z;
      }
    }
    var idx = new Uint16Array(segs * radial * 6), q = 0;
    for (var m = 0; m < segs; m++) {
      for (var n = 0; n < radial; n++) {
        var a = m * radial + n, b = m * radial + (n + 1) % radial;
        var c2 = a + radial, d = b + radial;
        idx[q++] = a; idx[q++] = c2; idx[q++] = b;
        idx[q++] = b; idx[q++] = c2; idx[q++] = d;
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.userData = { segs: segs, perSeg: radial * 6 };
    return geo;
  }

  window.TreeBuilder = { build: build, tube: tube };
})();
