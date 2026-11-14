import { mkdir, readdir, readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

await mkdir('dist', { recursive: true });
// TypeScript → JS：优先 Node 22.6+ 内置类型剥离；不可用时回退 esbuild（npx）。
let strip;
try {
  strip = (await import('node:module')).stripTypeScriptTypes;
} catch { /* Node < 22.6 */ }
if (typeof strip !== 'function') {
  const probe = spawnSync('npx', ['--no-install', 'esbuild', '--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    console.error('需要 Node 22.6+（stripTypeScriptTypes）或安装 esbuild：npm i -g esbuild');
    process.exit(1);
  }
}
for (const name of await readdir('src')) {
  if (name.endsWith('.ts')) {
    const source = await readFile(path.join('src', name), 'utf8');
    let js;
    if (typeof strip === 'function') {
      js = strip(source, { mode: 'strip' });
    } else {
      const out = spawnSync('npx', ['--no-install', 'esbuild', path.join('src', name), '--format=esm'], { encoding: 'utf8', maxBuffer: 32e6 });
      if (out.status !== 0) { console.error(out.stderr); process.exit(1); }
      js = out.stdout;
    }
    await writeFile(path.join('dist', name.replace(/\.ts$/, '.js')), js);
  } else if (['index.html', 'follow.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'prep.png'].includes(name)) {
    await cp(path.join('src', name), path.join('dist', name));
  } else if (name === 'icons') {
    await cp(path.join('src', 'icons'), path.join('dist', 'icons'), { recursive: true });
  }
}
console.log('RatHeart-SimPro Web built → dist/');
