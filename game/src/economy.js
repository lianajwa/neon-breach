// The economy: money earned per round and per kill, spent in the buy menu. One place
// owns every price and reward so the HUD, the buy menu and the round logic never disagree.
import { WEAPONS, GRENADE } from './weapons.js';

export const START_MONEY = 800;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;
export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 100;

export const BUY_ITEMS = [
  { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price, desc: 'Fast close-range spray. 32-round mag.' },
  { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, desc: 'Accurate all-rounder. 4x headshot damage.' },
  { id: 'sniper', name: WEAPONS.sniper.name, price: WEAPONS.sniper.price, desc: 'One-shot body kills. Right-click to scope.' },
  { id: 'armor', name: 'Kevlar Vest', price: ARMOR_PRICE, desc: '100 armor. Absorbs half of every hit.' },
  { id: 'grenade', name: GRENADE.name, price: GRENADE.price, desc: 'Frag grenade. Press 4 to throw.' },
];

export function createEconomy() {
  let money = START_MONEY;
  return {
    get money() { return money; },
    reset() { money = START_MONEY; },
    add(amount) { money += amount; },
    canAfford(price) { return money >= price; },
    spend(price) {
      if (money < price) return false;
      money -= price;
      return true;
    },
  };
}
