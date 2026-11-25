import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

type BrowserTarget = 'chrome' | 'firefox';

function resolveTarget(mode: string): BrowserTarget {
  return mode === 'firefox' ? 'firefox' : 'chrome';
}

function manifestPlugin(target: BrowserTarget): Plugin {
  return {
    name: 'clear-cookie-manifest',
    writeBundle(options) {
      const outDir = options.dir
        ? path.resolve(options.dir)
        : path.resolve(process.cwd(), 'dist', target);
      const basePath = path.resolve(process.cwd(), 'manifests', 'base.json');
      const targetPath = path.resolve(process.cwd(), 'manifests', `${target}.json`);

      const base = JSON.parse(fs.readFileSync(basePath, 'utf8')) as Record<string, unknown>;
      const overlay = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as Record<string, unknown>;
      const merged = { ...base, ...overlay };

      fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        JSON.stringify(merged, null, 2) + '\n',
        'utf8',
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = resolveTarget(mode);
  const rootDir = process.cwd();

  return {
    base: './',
    publicDir: 'public',
    define: {
      __BROWSER_TARGET__: JSON.stringify(target),
    },
    plugins: [manifestPlugin(target)],
    build: {
      outDir: path.resolve(rootDir, 'dist', target),
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild',
      target: 'es2022',
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: path.resolve(rootDir, 'popup.html'),
          sidepanel: path.resolve(rootDir, 'sidepanel.html'),
          devtools: path.resolve(rootDir, 'devtools.html'),
          'devtools-panel': path.resolve(rootDir, 'devtools-panel.html'),
          options: path.resolve(rootDir, 'options.html'),
          background: path.resolve(rootDir, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
