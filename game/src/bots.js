// Bot agents: one brain for both teams. Attackers pick a beacon site, walk a waypoint
// route there, plant when it is clear; defenders pick a hold spot and watch a lane. Any
// bot that sees an enemy stops, aims with a human-like reaction delay, and fires in
// bursts with real spread — its bullets are the same hitscan rays the player fires, so
// cover works for both sides. Gunfire nearby makes bots turn and investigate.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, HOLD_SPOTS, SITES, findRoute, hasLineOfSight, collideMove, insideSite } from './world.js';

const BOT_NAMES = {
  azure: ['Vex', 'Nova', 'Onyx', 'Pico'],
  crimson: ['Rook', 'Havoc', 'Mira', 'Dagger', 'Sable'],
};
const BOT_SPEED = 3.4;
const ENGAGE_SPEED = 1.3;
const SEE_DIST = 45;
const HEAR_DIST = 18;
const REACT_MIN = 0.35;
const REACT_MAX = 0.75;
const BODY_DMG = 24;
const HEAD_DMG = 48;

const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _blocked = { x: 0, z: 0 };

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

function buildBotMesh(team) {
  const group = new THREE.Group();
  const teamColor = team === 'azure' ? PALETTE.azure : PALETTE.crimson;
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.7, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.8, metalness: 0.05 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.22), dark);
  legs.position.y = 0.25;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 0.82;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.3, 0.32), dark);
  vest.position.y = 0.86;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
  head.position.y = 1.38;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.05), suit);
  visor.position.set(0, 1.4, 0.15);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.18, 1.05, 0.3);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.34), dark);
  arm.position.set(0.18, 1.05, 0.12);
  group.add(legs, torso, vest, head, visor, gun, arm);
  group.traverse((mesh) => { mesh.castShadow = true; });
  return group;
}

export function createBot(scene, team, index, spawn) {
  const group = buildBotMesh(team);
  group.position.set(spawn[0], 0, spawn[1]);
  scene.add(group);
  const bot = {
    kind: 'bot',
    id: `${team}-${index}`,
    name: BOT_NAMES[team][index] ?? `${team}-${index}`,
    team,
    group,
    pos: group.position,
    yaw: team === 'azure' ? Math.PI : 0,
    height: 1.72,
    eye: 1.6,
    hp: 100,
    alive: true,
    speed: BOT_SPEED,
    route: [],
    routeIndex: 0,
    targetSite: null,
    hold: null,
    state: 'route',
    engageTarget: null,
    reactLeft: 0,
    burstLeft: 0,
    fireCooldown: 0,
    pauseLeft: 0,
    channelLeft: 0,
    channelKind: null,
    lastSeen: null,
    lastSeenAt: -99,
    strafeDir: 1,
    strafeTimer: 0,
    walkPhase: 0,
    scanDir: 1,
  };
  group.rotation.y = bot.yaw;
  return bot;
}

export function resetBot(bot, spawn) {
  bot.pos.set(spawn[0], 0, spawn[1]);
  bot.yaw = bot.team === 'azure' ? Math.PI : 0;
  bot.group.rotation.set(0, bot.yaw, 0);
  bot.group.visible = true;
  bot.hp = 100;
  bot.alive = true;
  bot.route = [];
  bot.routeIndex = 0;
  bot.targetSite = null;
  bot.hold = null;
  bot.state = 'route';
  bot.engageTarget = null;
  bot.reactLeft = 0;
  bot.burstLeft = 0;
  bot.fireCooldown = 0;
  bot.pauseLeft = 0;
  bot.channelLeft = 0;
  bot.channelKind = null;
  bot.lastSeen = null;
}

// Assign a round plan: attackers split across the two sites, defenders take hold spots.
export function planRound(bot, index, random) {
  if (bot.team === 'azure') {
    bot.targetSite = index % 2 === 0 ? 'A' : 'B';
    const site = SITES[bot.targetSite];
    bot.route = findRoute(bot.pos.x, bot.pos.z, site.cx, site.cz);
    bot.routeIndex = 0;
    bot.hold = null;
    bot.state = 'route';
  } else {
    const spot = HOLD_SPOTS[index % HOLD_SPOTS.length];
    bot.hold = spot;
    bot.route = findRoute(bot.pos.x, bot.pos.z, spot[0], spot[1]);
    bot.routeIndex = 0;
    bot.state = 'route';
  }
}

function nearestVisibleEnemy(bot, agents, sightBlockers) {
  let best = null;
  let bestDist = Infinity;
  for (const agent of agents) {
    if (!agent.alive || agent.team === bot.team) continue;
    const dx = agent.pos.x - bot.pos.x;
    const dz = agent.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SEE_DIST) continue;
    // Field of view: 110 degrees, except very close (heard or bumped into).
    if (dist > 6) {
      const facing = Math.atan2(Math.sin(bot.yaw), Math.cos(bot.yaw));
      const toEnemy = Math.atan2(dx, dz);
      let diff = toEnemy - facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.96) continue;
    }
    if (!hasLineOfSight(bot.pos.x, bot.pos.z, agent.pos.x, agent.pos.z, sightBlockers)) continue;
    if (dist < bestDist) { bestDist = dist; best = agent; }
  }
  return best ? { agent: best, dist: bestDist } : null;
}

function stepBot(bot, dt, ctx, random) {
  if (!bot.alive) return;
  const now = ctx.now;

  // --- Sense ---
  const seen = nearestVisibleEnemy(bot, ctx.agents, ctx.sightBlockers);
  if (seen) {
    if (bot.engageTarget !== seen.agent) {
      bot.engageTarget = seen.agent;
      bot.reactLeft = REACT_MIN + random() * (REACT_MAX - REACT_MIN);
      bot.burstLeft = 0;
      bot.pauseLeft = 0;
    }
    bot.lastSeen = { x: seen.agent.pos.x, z: seen.agent.pos.z };
    bot.lastSeenAt = now;
    if (bot.channelKind) { bot.channelKind = null; bot.channelLeft = 0; }
  } else if (bot.engageTarget && now - bot.lastSeenAt > 3) {
    bot.engageTarget = null;
  }

  // --- Objective: plant / defuse, only when no enemy is in sight ---
  if (!seen) {
    if (bot.team === 'azure' && ctx.beacon.state === 'none' && bot.targetSite) {
      const site = SITES[bot.targetSite];
      if (insideSite(site, bot.pos.x, bot.pos.z)) {
        if (bot.channelKind !== 'plant') { bot.channelKind = 'plant'; bot.channelLeft = 3.5; }
        bot.channelLeft -= dt;
        ctx.onChannel(bot, 'plant', 1 - bot.channelLeft / 3.5);
        if (bot.channelLeft <= 0) {
          bot.channelKind = null;
          ctx.onPlanted(bot, site);
        }
        return;
      }
    }
    if (bot.team === 'crimson' && ctx.beacon.state === 'planted') {
      const site = SITES[ctx.beacon.site];
      const dx = site.cx - bot.pos.x;
      const dz = site.cz - bot.pos.z;
      if (Math.hypot(dx, dz) < 2.2) {
        if (bot.channelKind !== 'defuse') { bot.channelKind = 'defuse'; bot.channelLeft = 5; }
        bot.channelLeft -= dt;
        ctx.onChannel(bot, 'defuse', 1 - bot.channelLeft / 5);
        if (bot.channelLeft <= 0) {
          bot.channelKind = null;
          ctx.onDefused(bot);
        }
        return;
      }
      if (bot.state !== 'route' || bot.route.length === 0 || bot.routeIndex >= bot.route.length) {
        bot.route = findRoute(bot.pos.x, bot.pos.z, site.cx, site.cz);
        bot.routeIndex = 0;
        bot.state = 'route';
      }
    }
  }

  // --- Fight ---
  if (bot.engageTarget && bot.engageTarget.alive) {
    const target = bot.engageTarget;
    const dx = target.pos.x - bot.pos.x;
    const dz = target.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz) || 0.01;
    bot.yaw = angleLerp(bot.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
    bot.group.rotation.y = bot.yaw;
    // Sidestep while fighting, so a bot is never a still target.
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeTimer = 0.7 + random() * 0.9;
      bot.strafeDir = random() < 0.5 ? -1 : 1;
    }
    const mx = Math.cos(bot.yaw) * bot.strafeDir * ENGAGE_SPEED;
    const mz = -Math.sin(bot.yaw) * bot.strafeDir * ENGAGE_SPEED;
    collideMove(ctx.colliders, bot.pos, mx, mz, dt, 0.34, bot.height, _blocked);
    // Fire in bursts once the reaction delay has passed.
    bot.reactLeft -= dt;
    bot.fireCooldown -= dt;
    if (bot.reactLeft <= 0 && bot.fireCooldown <= 0) {
      if (bot.burstLeft > 0) {
        bot.burstLeft -= 1;
        bot.fireCooldown = 0.13;
        fireAt(bot, target, dist, ctx, random);
      } else {
        bot.pauseLeft -= dt;
        if (bot.pauseLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.pauseLeft = 0.55 + random() * 0.7;
        }
      }
    }
    return;
  }

  // --- Move: follow the route, then hold and scan ---
  if (bot.routeIndex < bot.route.length) {
    const [tx, tz] = bot.route[bot.routeIndex];
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      bot.routeIndex += 1;
    } else {
      const vx = (dx / dist) * bot.speed;
      const vz = (dz / dist) * bot.speed;
      bot.yaw = angleLerp(bot.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
      bot.group.rotation.y = bot.yaw;
      collideMove(ctx.colliders, bot.pos, vx, vz, dt, 0.34, bot.height, _blocked);
      bot.walkPhase += dt * 9;
      bot.group.position.y = Math.abs(Math.sin(bot.walkPhase)) * 0.03;
      if (_blocked.x || _blocked.z) {
        // Stuck on a corner: skip to the next waypoint.
        bot.routeIndex += 1;
      }
    }
    return;
  }
  // At the destination: defenders hold and scan their lane, attackers wait at the site.
  bot.state = 'hold';
  bot.scanDir = Math.sin(now * 0.45 + bot.id.charCodeAt(0)) > 0 ? 1 : -1;
  bot.yaw += bot.scanDir * dt * 0.35;
  bot.group.rotation.y = bot.yaw;
}

function fireAt(bot, target, dist, ctx, random) {
  _muzzle.set(
    bot.pos.x + Math.sin(bot.yaw) * 0.5,
    bot.pos.y + 1.35,
    bot.pos.z + Math.cos(bot.yaw) * 0.5,
  );
  _toTarget.set(
    target.pos.x - _muzzle.x,
    target.pos.y + target.eye - 0.25 - _muzzle.y,
    target.pos.z - _muzzle.z,
  );
  const len = _toTarget.length() || 1;
  _toTarget.divideScalar(len);
  // Spread grows with distance and with how fast the target moves, so a bot is
  // dangerous up close and a nuisance at range — never a laser at 40 metres.
  const targetSpeed = target.kind === 'player' ? ctx.playerSpeed : 2.5;
  const spread = 0.025 + dist * 0.0016 + targetSpeed * 0.004;
  _dir.set(
    _toTarget.x + (random() + random() + random() - 1.5) * spread,
    _toTarget.y + (random() + random() + random() - 1.5) * spread,
    _toTarget.z + (random() + random() + random() - 1.5) * spread,
  ).normalize();
  const result = ctx.combat.shoot(_muzzle, _dir, 80, ctx.agents.filter((a) => a !== bot && a.team !== bot.team));
  ctx.combat.spawnTracer(_muzzle, result.point, bot.team === 'azure' ? 0x7cc7ff : 0xff8a90);
  ctx.onBotShot(bot);
  if (result.kind === 'agent' && result.agent) {
    const falloff = dist > 25 ? 0.75 : 1;
    const dmg = (result.part === 'head' ? HEAD_DMG : BODY_DMG) * falloff;
    ctx.damageAgent(result.agent, dmg, result.part, bot);
  }
}

// A loud shot nearby makes bots that cannot see the shooter turn to investigate.
export function hearShot(bots, x, z, shooter) {
  for (const bot of bots) {
    if (!bot.alive || bot === shooter || bot.engageTarget) continue;
    const dx = x - bot.pos.x;
    const dz = z - bot.pos.z;
    if (dx * dx + dz * dz > HEAR_DIST * HEAR_DIST) continue;
    bot.route = findRoute(bot.pos.x, bot.pos.z, x, z);
    bot.routeIndex = 0;
    bot.state = 'route';
  }
}

export function stepBots(bots, dt, ctx, random) {
  for (const bot of bots) stepBot(bot, dt, ctx, random);
}

export function countAlive(bots, team) {
  let n = 0;
  for (const bot of bots) if (bot.alive && bot.team === team) n += 1;
  return n;
}
