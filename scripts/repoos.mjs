#!/usr/bin/env node
/**
 * Run the RepoOS CLI at the version this repository is pinned to.
 *
 * Exists so that "regenerate CLAUDE.md" is a command anyone can actually run —
 * a human, or an agent that just edited `.ai/`. Without it the CLI lived only
 * inside the CI runner, so the instruction to regenerate was unfollowable and
 * the only way to discover drift was a red build.
 *
 *   npm run repoos:generate     # rewrite CLAUDE.md from .ai/
 *   npm run repoos:check        # what CI runs; changes nothing
 *   npm run repoos -- propose . # anything else the CLI offers
 *
 * The version comes from `.repoos-version` and nowhere else. `check.yml` reads
 * the same file, so a local run and CI cannot disagree about which CLI they are
 * running — a disagreement there shows up as `generate --check` passing on your
 * machine and failing in CI, with a diff that explains nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const REPO = 'https://github.com/HellboundGlory/repository-operating-system.git';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const versionFile = path.join(root, '.repoos-version');
if (!existsSync(versionFile)) {
  console.error('missing .repoos-version — it names the RepoOS tag this repo is pinned to');
  process.exit(2);
}
const version = readFileSync(versionFile, 'utf8').trim();
if (!/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error(`.repoos-version should hold a tag like "v1.2.3", found: ${JSON.stringify(version)}`);
  process.exit(2);
}

// The cache lives OUTSIDE the repository, in the user's cache dir.
//
// Not a dot-directory in the project: `repoos validate` walks subdirectories
// looking for nested `.ai/repoos.yaml` layers, and the RepoOS checkout contains
// its own examples, template, and conformance fixtures — several of which are
// deliberately invalid. An in-repo cache makes `validate` report other people's
// fixtures as this project's errors. Measured: 7 phantom errors.
//
// Keyed by version, not one shared directory: bumping the pin with a stale
// checkout would silently run the OLD cli locally while CI runs the new one,
// and the two would then disagree about whether CLAUDE.md is in sync.
const cacheHome = process.platform === 'win32'
  ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
  : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
const cache = path.join(cacheHome, 'repoos', version);
const cli = path.join(cache, 'cli', 'bin', 'repoos.js');

if (!existsSync(cli)) {
  console.error(`fetching RepoOS ${version} …`);
  mkdirSync(path.dirname(cache), { recursive: true });
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', version, REPO, cache], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (e) {
    const detail = String(e.stderr || e.message).trim();
    console.error(`could not fetch RepoOS ${version}:\n${detail}\n`);
    console.error('The upstream repository must be public and reachable — see');
    console.error('.ai/memory/lessons/repoos-ci-job-needs-a-public-upstream.md');
    process.exit(2);
  }
}
// Fetched once, then reused: the second run is offline and instant.

const args = process.argv.slice(2);
if (args.length === 0) args.push('--help');
// Default to acting on this repository so `npm run repoos:generate` needs no
// trailing dot, while an explicit path still wins.
if (args.length === 1 && ['validate', 'generate', 'propose'].includes(args[0])) args.push(root);

try {
  execFileSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 2);
}
