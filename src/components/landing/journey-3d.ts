import * as THREE from "three";

const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

/** One small scene, rendered only while scroll/camera movement is settling. */
export function createJourneyScene(host: HTMLElement, onProgress: (p: number) => void, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
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
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 80);
  const resources: Array<{dispose: () => void}> = [];
  const own = <T extends {dispose: () => void}>(r: T): T => { resources.push(r); return r; };
  const box = own(new THREE.BoxGeometry(1,1,1));
  const plane = own(new THREE.PlaneGeometry(1,1));
  const material = (color: string, map?: THREE.Texture) => own(new THREE.MeshStandardMaterial({color, map, roughness:.86, metalness:0}));
  const textures: THREE.CanvasTexture[] = [];
  function texture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement("canvas"); canvas.width=width; canvas.height=height;
    const ctx = canvas.getContext("2d")!; paint(ctx);
    const t=own(new THREE.CanvasTexture(canvas));t.colorSpace=THREE.SRGBColorSpace;
    t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());textures.push(t);return t;
  }
  function cloth(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
    ctx.fillStyle=color;ctx.fillRect(0,0,w,h);
    // Deterministic fine woven texture, generated once, not an image download.
    let seed=731;
    for(let i=0;i<16000;i++){seed=(seed*16807)%2147483647;const x=seed%w;seed=(seed*16807)%2147483647;const y=seed%h;ctx.fillStyle=i%2?'#fff00008':'#00000010';ctx.fillRect(x,y,1,3);}
    ctx.strokeStyle='#ffffff09';ctx.lineWidth=1;for(let x=0;x<w;x+=4){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  }
  const coverTexture=texture(768,1120,ctx=>{
    cloth(ctx,768,1120,'#954726');
    const shade=ctx.createLinearGradient(0,0,120,0);shade.addColorStop(0,'#341e1480');shade.addColorStop(.6,'#341e1400');ctx.fillStyle=shade;ctx.fillRect(0,0,768,1120);
    ctx.strokeStyle='#d8ad70';ctx.lineWidth=2;ctx.strokeRect(76,80,616,960);ctx.strokeRect(84,88,600,944);
    ctx.textAlign='center';ctx.fillStyle='#edc68d';ctx.font='25px Georgia';ctx.fillText('UNITED STATES',390,305);ctx.fillText('CODE',390,350);
    ctx.font='90px Georgia';ctx.fillText('Title 7',390,560);ctx.font='24px Georgia';ctx.fillText('AGRICULTURE',390,645);
    ctx.beginPath();ctx.moveTo(290,707);ctx.lineTo(490,707);ctx.stroke();ctx.font='19px Georgia';ctx.fillText('CHAPTER 51',390,815);
  });
  const spineTexture=texture(192,1024,ctx=>{
    cloth(ctx,192,1024,'#994c29');ctx.fillStyle='#d9b679';ctx.fillRect(20,100,152,3);ctx.fillRect(20,920,152,3);
    ctx.textAlign='center';ctx.font='22px Georgia';ctx.fillText('U.S.',96,235);ctx.fillText('CODE',96,275);ctx.font='66px Georgia';ctx.fillText('7',96,490);ctx.font='16px Georgia';ctx.fillText('AGRICULTURE',96,685);
  });
  const pageTexture=texture(1024,1440,ctx=>{
    ctx.fillStyle='#f7f0dd';ctx.fillRect(0,0,1024,1440);
    const shade=ctx.createLinearGradient(0,0,220,0);shade.addColorStop(0,'#82725155');shade.addColorStop(.7,'#82725100');ctx.fillStyle=shade;ctx.fillRect(0,0,1024,1440);
    ctx.fillStyle='#8a7657';ctx.font='20px Georgia';ctx.fillText('UNITED STATES CODE',92,115);ctx.textAlign='right';ctx.fillText('TITLE 7',935,115);ctx.textAlign='left';
    ctx.strokeStyle='#b9a783';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(92,145);ctx.lineTo(934,145);ctx.stroke();
    ctx.fillStyle='#9c4d2c';ctx.font='36px Georgia';ctx.fillText('§ 2017',92,255);ctx.fillStyle='#3c362b';ctx.font='57px Georgia';ctx.fillText('Value of allotment',92,339);
    ctx.fillStyle='#8a7657';ctx.font='22px Georgia';ctx.fillText('(a)  Value of allotment',92,405);
    ctx.fillStyle='#4f4738';ctx.font='39px Georgia';
    ['…reduced by an amount equal to','30 per centum of the household’s','income…'].forEach((line,i)=>ctx.fillText(line,92,620+i*70));
    ctx.fillStyle='#b9ac9248';for(let i=0;i<7;i++)ctx.fillRect(92,930+i*29,750-(i%3)*48,2);
    ctx.fillStyle='#9e8c6d';ctx.font='18px Georgia';ctx.fillText('SOURCE EXCERPT',92,1280);ctx.textAlign='right';ctx.fillText('2017',934,1280);
  });
  const leftTexture=texture(768,1120,ctx=>{
    ctx.fillStyle='#eee5d0';ctx.fillRect(0,0,768,1120);ctx.textAlign='center';ctx.fillStyle='#8c785b';ctx.font='18px Georgia';ctx.fillText('UNITED STATES CODE',384,160);ctx.fillStyle='#66543e';ctx.font='80px Georgia';ctx.fillText('Title 7',384,440);ctx.font='31px Georgia';ctx.fillText('Agriculture',384,520);ctx.fillStyle='#9c8768';ctx.font='18px Georgia';ctx.fillText('CHAPTER 51',384,780);ctx.fillText('Supplemental Nutrition Assistance',384,825);ctx.fillText('Program',384,855);
  });
  const edgesTexture=texture(64,512,ctx=>{ctx.fillStyle='#e5dbc5';ctx.fillRect(0,0,64,512);for(let i=0;i<512;i+=4){ctx.fillStyle=i%12===0?'#b7a78a':'#d4c7ad';ctx.fillRect(0,i,64,1);}});
  const cover=material('#ffffff',coverTexture),clothMat=material('#98502e'),spine=material('#ffffff',spineTexture),paper=material('#ffffff',edgesTexture),page=material('#ffffff',pageTexture),inside=material('#ffffff',leftTexture);
  cover.bumpMap=coverTexture;cover.bumpScale=.009;
  const shelfMat=material('#bdb09a'),wallMat=material('#d2c5af'),darkMat=material('#8e7d64');
  function cube(parent: THREE.Object3D, size: number[], at: number[], mat: THREE.Material|THREE.Material[]) {
    const m=new THREE.Mesh(box,mat);m.scale.set(size[0],size[1],size[2]);m.position.set(at[0],at[1],at[2]);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  scene.add(new THREE.HemisphereLight('#fff6dc','#8c8174',1.5));
  const sun=new THREE.DirectionalLight('#fff1d6',2.8);sun.position.set(-6,9,10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-11;sun.shadow.camera.right=11;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-6;sun.shadow.normalBias=.035;sun.shadow.bias=-.0003;sun.shadow.radius=3;scene.add(sun);
  const fill=new THREE.DirectionalLight('#d8e5ec',1.15);fill.position.set(7,3,4);scene.add(fill);
  const shelving=new THREE.Group();scene.add(shelving);
  cube(shelving,[20,11,.3],[0,1,-1.5],wallMat);
  for(const y of [-3.6,0,3.6,7.2]){cube(shelving,[20,.13,3],[0,y,0],shelfMat);cube(shelving,[20,.17,.07],[0,y-.055,1.53],darkMat);}
  for(const x of [-10,-5.2,5.2,10])cube(shelving,[.16,11,3],[x,1,0],shelfMat);
  const shelfColors=['#6d766b','#b09b79','#766d5d','#a37658','#c4b499','#7f8979'];
  const shelfMaterials=shelfColors.map(c=>material(c));
  const shelfSpines=shelfColors.map((color,index)=>material('#ffffff',texture(128,512,ctx=>{
    cloth(ctx,128,512,color);ctx.strokeStyle='#dbca9a';ctx.lineWidth=2;
    ctx.strokeRect(18,49,92,409);ctx.textAlign='center';ctx.fillStyle='#dfd1b4';ctx.font='14px Georgia';ctx.fillText(['STATUTES','CODE','GUIDANCE','LAW','ACTS','RULES'][index],64,180);ctx.font='40px Georgia';ctx.fillText(String(index+1),64,270);
  })));
  for(let row=0;row<3;row++)for(let i=0;i<28;i++){
    const x=-9.4+i*.69;if(Math.abs(x)<.6&&row===1)continue;
    const h=2.65+((i*13+row*7)%8)*.07,d=.38+(i%3)*.055,y=-3.6+row*3.6+h/2+.08;
    const index=(i+row*2)%6,mat=shelfMaterials[index];
    cube(shelving,[d,h,2.1],[x,y,.15],[mat,mat,paper,paper,shelfSpines[index],paper]);
  }
  const floor=material('#d1c4ae');cube(scene,[70,.1,60],[0,-3.72,2],floor);
  const book=new THREE.Group();scene.add(book);
  // Local origin is the spine. The front board pivots about that hinge.
  cube(book,[2.2,3.2,.06],[1.1,0,-.22],clothMat);
  cube(book,[2.09,3.08,.36],[1.10,0,0],paper);
  cube(book,[.10,3.2,.49],[0,0,0],[spine,spine,clothMat,clothMat,clothMat,clothMat]);
  // A gently curved reading page keeps the gutter dimensional in close-up.
  const pageGeo=own(new THREE.PlaneGeometry(2.07,3.065,24,1));
  const positions=pageGeo.attributes.position;
  for(let i=0;i<positions.count;i++){const x=positions.getX(i)+1.035;positions.setZ(i,.05*Math.sin(x/2.07*Math.PI)+.025*Math.exp(-x*8));}
  pageGeo.computeVertexNormals();const readingPage=new THREE.Mesh(pageGeo,page);readingPage.position.set(1.1,0,.191);readingPage.receiveShadow=true;book.add(readingPage);
  const hinge=new THREE.Group();hinge.position.set(0,0,.24);book.add(hinge);
  cube(hinge,[2.2,3.2,.065],[1.1,0,0],[clothMat,clothMat,clothMat,clothMat,cover,inside]);
  const gold=material('#c5a776');cube(book,[.015,3.05,.014],[.018,0,.245],gold);
  const ribbon=material('#8a3c24');cube(book,[.055,.64,.008],[1.64,-1.71,-.045],ribbon);
  const highlightMat=own(new THREE.MeshBasicMaterial({color:'#d6a248',transparent:true,opacity:0,depthWrite:false}));
  const highlight=new THREE.Mesh(plane,highlightMat);highlight.scale.set(1.71,.30,1);highlight.position.set(1.105,.075,.26);book.add(highlight);
  let target=0,current=0,frame=0,previous=0,visible=true,disposed=false,lowQuality=false,slowFrames=0,renderCount=0;
  const canvas=renderer.domElement;
  const targetLook=new THREE.Vector3();
  function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setPixelRatio(Math.min(devicePixelRatio,lowQuality?1:1.5));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();request();}
  function paint(p:number){
    const pull=smooth(p/.48),open=smooth((p-.43)/.40),focus=smooth((p-.78)/.22),mobile=camera.aspect<.85;
    book.position.set(lerp(-.2,lerp(-1.1,0,open),pull),lerp(1.65,.2,pull),lerp(1.02,3.2,smooth(p/.2))+3.8*smooth((p-.18)/.30));
    book.rotation.set(lerp(0,-.06,pull),lerp(Math.PI/2,-.10,smooth((p-.13)/.35)),lerp(0,-.025,pull));
    hinge.rotation.y=-open*Math.PI*.965;
    const portraitDistance=7+2.65/(2*Math.tan(THREE.MathUtils.degToRad(19))*camera.aspect);
    const fitDistance=mobile?lerp(21,Math.max(14.5,portraitDistance),pull):lerp(19,14.5,pull);
    (scene.fog as THREE.Fog).near=lerp(17,9,pull);
    (scene.fog as THREE.Fog).far=lerp(36,19,pull);
    camera.position.set(lerp(7.8,lerp(1.0,mobile?1.03:.55,focus),pull),lerp(4.0,1.2,pull),fitDistance);
    targetLook.set(lerp(0,mobile?lerp(0,1.00,focus):0,pull),lerp(1.0,.7,pull),lerp(0,6.9,pull));camera.lookAt(targetLook);
    // In portrait, approach the right page after showing the opening spread.
    if(mobile)camera.lookAt(targetLook);
    highlightMat.opacity=focus*.23;
    renderer.render(scene,camera);renderCount++;
    host.dataset.renderCount=String(renderCount);host.dataset.progress=p.toFixed(3);
    onProgress(p);
  }
  function tick(time:number){frame=0;if(disposed||!visible||document.hidden)return;const dt=previous?Math.min(time-previous,70):16;previous=time;current+=(target-current)*(1-Math.exp(-dt/160));if(Math.abs(current-target)<.00015)current=target;
    const start=performance.now();paint(current);const elapsed=performance.now()-start;
    if(elapsed>24)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>12&&!lowQuality){lowQuality=true;renderer.shadowMap.enabled=false;resize();}
    if(current!==target)request();else previous=0;
  }
  function request(){if(!frame&&!disposed&&visible&&!document.hidden)frame=requestAnimationFrame(tick);}
  function lost(e:Event){e.preventDefault();cancelAnimationFrame(frame);frame=0;onFailure();}
  canvas.addEventListener('webglcontextlost',lost);
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;previous=0;}else request();};document.addEventListener('visibilitychange',visibility);
  return {
    setProgress(p:number){target=Math.max(0,Math.min(1,p));request();},
    setVisible(v:boolean){visible=v;if(v)request();else{cancelAnimationFrame(frame);frame=0;previous=0;}},
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',visibility);canvas.removeEventListener('webglcontextlost',lost);for(const r of resources)r.dispose();renderer.dispose();canvas.remove();},
  };
}
