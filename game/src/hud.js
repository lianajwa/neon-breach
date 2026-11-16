// The DOM HUD: health and armor bars, money, ammo, round timer and score, kill feed,
// a top-down minimap, a crosshair that widens with spread, a hitmarker, round banners,
// the plant/defuse progress bar and the buy menu. It never touches the simulation;
// main.js pushes numbers in and reads button callbacks out.
import { BUY_ITEMS } from './economy.js';

const COPY = {
  start: {
    title: 'NEON BREACH',
    copy: 'Tactical strike in Sector 7. Plant the beacon at A or B, or eliminate the CRIMSON squad. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'NEON BREACH',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchWin: {
    title: 'MATCH WON',
    copy: 'AZURE takes Sector 7.',
    action: 'Play again',
  },
  matchLose: {
    title: 'MATCH LOST',
    copy: 'CRIMSON holds Sector 7.',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorFill = $('armor-fill');
  const armorNum = $('armor-num');
  const moneyEl = $('money');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const timerEl = $('timer');
  const scoreAzure = $('score-azure');
  const scoreCrimson = $('score-crimson');
  const roundLabel = $('round-label');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const hintEl = $('hint');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyList = $('buy-list');
  const damageEl = $('damage');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  // Build the buy menu buttons once.
  for (const item of BUY_ITEMS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.buy = item.id;
    button.innerHTML = `<b>${item.name}</b><span>$${item.price.toLocaleString('en-US')}</span><i>${item.desc}</i>`;
    buyList.appendChild(button);
  }

  function setText(el, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp) {
      setText(healthNum, String(Math.max(0, Math.ceil(hp))), 'hp');
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
    },
    setArmor(value) {
      setText(armorNum, String(Math.max(0, Math.ceil(value))), 'armor');
      armorFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    },
    setMoney(value) {
      setText(moneyEl, `$${value.toLocaleString('en-US')}`, 'money');
      setText(buyMoney, `$${value.toLocaleString('en-US')}`, 'buyMoney');
    },
    setAmmo(mag, reserve) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
    },
    setWeapon(name, grenades) {
      setText(weaponName, name, 'weapon');
      setText(grenadeCount, grenades > 0 ? `◉ ${grenades}` : '', 'grenades');
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerEl, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 'timer');
      timerEl.classList.toggle('low', seconds <= 10);
    },
    setScore(azure, crimson, round) {
      setText(scoreAzure, String(azure), 'sa');
      setText(scoreCrimson, String(crimson), 'sc');
      setText(roundLabel, `ROUND ${round}`, 'round');
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageEl.classList.add('on');
      setTimeout(() => damageEl.classList.remove('on'), 120);
    },
    killFeed(text) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      entry.textContent = text;
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => entry.classList.add('fade'), 4200);
    },
    showBanner(text, sub, good, holdMs = 3800) {
      bannerTitle.textContent = text;
      bannerSub.textContent = sub;
      banner.classList.toggle('good', good);
      banner.classList.toggle('bad', !good);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      if (holdMs > 0) bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    hideBanner() { banner.hidden = true; },
    showPlant(label, progress) {
      plantWrap.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hidePlant() { plantWrap.hidden = true; },
    showHint(text) {
      hintEl.textContent = text;
      hintEl.hidden = false;
    },
    hideHint() { hintEl.hidden = true; },
    showBuy(open) {
      buyMenu.hidden = !open;
    },
    resetBuy() {
      for (const button of buyList.querySelectorAll('.buy-item')) button.classList.remove('owned');
    },
    markBought(id, owned) {
      for (const button of buyList.querySelectorAll('.buy-item')) {
        if (button.dataset.buy === id) button.classList.toggle('owned', owned);
      }
    },
    onBuy(handler) {
      buyList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (button) handler(button.dataset.buy);
      });
    },
    drawMinimap(data) {
      const w = minimap.width;
      const h = minimap.height;
      const sx = w / 46;
      const sz = h / 36;
      const px = (x) => (x + 23) * sx;
      const pz = (z) => (z + 18) * sz;
      mapCtx.clearRect(0, 0, w, h);
      mapCtx.fillStyle = 'rgba(16,19,24,0.85)';
      mapCtx.fillRect(0, 0, w, h);
      // Walls.
      mapCtx.fillStyle = '#39414d';
      for (const c of data.walls) {
        mapCtx.fillRect(px(c[0]), pz(c[1]), (c[2] - c[0]) * sx, (c[3] - c[1]) * sz);
      }
      // Sites.
      for (const site of data.sites) {
        mapCtx.fillStyle = site.planted ? '#ff4d5e' : 'rgba(240,168,48,0.5)';
        mapCtx.fillRect(px(site.minX), pz(site.minZ), (site.maxX - site.minX) * sx, (site.maxZ - site.minZ) * sz);
        mapCtx.fillStyle = '#101318';
        mapCtx.font = 'bold 9px sans-serif';
        mapCtx.fillText(site.name, px(site.minX) + 3, pz(site.minZ) + 11);
      }
      // Enemies the team can see.
      for (const e of data.enemies) {
        mapCtx.fillStyle = '#ff4d5e';
        mapCtx.beginPath();
        mapCtx.arc(px(e.x), pz(e.z), 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // Teammates.
      for (const t of data.teammates) {
        mapCtx.fillStyle = '#3fa9f5';
        mapCtx.beginPath();
        mapCtx.arc(px(t.x), pz(t.z), 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // Player arrow.
      mapCtx.save();
      mapCtx.translate(px(data.player.x), pz(data.player.z));
      mapCtx.rotate(Math.atan2(Math.sin(data.player.yaw), Math.cos(data.player.yaw)) + Math.PI);
      mapCtx.fillStyle = '#e9e6df';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -5);
      mapCtx.lineTo(3.5, 4);
      mapCtx.lineTo(-3.5, 4);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'matchWin' || mode === 'matchLose'
        ? `${text.copy} Final score ${score.azure} — ${score.crimson}.`
        : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
