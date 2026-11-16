// Loads oneclick-live-dry.ts through the repo's Vite/Vitest resolver (aliases), like phase7i-fixtures.mjs.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const fromVitest = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: fileURLToPath(new URL('../vitest.config.mts', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', ssr: { noExternal: [] } });
const out = process.argv[2] ?? '.';
try {
  const { run } = await server.ssrLoadModule('/scripts/oneclick-live-dry.ts');
  const args = JSON.parse(process.argv[3]);
  const result = await run(args);
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/live-dry-quote.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ error: result.error, verification: result.verification, tokenCount: result.tokenCount, amountIn: result.raw?.quote?.amountIn, minAmountIn: result.raw?.quote?.minAmountIn, amountOut: result.raw?.quote?.amountOut, minAmountOut: result.raw?.quote?.minAmountOut, deposit: result.raw?.quote?.depositAddress ?? null, timeEstimate: result.raw?.quote?.timeEstimate }));
} finally { await server.close(); }
