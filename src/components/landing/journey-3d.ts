import * as THREE from "three";

const smooth = (n: number) => {
  const t = Math.max(0, Math.min(1, n));
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;

/** One small scene, rendered only while scroll/camera movement is settling. */
export function createJourneyScene(
  host: HTMLElement,
  onProgress: (p: number) => void,
  onFailure: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setClearColor("#e8e2d6");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e8e2d6", 17, 36);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  const resources: Array<{ dispose: () => void }> = [];
  const own = <T extends { dispose: () => void }>(r: T): T => {
    resources.push(r);
    return r;
  };
  const box = own(new THREE.BoxGeometry(1, 1, 1));
  const plane = own(new THREE.PlaneGeometry(1, 1));
  const material = (color: string, map?: THREE.Texture) =>
    own(
      new THREE.MeshStandardMaterial({
        color,
        map,
        roughness: 0.86,
        metalness: 0,
      }),
    );
  const textures: THREE.CanvasTexture[] = [];
  function texture(
    width: number,
    height: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    paint(ctx);
    const t = own(new THREE.CanvasTexture(canvas));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(t);
    return t;
  }
  function cloth(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    color: string,
  ) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    // Deterministic fine woven texture, generated once, not an image download.
    let seed = 731;
    for (let i = 0; i < 16000; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % w;
      seed = (seed * 16807) % 2147483647;
      const y = seed % h;
      ctx.fillStyle = i % 2 ? "#fff00008" : "#00000010";
      ctx.fillRect(x, y, 1, 3);
    }
    ctx.strokeStyle = "#ffffff09";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
  const coverTexture = texture(768, 1120, (ctx) => {
    cloth(ctx, 768, 1120, "#954726");
    const shade = ctx.createLinearGradient(0, 0, 120, 0);
    shade.addColorStop(0, "#341e1480");
    shade.addColorStop(0.6, "#341e1400");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 768, 1120);
    ctx.strokeStyle = "#d8ad70";
    ctx.lineWidth = 2;
    ctx.strokeRect(76, 80, 616, 960);
    ctx.strokeRect(84, 88, 600, 944);
    ctx.textAlign = "center";
    ctx.fillStyle = "#edc68d";
    ctx.font = "25px Georgia";
    ctx.fillText("UNITED STATES", 390, 305);
    ctx.fillText("CODE", 390, 350);
    ctx.font = "90px Georgia";
    ctx.fillText("Title 7", 390, 560);
    ctx.font = "24px Georgia";
    ctx.fillText("AGRICULTURE", 390, 645);
    ctx.beginPath();
    ctx.moveTo(290, 707);
    ctx.lineTo(490, 707);
    ctx.stroke();
    ctx.font = "19px Georgia";
    ctx.fillText("CHAPTER 51", 390, 815);
  });
  const spineTexture = texture(192, 1024, (ctx) => {
    cloth(ctx, 192, 1024, "#994c29");
    ctx.fillStyle = "#d9b679";
    ctx.fillRect(20, 100, 152, 3);
    ctx.fillRect(20, 920, 152, 3);
    ctx.textAlign = "center";
    ctx.font = "22px Georgia";
    ctx.fillText("U.S.", 96, 235);
    ctx.fillText("CODE", 96, 275);
    ctx.font = "66px Georgia";
    ctx.fillText("7", 96, 490);
    ctx.font = "16px Georgia";
    ctx.fillText("AGRICULTURE", 96, 685);
  });
  const pageTexture = texture(1024, 1440, (ctx) => {
    ctx.fillStyle = "#f7f0dd";
    ctx.fillRect(0, 0, 1024, 1440);
    const shade = ctx.createLinearGradient(0, 0, 220, 0);
    shade.addColorStop(0, "#82725155");
    shade.addColorStop(0.7, "#82725100");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 1024, 1440);
    ctx.fillStyle = "#8a7657";
    ctx.font = "20px Georgia";
    ctx.fillText("UNITED STATES CODE", 92, 115);
    ctx.textAlign = "right";
    ctx.fillText("TITLE 7", 935, 115);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#b9a783";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(92, 145);
    ctx.lineTo(934, 145);
    ctx.stroke();
    ctx.fillStyle = "#9c4d2c";
    ctx.font = "36px Georgia";
    ctx.fillText("§ 2017", 92, 255);
    ctx.fillStyle = "#3c362b";
    ctx.font = "57px Georgia";
    ctx.fillText("Value of allotment", 92, 339);
    ctx.fillStyle = "#8a7657";
    ctx.font = "22px Georgia";
    ctx.fillText("(a)  Value of allotment", 92, 405);
    ctx.fillStyle = "#4f4738";
    ctx.font = "39px Georgia";
    [
      "…reduced by an amount equal to",
      "30 per centum of the household’s",
      "income…",
    ].forEach((line, i) => ctx.fillText(line, 92, 620 + i * 70));
    ctx.fillStyle = "#b9ac9248";
    for (let i = 0; i < 7; i++)
      ctx.fillRect(92, 930 + i * 29, 750 - (i % 3) * 48, 2);
    ctx.fillStyle = "#9e8c6d";
    ctx.font = "18px Georgia";
    ctx.fillText("SOURCE EXCERPT", 92, 1280);
    ctx.textAlign = "right";
    ctx.fillText("2017", 934, 1280);
  });
  const leftTexture = texture(768, 1120, (ctx) => {
    ctx.fillStyle = "#eee5d0";
    ctx.fillRect(0, 0, 768, 1120);
    ctx.textAlign = "center";
    ctx.fillStyle = "#8c785b";
    ctx.font = "18px Georgia";
    ctx.fillText("UNITED STATES CODE", 384, 160);
    ctx.fillStyle = "#66543e";
    ctx.font = "80px Georgia";
    ctx.fillText("Title 7", 384, 440);
    ctx.font = "31px Georgia";
    ctx.fillText("Agriculture", 384, 520);
    ctx.fillStyle = "#9c8768";
    ctx.font = "18px Georgia";
    ctx.fillText("CHAPTER 51", 384, 780);
    ctx.fillText("Supplemental Nutrition Assistance", 384, 825);
    ctx.fillText("Program", 384, 855);
  });
  const edgesTexture = texture(64, 512, (ctx) => {
    ctx.fillStyle = "#e5dbc5";
    ctx.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 512; i += 4) {
      ctx.fillStyle = i % 12 === 0 ? "#b7a78a" : "#d4c7ad";
      ctx.fillRect(0, i, 64, 1);
    }
  });
  const cover = material("#ffffff", coverTexture),
    clothMat = material("#98502e"),
    spine = material("#ffffff", spineTexture),
    paper = material("#ffffff", edgesTexture),
    page = material("#ffffff", pageTexture),
    inside = material("#ffffff", leftTexture);
  cover.bumpMap = coverTexture;
  cover.bumpScale = 0.009;
  const shelfMat = material("#bdb09a"),
    wallMat = material("#d2c5af"),
    darkMat = material("#8e7d64");
  function cube(
    parent: THREE.Object3D,
    size: number[],
    at: number[],
    mat: THREE.Material | THREE.Material[],
  ) {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(size[0], size[1], size[2]);
    m.position.set(at[0], at[1], at[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  scene.add(new THREE.HemisphereLight("#fff6dc", "#8c8174", 1.5));
  const sun = new THREE.DirectionalLight("#fff1d6", 2.8);
  sun.position.set(-6, 9, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -6;
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0003;
  sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#d8e5ec", 1.15);
  fill.position.set(7, 3, 4);
  scene.add(fill);
  const shelving = new THREE.Group();
  scene.add(shelving);
  cube(shelving, [20, 11, 0.3], [0, 1, -1.5], wallMat);
  for (const y of [-3.6, 0, 3.6, 7.2]) {
    cube(shelving, [20, 0.13, 3], [0, y, 0], shelfMat);
    cube(shelving, [20, 0.17, 0.07], [0, y - 0.055, 1.53], darkMat);
  }
  for (const x of [-10, -5.2, 5.2, 10])
    cube(shelving, [0.16, 11, 3], [x, 1, 0], shelfMat);
  const shelfColors = [
    "#6d766b",
    "#b09b79",
    "#766d5d",
    "#a37658",
    "#c4b499",
    "#7f8979",
  ];
  const shelfMaterials = shelfColors.map((c) => material(c));
  const shelfSpines = shelfColors.map((color, index) =>
    material(
      "#ffffff",
      texture(128, 512, (ctx) => {
        cloth(ctx, 128, 512, color);
        ctx.strokeStyle = "#dbca9a";
        ctx.lineWidth = 2;
        ctx.strokeRect(18, 49, 92, 409);
        ctx.textAlign = "center";
        ctx.fillStyle = "#dfd1b4";
        ctx.font = "14px Georgia";
        ctx.fillText(
          ["STATUTES", "CODE", "GUIDANCE", "LAW", "ACTS", "RULES"][index],
          64,
          180,
        );
        ctx.font = "40px Georgia";
        ctx.fillText(String(index + 1), 64, 270);
      }),
    ),
  );
  const shelfBooks: Array<{
    x: number;
    y: number;
    h: number;
    d: number;
    index: number;
  }> = [];
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 28; i++) {
      const x = -9.4 + i * 0.69;
      if (Math.abs(x) < 0.6 && row === 1) continue;
      const h = 2.65 + ((i * 13 + row * 7) % 8) * 0.07,
        d = 0.38 + (i % 3) * 0.055,
        y = -3.6 + row * 3.6 + h / 2 + 0.08;
      shelfBooks.push({ x, y, h, d, index: (i + row * 2) % 6 });
    }
  const shelfPose = new THREE.Object3D();
  for (let colorIndex = 0; colorIndex < 6; colorIndex++) {
    const books = shelfBooks.filter((b) => b.index === colorIndex);
    const bodies = own(
      new THREE.InstancedMesh(box, shelfMaterials[colorIndex], books.length),
    );
    const spines = own(
      new THREE.InstancedMesh(plane, shelfSpines[colorIndex], books.length),
    );
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    spines.receiveShadow = true;
    shelving.add(bodies, spines);
    books.forEach((b, i) => {
      shelfPose.position.set(b.x, b.y, 0.15);
      shelfPose.scale.set(b.d, b.h, 2.1);
      shelfPose.updateMatrix();
      bodies.setMatrixAt(i, shelfPose.matrix);
      shelfPose.position.z = 1.206;
      shelfPose.scale.set(b.d, b.h, 1);
      shelfPose.updateMatrix();
      spines.setMatrixAt(i, shelfPose.matrix);
    });
  }
  const pageTops = own(new THREE.InstancedMesh(box, paper, shelfBooks.length));
  shelving.add(pageTops);
  shelfBooks.forEach((b, i) => {
    shelfPose.position.set(b.x, b.y + b.h / 2 + 0.006, 0.13);
    shelfPose.scale.set(b.d * 0.8, 0.012, 1.97);
    shelfPose.updateMatrix();
    pageTops.setMatrixAt(i, shelfPose.matrix);
  });
  const floor = material("#d1c4ae");
  floor.transparent = true;
  floor.depthWrite = false;
  cube(scene, [70, 0.1, 60], [0, -3.72, 2], floor);
  const book = new THREE.Group();
  scene.add(book);
  // Local origin is the spine. The front board pivots about that hinge.
  cube(book, [2.2, 3.2, 0.06], [1.1, 0, -0.22], clothMat);
  cube(book, [2.09, 3.08, 0.36], [1.1, 0, 0], paper);
  cube(
    book,
    [0.1, 3.2, 0.49],
    [0, 0, 0],
    [spine, spine, clothMat, clothMat, clothMat, clothMat],
  );
  // A gently curved reading page keeps the gutter dimensional in close-up.
  const pageGeo = own(new THREE.PlaneGeometry(2.07, 3.065, 24, 1));
  const positions = pageGeo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + 1.035;
    positions.setZ(
      i,
      0.05 * Math.sin((x / 2.07) * Math.PI) + 0.025 * Math.exp(-x * 8),
    );
  }
  pageGeo.computeVertexNormals();
  const readingPage = new THREE.Mesh(pageGeo, page);
  readingPage.position.set(1.1, 0, 0.191);
  readingPage.receiveShadow = true;
  book.add(readingPage);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0, 0.24);
  book.add(hinge);
  cube(
    hinge,
    [2.2, 3.2, 0.065],
    [1.1, 0, 0],
    [clothMat, clothMat, clothMat, clothMat, cover, inside],
  );
  const gold = material("#c5a776");
  cube(book, [0.015, 3.05, 0.014], [0.018, 0, 0.245], gold);
  const ribbon = material("#8a3c24");
  cube(book, [0.055, 0.64, 0.008], [1.64, -1.71, -0.045], ribbon);
  const highlightMat = own(
    new THREE.MeshBasicMaterial({
      color: "#d6a248",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  const highlight = new THREE.Mesh(plane, highlightMat);
  highlight.scale.set(1.71, 0.3, 1);
  highlight.position.set(1.105, 0.075, 0.26);
  book.add(highlight);
  // A single lifted fragment grows into the rule plaque, then stays in the graph.
  const quoteTexture = texture(1024, 280, (ctx) => {
    ctx.fillStyle = "#ead8ae";
    ctx.fillRect(0, 0, 1024, 280);
    ctx.fillStyle = "#57432c";
    ctx.font = "48px Georgia";
    ctx.fillText("30 per centum of the", 55, 113);
    ctx.fillText("household’s income", 55, 181);
  });
  const ruleTexture = (correct: boolean) =>
    texture(1024, 820, (ctx) => {
      cloth(ctx, 1024, 820, "#304a3e");
      ctx.fillStyle = "#b9c6ad";
      ctx.font = "23px monospace";
      ctx.fillText("RULESPEC / SNAP", 70, 83);
      ctx.fillStyle = "#f5e7c9";
      ctx.font = "77px Georgia";
      ctx.fillText("Allotment", 70, 185);
      ctx.strokeStyle = "#83957a";
      ctx.beginPath();
      ctx.moveTo(70, 229);
      ctx.lineTo(954, 229);
      ctx.stroke();
      ctx.fillStyle = "#c3cfb9";
      ctx.font = "26px monospace";
      ctx.fillText("Household · Money · Month", 70, 288);
      ctx.fillStyle = "#f3eedb";
      ctx.font = "43px monospace";
      ctx.fillText("max(0, tfp −", 70, 410);
      ctx.fillStyle = correct ? "#ebd19c" : "#eea188";
      ctx.fillText(correct ? "0.30" : "0.03", 118, 478);
      ctx.fillStyle = "#f3eedb";
      ctx.fillText("× net_income)", 250, 478);
      ctx.strokeStyle = "#83957a";
      ctx.beginPath();
      ctx.moveTo(70, 557);
      ctx.lineTo(954, 557);
      ctx.stroke();
      ctx.fillStyle = "#dfc798";
      ctx.font = "27px Georgia";
      ctx.fillText("7 USC § 2017(a)", 70, 621);
      ctx.font = "28px Georgia";
      ctx.fillText("“30 per centum”", 70, 668);
      ctx.fillStyle = "#a9b9a4";
      ctx.font = "19px monospace";
      ctx.fillText("ILLUSTRATIVE · SIMPLIFIED FORMULA", 70, 755);
    });
  const wrongRule = ruleTexture(false),
    correctRule = ruleTexture(true);
  const graphRule = texture(1024, 820, (ctx) => {
    cloth(ctx, 1024, 820, "#304a3e");
    ctx.fillStyle = "#b9c6ad";
    ctx.font = "44px monospace";
    ctx.fillText("SHARED RULE", 75, 125);
    ctx.fillStyle = "#f5e7c9";
    ctx.font = "130px Georgia";
    ctx.fillText("SNAP", 75, 320);
    ctx.fillText("allotment", 75, 475);
    ctx.fillStyle = "#dfc798";
    ctx.font = "45px Georgia";
    ctx.fillText("7 USC § 2017(a)", 75, 675);
  });
  const rule = new THREE.Group();
  scene.add(rule);
  const ruleEdge = material("#b89b63");
  const ruleBody = cube(rule, [1, 1, 0.06], [0, 0, 0], ruleEdge);
  const quoteMat = own(
    new THREE.MeshBasicMaterial({
      map: quoteTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  const ruleMat = own(
    new THREE.MeshBasicMaterial({
      map: wrongRule,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  const graphMat = own(
    new THREE.MeshBasicMaterial({
      map: graphRule,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  const graphFace = new THREE.Mesh(plane, graphMat);
  graphFace.position.z = 0.038;
  rule.add(graphFace);
  const quoteFace = new THREE.Mesh(plane, quoteMat),
    ruleFace = new THREE.Mesh(plane, ruleMat);
  quoteFace.position.z = 0.036;
  ruleFace.position.z = 0.037;
  rule.add(quoteFace, ruleFace);
  const sealMat = material("#4f7352");
  const seal = cube(rule, [0.055, 1, 0.02], [-0.49, 0, 0.035], sealMat);
  seal.visible = false;
  const network = new THREE.Group();
  scene.add(network);
  const connectionMat = own(
    new THREE.LineBasicMaterial({
      color: "#927b4e",
      transparent: true,
      opacity: 0,
      fog: false,
    }),
  );
  const connectionGeo = own(new THREE.BufferGeometry());
  connectionGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(7 * 3 * 48), 3),
  );
  const connections = new THREE.LineSegments(connectionGeo, connectionMat);
  scene.add(connections);
  function labelTexture(title: string, kind: string, citation: string) {
    return texture(640, 320, (ctx) => {
      ctx.fillStyle = "#f5eedc";
      ctx.fillRect(0, 0, 640, 320);
      ctx.strokeStyle = "#b5a17c";
      ctx.lineWidth = 2;
      ctx.strokeRect(7, 7, 626, 306);
      ctx.fillStyle = "#967a51";
      ctx.font = "26px monospace";
      ctx.fillText(kind, 36, 62);
      ctx.fillStyle = "#4c4938";
      ctx.font = "66px Georgia";
      const lines =
        title === "Thrifty food plan" ? ["Thrifty food", "plan"] : [title];
      lines.forEach((line, i) =>
        ctx.fillText(line, 36, lines.length === 1 ? 183 : 154 + i * 80),
      );
    });
  }
  const nodeDefinitions = [
    ["Thrifty food plan", "DEPENDENCY", "An amount, with its source"],
    ["Net income", "DEPENDENCY", "A shared calculation"],
    ["Eligibility", "DEPENDENCY", "A connected check"],
    ["Colorado", "PROGRAM", "Built on the federal core"],
    ["New York", "PROGRAM", "The same underlying rule"],
    ["North Carolina", "PROGRAM", "Reused, rather than copied"],
  ];
  const nodes = nodeDefinitions.map(([title, kind, citation]) => {
    const group = new THREE.Group();
    network.add(group);
    cube(group, [2.4, 1.2, 0.075], [0, 0, 0], material("#c9bfa8"));
    const face = new THREE.Mesh(
      plane,
      own(
        new THREE.MeshBasicMaterial({
          map: labelTexture(title, kind, citation),
          toneMapped: false,
          fog: false,
        }),
      ),
    );
    face.scale.set(2.4, 1.2, 1);
    face.position.z = 0.045;
    group.add(face);
    return group;
  });
  // A bounded, instanced field suggests the wider corpus without presenting fake live counts.
  const registry = new THREE.Group();
  scene.add(registry);
  const registeredMat = own(
    new THREE.MeshStandardMaterial({
      color: "#637b63",
      roughness: 0.9,
      transparent: true,
      opacity: 0,
      fog: false,
    }),
  );
  const pendingMat = own(
    new THREE.MeshStandardMaterial({
      color: "#c7b99c",
      roughness: 1,
      transparent: true,
      opacity: 0,
      fog: false,
    }),
  );
  const encodedField = new THREE.InstancedMesh(box, registeredMat, 90),
    pendingField = new THREE.InstancedMesh(box, pendingMat, 230);
  registry.add(encodedField, pendingField);
  own(encodedField);
  own(pendingField);
  const dummy = new THREE.Object3D(),
    fieldPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 320; i++) {
    const cluster = i % 8,
      angle = (cluster * Math.PI) / 4,
      ring = 2.3 + (Math.floor(i / 8) % 5) * 0.45,
      theta = i * 2.39996;
    const x = Math.cos(angle) * 9 + Math.cos(theta) * ring,
      y = Math.sin(angle) * 5.5 + Math.sin(theta) * ring * 0.7,
      z = 4 + (i % 7) * 0.35;
    dummy.position.set(x, y, z);
    dummy.rotation.set(
      -0.1 + (i % 3) * 0.07,
      ((i % 5) - 2) * 0.07,
      ((i % 7) - 3) * 0.035,
    );
    dummy.scale.set(0.42 + (i % 3) * 0.08, 0.62 + (i % 4) * 0.06, 0.055);
    dummy.updateMatrix();
    (i < 90 ? encodedField : pendingField).setMatrixAt(
      i < 90 ? i : i - 90,
      dummy.matrix,
    );
    fieldPoints.push(dummy.position.clone());
  }
  const fieldEdges: number[] = [];
  for (let i = 8; i < 96; i++) {
    fieldEdges.push(
      ...fieldPoints[i].toArray(),
      ...fieldPoints[i - 8].toArray(),
    );
  }
  for (let i = 0; i < 8; i++)
    fieldEdges.push(3.2, 0, 7.8, ...fieldPoints[i].toArray());
  const fieldGeo = own(new THREE.BufferGeometry());
  fieldGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(fieldEdges, 3),
  );
  const fieldLineMat = own(
    new THREE.LineBasicMaterial({
      color: "#8f977b",
      transparent: true,
      opacity: 0,
      fog: false,
    }),
  );
  registry.add(new THREE.LineSegments(fieldGeo, fieldLineMat));
  const rulePosition = new THREE.Vector3(),
    sourcePosition = new THREE.Vector3(),
    curvePoint = new THREE.Vector3();
  const cameraStart = new THREE.Vector3(),
    lookStart = new THREE.Vector3();
  let target = 0,
    current = 0,
    frame = 0,
    previous = 0,
    visible = true,
    disposed = false,
    lowQuality = false,
    slowFrames = 0,
    renderCount = 0;
  const canvas = renderer.domElement;
  const targetLook = new THREE.Vector3();
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, lowQuality ? 1 : 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    request();
  }
  function paint(progress: number) {
    const p = Math.min(1, progress / 0.3),
      pull = smooth(p / 0.48),
      open = smooth((p - 0.43) / 0.4),
      focus = smooth((p - 0.78) / 0.22),
      mobile = camera.aspect < 0.85;
    const lift = smooth((progress - 0.32) / 0.125),
      connect = smooth((progress - 0.715) / 0.1),
      wide = smooth((progress - 0.875) / 0.125);
    book.scale.setScalar(1);
    book.position.set(
      lerp(-0.2, lerp(-1.1, 0, open), pull),
      lerp(1.65, 0.2, pull),
      lerp(1.02, 3.2, smooth(p / 0.2)) + 3.8 * smooth((p - 0.18) / 0.3),
    );
    book.rotation.set(
      lerp(0, -0.06, pull),
      lerp(Math.PI / 2, -0.1, smooth((p - 0.13) / 0.35)),
      lerp(0, -0.025, pull),
    );
    hinge.rotation.y = -open * Math.PI * 0.965;
    const portraitDistance =
      7 + 2.65 / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * camera.aspect);
    const fitDistance = mobile
      ? lerp(21, Math.max(14.5, portraitDistance), pull)
      : lerp(19, 14.5, pull);
    (scene.fog as THREE.Fog).near = lerp(17, 9, pull);
    (scene.fog as THREE.Fog).far = lerp(36, 19, pull);
    camera.position.set(
      lerp(7.8, lerp(1.0, mobile ? 1.03 : 0.55, focus), pull),
      lerp(4.0, 1.2, pull),
      fitDistance,
    );
    targetLook.set(
      lerp(0, mobile ? lerp(0, 1.0, focus) : 0, pull),
      lerp(1.0, 0.7, pull),
      lerp(0, 6.9, pull),
    );
    highlightMat.opacity = focus * 0.23 * (1 - lift * 0.65);
    cameraStart.copy(camera.position);
    lookStart.copy(targetLook);
    if (progress > 0.3) {
      const bookScale = lerp(1, mobile ? 0.36 : 0.72, lift);
      book.scale.setScalar(bookScale);
      book.position.x = lerp(0, mobile ? 0 : -2.8, lift);
      book.position.y = lerp(0.2, mobile ? 2.3 : -0.25, lift);
      book.rotation.y = lerp(-0.1, 0.16, lift);
      const encodeDistance = mobile
        ? 8 +
          4.15 / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * camera.aspect)
        : 18;
      camera.position.lerpVectors(
        cameraStart,
        new THREE.Vector3(mobile ? 0 : 1.2, 1.3, encodeDistance),
        lift,
      );
      targetLook.lerpVectors(
        lookStart,
        new THREE.Vector3(mobile ? 0 : 0.3, 0.65, 7.5),
        lift,
      );
      (scene.fog as THREE.Fog).near = lerp(9, 10, lift);
      (scene.fog as THREE.Fog).far = lerp(19, 21, lift);
    }
    book.updateMatrixWorld(true);
    sourcePosition.set(1.1, 0.075, 0.28).applyMatrix4(book.matrixWorld);
    rulePosition.set(mobile ? 0 : 2.0, mobile ? -0.25 : 0, 8);
    rule.position.lerpVectors(sourcePosition, rulePosition, lift);
    rule.rotation.set(lerp(-0.06, 0, lift), lerp(-0.1, -0.05, lift), 0);
    ruleBody.scale.set(lerp(1.71, 3.3, lift), lerp(0.3, 2.65, lift), 0.06);
    quoteFace.scale.set(ruleBody.scale.x, ruleBody.scale.y, 1);
    ruleFace.scale.copy(quoteFace.scale);
    graphFace.scale.copy(quoteFace.scale);
    quoteMat.opacity = 1 - smooth((lift - 0.35) / 0.5);
    graphMat.opacity = smooth((connect - 0.4) / 0.3);
    ruleMat.opacity = (1 - quoteMat.opacity) * (1 - graphMat.opacity);
    const correct = progress >= 0.615;
    ruleMat.map = correct ? correctRule : wrongRule;
    seal.visible = progress >= 0.7;
    seal.position.x = -ruleBody.scale.x / 2 + 0.05;
    seal.scale.y = ruleBody.scale.y - 0.1;
    rule.visible = progress > 0.322;
    if (connect > 0) {
      const nx = mobile ? 0 : 1.8;
      rule.position.x = lerp(rule.position.x, nx, connect);
      const s = lerp(1, mobile ? 0.9 : 0.83, connect);
      rule.scale.setScalar(s);
      book.position.x = lerp(book.position.x, mobile ? -2.2 : -4.7, connect);
      book.position.y = lerp(book.position.y, mobile ? -0.3 : -1.3, connect);
      book.scale.multiplyScalar(lerp(1, mobile ? 0.48 : 0.64, connect));
      book.updateMatrixWorld(true);
      sourcePosition.set(1.1, 0.075, 0.28).applyMatrix4(book.matrixWorld);
      const graphDistance = mobile
        ? 8 + 6.4 / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * camera.aspect)
        : 23.5;
      camera.position.lerp(
        new THREE.Vector3(mobile ? 0 : 2, 2.7, graphDistance),
        connect,
      );
      targetLook.lerp(
        new THREE.Vector3(mobile ? 0 : 0.6, mobile ? -0.6 : 0.5, 7.5),
        connect,
      );
      (scene.fog as THREE.Fog).near = lerp(10, 10, connect);
      (scene.fog as THREE.Fog).far = lerp(21, 23, connect);
    } else rule.scale.setScalar(1);
    const desktop = [
      [-2, 2.7, 7.5],
      [-2, 0.5, 7.5],
      [-2, -1.7, 7.5],
      [6, 2.7, 8],
      [6, 0.5, 8],
      [6, -1.7, 8],
    ];
    const portrait = [
      [-2.05, 2.55, 8],
      [0, 3.05, 7.5],
      [2.05, 2.55, 8],
      [-2.05, -2.7, 8],
      [0, -3.2, 7.5],
      [2.05, -2.7, 8],
    ];
    nodes.forEach((node, i) => {
      const [x, y, z] = (mobile ? portrait : desktop)[i];
      node.position.set(
        lerp(rule.position.x, x, connect),
        lerp(rule.position.y, y, connect),
        z,
      );
      node.scale.setScalar((mobile ? 0.65 : 1) * Math.max(0.001, connect));
    });
    network.visible = connect > 0;
    const buffer = connectionGeo.attributes.position;
    let offset = 0;
    function wire(a: THREE.Vector3, b: THREE.Vector3, t: number) {
      const end = a.clone().lerp(b, t),
        bend = new THREE.Vector3(
          (a.x + end.x) / 2,
          (a.y + end.y) / 2,
          Math.min(a.z, end.z) - 0.25,
        );
      for (let j = 0; j < 24; j++) {
        for (const u of [j / 24, (j + 1) / 24]) {
          curvePoint
            .copy(a)
            .multiplyScalar((1 - u) * (1 - u))
            .addScaledVector(bend, 2 * (1 - u) * u)
            .addScaledVector(end, u * u);
          buffer.setXYZ(offset++, curvePoint.x, curvePoint.y, curvePoint.z);
        }
      }
    }
    // The source tether remains attached to the same book and encoding as they move.
    const leftPort = rule.position
      .clone()
      .add(new THREE.Vector3((-ruleBody.scale.x * rule.scale.x) / 2, 0, 0));
    wire(sourcePosition, leftPort, lift);
    nodes.forEach((node, i) => {
      const input = i < 3,
        near = node.position.clone(),
        port = rule.position.clone();
      if (mobile) {
        near.y += (input ? -0.6 : 0.6) * node.scale.y;
        port.y += ((input ? 1 : -1) * ruleBody.scale.y * rule.scale.y) / 2;
        port.x += ((i % 3) - 1) * 0.5;
      } else {
        near.x += (input ? 1.2 : -1.2) * node.scale.x;
        port.x += ((input ? -1 : 1) * ruleBody.scale.x * rule.scale.x) / 2;
        port.y += (1 - (i % 3)) * 0.65;
      }
      if (input) wire(near, port, connect);
      else wire(port, near, connect);
    });
    connectionGeo.setDrawRange(0, offset);
    buffer.needsUpdate = true;
    connections.frustumCulled = false;
    connectionMat.opacity = progress > 0.33 ? lerp(0.55, 0.8, connect) : 0;
    if (wide > 0) {
      const wideDistance = mobile
        ? 7 + 31 / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * camera.aspect)
        : 45;
      camera.far = 180;
      camera.updateProjectionMatrix();
      camera.position.lerp(
        new THREE.Vector3(mobile ? 2 : 6, 8, wideDistance),
        wide,
      );
      targetLook.lerp(new THREE.Vector3(0, 0, 5.8), wide);
      (scene.fog as THREE.Fog).near = lerp(10, wideDistance - 18, wide);
      (scene.fog as THREE.Fog).far = lerp(23, wideDistance - 1, wide);
    }
    floor.opacity = 1 - wide;
    registry.visible = wide > 0;
    registeredMat.opacity = wide;
    pendingMat.opacity = wide * 0.45;
    fieldLineMat.opacity = wide * 0.42;
    // The library remains behind the scene, but does not compete with the wider network.
    shelving.visible = true;
    camera.lookAt(targetLook);
    renderer.render(scene, camera);
    renderCount++;
    host.dataset.renderCount = String(renderCount);
    host.dataset.drawCalls = String(renderer.info.render.calls);
    host.dataset.progress = progress.toFixed(3);
    onProgress(progress);
  }
  function tick(time: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const dt = previous ? Math.min(time - previous, 70) : 16;
    previous = time;
    current += (target - current) * (1 - Math.exp(-dt / 160));
    if (Math.abs(current - target) < 0.00015) current = target;
    const start = performance.now();
    paint(current);
    const elapsed = performance.now() - start;
    if (elapsed > 24) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 12 && !lowQuality) {
      lowQuality = true;
      renderer.shadowMap.enabled = false;
      resize();
    }
    if (current !== target) request();
    else previous = 0;
  }
  function request() {
    if (!frame && !disposed && visible && !document.hidden)
      frame = requestAnimationFrame(tick);
  }
  function lost(e: Event) {
    e.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    onFailure();
  }
  canvas.addEventListener("webglcontextlost", lost);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
    } else request();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    setProgress(p: number) {
      target = Math.max(0, Math.min(1, p));
      request();
    },
    setVisible(v: boolean) {
      visible = v;
      if (v) request();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
        previous = 0;
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("webglcontextlost", lost);
      for (const r of resources) r.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
