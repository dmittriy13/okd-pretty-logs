import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const entries = {
  'ws-hook': 'src/inject/ws-hook.ts',
  'okd-tab-mount': 'src/inject/okd-tab-mount.ts',
};

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await cp('manifest.json', path.join(outdir, 'manifest.json'));
  if (existsSync('icons')) {
    await cp('icons', path.join(outdir, 'icons'), { recursive: true });
  }
}

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome114'],
  logLevel: 'info',
  sourcemap: !watch ? false : 'inline',
  minify: !watch,
  legalComments: 'none',
  loader: { '.css': 'text' },
};

async function buildAll() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await copyStatic();
  const jobs = Object.entries(entries).map(([name, entry]) =>
    (watch ? context : build)({
      ...common,
      entryPoints: [entry],
      outfile: path.join(outdir, `${name}.js`),
    }),
  );
  const results = await Promise.all(jobs);
  if (watch) {
    await Promise.all(results.map((ctx) => ctx.watch()));
    console.log('watching...');
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
