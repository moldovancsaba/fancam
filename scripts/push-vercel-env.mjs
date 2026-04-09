/**
 * One-off: read .env and set Vercel env vars (production + preview).
 * Does not print secret values. Run from repo root: node scripts/push-vercel-env.mjs
 */
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

function parseEnvFile(filePath) {
  const out = {};
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function isPlaceholder(key, val) {
  if (!val) return true;
  const v = val.toLowerCase();
  if (v.includes('your_') || v.includes('replace_with')) return true;
  // Template host from .env.example (not a real Atlas cluster)
  if (/@cluster\.mongodb\.net/i.test(val)) return true;
  return false;
}

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const vars = parseEnvFile(envPath);

vars.NEXT_PUBLIC_APP_URL = 'https://camera.doneisbetter.com';
vars.SSO_REDIRECT_URI = 'https://camera.doneisbetter.com/api/auth/callback';

const sensitive = new Set([
  'MONGODB_URI',
  'SSO_CLIENT_SECRET',
  'IMGBB_API_KEY',
  'EMAIL_API_KEY',
  'RESEND_API_KEY',
  'SESSION_SECRET',
]);

const targets = ['production', 'preview'];

for (const target of targets) {
  for (const [key, val] of Object.entries(vars)) {
    if (isPlaceholder(key, val)) {
      console.log(`skip ${key} (${target}): placeholder or empty`);
      continue;
    }
    const args = ['env', 'add', key, target, '--yes'];
    if (sensitive.has(key)) args.push('--sensitive');
    args.push('--value', val);
    const r = spawnSync('vercel', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (r.status !== 0) {
      console.error(`FAILED ${key} ${target}:`, r.stderr || r.stdout);
    } else {
      console.log(`ok ${key} ${target}`);
    }
  }
}
