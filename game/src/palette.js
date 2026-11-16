// The look plan, in one place. A dusk foundry: dark slate, warm hazard amber for the
// attackers' side, cold cyan for the defenders' side, one red for danger. The same names
// are the CSS custom properties in index.html, so the HUD and the 3D scene never drift.
export const PALETTE = {
  canvas: '#101318',
  surface: '#1c2129',
  hairline: '#2e3540',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  azure: '#3fa9f5',
  crimson: '#ff4d5e',
  site: '#f0a830',
  ground: '#2b303a',
  wall: '#4a5364',
  fog: '#181c22',
  crate: '#4a4234',
  crateDark: '#33302a',
  glow: '#ffb347',
};

export function shade(name) {
  return PALETTE[name];
}
