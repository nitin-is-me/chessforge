import { build } from 'esbuild';
import path from 'node:path';

const root = process.cwd();

await build({
  entryPoints: [path.join(root, 'server/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(root, 'dist/server/server.js'),
  absWorkingDir: root,
  packages: 'external',
  alias: { '@shared': path.join(root, 'shared') },
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __cfCreateRequire } from 'module'; const require = __cfCreateRequire(import.meta.url);",
  },
});
