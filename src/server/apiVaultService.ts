import crypto from 'node:crypto';
import { addAuditLog, db, decryptVaultSecret, encryptVaultSecret, maskSecretValue } from './db';

export type ApiAccessScope = 'owner_only' | 'plugins' | 'ai_agents' | 'all_bot';

export interface ApiVaultPublicItem {
  id: string;
  provider_name: string;
  label: string;
  key_masked: string;
  masked_key: string;
  has_secret: boolean;
  access_scope: ApiAccessScope;
  daily_quota: number;
  daily_used: number;
  quota_limit: number;
  quota_used: number;
  rate_limit_per_min: number;
  error_count: number;
  enabled: number;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function listApiVaultEntries(): ApiVaultPublicItem[] {
  const rows = db
    .prepare(`SELECT * FROM api_keys_vault ORDER BY updated_at DESC, provider_name ASC`)
    .all() as Array<{
    id: string;
    name?: string;
    provider?: string;
    provider_name?: string;
    label?: string;
    encrypted_key: string;
    key_masked?: string;
    masked_key?: string;
    access_scope: string;
    quota_monthly?: number;
    daily_quota?: number;
    usage_count?: number;
    daily_used?: number;
    rate_limit_per_min: number;
    error_count: number;
    enabled?: number;
    status?: string;
    last_used_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>;

  // Never include encrypted_key or plaintext secret in API responses
  return rows.map((r) => {
    const providerName = r.provider_name || r.provider || '';
    const label = r.label || r.name || '';
    const masked = r.key_masked || r.masked_key || '****';
    const quota = Number(r.daily_quota ?? r.quota_monthly ?? 1000);
    const used = Number(r.daily_used ?? r.usage_count ?? 0);
    const isEnabled = r.enabled !== undefined ? r.enabled : r.status === 'active' ? 1 : 0;
    return {
      id: r.id,
      provider_name: providerName,
      label,
      key_masked: masked,
      masked_key: masked,
      has_secret: Boolean(r.encrypted_key && r.encrypted_key.length > 2),
      access_scope: (r.access_scope as ApiAccessScope) || 'owner_only',
      daily_quota: quota,
      daily_used: used,
      quota_limit: quota,
      quota_used: used,
      rate_limit_per_min: r.rate_limit_per_min,
      error_count: r.error_count,
      enabled: isEnabled,
      last_used_at: r.last_used_at,
      last_error: r.last_error,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

export function upsertApiVaultEntry(
  input: {
    id?: string;
    provider_name?: string;
    provider?: string;
    label?: string;
    name?: string;
    endpoint?: string;
    api_key?: string;
    plaintext_key?: string;
    access_scope?: ApiAccessScope;
    daily_quota?: number;
    quota_limit?: number;
    rate_limit_per_min?: number;
    enabled?: boolean;
    actor?: string;
  },
  actorArg?: string,
): { ok: boolean; item?: ApiVaultPublicItem; error?: string } {
  const actor = actorArg || input.actor || 'owner';
  const existing = input.id
    ? (db.prepare(`SELECT * FROM api_keys_vault WHERE id = ?`).get(input.id.trim()) as {
        id: string;
        provider_name?: string;
        provider?: string;
        label?: string;
        name?: string;
        endpoint?: string;
        encrypted_key: string;
        key_masked?: string;
        masked_key?: string;
        access_scope: string;
        daily_quota?: number;
        quota_monthly?: number;
        rate_limit_per_min: number;
        enabled?: number;
      } | undefined)
    : undefined;

  const providerName = String(input.provider_name || input.provider || existing?.provider_name || existing?.provider || '')
    .trim()
    .toLowerCase()
    .slice(0, 48);
  const label = String(input.label || input.name || existing?.label || existing?.name || '').trim().slice(0, 80);
  if (!providerName || !label) {
    return { ok: false, error: 'Nama provider dan label kunci wajib diisi ya.' };
  }

  const scope: ApiAccessScope =
    input.access_scope === 'plugins' ||
    input.access_scope === 'ai_agents' ||
    input.access_scope === 'all_bot'
      ? input.access_scope
      : input.access_scope === 'owner_only'
        ? 'owner_only'
        : ((existing?.access_scope as ApiAccessScope) || 'owner_only');

  const rawKey = typeof input.api_key === 'string' ? input.api_key : input.plaintext_key;
  const newPlain = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!existing && newPlain.length < 4) {
    return { ok: false, error: 'API Key minimal 4 karakter ya.' };
  }

  const encryptedKey = newPlain ? encryptVaultSecret(newPlain) : existing!.encrypted_key;
  const maskedKey = newPlain ? maskSecretValue(newPlain) : (existing!.key_masked || existing!.masked_key || '****');
  const id = existing ? existing.id : `api-${crypto.randomBytes(4).toString('hex')}`;
  const quota = Math.max(0, Math.floor(Number(input.daily_quota ?? input.quota_limit ?? existing?.daily_quota ?? existing?.quota_monthly ?? 1000)));
  const rateLimit = Math.max(1, Math.min(10000, Math.floor(Number(input.rate_limit_per_min ?? existing?.rate_limit_per_min ?? 60))));
  const isEnabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing?.enabled ?? 1);

  db.prepare(`
    INSERT INTO api_keys_vault (
      id, name, provider, provider_name, label, endpoint, encrypted_key, key_masked, masked_key, status,
      access_scope, quota_monthly, daily_quota, rate_limit_per_min, enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider = excluded.provider,
      provider_name = excluded.provider_name,
      label = excluded.label,
      endpoint = excluded.endpoint,
      encrypted_key = excluded.encrypted_key,
      key_masked = excluded.key_masked,
      masked_key = excluded.masked_key,
      status = excluded.status,
      access_scope = excluded.access_scope,
      quota_monthly = excluded.quota_monthly,
      daily_quota = excluded.daily_quota,
      rate_limit_per_min = excluded.rate_limit_per_min,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(
    id,
    label,
    providerName,
    providerName,
    label,
    String(input.endpoint || existing?.endpoint || ''),
    encryptedKey,
    maskedKey,
    maskedKey,
    isEnabled ? 'active' : 'disabled',
    scope,
    quota,
    quota,
    rateLimit,
    isEnabled,
  );

  addAuditLog(actor, 'api_vault.upsert', id, {
    providerName,
    label,
    maskedKey,
    scope,
  });

  const saved = listApiVaultEntries().find((item) => item.id === id);
  return { ok: true, item: saved };
}

export function deleteApiVaultEntry(id: string, actor = 'owner'): boolean {
  const res = db.prepare(`DELETE FROM api_keys_vault WHERE id = ?`).run(id.trim());
  if (res.changes > 0) {
    addAuditLog(actor, 'api_vault.delete', id.trim());
    return true;
  }
  return false;
}

export function resolveVaultKeyForRuntime(
  providerName: string,
  scopeRequired: ApiAccessScope = 'all_bot',
): { ok: true; id: string; apiKey: string } | { ok: false; error: string } {
  const row = db
    .prepare(
      `SELECT id, encrypted_key, access_scope, COALESCE(daily_quota, quota_monthly, 0) AS quota_limit,
              COALESCE(daily_used, usage_count, 0) AS quota_used, enabled
       FROM api_keys_vault
       WHERE LOWER(COALESCE(NULLIF(provider_name, ''), provider)) = ? AND enabled = 1
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(providerName.trim().toLowerCase()) as
    | {
        id: string;
        encrypted_key: string;
        access_scope: ApiAccessScope;
        quota_limit: number;
        quota_used: number;
        enabled: number;
      }
    | undefined;

  if (!row) return { ok: false, error: 'Kunci API untuk provider tersebut belum tersedia.' };
  if (row.quota_limit > 0 && row.quota_used >= row.quota_limit) {
    return { ok: false, error: 'Kuota harian API key sudah habis.' };
  }
  if (row.access_scope === 'owner_only' && scopeRequired !== 'owner_only') {
    return { ok: false, error: 'Scope API key ini khusus owner_only.' };
  }
  if (row.access_scope !== 'all_bot' && row.access_scope !== scopeRequired && scopeRequired !== 'owner_only') {
    return { ok: false, error: `Scope API key (${row.access_scope}) nggak mengizinkan akses dari ${scopeRequired}.` };
  }

  const plain = decryptVaultSecret(row.encrypted_key);
  if (!plain) return { ok: false, error: 'Gagal mendekripsi API key (periksa encryption secret).' };
  return { ok: true, id: row.id, apiKey: plain };
}

export function recordApiVaultUsage(providerName: string, success: boolean, errorMessage?: string): void {
  const clean = providerName.trim().toLowerCase();
  if (success) {
    db.prepare(
      `UPDATE api_keys_vault
       SET daily_used = daily_used + 1, usage_count = usage_count + 1, last_used_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
       WHERE LOWER(COALESCE(NULLIF(provider_name, ''), provider)) = ? AND enabled = 1`,
    ).run(clean);
  } else {
    db.prepare(
      `UPDATE api_keys_vault
       SET error_count = error_count + 1, last_used_at = datetime('now'), last_error = ?, updated_at = datetime('now')
       WHERE LOWER(COALESCE(NULLIF(provider_name, ''), provider)) = ? AND enabled = 1`,
    ).run(String(errorMessage || 'API error').slice(0, 240), clean);
  }
}
