import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });

const distDir = path.resolve(process.cwd(), 'dist');

function zipDirectory(sourceDir, outFile) {
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  // Use python3 zipfile for deterministic cross-platform zip creation without extra npm deps
  const pyScript = `
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        files.sort()
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src)
            zf.write(full, rel)
`;
  execFileSync('python3', ['-c', pyScript, sourceDir, outFile], { stdio: 'inherit' });
}

const chromeZip = path.join(distDir, 'clear-cookie-chrome.zip');
const firefoxZip = path.join(distDir, 'clear-cookie-firefox.zip');

zipDirectory(path.join(distDir, 'chrome'), chromeZip);
zipDirectory(path.join(distDir, 'firefox'), firefoxZip);

console.log('\nPacked archives:');
console.log(`  - ${path.relative(process.cwd(), chromeZip)}`);
console.log(`  - ${path.relative(process.cwd(), firefoxZip)}`);
