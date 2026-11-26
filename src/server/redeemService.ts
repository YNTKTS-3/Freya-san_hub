import crypto from 'node:crypto';
import { db, addAuditLog, addSystemLog, applyUserBalanceAndExp } from './db';
import { ConfiguredAdditionalReward, RedeemClaimStatus, RewardRegistryEntry } from '../core/types';
import {
  REWARD_REGISTRY,
  getActiveRewardRegistry,
  renderRedeemMessage,
  validateAdditionalReward,
  validateRedeemConfiguration,
} from '../core/redeemEngine';

export interface RedeemSettings {
  globalCooldownSec: number;
  maxBalanceCap: number;
  maxExpCap: number;
  maxLevelCap: number;
  defaultPerUserLimit: number;
  msgSuccess: string;
  msgExpired: string;
  msgLimit: string;
  msgInvalid: string;
}

export interface RedeemCodeDTO {
  code: string;
  name: string;
  description: string;
  rewardBalance: number;
  rewardExp: number;
  rewardLevel: number;
  rewardLimit: number;
  rewardPremiumDays: number;
  additionalRewards: ConfiguredAdditionalReward[];
  maxClaims: number;
  perUserLimit: number;
  cooldownSec: number;
  claimedCount: number;
  expiresAt: string | null;
  active: boolean;
  isExpired: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedeemClaimResult {
  ok: boolean;
  status: RedeemClaimStatus;
  code: string;
  message: string;
  duplicateIdempotent?: boolean;
  rewardsGranted?: {
    balance: number;
    exp: number;
    levelBonus: number;
    dailyLimitBonus: number;
    premiumDays: number;
    badges: string[];
    streakBoost: number;
    items: Array<{ rewardId: string; name: string; summary: string }>;
  };
  userAfter?: {
    balance: number;
    exp: number;
    level: number;
    dailyLimit: number;
    isPremium: boolean;
    streak: number;
  };
}

function getSettingValue(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function getRedeemSettings(): RedeemSettings {
  return {
    globalCooldownSec: Math.max(0, Number(getSettingValue('redeem_global_cooldown_sec', '3')) || 0),
    maxBalanceCap: Math.max(100, Number(getSettingValue('redeem_max_balance_cap', '100000')) || 100000),
    maxExpCap: Math.max(100, Number(getSettingValue('redeem_max_exp_cap', '50000')) || 50000),
    maxLevelCap: Math.max(1, Number(getSettingValue('redeem_max_level_cap', '50')) || 50),
    defaultPerUserLimit: Math.max(1, Number(getSettingValue('redeem_default_per_user_limit', '1')) || 1),
    msgSuccess: getSettingValue('redeem_msg_success', 'Yeay! Kode {code} berhasil diklaim buat {user}! Hadiah: {rewards}.'),
    msgExpired: getSettingValue('redeem_msg_expired', 'Yah, masa berlaku kode {code} udah habis.'),
    msgLimit: getSettingValue('redeem_msg_limit', 'Kuota klaim buat kode {code} udah habis nih.'),
    msgInvalid: getSettingValue('redeem_msg_invalid', 'Kode redeem {code} nggak ketemu atau lagi nonaktif.'),
  };
}

export function updateRedeemSettings(actor: string, patch: Partial<RedeemSettings>): RedeemSettings {
  const updates: Array<[string, string]> = [];
  if (patch.globalCooldownSec !== undefined) {
    const val = Math.max(0, Math.min(86400, Math.floor(Number(patch.globalCooldownSec) || 0)));
    updates.push(['redeem_global_cooldown_sec', String(val)]);
  }
  if (patch.maxBalanceCap !== undefined) {
    const val = Math.max(100, Math.min(10_000_000, Math.floor(Number(patch.maxBalanceCap) || 100000)));
    updates.push(['redeem_max_balance_cap', String(val)]);
  }
  if (patch.maxExpCap !== undefined) {
    const val = Math.max(100, Math.min(5_000_000, Math.floor(Number(patch.maxExpCap) || 50000)));
    updates.push(['redeem_max_exp_cap', String(val)]);
  }
  if (patch.maxLevelCap !== undefined) {
    const val = Math.max(1, Math.min(500, Math.floor(Number(patch.maxLevelCap) || 50)));
    updates.push(['redeem_max_level_cap', String(val)]);
  }
  if (patch.defaultPerUserLimit !== undefined) {
    const val = Math.max(1, Math.min(100, Math.floor(Number(patch.defaultPerUserLimit) || 1)));
    updates.push(['redeem_default_per_user_limit', String(val)]);
  }
  if (typeof patch.msgSuccess === 'string' && patch.msgSuccess.trim()) {
    updates.push(['redeem_msg_success', patch.msgSuccess.trim().slice(0, 300)]);
  }
  if (typeof patch.msgExpired === 'string' && patch.msgExpired.trim()) {
    updates.push(['redeem_msg_expired', patch.msgExpired.trim().slice(0, 300)]);
  }
  if (typeof patch.msgLimit === 'string' && patch.msgLimit.trim()) {
    updates.push(['redeem_msg_limit', patch.msgLimit.trim().slice(0, 300)]);
  }
  if (typeof patch.msgInvalid === 'string' && patch.msgInvalid.trim()) {
    updates.push(['redeem_msg_invalid', patch.msgInvalid.trim().slice(0, 300)]);
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, is_secret, updated_at)
    VALUES (?, ?, 0, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  db.transaction(() => {
    for (const [k, v] of updates) {
      upsert.run(k, v);
    }
  })();

  addAuditLog(actor, 'redeem_settings_update', 'redeem_settings', patch);
  return getRedeemSettings();
}

export function listRewardRegistry(): { active: RewardRegistryEntry[]; all: RewardRegistryEntry[] } {
  return {
    active: getActiveRewardRegistry(),
    all: REWARD_REGISTRY,
  };
}

function parseAdditionalRewards(rawJson: string | null | undefined, rowLimit = 0, rowPremiumDays = 0): ConfiguredAdditionalReward[] {
  let list: ConfiguredAdditionalReward[] = [];
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch {
      list = [];
    }
  }
  if (list.length === 0) {
    if (rowLimit > 0) {
      list.push({ rewardId: 'daily_limit_bonus', params: { amount: rowLimit } });
    }
    if (rowPremiumDays > 0) {
      list.push({ rewardId: 'premium_access', params: { days: rowPremiumDays } });
    }
  }
  return list;
}

function mapCodeRow(row: any): RedeemCodeDTO {
  const isExpired = Boolean(row.expires_at && new Date(row.expires_at).getTime() <= Date.now());
  return {
    code: row.code,
    name: row.name || row.code,
    description: row.description || '',
    rewardBalance: Number(row.reward_balance || 0),
    rewardExp: Number(row.reward_exp || 0),
    rewardLevel: Number(row.reward_level || 0),
    rewardLimit: Number(row.reward_limit || 0),
    rewardPremiumDays: Number(row.reward_premium_days || 0),
    additionalRewards: parseAdditionalRewards(row.additional_rewards_json, Number(row.reward_limit || 0), Number(row.reward_premium_days || 0)),
    maxClaims: Number(row.max_claims ?? 10),
    perUserLimit: Number(row.per_user_limit ?? 1),
    cooldownSec: Number(row.cooldown_sec ?? 0),
    claimedCount: Number(row.claimed_count ?? 0),
    expiresAt: row.expires_at ?? null,
    active: Boolean(row.active),
    isExpired,
    createdBy: row.created_by || 'owner',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function listRedeemCodes(opts: {
  search?: string;
  status?: 'all' | 'active' | 'inactive' | 'expired';
  limit?: number;
  offset?: number;
} = {}): { items: RedeemCodeDTO[]; total: number } {
  const limit = Math.min(200, Math.max(1, Number(opts.limit || 50)));
  const offset = Math.max(0, Number(opts.offset || 0));
  const search = (opts.search || '').trim().toLowerCase();
  const status = opts.status || 'all';

  const rows = db.prepare('SELECT * FROM redeem_codes ORDER BY created_at DESC').all() as any[];
  const mapped = rows.map(mapCodeRow).filter((item) => {
    if (search) {
      const hay = `${item.code} ${item.name} ${item.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (status === 'active') return item.active && !item.isExpired;
    if (status === 'inactive') return !item.active;
    if (status === 'expired') return item.isExpired;
    return true;
  });

  return {
    items: mapped.slice(offset, offset + limit),
    total: mapped.length,
  };
}

export function getRedeemDetail(code: string): { code: RedeemCodeDTO | null; recentClaims: any[] } {
  const upper = code.trim().toUpperCase();
  const row = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(upper);
  if (!row) return { code: null, recentClaims: [] };
  const recentClaims = db
    .prepare('SELECT id, code, user_phone, user_name, status, failure_reason, rewards_granted_json, created_at FROM redeem_claim_logs WHERE code = ? ORDER BY created_at DESC LIMIT 30')
    .all(upper);
  return { code: mapCodeRow(row), recentClaims };
}

export interface SaveRedeemInput {
  code: string;
  name?: string;
  description?: string;
  rewardBalance?: number;
  rewardExp?: number;
  rewardLevel?: number;
  maxClaims?: number;
  perUserLimit?: number;
  cooldownSec?: number;
  expiresAt?: string | null;
  active?: boolean;
  additionalRewards?: ConfiguredAdditionalReward[];
}

export function createRedeemCode(
  actor: string,
  input: SaveRedeemInput,
): { ok: true; item: RedeemCodeDTO } | { ok: false; error: string } {
  const code = String(input.code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Kode redeem wajib diisi.' };

  const existing = db.prepare('SELECT code FROM redeem_codes WHERE code = ?').get(code);
  if (existing) {
    return { ok: false, error: `Kode redeem ${code} sudah terdaftar.` };
  }

  const settings = getRedeemSettings();
  const validation = validateRedeemConfiguration({
    code,
    name: input.name,
    description: input.description,
    rewardBalance: input.rewardBalance ?? 0,
    rewardExp: input.rewardExp ?? 0,
    rewardLevel: input.rewardLevel ?? 0,
    maxClaims: input.maxClaims ?? 10,
    perUserLimit: input.perUserLimit ?? settings.defaultPerUserLimit,
    cooldownSec: input.cooldownSec ?? 0,
    expiresAt: input.expiresAt ?? null,
    additionalRewards: input.additionalRewards ?? [],
    caps: {
      maxBalance: settings.maxBalanceCap,
      maxExp: settings.maxExpCap,
      maxLevel: settings.maxLevelCap,
    },
  });

  if (!validation.ok) return validation;

  const extra = validation.normalizedAdditional;
  const legacyLimit = extra
    .filter((r) => r.rewardId === 'daily_limit_bonus')
    .reduce((acc, r) => acc + Number(r.params.amount || 0), 0);
  const legacyPremium = extra
    .filter((r) => r.rewardId === 'premium_access')
    .reduce((acc, r) => acc + Number(r.params.days || 0), 0);

  db.prepare(`
    INSERT INTO redeem_codes (
      code, name, description, reward_balance, reward_exp, reward_level,
      reward_limit, reward_premium_days, additional_rewards_json,
      max_claims, per_user_limit, cooldown_sec, expires_at, active, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    code,
    String(input.name || code).trim().slice(0, 80),
    String(input.description || '').trim().slice(0, 240),
    Number(input.rewardBalance ?? 0),
    Number(input.rewardExp ?? 0),
    Number(input.rewardLevel ?? 0),
    legacyLimit,
    legacyPremium,
    JSON.stringify(extra),
    Number(input.maxClaims ?? 10),
    Number(input.perUserLimit ?? settings.defaultPerUserLimit),
    Number(input.cooldownSec ?? 0),
    input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    input.active === false ? 0 : 1,
    actor,
  );

  addAuditLog(actor, 'redeem_create', code, {
    rewardBalance: Number(input.rewardBalance ?? 0),
    rewardExp: Number(input.rewardExp ?? 0),
    rewardLevel: Number(input.rewardLevel ?? 0),
    additionalRewards: extra,
    maxClaims: Number(input.maxClaims ?? 10),
    perUserLimit: Number(input.perUserLimit ?? settings.defaultPerUserLimit),
  });

  const saved = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code);
  return { ok: true, item: mapCodeRow(saved) };
}

export function updateRedeemCode(
  actor: string,
  code: string,
  patch: Partial<SaveRedeemInput>,
): { ok: true; item: RedeemCodeDTO } | { ok: false; error: string } {
  const upper = code.trim().toUpperCase();
  const row = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(upper) as any;
  if (!row) return { ok: false, error: `Kode redeem ${upper} nggak ketemu.` };

  const current = mapCodeRow(row);
  const settings = getRedeemSettings();
  const mergedAdditional = patch.additionalRewards ?? current.additionalRewards;
  const mergedBalance = patch.rewardBalance ?? current.rewardBalance;
  const mergedExp = patch.rewardExp ?? current.rewardExp;
  const mergedLevel = patch.rewardLevel ?? current.rewardLevel;
  const mergedMaxClaims = patch.maxClaims ?? current.maxClaims;
  const mergedPerUserLimit = patch.perUserLimit ?? current.perUserLimit;
  const mergedCooldown = patch.cooldownSec ?? current.cooldownSec;
  const mergedExpires = patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt;

  const validation = validateRedeemConfiguration({
    code: upper,
    rewardBalance: mergedBalance,
    rewardExp: mergedExp,
    rewardLevel: mergedLevel,
    maxClaims: mergedMaxClaims,
    perUserLimit: mergedPerUserLimit,
    cooldownSec: mergedCooldown,
    expiresAt: mergedExpires,
    additionalRewards: mergedAdditional,
    caps: {
      maxBalance: settings.maxBalanceCap,
      maxExp: settings.maxExpCap,
      maxLevel: settings.maxLevelCap,
    },
  });
  if (!validation.ok) return validation;

  const extra = validation.normalizedAdditional;
  const legacyLimit = extra
    .filter((r) => r.rewardId === 'daily_limit_bonus')
    .reduce((acc, r) => acc + Number(r.params.amount || 0), 0);
  const legacyPremium = extra
    .filter((r) => r.rewardId === 'premium_access')
    .reduce((acc, r) => acc + Number(r.params.days || 0), 0);

  db.prepare(`
    UPDATE redeem_codes
    SET name = ?,
        description = ?,
        reward_balance = ?,
        reward_exp = ?,
        reward_level = ?,
        reward_limit = ?,
        reward_premium_days = ?,
        additional_rewards_json = ?,
        max_claims = ?,
        per_user_limit = ?,
        cooldown_sec = ?,
        expires_at = ?,
        active = ?,
        updated_at = datetime('now')
    WHERE code = ?
  `).run(
    String(patch.name ?? current.name).trim().slice(0, 80),
    String(patch.description ?? current.description).trim().slice(0, 240),
    mergedBalance,
    mergedExp,
    mergedLevel,
    legacyLimit,
    legacyPremium,
    JSON.stringify(extra),
    mergedMaxClaims,
    mergedPerUserLimit,
    mergedCooldown,
    mergedExpires ? new Date(mergedExpires).toISOString() : null,
    patch.active !== undefined ? (patch.active ? 1 : 0) : current.active ? 1 : 0,
    upper,
  );

  addAuditLog(actor, 'redeem_update', upper, patch);
  const updated = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(upper);
  return { ok: true, item: mapCodeRow(updated) };
}

export function toggleRedeemCode(
  actor: string,
  code: string,
  active: boolean,
): { ok: true; item: RedeemCodeDTO } | { ok: false; error: string } {
  const upper = code.trim().toUpperCase();
  const res = db.prepare(`UPDATE redeem_codes SET active = ?, updated_at = datetime('now') WHERE code = ?`).run(active ? 1 : 0, upper);
  if (res.changes === 0) return { ok: false, error: `Kode redeem ${upper} nggak ketemu.` };
  addAuditLog(actor, active ? 'redeem_enable' : 'redeem_disable', upper);
  const row = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(upper);
  return { ok: true, item: mapCodeRow(row) };
}

export function resetRedeemClaims(
  actor: string,
  code: string,
  confirm: boolean,
): { ok: true; code: string } | { ok: false; error: string } {
  if (!confirm) {
    return { ok: false, error: 'Butuh konfirmasi dulu ya buat reset kuota klaim kode redeem.' };
  }
  const upper = code.trim().toUpperCase();
  const row = db.prepare('SELECT code FROM redeem_codes WHERE code = ?').get(upper);
  if (!row) return { ok: false, error: `Kode redeem ${upper} nggak ketemu.` };

  db.transaction(() => {
    db.prepare(`UPDATE redeem_codes SET claimed_count = 0, updated_at = datetime('now') WHERE code = ?`).run(upper);
    // Reset active per-user counter records while keeping immutable redeem_claim_logs intact!
    db.prepare(`DELETE FROM redeem_claims WHERE code = ?`).run(upper);
  })();

  addAuditLog(actor, 'redeem_reset', upper, { preservedAuditHistory: true });
  return { ok: true, code: upper };
}

export function deleteRedeemCode(
  actor: string,
  code: string,
): { ok: true; code: string } | { ok: false; error: string } {
  const upper = code.trim().toUpperCase();
  const existing = db.prepare('SELECT code, name FROM redeem_codes WHERE code = ?').get(upper) as { code: string; name: string } | undefined;
  if (!existing) return { ok: false, error: `Kode redeem ${upper} nggak ketemu.` };

  // Note: redeem_claim_logs & redeem_claims have NO ON DELETE CASCADE so history survives deletion!
  db.prepare('DELETE FROM redeem_codes WHERE code = ?').run(upper);
  addAuditLog(actor, 'redeem_delete', upper, { preservedClaimHistory: true, name: existing.name });
  return { ok: true, code: upper };
}

type AdditionalRewardHandlerFn = (
  userPhone: string,
  params: Record<string, string | number>,
  code: string,
) => { summary: string; deltaLimit?: number; deltaPremiumDays?: number; badgeName?: string; deltaStreak?: number };

const ADDITIONAL_REWARD_HANDLERS: Record<string, AdditionalRewardHandlerFn> = {
  apply_daily_limit_bonus: (userPhone, params) => {
    const amount = Number(params.amount || 0);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Parameter Bonus Limit Harian tidak valid.');
    }
    db.prepare(`UPDATE users SET daily_limit = daily_limit + ?, updated_at = datetime('now') WHERE phone = ?`).run(amount, userPhone);
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO limits (user_phone, daily_quota, used_today, reset_date)
      VALUES (?, 25 + ?, 0, ?)
      ON CONFLICT(user_phone) DO UPDATE SET daily_quota = limits.daily_quota + excluded.daily_quota
    `).run(userPhone, amount, today);
    return { summary: `+${amount} Limit Harian`, deltaLimit: amount };
  },
  apply_premium_days: (userPhone, params, code) => {
    const days = Number(params.days || 0);
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error('Parameter durasi premium tidak valid.');
    }
    const userRow = db.prepare('SELECT premium_expires_at FROM users WHERE phone = ?').get(userPhone) as { premium_expires_at?: string | null } | undefined;
    const baseMs = userRow?.premium_expires_at ? Math.max(Date.now(), new Date(userRow.premium_expires_at).getTime()) : Date.now();
    const newExpIso = new Date(baseMs + days * 86_400_000).toISOString();
    db.prepare(`UPDATE users SET is_premium = 1, premium_expires_at = ?, updated_at = datetime('now') WHERE phone = ?`).run(newExpIso, userPhone);
    db.prepare(`
      INSERT INTO subscriptions (id, user_phone, plan, status, starts_at, expires_at)
      VALUES (?, ?, ?, 'active', datetime('now'), ?)
    `).run(`sub-rdm-${crypto.randomUUID().slice(0, 8)}`, userPhone, `Redeem:${code}`, newExpIso);
    return { summary: `Premium ${days} hari`, deltaPremiumDays: days };
  },
  grant_profile_badge: (userPhone, params) => {
    const badgeName = String(params.badgeName || '').trim();
    const domain = String(params.domain || 'general').trim() || 'general';
    if (!badgeName) {
      throw new Error('Nama badge wajib diisi.');
    }
    const existing = db
      .prepare('SELECT id FROM achievements WHERE user_phone = ? AND badge_name = ?')
      .get(userPhone, badgeName);
    if (!existing) {
      db.prepare(`INSERT INTO achievements (id, user_phone, domain, badge_name) VALUES (?, ?, ?, ?)`).run(
        `ach-${crypto.randomUUID().slice(0, 10)}`,
        userPhone,
        domain,
        badgeName,
      );
    }
    return { summary: `Badge "${badgeName}"`, badgeName };
  },
  apply_streak_boost: (userPhone, params) => {
    const days = Number(params.days || 0);
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error('Parameter streak boost tidak valid.');
    }
    db.prepare(`UPDATE users SET streak = streak + ?, updated_at = datetime('now') WHERE phone = ?`).run(days, userPhone);
    return { summary: `+${days} Streak Harian`, deltaStreak: days };
  },
};

function logClaimAttempt(params: {
  code: string;
  codeName?: string | null;
  userPhone: string;
  userName?: string | null;
  status: RedeemClaimStatus;
  failureReason?: string | null;
  rewardsGranted?: unknown;
  idempotencyKey?: string | null;
}): void {
  db.prepare(`
    INSERT INTO redeem_claim_logs (
      code, code_name, user_phone, user_name, status, failure_reason, rewards_granted_json, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.code,
    params.codeName ?? null,
    params.userPhone,
    params.userName ?? null,
    params.status,
    params.failureReason ?? null,
    JSON.stringify(params.rewardsGranted ?? {}),
    params.idempotencyKey ?? null,
  );
}

export function executeRedeemClaim(input: {
  code: string;
  userPhone: string;
  displayName?: string;
  idempotencyKey?: string;
}): RedeemClaimResult {
  const upperCode = String(input.code || '').trim().toUpperCase();
  const userPhone = String(input.userPhone || '').trim();
  const displayName = String(input.displayName || userPhone).trim() || userPhone;
  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  const settings = getRedeemSettings();

  if (!upperCode) {
    return {
      ok: false,
      status: 'rejected',
      code: '',
      message: 'Masukin kode redeem yang bener dulu ya.',
    };
  }

  // Idempotency replay protection (no duplicate reward on retry/double click)
  if (idempotencyKey) {
    const prev = db
      .prepare('SELECT * FROM redeem_claim_logs WHERE idempotency_key = ?')
      .get(idempotencyKey) as any;
    if (prev) {
      let granted: any = undefined;
      try {
        granted = JSON.parse(prev.rewards_granted_json || '{}');
      } catch {
        granted = undefined;
      }
      if (prev.status === 'success') {
        const u = db.prepare('SELECT balance, exp, level, daily_limit, is_premium, streak FROM users WHERE phone = ?').get(prev.user_phone) as any;
        return {
          ok: true,
          status: 'success',
          code: prev.code,
          duplicateIdempotent: true,
          rewardsGranted: granted,
          userAfter: u
            ? {
                balance: u.balance,
                exp: u.exp,
                level: u.level,
                dailyLimit: u.daily_limit,
                isPremium: Boolean(u.is_premium),
                streak: u.streak,
              }
            : undefined,
          message: `Klaim ${prev.code} sudah diproses sebelumnya (idempoten).`,
        };
      }
      return {
        ok: false,
        status: prev.status as RedeemClaimStatus,
        code: prev.code,
        duplicateIdempotent: true,
        message: prev.failure_reason || 'Permintaan klaim sudah diproses sebelumnya.',
      };
    }
  }

  // Ensure user record exists cleanly outside/inside transaction
  try {
    return db.transaction((): RedeemClaimResult => {
      const codeRow = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(upperCode) as any;
      if (!codeRow || !codeRow.active) {
        const msg = renderRedeemMessage(settings.msgInvalid, `Kode redeem ${upperCode} nggak ketemu atau lagi nonaktif.`, {
          code: upperCode,
          user: displayName,
        });
        logClaimAttempt({
          code: upperCode,
          codeName: codeRow?.name ?? null,
          userPhone,
          userName: displayName,
          status: 'rejected',
          failureReason: msg,
          idempotencyKey,
        });
        return { ok: false, status: 'rejected', code: upperCode, message: msg };
      }

      if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() <= Date.now()) {
        const msg = renderRedeemMessage(settings.msgExpired, `Kode redeem ${upperCode} sudah kedaluwarsa.`, {
          code: upperCode,
          user: displayName,
        });
        logClaimAttempt({
          code: upperCode,
          codeName: codeRow.name,
          userPhone,
          userName: displayName,
          status: 'expired',
          failureReason: msg,
          idempotencyKey,
        });
        return { ok: false, status: 'expired', code: upperCode, message: msg };
      }

      if (codeRow.max_claims > 0 && codeRow.claimed_count >= codeRow.max_claims) {
        const msg = renderRedeemMessage(settings.msgLimit, `Kuota klaim kode ${upperCode} telah habis.`, {
          code: upperCode,
          user: displayName,
        });
        logClaimAttempt({
          code: upperCode,
          codeName: codeRow.name,
          userPhone,
          userName: displayName,
          status: 'rejected',
          failureReason: msg,
          idempotencyKey,
        });
        return { ok: false, status: 'rejected', code: upperCode, message: msg };
      }

      const userClaimCount = (
        db
          .prepare(`SELECT COUNT(*) as c FROM redeem_claims WHERE code = ? AND user_phone = ? AND status = 'success'`)
          .get(upperCode, userPhone) as { c: number }
      ).c;

      const perUserLimit = Math.max(1, Number(codeRow.per_user_limit || 1));
      if (userClaimCount >= perUserLimit) {
        const msg = `Kamu udah nyampe batas klaim (${perUserLimit}x) buat kode ${upperCode}.`;
        logClaimAttempt({
          code: upperCode,
          codeName: codeRow.name,
          userPhone,
          userName: displayName,
          status: 'rejected',
          failureReason: msg,
          idempotencyKey,
        });
        return { ok: false, status: 'rejected', code: upperCode, message: msg };
      }

      const effectiveCooldown = Math.max(settings.globalCooldownSec, Number(codeRow.cooldown_sec || 0));
      if (effectiveCooldown > 0) {
        const lastSuccess = db
          .prepare(`SELECT claimed_at FROM redeem_claims WHERE user_phone = ? AND code = ? AND status = 'success' ORDER BY id DESC LIMIT 1`)
          .get(userPhone, upperCode) as { claimed_at: string } | undefined;
        if (lastSuccess) {
          const elapsedSec = (Date.now() - new Date(lastSuccess.claimed_at + 'Z').getTime()) / 1000;
          if (elapsedSec < effectiveCooldown) {
            const waitSec = Math.ceil(effectiveCooldown - elapsedSec);
            const msg = `Tunggu ${waitSec} detik sebelum mengklaim kode ini kembali.`;
            logClaimAttempt({
              code: upperCode,
              codeName: codeRow.name,
              userPhone,
              userName: displayName,
              status: 'rejected',
              failureReason: msg,
              idempotencyKey,
            });
            return { ok: false, status: 'rejected', code: upperCode, message: msg };
          }
        }
      }

      const additionalRewards = parseAdditionalRewards(
        codeRow.additional_rewards_json,
        Number(codeRow.reward_limit || 0),
        Number(codeRow.reward_premium_days || 0),
      );

      // Strict server-side registry & handler verification BEFORE applying any reward!
      for (const item of additionalRewards) {
        const reg = REWARD_REGISTRY.find((r) => r.id === item.rewardId);
        if (!reg || !reg.hasRealHandler || !ADDITIONAL_REWARD_HANDLERS[reg.handlerKey]) {
          throw new Error(`Reward handler "${item.rewardId}" tidak aktif atau belum diimplementasikan.`);
        }
        const paramCheck = validateAdditionalReward(item);
        if (!paramCheck.ok) {
          throw new Error(paramCheck.error);
        }
      }

      const rewardBalance = Math.max(0, Number(codeRow.reward_balance || 0));
      const rewardExp = Math.max(0, Number(codeRow.reward_exp || 0));
      const rewardLevel = Math.max(0, Number(codeRow.reward_level || 0));

      // Apply Balance + EXP atomically via shared helper (supports SQLite savepoint inside transaction)
      applyUserBalanceAndExp(userPhone, displayName, rewardBalance, rewardExp, `redeem:${upperCode}`, upperCode);

      if (rewardLevel > 0) {
        db.prepare(`UPDATE users SET level = level + ?, updated_at = datetime('now') WHERE phone = ?`).run(rewardLevel, userPhone);
      }

      const rewardParts: string[] = [];
      if (rewardBalance > 0) rewardParts.push(`+${rewardBalance} Balance`);
      if (rewardExp > 0) rewardParts.push(`+${rewardExp} EXP`);
      if (rewardLevel > 0) rewardParts.push(`+${rewardLevel} Level`);

      let dailyLimitBonus = 0;
      let premiumDays = 0;
      const badges: string[] = [];
      let streakBoost = 0;
      const grantedItems: Array<{ rewardId: string; name: string; summary: string }> = [];

      for (const item of additionalRewards) {
        const reg = REWARD_REGISTRY.find((r) => r.id === item.rewardId)!;
        const handler = ADDITIONAL_REWARD_HANDLERS[reg.handlerKey];
        const res = handler(userPhone, item.params || {}, upperCode);
        if (res.deltaLimit) dailyLimitBonus += res.deltaLimit;
        if (res.deltaPremiumDays) premiumDays += res.deltaPremiumDays;
        if (res.badgeName) badges.push(res.badgeName);
        if (res.deltaStreak) streakBoost += res.deltaStreak;
        rewardParts.push(res.summary);
        grantedItems.push({ rewardId: reg.id, name: reg.name, summary: res.summary });
      }

      // Atomic quota update ensuring race safety
      const quotaUpdate = db
        .prepare(`
          UPDATE redeem_codes
          SET claimed_count = claimed_count + 1, updated_at = datetime('now')
          WHERE code = ? AND active = 1 AND (max_claims = 0 OR claimed_count < max_claims)
        `)
        .run(upperCode);

      if (quotaUpdate.changes !== 1) {
        throw new Error(`Kuota klaim kode ${upperCode} baru saja habis.`);
      }

      const rewardsGranted = {
        balance: rewardBalance,
        exp: rewardExp,
        levelBonus: rewardLevel,
        dailyLimitBonus,
        premiumDays,
        badges,
        streakBoost,
        items: grantedItems,
      };

      db.prepare(`
        INSERT INTO redeem_claims (code, user_phone, status, rewards_granted_json, idempotency_key)
        VALUES (?, ?, 'success', ?, ?)
      `).run(upperCode, userPhone, JSON.stringify(rewardsGranted), idempotencyKey ?? null);

      logClaimAttempt({
        code: upperCode,
        codeName: codeRow.name,
        userPhone,
        userName: displayName,
        status: 'success',
        rewardsGranted,
        idempotencyKey,
      });

      const userAfterRow = db
        .prepare('SELECT balance, exp, level, daily_limit, is_premium, streak FROM users WHERE phone = ?')
        .get(userPhone) as any;

      addAuditLog(userPhone, 'redeem_claimed', upperCode, {
        rewardsSummary: rewardParts.join(', '),
      });

      const message = renderRedeemMessage(
        settings.msgSuccess,
        `Kode ${upperCode} berhasil diklaim! Hadiah: ${rewardParts.join(', ')}.`,
        {
          code: upperCode,
          user: displayName,
          rewards: rewardParts.join(', ') || 'Hadiah aktif',
          balance: rewardBalance,
          exp: rewardExp,
          level: rewardLevel,
        },
      );

      return {
        ok: true,
        status: 'success',
        code: upperCode,
        rewardsGranted,
        userAfter: {
          balance: Number(userAfterRow.balance),
          exp: Number(userAfterRow.exp),
          level: Number(userAfterRow.level),
          dailyLimit: Number(userAfterRow.daily_limit),
          isPremium: Boolean(userAfterRow.is_premium),
          streak: Number(userAfterRow.streak),
        },
        message,
      };
    })();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Gagal memproses klaim kode redeem.';
    // Log failed attempt outside rolled-back transaction so failure audit is ALWAYS preserved!
    try {
      logClaimAttempt({
        code: upperCode,
        userPhone,
        userName: displayName,
        status: 'failed',
        failureReason: errMsg,
        idempotencyKey,
      });
      addSystemLog('warn', 'redeem', `Klaim ${upperCode} rollback: ${errMsg}`, { userPhone });
    } catch {
      // ignore secondary log failure
    }
    return {
      ok: false,
      status: 'failed',
      code: upperCode,
      message: errMsg,
    };
  }
}

export function getClaimHistory(opts: {
  status?: string;
  code?: string;
  userPhone?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): { items: any[]; total: number } {
  const limit = Math.min(200, Math.max(1, Number(opts.limit || 50)));
  const offset = Math.max(0, Number(opts.offset || 0));

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (opts.status && opts.status !== 'all') {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts.code) {
    conditions.push('code = ?');
    params.push(opts.code.trim().toUpperCase());
  }
  if (opts.userPhone) {
    conditions.push('user_phone = ?');
    params.push(opts.userPhone.trim());
  }
  if (opts.search && opts.search.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push('(code LIKE ? OR user_phone LIKE ? OR COALESCE(user_name, \'\') LIKE ? OR COALESCE(failure_reason, \'\') LIKE ?)');
    params.push(q, q, q, q);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) as c FROM redeem_claim_logs ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM redeem_claim_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];

  return {
    items: rows.map((r) => {
      let parsedRewards = {};
      try {
        parsedRewards = JSON.parse(r.rewards_granted_json || '{}');
      } catch {
        parsedRewards = {};
      }
      return {
        id: r.id,
        code: r.code,
        codeName: r.code_name || r.code,
        userPhone: r.user_phone,
        userName: r.user_name || r.user_phone,
        status: r.status,
        failureReason: r.failure_reason || null,
        rewardsGranted: parsedRewards,
        createdAt: r.created_at,
      };
    }),
    total,
  };
}

export function getRedeemAnalytics(): {
  totalCodes: number;
  activeCodes: number;
  inactiveCodes: number;
  expiredCodes: number;
  totalAttempts: number;
  successClaims: number;
  failedClaims: number;
  rejectedClaims: number;
  expiredAttempts: number;
  topCodes: Array<{ code: string; name: string; claimedCount: number; maxClaims: number; active: boolean }>;
  rewardTotals: { balanceDistributed: number; expDistributed: number; levelGranted: number; limitGranted: number; premiumDaysGranted: number };
} {
  const codes = db.prepare('SELECT * FROM redeem_codes').all() as any[];
  const nowMs = Date.now();
  const activeCodes = codes.filter((c) => c.active && (!c.expires_at || new Date(c.expires_at).getTime() > nowMs)).length;
  const expiredCodes = codes.filter((c) => c.expires_at && new Date(c.expires_at).getTime() <= nowMs).length;
  const inactiveCodes = codes.filter((c) => !c.active).length;

  const statusRows = db
    .prepare('SELECT status, COUNT(*) as c FROM redeem_claim_logs GROUP BY status')
    .all() as Array<{ status: string; c: number }>;
  const counts: Record<string, number> = {};
  for (const r of statusRows) counts[r.status] = r.c;

  const successLogs = db
    .prepare(`SELECT rewards_granted_json FROM redeem_claim_logs WHERE status = 'success'`)
    .all() as Array<{ rewards_granted_json: string }>;

  let balanceDistributed = 0;
  let expDistributed = 0;
  let levelGranted = 0;
  let limitGranted = 0;
  let premiumDaysGranted = 0;

  for (const row of successLogs) {
    try {
      const g = JSON.parse(row.rewards_granted_json || '{}');
      balanceDistributed += Number(g.balance || 0);
      expDistributed += Number(g.exp || 0);
      levelGranted += Number(g.levelBonus || 0);
      limitGranted += Number(g.dailyLimitBonus || 0);
      premiumDaysGranted += Number(g.premiumDays || 0);
    } catch {
      // ignore malformed log
    }
  }

  const topCodes = db
    .prepare('SELECT code, name, claimed_count, max_claims, active FROM redeem_codes ORDER BY claimed_count DESC LIMIT 8')
    .all() as any[];

  const successClaims = counts.success || 0;
  const failedClaims = counts.failed || 0;
  const rejectedClaims = counts.rejected || 0;
  const expiredAttempts = counts.expired || 0;

  return {
    totalCodes: codes.length,
    activeCodes,
    inactiveCodes,
    expiredCodes,
    totalAttempts: successClaims + failedClaims + rejectedClaims + expiredAttempts + (counts.cancelled || 0),
    successClaims,
    failedClaims,
    rejectedClaims,
    expiredAttempts,
    topCodes: topCodes.map((c) => ({
      code: c.code,
      name: c.name || c.code,
      claimedCount: Number(c.claimed_count || 0),
      maxClaims: Number(c.max_claims || 0),
      active: Boolean(c.active),
    })),
    rewardTotals: {
      balanceDistributed,
      expDistributed,
      levelGranted,
      limitGranted,
      premiumDaysGranted,
    },
  };
}
