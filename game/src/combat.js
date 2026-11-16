// Combat resolution: hitscan rays, tracers and grenades. A ray is tested analytically
// against every agent's two spheres (head, body) and with three's Raycaster against the
// world, and the nearer hit wins — so a crate really does stop a bullet meant for a head.
// No objects are allocated in the hot path: the raycaster and all tracers are pooled.
import * as THREE from 'three';

const _oc = new THREE.Vector3();
const _to = new THREE.Vector3();

// Ray vs one agent: head sphere at the eye, body sphere at mid-torso. Returns the nearer
// hit { dist, part } or null. dir must be normalized.
export function rayVsAgent(origin, dir, agent) {
  let best = null;
  const tests = [
    [agent.pos.x, agent.pos.y + agent.eye - 0.12, agent.pos.z, 0.21, 'head'],
    [agent.pos.x, agent.pos.y + agent.height * 0.55, agent.pos.z, 0.42, 'body'],
  ];
  for (const [cx, cy, cz, r, part] of tests) {
    _oc.set(cx - origin.x, cy - origin.y, cz - origin.z);
    const tca = _oc.dot(dir);
    if (tca < 0) continue;
    const d2 = _oc.lengthSq() - tca * tca;
    const r2 = r * r;
    if (d2 > r2) continue;
    const thc = Math.sqrt(r2 - d2);
    const dist = tca - thc;
    if (dist < 0) continue;
    if (!best || dist < best.dist) best = { dist, part };
  }
  return best;
}

export function createCombat(scene, shootables) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;

  // Tracer pool: 14 reusable lines, each fading out over 70 ms.
  const tracers = [];
  for (let i = 0; i < 14; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Explosion flash pool: 3 reusable spheres + lights.
  const booms = [];
  for (let i = 0; i < 3; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0, depthWrite: false }),
    );
    const light = new THREE.PointLight(0xffa030, 0, 12);
    mesh.visible = false;
    scene.add(mesh, light);
    booms.push({ mesh, light, life: 0 });
  }
  let boomIndex = 0;

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e3540, roughness: 0.6, metalness: 0.4 });

  function spawnTracer(from, to, color = 0xffc46b) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracers.length;
    const pos = tracer.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tracer.line.material.color.setHex(color);
    tracer.line.material.opacity = 0.9;
    tracer.life = 0.07;
  }

  function stepTracers(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.9;
    }
    for (const boom of booms) {
      if (boom.life <= 0) continue;
      boom.life -= dt;
      const t = Math.max(0, boom.life / 0.45);
      boom.mesh.scale.setScalar(1 + (1 - t) * 5);
      boom.mesh.material.opacity = t * 0.55;
      boom.light.intensity = t * 60;
      if (boom.life <= 0) boom.mesh.visible = false;
    }
  }

  // One hitscan shot. agents are the living agents other than the shooter.
  // Returns { kind: 'agent'|'wall'|'none', point, agent, part, dist }.
  function shoot(origin, dir, range, agents) {
    scene.updateMatrixWorld(true);
    raycaster.set(origin, dir);
    const wallHit = raycaster.intersectObjects(shootables, false)[0];
    const wallDist = wallHit ? wallHit.distance : Infinity;
    let bestAgent = null;
    let best = null;
    for (const agent of agents) {
      if (!agent.alive) continue;
      const hit = rayVsAgent(origin, dir, agent);
      if (hit && hit.dist < range && (!best || hit.dist < best.dist)) {
        best = hit;
        bestAgent = agent;
      }
    }
    if (best && best.dist < wallDist) {
      const point = _to.copy(dir).multiplyScalar(best.dist).add(origin);
      return { kind: 'agent', point: point.clone(), agent: bestAgent, part: best.part, dist: best.dist };
    }
    if (wallHit && wallHit.distance < range) {
      return { kind: 'wall', point: wallHit.point.clone(), agent: null, part: null, dist: wallHit.distance };
    }
    const point = _to.copy(dir).multiplyScalar(range).add(origin);
    return { kind: 'none', point: point.clone(), agent: null, part: null, dist: range };
  }

  function throwGrenade(from, dir, owner) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(from);
    scene.add(mesh);
    const vel = dir.clone().multiplyScalar(13);
    vel.y += 4.5;
    grenades.push({ mesh, pos: mesh.position, vel, fuse: 1.6, owner });
  }

  function stepGrenades(dt, agents) {
    const events = [];
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      g.pos.addScaledVector(g.vel, dt);
      if (g.pos.y < 0.09) {
        g.pos.y = 0.09;
        g.vel.y *= -0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.pos.x < -21.8 || g.pos.x > 21.8) g.vel.x *= -0.4;
      if (g.pos.z < -16.8 || g.pos.z > 16.8) g.vel.z *= -0.4;
      if (g.fuse <= 0) {
        const boom = booms[boomIndex];
        boomIndex = (boomIndex + 1) % booms.length;
        boom.mesh.position.copy(g.pos);
        boom.mesh.visible = true;
        boom.mesh.scale.setScalar(1);
        boom.light.position.copy(g.pos);
        boom.life = 0.45;
        scene.remove(g.mesh);
        grenades.splice(i, 1);
        events.push({ type: 'explode', pos: g.pos.clone(), owner: g.owner });
      }
    }
    return events;
  }

  function clearGrenades() {
    for (const g of grenades) scene.remove(g.mesh);
    grenades.length = 0;
  }

  return { shoot, spawnTracer, stepTracers, throwGrenade, stepGrenades, clearGrenades };
}
