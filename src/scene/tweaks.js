// ---- Tweak these -----------------------------------------------------------
// Everything for the projects screen in one place: the camera, the stack layout, the
// "playing" layout, light and colour, and the timing / easing of the pick-a-record
// sequence. (Sizes and colours of the turntable and the record themselves are in
// turntable.js and record.js.)

// Camera. One fixed pose, straight on from the front and pitched down. It never moves
// sideways: the picture is shifted with a lens shift (setViewOffset) and a zoom.
export const FOV = 26; // vertical field of view in degrees (narrow = less distortion)
export const STACK_CAMERA = {
  pitch: 22, // degrees the camera looks down (0 = level)
  zoom: 1, // >1 closer (bigger), <1 further
  lookAtY: 0, // raise/lower where the camera aims (moves the stack on screen)
  fitW: 2.7, // rough on-screen size of the stack; the distance is chosen so it fits its column
  fitH: 4.8,
};

// Stack layout (world units; a sleeve is 2 wide, 2 deep, 0.24 thick)
export const STEP_Y = 1.3; // vertical distance between sleeves (gap = STEP_Y - thickness)
export const BOB = 0.05; // idle float amplitude
export const LIFT_Y = 0.35; // hover: how far a sleeve rises...
export const LIFT_Z = 0.15; // ...and slides towards the camera

// The turntable. Its position is relative to the stack's centre line (x = 0); it is hidden
// until a record is picked. It is tipped towards the camera so the platter reads as an
// ellipse at TABLE_PITCH degrees, even though the camera itself is pitched at STACK_CAMERA.pitch.
export const TURNTABLE_POSITION = [5, -0.2, 0]; // far enough that a record that has just slid out of a sleeve is clear of the turntable
export const TABLE_PITCH = 40; // apparent viewing angle of the turntable (35-45 reads well)
export const RECORD_TO_SLEEVE = 0.96; // record diameter / sleeve width (12" in a 12.375" sleeve)

// "Playing" layout, wide screens. Fractions of the viewport width where the stack's centre
// line and the turntable's centre end up. The scale follows from the distance between them,
// and whatever is right of the turntable stays free for an info panel.
export const PLAYING_LAYOUT = {
  stackX: 0.13,
  tableX: 0.52,
  offsetY: 0, // px: nudge the whole playing picture down (+) or up (-)
};
// Narrow screens (matches the CSS breakpoint): the turntable fills the top of the stack's
// column and the other records are HTML thumbnails below it, so there is no 3D stack.
export const COMPACT = {
  query: "(max-width: 48rem)",
  tableFit: 0.88, // turntable width as a fraction of the column width
  centreY: 0.5, // turntable centre, as a multiple of the column width below the column's top
};
export const LEAVE_OFFSET = 1.8; // the played sleeve slides this far to the LEFT (away from the turntable) while it fades out

// COLLAPSED_STACK: while a record plays, the remaining sleeves on the left start collapsed, tightly
// overlapped like records in a crate, so only a thin strip of each (its front edge with the
// title label) shows. They spread out to the normal "playing" layout (the one used for swapping)
// while the pointer is over the group, a sleeve button has keyboard focus, or after a tap on
// touch screens, and collapse again when it leaves. Wide screens only. Distances are world units
// (a sleeve is 2 wide, 0.24 thick); times are seconds.
export const COLLAPSED_STACK = {
  stepY: 0.26, // vertical distance between collapsed sleeves. The slab is 0.24 thick, so 0.26 leaves only a hairline of each lower cover's blank margin above its strip; larger values start to show the cover title
  stepZ: 0, // each lower sleeve sticks out this far towards the camera. Keep 0: anything above it shows the cover art / title cut off above the strip
  offsetY: 0, // shift the collapsed group up (+) or down (-)
  hoverInDelay: 0.15, // the pointer must stay over the group this long before it expands
  hoverOutDelay: 0.25, // ...and stay off it this long before it collapses again
  expandDuration: 0.35,
  expandEase: "power2.out",
  collapseDuration: 0.35,
  collapseEase: "power2.inOut",
  hitPadding: 0.35, // the invisible hover area is the whole group plus this margin, so moving between sleeves never collapses it
};
// SHOWCASE: once a record is spinning, the page shifts focus to a demo area. The turntable gets out of
// the way: its camera tips to look nearly straight down on it, and it shrinks and slides to the
// bottom-left corner, partly cropped by the screen edge, like a big record peeking in from the side.
// A placeholder "browser window" frame grows in from the right (between the left stack and the info
// panel, never overlapping the panel). Wide screens only; narrow screens keep the stacked layout.
// On eject or swap the showcase plays backwards first, then the normal sequence runs.
export const SHOWCASE = {
  duration: 1.2, // s, entering
  ease: "power3.inOut",
  exitDuration: 0.6, // s, leaving (before an eject / swap starts)
  exitEase: "power2.inOut",
  pitch: 80, // apparent viewing angle of the turntable at the end (90 = straight down)
  scale: 0.9, // turntable size relative to the normal playing layout
  anchor: { x: 0.1, y: 0.9 }, // where the platter centre ends up, as fractions of the viewport (0,0 = top left)
  cropAmount: 0.45, // pushes the platter centre this many platter radii further into the corner (left and down), so the edge crops it
  reflection: 0.6, // multiplies the record's reflections at the end, so it stays deep black seen from above (1 = unchanged)
  stackOffsetY: 0.9, // the remaining sleeves on the left move up by this much (world units) so they stay clear of the turntable
  frame: {
    aspect: 16 / 10, // width / height
    widthFraction: 0.6, // of the viewport width (it shrinks to fit between the left stack and the info panel)
    left: 0.24, // the frame never starts left of this fraction of the viewport width (clear of the left stack)
    gap: 24, // px kept between the frame and the info panel
    maxHeight: 0.8, // of the viewport height: the frame is never taller (its width shrinks instead)
    bottomGap: 24, // px kept between the frame's bottom and the "Now playing" line
    rowGap: 12, // px kept between the frame's top and the "Back to cover / All records" row
    minFit: 0.75, // if aligning with the panel would shrink the frame below this fraction of its natural size, it is centred instead
    top: 48, // px, from the top of the scene area (the info panel's top); keeps it clear of the sticky "Back to cover" row on short screens
    fromScale: 0.4, // size it grows from (it scales from its right edge)
    slide: 0, // px it starts to the right of its final place (it already grows from its right edge; anything above 0 makes it cross into the info panel mid-way)
  },
};
// DEMO_IMAGE: the screenshot in the demo frame. The frame's body takes the screenshot's own shape (so nothing
// is cropped), clamped between minAspect and maxAspect (width / height); SHOWCASE.frame.aspect is the fallback.
export const DEMO_IMAGE = {
  minAspect: 4 / 3,
  maxAspect: 2,
  fade: 0.3, // s, crossfade between screenshots
};
// LIVE_DEMO: the "Try it live" button in the demo frame mounts the project's real site in an iframe
// (only on a click, only for projects with liveEnabled in src/projects.js, wide screens only).
export const LIVE_DEMO = {
  virtualWidth: 1280, // px: the page is rendered this wide and scaled down to fit the frame (height follows the frame's shape)
  slowAfter: 8, // s: if it has not loaded by then, show the "free hosting can be slow" message
  fadeIn: 0.3, // s: the iframe fades in once it has loaded
  expandWidth: 0.92, // EXPAND: the frame grows to this fraction of the viewport width...
  expandHeight: 0.86, // ...and this fraction of its height, centred
  expandDuration: 0.45, // s
  expandEase: "power3.inOut",
  backdropOpacity: 0.78, // the dim layer behind the expanded frame
};
// Light and colour
export const COVER_BRIGHTNESS = 1; // covers and edge labels are unlit; 1 = identical to the SVG
export const COVER_TEXTURE_SIZE = 2048; // crispness vs GPU memory (4 covers x size x size x 4 bytes)
export const DIM_AMOUNT = 0.5; // how much the other sleeves darken while one is picked (0..1)
export const AMBIENT = 0.1;
export const KEY = { intensity: 2, offset: [-3, 5, 2.5] }; // offsets are from the turntable; shadows follow it
export const FILL = { intensity: 0.4, offset: [3, 3, -1.5] };
export const RIM = { intensity: 1, offset: [2, 6, -3.5], color: 0xffffff }; // neutral: the site is black and white
export const SLEEVE_BORDER = "rgba(255,255,255,0.18)"; // the thin outline on the darkest sleeves (see cover.border in src/projects.js)
export const ENV_INTENSITY = 0.3; // RoomEnvironment reflections (higher = shinier, greyer)

// The pick-a-record sequence. `at` = start time (s), `duration` = length (s).
// The whole thing lasts as long as the latest at + duration (about 3.75 s).
export const SLIDE_OUT = 2.05; // how far the record slides out of the sleeve (sleeve units; a sleeve is 2 wide). Keep it above 1 + 0.96 so the record fully clears the sleeve's right edge
export const ARC_HEIGHT = 1.6; // how high the record's path arcs above the straight line
export const TIMING = {
  bob: { at: 0, duration: 0.3 }, // idle float settles
  settle: { at: 0, duration: 0.5 }, // the picked sleeve settles back from its hover lift
  dim: { at: 0, duration: 0.5 }, // other sleeves darken...
  undim: { at: 1.6, duration: 0.7 }, // ...and light up again (they are buttons in the playing layout)
  slide: { at: 0.1, duration: 0.55 }, // record slides out through the sleeve's right edge until it has fully cleared it
  leave: { at: 0.65, duration: 0.45 }, // THEN the played sleeve slides left and fades out completely (the others close up). Must end by the time the arc starts
  arc: { at: 1.1, duration: 1.2 }, // only now does the record lift and travel over the turntable
  camera: { at: 0.5, duration: 1.8 }, // the picture shifts from the stack layout to the playing layout
  lower: { at: 2.3, duration: 0.5 }, // record lowers onto the spindle
  needle: { at: 2.75, duration: 0.8 }, // tonearm swings from rest to playing
  spin: { at: 2.95, duration: 0.8 }, // platter spins up to the calm speed
  panel: { at: 3.05, duration: 0.55 }, // the info panel fades / slides in once the record is seated and the platter is turning (and out first when it is ejected)
};
// The same sequence for a pick from the row, in beats that never overlap on screen (see ROW). Times in seconds.
export const TIMING_ROW = {
  out: { at: 0, duration: 0.25 }, // the other sleeves fade out, drifting down; the chosen one lifts
  bob: { at: 0, duration: 0.3 },
  slide: { at: 0.22, duration: 0.36 }, // the record slides out of the standing sleeve
  leave: { at: 0.58, duration: 0.15 }, // then the empty sleeve fades
  settle: { at: 0.58, duration: 0.3 }, // (its hover lift goes with it)
  camera: { at: 0.73, duration: 0.001 }, // nothing else is on screen: the camera cuts to the playing / showcase view
  table: { at: 0.73, duration: 0.35 }, // the turntable fades in where it ends up
  arc: { at: 0.73, duration: 0.6 }, // the record flies to it
  stack: { at: 1.0, duration: 0.3 }, // the stack on the left fades in, sliding in from the left
  lower: { at: 1.33, duration: 0.2 },
  needle: { at: 1.45, duration: 0.4 },
  spin: { at: 1.6, duration: 0.4 },
  panel: { at: 1.3, duration: 0.45 }, // the info panel and its tracklist
  frame: { at: 1.25, duration: 0.7 }, // the demo frame grows in
};
export const EASE = {
  table: "power2.out",
  out: "power1.out",
  stack: "power2.out",
  frame: "power3.out",
  bob: "power1.out",
  settle: "power2.out",
  dim: "power2.out",
  undim: "power2.inOut",
  slide: "power2.inOut",
  arc: "power2.inOut",
  leave: "power2.inOut",
  camera: "power3.inOut",
  lower: "power2.out", // smooth deceleration, never below the seated position (no overshoot, so lifting back up never dips either)
  needle: "power2.inOut",
  spin: "power2.out",
  panel: "power2.out",
};

// Info panel (src/shelf.js)
export const PANEL = {
  slide: 28, // px the panel slides in from (to the right, or up from below on narrow screens); reduced motion: no slide
  maxWidth: 400, // px, wide screens
  widthFraction: 0.28, // of the viewport width, wide screens (the smaller of the two wins)
  margin: 24, // px from the right edge of the screen
};

// Swapping records plays the current record's timeline backwards and the new one's forwards,
// both sped up by this factor (3.75 s x 2 / 2.5 = 3 s in total).
export const SWAP_SPEED = 2.5;

// While it travels, the record is drawn by a camera that is blended between the stack camera
// (arc = 0) and the turntable camera (arc = 1), so its perspective changes continuously.
// Its reflections (environment map, clear coat, specular) are also faded in by arc progress,
// so it looks as deep black near the stack as it does on the turntable.
export const RECORD_LOOK = {
  nearStack: 0.1, // reflection strength at arc = 0 (0 = none, 1 = as on the turntable)
  fadeStart: 0, // arc progress where the fade starts...
  fadeEnd: 1, // ...and where it reaches 1 (the look on the turntable, unchanged)
  curve: 2, // >1 keeps the reflections low for longer, <1 brings them in sooner
};

// Reduced motion: length of the crossfade used instead of the sequence (s)
export const REDUCED_MOTION_FADE = 0.25;
// ----------------------------------------------------------------------------

// ABOUT: the vinyl record behind the About sleeve (src/about.js; the sizes are in src/style.css)
export const ABOUT = {
  peek: 0.58, // fraction of the record's diameter that shows past the sleeve's right edge (wide screens)
  peekNarrow: 0.14, // ...past the sleeve's bottom edge (below 900px)
  slideDuration: 0.9, // s
  slideEase: "power3.out",
  spinSeconds: 12, // per turn
  hoverShift: 40, // px further out while the sleeve is hovered
  hoverDuration: 0.5,
  hoverBackDuration: 0.7,
  enterThreshold: 0.3, // how much of the sleeve must be on screen before the record slides out
};

// HERO: the landing page (src/hero.js; the layout is in src/style.css)
export const HERO = {
  diameter: "70vh", // the record's size on wide screens (narrow screens use 62vw)
  crop: 0.38, // fraction of the record cropped off the right edge (wide screens)
  spinSeconds: 40, // per turn
  enterDuration: 0.7, // s, the text fading up
  stagger: 0.09, // s between the text lines
  riseBy: 22, // px the text rises
  recordDuration: 0.95, // s, the record sliding in
  recordShift: 90, // px it slides in from
};

// ROW: the Projects section of the landing page. The sleeves lie in one row (a 2 x 2 grid on narrow screens),
// one front-facing sleeve per project. When the section scrolls into view they spread out from a pile
// once (a tween, not scrubbed by scroll); when it leaves, the canvas fades out. Distances are world units
// (a sleeve is 2 wide); times are seconds.
export const ROW = {
  stepX: 2.7, // distance between sleeve centres in the row
  stepCompact: 2.6, // ...in the 2 x 2 grid on narrow screens
  offsetY: 0, // shift the row up (+) or down (-), in world units
  bottomMargin: 48, // px: the row is centred between the heading and this far above the bottom of the visible section
  gapBelowHeading: 64, // px between the "Pick a record" label and the top of the row (it follows the heading, whatever the scroll)
  fillWidth: 0.84, // the row takes this share of the viewport width...
  fillHeight: 0.62, // ...and (2 x 2 grid) at most this share of its height
  maxSleevePx: 340, // a sleeve is never bigger than this on screen
  thin: 0.35, // standing sleeves are this fraction of the full thickness (the pile and the stack keep full thickness)
  hoverLiftY: 0.28, // a hovered / focused sleeve rises this much...
  hoverLiftZ: 0.1, // ...and comes this far towards the camera
  // (the captions under the sleeves: --cap-gap and --cap-h in style.css say how much room each one takes)
  stagger: 0.06, // s between one sleeve and the next
  duration: 0.8, // s, each sleeve spreading out from the pile
  ease: "power3.out",
  enterAt: 0.6, // the canvas shows (and the row spreads out) once this much of the section is on screen...
  leaveAt: 0.35, // ...and fades out when less than this is
  fadeOut: 0.3, // s
  // Picking a sleeve from the row (see TIMING_ROW): the other three fade out where they stand, drifting down a little;
  // the record slides out of the chosen one, which then fades too; with nothing else on screen the camera cuts to the
  // playing / showcase view, the turntable fades in, the record flies to it and the stack on the left fades in.
  fadeDrift: 0.25, // world units the other sleeves sink while they fade out (and rise from when they come back)
  pickLift: 0.12, // world units the chosen sleeve rises as the others fade
  stackSlidePx: 40, // the stack on the left slides in from this far to the left as it fades in
  swapAt: 0.2, // s into a pick from the row where the record is still in its sleeve: a swap plays back to here
  backFade: 0.3, // s, after a swapped record is ejected: the stack fades out, then the row fades back in
  ejectSpeed: 1.5, // Back / Escape plays the timeline backwards this much faster than it went forwards
};

// LIST_MODE: the Records / List toggle of the Projects section (src/shelf.js). Times are seconds.
// Records -> List: the sleeves sink and fade (the select timeline's fade, no sideways travel), the canvas stops, then the
// section's height eases to the list's and the rows fade up one after the other. List -> Records is the reverse: the rows
// fade out, the height eases back, then the canvas resumes and the sleeves spread out from the pile as on a first visit.
export const LIST_MODE = {
  sleevesOut: 0.3, // the sleeves and captions fade out / sink
  height: 0.4, // the section's height eases to the other mode's
  rowsAt: 0.3, // the rows start fading up this long after the start (the end of sleevesOut)
  rowDuration: 0.3, // each row's fade
  rowStagger: 0.06, // between one row and the next
  rise: 12, // px the rows rise by while they fade in
  rowsOut: 0.2, // List -> Records: the rows fade out (together, sinking a little)
  ease: "power2.inOut",
};
