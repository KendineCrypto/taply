// Render local component fixtures using the project's existing Vite toolchain.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const fromVitest = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href);
const server = await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:fileURLToPath(new URL('../vitest.config.mts',import.meta.url)),server:{middlewareMode:true},appType:'custom'});
try {
 const { fixtures } = await server.ssrLoadModule('/scripts/phase7i-fixtures.tsx');
 writeFileSync('apps/web/.next/phase7i-fixtures.json',JSON.stringify(fixtures));
} finally { await server.close(); }
