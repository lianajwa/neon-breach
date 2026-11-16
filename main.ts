// NEON BREACH — entrypoint for the make.fun three.js tactical FPS bounty.
// What this file does, in three moves: mirror game/ and screenshots/ into the
// output folder, then ask the vendored make.fun library to describe that folder
// as a dossier and save the description next to the game. Nothing here fetches
// anything from the network and nothing is built; the game ships as static files.

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier as makeDossier } from './vendor/makefun-threejs.ts';

// The folder this file lives in, so the game is found even when the command
// is run from somewhere else.
const home = dirname(fileURLToPath(import.meta.url));

// Where the finished entry goes: the environment's choice, else /output.
const target = (process.env.MAKEFUN_OUTPUT_DIR ?? '').trim() || '/output';

// Copy a tree by hand, file by file, so the output holds exactly what the
// repository holds — no extra files, none missing. Returns how many files
// it copied, so the run can say what it did.
function mirror(fromDir: string, toDir: string): number {
  mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const child of readdirSync(fromDir, { withFileTypes: true })) {
    const src = join(fromDir, child.name);
    const dst = join(toDir, child.name);
    if (child.isDirectory()) copied += mirror(src, dst);
    else if (child.isFile()) {
      copyFileSync(src, dst);
      copied++;
    }
  }
  return copied;
}

// The gates the bounty sets for the dossier: how much source text it may
// carry, how many screenshots and how big each may be, and how large game/
// may grow. Written as arithmetic so the numbers stay readable.
const caps = {
  text_max_bytes: 160 * 1024,
  screenshots: { max: 4, max_bytes: 256 * 1024 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
};

const gameFiles = mirror(join(home, 'game'), join(target, 'game'));
const shotFiles = mirror(join(home, 'screenshots'), join(target, 'screenshots'));

const dossier = makeDossier(target, caps);
const dossierPath = join(target, 'dossier.json');
writeFileSync(dossierPath, dossier);
console.log(`NEON BREACH entry ready in ${target}: ${gameFiles} game files, ${shotFiles} screenshots, dossier ${dossier.length} bytes`);
