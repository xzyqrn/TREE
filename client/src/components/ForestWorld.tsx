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
  onNearbyUsers?: (usernames: string[]) => void;
}

// ─── RNG ─────────────────────────────────────────────────────────────────────
function rng(seed: number, i: number): number {
  return Math.abs(Math.sin(seed * 127.1 + i * 311.7 + 43758.5453)) % 1;
}
function rngRange(seed: number, i: number, lo: number, hi: number): number {
  return lo + rng(seed, i) * (hi - lo);
}

// ─── TREE STAGING ─────────────────────────────────────────────────────────────
function getStage(commits: number): 1 | 2 | 3 | 4 | 5 {
  if (commits < 50)     return 1; // seedling/sprout
  if (commits < 500)    return 2; // sapling
  if (commits < 5000)   return 3; // young tree
  if (commits < 50000)  return 4; // mature tree
  return 5;                        // ancient/giant
}

function getTreeHeight(commits: number): number {
  if (commits < 50)    return 0.3 + (commits / 49)              * 0.5;
  if (commits < 500)   return 0.8 + ((commits - 50)   / 450)   * 1.8;
  if (commits < 5000)  return 2.6 + ((commits - 500)  / 4500)  * 3.4;
  if (commits < 50000) return 6.0 + ((commits - 5000) / 45000) * 3.5;
  return 9.5 + Math.min(2.5, Math.log10(commits / 50000) * 2.5);
}

function commitT(commits: number): number {
  return Math.min(1, Math.log(1 + commits) / Math.log(1 + 200000));
}

// ─── ACTIVITY PALETTE ─────────────────────────────────────────────────────────
const PALETTE = {
  active:     { bark: [0x3b2106, 0x4e2e0d, 0x5c3511], leaf: [0x1b5e20, 0x2e7d32, 0x388e3c, 0x43a047, 0x1a6b0a], needle: [0x1b4520, 0x2d5e2a, 0x366132], duff: 0x2d5a1b },
  moderate:   { bark: [0x4a3010, 0x5d3e18, 0x6b4820], leaf: [0x2e7d32, 0x388e3c, 0x4caf50, 0x66bb6a, 0x81c784], needle: [0x27542b, 0x365e33, 0x3d6b38], duff: 0x406b28 },
  occasional: { bark: [0x5d4422, 0x6d5030, 0x7a5c38], leaf: [0x558b2f, 0x689f38, 0x7cb342, 0x9ccc65, 0xaed581], needle: [0x3d5c20, 0x4d6e2a, 0x5a7a32], duff: 0x607040 },
  inactive:   { bark: [0x795548, 0x8d6e63, 0xa1887f], leaf: [0x827717, 0x9e9d24, 0xafb42b, 0xc6c944, 0xdce775], needle: [0x5a5a10, 0x6b6b18, 0x7a7a22], duff: 0x7a7a30 },
};

function getPalette(status: string) {
  return (PALETTE as any)[status] ?? PALETTE.inactive;
}

// ─── GEOMETRY HELPERS ─────────────────────────────────────────────────────────

function makeMat(color: number | THREE.Color, roughOffset = 0): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function varyColor(hex: number, s: number, i: number): THREE.Color {
  return new THREE.Color(hex).offsetHSL(
    rngRange(s, i,     -0.03,  0.03),
    rngRange(s, i + 1, -0.08,  0.08),
    rngRange(s, i + 2, -0.07,  0.07),
  );
}

// Build a tapered trunk from stacked cylinder segments with organic offsets
function buildTrunk(
  trunkH: number, baseR: number, tipR: number,
  barkHexes: number[], s: number
): THREE.Group {
  const g = new THREE.Group();
  const segs = Math.max(4, Math.round(trunkH / 0.6));
  const segH = trunkH / segs;

  for (let i = 0; i < segs; i++) {
    const frac = i / segs;
    const r0 = baseR * (1 - frac) + tipR * frac;
    const r1 = baseR * (1 - (frac + 1 / segs)) + tipR * (frac + 1 / segs);
    const barkHex = barkHexes[Math.floor(frac * barkHexes.length)];
    const col = varyColor(barkHex, s, 500 + i * 3);
    const mat = makeMat(col);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(r1, tipR * 0.5), r0, segH * 1.02, 7, 1),
      mat
    );
    mesh.position.set(
      rngRange(s, 600 + i, -0.5, 0.5) * baseR * 0.15,
      i * segH + segH / 2,
      rngRange(s, 700 + i, -0.5, 0.5) * baseR * 0.15,
    );
    mesh.rotation.z = rngRange(s, 800 + i, -1, 1) * 0.025;
    mesh.rotation.x = rngRange(s, 900 + i, -1, 1) * 0.025;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// Root buttresses — wedge fins at the base
function buildRoots(baseR: number, count: number, mat: THREE.MeshLambertMaterial, s: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rngRange(s, 1000 + i, -0.4, 0.4);
    const fH = baseR * rngRange(s, 1100 + i, 1.2, 2.0);
    const fW = baseR * rngRange(s, 1200 + i, 0.4, 0.7);
    const fin = new THREE.Mesh(
      new THREE.CylinderGeometry(baseR * 0.03, fW, fH, 4),
      mat
    );
    fin.position.set(Math.cos(a) * baseR * 0.75, fH / 2, Math.sin(a) * baseR * 0.75);
    fin.rotation.z =  Math.cos(a) * 0.42;
    fin.rotation.x = -Math.sin(a) * 0.42;
    fin.castShadow = true;
    g.add(fin);
  }
  return g;
}

// Foliage blob cluster
function buildLeafCloud(
  cx: number, cy: number, cz: number,
  radius: number, leafHexes: number[], s: number, idx: number
): THREE.Group {
  const g = new THREE.Group();
  const blobs = 4 + Math.floor(rng(s, 2000 + idx) * 4);
  for (let i = 0; i < blobs; i++) {
    const r    = radius * rngRange(s, 2100 + idx * 7 + i, 0.45, 0.90);
    const ox   = rngRange(s, 2200 + idx * 7 + i, -1, 1) * radius * 0.75;
    const oy   = rngRange(s, 2300 + idx * 7 + i, -0.4, 0.6) * radius * 0.6;
    const oz   = rngRange(s, 2400 + idx * 7 + i, -1, 1) * radius * 0.75;
    const hex  = leafHexes[i % leafHexes.length];
    const col  = varyColor(hex, s, 2500 + idx * 7 + i);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 6, 5),
      makeMat(col)
    );
    mesh.position.set(cx + ox, cy + oy, cz + oz);
    mesh.scale.y = rngRange(s, 2600 + idx * 7 + i, 0.65, 1.0);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

// Conifer cone layer
function buildConeLayer(
  y: number, r: number, h: number, needleHexes: number[],
  segments: number, s: number, idx: number
): THREE.Group {
  const g = new THREE.Group();
  const hex = needleHexes[idx % needleHexes.length];
  const col = varyColor(hex, s, 3000 + idx * 3);
  const outer = new THREE.Mesh(new THREE.ConeGeometry(r, h, segments, 1), makeMat(col));
  outer.position.y = y + h * 0.42;
  outer.rotation.y = rng(s, 3100 + idx) * Math.PI * 2;
  outer.castShadow = true;
  g.add(outer);
  // inner darker volume for depth
  const col2 = varyColor(needleHexes[0], s, 3200 + idx * 3);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.68, h * 0.85, segments, 1), makeMat(col2));
  inner.position.y = y + h * 0.34;
  inner.rotation.y = outer.rotation.y + 0.55;
  g.add(inner);
  return g;
}

// ─── TREE BUILDER ─────────────────────────────────────────────────────────────
function buildTreeMesh(commits: number, status: string): THREE.Group {
  const group = new THREE.Group();
  const stage = getStage(commits);
  const t     = commitT(commits);
  const s     = commits;
  const pal   = getPalette(status);

  const totalH = getTreeHeight(commits);
  const trunkFrac = [0.25, 0.30, 0.35, 0.48, 0.55][stage - 1];
  const trunkH = totalH * trunkFrac;
  const baseR  = 0.035 + t * 0.28;
  const tipR   = baseR * 0.12;

  const barkMat = makeMat(varyColor(pal.bark[0], s, 0));
  const duffMat = makeMat(varyColor(pal.duff, s, 10));

  // ── STAGE 1: seedling / tiny sprout ──────────────────────────────────────
  if (stage === 1) {
    // Single skinny stalk
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(baseR * 0.3, baseR * 0.5, totalH * 0.6, 5),
      makeMat(varyColor(pal.bark[1], s, 20))
    );
    stalk.position.y = totalH * 0.3;
    stalk.castShadow = true;
    group.add(stalk);

    // 2-3 tiny leaf tufts
    const leafCount = 2 + Math.floor(rng(s, 30) * 2);
    for (let i = 0; i < leafCount; i++) {
      const a   = (i / leafCount) * Math.PI * 2;
      const lR  = 0.10 + rng(s, 40 + i) * 0.12;
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(lR, 5, 4),
        makeMat(varyColor(pal.leaf[i % pal.leaf.length], s, 50 + i))
      );
      leaf.position.set(
        Math.cos(a) * 0.09,
        totalH * 0.55 + rngRange(s, 60 + i, -0.05, 0.1),
        Math.sin(a) * 0.09
      );
      leaf.scale.y = 0.7;
      leaf.castShadow = true;
      group.add(leaf);
    }
    // Tiny moss patch
    const moss = new THREE.Mesh(new THREE.CircleGeometry(baseR * 3, 10), duffMat);
    moss.rotation.x = -Math.PI / 2;
    moss.position.y = 0.005;
    group.add(moss);
    return group;
  }

  // ── STAGE 2: sapling ─────────────────────────────────────────────────────
  if (stage === 2) {
    // Thin single-piece trunk
    const trunk = buildTrunk(trunkH, baseR, tipR * 2, pal.bark, s);
    group.add(trunk);

    // Ground duff ring
    const duff = new THREE.Mesh(new THREE.CircleGeometry(baseR * 4, 12), duffMat);
    duff.rotation.x = -Math.PI / 2;
    duff.position.y = 0.005;
    group.add(duff);

    // Sapling — slender conifer style with 2 cone layers
    const clusterR = 0.18 + t * 0.35;
    for (let i = 0; i < 2; i++) {
      const lf = i / 1;
      const r  = clusterR * (1 - lf * 0.45);
      const h  = r * 2.8;
      const y  = trunkH * 0.7 + lf * (totalH - trunkH * 0.7);
      const cg = buildConeLayer(y, r, h, pal.needle, 6, s, i);
      group.add(cg);
    }
    return group;
  }

  // ── STAGE 3: young tree ───────────────────────────────────────────────────
  if (stage === 3) {
    const trunk = buildTrunk(trunkH, baseR, tipR, pal.bark, s);
    group.add(trunk);

    const rootCount = 3;
    const rootMat = makeMat(varyColor(pal.bark[0], s, 1));
    group.add(buildRoots(baseR, rootCount, rootMat, s));

    const duff = new THREE.Mesh(new THREE.CircleGeometry(baseR * 5, 14), duffMat);
    duff.rotation.x = -Math.PI / 2;
    duff.position.y = 0.005;
    group.add(duff);

    // Multi-layer conifer — 4 layers
    const clusterR = 0.35 + t * 0.55;
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const lf = i / (layers - 1);
      const r  = clusterR * (1 - lf * 0.55);
      const h  = r * 2.4;
      const y  = trunkH * 0.6 + lf * (totalH - trunkH * 0.6);
      const cg = buildConeLayer(y, r, h, pal.needle, 7, s, i);
      group.add(cg);

      // Side branch stubs at each layer
      for (let bi = 0; bi < 4; bi++) {
        const ba  = (bi / 4) * Math.PI * 2 + rng(s, 4000 + i * 4 + bi) * 0.8;
        const bL  = r * rngRange(s, 4100 + i * 4 + bi, 0.5, 0.9);
        const brn = new THREE.Mesh(
          new THREE.CylinderGeometry(baseR * 0.03, baseR * 0.09, bL, 5),
          makeMat(varyColor(pal.bark[1], s, 4200 + i * 4 + bi))
        );
        brn.position.set(Math.cos(ba) * baseR, y + h * 0.05, Math.sin(ba) * baseR);
        brn.rotation.z =  Math.cos(ba) * 0.82;
        brn.rotation.x = -Math.sin(ba) * 0.82;
        brn.castShadow = true;
        group.add(brn);
      }
    }
    return group;
  }

  // ── STAGE 4: mature deciduous ─────────────────────────────────────────────
  if (stage === 4) {
    const trunk = buildTrunk(trunkH, baseR, tipR, pal.bark, s);
    group.add(trunk);
    const rootMat = makeMat(varyColor(pal.bark[0], s, 1));
    group.add(buildRoots(baseR, 5, rootMat, s));

    const duff = new THREE.Mesh(new THREE.CircleGeometry(baseR * 6.5, 16), duffMat);
    duff.rotation.x = -Math.PI / 2;
    duff.position.y = 0.005;
    group.add(duff);

    const branchMat = makeMat(varyColor(pal.bark[1], s, 2));
    const mainBranches = 6 + Math.floor(rng(s, 5000) * 3);
    const canopyR = 0.65 + t * 1.1;

    for (let i = 0; i < mainBranches; i++) {
      const a       = (i / mainBranches) * Math.PI * 2 + rngRange(s, 5100 + i, -0.5, 0.5);
      const bLen    = trunkH * rngRange(s, 5200 + i, 0.42, 0.72);
      const bTilt   = rngRange(s, 5300 + i, 0.7, 1.1);
      const hFrac   = rngRange(s, 5400 + i, 0.55, 0.85);
      const brnMain = new THREE.Mesh(
        new THREE.CylinderGeometry(baseR * 0.05, baseR * 0.20, bLen, 6),
        branchMat
      );
      brnMain.position.set(Math.cos(a) * baseR, trunkH * hFrac, Math.sin(a) * baseR);
      brnMain.rotation.z =  Math.cos(a) * bTilt;
      brnMain.rotation.x = -Math.sin(a) * bTilt;
      brnMain.castShadow = true;
      group.add(brnMain);

      const endX = Math.cos(a) * (baseR + Math.sin(bTilt) * bLen * 0.55);
      const endY = trunkH * hFrac + Math.cos(bTilt) * bLen * 0.55;
      const endZ = Math.sin(a) * (baseR + Math.sin(bTilt) * bLen * 0.55);

      // 2-3 secondary branches
      const secN = 2 + Math.floor(rng(s, 5500 + i) * 2);
      for (let si = 0; si < secN; si++) {
        const sa  = a + rngRange(s, 5600 + i * 3 + si, -0.8, 0.8);
        const sL  = bLen * rngRange(s, 5700 + i * 3 + si, 0.28, 0.48);
        const sTi = bTilt + rngRange(s, 5800 + i * 3 + si, 0.1, 0.4);
        const sec = new THREE.Mesh(
          new THREE.CylinderGeometry(baseR * 0.02, baseR * 0.07, sL, 5),
          branchMat
        );
        sec.position.set(
          endX * rngRange(s, 5900 + i * 3 + si, 0.4, 0.8),
          endY + rngRange(s, 6000 + i * 3 + si, -0.15, 0.15) * trunkH * 0.05,
          endZ * rngRange(s, 6100 + i * 3 + si, 0.4, 0.8),
        );
        sec.rotation.z =  Math.cos(sa) * sTi;
        sec.rotation.x = -Math.sin(sa) * sTi;
        sec.castShadow = true;
        group.add(sec);
      }

      // Leaf cluster at branch end
      const clR = canopyR * rngRange(s, 6200 + i, 0.28, 0.50);
      group.add(buildLeafCloud(endX, endY, endZ, clR, pal.leaf, s, i));
    }

    // Central crown
    const cY = totalH * 0.82;
    const crownR = canopyR * 0.65;
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(crownR, 8, 6),
      makeMat(varyColor(pal.leaf[0], s, 10))
    );
    center.position.y = cY;
    center.scale.y = 0.78;
    center.castShadow = true;
    group.add(center);

    for (let i = 0; i < 6; i++) {
      const a  = (i / 6) * Math.PI * 2 + rng(s, 6300 + i) * 0.6;
      const d  = crownR * rngRange(s, 6400 + i, 0.35, 0.65);
      const sr = crownR * rngRange(s, 6500 + i, 0.45, 0.72);
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(sr, 7, 5),
        makeMat(varyColor(pal.leaf[(i + 1) % pal.leaf.length], s, 6600 + i))
      );
      sp.position.set(Math.cos(a) * d, cY - crownR * rngRange(s, 6700 + i, 0.1, 0.4), Math.sin(a) * d);
      sp.scale.y = rngRange(s, 6800 + i, 0.62, 0.88);
      sp.castShadow = true;
      group.add(sp);
    }
    return group;
  }

  // ── STAGE 5: ancient / giant ──────────────────────────────────────────────
  {
    const trunk = buildTrunk(trunkH, baseR, tipR, pal.bark, s);
    group.add(trunk);
    const rootMat = makeMat(varyColor(pal.bark[0], s, 1));
    group.add(buildRoots(baseR, 7, rootMat, s));

    const duff = new THREE.Mesh(new THREE.CircleGeometry(baseR * 9, 20), duffMat);
    duff.rotation.x = -Math.PI / 2;
    duff.position.y = 0.005;
    group.add(duff);

    const branchMat = makeMat(varyColor(pal.bark[1], s, 2));
    const mainBranches = 8 + Math.floor(rng(s, 7000) * 4);
    const canopyR = 1.1 + t * 1.6;

    for (let i = 0; i < mainBranches; i++) {
      const a     = (i / mainBranches) * Math.PI * 2 + rngRange(s, 7100 + i, -0.45, 0.45);
      const bLen  = trunkH * rngRange(s, 7200 + i, 0.50, 0.90);
      const bTilt = rngRange(s, 7300 + i, 0.65, 1.15);
      const hFrac = rngRange(s, 7400 + i, 0.42, 0.80);
      const brnMain = new THREE.Mesh(
        new THREE.CylinderGeometry(baseR * 0.06, baseR * 0.26, bLen, 7),
        branchMat
      );
      brnMain.position.set(Math.cos(a) * baseR * 1.1, trunkH * hFrac, Math.sin(a) * baseR * 1.1);
      brnMain.rotation.z =  Math.cos(a) * bTilt;
      brnMain.rotation.x = -Math.sin(a) * bTilt;
      brnMain.castShadow = true;
      group.add(brnMain);

      const endX = Math.cos(a) * (baseR * 1.1 + Math.sin(bTilt) * bLen * 0.55);
      const endY = trunkH * hFrac + Math.cos(bTilt) * bLen * 0.55;
      const endZ = Math.sin(a) * (baseR * 1.1 + Math.sin(bTilt) * bLen * 0.55);

      const secN = 2 + Math.floor(rng(s, 7500 + i) * 3);
      for (let si = 0; si < secN; si++) {
        const sa  = a + rngRange(s, 7600 + i * 3 + si, -1.0, 1.0);
        const sL  = bLen * rngRange(s, 7700 + i * 3 + si, 0.30, 0.52);
        const sTi = bTilt + rngRange(s, 7800 + i * 3 + si, 0.1, 0.5);
        const sec = new THREE.Mesh(
          new THREE.CylinderGeometry(baseR * 0.025, baseR * 0.09, sL, 5),
          branchMat
        );
        sec.position.set(
          endX * rngRange(s, 7900 + i * 3 + si, 0.35, 0.75),
          endY + rngRange(s, 8000 + i * 3 + si, -0.2, 0.2) * trunkH * 0.06,
          endZ * rngRange(s, 8100 + i * 3 + si, 0.35, 0.75),
        );
        sec.rotation.z =  Math.cos(sa) * sTi;
        sec.rotation.x = -Math.sin(sa) * sTi;
        sec.castShadow = true;
        group.add(sec);
      }

      const clR = canopyR * rngRange(s, 8200 + i, 0.30, 0.55);
      group.add(buildLeafCloud(endX, endY, endZ, clR, pal.leaf, s, i + 50));
    }

    // Massive spreading crown
    const cY = totalH * 0.80;
    const crownR = canopyR * 0.75;
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(crownR, 9, 7),
      makeMat(varyColor(pal.leaf[0], s, 10))
    );
    center.position.y = cY;
    center.scale.y = 0.72;
    center.castShadow = true;
    group.add(center);

    for (let i = 0; i < 9; i++) {
      const a  = (i / 9) * Math.PI * 2 + rng(s, 8300 + i) * 0.5;
      const d  = crownR * rngRange(s, 8400 + i, 0.38, 0.75);
      const sr = crownR * rngRange(s, 8500 + i, 0.50, 0.80);
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(sr, 7, 6),
        makeMat(varyColor(pal.leaf[(i + 2) % pal.leaf.length], s, 8600 + i))
      );
      sp.position.set(Math.cos(a) * d, cY - crownR * rngRange(s, 8700 + i, 0.08, 0.38), Math.sin(a) * d);
      sp.scale.y = rngRange(s, 8800 + i, 0.60, 0.85);
      sp.castShadow = true;
      group.add(sp);
    }
    return group;
  }
}

// ─── FOREST LAYOUT ────────────────────────────────────────────────────────────
// Natural forest clustering: groups of trees with varied spacing (4-7 units apart)
function getForestPositions(count: number): Array<[number, number]> {
  if (count === 0) return [];

  const positions: Array<[number, number]> = [];
  const MIN_DIST = 3.5; // minimum spacing between trees

  // First tree at origin area with small jitter
  positions.push([rngRange(1, 0, -1.0, 1.0), rngRange(1, 1, -1.0, 1.0)]);

  // Build clusters organically
  const MAX_ATTEMPTS = 40;
  for (let i = 1; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Choose a random existing tree to cluster near (weighted toward recent ones for natural spread)
      const parentIdx = Math.floor(rng(i * 7 + attempt, i * 3) * Math.min(i, 12));
      const parent = positions[parentIdx];

      // Random direction and natural forest spacing (3.5 to 8 units)
      const angle = rng(i * 13 + attempt, i * 5) * Math.PI * 2;
      const dist  = 4.0 + rng(i * 11 + attempt, i * 7) * 4.5;
      const nx    = parent[0] + Math.cos(angle) * dist + rngRange(i * 9 + attempt, i * 11, -0.8, 0.8);
      const nz    = parent[1] + Math.sin(angle) * dist + rngRange(i * 7 + attempt, i * 13, -0.8, 0.8);

      // Check minimum distance from all existing trees
      let ok = true;
      for (const p of positions) {
        if (Math.hypot(p[0] - nx, p[1] - nz) < MIN_DIST) { ok = false; break; }
      }
      if (ok) {
        positions.push([nx, nz]);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Fallback: place in expanding spiral
      const r = MIN_DIST * Math.sqrt(i) * 0.7;
      const a = i * 2.618;
      positions.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return positions;
}

// ─── GROUND DETAILS ───────────────────────────────────────────────────────────
function buildBush(s: number): THREE.Group {
  const g = new THREE.Group();
  const count = 3 + Math.floor(rng(s, 0) * 4);
  const baseHex = [0x1a4a0d, 0x246612, 0x2d7a18, 0x195c0c][Math.floor(rng(s, 99) * 4)];
  const col = varyColor(baseHex, s, 1);
  const mat = makeMat(col);
  for (let i = 0; i < count; i++) {
    const r  = 0.14 + rng(s, 10 + i) * 0.22;
    const ox = rngRange(s, 20 + i, -0.28, 0.28);
    const oz = rngRange(s, 30 + i, -0.28, 0.28);
    const m  = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat);
    m.position.set(ox, r * 0.55, oz);
    m.scale.y = rngRange(s, 40 + i, 0.60, 0.90);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function buildRock(s: number): THREE.Group {
  const g = new THREE.Group();
  const count = 1 + Math.floor(rng(s, 0) * 3);
  for (let i = 0; i < count; i++) {
    const rx  = rngRange(s, 5 + i, 0.09, 0.26);
    const ry  = rngRange(s, 6 + i, 0.06, 0.16);
    const rz  = rngRange(s, 7 + i, 0.09, 0.22);
    const col = varyColor(0x6a6050, s, 8 + i);
    const m   = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), makeMat(col));
    m.position.set(rngRange(s, 10 + i, -0.25, 0.25), ry, rngRange(s, 11 + i, -0.25, 0.25));
    m.scale.set(rx / 0.12, ry / 0.12, rz / 0.12);
    m.rotation.y = rng(s, 12 + i) * Math.PI * 2;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function buildFern(s: number): THREE.Group {
  const g = new THREE.Group();
  const fronds = 5 + Math.floor(rng(s, 0) * 4);
  const col = varyColor([0x1d5c14, 0x2b6e1c, 0x226018][Math.floor(rng(s, 1) * 3)], s, 2);
  const mat = makeMat(col);
  for (let i = 0; i < fronds; i++) {
    const a  = (i / fronds) * Math.PI * 2;
    const fL = 0.18 + rng(s, 10 + i) * 0.18;
    const f  = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, fL, 3, 5), mat);
    f.position.set(Math.cos(a) * fL * 0.4, fL * 0.25, Math.sin(a) * fL * 0.4);
    f.rotation.z =  Math.cos(a) * 0.8;
    f.rotation.x = -Math.sin(a) * 0.8;
    f.castShadow = true;
    g.add(f);
  }
  return g;
}

// ─── PLAYER CHARACTER ─────────────────────────────────────────────────────────
function buildCharacter(): THREE.Group {
  const group = new THREE.Group();
  group.name = "character";

  const skinCol  = 0xf5cba7;
  const shirtCol = 0x3d6b2f; // forest green shirt
  const pantsCol = 0x2c3e50;
  const bootCol  = 0x2c1810;
  const hairCol  = 0x2c1a0e;

  const skin  = new THREE.MeshLambertMaterial({ color: skinCol });
  const shirt = new THREE.MeshLambertMaterial({ color: shirtCol });
  const pants = new THREE.MeshLambertMaterial({ color: pantsCol });
  const boots = new THREE.MeshLambertMaterial({ color: bootCol });
  const hair  = new THREE.MeshLambertMaterial({ color: hairCol });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 8, 7), skin);
  head.position.y = 1.56;
  head.castShadow = true;
  group.add(head);

  // Hair
  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.172, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hair
  );
  hairMesh.position.y = 1.59;
  group.add(hairMesh);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 6), skin);
  neck.position.y = 1.36;
  group.add(neck);

  // Torso (slightly tapered)
  const torsoGeo = new THREE.CylinderGeometry(0.155, 0.175, 0.58, 7);
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.y = 1.01;
  torso.castShadow = true;
  group.add(torso);

  // Hips
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.160, 0.20, 7), pants);
  hips.position.y = 0.68;
  group.add(hips);

  // Arms with forearms
  const makeArm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.215, 1.25, 0);
    pivot.name = side < 0 ? "leftArmPivot" : "rightArmPivot";

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.33, 6), shirt);
    upper.position.y = -0.165;
    upper.castShadow = true;
    pivot.add(upper);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -0.33;
    elbowPivot.name = side < 0 ? "leftElbow" : "rightElbow";
    pivot.add(elbowPivot);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.30, 6), skin);
    forearm.position.y = -0.15;
    forearm.castShadow = true;
    elbowPivot.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), skin);
    hand.position.y = -0.32;
    elbowPivot.add(hand);

    group.add(pivot);
    return pivot;
  };
  makeArm(-1);
  makeArm(1);

  // Legs with knees
  const makeLeg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.085, 0.68, 0);
    pivot.name = side < 0 ? "leftLegPivot" : "rightLegPivot";

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.080, 0.36, 6), pants);
    thigh.position.y = -0.18;
    thigh.castShadow = true;
    pivot.add(thigh);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.36;
    kneePivot.name = side < 0 ? "leftKnee" : "rightKnee";
    pivot.add(kneePivot);

    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.068, 0.34, 6), pants);
    shin.position.y = -0.17;
    shin.castShadow = true;
    kneePivot.add(shin);

    // Boot
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.09, 0.20), boots);
    boot.position.set(0, -0.38, 0.025);
    kneePivot.add(boot);

    group.add(pivot);
    return pivot;
  };
  makeLeg(-1);
  makeLeg(1);

  return group;
}

// ─── WEBGL CHECK ──────────────────────────────────────────────────────────────
function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch { return false; }
}

// ─── DECOR SPECS ──────────────────────────────────────────────────────────────
interface DecorSpec { type: "bush" | "rock" | "fern"; x: number; z: number; seed: number; rot: number }

function buildDecorSpecs(radius: number, seed: number): DecorSpec[] {
  const specs: DecorSpec[] = [];
  const counts = { bush: Math.floor(radius * 1.8), rock: Math.floor(radius * 0.7), fern: Math.floor(radius * 2.2) };
  const types: Array<"bush" | "rock" | "fern"> = ["bush", "rock", "fern"];
  let si = 0;
  for (const type of types) {
    for (let i = 0; i < counts[type]; i++, si++) {
      const r = 2 + rng(seed + si, si) * radius;
      const a = rng(seed + si + 1, si * 2 + 1) * Math.PI * 2;
      specs.push({
        type,
        x: Math.cos(a) * r + rngRange(seed + si, si * 3, -0.5, 0.5),
        z: Math.sin(a) * r + rngRange(seed + si, si * 3 + 1, -0.5, 0.5),
        seed: seed * 100 + si,
        rot: rng(seed + si, si * 5 + 2) * Math.PI * 2,
      });
    }
  }
  return specs;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ForestWorld({ users, onSelectUser, selectedUser, onNearbyUsers }: ForestWorldProps) {
  const mountRef     = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState(false);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef     = useRef(0);

  const treeGroupsRef   = useRef<Map<string, THREE.Group>>(new Map());
  const treePositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const renderedTreesRef = useRef<Set<string>>(new Set());

  const decorSpecsRef   = useRef<DecorSpec[]>([]);
  const renderedDecorRef = useRef<Map<number, THREE.Group>>(new Map());

  const [nameplates, setNameplates] = useState<Array<{
    username: string; x: number; y: number; visible: boolean; commits: number; status: string;
  }>>([]);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const onNearbyUsersRef = useRef(onNearbyUsers);
  useEffect(() => { onNearbyUsersRef.current = onNearbyUsers; }, [onNearbyUsers]);
  const prevNearbyKeyRef = useRef("");

  const charRef      = useRef({ x: 2, z: 2, angle: 0, walkT: 0, moving: false });
  const keysRef      = useRef<Set<string>>(new Set());
  const charGroupRef = useRef<THREE.Group | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const followModeRef = useRef(false);

  const camRef = useRef({
    theta: 0.55, phi: 0.98, radius: 26,
    targetX: 0, targetY: 0, targetZ: 0,
    isDragging: false, prevX: 0, prevY: 0, isRight: false,
    panX: 0, panZ: 0,
  });

  const allUsersRef = useRef<typeof users>([]);
  allUsersRef.current = users;

  useEffect(() => {
    const h = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    if (!supportsWebGL()) { setWebglError(true); return; }
    const el = mountRef.current;
    if (!el) return;
    const isDark = document.documentElement.classList.contains("dark");

    // ── SCENE ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDark ? 0x080f08 : 0x7ec8c8);
    // Layered fog: subtle atmospheric perspective
    scene.fog = new THREE.FogExp2(isDark ? 0x0a1a0a : 0x8fd8c0, 0.0055);
    sceneRef.current = scene;

    // ── CAMERA ──
    const camera = new THREE.PerspectiveCamera(62, size.w / size.h, 0.1, 600);
    cameraRef.current = camera;

    // ── RENDERER ──
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch { setWebglError(true); return; }
    renderer.setSize(size.w, size.h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isDark ? 0.85 : 1.1;
    rendererRef.current = renderer;
    el.appendChild(renderer.domElement);

    // ── LIGHTING ──
    // Sky hemisphere — warm sky, cool mossy ground
    const hemi = new THREE.HemisphereLight(
      isDark ? 0x0d2a18 : 0x9fd8e8,
      isDark ? 0x071207 : 0x3d7a25,
      isDark ? 0.80 : 1.1
    );
    scene.add(hemi);

    // Main directional sun — low angle for warm forest lighting
    const sun = new THREE.DirectionalLight(isDark ? 0xfff3c8 : 0xfff9e0, isDark ? 1.6 : 2.4);
    sun.position.set(30, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 220;
    sun.shadow.camera.left   = -100;
    sun.shadow.camera.right  =  100;
    sun.shadow.camera.top    =  100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.bias = -0.00035;
    scene.add(sun);

    // Blue fill from opposite side (sky bounce)
    const fill = new THREE.DirectionalLight(isDark ? 0x1a3560 : 0xa0c8f0, isDark ? 0.4 : 0.5);
    fill.position.set(-25, 12, -18);
    scene.add(fill);

    // Ambient so shadows stay rich but not pitch black
    const ambient = new THREE.AmbientLight(isDark ? 0x091409 : 0x88aa88, isDark ? 0.35 : 0.45);
    scene.add(ambient);

    // ── GROUND ──
    const groundGeo = new THREE.PlaneGeometry(500, 500, 60, 60);
    // Slightly undulate vertex heights for organic terrain
    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let vi = 0; vi < posAttr.count; vi++) {
      const gx = posAttr.getX(vi);
      const gz = posAttr.getZ(vi);
      const bump = Math.sin(gx * 0.18) * Math.cos(gz * 0.14) * 0.22
                 + Math.sin(gx * 0.07 + gz * 0.11) * 0.15;
      posAttr.setY(vi, bump);
    }
    groundGeo.computeVertexNormals();

    // Vertex color variation (patches of moss, bare earth, etc.)
    const vColors = new Float32Array(posAttr.count * 3);
    const groundBase = isDark ? new THREE.Color(0x0c2210) : new THREE.Color(0x3e8a2e);
    for (let vi = 0; vi < posAttr.count; vi++) {
      const gx = posAttr.getX(vi);
      const gz = posAttr.getZ(vi);
      const n  = Math.sin(gx * 0.31 + gz * 0.27) * 0.5 + 0.5;
      const c  = groundBase.clone().offsetHSL(
        (n - 0.5) * 0.04,
        (n - 0.5) * 0.10,
        (n - 0.5) * 0.08
      );
      vColors[vi * 3]     = c.r;
      vColors[vi * 3 + 1] = c.g;
      vColors[vi * 3 + 2] = c.b;
    }
    groundGeo.setAttribute("color", new THREE.BufferAttribute(vColors, 3));
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── FOREST FLOOR LITTER (texture overlay near center) ──
    const litterGeo = new THREE.PlaneGeometry(60, 60, 20, 20);
    const litterCol = isDark ? 0x0f1e0d : 0x4a6e2a;
    const litter = new THREE.Mesh(
      litterGeo,
      new THREE.MeshLambertMaterial({ color: litterCol, transparent: true, opacity: 0.38 })
    );
    litter.rotation.x = -Math.PI / 2;
    litter.position.y = 0.01;
    litter.receiveShadow = true;
    scene.add(litter);

    // ── WATER BODY (small forest pond) ──
    const pondPos = new THREE.Vector3(12, 0.008, -10);
    const pondGeo = new THREE.CircleGeometry(4.5, 48);
    const pondMat = new THREE.MeshLambertMaterial({
      color: isDark ? 0x0c2240 : 0x1a7ca8,
      transparent: true, opacity: 0.88
    });
    const pond = new THREE.Mesh(pondGeo, pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.copy(pondPos);
    scene.add(pond);

    // Shore ring — muddy bank
    const shore = new THREE.Mesh(
      new THREE.RingGeometry(4.5, 5.8, 48),
      new THREE.MeshLambertMaterial({ color: isDark ? 0x0c2015 : 0x2e5e18 })
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(pondPos.x, 0.007, pondPos.z);
    scene.add(shore);

    // Shore stones
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = buildRock(i * 991 + 31);
      r.position.set(pondPos.x + Math.cos(a) * 4.9, 0, pondPos.z + Math.sin(a) * 4.9);
      r.rotation.y = rng(i, 44) * Math.PI * 2;
      scene.add(r);
    }

    // ── PARTICLES (fireflies / dust motes) ──
    const pfCount = 400;
    const pfPos   = new Float32Array(pfCount * 3);
    for (let i = 0; i < pfCount; i++) {
      pfPos[i * 3]     = rngRange(i, 0, -90, 90);
      pfPos[i * 3 + 1] = rngRange(i, 1, 0.2, 6.0);
      pfPos[i * 3 + 2] = rngRange(i, 2, -90, 90);
    }
    const pfGeo = new THREE.BufferGeometry();
    pfGeo.setAttribute("position", new THREE.BufferAttribute(pfPos, 3));
    const particles = new THREE.Points(pfGeo, new THREE.PointsMaterial({
      color: isDark ? 0x88ff88 : 0xffee44,
      size: isDark ? 0.11 : 0.07,
      transparent: true,
      opacity: isDark ? 0.90 : 0.50,
    }));
    scene.add(particles);

    // ── TREE POSITIONS ──
    const sortedUsers = [...users].sort((a, b) =>
      (b.stats?.totalCommits ?? 0) - (a.stats?.totalCommits ?? 0)
    );
    const allPositions = getForestPositions(sortedUsers.length);

    treeGroupsRef.current.clear();
    treePositionsRef.current.clear();
    renderedTreesRef.current.clear();

    sortedUsers.forEach((u, i) => {
      const [x, z] = allPositions[i];
      treePositionsRef.current.set(u.username, new THREE.Vector3(x, 0, z));
    });

    const addTreeToScene = (username: string) => {
      if (renderedTreesRef.current.has(username)) return;
      const user = sortedUsers.find(u => u.username === username);
      if (!user) return;
      const pos = treePositionsRef.current.get(username);
      if (!pos) return;

      const commits    = user.stats?.totalCommits ?? 5;
      const treeStatus = user.stats?.status ?? "inactive";
      const treeGroup  = buildTreeMesh(commits, treeStatus);
      treeGroup.position.copy(pos);
      treeGroup.userData = { username, commits };
      treeGroup.rotation.y = rng(commits, username.charCodeAt(0)) * Math.PI * 2;
      scene.add(treeGroup);
      treeGroupsRef.current.set(username, treeGroup);
      renderedTreesRef.current.add(username);
    };

    const removeTreeFromScene = (username: string) => {
      if (!renderedTreesRef.current.has(username)) return;
      const tg = treeGroupsRef.current.get(username);
      if (tg) {
        scene.remove(tg);
        tg.traverse(obj => {
          const m = obj as THREE.Mesh;
          if (m.isMesh) {
            m.geometry?.dispose();
            if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
            else (m.material as THREE.Material)?.dispose();
          }
        });
        treeGroupsRef.current.delete(username);
      }
      renderedTreesRef.current.delete(username);
    };

    // Initial trees in view
    sortedUsers.forEach(u => {
      const pos = treePositionsRef.current.get(u.username);
      if (pos && Math.hypot(pos.x - camRef.current.panX, pos.z - camRef.current.panZ) < 32) {
        addTreeToScene(u.username);
      }
    });

    // ── DECORATIONS ──
    decorSpecsRef.current = buildDecorSpecs(80, 7);
    renderedDecorRef.current.clear();

    // ── CHARACTER ──
    const charGroup = buildCharacter();
    charGroup.position.set(charRef.current.x, 0, charRef.current.z);
    scene.add(charGroup);
    charGroupRef.current = charGroup;

    // ── RAYCASTING ──
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onCanvasClick = (e: MouseEvent) => {
      if (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      mouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const meshes: THREE.Mesh[] = [];
      treeGroupsRef.current.forEach(grp => grp.traverse(obj => { if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh); }));
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.username) obj = obj.parent;
        if (obj?.userData.username) onSelectUser(obj.userData.username);
      } else {
        onSelectUser(null);
      }
    };
    renderer.domElement.addEventListener("click", onCanvasClick);

    // ── CAMERA CONTROLS ──
    const cam = camRef.current;
    const onMouseDown = (e: MouseEvent) => { cam.isDragging = true; cam.prevX = e.clientX; cam.prevY = e.clientY; cam.isRight = e.button === 2; };
    const onMouseMove = (e: MouseEvent) => {
      if (!cam.isDragging) return;
      const dx = e.clientX - cam.prevX, dy = e.clientY - cam.prevY;
      cam.prevX = e.clientX; cam.prevY = e.clientY;
      if (cam.isRight) { cam.panX -= dx * 0.04; cam.panZ -= dy * 0.04; }
      else { cam.theta -= dx * 0.007; cam.phi = Math.max(0.12, Math.min(1.48, cam.phi + dy * 0.007)); }
    };
    const onMouseUp = () => { cam.isDragging = false; };
    const onWheel   = (e: WheelEvent) => { cam.radius = Math.max(4, Math.min(100, cam.radius + e.deltaY * 0.04)); };
    const onCtxMenu = (e: Event) => e.preventDefault();
    const onTStart  = (e: TouchEvent) => { cam.isDragging = true; cam.prevX = e.touches[0].clientX; cam.prevY = e.touches[0].clientY; cam.isRight = false; };
    const onTMove   = (e: TouchEvent) => {
      if (!cam.isDragging) return;
      const dx = e.touches[0].clientX - cam.prevX, dy = e.touches[0].clientY - cam.prevY;
      cam.prevX = e.touches[0].clientX; cam.prevY = e.touches[0].clientY;
      cam.theta -= dx * 0.010; cam.phi = Math.max(0.12, Math.min(1.48, cam.phi + dy * 0.010));
    };
    const onTEnd = () => { cam.isDragging = false; };
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", onCtxMenu);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    renderer.domElement.addEventListener("touchstart", onTStart, { passive: true });
    window.addEventListener("touchmove", onTMove, { passive: true });
    window.addEventListener("touchend", onTEnd);

    // ── KEYBOARD ──
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)) {
        e.preventDefault();
        keysRef.current.add(k);
        if (!followModeRef.current) { followModeRef.current = true; setFollowMode(true); }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { keysRef.current.delete(e.key.toLowerCase()); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ── ANIMATION LOOP ──
    let animT = 0;
    const tmpVec = new THREE.Vector3();
    const screenVec = new THREE.Vector3();
    const followCam = { x: 0, y: 6, z: 0, lx: 0, lz: 0 };
    let lastStreamX = 0, lastStreamZ = 0;
    const UNLOAD_BUFFER = 22;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      animT += 0.012;
      const dt = 0.016;

      // Character movement
      const ch   = charRef.current;
      const keys = keysRef.current;
      const SPEED = 7.5, ROT = 2.8;
      let mx = 0, mz = 0;
      if (keys.has("w") || keys.has("arrowup"))    { mx +=  Math.sin(ch.angle); mz +=  Math.cos(ch.angle); }
      if (keys.has("s") || keys.has("arrowdown"))  { mx += -Math.sin(ch.angle); mz += -Math.cos(ch.angle); }
      if (keys.has("a") || keys.has("arrowleft"))   ch.angle += ROT * dt;
      if (keys.has("d") || keys.has("arrowright"))  ch.angle -= ROT * dt;
      ch.moving = mx !== 0 || mz !== 0;
      if (ch.moving) { ch.x += mx * SPEED * dt; ch.z += mz * SPEED * dt; ch.walkT += dt * 9; }

      if (charGroupRef.current) {
        charGroupRef.current.position.set(ch.x, 0, ch.z);
        charGroupRef.current.rotation.y = ch.angle;
        const swing = ch.moving ? Math.sin(ch.walkT) * 0.60 : 0;
        charGroupRef.current.traverse(obj => {
          if (obj.name === "leftLegPivot")  obj.rotation.x =  swing;
          if (obj.name === "rightLegPivot") obj.rotation.x = -swing;
          if (obj.name === "leftArmPivot")  obj.rotation.x = -swing * 0.65;
          if (obj.name === "rightArmPivot") obj.rotation.x =  swing * 0.65;
          if (obj.name === "leftElbow")     obj.rotation.x = swing > 0 ? swing * 0.35 : 0;
          if (obj.name === "rightElbow")    obj.rotation.x = swing < 0 ? -swing * 0.35 : 0;
        });
        charGroupRef.current.position.y = ch.moving ? Math.abs(Math.sin(ch.walkT)) * 0.05 : 0;
      }

      // Camera
      if (followModeRef.current) {
        const behind = 5.5, hOff = 3.8;
        const tcx = ch.x - Math.sin(ch.angle) * behind;
        const tcz = ch.z - Math.cos(ch.angle) * behind;
        const ls  = 0.14;
        followCam.x  += (tcx - followCam.x) * ls;
        followCam.y  += (hOff - followCam.y) * ls;
        followCam.z  += (tcz - followCam.z) * ls;
        followCam.lx += (ch.x - followCam.lx) * ls;
        followCam.lz += (ch.z - followCam.lz) * ls;
        camera.position.set(followCam.x, followCam.y, followCam.z);
        camera.lookAt(followCam.lx, 0.9, followCam.lz);
      } else {
        camera.position.set(
          cam.panX + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta),
          cam.radius * Math.cos(cam.phi),
          cam.panZ + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta)
        );
        camera.lookAt(cam.panX, 0, cam.panZ);
      }

      // Streaming
      const sOx = followModeRef.current ? ch.x : cam.panX;
      const sOz = followModeRef.current ? ch.z : cam.panZ;
      if (Math.hypot(sOx - lastStreamX, sOz - lastStreamZ) > 2.5 || Math.round(animT * 80) % 30 === 0) {
        lastStreamX = sOx; lastStreamZ = sOz;
        const SR = followModeRef.current ? 38 : Math.min(cam.radius * 1.25 + 10, 90);
        const UR = SR + UNLOAD_BUFFER;
        allUsersRef.current.forEach(u => {
          const pos = treePositionsRef.current.get(u.username);
          if (!pos) return;
          const d = Math.hypot(pos.x - sOx, pos.z - sOz);
          if (d <= SR) addTreeToScene(u.username);
          else if (d > UR) removeTreeFromScene(u.username);
        });
        const dR = SR * 0.85, dU = dR + UNLOAD_BUFFER;
        decorSpecsRef.current.forEach((spec, idx) => {
          const d = Math.hypot(spec.x - sOx, spec.z - sOz);
          if (d <= dR && !renderedDecorRef.current.has(idx)) {
            const obj = spec.type === "bush" ? buildBush(spec.seed)
                      : spec.type === "fern" ? buildFern(spec.seed)
                      : buildRock(spec.seed);
            obj.position.set(spec.x, 0, spec.z);
            obj.rotation.y = spec.rot;
            scene.add(obj);
            renderedDecorRef.current.set(idx, obj);
          } else if (d > dU && renderedDecorRef.current.has(idx)) {
            const obj = renderedDecorRef.current.get(idx)!;
            scene.remove(obj);
            obj.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); } });
            renderedDecorRef.current.delete(idx);
          }
        });
      }

      // Tree sway — naturalistic multi-frequency wind
      treeGroupsRef.current.forEach((grp, username) => {
        const ph  = username.charCodeAt(0) * 0.27 + username.charCodeAt(username.length - 1) * 0.19;
        const amp = 0.008 + Math.sin(ph * 4.1) * 0.004;
        grp.rotation.z = Math.sin(animT * 0.42 + ph)          * amp
                       + Math.sin(animT * 1.10 + ph * 1.3)    * amp * 0.3;
        grp.rotation.x = Math.sin(animT * 0.36 + ph + 1.2)    * amp * 0.45
                       + Math.sin(animT * 0.88 + ph * 0.9)    * amp * 0.2;
      });

      // Firefly drift
      const pfA = particles.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pfCount; i++) {
        pfA.array[i * 3 + 1] = 0.2 + 3.0 * (0.5 + 0.5 * Math.sin(animT * 0.36 + i * 0.58));
        pfA.array[i * 3]    += Math.sin(animT * 0.13 + i * 1.4) * 0.003;
        pfA.array[i * 3 + 2] += Math.cos(animT * 0.11 + i * 0.95) * 0.003;
      }
      pfA.needsUpdate = true;

      // Selected tree glow
      treeGroupsRef.current.forEach((grp, username) => {
        const sel = username === selectedUser;
        grp.traverse(obj => {
          const m = obj as THREE.Mesh;
          if (m.isMesh && m.material) {
            const mat = m.material as THREE.MeshLambertMaterial;
            mat.emissive = sel ? new THREE.Color(0x221800) : new THREE.Color(0x000000);
            mat.emissiveIntensity = sel ? 0.32 + 0.16 * Math.sin(animT * 2.6) : 0;
          }
        });
      });

      renderer.render(scene, camera);

      // Proximity check
      if (Math.round(animT * 80) % 60 === 0 && onNearbyUsersRef.current) {
        const ox = followModeRef.current ? ch.x : cam.panX;
        const oz = followModeRef.current ? ch.z : cam.panZ;
        const lr = followModeRef.current ? 30 : Math.max(cam.radius * 0.75, 14);
        const nearby: string[] = [];
        treePositionsRef.current.forEach((pos, username) => {
          if (Math.hypot(pos.x - ox, pos.z - oz) <= lr) nearby.push(username);
        });
        const key = [...nearby].sort().join(",");
        if (key !== prevNearbyKeyRef.current) { prevNearbyKeyRef.current = key; onNearbyUsersRef.current(nearby); }
      }

      // Nameplates
      const plates: typeof nameplates = [];
      treePositionsRef.current.forEach((pos, username) => {
        if (!renderedTreesRef.current.has(username)) return;
        const user = users.find(u => u.username === username);
        const h    = user?.stats ? getTreeHeight(user.stats.totalCommits) : 1;
        tmpVec.set(pos.x, h + 1.2, pos.z);
        screenVec.copy(tmpVec).project(camera);
        const sx = (screenVec.x * 0.5 + 0.5) * size.w;
        const sy = (-screenVec.y * 0.5 + 0.5) * size.h;
        plates.push({
          username, x: sx, y: sy,
          visible: screenVec.z < 1 && sx > 0 && sx < size.w && sy > 0 && sy < size.h,
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
      renderer.domElement.removeEventListener("contextmenu", onCtxMenu);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("touchstart", onTStart);
      window.removeEventListener("touchmove", onTMove);
      window.removeEventListener("touchend", onTEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      charGroupRef.current = null;
      renderedDecorRef.current.clear();
      decorSpecsRef.current = [];
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [users.map(u => u.username + (u.stats?.totalCommits ?? "?")).join("|"), size.w, size.h]);

  const statusDot: Record<string, string> = {
    active: "#22c55e", moderate: "#eab308", occasional: "#f97316", inactive: "#9ca3af",
  };

  if (webglError) {
    return (
      <div data-testid="forest-world-fallback" style={{ position: "relative", width: size.w, height: size.h, background: "linear-gradient(to bottom, #0a1f10, #163026)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "#fff" }}>
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
        <div key={p.username} onClick={() => onSelectUser(p.username)} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%, -100%)", pointerEvents: "auto", cursor: "pointer", userSelect: "none" }}>
          <div style={{
            background: p.username === selectedUser ? "rgba(255,255,200,0.96)" : "rgba(0,0,0,0.72)",
            color: p.username === selectedUser ? "#1a1a00" : "#ffffff",
            border: p.username === selectedUser ? "1.5px solid #ffd700" : "1px solid rgba(255,255,255,0.18)",
            borderRadius: 20, padding: "3px 10px 3px 7px", fontSize: 11, fontWeight: 600,
            fontFamily: "monospace", display: "flex", alignItems: "center", gap: 5,
            backdropFilter: "blur(6px)",
            boxShadow: p.username === selectedUser ? "0 0 12px rgba(255,215,0,0.6)" : "0 2px 8px rgba(0,0,0,0.4)",
            whiteSpace: "nowrap", transition: "all 0.2s",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusDot[p.status] ?? "#888", flexShrink: 0, display: "inline-block" }} />
            @{p.username}
          </div>
          <div style={{ width: 1, height: 8, background: "rgba(255,255,255,0.28)", margin: "0 auto" }} />
        </div>
      ))}

      {!followMode && (
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "6px 14px", color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 500, pointerEvents: "none", whiteSpace: "nowrap" }}>
          Press <kbd style={{ background: "rgba(255,255,255,0.12)", borderRadius: 4, padding: "1px 5px", fontFamily: "monospace" }}>W A S D</kbd> to walk around
        </div>
      )}

      {followMode && (
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, background: "rgba(74,222,128,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 20, padding: "6px 14px", color: "#4ade80", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
          Walking — <kbd style={{ background: "rgba(255,255,255,0.1)", borderRadius: 4, padding: "1px 5px", fontFamily: "monospace" }}>WASD</kbd> to move
          <button data-testid="button-exit-follow" onClick={() => { followModeRef.current = false; setFollowMode(false); keysRef.current.clear(); }} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: "2px 8px", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 10, marginLeft: 4 }}>
            Exit
          </button>
        </div>
      )}
    </div>
  );
}
