import { useEffect, useRef } from "react";
import * as THREE from "three";

interface GitTree3DProps {
  commits: number;
  status: "active" | "moderate" | "occasional" | "inactive";
  width?: number;
  height?: number;
}

function getStage(commits: number) {
  if (commits < 20) return 1;
  if (commits < 80) return 2;
  if (commits < 200) return 3;
  if (commits < 500) return 4;
  return 5;
}

const STATUS_COLORS = {
  active: {
    foliage: [0x1b5e20, 0x2e7d32, 0x388e3c, 0x43a047, 0x66bb6a, 0x81c784],
    trunk: 0x4e342e,
    ground: 0x388e3c,
    groundRing: 0x2e7d32,
    ambient: 0x90ee90,
    sky: 0xdcedc8,
  },
  moderate: {
    foliage: [0x2e7d32, 0x388e3c, 0x43a047, 0x66bb6a, 0x81c784, 0xa5d6a7],
    trunk: 0x5d4037,
    ground: 0x43a047,
    groundRing: 0x388e3c,
    ambient: 0xa5d6a7,
    sky: 0xe8f5e9,
  },
  occasional: {
    foliage: [0x558b2f, 0x689f38, 0x7cb342, 0x8bc34a, 0xaed581, 0xc5e1a5],
    trunk: 0x6d4c41,
    ground: 0x7cb342,
    groundRing: 0x689f38,
    ambient: 0xc5e1a5,
    sky: 0xf1f8e9,
  },
  inactive: {
    foliage: [0x827717, 0x9e9d24, 0xafb42b, 0xc0ca33, 0xd4e157, 0xe6ee9c],
    trunk: 0x8d6e63,
    ground: 0xafb42b,
    groundRing: 0x9e9d24,
    ambient: 0xe6ee9c,
    sky: 0xf9fbe7,
  },
};

function buildTree(scene: THREE.Scene, commits: number, status: keyof typeof STATUS_COLORS) {
  const stage = getStage(commits);
  const colors = STATUS_COLORS[status];

  // Materials
  const trunkMat = new THREE.MeshLambertMaterial({ color: colors.trunk });
  const foliageMats = colors.foliage.map(c => new THREE.MeshLambertMaterial({ color: c }));

  // Ground disc
  const groundGeo = new THREE.CylinderGeometry(1.8, 1.8, 0.08, 32);
  const groundMat = new THREE.MeshLambertMaterial({ color: colors.ground });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.04;
  ground.receiveShadow = true;
  scene.add(ground);

  // Ground ring (darker)
  const ringGeo = new THREE.TorusGeometry(1.8, 0.12, 8, 32);
  const ringMat = new THREE.MeshLambertMaterial({ color: colors.groundRing });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);

  // Tree parameters per stage
  const configs = [
    // stage 1 - seedling
    { trunkH: 0.5, trunkR: 0.07, layers: [{ y: 0.45, r: 0.45, h: 0.6 }] },
    // stage 2 - sapling
    { trunkH: 0.9, trunkR: 0.1, layers: [
      { y: 0.75, r: 0.65, h: 0.75 },
      { y: 1.0, r: 0.45, h: 0.6 },
    ]},
    // stage 3 - young tree
    { trunkH: 1.4, trunkR: 0.15, layers: [
      { y: 1.1, r: 0.85, h: 0.9 },
      { y: 1.55, r: 0.65, h: 0.8 },
      { y: 1.95, r: 0.42, h: 0.65 },
    ]},
    // stage 4 - mature tree
    { trunkH: 2.0, trunkR: 0.22, layers: [
      { y: 1.55, r: 1.1, h: 1.0 },
      { y: 2.1, r: 0.88, h: 0.9 },
      { y: 2.6, r: 0.65, h: 0.8 },
      { y: 3.05, r: 0.42, h: 0.65 },
      { y: 3.42, r: 0.26, h: 0.5 },
    ]},
    // stage 5 - ancient tree
    { trunkH: 2.7, trunkR: 0.32, layers: [
      { y: 2.0, r: 1.35, h: 1.1 },
      { y: 2.65, r: 1.1, h: 1.0 },
      { y: 3.2, r: 0.88, h: 0.9 },
      { y: 3.7, r: 0.65, h: 0.8 },
      { y: 4.15, r: 0.46, h: 0.7 },
      { y: 4.55, r: 0.3, h: 0.55 },
      { y: 4.88, r: 0.18, h: 0.42 },
    ]},
  ];

  const cfg = configs[stage - 1];

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(cfg.trunkR * 0.6, cfg.trunkR, cfg.trunkH, 8);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = cfg.trunkH / 2;
  trunk.castShadow = true;
  scene.add(trunk);

  // Foliage cones
  cfg.layers.forEach((layer, i) => {
    const mat = foliageMats[i % foliageMats.length];
    // Main cone
    const coneGeo = new THREE.ConeGeometry(layer.r, layer.h, 8);
    const cone = new THREE.Mesh(coneGeo, mat);
    cone.position.y = layer.y + layer.h / 2;
    cone.castShadow = true;
    scene.add(cone);

    // Slightly darker shadow cone behind
    if (stage >= 3) {
      const shadowMat = new THREE.MeshLambertMaterial({
        color: colors.foliage[(i + 1) % colors.foliage.length],
        transparent: true,
        opacity: 0.7,
      });
      const shadowCone = new THREE.Mesh(
        new THREE.ConeGeometry(layer.r * 0.85, layer.h * 0.9, 8),
        shadowMat
      );
      shadowCone.position.y = layer.y + layer.h / 2 - 0.05;
      shadowCone.rotation.y = Math.PI / 8;
      scene.add(shadowCone);
    }
  });

  // Branches for mature/ancient trees
  if (stage >= 4) {
    const branchMat = new THREE.MeshLambertMaterial({ color: colors.trunk });
    const branchCount = stage === 5 ? 6 : 4;
    for (let i = 0; i < branchCount; i++) {
      const angle = (i / branchCount) * Math.PI * 2;
      const branchH = cfg.trunkH * 0.5;
      const branchY = cfg.trunkH * 0.4 + (i / branchCount) * cfg.trunkH * 0.35;

      const branchGeo = new THREE.CylinderGeometry(0.025, 0.055, branchH, 5);
      const branch = new THREE.Mesh(branchGeo, branchMat);
      branch.position.set(
        Math.cos(angle) * cfg.trunkR * 2,
        branchY,
        Math.sin(angle) * cfg.trunkR * 2
      );
      branch.rotation.z = Math.PI / 2 - 0.4;
      branch.rotation.y = angle;
      branch.castShadow = true;
      scene.add(branch);
    }
  }

  // Sparkle particles for ancient trees
  if (stage === 5) {
    const particleCount = 60;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = 0.8 + Math.random() * 1.2;
      const yCenter = 2.5 + Math.random() * 2.5;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = yCenter + r * Math.cos(phi) * 0.5;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xffd54f,
      size: 0.06,
      transparent: true,
      opacity: 0.85,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);
  }
}

export default function GitTree3D({ commits, status, width = 260, height = 280 }: GitTree3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const isDarkRef = useRef(false);

  useEffect(() => {
    isDarkRef.current = document.documentElement.classList.contains("dark");
    const el = mountRef.current;
    if (!el) return;

    const colors = STATUS_COLORS[status];
    const isDark = isDarkRef.current;
    const bgColor = isDark ? 0x1a1a1a : parseInt(colors.sky.toString());

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgColor);
    scene.fog = new THREE.Fog(bgColor, 12, 30);

    // Camera
    const stage = getStage(commits);
    const cameraY = 0.8 + stage * 0.5;
    const cameraZ = 3.5 + stage * 0.6;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, cameraY, cameraZ);
    camera.lookAt(0, cameraY * 0.6, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    el.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(isDark ? 0x444444 : 0x888888, isDark ? 1.2 : 1.0);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8e1, isDark ? 1.5 : 1.8);
    dirLight.position.set(3, 6, 4);
    dirLight.castShadow = true;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 20;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -2;
    dirLight.shadow.mapSize.set(1024, 1024);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(isDark ? 0x1a237e : 0xb3e5fc, isDark ? 0.5 : 0.4);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    // Build the tree
    buildTree(scene, commits, status);

    // Group for rotation
    const group = new THREE.Group();
    scene.children.slice(3).forEach(child => {
      scene.remove(child);
      group.add(child);
    });
    scene.add(group);

    // Mouse drag interaction
    let isDragging = false;
    let prevMouseX = 0;
    let autoRotateSpeed = 0.006;
    let userRotation = 0;

    const onMouseDown = (e: MouseEvent) => { isDragging = true; prevMouseX = e.clientX; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      userRotation += dx * 0.01;
      group.rotation.y = userRotation;
      prevMouseX = e.clientX;
    };
    const onMouseUp = () => { isDragging = false; };
    const onTouchStart = (e: TouchEvent) => { isDragging = true; prevMouseX = e.touches[0].clientX; };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      const dx = e.touches[0].clientX - prevMouseX;
      userRotation += dx * 0.01;
      group.rotation.y = userRotation;
      prevMouseX = e.touches[0].clientX;
    };
    const onTouchEnd = () => { isDragging = false; };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    renderer.domElement.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);

    // Animation loop
    let t = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      t += 0.01;

      if (!isDragging) {
        userRotation += autoRotateSpeed;
        group.rotation.y = userRotation;
      }

      // Subtle tree sway
      group.rotation.z = Math.sin(t * 0.5) * 0.015;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      renderer.dispose();
      if (el.contains(renderer.domElement)) {
        el.removeChild(renderer.domElement);
      }
    };
  }, [commits, status, width, height]);

  return (
    <div
      ref={mountRef}
      style={{ width, height, borderRadius: "0.75rem", overflow: "hidden", cursor: "grab" }}
      title="Drag to rotate"
    />
  );
}
