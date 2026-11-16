# NEON BREACH — Tactical Strike

[![make.fun](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/lianajwa/neon-breach/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/lianajwa/neon-breach/reward.svg)](https://make.fun/bounty/threejs-fps-02)

Entry for the [make.fun](https://make.fun/bounty/threejs-fps-02) bounty
**"Make the best three.js tactical FPS"** (`threejs-fps-02`).

## The game

A round-based tactical shooter in the Counter-Strike style, set in Sector 7 —
a dusk foundry of amber neon, steel crates and three lanes. You are AZURE,
the attacking squad: plant the beacon at site A or site B, or eliminate the
CRIMSON defenders. First to 5 rounds takes the match.

- **Rounds that matter**: buy phase, 100-second rounds, plant/defuse objective,
  round banners and a match end. Win a round, earn $3,250; lose it, $1,900.
- **Money and guns**: a buy menu between rounds — SMG, rifle, sniper, kevlar
  and frag grenades. Weapons stay with you while you survive; die and you
  start the next round with a pistol again.
- **Gunplay where accuracy counts**: spread that grows when you move and
  shrinks when you slow-aim or crouch, recoil on every shot, headshots worth
  up to 4x body damage, a scoped sniper, and magazines that run dry.
- **Bots that fight back**: four AZURE teammates and five CRIMSON defenders
  walk waypoint routes to the sites, hold lanes, react with a human-like delay,
  fire in bursts, strafe while shooting, investigate loud gunfire, plant the
  beacon when a site is clear, and defuse it when you plant.
- **The map**: two beacon sites, west/mid/east lanes, connector gaps, crouch
  cover and tall crates — sightlines worth playing, built from plain geometry.
- **Feel**: tracers, muzzle flashes, a glowing planted beacon, a live minimap,
  a kill feed, a crosshair that widens with spread, and synthesized WebAudio —
  gunshots, footsteps, hits, plant beeps and round jingles, no audio files.

## How to play

| Control | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (click to lock the pointer) |
| Click | Fire (semi-auto weapons fire once per click) |
| Right-click | Scope (sniper only) |
| R | Reload |
| 1–4 | Pistol / SMG / Rifle / Sniper |
| G | Throw frag grenade |
| E (hold) | Plant the beacon inside site A or B |
| Shift | Slow aim (tighter spread) |
| Ctrl / C | Crouch |
| Space | Jump |
| B | Buy menu (buy phase) |
| Enter | Deploy into the round |
| P | Pause |
| M | Mute sound |

## How it is built

Static files under `game/`, ES modules with no build step, three.js 0.187.0
vendored in `game/vendor/three/`. No network requests: every texture is a
flat colour, every sound is synthesized in code.

| Module | Job |
| --- | --- |
| `game/src/main.js` | Boot, fixed 60 Hz loop, phases, rounds, plant/defuse |
| `game/src/world.js` | The map, colliders, waypoint graph, line of sight |
| `game/src/bots.js` | Bot AI: routes, holds, engages, plants, defuses |
| `game/src/combat.js` | Hitscan rays, tracers, grenades |
| `game/src/weapons.js` | The arsenal: stats, view models, spread, reload |
| `game/src/player.js` | Movement: acceleration, crouch, jump, collision |
| `game/src/economy.js` | Money, rewards, buy list |
| `game/src/hud.js` | DOM HUD, minimap, kill feed, buy menu |
| `game/src/audio.js` | Synthesized WebAudio effects |
| `game/src/input.js` | Keyboard, mouse, pointer lock |
| `game/src/palette.js` | The colour plan |

Run it with `node serve.ts` and open http://localhost:8080.
