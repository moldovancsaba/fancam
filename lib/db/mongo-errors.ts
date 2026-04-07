/**
 * User-facing diagnosis for MongoDB connection failures (Atlas, DNS, auth, etc.).
 */

export interface MongoConnectionDiagnosis {
  /** Short technical message safe to show admins */
  rawMessage: string;
  /** Human-readable summary */
  summary: string;
  /** Actionable bullets */
  hints: string[];
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Parse host from mongodb+srv://user:pass@host/... (password redacted in logic only).
 */
export function extractMongoUriHost(uri: string): string | null {
  const m = uri.trim().match(/@([^/?]+)/);
  if (!m) return null;
  return m[1].split(':')[0] || null;
}

/**
 * Turn driver/network errors into guidance (especially querySrv ENOTFOUND).
 */
export function describeMongoConnectionError(err: unknown): MongoConnectionDiagnosis {
  const rawMessage = messageOf(err);
  const lower = rawMessage.toLowerCase();

  const hints: string[] = [];
  let summary = 'Could not connect to the database.';

  if (lower.includes('enotfound') || lower.includes('queriesrv') || lower.includes('query_srv')) {
    summary = 'DNS could not resolve your Atlas cluster hostname (SRV lookup failed).';
    const host = process.env.MONGODB_URI
      ? extractMongoUriHost(process.env.MONGODB_URI)
      : null;
    hints.push(
      'In MongoDB Atlas → Database → Connect, copy a fresh connection string and update MONGODB_URI (local .env and Vercel/host env).'
    );
    hints.push(
      'Confirm the cluster still exists and the hostname was not mistyped (cluster rename/delete breaks old URIs).'
    );
    if (host) {
      hints.push(`Configured host looks like: ${host} — compare with Atlas “Connect” dialog.`);
    }
    hints.push(
      'If DNS works elsewhere: try another network or disable VPN/ad-blocking DNS; some networks block SRV queries.'
    );
    hints.push(
      'Docs: docs/MONGODB_ATLAS.md → Troubleshooting (querySrv ENOTFOUND).'
    );
    hints.push('From the repo root, run: npm run db:verify-uri (uses .env / .env.local).');
  } else if (lower.includes('eai_again') || lower.includes('getaddrinfo')) {
    summary = 'Temporary DNS or network failure.';
    hints.push('Retry in a moment; check VPN/Wi-Fi; verify Atlas cluster is running.');
  } else if (
    lower.includes('authentication failed') ||
    lower.includes('bad auth') ||
    lower.includes('invalid credentials')
  ) {
    summary = 'Database authentication failed.';
    hints.push(
      'Check username/password in MONGODB_URI (URL-encode special characters in the password).'
    );
    hints.push('In Atlas → Database Access, confirm the user exists and has read/write on this database.');
  } else if (lower.includes('server selection timed out') || lower.includes('serverselectionerror')) {
    summary = 'Could not reach MongoDB servers in time.';
    hints.push(
      'Atlas → Network Access: allow your IP (or 0.0.0.0/0 for Vercel-style deploys if policy allows).'
    );
    hints.push('Confirm MONGODB_URI points to the correct project/region.');
  } else if (lower.includes('mongodb_uri') && lower.includes('not defined')) {
    summary = 'Database environment variables are missing.';
    hints.push('Set MONGODB_URI and MONGODB_DB in .env locally and in your hosting provider.');
  }

  if (hints.length === 0) {
    hints.push('See server logs for the full stack trace.');
    hints.push('Verify MONGODB_URI and MONGODB_DB; run `npm run db:ensure-indexes` only after the connection works.');
  }

  return { rawMessage, summary, hints };
}

/**
 * Validate MONGODB_URI shape before connecting (clear errors, no secrets logged).
 */
export function assertValidMongoUriScheme(uri: string): void {
  const t = uri.trim();
  if (!t.startsWith('mongodb://') && !t.startsWith('mongodb+srv://')) {
    throw new Error(
      'MONGODB_URI must start with mongodb:// or mongodb+srv:// (copy the full string from Atlas → Connect).'
    );
  }
}
