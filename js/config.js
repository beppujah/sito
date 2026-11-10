/*
 * config.js — every value you are meant to tweak lives here.
 * Colors are the one exception: they are CSS tokens at the top of css/style.css
 * (the 3D scene reads them from there, so light and dark themes stay in sync).
 */
window.SITE_CONFIG = {

  /* ---- MENU -------------------------------------------------------------
   * One entry per button on the tree.
   *   id    : must match the id of a <section>/<article> in index.html
   *   label : text shown on the tree
   *   kind  : small caption under the label
   *   href  : optional. A dedicated page for this entry (see projects/).
   *           Without it the button scrolls to the section with the same id.
   *   side  : "branch" (grows from the trunk), "root" (grows underground),
   *           "leader" (the very top of the trunk — use it once at most)
   * Add or remove entries freely: the tree redistributes its limbs.
   */
  nodes: [
    { id: "oscilla16",   label: "Oscilla16",   kind: "groovebox",       side: "branch", href: "projects/oscilla16.html" },
    { id: "chlorophone", label: "Chlorophone", kind: "plant sequencer", side: "branch", href: "projects/chlorophone.html" },
    { id: "insettario",  label: "Insettario",  kind: "browser game",    side: "branch", href: "projects/insettario.html" },
    { id: "moon-mood",   label: "Moon Mood",   kind: "phone app",       side: "branch", href: "projects/moon-mood.html" },
    { id: "videos",      label: "Videos",      kind: "youtube",         side: "branch" },
    { id: "about",       label: "About",       kind: "the trunk",       side: "leader" },
    { id: "links",       label: "Links",       kind: "bookmarks",       side: "root" },
    { id: "resources",   label: "Resources",   kind: "references",      side: "root" },
    { id: "toolbox",     label: "Toolbox",     kind: "utilities",       side: "root" }
  ],

  /* ---- YOUTUBE --------------------------------------------------------
   * channelId  : your channel id, the one starting with "UC" (YouTube Studio >
   *              Settings > Channel > Advanced settings). When set, the Videos
   *              section shows a player that always lists your latest uploads.
   * channelUrl : link shown under the videos.
   * videos     : hand-picked videos. The id is the part after "v=" in the URL.
   *              Example: { id: "VIDEO_ID", title: "Chlorophone demo" }
   */
  youtube: {
    channelId: "",
    channelUrl: "https://www.youtube.com/@beppujah",
    videos: []
  },

  /* ---- TREE SHAPE -------------------------------------------------------
   * Units are abstract "world units": the trunk is about 3 units tall.
   */
  tree: {
    seed: 7,                      // change this number to get a different tree
    trunkHeight: 3.1,
    trunkLean: 0.18,              // how much the trunk wanders sideways
    trunkRadius: [0.10, 0.018],   // [base, tip]
    firstBranchSide: 1,           // 1 = first branch goes right, -1 = left

    branch: {
      attach: [0.26, 0.74],       // where on the trunk branches start (0 = base, 1 = tip)
      length: [1.25, 1.75],       // [min, max], picked at random per branch
      rise: 0.5,                  // how strongly branches curve upwards
      radius: [0.045, 0.008],     // [start, tip]
      depthSpread: 22             // degrees: how far branches turn towards/away from the camera
    },

    root: {
      fan: 58,                    // degrees: half-width of the root fan
      length: [1.5, 1.9],
      radius: [0.05, 0.008],
      depthSpread: 30
    },

    twigs: {
      perLimb: 4,                 // decorative side twigs on each branch/root (0 = bare tree)
      length: [0.22, 0.55]
    },

    segments: 72,                 // smoothness along each limb
    radialSegments: 7             // roundness of each limb
  },

  /* ---- SCROLL TIMELINE --------------------------------------------------
   * All values are scroll progress, from 0 (top of the page) to 1 (tree complete).
   */
  timeline: {
    title: [0.00, 0.14],          // the name fades out over this range
    roots: [0.03, 0.40],          // roots grow
    trunk: [0.12, 0.60],          // trunk grows (branches start as the trunk passes them)
    branchDuration: 0.26,         // how long each branch takes to grow
    twigDuration: 0.12,
    labelFade: 0.05               // how quickly a button appears once its limb is complete
  },

  scroll: {
    screens: 4.5,                 // length of the animation, in screen heights
    smoothing: 0.085              // 1 = no easing, lower = floatier
  },

  /* ---- CAMERA -----------------------------------------------------------
   * Keyframes along the scroll progress.
   *   zoom  : 1 = whole tree fits the screen, lower = closer
   *   lookY : height the camera looks at ("center" = middle of the tree)
   *   orbit : degrees around the tree
   *   tilt  : degrees above the horizon
   */
  camera: {
    fov: 35,
    keys: [
      { at: 0.00, zoom: 0.30, lookY: 0.30,     orbit: -28, tilt: 6 },
      { at: 0.30, zoom: 0.55, lookY: -0.55,    orbit: -12, tilt: 2 },
      { at: 0.62, zoom: 0.85, lookY: 1.00,     orbit: 12,  tilt: 4 },
      { at: 0.90, zoom: 1.00, lookY: "center", orbit: 0,   tilt: 3 },
      { at: 1.00, zoom: 1.00, lookY: "center", orbit: 0,   tilt: 3 }
    ],
    sway: { degrees: 4, speed: 0.25 },   // idle left-right drift
    pointer: { degrees: 6 },             // parallax when the mouse moves
    framing: { padX: 0.55, padY: 0.8, margin: 1.05 }  // room kept around the tree for labels
  },

  /* ---- ATMOSPHERE ------------------------------------------------------- */
  atmosphere: {
    particles: 140,               // floating specks (0 = none)
    particleSize: 0.025,
    fogStart: -0.3,               // fog begins this far in front of the trunk
    fogDepth: 3.8,                // lower = far branches fade into the paper sooner
    groundRing: 2.3,              // radius of the soil line (0 = none)
    budSize: 0.045
  }
};
