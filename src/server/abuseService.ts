import { db } from './db';
import { normalizePhoneDigits } from './economyService';
import { botText, normalizeBotLang } from '../core/botI18n';

export type AbuseSubmoduleKey =
  | 'anti_spam'
  | 'anti_exploit'
  | 'anti_double_claim'
  | 'session_protection'
  | 'economy_protection'
  | 'permission_guard'
  | 'resource_protection'
  | 'audit_monitoring'
  | 'auto_recovery'
  | 'abuse_management';

export type AbuseSeverity = 'user_error' | 'rule_violation' | 'suspicious' | 'confirmed_exploit';

export interface AbuseConfig {
  anti_spam: { enabled: boolean; maxPerMinute: number; minIntervalMs: number; burstCooldownSec: number };
  anti_exploit: { enabled: boolean; blockRepeatedFailuresThreshold: number; detectNegativeAmountAttempt: boolean };
  anti_double_claim: { enabled: boolean; lockWindowSec: number };
  session_protection: { enabled: boolean; unoTimeoutSec: number; singleRoomLock: boolean };
  economy_protection: { enabled: boolean; maxAddLimitPerTx: number; maxTransferPerTx: number; allowBomNegativeBalance: boolean };
  permission_guard: { enabled: boolean; strictOwnerAndAdminCheck: boolean };
  resource_protection: { enabled: boolean; maxMediaTextLength: number; queueMinDelayMs: number; queueMaxDelayMs: number };
  audit_monitoring: { enabled: boolean; retainDays: number };
  auto_recovery: { enabled: boolean; sweepExpiredSessionsEverySec: number };
  abuse_management: { enabled: boolean; autoWarnThreshold: number; autoTempRestrictMinutes: number; requireOwnerForPermanentBan: boolean };
}

export const DEFAULT_ABUSE_CONFIG: AbuseConfig = {
  anti_spam: { enabled: true, maxPerMinute: 20, minIntervalMs: 600, burstCooldownSec: 15 },
  anti_exploit: { enabled: true, blockRepeatedFailuresThreshold: 8, detectNegativeAmountAttempt: true },
  anti_double_claim: { enabled: true, lockWindowSec: 5 },
  session_protection: { enabled: true, unoTimeoutSec: 60, singleRoomLock: true },
  economy_protection: { enabled: true, maxAddLimitPerTx: 500, maxTransferPerTx: 50000, allowBomNegativeBalance: true },
  permission_guard: { enabled: true, strictOwnerAndAdminCheck: true },
  resource_protection: { enabled: true, maxMediaTextLength: 100, queueMinDelayMs: 2000, queueMaxDelayMs: 5000 },
  audit_monitoring: { enabled: true, retainDays: 30 },
  auto_recovery: { enabled: true, sweepExpiredSessionsEverySec: 60 },
  abuse_management: { enabled: true, autoWarnThreshold: 3, autoTempRestrictMinutes: 10, requireOwnerForPermanentBan: true },
};

const userTimestamps = new Map<string, number[]>();
const actionLocks = new Map<string, number>();

export function getAbuseConfig(): AbuseConfig {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'abuse_config_json'`).get() as { value: string } | undefined;
  if (!row) return DEFAULT_ABUSE_CONFIG;
  try {
    const parsed = JSON.parse(row.value);
    return {
      anti_spam: { ...DEFAULT_ABUSE_CONFIG.anti_spam, ...(parsed.anti_spam || {}) },
      anti_exploit: { ...DEFAULT_ABUSE_CONFIG.anti_exploit, ...(parsed.anti_exploit || {}) },
      anti_double_claim: { ...DEFAULT_ABUSE_CONFIG.anti_double_claim, ...(parsed.anti_double_claim || {}) },
      session_protection: { ...DEFAULT_ABUSE_CONFIG.session_protection, ...(parsed.session_protection || {}) },
      economy_protection: { ...DEFAULT_ABUSE_CONFIG.economy_protection, ...(parsed.economy_protection || {}) },
      permission_guard: { ...DEFAULT_ABUSE_CONFIG.permission_guard, ...(parsed.permission_guard || {}) },
      resource_protection: { ...DEFAULT_ABUSE_CONFIG.resource_protection, ...(parsed.resource_protection || {}) },
      audit_monitoring: { ...DEFAULT_ABUSE_CONFIG.audit_monitoring, ...(parsed.audit_monitoring || {}) },
      auto_recovery: { ...DEFAULT_ABUSE_CONFIG.auto_recovery, ...(parsed.auto_recovery || {}) },
      abuse_management: { ...DEFAULT_ABUSE_CONFIG.abuse_management, ...(parsed.abuse_management || {}) },
    };
  } catch {
    return DEFAULT_ABUSE_CONFIG;
  }
}

export function updateAbuseConfig(patch: Partial<AbuseConfig>): AbuseConfig {
  const current = getAbuseConfig();
  const next: AbuseConfig = { ...current };
  (Object.keys(patch) as AbuseSubmoduleKey[]).forEach((k) => {
    if (patch[k]) {
      (next as any)[k] = { ...(current as any)[k], ...(patch[k] as any) };
    }
  });
  db.prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at) VALUES ('abuse_config_json', ?, 0, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(JSON.stringify(next));
  return next;
}

export function recordAbuseEvent(params: {
  userPhone: string;
  chatId?: string;
  submodule: AbuseSubmoduleKey;
  severity: AbuseSeverity;
  actionTaken: string;
  commandName?: string;
  detail: string;
}): void {
  const cfg = getAbuseConfig();
  if (!cfg.audit_monitoring.enabled && params.severity === 'user_error') return;
  const phone = normalizePhoneDigits(params.userPhone) || params.userPhone;
  db.prepare(
    `INSERT INTO abuse_events (user_phone, chat_id, submodule, severity, action_taken, command_name, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    phone,
    params.chatId ?? null,
    params.submodule,
    params.severity,
    params.actionTaken,
    params.commandName ?? null,
    params.detail,
  );
}

export function acquireActionLock(lockKey: string, windowMs?: number): boolean {
  const cfg = getAbuseConfig();
  if (!cfg.anti_double_claim.enabled) return true;
  const ttl = windowMs ?? cfg.anti_double_claim.lockWindowSec * 1000;
  const now = Date.now();
  const existing = actionLocks.get(lockKey);
  if (existing && existing > now) {
    return false;
  }
  actionLocks.set(lockKey, now + ttl);
  if (actionLocks.size > 5000) {
    for (const [k, exp] of actionLocks.entries()) {
      if (exp <= now) actionLocks.delete(k);
    }
  }
  return true;
}

export function releaseActionLock(lockKey: string): void {
  actionLocks.delete(lockKey);
}

export function clearRateLimitBucketsForTests(): void {
  userTimestamps.clear();
  actionLocks.clear();
}

export function getUserRestriction(rawPhone: string): {
  restriction_level: 'none' | 'warned' | 'temp_restricted' | 'blocked';
  reason: string | null;
  warnings_count: number;
  expires_at: string | null;
} {
  const phone = normalizePhoneDigits(rawPhone) || rawPhone;
  const row = db
    .prepare('SELECT restriction_level, reason, warnings_count, expires_at FROM abuse_restrictions WHERE user_phone = ?')
    .get(phone) as
    | {
        restriction_level: 'none' | 'warned' | 'temp_restricted' | 'blocked';
        reason: string | null;
        warnings_count: number;
        expires_at: string | null;
      }
    | undefined;

  if (!row) {
    return { restriction_level: 'none', reason: null, warnings_count: 0, expires_at: null };
  }

  if (row.restriction_level === 'temp_restricted' && row.expires_at) {
    const exp = Date.parse(row.expires_at);
    if (!Number.isNaN(exp) && exp <= Date.now()) {
      db.prepare(
        `UPDATE abuse_restrictions SET restriction_level = 'none', expires_at = NULL, updated_at = datetime('now') WHERE user_phone = ?`,
      ).run(phone);
      return { ...row, restriction_level: 'none', expires_at: null };
    }
  }

  return row;
}

export function checkUserAbuseGate(params: {
  userPhone: string;
  chatId: string;
  commandName: string;
  rawArgs: string;
  isOwner: boolean;
  lang?: string;
  skipRateLimit?: boolean;
}): { allowed: boolean; reason?: string; severity?: AbuseSeverity } {
  if (params.isOwner) return { allowed: true };

  const phone = normalizePhoneDigits(params.userPhone) || params.userPhone;
  const cfg = getAbuseConfig();
  const lang = normalizeBotLang(params.lang);
  const t = botText(lang);

  // 1. Check active restrictions (Abuse Management)
  const restriction = getUserRestriction(phone);
  if (restriction.restriction_level === 'blocked') {
    return {
      allowed: false,
      severity: 'confirmed_exploit',
      reason: t.restrictedUser(restriction.reason || 'Pelanggaran kebijakan bot'),
    };
  }
  if (restriction.restriction_level === 'temp_restricted') {
    return {
      allowed: false,
      severity: 'rule_violation',
      reason: t.restrictedUser(restriction.reason || 'Pembatasan sementara anti-spam'),
    };
  }

  // 2. Anti-Spam check (sliding window — never permanent auto-ban!)
  if (cfg.anti_spam.enabled && !params.skipRateLimit) {
    const now = Date.now();
    const list = (userTimestamps.get(phone) || []).filter((ts) => now - ts < 60_000);
    const lastTs = list[list.length - 1];
    if (lastTs && now - lastTs < cfg.anti_spam.minIntervalMs) {
      recordAbuseEvent({
        userPhone: phone,
        chatId: params.chatId,
        submodule: 'anti_spam',
        severity: 'rule_violation',
        actionTaken: 'cooldown_throttle',
        commandName: params.commandName,
        detail: `Interval antar command terlalu cepat (${now - lastTs}ms < ${cfg.anti_spam.minIntervalMs}ms)`,
      });
      return {
        allowed: false,
        severity: 'rule_violation',
        reason: t.spamWarning(Math.max(1, Math.ceil(cfg.anti_spam.minIntervalMs / 1000))),
      };
    }

    if (list.length >= cfg.anti_spam.maxPerMinute) {
      recordAbuseEvent({
        userPhone: phone,
        chatId: params.chatId,
        submodule: 'anti_spam',
        severity: 'rule_violation',
        actionTaken: 'temp_throttle',
        commandName: params.commandName,
        detail: `Melebihi batas ${cfg.anti_spam.maxPerMinute} command per menit.`,
      });
      return {
        allowed: false,
        severity: 'rule_violation',
        reason: t.spamWarning(cfg.anti_spam.burstCooldownSec),
      };
    }

    list.push(now);
    userTimestamps.set(phone, list);
  }

  // 3. Anti-Exploit payload scan (negative numbers on economy/limit cmds, path traversal)
  if (cfg.anti_exploit.enabled) {
    const economyCmds = new Set(['addlimit', 'buylimit', 'tfbalance', 'addbalance', 'addlevel', 'addxp']);
    if (cfg.anti_exploit.detectNegativeAmountAttempt && economyCmds.has(params.commandName)) {
      if (/(?:^|\s)-\d+/.test(params.rawArgs)) {
        recordAbuseEvent({
          userPhone: phone,
          chatId: params.chatId,
          submodule: 'anti_exploit',
          severity: 'suspicious',
          actionTaken: 'blocked_negative_value',
          commandName: params.commandName,
          detail: `Percobaan input angka negatif pada ${params.commandName}: "${params.rawArgs.slice(0, 60)}"`,
        });
        return {
          allowed: false,
          severity: 'suspicious',
          reason:
            lang === 'en'
              ? 'Negative numbers are not allowed here. Please enter a positive amount.'
              : lang === 'ja'
              ? 'マイナスの数字は使えないよ。プラスの数字を入れてね。'
              : 'Nilai negatif tidak diperbolehkan ya. Masukkan angka positif saja.',
        };
      }
    }

    if (params.rawArgs.includes('../') || params.rawArgs.includes('..\\')) {
      recordAbuseEvent({
        userPhone: phone,
        chatId: params.chatId,
        submodule: 'anti_exploit',
        severity: 'confirmed_exploit',
        actionTaken: 'blocked_path_traversal',
        commandName: params.commandName,
        detail: `Deteksi karakter path traversal pada argumen ${params.commandName}.`,
      });
      return {
        allowed: false,
        severity: 'confirmed_exploit',
        reason: 'Input mengandung karakter yang tidak diizinkan.',
      };
    }
  }

  return { allowed: true };
}

export function setAbuseRestrictionAction(params: {
  userPhone: string;
  action: 'warn' | 'temp_restrict' | 'block' | 'restore';
  reason?: string;
  durationMinutes?: number;
  actor?: string;
}): void {
  const phone = normalizePhoneDigits(params.userPhone) || params.userPhone;
  const actor = params.actor || 'owner';
  const cur = getUserRestriction(phone);

  if (params.action === 'restore') {
    db.prepare(
      `INSERT INTO abuse_restrictions (user_phone, restriction_level, reason, warnings_count, expires_at, updated_by, updated_at)
       VALUES (?, 'none', NULL, 0, NULL, ?, datetime('now'))
       ON CONFLICT(user_phone) DO UPDATE SET restriction_level = 'none', reason = NULL, warnings_count = 0, expires_at = NULL, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    ).run(phone, actor);
    db.prepare(`UPDATE users SET is_banned = 0, ban_reason = NULL, updated_at = datetime('now') WHERE phone = ?`).run(phone);
    db.prepare(`UPDATE abuse_events SET resolved = 1 WHERE user_phone = ?`).run(phone);
    recordAbuseEvent({
      userPhone: phone,
      submodule: 'abuse_management',
      severity: 'user_error',
      actionTaken: 'owner_restored',
      detail: `Akun dipulihkan oleh ${actor}${params.reason ? `: ${params.reason}` : ''}`,
    });
    return;
  }

  if (params.action === 'warn') {
    const warnings = cur.warnings_count + 1;
    db.prepare(
      `INSERT INTO abuse_restrictions (user_phone, restriction_level, reason, warnings_count, expires_at, updated_by, updated_at)
       VALUES (?, 'warned', ?, ?, NULL, ?, datetime('now'))
       ON CONFLICT(user_phone) DO UPDATE SET restriction_level = CASE WHEN restriction_level = 'blocked' THEN 'blocked' ELSE 'warned' END, reason = excluded.reason, warnings_count = excluded.warnings_count, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    ).run(phone, params.reason || 'Peringatan resmi Owner', warnings, actor);
    recordAbuseEvent({
      userPhone: phone,
      submodule: 'abuse_management',
      severity: 'rule_violation',
      actionTaken: 'owner_warned',
      detail: params.reason || 'Peringatan resmi oleh Owner',
    });
    return;
  }

  if (params.action === 'temp_restrict') {
    const mins = Math.max(1, params.durationMinutes ?? 15);
    const exp = new Date(Date.now() + mins * 60_000).toISOString();
    db.prepare(
      `INSERT INTO abuse_restrictions (user_phone, restriction_level, reason, warnings_count, expires_at, updated_by, updated_at)
       VALUES (?, 'temp_restricted', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_phone) DO UPDATE SET restriction_level = 'temp_restricted', reason = excluded.reason, expires_at = excluded.expires_at, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    ).run(phone, params.reason || `Pembatasan sementara (${mins} menit)`, cur.warnings_count, exp, actor);
    recordAbuseEvent({
      userPhone: phone,
      submodule: 'abuse_management',
      severity: 'rule_violation',
      actionTaken: `temp_restricted_${mins}m`,
      detail: params.reason || `Pembatasan sementara selama ${mins} menit`,
    });
    return;
  }

  // block
  db.prepare(
    `INSERT INTO abuse_restrictions (user_phone, restriction_level, reason, warnings_count, expires_at, updated_by, updated_at)
     VALUES (?, 'blocked', ?, ?, NULL, ?, datetime('now'))
     ON CONFLICT(user_phone) DO UPDATE SET restriction_level = 'blocked', reason = excluded.reason, expires_at = NULL, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(phone, params.reason || 'Diblokir oleh Owner', cur.warnings_count, actor);
  db.prepare(`UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now') WHERE phone = ?`).run(
    params.reason || 'Diblokir oleh Owner',
    phone,
  );
  recordAbuseEvent({
    userPhone: phone,
    submodule: 'abuse_management',
    severity: 'confirmed_exploit',
    actionTaken: 'owner_blocked',
    detail: params.reason || 'Blokir permanen oleh Owner',
  });
}

export function getAbuseDashboardState() {
  const config = getAbuseConfig();
  const events = db
    .prepare('SELECT * FROM abuse_events ORDER BY id DESC LIMIT 100')
    .all() as Array<Record<string, any>>;
  const restrictions = db
    .prepare('SELECT * FROM abuse_restrictions WHERE restriction_level != \'none\' ORDER BY updated_at DESC')
    .all() as Array<Record<string, any>>;

  const severityCounts = db
    .prepare('SELECT severity, COUNT(*) as count FROM abuse_events GROUP BY severity')
    .all() as Array<{ severity: string; count: number }>;

  const submoduleCounts = db
    .prepare('SELECT submodule, COUNT(*) as count FROM abuse_events GROUP BY submodule')
    .all() as Array<{ submodule: string; count: number }>;

  const activeLocks = actionLocks.size;
  const activeBuckets = userTimestamps.size;

  return {
    config,
    events,
    restrictions,
    severityCounts,
    submoduleCounts,
    runtimeHealth: {
      activeActionLocks: activeLocks,
      trackedRateWindows: activeBuckets,
    },
  };
}
