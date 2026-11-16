// The arsenal: five buyable weapons plus a frag grenade. Each weapon owns its numbers —
// damage, headshot multiplier, magazine, fire rate, reload time, spread still/moving and
// price — and its view model, a box-built gun that kicks and flashes. main.js owns the
// ray and the damage; this module only decides whether a shot may happen and how wide it is.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 1, price: 0, auto: false,
    damage: 34, headMult: 2, mag: 12, reserve: 48, fireGap: 0.16, reloadTime: 1.4,
    spreadStill: 0.004, spreadMoving: 0.02, kick: 0.011, range: 60,
    length: 0.3, barrel: 0.16, sound: 'pistol',
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', slot: 2, price: 1500, auto: true,
    damage: 26, headMult: 2, mag: 32, reserve: 128, fireGap: 0.075, reloadTime: 1.8,
    spreadStill: 0.007, spreadMoving: 0.032, kick: 0.008, range: 45,
    length: 0.42, barrel: 0.26, sound: 'smg',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Vandal', slot: 3, price: 2700, auto: true,
    damage: 33, headMult: 4, mag: 25, reserve: 75, fireGap: 0.1, reloadTime: 2.1,
    spreadStill: 0.0022, spreadMoving: 0.028, kick: 0.013, range: 80,
    length: 0.55, barrel: 0.38, sound: 'rifle',
  },
  sniper: {
    id: 'sniper', name: 'LW-50 Longshot', slot: 4, price: 4750, auto: false,
    damage: 115, headMult: 2, mag: 5, reserve: 15, fireGap: 1.15, reloadTime: 2.8,
    spreadStill: 0.0006, spreadMoving: 0.06, kick: 0.045, range: 120,
    length: 0.72, barrel: 0.55, sound: 'sniper', scoped: true,
  },
};

export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, damage: 120, radius: 6, fuse: 1.6 };

const DARK = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
const STEEL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
const WOOD = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.crate), roughness: 0.8, metalness: 0.05 });

function buildViewModel(def) {
  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, def.length), DARK);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), STEEL);
  barrel.position.set(0, 0.025, -def.length / 2 - def.barrel / 2 + 0.05);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), WOOD);
  stock.position.set(0, -0.02, def.length / 2 + 0.06);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), DARK);
  grip.position.set(0, -0.1, 0.08);
  grip.rotation.x = 0.3;
  model.add(receiver, barrel, stock, grip);
  if (def.scoped) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), DARK);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.05);
    model.add(scope);
  }
  model.scale.setScalar(0.72);
  model.position.set(0.25, -0.23, -0.5);
  return model;
}

export function createArsenal(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.25, -0.21, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.25, -0.19, -0.7);
  camera.add(flashLight);

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const state = {
    current: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    scoped: false,
    owned: { pistol: true },
    grenades: 0,
    // Per-weapon ammo so switching back keeps the magazine you left.
    ammo: { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } },
  };
  models.pistol.visible = true;

  function def() {
    return WEAPONS[state.current];
  }

  function syncModel() {
    for (const [id, model] of Object.entries(models)) model.visible = id === state.current;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        state.ammo[state.current] = { mag: state.mag, reserve: state.reserve };
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def().mag || state.reserve === 0) return false;
      state.reloadLeft = def().reloadTime;
      return true;
    },
    // Spread in radians: still and aimed is a laser, moving and spraying is a hose.
    spread(speed, aiming, scoped) {
      const d = def();
      const move = Math.min(1, speed / 5.2);
      let spread = d.spreadStill + move * d.spreadMoving;
      if (aiming) spread *= 0.45;
      if (scoped) spread *= 0.35;
      return spread;
    },
    equip(id) {
      if (!state.owned[id] || state.current === id) return false;
      state.ammo[state.current] = { mag: state.mag, reserve: state.reserve };
      state.current = id;
      const saved = state.ammo[id] ?? { mag: def().mag, reserve: def().reserve };
      state.mag = saved.mag;
      state.reserve = saved.reserve;
      state.reloadLeft = 0;
      state.cooldown = 0.25;
      state.scoped = false;
      syncModel();
      return true;
    },
    buy(id) {
      if (state.owned[id]) return false;
      state.owned[id] = true;
      state.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    refill() {
      state.current = 'pistol';
      state.owned = { pistol: true };
      state.grenades = 0;
      state.ammo = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
      state.mag = WEAPONS.pistol.mag;
      state.reserve = WEAPONS.pistol.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.scoped = false;
      syncModel();
    },
    // After a round survived: keep owned guns, top the reserve up a little.
    keepAlive() {
      state.ammo[state.current] = { mag: state.mag, reserve: state.reserve };
      for (const id of Object.keys(state.owned)) {
        const saved = state.ammo[id];
        if (saved) saved.reserve = WEAPONS[id].reserve;
      }
    },
  };
}
