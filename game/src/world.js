// The map: "Sector 7 — Neon Foundry", an original 44 x 34 m arena. Attackers (AZURE)
// spawn south, defenders (CRIMSON) hold north. Two beacon sites, A west and B east, three
// lanes (west, mid, east) joined by two connectors. Every box is a collider for movement
// and a surface bullets stop on. Plain geometry only, no models and no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Arena bounds (inner faces).
export const ARENA = { minX: -22, maxX: 22, minZ: -17, maxZ: 17 };

// Beacon sites: axis-aligned zones the attackers plant in.
export const SITES = {
  A: { name: 'A', minX: -20.5, maxX: -12.5, minZ: -15.5, maxZ: -8.5, cx: -16.5, cz: -12, beacon: null },
  B: { name: 'B', minX: 12.5, maxX: 20.5, minZ: -15.5, maxZ: -8.5, cx: 16.5, cz: -12, beacon: null },
};

export const SPAWNS = {
  azure: [
    [-8, 14.5], [-3, 14.5], [2, 14.5], [7, 14.5], [0, 12.5],
  ],
  crimson: [
    [-16, -14.5], [-8, -14.5], [0, -14.5], [8, -14.5], [16, -14.5],
  ],
};

// Waypoint graph the bots walk. Nodes are [x, z]; edges are index pairs.
export const WAYPOINTS = [
  [-8, 14.5], [0, 14.5], [8, 14.5], // 0-2 attacker spawn
  [-17, 10], [0, 10], [17, 10], // 3-5 south lanes
  [-17, 2], [0, 2], [17, 2], // 6-8 mid lanes
  [-17, -6], [0, -4], [17, -6], // 9-11 north lanes
  [-17, -11.5], [0, -9], [17, -11.5], // 12-14 sites / mid-north
  [-5, -4], [5, -4], // 15-16 connectors
  [-11.5, -5], [11.5, -5], // 17-18 connector gaps
  [-16, -14], [0, -14], [16, -14], // 19-21 defender spawn
];
const EDGES = [
  [0, 3], [0, 4], [1, 4], [2, 4], [2, 5],
  [3, 6], [4, 7], [5, 8],
  [6, 9], [7, 10], [8, 11],
  [9, 12], [10, 13], [11, 14],
  [7, 15], [7, 16], [15, 10], [16, 10],
  [6, 17], [9, 17], [17, 15], [8, 18], [11, 18], [18, 16],
  [12, 19], [13, 20], [14, 21],
  [9, 19], [11, 21], [10, 20], [13, 19], [13, 21],
  [15, 17], [16, 18], [12, 17], [14, 18],
];

// Defender hold spots: [x, z] positions a defender walks to and watches from.
export const HOLD_SPOTS = [
  [-16.5, -12], [16.5, -12], [0, -7], [-11.5, -5], [11.5, -5],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'glow' ? 0.5 : 0.92,
      metalness: name === 'wall' ? 0.25 : 0.03,
    });
  }
  // Emissive strip material for the neon site markers and lane strips.
  const neonA = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const neonB = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.azure) });
  const neonC = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.crimson) });

  const colliders = [];
  const shootables = [];
  // Tall colliders (h >= 2) block bot line of sight; low crates do not.
  const sightBlockers = [];

  function box(width, height, depth, x, y, z, material, sight = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const bounds = new THREE.Box3().setFromObject(mesh);
    colliders.push(bounds);
    shootables.push(mesh);
    if (sight && height >= 2) sightBlockers.push(bounds);
    return mesh;
  }

  // Floor and outer walls (4 m high).
  box(44.4, 0.4, 34.4, 0, -0.2, 0, 'ground');
  box(0.4, 4, 34.4, -22.2, 2, 0, 'wall');
  box(0.4, 4, 34.4, 22.2, 2, 0, 'wall');
  box(44.4, 4, 0.4, 0, 2, -17.2, 'wall');
  box(44.4, 4, 0.4, 0, 2, 17.2, 'wall');

  // Lane dividers: west and east walls with a connector gap at z -6..-4.
  box(0.6, 3.4, 10, -11, 1.7, 1, 'wall');
  box(0.6, 3.4, 10, 11, 1.7, 1, 'wall');
  box(0.6, 3.4, 5, -11, 1.7, -8.5, 'wall');
  box(0.6, 3.4, 5, 11, 1.7, -8.5, 'wall');
  // Mid-north wall with gaps on both sides, shielding the sites from a straight mid rush.
  box(6, 3.4, 0.6, 0, 1.7, -6, 'wall');

  // Central foundry block: two tall crates with a firing gap between them.
  box(2.2, 2.4, 2.2, -2.4, 1.2, 0, 'crate');
  box(2.2, 2.4, 2.2, 2.4, 1.2, 0, 'crate');
  box(1.2, 1.1, 1.2, 0, 0.55, 3.2, 'crateDark');
  // Crouch cover dotted down the lanes.
  box(1.6, 1.1, 1.6, -17, 0.55, 5, 'crate');
  box(1.6, 1.1, 1.6, 17, 0.55, 5, 'crate');
  box(1.6, 1.1, 1.6, -17, 0.55, -2, 'crateDark');
  box(1.6, 1.1, 1.6, 17, 0.55, -2, 'crateDark');
  box(2.4, 1.1, 1.2, -5, 0.55, 9, 'crateDark');
  box(2.4, 1.1, 1.2, 5, 0.55, 9, 'crateDark');
  box(1.2, 2.2, 1.2, -5, 1.1, -2, 'crate');
  box(1.2, 2.2, 1.2, 5, 1.1, -2, 'crate');
  // Site cover: a tall crate and a low crate on each site.
  box(1.6, 2.2, 1.6, -13.5, 1.1, -10.5, 'crate');
  box(1.6, 1.1, 1.6, -18.5, 0.55, -13.5, 'crateDark');
  box(1.6, 2.2, 1.6, 13.5, 1.1, -10.5, 'crate');
  box(1.6, 1.1, 1.6, 18.5, 0.55, -13.5, 'crateDark');
  // Spawn cover.
  box(2.4, 1.1, 1.2, -4, 0.55, 12.5, 'crateDark');
  box(2.4, 1.1, 1.2, 4, 0.55, 12.5, 'crateDark');

  // Neon strips: amber along the sites, cyan at the attacker spawn, red at the defender spawn.
  function strip(width, depth, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    group.add(mesh);
  }
  strip(7.6, 0.3, -16.5, -8.7, neonA);
  strip(7.6, 0.3, 16.5, -8.7, neonA);
  strip(12, 0.3, 0, 16.2, neonB);
  strip(12, 0.3, 0, -16.2, neonC);

  // Site letters: flat amber panels standing at the back wall of each site.
  function sitePanel(x, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.15), materials.site);
    mesh.position.set(x, 1.6, z);
    group.add(mesh);
  }
  sitePanel(-16.5, -16.9);
  sitePanel(16.5, -16.9);

  // Light: warm dusk key from the south-east, cool fill from the north, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.7);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xffe0b3), 2.6);
  key.position.set(10, 16, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.azure), 0.7);
  fill.position.set(-10, 10, -14);
  scene.add(fill);

  return { colliders, shootables, sightBlockers, group };
}

// 2D segment vs AABB test, used for bot line of sight (y is ignored: only tall walls block).
export function hasLineOfSight(ax, az, bx, bz, blockers) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const b of blockers) {
    // Slab test on the xz rectangle of the box.
    let tmin = 0;
    let tmax = 1;
    let ok = true;
    for (const [p, d, mn, mx] of [[ax, dx, b.min.x, b.max.x], [az, dz, b.min.z, b.max.z]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < mn || p > mx) { ok = false; break; }
      } else {
        let t1 = (mn - p) / d;
        let t2 = (mx - p) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok) return false;
  }
  return true;
}

// Breadth-first route over the waypoint graph, from the node nearest (x, z) to the node
// nearest (tx, tz). Returns an array of [x, z] waypoints to walk, excluding the start.
export function findRoute(x, z, tx, tz) {
  function nearest(px, pz) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const dx = WAYPOINTS[i][0] - px;
      const dz = WAYPOINTS[i][1] - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  const start = nearest(x, z);
  const goal = nearest(tx, tz);
  if (start === goal) return [[tx, tz]];
  const adjacency = new Map();
  for (const [a, b] of EDGES) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    if (node === goal) break;
    for (const next of adjacency.get(node) ?? []) {
      if (!prev.has(next)) {
        prev.set(next, node);
        queue.push(next);
      }
    }
  }
  if (!prev.has(goal)) return [[tx, tz]];
  const path = [];
  let node = goal;
  while (node !== start && node !== -1) {
    path.unshift(WAYPOINTS[node]);
    node = prev.get(node);
  }
  path.push([tx, tz]);
  return path;
}

// Axis-aligned movement with collision: move a circle of `radius` at height `height` by
// (vx * dt, vz * dt), resolving one axis at a time against the colliders. Returns the new
// position in the out vector and whether each axis was blocked. Shared by player and bots.
export function collideMove(colliders, pos, vx, vz, dt, radius, height, out) {
  const probe = collideMove._probe ?? (collideMove._probe = new THREE.Box3());
  function overlaps(x, y, z, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }
  let blockedX = false;
  let blockedZ = false;
  const nx = pos.x + vx * dt;
  if (!overlaps(nx, pos.y, pos.z, 0.04)) pos.x = nx;
  else blockedX = true;
  const nz = pos.z + vz * dt;
  if (!overlaps(pos.x, pos.y, nz, 0.04)) pos.z = nz;
  else blockedZ = true;
  // Keep feet on the floor (the map is flat; no vertical physics for bots).
  if (pos.y < 0) pos.y = 0;
  if (out) { out.x = blockedX ? 1 : 0; out.z = blockedZ ? 1 : 0; }
  return out;
}

export function insideSite(site, x, z) {
  return x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ;
}
