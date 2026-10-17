// Direction A — LAMPLIGHT, beats 1 to 3 as one continuous shot: Title 7
// comes off the shelf, travels to the reading table, opens, the leaves
// turn to § 2017, the pages lift and come apart — and the camera rides
// their stream of letters out of the dark room and down onto the corpus.
//
// One world, at the open book's scale. The library (beat 1's scene) is
// built into a group scaled up to match and stands in the dark behind the
// table; the reading table and its book (beat 2's scene) are as composed.
// The book is a rig (lamplight.ts): standing in its slot it is shut, spine
// out; on the table it opens on its hinge.
//
// The corpus (beat 3's scene) is built into a group too, out past the
// library, placed so its falling stream continues the book's: one stream
// from the page to its cell.
//
// The shot runs over 5.5 beats; t is 0..1 across them (u = 5.5t, beats):
//   0.00–0.45  the camera drifts in; the volume slides out and tips
//   0.45–1.00  it lifts off and comes to the table, turning as it falls
//   0.98–1.34  the cover swings open
//   1.26–2.01  four leaves turn, §§ 2011 to 2016, one after another
//   2.06–4.00  the pages of § 2017 float out one by one, then encode top
//              down, page by page, head to foot
//   3.60–4.30  the room goes dark; the camera turns to ride the stream
//   3.70–5.30  along the stream and down onto the plain, to the one cell
//   5.30–5.50  the address

import * as THREE from "three";
import { drawShare, ease, lerp, seg, twoSidedPaper, type BeatCtx, type BeatSpec, type HotspotOpts, THEME, themed } from "./kit";
import { BOOK } from "./book-text";
import { typesetPages } from "./pages";
import { lamplightShelf } from "./lamplight0";
import { lamplightBeat1 } from "./lamplight";
import { ENCODE_CAM, SENT_AT, encodeSentence, lamplightBeat2 } from "./lamplight2";

const K = 2.34 / 0.96; // the library, scaled to the open book
const LIB = new THREE.Vector3(-0.25, 0, -6.73); // so the slot sits behind the table
const UT = 5.5; // the shot's length in beats

type ShelfParts = { t7: THREE.Mesh; lamp: THREE.SpotLight; heroAt: THREE.Vector3; slot: { x: number; y: number; front: number } };
type CorpusParts = {
  plain: THREE.InstancedMesh;
  plainMat: THREE.MeshBasicMaterial;
  fall: THREE.Points;
  fallMat: THREE.ShaderMaterial;
  rule: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  hero: THREE.Vector3;
  camTo: THREE.Vector3;
  aimTo: THREE.Vector3;
};
type ReadParts = {
  book: THREE.Group;
  setOpen: (theta: number) => void;
  pages: THREE.Mesh[];
  tops: THREE.Mesh[];
  key: THREE.SpotLight;
  rim: THREE.PointLight;
  glow: THREE.PointLight;
  stream: THREE.CatmullRomCurve3;
  letters: THREE.Points;
  camFrom: THREE.Vector3;
  aimFrom: THREE.Vector3;
  camTo: THREE.Vector3;
  aimTo: THREE.Vector3;
  closedCenter: THREE.Vector3;
};

const bez = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number) => {
  const m = 1 - t;
  return a
    .clone()
    .multiplyScalar(m * m * m)
    .addScaledVector(b, 3 * m * m * t)
    .addScaledVector(c, 3 * m * t * t)
    .addScaledVector(d, t * t * t);
};

export function lamplightShelfToBook(ctx: BeatCtx): BeatSpec {
  // the reading table and its book
  const reading = lamplightBeat1(ctx);
  const R = reading.parts as ReadParts;
  const { camera, look } = reading;
  const book = R.book;

  // the library, behind it in the dark
  const tmp = new THREE.Scene();
  const shelf = lamplightShelf({ scene: tmp, fx: new THREE.Scene(), label: ctx.label, hotspot: ctx.hotspot, link: ctx.link });
  const S = shelf.parts as ShelfParts;
  S.t7.removeFromParent(); // the rig plays Title 7
  const lib = new THREE.Group();
  lib.scale.setScalar(K);
  lib.position.copy(LIB);
  [...tmp.children].forEach((c) => {
    if (c instanceof THREE.AmbientLight) return; // the table's ambient serves
    lib.add(c);
  });
  ctx.scene.add(lib);
  lib.updateMatrixWorld(true);
  // lights in a scaled group: the same falloff at K times the distance
  lib.traverse((o) => {
    if (o instanceof THREE.SpotLight || o instanceof THREE.PointLight) {
      o.intensity *= K * K;
      o.distance *= K;
    }
  });
  const libLamp = S.lamp;
  const libLampOn = libLamp.intensity;
  const keyOn = R.key.intensity;
  const rimOn = R.rim.intensity;
  const glowOn = R.glow.intensity;

  // the corpus, out past the library: its group is placed so that the top
  // of its falling stream sits on the book's stream and runs on in the
  // same direction; the room is dark by the time the camera gets there
  const CS = 1.6; // the corpus, scaled to this world
  const C0 = 3.7; // u: the corpus scene's clock starts
  const C1 = 5.3; // u: and its motion is done (the address holds after)
  const cFrom = new THREE.Vector3(-2.4, 2.6, 0.6); // corpus: top of its stream
  const cHero = new THREE.Vector3(1.0, 0, -1.25); // corpus: the one cell
  const joinAt = 0.5; // where on the book's stream the corpus stream begins
  const join = R.stream.getPoint(joinAt);
  const tan = R.stream.getTangent(joinAt);
  const yaw = (v: THREE.Vector3) => Math.atan2(-v.z, v.x);
  const corpusG = new THREE.Group();
  corpusG.rotation.y = yaw(tan) - yaw(cHero.clone().sub(cFrom));
  corpusG.scale.setScalar(CS);
  corpusG.updateMatrixWorld();
  corpusG.position.copy(join).sub(cFrom.clone().applyMatrix4(corpusG.matrixWorld));
  corpusG.updateMatrixWorld();
  const corpusFxG = new THREE.Group();
  corpusFxG.position.copy(corpusG.position);
  corpusFxG.rotation.copy(corpusG.rotation);
  corpusFxG.scale.copy(corpusG.scale);
  // the room, with each part's own visibility: restored first thing each
  // frame, before the shot hides what it hides
  const roomObjects = ctx.scene.children.map((o) => [o, o.visible] as const);
  const toWorld = (p: THREE.Vector3) => corpusG.localToWorld(p.clone());
  const shotT = (w: number) => (C0 + w * (C1 - C0)) / UT;
  const cLabels: Array<{ el: HTMLElement }> = [];
  const cScene = new THREE.Scene();
  const cFx = new THREE.Scene();
  const corpus = lamplightBeat2({
    scene: cScene,
    fx: cFx,
    label: (p, html, cls) => {
      const l = ctx.label(toWorld(p), html, cls);
      cLabels.push(l);
      return l;
    },
    hotspot: (p, href, text, opts: HotspotOpts = {}) =>
      // off once the shot moves on into the encode scene
      ctx.hotspot(toWorld(p), href, text, { ...opts, when: opts.when && [shotT(opts.when[0]), Math.min(shotT(opts.when[1]), 0.999)] }),
    link: ctx.link,
  });
  const CP = corpus.parts as CorpusParts;
  [...cScene.children].forEach((c) => corpusG.add(c));
  [...cFx.children].forEach((c) => corpusFxG.add(c));
  ctx.scene.add(corpusG);
  ctx.fx.add(corpusFxG);
  corpusFxG.updateMatrixWorld(true);
  const cCam = corpus.camera;
  const cLook = corpus.look;
  // the ride: one path down the middle of the stream, from the book's
  // stream onto the corpus stream and down to the cell
  const ride = new THREE.CatmullRomCurve3(
    [
      R.stream.getPoint(0.12),
      R.stream.getPoint(0.28),
      R.stream.getPoint(0.42),
      join,
      toWorld(CP.curve.getPoint(0.3)),
      toWorld(CP.curve.getPoint(0.6)),
      toWorld(CP.curve.getPoint(0.85)),
      toWorld(cHero),
    ],
    false,
    "centripetal",
  );
  const heroW = toWorld(cHero);
  const camEnd = toWorld(CP.camTo);
  const aimEnd = toWorld(CP.aimTo);
  const qEnd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(camEnd, aimEnd, new THREE.Vector3(0, 1, 0)));
  const bloom0 = look.bloom ? { ...look.bloom } : null;
  const exposure0 = look.exposure;
  const fog = ctx.scene.fog as THREE.FogExp2 | null;
  const fog0 = fog?.density ?? 0;
  const letterMat = R.letters.material as THREE.ShaderMaterial;
  const letterFocus0 = letterMat.uniforms.uFocus.value as number;
  const m4 = new THREE.Matrix4();
  const qRide = new THREE.Quaternion();
  const qRead = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // the way out, into the encode scene: the camera rises with the beam
  // from the cell; the plain falls away into the dark; the provision's
  // sentence lights up at the top of the beam, placed so that at the end
  // of the move it sits on screen exactly where the encode scene shows it
  const fwdEnd = aimEnd.clone().sub(camEnd).setY(0).normalize();
  const camOut = camEnd.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(fwdEnd, -0.6);
  const qOut = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(camOut, camOut.clone().addScaledVector(fwdEnd, 10).add(new THREE.Vector3(0, 0.2, 0)), up),
  );
  const eCam = new THREE.PerspectiveCamera(ENCODE_CAM.fov);
  eCam.position.copy(ENCODE_CAM.pos);
  eCam.lookAt(ENCODE_CAM.aim);
  eCam.updateMatrixWorld();
  const outSent = encodeSentence();
  const sentRef = outSent.mesh.clone();
  sentRef.position.copy(SENT_AT);
  sentRef.lookAt(ENCODE_CAM.pos);
  sentRef.updateMatrixWorld();
  // the sentence in the encode camera's frame, carried into this world at
  // the end pose of the move
  const outPose = new THREE.Matrix4().compose(camOut, qOut, new THREE.Vector3(1, 1, 1));
  outPose.multiply(eCam.matrixWorld.clone().invert()).multiply(sentRef.matrixWorld);
  const sentOut = outSent.mesh;
  outPose.decompose(sentOut.position, sentOut.quaternion, sentOut.scale);
  ctx.fx.add(sentOut);
  sentOut.updateMatrixWorld();
  const phraseW = sentOut.localToWorld(outSent.phraseLocal.clone());
  const beamTop = toWorld(cHero.clone().add(new THREE.Vector3(0, 0.62, 0)));
  const beamCurve = new THREE.CubicBezierCurve3(
    beamTop,
    beamTop.clone().add(new THREE.Vector3(0, 1.2, 0)),
    phraseW.clone().add(new THREE.Vector3(0, -1.2, 0)),
    phraseW,
  );
  const beamOut = new THREE.Mesh(
    new THREE.TubeGeometry(beamCurve, 160, 0.008, 6),
    new THREE.MeshBasicMaterial({ color: themed(new THREE.Color("#ffcf94").multiplyScalar(2)), toneMapped: false, transparent: true }),
  );
  ctx.scene.add(beamOut);
  const sentMat = sentOut.material as THREE.MeshBasicMaterial;
  const halfTan = (deg: number) => Math.tan((deg * Math.PI) / 360);
  const ruleMat = CP.rule.material as THREE.MeshBasicMaterial;
  const ruleColor = ruleMat.color.clone();
  // transparent from the start on paper (it fades there by opacity)
  if (THEME.paper) ruleMat.transparent = true;

  // on paper the library fades away as the volume leaves it: the book
  // goes on alone, on the page
  const libMats = new Set<THREE.Material>();
  lib.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => libMats.add(x));
  });
  // transparent from the start (at full opacity): switching a material
  // between solid and transparent builds new shaders mid-scroll
  if (THEME.paper)
    libMats.forEach((m) => {
      m.transparent = true;
      // (front faces only: the books never show through one another)
      m.depthWrite = true;
    });
  let libShown = 1;
  const showLibrary = (v: number) => {
    if (v === libShown) return;
    libShown = v;
    libMats.forEach((m) => (m.opacity = v));
    lib.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = v > 0.01;
    });
  };

  // poses of the volume
  const C = R.closedCenter; // the shut book's centre, in book space
  const qTable = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.22, 0));
  const pTable = new THREE.Vector3(1.45, 0.004, 1.0);
  const centerTable = pTable.clone().add(C.clone().applyQuaternion(qTable));
  // standing in its slot: spine (book −x) to the room, head (book −z) up,
  // front cover (book +y) to the right
  const qStand = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)),
  );
  const slot = lib.localToWorld(new THREE.Vector3(S.slot.x, S.slot.y, S.slot.front));
  const H2 = 1.17; // half the book's height
  const D2 = 0.855; // half its cover's width
  const setBook = (center: THREE.Vector3, q: THREE.Quaternion) => {
    book.quaternion.copy(q);
    book.position.copy(center).sub(C.clone().applyQuaternion(q));
  };
  // on the shelf: pulled out `out` (world units), its top tipped toward
  // us by `tip` about its bottom front edge
  const shelfPose = (out: number, tip: number) => {
    const qTip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tip);
    const pivot = slot.clone().add(new THREE.Vector3(0, 0, out));
    const center = pivot.add(new THREE.Vector3(0, H2, -D2).applyQuaternion(qTip));
    return { center, q: qTip.multiply(qStand) };
  };
  const shelfEnd = shelfPose(0.22 * K, 0.09);

  // the leaves between the contents and § 2017, typeset from the real
  // text: each recto starts a section, its verso runs on; the last verso
  // is the close of § 2016, so § 2016 ends on the left as § 2017 begins
  const sec = (no: string) => BOOK.find((b) => b.no === no)!;
  const s2016 = sec("2016");
  const L0 = typesetPages([{ section: sec("2011") }, { section: sec("2012") }], ["recto", "verso"]);
  const L1 = typesetPages([{ section: sec("2013") }], ["recto", "verso"]);
  const L2 = typesetPages([{ section: sec("2014") }], ["recto", "verso"]);
  const L3r = typesetPages([{ section: s2016 }], ["recto"]);
  const L3v = typesetPages([{ continuation: { no: "2016", text: s2016.end!, subheads: s2016.subheads } }], ["verso"]);
  const faces: Array<[THREE.Texture, THREE.Texture]> = [
    [L0[0], L0[1]],
    [L1[0], L1[1]],
    [L2[0], L2[1]],
    [L3r[0], L3v[0]],
  ];
  const LW = 1.6; // a leaf's width, gutter to fore-edge
  const leaves = faces.map(([front, back], i) => {
    const geo = new THREE.PlaneGeometry(LW, 2.2, 40, 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(LW / 2 + 0.02, 0, 0);
    const base = Float32Array.from(geo.attributes.position.array as Float32Array);
    const leaf = new THREE.Mesh(geo, twoSidedPaper(front, back));
    // paper lets some light through: a leaf turned away from the lamp
    // still reads as paper, not a dark board
    (leaf.material as THREE.MeshStandardMaterial).emissive.set("#3a2814");
    // no shadows: leaves a hair apart would shade each other in stripes
    leaf.castShadow = leaf.receiveShadow = false;
    leaf.position.set(0, 0.172, 0); // the hinge: the base of the open pages
    leaf.visible = false;
    book.add(leaf);
    return { leaf, base, last: -1, i };
  });
  // a leaf turned k (0..1) about the gutter. It starts on the right page's
  // curve (leaf 0 on top of the stack), lands on the left page's curve
  // (the last leaf on top), and bends as it goes: its free edge lags.
  const profile = (t: number) => 0.075 * (1 - Math.exp(-t * 9)) + 0.012 * Math.sin(t * Math.PI);
  const turnLeaf = (lf: (typeof leaves)[number], k: number) => {
    if (Math.abs(k - lf.last) < 1e-4) return;
    lf.last = k;
    const ps = lf.leaf.geometry.attributes.position;
    const offR = 0.002 + 0.0022 * (3 - lf.i);
    const offL = 0.002 + 0.0022 * lf.i;
    const turn = Math.PI * ease(k);
    const swap = ease(seg(k, 0.25, 0.75));
    const bend = Math.sin(Math.PI * k);
    for (let v = 0; v < ps.count; v++) {
      const sx = lf.base[v * 3];
      const z = lf.base[v * 3 + 2];
      const t = sx / (LW + 0.02);
      const y = lerp(profile(t) + offR, -(profile(t) + offL), swap) + 0.16 * bend * Math.sin(Math.PI * t);
      const a = turn - 0.6 * bend * Math.pow(t, 1.6);
      ps.setXYZ(v, sx * Math.cos(a) - y * Math.sin(a), sx * Math.sin(a) + y * Math.cos(a), z);
    }
    ps.needsUpdate = true;
    lf.leaf.geometry.computeVertexNormals();
  };

  // a soft light that travels with the volume through the dark between
  // the library's lamp and the table's
  const carry = new THREE.PointLight("#ffcf9a", 0, 7, 2);
  ctx.scene.add(carry);

  // links on the things themselves (t is the shot's clock; u = 5.5t)
  const closedNow = () => book.localToWorld(C.clone());
  ctx.link(book, "/us/statute/7", "Title 7 in the corpus", { when: [0.022, 0.13], anchorAt: closedNow });
  ctx.hotspot(lib.localToWorld(new THREE.Vector3(S.slot.x + 0.56 - 0.36, S.slot.y - 0.026, 0.33)), "/coverage", "What the corpus covers", { when: [0, 0.124] });
  ctx.link(R.tops[1], "/us/statute/7/2017", "Read § 2017", { when: [0.35, 0.72] });

  // the shot
  const shelfCam = shelf.camera;
  shelf.update?.(1);
  const camA = lib.localToWorld(shelfCam.position.clone());
  const fwdA = new THREE.Vector3();
  shelfCam.getWorldDirection(fwdA);
  const aimA = camA.clone().addScaledVector(fwdA, camA.distanceTo(centerTable));
  const camPath = new THREE.CatmullRomCurve3([camA, camA.clone().lerp(R.camFrom, 0.5).add(new THREE.Vector3(-0.6, 1.0, 1.2)), R.camFrom, R.camTo], false, "centripetal");
  const aimPath = new THREE.CatmullRomCurve3([aimA, R.aimFrom, R.aimTo], false, "centripetal");
  const fwd = new THREE.Vector3();
  const bookNow = new THREE.Vector3();
  const R0 = 2.06; // beat 2's own motion starts here
  // every light in the room, at full: the cut out dims them all, and
  // update brings them back first thing, so scrolling back restores the room
  const roomLights: Array<[THREE.Light, number]> = [];
  // the shadows change only while the volume moves (off the shelf, to the
  // table, opening); after that the room is still and its shadow maps are
  // reused
  let lastU = -1;
  const update = (t: number) => {
    const u = UT * t;
    const moving = (v: number) => v < 1.4;
    look.shadowsDirty = lastU < 0 || moving(u) || moving(lastU);
    lastU = u;
    if (!roomLights.length) ctx.scene.traverse((o) => o instanceof THREE.Light && roomLights.push([o, o.intensity]));
    roomLights.forEach(([l, i]) => (l.intensity = i));
    roomObjects.forEach(([o, v]) => (o.visible = v));
    if (THEME.paper) showLibrary(1 - ease(seg(u, 0.5, 1.05)));

    // ── the book
    let theta = Math.PI;
    if (u < 0.45) {
      const ts = u / 0.45;
      const p = shelfPose(lerp(0, 0.22, ease(seg(ts, 0.3, 0.92))) * K, lerp(0, 0.09, ease(seg(ts, 0.45, 0.95))));
      setBook(p.center, p.q);
    } else {
      const s = ease(seg(u, 0.45, 1.0));
      // straight out of the slot first, level, so nothing on the shelf is
      // touched; only once it is clear does it rise and turn
      const center = bez(
        shelfEnd.center,
        shelfEnd.center.clone().add(new THREE.Vector3(0, 0, 3.0)),
        centerTable.clone().add(new THREE.Vector3(-0.6, 1.6, 0.6)),
        centerTable,
        s,
      );
      setBook(center, shelfEnd.q.clone().slerp(qTable, ease(seg(u, 0.62, 0.98))));
      theta = Math.PI * (1 - ease(seg(u, 0.98, 1.34)));
    }
    R.setOpen(theta);
    // the leaves lie in the book once it is open far enough to show them
    // each pile shows only its top leaf (the ones under it would fight it
    // for depth)
    const ks = leaves.map((lf) => seg(u, 1.26 + lf.i * 0.15, 1.56 + lf.i * 0.15));
    const topRight = ks.findIndex((k) => k === 0);
    const topLeft = ks.lastIndexOf(1);
    leaves.forEach((lf, i) => {
      const k = ks[i];
      const turning = k > 0 && k < 1;
      // the right pile's top leaf lies in the book from the start (the
      // page you first see is the one that turns); the left pile only
      // exists once the book is open
      lf.leaf.visible = turning || i === topRight || (i === topLeft && theta < 0.85 * Math.PI);
      const m = lf.leaf.material as THREE.MeshStandardMaterial;
      // the turning leaf draws a step forward in depth, so it always wins
      // over the leaf it lifts off
      m.polygonOffset = turning;
      m.polygonOffsetFactor = turning ? -2 : 0;
      m.polygonOffsetUnits = turning ? -8 : 0;
      turnLeaf(lf, k);
    });
    book.updateMatrixWorld();
    book.localToWorld(bookNow.copy(C));

    // ── beat 2's own motion, once the book lies open
    // the pages get two beats of their own: they float out and encode slowly
    const tr = Math.min(1, Math.max(0, (u - R0) / (4 - R0)));
    reading.update?.(tr);
    // the book's stream ends where the corpus stream takes it on
    drawShare(R.letters, Math.min(ease(seg(tr, 0.58, 1)), 0.6));
    if (u < R0) R.pages.forEach((m) => (m.visible = false));

    // ── the camera: one continuous move from the shelf to the end of the
    // shot (a spline through the shelf view, the reading view and beat 2's
    // view), so it never stops between the steps
    if (u < 0.45) {
      shelf.update?.(u / 0.45);
      camera.position.copy(lib.localToWorld(shelfCam.position.clone()));
      camera.quaternion.copy(shelfCam.quaternion);
    } else {
      const s = ease(seg(Math.min(u, 4), 0.45, 4));
      camera.position.copy(camPath.getPoint(s));
      const aim = aimPath.getPoint(s);
      // the aim holds the book from the lift until the pages start to
      // float, then hands back to the path up toward the stream
      // (never fully: the library stays in the frame behind it)
      const hold = 0.72 * ease(seg(u, 0.45, 0.85)) * (1 - 0.8 * ease(seg(u, 1.9, 3.0)));
      camera.lookAt(aim.lerp(bookNow, hold));
    }
    // a shallow depth of field: the shelf and the table stay sharp, only
    // the far room falls soft
    // focus a little in front of the book's middle, so its near edge and
    // the table under it are sharp
    if (u < R0) look.dof!.focus = camera.position.distanceTo(bookNow) - 0.5 * ease(seg(u, 0.7, 1.0));
    look.dof!.aperture = u < 0.45 ? 0.0008 : u < R0 ? lerp(0.0008, 0.0003, seg(u, 0.6, 1.0)) : lerp(0.0003, 0.0012, seg(u, 2.2, 3.0));

    // ── the light: the library's lamp falls away as the table's comes up
    libLamp.intensity = libLampOn * lerp(1, 0.28, seg(u, 0.5, 1.1));
    R.key.intensity = keyOn * lerp(0.45, 1, seg(u, 0.6, 1.1));
    R.rim.intensity = rimOn * seg(u, 0.9, 1.3);
    // the stream's light sits just above the book: an upright leaf's tip
    // would flare in it, so it waits until the leaves lie down
    // (and it is the stream's light: off until the pages lift, so the
    // volume flying past it on its way to the table catches no hot spot)
    R.glow.intensity = glowOn * ease(seg(u, 2.0, 2.6));
    carry.position.copy(bookNow).add(new THREE.Vector3(-1.2, 1.6, 1.8));
    carry.intensity = 14 * Math.sin(Math.PI * seg(u, 0.38, 1.1));

    // ── into the corpus: the room goes dark around the stream, the camera
    // rides it down onto the plain; nothing cuts
    const lit = 1 - ease(seg(u, 3.6, 4.2));
    // at night the room's lights go out; on paper the room fades into the
    // page (dimmed lights would turn it into a black silhouette)
    if (!THEME.paper) roomLights.forEach(([l]) => (l.intensity *= lit));
    // (the white fog clears again once the room is gone and the plain comes up)
    const roomFog = THEME.paper ? 0.6 * (1 - lit) * (1 - ease(seg(u, 4.2, 4.6))) : 0;
    if (lit <= 0.004) roomObjects.forEach(([o]) => (o.visible = false));
    const tc = seg(u, C0, C1);
    corpus.update?.(tc);
    // the corpus stream grows on from the book's; the plain comes up from
    // the dark only once the room has gone
    drawShare(CP.fall, ease(seg(u, 3.4, 4.6)));
    corpusG.visible = u > 3.75;
    // a fade is opacity on paper: a darker colour there is darker ink
    const plainUp = ease(seg(u, 3.85, 4.6));
    if (THEME.paper) CP.plainMat.opacity *= plainUp;
    else CP.plainMat.color.multiplyScalar(plainUp);
    cLabels.forEach((l, i) => {
      // the address and its note fade in on the corpus clock; the far
      // districts once the camera is over the plain
      if (i >= 2) l.el.style.opacity = String(seg(u, 4.7, 5.1));
      else if (u < 4.5) l.el.style.opacity = "0";
    });
    const b1 = ease(seg(u, 3.5, 4.1)); // from the reading view onto the stream
    const b2 = ease(seg(u, 4.55, 5.05)); // from the stream to the corpus view
    if (b1 > 0) {
      // behind and above the letters, looking on down the stream; higher
      // as it nears the plain, so the plain opens out below
      const rs = ease(seg(u, 3.5, 4.85)) * 0.72;
      const at = ride.getPoint(rs);
      const ahead = ride.getPoint(Math.min(1, rs + 0.16));
      const tg = ride.getTangent(rs);
      const side = tg.clone().cross(up).normalize();
      const pos = at
        .addScaledVector(tg, -2.2)
        .add(new THREE.Vector3(0, 1.0 + 3.0 * seg(rs, 0.35, 0.72), 0))
        .addScaledVector(side, 0.9);
      m4.lookAt(pos, ahead, up);
      qRide.setFromRotationMatrix(m4);
      qRead.copy(camera.quaternion);
      camera.position.lerp(pos, b1);
      camera.quaternion.copy(qRead).slerp(qRide, b1);
      let focus = camera.position.distanceTo(ahead);
      if (b2 > 0) {
        camera.position.lerp(camEnd, b2);
        camera.quaternion.slerp(qEnd, b2);
        focus = lerp(focus, camera.position.distanceTo(heroW), b2);
      }
      look.dof!.focus = focus;
      look.dof!.aperture = lerp(look.dof!.aperture, (cLook.dof?.aperture ?? 0.0004) / CS, b1);
      letterMat.uniforms.uFocus.value = lerp(letterFocus0, focus, b1);
      CP.fallMat.uniforms.uFocus.value = focus / CS;
    } else {
      letterMat.uniforms.uFocus.value = letterFocus0;
    }
    // the look moves from the lamplit room to the plain's
    const lk = ease(seg(u, 3.8, 4.8));
    // (no glow on paper)
    if (look.bloom && bloom0 && cLook.bloom) {
      look.bloom.strength = lerp(bloom0.strength, cLook.bloom.strength, lk);
      look.bloom.radius = lerp(bloom0.radius, cLook.bloom.radius, lk);
      look.bloom.threshold = lerp(bloom0.threshold, cLook.bloom.threshold, lk);
    }
    look.exposure = lerp(exposure0 ?? 1, cLook.exposure ?? 1, lk);
    if (fog) fog.density = lerp(fog0, 0.04 / CS, lk) + roomFog;
    camera.userData.baseFov = lerp(30, cCam.fov, b2);
    sentOut.visible = false;
    beamOut.visible = false;
    ruleMat.color.copy(ruleColor);
    ruleMat.opacity = 1;
    CP.fallMat.uniforms.uOpacity.value = 1;
  };
  const sentLocal = new THREE.Matrix4();
  const cutOut = (k: number, nextBeat?: { camera: THREE.PerspectiveCamera }) => {
    const next = nextBeat?.camera;
    // the camera turns up first, so the light climbs into view
    const e = ease(seg(k, 0, 0.55));
    camera.position.lerp(camOut, e);
    camera.quaternion.slerp(qOut, e);
    // the lens eases back to the encode scene's
    const f = (2 * Math.atan(halfTan(camera.fov) * lerp(1, halfTan(ENCODE_CAM.fov) / halfTan(cCam.fov), e)) * 180) / Math.PI;
    // by the hand-over the lens is exactly the encode camera's
    camera.fov = next ? lerp(f, next.fov, ease(seg(k, 0.3, 0.6))) : f;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // the sentence sits where the encode camera sees its own, this frame,
    // so the two line up exactly while one scene fades into the other
    if (next) {
      next.updateMatrixWorld();
      sentLocal.copy(next.matrixWorld).invert().multiply(sentRef.matrixWorld);
      camera.matrixWorld.clone().multiply(sentLocal).decompose(sentOut.position, sentOut.quaternion, sentOut.scale);
    }
    // the plain and its labels go dark; the light climbs to the sentence
    // all of the corpus is gone before the encode scene comes up
    const gone = 1 - ease(seg(k, 0.05, 0.38));
    if (THEME.paper) {
      CP.plainMat.opacity *= gone;
      ruleMat.opacity = gone;
    } else {
      CP.plainMat.color.multiplyScalar(gone);
      ruleMat.color.copy(ruleColor).multiplyScalar(gone);
    }
    CP.fallMat.uniforms.uOpacity.value = gone;
    cLabels.forEach((l) => (l.el.style.opacity = String(Number(l.el.style.opacity || 1) * (1 - seg(k, 0, 0.3)))));
    beamOut.visible = true;
    // a streak of light climbs from the cell to the words: its tail
    // follows its head, so by the change of scene only the top is left
    const bi = beamOut.geometry.index!.count;
    const head = ease(seg(k, 0.12, 0.5));
    const tail = ease(seg(k, 0.3, 0.62));
    const from = Math.floor((bi * tail) / 6) * 6;
    beamOut.geometry.setDrawRange(from, Math.max(0, Math.floor((bi * head) / 6) * 6 - from));
    sentOut.visible = true;
    sentMat.opacity = ease(seg(k, 0.3, 0.5));
    look.dof!.focus = camera.position.distanceTo(sentOut.position);
    look.dof!.aperture = 0.0002;
  };
  return { camera, look, update, cutOut, ready: reading.ready };
}
