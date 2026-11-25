import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv[2];
const targets = arg === 'chrome' || arg === 'firefox' ? [arg] : ['chrome', 'firefox'];

// Ensure icons exist
const iconCheck = path.resolve(process.cwd(), 'public', 'icons', 'icon-128.png');
if (!fs.existsSync(iconCheck)) {
  execFileSync(process.execPath, ['scripts/generate-icons.mjs'], { stdio: 'inherit' });
}

const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

for (const target of targets) {
  console.log(`\n==> Building ClearCookie for ${target}...`);
  execFileSync(process.execPath, [viteBin, 'build', '--mode', target], {
    stdio: 'inherit',
  });
}

console.log('\nBuild complete:');
for (const target of targets) {
  console.log(`  - dist/${target}`);
}
