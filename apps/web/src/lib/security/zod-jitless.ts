import { z } from 'zod';

/**
 * Zod 4 probes `new Function` once to decide whether it may JIT-compile
 * schemas. Under Taply's CSP (no 'unsafe-eval') the probe is blocked and
 * caught, but browsers still report a CSP violation on every page. `jitless`
 * skips the probe and uses the plain interpreter. Validation is identical.
 * Imported for its side effect by the root client providers.
 */
z.config({ jitless: true });
