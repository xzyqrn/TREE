import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { UserStats } from "@shared/schema";

interface TreeUser {
  username: string;
  stats: UserStats | null;
}

interface ForestWorldProps {
  users: TreeUser[];
  onSelectUser: (username: string | null) => void;
  selectedUser: string | null;
}

const STATUS_COLORS = {
  active:     { foliage: [0x1a5c20, 0x2d7a30, 0x3a9040, 0x4aa852, 0x6bcb74], trunk: 0x4e342e, ground: 0x3d8b40 },
  moderate:   { foliage: [0x2e7d32, 0x3d9142, 0x4caa52, 0x65c26e, 0x88d48f], trunk: 0x5d4037, ground: 0x4a9e50 },
  occasional: { foliage: [0x4d7c2a, 0x629336, 0x77ab42, 0x90c458, 0xadd878], trunk: 0x6d4c41, ground: 0x7cb342 },
  inactive:   { foliage: [0x7a7a25, 0x969630, 0xaeae38, 0xc6c64a, 0xdede6a], trunk: 0x8d6e63, ground: 0xaaba30 },
};

// Stage used only for color selection & feature unlock thresholds
function getStage(commits: number) {
  if (commits < 100)    return 1;
  if (commits < 1000)   return 2;
  if (commits < 10000)  return 3;
  if (commits < 100000) return 4;
  return 5;
}

// Continuous log-scale 0→1 parameter (0 commits → 0, 1000000+ commits → 1)
function commitT(commits: number): number {
  return Math.min(1, Math.log(1 + commits) / Math.log(1 + 1000000));
}

// Piecewise linear height — each stage band spans a fixed height range
// so differences within a stage are always clearly visible
function getTreeHeight(commits: number): number {
  if (commits < 100)    return 0.50 + (commits / 99)               * 0.80; // 0.50 → 1.30
  if (commits < 1000)   return 1.30 + ((commits - 100)   / 900)    * 1.70; // 1.30 → 3.00
  if (commits < 10000)  return 3.00 + ((commits - 1000)  / 9000)   * 2.00; // 3.00 → 5.00
  if (commits < 100000) return 5.00 + ((commits - 10000) / 90000)  * 0.80; // 5.00 → 5.80
  return 5.80 + Math.min(0.40, Math.log10(commits / 100000) * 0.40);        // 5.80 → 6.20
}

// Deterministic pseudo-random seeded by commit count + index
function rng(seed: number, i: number): number {
  return Math.abs(Math.sin(seed * 127.1 + i * 311.7 + 43758.5)) % 1;
}

function buildTreeMesh(commits: number, status: keyof typeof STATUS_COLORS): THREE.Group {
  const group  = new THREE.Group();
  const stage  = getStage(commits);
  const t      = commitT(commits);
  const s      = commits; // seed
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.inactive;

  const totalH  = getTreeHeight(commits);
  const trunkH  = totalH * (stage >= 4 ? 0.48 : stage >= 3 ? 0.40 : 0.34);
  const trunkR  = 0.055 + t * 0.30;
  // Per-stage canopy width multiplier
  const canopyMults = [0.38, 0.60, 0.88, 1.12, 1.44];
  const canopyR = (0.26 + t * 1.24) * canopyMults[stage - 1];

  const trunkMat    = new THREE.MeshLambertMaterial({ color: colors.trunk });
  const foliageMats = colors.foliage.map(c => new THREE.MeshLambertMaterial({ color: c }));

  // ── Ground moss / soil ring ────────────────────────────────────────────
  const mossGeo = new THREE.RingGeometry(trunkR * 0.85, trunkR * (2.2 + stage * 0.5), 14);
  const mossMat = new THREE.MeshLambertMaterial({ color: colors.ground });
  const moss = new THREE.Mesh(mossGeo, mossMat);
  moss.rotation.x = -Math.PI / 2;
  moss.position.y = 0.01;
  group.add(moss);

  // ── Trunk (tapered, slight organic lean) ──────────────────────────────
  const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.38, trunkR, trunkH, 10);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = trunkH / 2;
  trunk.rotation.z = (rng(s, 0) - 0.5) * 0.06;
  trunk.rotation.x = (rng(s, 1) - 0.5) * 0.06;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // ── Bark ridges along trunk (stage 3+) ────────────────────────────────
  if (stage >= 3) {
    const ridgeN = 4 + stage * 2;
    for (let i = 0; i < ridgeN; i++) {
      const ridgeH = trunkH * (0.45 + rng(s, 100 + i) * 0.45);
      const rGeo   = new THREE.BoxGeometry(trunkR * 0.10, ridgeH, trunkR * 0.06);
      const ridge  = new THREE.Mesh(rGeo, trunkMat);
      const angle  = (i / ridgeN) * Math.PI * 2 + rng(s, 200 + i) * 0.4;
      ridge.position.set(
        Math.cos(angle) * trunkR * 0.90,
        trunkH * 0.45,
        Math.sin(angle) * trunkR * 0.90
      );
      ridge.rotation.y = angle;
      group.add(ridge);
    }
  }

  // ── Root flares (mature = 4, ancient = 6) ─────────────────────────────
  if (stage >= 4) {
    const flareN = stage === 5 ? 6 : 4;
    for (let i = 0; i < flareN; i++) {
      const a  = (i / flareN) * Math.PI * 2 + rng(s, 300 + i) * 0.25;
      const fH = trunkH * (0.26 + rng(s, 400 + i) * 0.12);
      const fGeo = new THREE.CylinderGeometry(trunkR * 0.05, trunkR * 0.46, fH, 4);
      const flare = new THREE.Mesh(fGeo, trunkMat);
      flare.position.set(Math.cos(a) * trunkR * 0.78, fH / 2, Math.sin(a) * trunkR * 0.78);
      flare.rotation.z =  Math.cos(a) * 0.42;
      flare.rotation.x = -Math.sin(a) * 0.42;
      group.add(flare);
    }
  }

  // ── Foliage ────────────────────────────────────────────────────────────
  // Stages 1-2: stacked cones (needle / fir silhouette)
  // Stages 3-5: organic sphere clusters (realistic leaf mass)
  const foliageBase = trunkH * 0.72;
  const foliageSpan = totalH - foliageBase;

  if (stage <= 2) {
    // Narrow stacked cones
    const layerCnt  = stage === 1 ? 1 : 3;
    const coneAspect = stage === 1 ? 2.4 : 1.5;
    const taper      = stage === 1 ? 0.50 : 0.65;
    for (let i = 0; i < layerCnt; i++) {
      const lf = layerCnt === 1 ? 0 : i / (layerCnt - 1);
      const r  = canopyR * (1 - lf * taper);
      const h  = r * coneAspect * 2;
      const y  = foliageBase + lf * foliageSpan;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(r, h, 7),
        foliageMats[i % foliageMats.length]
      );
      cone.position.y = y + h * 0.36;
      cone.rotation.y = rng(s, 500 + i) * Math.PI * 2;
      cone.castShadow = true;
      group.add(cone);
      // Slight offset inner cone for depth on stage 2
      if (stage === 2) {
        const inner = new THREE.Mesh(
          new THREE.ConeGeometry(r * 0.72, h * 0.80, 7),
          foliageMats[(i + 1) % foliageMats.length]
        );
        inner.position.y = y + h * 0.28;
        inner.rotation.y = rng(s, 600 + i) * Math.PI * 2;
        group.add(inner);
      }
    }
  } else {
    // Organic sphere clusters — realistic leaf cloud
    const clusterN = Math.round(8 + t * 22); // 8 → 30 clusters
    const spreadY  = [0, 0, 0.80, 0.68, 0.55][stage - 1]; // how much vertical bias
    for (let i = 0; i < clusterN; i++) {
      const cf       = i / (clusterN - 1 || 1);
      const layerPos = Math.pow(cf, spreadY);           // bias toward base
      const spreadR  = canopyR * (1 - layerPos * [0, 0, 0.76, 0.80, 0.68][stage - 1])
                       * (0.55 + rng(s, 700 + i) * 0.90);
      const angle    = rng(s, 800 + i) * Math.PI * 2;
      const posY     = foliageBase + layerPos * foliageSpan * (0.88 + rng(s, 900 + i) * 0.24);
      const sR       = canopyR * (0.22 + (1 - layerPos) * 0.18) * (0.65 + rng(s, 1000 + i) * 0.70);

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(sR, 5 + stage, 4 + stage),
        foliageMats[i % foliageMats.length]
      );
      sphere.position.set(
        Math.cos(angle) * spreadR,
        posY,
        Math.sin(angle) * spreadR
      );
      // Squash/stretch for organic silhouette
      sphere.scale.y = 0.70 + rng(s, 1100 + i) * 0.55;
      sphere.scale.x = 0.85 + rng(s, 1200 + i) * 0.30;
      sphere.scale.z = 0.85 + rng(s, 1300 + i) * 0.30;
      sphere.castShadow = true;
      group.add(sphere);
    }
  }

  // ── Branches (stage 3+) ────────────────────────────────────────────────
  if (stage >= 3) {
    const branchMat  = new THREE.MeshLambertMaterial({ color: colors.trunk });
    const branchTilt = [0, 0, 0.60, 1.08, 1.40][stage - 1];
    const branchN    = stage === 3 ? 3 : stage === 4 ? Math.round(4 + t * 3) : Math.round(6 + t * 4);

    for (let i = 0; i < branchN; i++) {
      const a    = (i / branchN) * Math.PI * 2 + rng(s, 1400 + i) * 0.5;
      const bLen = trunkH * (0.28 + t * 0.30 + rng(s, 1500 + i) * 0.14);
      const bGeo = new THREE.CylinderGeometry(trunkR * 0.07, trunkR * 0.20, bLen, 6);
      const b    = new THREE.Mesh(bGeo, branchMat);
      const row  = i % 3;
      b.position.set(
        Math.cos(a) * trunkR * 1.35,
        trunkH * (0.26 + row * 0.11 + rng(s, 1600 + i) * 0.06),
        Math.sin(a) * trunkR * 1.35
      );
      b.rotation.z =  Math.cos(a) * branchTilt;
      b.rotation.x = -Math.sin(a) * branchTilt;
      b.castShadow = true;
      group.add(b);

      // Sub-branches on mature / ancient
      if (stage >= 4) {
        const subN = 2 + Math.round(rng(s, 1700 + i) * 2);
        for (let j = 0; j < subN; j++) {
          const sa   = a + (j - 1) * 0.55 + rng(s, 1800 + i * 8 + j) * 0.3;
          const sLen = bLen * (0.35 + rng(s, 1900 + i * 8 + j) * 0.25);
          const sGeo = new THREE.CylinderGeometry(trunkR * 0.035, trunkR * 0.09, sLen, 5);
          const sb   = new THREE.Mesh(sGeo, branchMat);
          sb.position.set(
            Math.cos(a) * trunkR * 1.35 + Math.cos(sa) * bLen * 0.38,
            trunkH * (0.30 + row * 0.11) + rng(s, 2000 + i * 8 + j) * trunkH * 0.08,
            Math.sin(a) * trunkR * 1.35 + Math.sin(sa) * bLen * 0.38
          );
          sb.rotation.z =  Math.cos(sa) * (branchTilt + 0.35);
          sb.rotation.x = -Math.sin(sa) * (branchTilt + 0.35);
          sb.castShadow = true;
          group.add(sb);
        }
      }
    }
  }

  return group;
}

// Vogel spiral positioning for natural forest layout
function getTreePositions(count: number, spacing = 5.5): Array<[number, number]> {
  if (count === 0) return [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return [0, 0] as [number, number];
    const r = spacing * Math.sqrt(i);
    const a = i * golden;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  });
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

export default function ForestWorld({ users, onSelectUser, selectedUser }: ForestWorldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState(false);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef(0);
  const treeGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const treePositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const [nameplates, setNameplates] = useState<Array<{ username: string; x: number; y: number; visible: boolean; commits: number; status: string }>>([]);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Camera state
  const camRef = useRef({
    theta: 0.4, phi: 1.0, radius: 28,
    targetX: 0, targetY: 0, targetZ: 0,
    isDragging: false, prevX: 0, prevY: 0, isRight: false,
    panX: 0, panZ: 0,
  });

  useEffect(() => {
    const handleResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!supportsWebGL()) { setWebglError(true); return; }
    const el = mountRef.current;
    if (!el) return;
    const isDark = document.documentElement.classList.contains("dark");

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDark ? 0x0d1b12 : 0xb8e0c5);
    scene.fog = new THREE.FogExp2(isDark ? 0x0d1b12 : 0xb8e0c5, 0.022);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(55, size.w / size.h, 0.1, 200);
    cameraRef.current = camera;

    // Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setWebglError(true);
      return;
    }
    renderer.setSize(size.w, size.h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;
    el.appendChild(renderer.domElement);

    // Sky hemisphere light
    const hemi = new THREE.HemisphereLight(isDark ? 0x0a2218 : 0x87ceeb, isDark ? 0x0a1a0a : 0x4caf50, isDark ? 0.6 : 0.9);
    scene.add(hemi);

    // Sun directional light
    const sun = new THREE.DirectionalLight(isDark ? 0xfff0c8 : 0xfff8e7, isDark ? 1.2 : 2.0);
    sun.position.set(15, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Fill light
    const fill = new THREE.DirectionalLight(isDark ? 0x1a3a6a : 0x90caf9, isDark ? 0.4 : 0.35);
    fill.position.set(-12, 8, -10);
    scene.add(fill);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(300, 300, 60, 60);
    const groundMat = new THREE.MeshLambertMaterial({ color: isDark ? 0x0d2a12 : 0x4caf50 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Ground detail: subtle grid lines
    const gridHelper = new THREE.GridHelper(300, 60, isDark ? 0x1a3a20 : 0x388e3c, isDark ? 0x1a3a20 : 0x388e3c);
    (gridHelper.material as THREE.Material & { transparent: boolean; opacity: number }).transparent = true;
    (gridHelper.material as THREE.Material & { transparent: boolean; opacity: number }).opacity = isDark ? 0.15 : 0.18;
    scene.add(gridHelper);

    // Center pond
    const pondGeo = new THREE.CircleGeometry(2.5, 32);
    const pondMat = new THREE.MeshLambertMaterial({ color: isDark ? 0x0d2744 : 0x1565c0, transparent: true, opacity: 0.8 });
    const pond = new THREE.Mesh(pondGeo, pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.y = 0.01;
    scene.add(pond);

    const pondRimGeo = new THREE.TorusGeometry(2.55, 0.15, 6, 32);
    const pondRimMat = new THREE.MeshLambertMaterial({ color: isDark ? 0x1a3a50 : 0x0d47a1 });
    const pondRim = new THREE.Mesh(pondRimGeo, pondRimMat);
    pondRim.rotation.x = -Math.PI / 2;
    pondRim.position.y = 0.02;
    scene.add(pondRim);

    // Ambient particles (fireflies / motes)
    const pfCount = 200;
    const pfPos = new Float32Array(pfCount * 3);
    for (let i = 0; i < pfCount; i++) {
      pfPos[i*3]   = (Math.random() - 0.5) * 60;
      pfPos[i*3+1] = 0.3 + Math.random() * 4;
      pfPos[i*3+2] = (Math.random() - 0.5) * 60;
    }
    const pfGeo = new THREE.BufferGeometry();
    pfGeo.setAttribute("position", new THREE.BufferAttribute(pfPos, 3));
    const pfMat = new THREE.PointsMaterial({ color: isDark ? 0x80ff80 : 0xffee58, size: 0.08, transparent: true, opacity: isDark ? 0.9 : 0.6 });
    const particles = new THREE.Points(pfGeo, pfMat);
    scene.add(particles);

    // Build trees
    const positions = getTreePositions(users.length);
    treeGroupsRef.current.clear();
    treePositionsRef.current.clear();

    users.forEach((u, i) => {
      const [x, z] = positions[i];
      // Build tree: use real stats if available, or placeholder seedling
      const commits = u.stats?.totalCommits ?? 5;
      const treeStatus = (u.stats?.status ?? "inactive") as keyof typeof STATUS_COLORS;
      const treeGroup = buildTreeMesh(commits, treeStatus);

      // Ground disc under each tree
      const baseGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.06, 20);
      const baseMat = new THREE.MeshLambertMaterial({ color: (STATUS_COLORS[treeStatus] ?? STATUS_COLORS.inactive).ground });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.03;
      base.receiveShadow = true;
      treeGroup.add(base);

      treeGroup.position.set(x, 0, z);
      treeGroup.userData = { username: u.username, commits: commits };

      // Small offset rotation per tree (natural look)
      treeGroup.rotation.y = Math.random() * Math.PI * 2;

      scene.add(treeGroup);
      treeGroupsRef.current.set(u.username, treeGroup);
      treePositionsRef.current.set(u.username, new THREE.Vector3(x, 0, z));
    });

    // Raycasting for click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onCanvasClick = (e: MouseEvent) => {
      if (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const meshes: THREE.Mesh[] = [];
      treeGroupsRef.current.forEach(group => {
        group.traverse(obj => { if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh); });
      });
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.username) obj = obj.parent;
        if (obj?.userData.username) {
          onSelectUser(obj.userData.username);
        }
      } else {
        onSelectUser(null);
      }
    };

    renderer.domElement.addEventListener("click", onCanvasClick);

    // Camera controls
    const cam = camRef.current;
    const onMouseDown = (e: MouseEvent) => {
      cam.isDragging = true;
      cam.prevX = e.clientX;
      cam.prevY = e.clientY;
      cam.isRight = e.button === 2;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!cam.isDragging) return;
      const dx = e.clientX - cam.prevX;
      const dy = e.clientY - cam.prevY;
      cam.prevX = e.clientX;
      cam.prevY = e.clientY;
      if (cam.isRight) {
        cam.panX -= dx * 0.04;
        cam.panZ -= dy * 0.04;
      } else {
        cam.theta -= dx * 0.008;
        cam.phi = Math.max(0.15, Math.min(1.45, cam.phi + dy * 0.008));
      }
    };
    const onMouseUp = () => { cam.isDragging = false; };
    const onWheel = (e: WheelEvent) => {
      cam.radius = Math.max(5, Math.min(80, cam.radius + e.deltaY * 0.04));
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onTouchStart = (e: TouchEvent) => {
      cam.isDragging = true;
      cam.prevX = e.touches[0].clientX;
      cam.prevY = e.touches[0].clientY;
      cam.isRight = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!cam.isDragging) return;
      const dx = e.touches[0].clientX - cam.prevX;
      const dy = e.touches[0].clientY - cam.prevY;
      cam.prevX = e.touches[0].clientX;
      cam.prevY = e.touches[0].clientY;
      cam.theta -= dx * 0.01;
      cam.phi = Math.max(0.15, Math.min(1.45, cam.phi + dy * 0.01));
    };
    const onTouchEnd = () => { cam.isDragging = false; };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    // Animate
    let t = 0;
    const tmpVec = new THREE.Vector3();
    const screenVec = new THREE.Vector3();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      t += 0.012;

      // Camera orbit
      const cx = cam.panX + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta);
      const cy = cam.radius * Math.cos(cam.phi);
      const cz = cam.panZ + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta);
      camera.position.set(cx, cy, cz);
      camera.lookAt(cam.panX, 0, cam.panZ);

      // Gentle tree sway
      treeGroupsRef.current.forEach((group, username) => {
        const phase = username.charCodeAt(0) * 0.3;
        group.rotation.z = Math.sin(t * 0.5 + phase) * 0.018;
      });

      // Firefly drift
      const pfPositions = particles.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pfCount; i++) {
        pfPositions.array[i*3+1] = 0.3 + 2 * (0.5 + 0.5 * Math.sin(t * 0.4 + i * 0.7));
      }
      pfPositions.needsUpdate = true;

      // Highlight selected tree
      treeGroupsRef.current.forEach((group, username) => {
        const isSelected = username === selectedUser;
        group.traverse(obj => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.material) {
            const mat = mesh.material as THREE.MeshLambertMaterial;
            if (isSelected) {
              mat.emissive = new THREE.Color(0x222200);
              mat.emissiveIntensity = 0.4 + 0.2 * Math.sin(t * 3);
            } else {
              mat.emissive = new THREE.Color(0x000000);
              mat.emissiveIntensity = 0;
            }
          }
        });
      });

      renderer.render(scene, camera);

      // Update HTML nameplates
      const plates: typeof nameplates = [];
      treePositionsRef.current.forEach((pos, username) => {
        const user = users.find(u => u.username === username);
        const h = user?.stats ? getTreeHeight(user.stats.totalCommits) : 1;
        tmpVec.set(pos.x, h + 0.8, pos.z);
        screenVec.copy(tmpVec).project(camera);
        const x = (screenVec.x * 0.5 + 0.5) * size.w;
        const y = (-screenVec.y * 0.5 + 0.5) * size.h;
        const visible = screenVec.z < 1 && x > 0 && x < size.w && y > 0 && y < size.h;
        plates.push({
          username,
          x,
          y,
          visible,
          commits: user?.stats?.totalCommits ?? 0,
          status: user?.stats?.status ?? "inactive",
        });
      });
      setNameplates(plates);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.domElement.removeEventListener("click", onCanvasClick);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [users.map(u => u.username + (u.stats?.totalCommits ?? "?")).join("|"), size.w, size.h]);

  // Handle selectedUser highlight reactively
  useEffect(() => {
    // handled in animate loop
  }, [selectedUser]);

  const statusDot: Record<string, string> = {
    active: "#22c55e", moderate: "#eab308", occasional: "#f97316", inactive: "#9ca3af",
  };

  if (webglError) {
    return (
      <div data-testid="forest-world-fallback" style={{ position: "relative", width: size.w, height: size.h, background: "linear-gradient(to bottom, #0d2818, #1a4a28)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "#fff" }}>
        <div style={{ fontSize: 48 }}>🌲</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>3D Forest requires WebGL</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center", maxWidth: 280 }}>
          Your browser doesn't support WebGL. Try Chrome, Firefox, or Safari with hardware acceleration enabled.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 }}>
          {users.filter(u => u.stats).map(u => (
            <div key={u.username} data-testid={`user-card-${u.username}`} onClick={() => onSelectUser(u.username)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12, padding: "8px 12px", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <img src={u.stats!.avatar_url} style={{ width: 24, height: 24, borderRadius: "50%" }} alt={u.username} />
              @{u.username}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: size.w, height: size.h, overflow: "hidden" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Nameplates */}
      {nameplates.filter(p => p.visible).map(p => (
        <div
          key={p.username}
          onClick={() => onSelectUser(p.username)}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            transform: "translate(-50%, -100%)",
            pointerEvents: "auto",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div
            style={{
              background: p.username === selectedUser
                ? "rgba(255,255,200,0.96)"
                : "rgba(0,0,0,0.72)",
              color: p.username === selectedUser ? "#1a1a00" : "#ffffff",
              border: p.username === selectedUser ? "1.5px solid #ffd700" : "1px solid rgba(255,255,255,0.2)",
              borderRadius: 20,
              padding: "3px 10px 3px 7px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "monospace",
              display: "flex",
              alignItems: "center",
              gap: 5,
              backdropFilter: "blur(6px)",
              boxShadow: p.username === selectedUser ? "0 0 12px rgba(255,215,0,0.6)" : "0 2px 8px rgba(0,0,0,0.4)",
              whiteSpace: "nowrap",
              transition: "all 0.2s",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusDot[p.status] ?? "#888", flexShrink: 0, display: "inline-block" }} />
            @{p.username}
          </div>
          <div style={{ width: 1, height: 8, background: "rgba(255,255,255,0.3)", margin: "0 auto" }} />
        </div>
      ))}
    </div>
  );
}
