// Diagnostic only. Never writes production artifacts in the harness checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { measure } from './measure.mjs';

const historical = '258f138110760f726c7e090e807015332f513b19';
const current = '352a7cfd9efeda314634a81905f459b290f947ec';
const variants = [
  ['historical', historical, false, false],
  ['parent', '5999d0c2bee67839e1ba55546b0021b22f2d0ce4', false, false],
  ['introduction', 'ca363b0e861fb055985762c49186d2fad1f61413', false, false],
  ['current-default', current, false, false],
  ['proposed-isolation', current, true, false],
  ['g2-merchant', current, false, true],
];
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });
const harness = resolve(process.cwd());
const workspace = resolve(process.env.GITHUB_WORKSPACE || '.');
if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true'
    || harness !== join(workspace, 'harness') || !process.env.RUNNER_TEMP) {
  throw new Error('Run only in the reviewed diagnostic job with checkout at harness.');
}
if (!process.env.EXPECTED_IMAGE_VERSION || process.env.ImageVersion !== process.env.EXPECTED_IMAGE_VERSION) {
  throw new Error('Runner image differs from the explicitly reviewed image version.');
}
const crate = join(workspace, 'contracts/payments');
const cargoHome = '/home/runner/.cargo';
if (process.env.HOME !== '/home/runner') throw new Error('Unexpected runner home path.');
if (['config', 'config.toml'].some(f => existsSync(join(cargoHome, f)))) throw new Error('Unexpected global Cargo config.');
const out = join(workspace, 'UNAPPROVED-diagnostics');
if ([crate, out].some(existsSync)) throw new Error('Diagnostic directories must initially be absent.');
mkdirSync(out);
const env = { ...process.env, CARGO_HOME: cargoHome, CARGO_BUILD_JOBS: '2',
  CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0',
  CARGO_TERM_COLOR: 'never', RUST_BACKTRACE: '1', RUSTUP_TOOLCHAIN: '1.95.0' };
for (const key of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_TARGET_DIR']) {
  if (env[key]) throw new Error('Unexpected build override: ' + key);
}
const environment = {
  approval: 'UNAPPROVED', imageOS: env.ImageOS, imageVersion: env.ImageVersion,
  runnerOS: env.RUNNER_OS, runnerArch: env.RUNNER_ARCH,
  uname: run('uname', ['-a']), osRelease: readFileSync('/etc/os-release', 'utf8'),
  rustc: run('rustc', ['+1.95.0', '-vV']), cargo: run('cargo', ['+1.95.0', '-V']),
  node: process.version, buildPath: crate, cargoHome, target: 'wasm32-unknown-unknown',
  flags: '-C target-cpu=mvp --cfg near', jobs: 2, incremental: 0,
  harnessCommit: run('git', ['rev-parse', 'HEAD']).trim(),
};
if (!environment.rustc.includes('59807616e1fa2540724bfbac14d7976d7e4a3860')) {
  throw new Error('Unexpected Rust compiler commit.');
}
writeFileSync(join(out, 'environment.json'), JSON.stringify(environment, null, 2));
const results = [];
for (const [name, sha, isolate, merchant] of variants) {
  for (let repeat = 1; repeat <= 2; repeat++) {
    // These fixed paths are owned by this job, initially absent, never user input.
    rmSync(crate, { recursive: true, force: true });
    for (const cache of ['registry', 'git']) rmSync(join(cargoHome, cache), { recursive: true, force: true });
    mkdirSync(cargoHome, { recursive: true });
    const archive = execFileSync('git', ['archive', sha, 'contracts/payments'], { cwd: harness, maxBuffer: 20 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', workspace], { input: archive });
    const restored = isolate ? ['src/lib.rs', 'src/model.rs', 'src/tests.rs', 'Cargo.toml'] : [];
    for (const file of restored) {
      writeFileSync(join(crate, file), execFileSync('git', ['show', historical + ':contracts/payments/' + file], { cwd: harness }));
    }
    const label = name + '-' + repeat;
    const dest = join(out, 'UNAPPROVED-' + label);
    mkdirSync(dest);
    const sourceFiles = ['src/lib.rs', 'src/model.rs', 'src/tests.rs', 'Cargo.toml',
      'Cargo.lock', '.cargo/config.toml', 'rust-toolchain.toml', 'scripts/build.sh'];
    if (existsSync(join(crate, 'src/merchant.rs'))) sourceFiles.push('src/merchant.rs');
    const blobs = Object.fromEntries(sourceFiles.map(file =>
      [file, run('git', ['hash-object', join(crate, file)]).trim()]));
    const abiFile = merchant ? 'abi.merchant-v1.json' : 'abi.json';
    cpSync(join(crate, abiFile), join(dest, 'abi.json'));
    writeFileSync(join(dest, 'source.json'), JSON.stringify({ sha, restoredFrom: isolate ? historical : null,
      restored, blobs, feature: merchant ? 'merchant-bound-v1' : 'default', repeat }, null, 2));
    const args = ['+1.95.0', 'build', '--locked', '--target', 'wasm32-unknown-unknown', '--release'];
    if (merchant) args.push('--features', 'merchant-bound-v1');
    const build = spawnSync('cargo', args, { cwd: crate, env, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(dest, 'build.stdout.log'), build.stdout || '');
    writeFileSync(join(dest, 'build.stderr.log'), build.stderr || '');
    if (build.error || build.status !== 0) throw build.error || new Error('Cargo failed: ' + label);
    const wasm = readFileSync(join(crate, 'target/wasm32-unknown-unknown/release/taply_payments.wasm'));
    writeFileSync(join(dest, 'UNAPPROVED-payments.wasm'), wasm);
    const result = { name, repeat, sha, ...measure(wasm, readFileSync(join(crate, abiFile))) };
    // Run the existing, unchanged preflight. Mismatches are evidence, never an approval.
    try {
      const log = run('node', [join(harness, 'apps/web/scripts/deploy-preflight.mjs'), 'wasm',
        join(dest, 'UNAPPROVED-payments.wasm')], { cwd: harness });
      writeFileSync(join(dest, 'preflight.log'), log);
      result.preflightExit = 0;
    } catch (error) {
      writeFileSync(join(dest, 'preflight.log'), String(error.stdout || '') + String(error.stderr || ''));
      result.preflightExit = error.status;
    }
    writeFileSync(join(dest, 'measurement.json'), JSON.stringify(result, null, 2));
    results.push(result);
    writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  }
}
for (const [name] of variants) {
  const pair = results.filter(r => r.name === name);
  if (pair[0].sha256 !== pair[1].sha256 || pair.some(r => !r.abiFunctionMatch)) {
    throw new Error('Repeat or ABI mismatch: ' + name);
  }
}
if (results.some(r => ['historical', 'parent', 'proposed-isolation'].includes(r.name) && r.preflightExit !== 0)) {
  throw new Error('Historical or proposed isolation does not reproduce unchanged approved pins.');
}
console.log('Diagnostic complete. All outputs remain UNAPPROVED; full safety CI still required.');
