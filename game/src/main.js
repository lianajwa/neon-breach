// NEON BREACH — Tactical Strike. Boot and the one loop: a fixed 60 Hz simulation feeding
// a render at the display's rate. Phases: menu -> buy -> deploy -> round -> roundEnd ->
// buy ... -> matchEnd. First to 5 rounds takes the match. Attackers (AZURE, the player)
// plant a beacon at site A or B; defenders (CRIMSON) hold the sites and defuse.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, insideSite, hasLineOfSight } from './world.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS, GRENADE } from './weapons.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createEconomy, WIN_REWARD, LOSS_REWARD, KILL_REWARD, PLANT_REWARD, ARMOR_PRICE, ARMOR_VALUE, BUY_ITEMS } from './economy.js';
import { createCombat } from './combat.js';
import { createBot, resetBot, planRound, stepBots, countAlive, hearShot } from './bots.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 12;
const PLANT_TIME = 3.5;
const BEACON_TIME = 35;
const WIN_ROUNDS = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Dusk sky: a procedural vertical gradient, dark zenith to an amber horizon band.
function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0b0d12');
  grad.addColorStop(0.55, '#1a212b');
  grad.addColorStop(0.72, '#3a2f22');
  grad.addColorStop(0.78, '#6b4a22');
  grad.addColorStop(1, '#101318');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const combat = createCombat(scene, world.shootables);
const arsenal = createArsenal(camera);
const hud = createHud();
const audio = createAudio();
const economy = createEconomy();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const rayDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// Beacon visual: a glowing amber pylon that appears where the beacon is planted.
const beaconMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.38, 1.1, 10),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
const beaconLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 10);
beaconMesh.visible = false;
scene.add(beaconMesh, beaconLight);

// The two teams. The player is agent zero of AZURE.
const bots = [];
for (let i = 0; i < 4; i += 1) bots.push(createBot(scene, 'azure', i, SPAWNS.azure[i + 1]));
for (let i = 0; i < 5; i += 1) bots.push(createBot(scene, 'crimson', i, SPAWNS.crimson[i]));
const playerAgent = {
  kind: 'player', name: 'You', team: 'azure',
  pos: player.state.position, height: 1.72, eye: 1.6, alive: true,
};
const agents = [playerAgent, ...bots];

const game = {
  phase: 'menu',
  phaseTime: 0,
  round: 1,
  score: { azure: 0, crimson: 0 },
  roundTime: ROUND_TIME,
  buyTime: BUY_TIME,
  beacon: { state: 'none', site: null, timer: 0 },
  playerHp: 100,
  playerArmor: 0,
  plantProgress: 0,
  beepTimer: 0,
  minimapTimer: 0,
  grenadeCooldown: 0,
  spectate: null,
  roundEnded: false,
};
let started = false;
let paused = false;
let frozen = false;
let prevFiring = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;

const minimapWalls = world.colliders
  .filter((c) => c.max.y > 0.5)
  .map((c) => [c.min.x, c.min.z, c.max.x, c.max.z]);

function aliveCount(team) {
  let n = 0;
  for (const agent of agents) if (agent.alive && agent.team === team) n += 1;
  return n;
}

function otherAgents(shooter) {
  // No friendly fire: a shot only ever tests enemies.
  return agents.filter((a) => a !== shooter && a.alive && a.team !== shooter.team);
}

function killFeed(killer, victim, part) {
  const head = part === 'head' ? ' ☠ HEADSHOT' : '';
  hud.killFeed(`${killer.name} ▸ ${victim.name}${head}`);
}

function damageAgent(agent, dmg, part, source) {
  if (!agent.alive) return;
  if (agent.kind === 'player') {
    let remaining = dmg;
    if (game.playerArmor > 0) {
      const absorbed = Math.min(game.playerArmor, remaining * 0.5);
      game.playerArmor -= absorbed;
      remaining -= absorbed;
    }
    game.playerHp -= remaining;
    hud.damageFlash();
    audio.hurt();
    hud.setHealth(game.playerHp);
    hud.setArmor(game.playerArmor);
    if (game.playerHp <= 0) {
      game.playerHp = 0;
      playerAgent.alive = false;
      game.spectate = bots.find((b) => b.alive && b.team === 'azure') ?? null;
      hud.showHint(game.spectate ? `You are down — spectating ${game.spectate.name}` : 'You are down');
      // Keep the pointer lock: the camera follows a teammate and the round plays on.
      checkRoundEnd();
    }
    return;
  }
  agent.hp -= dmg;
  if (agent.hp <= 0) {
    agent.hp = 0;
    agent.alive = false;
    agent.group.rotation.set(0, agent.yaw, Math.PI / 2);
    agent.group.position.y = 0.25;
    killFeed(source ?? { name: '?' }, agent, part);
    if (source && source.kind === 'player') {
      economy.add(KILL_REWARD);
      hud.setMoney(economy.money);
      audio.kill();
    }
    checkRoundEnd();
  }
}

function checkRoundEnd() {
  if (game.phase !== 'round' || game.roundEnded) return;
  const azureAlive = aliveCount('azure');
  const crimsonAlive = aliveCount('crimson');
  if (game.beacon.state === 'planted') {
    if (crimsonAlive === 0 && game.beacon.timer > 5) game.beacon.timer = 5;
    return; // The round only ends by explosion or defuse now.
  }
  if (azureAlive === 0) endRound('crimson', 'AZURE eliminated');
  else if (crimsonAlive === 0) endRound('azure', 'CRIMSON eliminated');
}

function endRound(winner, reason) {
  if (game.roundEnded) return;
  game.roundEnded = true;
  game.score[winner] += 1;
  const won = winner === 'azure';
  economy.add(won ? WIN_REWARD : LOSS_REWARD);
  hud.setMoney(economy.money);
  hud.setScore(game.score.azure, game.score.crimson, game.round);
  hud.showBanner(
    won ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — ${won ? `+$${WIN_REWARD}` : `+$${LOSS_REWARD}`}`,
    won,
  );
  if (won) audio.roundWin();
  else audio.roundLose();
  if (playerAgent.alive) arsenal.keepAlive();
  game.phase = 'roundEnd';
  game.phaseTime = 0;
  hud.hidePlant();
  hud.hideHint();
  // Release the pointer so the buy menu is clickable when it opens.
  if (document.pointerLockElement) document.exitPointerLock();
}

function resetPositions() {
  player.state.position.set(SPAWNS.azure[0][0], 0, SPAWNS.azure[0][1]);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0;
  player.state.pitch = 0;
  playerAgent.alive = true;
  playerAgent.eye = 1.6;
  game.playerHp = 100;
  game.spectate = null;
  bots.forEach((bot, i) => {
    const spawn = bot.team === 'azure' ? SPAWNS.azure[i + 1] : SPAWNS.crimson[i - 4];
    resetBot(bot, spawn);
  });
  beaconMesh.visible = false;
  beaconLight.intensity = 0;
  game.beacon = { state: 'none', site: null, timer: 0 };
  game.plantProgress = 0;
  combat.clearGrenades();
}

function startBuy() {
  resetPositions();
  game.phase = 'buy';
  game.phaseTime = 0;
  game.buyTime = BUY_TIME;
  game.roundEnded = false;
  if (document.pointerLockElement) document.exitPointerLock();
  bots.forEach((bot, i) => planRound(bot, bot.team === 'azure' ? i : i - 4, random));
  hud.setScore(game.score.azure, game.score.crimson, game.round);
  hud.setTimer(game.buyTime);
  hud.setHealth(game.playerHp);
  hud.setArmor(game.playerArmor);
  hud.setMoney(economy.money);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  hud.setWeapon(arsenal.def().name, arsenal.state.grenades);
  hud.showBuy(true);
  hud.resetBuy();
  hud.hideBanner();
  hud.showHint('Buy phase — click a weapon, then DEPLOY (or press Enter)');
}

function deploy() {
  hud.showBuy(false);
  hud.hideHint();
  game.phase = 'round';
  game.phaseTime = 0;
  game.roundTime = ROUND_TIME;
  hud.setTimer(game.roundTime);
  audio.unlock();
  input.requestLock();
}

function startMatch() {
  game.score = { azure: 0, crimson: 0 };
  game.round = 1;
  economy.reset();
  arsenal.refill();
  game.playerArmor = 0;
  started = true;
  hud.hideOverlay();
  startBuy();
}

function endMatch() {
  game.phase = 'matchEnd';
  const won = game.score.azure > game.score.crimson;
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showOverlay(won ? 'matchWin' : 'matchLose', game.score);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    paused = false;
    hud.hideOverlay();
  } else if (game.phase === 'round' && playerAgent.alive) {
    // Losing the lock mid-round pauses — unless the player is down spectating,
    // in which case the round plays on behind the spectate camera.
    paused = true;
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.phase === 'menu' || game.phase === 'matchEnd') startMatch();
  else if (game.phase === 'deploy') deploy();
  else if (paused) input.requestLock();
});

document.getElementById('deploy').addEventListener('click', () => {
  if (shot) return;
  if (game.phase === 'buy') deploy();
});

hud.onBuy((id) => {
  if (game.phase !== 'buy') return;
  const item = BUY_ITEMS.find((b) => b.id === id);
  if (!item) return;
  if (id === 'armor') {
    if (game.playerArmor >= ARMOR_VALUE || !economy.spend(item.price)) { audio.denied(); return; }
    game.playerArmor = ARMOR_VALUE;
    hud.setArmor(game.playerArmor);
  } else if (id === 'grenade') {
    if (arsenal.state.grenades >= 2 || !economy.spend(item.price)) { audio.denied(); return; }
    arsenal.state.grenades += 1;
  } else {
    if (arsenal.state.owned[id] || !economy.spend(item.price)) { audio.denied(); return; }
    arsenal.buy(id);
    arsenal.equip(id);
    hud.markBought(id, true);
  }
  audio.buy();
  hud.setMoney(economy.money);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  hud.setWeapon(arsenal.def().name, arsenal.state.grenades);
});

// --- Bot context: the game object the bots call back into ---
const botCtx = {
  get now() { return elapsed; },
  agents,
  sightBlockers: world.sightBlockers,
  colliders: world.colliders,
  combat,
  get beacon() { return game.beacon; },
  get playerSpeed() { return player.groundSpeed(); },
  onBotShot(bot) {
    const dist = Math.hypot(bot.pos.x - player.state.position.x, bot.pos.z - player.state.position.z);
    if (dist < 42) audio.shot('enemy');
  },
  damageAgent,
  onChannel(bot, kind, progress) {
    if (bot.team === 'azure') {
      hud.showHint(kind === 'plant' ? `${bot.name} is planting the beacon…` : `${bot.name} is defusing…`);
      hud.showPlant(kind === 'plant' ? 'PLANTING BEACON' : 'DEFUSING', progress);
    }
  },
  onPlanted(bot, site) {
    game.beacon = { state: 'planted', site: site.name, timer: BEACON_TIME };
    const siteDef = SITES[site.name];
    beaconMesh.position.set(siteDef.cx, 0.55, siteDef.cz);
    beaconMesh.visible = true;
    beaconLight.position.set(siteDef.cx, 1.5, siteDef.cz);
    beaconLight.intensity = 24;
    audio.plantDone();
    hud.showBanner('BEACON PLANTED', `${bot.name} planted at site ${site.name} — defend it`, true);
    hud.killFeed(`${bot.name} planted the beacon at ${site.name}`);
    hud.hidePlant();
  },
  onDefused(bot) {
    hud.killFeed(`${bot.name} defused the beacon`);
    endRound('crimson', 'Beacon defused');
  },
};

function syncCamera() {
  if (!playerAgent.alive && game.spectate) {
    const target = game.spectate;
    camera.position.set(target.pos.x, target.pos.y + target.eye, target.pos.z);
    camera.rotation.set(0, target.yaw + Math.PI, 0, 'YXZ');
    return;
  }
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function playerShoot() {
  const def = arsenal.def();
  if (!arsenal.takeRound()) {
    audio.dryFire();
    arsenal.reload();
    return;
  }
  camera.getWorldDirection(rayDir);
  const spread = arsenal.spread(player.groundSpeed(), player.state.aiming, arsenal.state.scoped);
  rayDir.x += (random() * 2 - 1) * spread;
  rayDir.y += (random() * 2 - 1) * spread;
  rayDir.z += (random() * 2 - 1) * spread;
  rayDir.normalize();
  const result = combat.shoot(camera.position, rayDir, def.range, otherAgents(playerAgent));
  muzzlePos.copy(camera.position).addScaledVector(rayDir, 0.6);
  muzzlePos.x += Math.cos(player.state.yaw) * 0.24;
  muzzlePos.z -= Math.sin(player.state.yaw) * 0.24;
  muzzlePos.y -= 0.16;
  combat.spawnTracer(muzzlePos, result.point);
  audio.shot(def.sound);
  arsenal.pullTrigger();
  player.recoil(def.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  hearShot(bots, player.state.position.x, player.state.position.z, null);
  if (result.kind === 'agent' && result.agent) {
    const dmg = result.part === 'head' ? def.damage * def.headMult : def.damage;
    damageAgent(result.agent, dmg, result.part, playerAgent);
    hud.hitMarker(result.agent.hp <= 0, shot ? 4000 : 90);
    if (result.agent.hp > 0) audio.hit();
  }
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  if (arsenal.state.mag === 0) arsenal.reload();
}

function throwPlayerGrenade() {
  if (arsenal.state.grenades <= 0 || game.grenadeCooldown > 0) return;
  arsenal.state.grenades -= 1;
  game.grenadeCooldown = 0.8;
  camera.getWorldDirection(rayDir);
  tmpVec.copy(camera.position).addScaledVector(rayDir, 0.5);
  combat.throwGrenade(tmpVec, rayDir, playerAgent);
  audio.grenadeThrow();
  hud.setWeapon(arsenal.def().name, arsenal.state.grenades);
}

function explodeGrenade(event) {
  audio.explosion();
  for (const agent of agents) {
    if (!agent.alive || agent.team === event.owner.team) continue; // No friendly fire.
    const dist = Math.hypot(agent.pos.x - event.pos.x, agent.pos.z - event.pos.z);
    if (dist < GRENADE.radius) {
      const dmg = Math.max(20, GRENADE.damage * (1 - dist / GRENADE.radius));
      damageAgent(agent, dmg, 'body', event.owner);
    }
  }
}

function updatePlant(dt) {
  if (game.phase !== 'round' || !playerAgent.alive || game.beacon.state !== 'none') {
    if (game.plantProgress > 0) { game.plantProgress = 0; hud.hidePlant(); }
    return;
  }
  const site = Object.values(SITES).find((s) => insideSite(s, player.state.position.x, player.state.position.z));
  if (site && input.state.keys.has('KeyE')) {
    game.plantProgress += dt / PLANT_TIME;
    hud.showPlant(`PLANTING BEACON — SITE ${site.name}`, game.plantProgress);
    game.beepTimer -= dt;
    if (game.beepTimer <= 0) { audio.plantBeep(); game.beepTimer = 0.5; }
    if (game.plantProgress >= 1) {
      game.plantProgress = 0;
      hud.hidePlant();
      economy.add(PLANT_REWARD);
      hud.setMoney(economy.money);
      botCtx.onPlanted(playerAgent, site);
    }
  } else if (game.plantProgress > 0) {
    game.plantProgress = 0;
    hud.hidePlant();
  }
}

function step(dt) {
  elapsed += dt;
  game.phaseTime += dt;
  game.grenadeCooldown = Math.max(0, game.grenadeCooldown - dt);

  if (game.phase === 'buy') {
    game.buyTime -= dt;
    hud.setTimer(Math.max(0, game.buyTime));
    if (game.buyTime <= 0) {
      game.phase = 'deploy';
      hud.showBuy(false);
      hud.hideHint();
      hud.showOverlay('paused');
      // Reuse the paused overlay as the deploy prompt: rewrite its copy.
      document.getElementById('overlay-title').textContent = 'NEON BREACH';
      document.getElementById('overlay-copy').textContent = 'Buy phase over. Click to deploy into round ' + game.round + '.';
      document.getElementById('play').textContent = 'Deploy';
    }
  } else if (game.phase === 'round') {
    game.roundTime -= dt;
    hud.setTimer(game.roundTime);
    if (game.roundTime <= 0 && game.beacon.state === 'none') {
      endRound('crimson', 'Time expired — beacon never planted');
    }
    if (game.beacon.state === 'planted') {
      game.beacon.timer -= dt;
      beaconMesh.scale.y = 1 + Math.sin(elapsed * 6) * 0.08;
      beaconLight.intensity = 20 + Math.sin(elapsed * 6) * 8;
      game.beepTimer -= dt;
      if (game.beepTimer <= 0) {
        audio.plantBeep();
        game.beepTimer = game.beacon.timer < 10 ? 0.5 : 1;
      }
      if (game.beacon.timer <= 0) {
        audio.explosion();
        endRound('azure', 'Beacon detonated');
      }
    }
    updatePlant(dt);
  } else if (game.phase === 'roundEnd') {
    if (game.phaseTime >= 4) {
      if (game.score.azure >= WIN_ROUNDS || game.score.crimson >= WIN_ROUNDS) {
        endMatch();
      } else {
        game.round += 1;
        startBuy();
      }
    }
  }

  // Simulation runs during buy (idle bots stand) and round (full combat).
  if (game.phase === 'round' || game.phase === 'buy' || game.phase === 'roundEnd') {
    if (game.phase === 'round') {
      player.step(dt, input.state.keys);
      stepBots(bots, dt, botCtx, random);
      if (playerAgent.alive && player.groundSpeed() > 0.5 && player.state.onGround) audio.step(elapsed);
    }
    arsenal.step(dt);
    combat.stepTracers(dt);
    const events = combat.stepGrenades(dt, agents);
    for (const event of events) explodeGrenade(event);
  }

  // Scope: right mouse with the sniper narrows the field of view.
  const wantScoped = arsenal.state.current === 'sniper' && input.state.aiming && playerAgent.alive;
  if (wantScoped !== arsenal.state.scoped) {
    arsenal.state.scoped = wantScoped;
    camera.fov = wantScoped ? 30 : 74;
    camera.updateProjectionMatrix();
  }
}

function handleKeys() {
  if (input.wasPressed('KeyM')) {
    const muted = audio.toggleMute();
    hud.showHint(muted ? 'Sound muted (M)' : 'Sound on (M)');
    setTimeout(() => { if (game.phase === 'round') hud.hideHint(); }, 1200);
  }
  if (input.wasPressed('KeyP') && game.phase === 'round' && document.pointerLockElement) {
    document.exitPointerLock();
  }
  if (game.phase === 'buy') {
    if (input.wasPressed('Enter')) deploy();
    if (input.wasPressed('KeyB')) hud.showBuy(document.getElementById('buy-menu').hidden);
    // Keyboard buying: 1-5 map to the buy list in order, through the same handler
    // the buttons use, so a click and a keypress can never disagree.
    for (let i = 0; i < BUY_ITEMS.length; i += 1) {
      if (input.wasPressed(`Digit${i + 1}`)) {
        document.querySelector(`[data-buy="${BUY_ITEMS[i].id}"]`)?.click();
      }
    }
  }
  if (game.phase === 'round' && playerAgent.alive && !paused) {
    const slots = ['pistol', 'smg', 'rifle', 'sniper'];
    for (let i = 0; i < slots.length; i += 1) {
      if (input.wasPressed(`Digit${i + 1}`) && arsenal.equip(slots[i])) {
        hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
        hud.setWeapon(arsenal.def().name, arsenal.state.grenades);
        audio.click();
      }
    }
    if (input.wasPressed('KeyR') && arsenal.reload()) audio.reload();
    if (input.wasPressed('KeyG')) throwPlayerGrenade();
  }
  input.drainPressed();
}

function updateHud() {
  const spreadPx = 4 + arsenal.spread(player.groundSpeed(), player.state.aiming, arsenal.state.scoped) * 900;
  hud.setSpread(Math.min(34, spreadPx));
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  game.minimapTimer -= 1 / 60;
  if (game.minimapTimer <= 0) {
    game.minimapTimer = 0.12;
    const enemies = [];
    for (const bot of bots) {
      if (!bot.alive || bot.team !== 'crimson') continue;
      // Shown only while some AZURE agent has line of sight on them.
      let seen = false;
      for (const seer of agents) {
        if (!seer.alive || seer.team !== 'azure') continue;
        if (Math.hypot(bot.pos.x - seer.pos.x, bot.pos.z - seer.pos.z) > 55) continue;
        if (hasLineOfSight(seer.pos.x, seer.pos.z, bot.pos.x, bot.pos.z, world.sightBlockers)) {
          seen = true;
          break;
        }
      }
      if (seen) enemies.push({ x: bot.pos.x, z: bot.pos.z });
    }
    hud.drawMinimap({
      walls: minimapWalls,
      sites: Object.values(SITES).map((s) => ({
        name: s.name, minX: s.minX, minZ: s.minZ, maxX: s.maxX, maxZ: s.maxZ,
        planted: game.beacon.state === 'planted' && game.beacon.site === s.name,
      })),
      player: { x: player.state.position.x, z: player.state.position.z, yaw: player.state.yaw },
      teammates: bots.filter((b) => b.alive && b.team === 'azure').map((b) => ({ x: b.pos.x, z: b.pos.z })),
      enemies,
    });
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (!paused && started) {
      const look = input.takeLook();
      if (playerAgent.alive) player.look(look.x, look.y);
      handleKeys();
      // Semi-auto weapons fire once per click; autos fire while held.
      const firing = input.state.firing && game.phase === 'round' && !paused;
      if (firing && arsenal.ready()) {
        if (arsenal.def().auto || !prevFiring) playerShoot();
      }
      prevFiring = input.state.firing;
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
      updateHud();
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  startMatch();
  hud.showBuy(false); // startBuy opens it; a capture frame never shows it.
  if (name === 'start') {
    // Title frame: player at the AZURE spawn looking up mid, bots holding lanes.
    player.state.position.set(0, 0, 14.5);
    player.state.yaw = 0;
    player.state.pitch = 0;
    bots[4].pos.set(0, 0, 2);
    bots[4].yaw = Math.PI;
    bots[4].group.rotation.y = Math.PI;
    bots[5].pos.set(-4, 0, -4);
    bots[5].yaw = Math.PI * 0.75;
    bots[5].group.rotation.y = bots[5].yaw;
    settle(20);
    hud.hideHint();
    hud.showOverlay('start');
  } else if (name === 'play') {
    // Mid-combat frame: round 2, score 1-0, rifle in hand, an enemy in the crosshair.
    game.score = { azure: 1, crimson: 0 };
    game.round = 2;
    economy.add(3250);
    economy.spend(WEAPONS.rifle.price);
    arsenal.buy('rifle');
    arsenal.equip('rifle');
    hud.setMoney(economy.money);
    hud.setScore(1, 0, 2);
    deploy();
    // Fight down the west lane: the lane wall hides the target from the AZURE
    // teammates at spawn, so they cannot steal the kill mid-capture.
    player.state.position.set(-17, 0, 8);
    player.state.yaw = 0;
    player.state.pitch = 0;
    bots[4].pos.set(-17, 0, 0);
    bots[4].yaw = Math.PI;
    bots[4].group.rotation.y = Math.PI;
    bots[5].pos.set(-17, 0, -6);
    bots[6].pos.set(-17, 0, -11);
    settle(20);
    // Aim at the mid-lane enemy and fire two aimed shots: 66 damage leaves him
    // standing, so the frame shows a live fight, not a corpse.
    for (let round = 0; round < 2; round += 1) {
      const target = bots[4];
      const dx = target.pos.x - player.state.position.x;
      const dy = target.pos.y + 1.2 - (player.state.position.y + player.state.eye);
      const dz = target.pos.z - player.state.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      player.state.yaw = Math.atan2(-dx, -dz);
      player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      syncCamera();
      playerShoot();
      settle(6);
    }
    settle(4);
  } else {
    // Round-end frame: AZURE up 2-1, beacon planted at A, two CRIMSON bots down.
    game.score = { azure: 2, crimson: 1 };
    game.round = 3;
    deploy();
    // Stand at the west connector looking into site A: the planted beacon and the
    // two downed defenders are both in frame, with no wall between.
    player.state.position.set(-13, 0, -4);
    player.state.yaw = 0.46;
    player.state.pitch = -0.02;
    bots[4].alive = false;
    bots[4].hp = 0;
    bots[4].pos.set(-13, 0, -9);
    bots[4].group.rotation.set(0, 1, Math.PI / 2);
    bots[4].group.position.y = 0.25;
    bots[5].alive = false;
    bots[5].hp = 0;
    bots[5].pos.set(-18, 0, -12);
    bots[5].group.rotation.set(0, 2, Math.PI / 2);
    bots[5].group.position.y = 0.25;
    game.beacon = { state: 'planted', site: 'A', timer: 24 };
    beaconMesh.position.set(-16.5, 0.55, -12);
    beaconMesh.visible = true;
    beaconLight.position.set(-16.5, 1.5, -12);
    beaconLight.intensity = 24;
    settle(20);
    hud.setScore(2, 1, 3);
    hud.setTimer(0);
    hud.showBanner('ROUND WON', 'Beacon planted at A — CRIMSON eliminated', true, 0);
  }
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  hud.setWeapon(arsenal.def().name, arsenal.state.grenades);
  hud.setHealth(game.playerHp);
  hud.setArmor(game.playerArmor);
  updateHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setScore(0, 0, 1);
hud.setHealth(100);
hud.setArmor(0);
hud.setMoney(economy.money);
hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
hud.setWeapon(arsenal.def().name, 0);
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
