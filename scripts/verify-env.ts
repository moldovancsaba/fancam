/**
 * Verify environment credentials from .env / .env.local.
 *
 * Usage (repo root):
 *   npx tsx scripts/verify-env.ts
 *
 * Tests: MongoDB (Camera), SSO OAuth discovery, ImgBB API.
 */

import { MongoClient } from 'mongodb';

import { loadEnvFromFiles } from './load-env-from-files';

async function testMongoDB(uri: string, name: string): Promise<boolean> {
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    await client.close();
    console.log(`✓ ${name}: connected successfully`);
    return true;
  } catch (e) {
    const err = e as Error;
    console.log(`✗ ${name}: ${err.message}`);
    return false;
  }
}

async function testSSOOAuth(issuerUrl: string): Promise<boolean> {
  try {
    const url = new URL(issuerUrl);
    url.pathname = '/.well-known/openid-configuration';
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.log(`✗ SSO OAuth: HTTP ${res.status}`);
      return false;
    }
    const config = await res.json();
    if (!config.issuer || !config.authorization_endpoint) {
      console.log(`✗ SSO OAuth: invalid discovery document`);
      return false;
    }
    console.log(`✓ SSO OAuth: discovery endpoint valid`);
    return true;
  } catch (e) {
    const err = e as Error;
    console.log(`✗ SSO OAuth: ${err.message}`);
    return false;
  }
}

/** 1×1 transparent PNG — ImgBB requires an image field, not just the API key. */
const IMGBB_PROBE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function testImgBB(apiKey: string): Promise<boolean> {
  if (!apiKey || apiKey === 'your_imgbb_api_key_here') {
    console.log(`✗ ImgBB: not configured`);
    return false;
  }
  try {
    const form = new FormData();
    form.append('key', apiKey);
    form.append('image', IMGBB_PROBE_IMAGE_BASE64);
    const res = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (data.success) {
      console.log(`✓ ImgBB: API key valid`);
      return true;
    }
    console.log(`✗ ImgBB: ${data.error?.message || 'invalid key'}`);
    return false;
  } catch (e) {
    const err = e as Error;
    console.log(`✗ ImgBB: ${err.message}`);
    return false;
  }
}

async function main() {
  loadEnvFromFiles();
  console.log('Environment credential verification\n');

  const results: { name: string; pass: boolean }[] = [];

  const mongodbUri = process.env.MONGODB_URI?.trim();
  if (mongodbUri) {
    const passed = await testMongoDB(mongodbUri, 'MONGODB_URI');
    results.push({ name: 'MONGODB_URI', pass: passed });
  } else {
    console.log('○ MONGODB_URI: not set');
    results.push({ name: 'MONGODB_URI', pass: false });
  }

  const ssoBaseUrl = process.env.SSO_BASE_URL?.trim();
  if (ssoBaseUrl) {
    const passed = await testSSOOAuth(ssoBaseUrl);
    results.push({ name: 'SSO_BASE_URL', pass: passed });
  } else {
    console.log('○ SSO_BASE_URL: not set');
    results.push({ name: 'SSO_BASE_URL', pass: false });
  }

  const imgbbKey = process.env.IMGBB_API_KEY?.trim();
  if (imgbbKey) {
    const passed = await testImgBB(imgbbKey);
    results.push({ name: 'IMGBB_API_KEY', pass: passed });
  } else {
    console.log('○ IMGBB_API_KEY: not set');
    results.push({ name: 'IMGBB_API_KEY', pass: false });
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${passed}/${total} credentials valid`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});