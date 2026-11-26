import crypto from 'node:crypto';
import { db } from './db';
import { normalizeBotLang, botText } from '../core/botI18n';

export interface LimitConfig {
  initialGeneralLimit: number;
  pricePerUnit: number;
  defaultCommandCost: number;
  allowSelfGift: boolean;
  exemptCommands: string[];
  maxAddLimitPerTx: number;
}

export interface BomConfig {
  gridSize: number;
  bombCount: number;
  rewardPerStep: number;
  clearBonus: number;
  bombPenalty: number;
  partialRewardPct: number;
}

export function normalizePhoneDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  return digits;
}

function getSettingValue(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

function setSettingValue(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 0, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

export function getLimitConfig(): LimitConfig {
  const initialGeneralLimit = Math.max(1, Number(getSettingValue('limit_initial_general', '50')) || 50);
  const pricePerUnit = Math.max(1, Number(getSettingValue('limit_price_per_unit', '25')) || 25);
  const defaultCommandCost = Math.max(0, Number(getSettingValue('limit_default_cost', '1')) ?? 1);
  const allowSelfGift = getSettingValue('limit_allow_self_gift', 'false') === 'true';
  const exemptRaw = getSettingValue(
    'limit_exempt_commands',
    'menu,help,ping,runtime,infobot,version,changelog,owner,sender,limit,balance,level,profile,cekpremium,addlimit,buylimit,redeem',
  );
  const exemptCommands = exemptRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  let maxAddLimitPerTx = 500;
  try {
    const abuseCfg = JSON.parse(getSettingValue('abuse_config_json', '{}'));
    if (typeof abuseCfg?.economy_protection?.maxAddLimitPerTx === 'number') {
      maxAddLimitPerTx = Math.max(1, abuseCfg.economy_protection.maxAddLimitPerTx);
    }
  } catch {
    // ignore
  }

  return {
    initialGeneralLimit,
    pricePerUnit,
    defaultCommandCost,
    allowSelfGift,
    exemptCommands,
    maxAddLimitPerTx,
  };
}

export function updateLimitConfig(patch: Partial<LimitConfig>): LimitConfig {
  if (typeof patch.initialGeneralLimit === 'number' && patch.initialGeneralLimit >= 1) {
    setSettingValue('limit_initial_general', String(Math.floor(patch.initialGeneralLimit)));
  }
  if (typeof patch.pricePerUnit === 'number' && patch.pricePerUnit >= 1) {
    setSettingValue('limit_price_per_unit', String(Math.floor(patch.pricePerUnit)));
  }
  if (typeof patch.defaultCommandCost === 'number' && patch.defaultCommandCost >= 0) {
    setSettingValue('limit_default_cost', String(Math.floor(patch.defaultCommandCost)));
  }
  if (typeof patch.allowSelfGift === 'boolean') {
    setSettingValue('limit_allow_self_gift', patch.allowSelfGift ? 'true' : 'false');
  }
  if (Array.isArray(patch.exemptCommands)) {
    const cleaned = Array.from(
      new Set(patch.exemptCommands.map((s) => s.trim().toLowerCase()).filter(Boolean)),
    );
    setSettingValue('limit_exempt_commands', cleaned.join(','));
  }
  return getLimitConfig();
}

export function getBomConfig(): BomConfig {
  const gridSize = Math.min(25, Math.max(6, Number(getSettingValue('bom_grid_size', '12')) || 12));
  const maxBombs = Math.max(1, gridSize - 2);
  const rawBombs = Math.max(1, Number(getSettingValue('bom_bomb_count', String(Math.max(2, Math.round(gridSize * 0.25))))) || 3);
  const bombCount = Math.min(maxBombs, rawBombs);
  const rewardPerStep = Math.max(1, Number(getSettingValue('bom_reward_per_step', '25')) || 25);
  const clearBonus = Math.max(0, Number(getSettingValue('bom_clear_bonus', '100')) || 100);
  const bombPenalty = Math.max(0, Number(getSettingValue('bom_bomb_penalty', '40')) || 40);
  const partialRewardPct = Math.min(100, Math.max(0, Number(getSettingValue('bom_partial_reward_pct', '50')) ?? 50));

  return { gridSize, bombCount, rewardPerStep, clearBonus, bombPenalty, partialRewardPct };
}

export function updateBomConfig(patch: Partial<BomConfig>): BomConfig {
  if (typeof patch.gridSize === 'number') {
    const g = Math.min(25, Math.max(6, Math.floor(patch.gridSize)));
    setSettingValue('bom_grid_size', String(g));
  }
  if (typeof patch.bombCount === 'number') {
    const currentGrid = getBomConfig().gridSize;
    const b = Math.min(currentGrid - 2, Math.max(1, Math.floor(patch.bombCount)));
    setSettingValue('bom_bomb_count', String(b));
  }
  if (typeof patch.rewardPerStep === 'number' && patch.rewardPerStep >= 1) {
    setSettingValue('bom_reward_per_step', String(Math.floor(patch.rewardPerStep)));
  }
  if (typeof patch.clearBonus === 'number' && patch.clearBonus >= 0) {
    setSettingValue('bom_clear_bonus', String(Math.floor(patch.clearBonus)));
  }
  if (typeof patch.bombPenalty === 'number' && patch.bombPenalty >= 0) {
    setSettingValue('bom_bomb_penalty', String(Math.floor(patch.bombPenalty)));
  }
  if (typeof patch.partialRewardPct === 'number') {
    setSettingValue('bom_partial_reward_pct', String(Math.min(100, Math.max(0, Math.floor(patch.partialRewardPct)))));
  }
  return getBomConfig();
}

export interface UserEconomyRow {
  id: string;
  phone: string;
  display_name: string;
  role: string;
  language: string;
  is_premium: number;
  premium_expires_at: string | null;
  is_banned: number;
  balance: number;
  exp: number;
  level: number;
  daily_limit: number;
  used_today: number;
  streak: number;
}

export function ensureUserRecord(rawPhone: string, displayName?: string): UserEconomyRow {
  const phone = normalizePhoneDigits(rawPhone) || rawPhone;
  const cfg = getLimitConfig();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, phone, display_name, balance, exp, level, daily_limit)
     VALUES (?, ?, ?, 100, 0, 1, ?)`,
  ).run(`usr-${phone}`, phone, displayName || phone, cfg.initialGeneralLimit);

  if (displayName && displayName.trim()) {
    db.prepare(`UPDATE users SET display_name = ? WHERE phone = ? AND (display_name = phone OR display_name = '')`).run(
      displayName.trim(),
      phone,
    );
  }

  db.prepare(`INSERT OR IGNORE INTO balances (user_phone, amount) VALUES (?, 100)`).run(phone);

  const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as UserEconomyRow;
  return syncExpiredPremiumIfNeeded(row);
}

export function isUserPremiumValid(user: Pick<UserEconomyRow, 'is_premium' | 'premium_expires_at'>): boolean {
  if (!user.is_premium) return false;
  if (!user.premium_expires_at) return true;
  const ts = Date.parse(user.premium_expires_at);
  if (Number.isNaN(ts)) return true;
  return ts > Date.now();
}

export function syncExpiredPremiumIfNeeded(user: UserEconomyRow): UserEconomyRow {
  if (user.is_premium === 1 && user.premium_expires_at) {
    const ts = Date.parse(user.premium_expires_at);
    if (!Number.isNaN(ts) && ts <= Date.now()) {
      // Downgrade status to non-premium WITHOUT resetting or clamping user's remaining daily_limit
      db.prepare(`UPDATE users SET is_premium = 0, updated_at = datetime('now') WHERE phone = ?`).run(user.phone);
      return { ...user, is_premium: 0 };
    }
  }
  return user;
}

export function setUserPremiumStatus(
  rawPhone: string,
  isPremium: boolean,
  expiresAt: string | null = null,
): UserEconomyRow {
  const user = ensureUserRecord(rawPhone);
  db.prepare(
    `UPDATE users SET is_premium = ?, premium_expires_at = ?, updated_at = datetime('now') WHERE phone = ?`,
  ).run(isPremium ? 1 : 0, isPremium ? expiresAt : null, user.phone);
  return ensureUserRecord(user.phone);
}

export function getCommandLimitCost(commandName: string, isOwnerCmd = false): number {
  if (isOwnerCmd) return 0;
  const cfg = getLimitConfig();
  const cmdLower = commandName.trim().toLowerCase();
  if (cfg.exemptCommands.includes(cmdLower)) return 0;

  const cs = db
    .prepare('SELECT free_access, limit_cost FROM command_settings WHERE command_name = ?')
    .get(cmdLower) as { free_access: number; limit_cost: number | null } | undefined;

  if (cs?.free_access === 1) return 0;
  if (typeof cs?.limit_cost === 'number' && cs.limit_cost >= 0) return cs.limit_cost;
  return cfg.defaultCommandCost;
}

export function consumeLimitForCommand(params: {
  userPhone: string;
  displayName?: string;
  commandName: string;
  isOwnerActor?: boolean;
  isOwnerCommand?: boolean;
  txKey?: string;
}): {
  allowed: boolean;
  cost: number;
  remainingLimit: number;
  unlimited: boolean;
  alreadyApplied?: boolean;
} {
  const phone = normalizePhoneDigits(params.userPhone) || params.userPhone;
  const txKey = params.txKey || `cmd-${phone}-${params.commandName}-${crypto.randomUUID()}`;

  return db.transaction(() => {
    const existingTx = db
      .prepare('SELECT limit_after, delta_limit FROM limit_transactions WHERE tx_key = ?')
      .get(txKey) as { limit_after: number; delta_limit: number } | undefined;

    if (existingTx) {
      return {
        allowed: true,
        cost: Math.abs(existingTx.delta_limit),
        remainingLimit: existingTx.limit_after,
        unlimited: false,
        alreadyApplied: true,
      };
    }

    const user = ensureUserRecord(phone, params.displayName);
    const isPremium = isUserPremiumValid(user);
    const cost = getCommandLimitCost(params.commandName, Boolean(params.isOwnerCommand));

    if (params.isOwnerActor || isPremium || cost === 0) {
      return {
        allowed: true,
        cost: 0,
        remainingLimit: user.daily_limit,
        unlimited: Boolean(params.isOwnerActor || isPremium),
      };
    }

    if (user.daily_limit < cost) {
      return {
        allowed: false,
        cost,
        remainingLimit: user.daily_limit,
        unlimited: false,
      };
    }

    const nextLimit = user.daily_limit - cost;
    db.prepare(
      `UPDATE users SET daily_limit = ?, used_today = used_today + ?, updated_at = datetime('now') WHERE phone = ?`,
    ).run(nextLimit, cost, phone);

    db.prepare(
      `INSERT INTO limit_transactions (tx_key, actor_phone, target_phone, tx_type, delta_limit, delta_balance, limit_after, command_name, reason)
       VALUES (?, ?, ?, 'deduct', ?, 0, ?, ?, ?)`,
    ).run(
      txKey,
      phone,
      phone,
      -cost,
      nextLimit,
      params.commandName,
      `Pemakaian command ${params.commandName}`,
    );

    return {
      allowed: true,
      cost,
      remainingLimit: nextLimit,
      unlimited: false,
    };
  })();
}

export type AddLimitMode = 'self' | 'phone' | 'reply';

export interface AddLimitResult {
  ok: boolean;
  error?: string;
  exploitAttempt?: boolean;
  mode: AddLimitMode;
  amount: number;
  totalPrice: number;
  actorPhone: string;
  targetPhone: string;
  actorBalanceAfter: number;
  targetLimitAfter: number;
  idempotentReplay?: boolean;
  message: string;
}

export function executeAddLimit(params: {
  actorPhone: string;
  actorName?: string;
  mode: AddLimitMode;
  targetPhoneRaw?: string;
  targetName?: string;
  amount: number;
  prefix?: string;
  lang?: string;
  idempotencyKey?: string;
  skipBalanceChargeForOwner?: boolean;
}): AddLimitResult {
  const actorPhone = normalizePhoneDigits(params.actorPhone) || params.actorPhone;
  const targetPhone =
    params.mode === 'self'
      ? actorPhone
      : normalizePhoneDigits(params.targetPhoneRaw || '') || '';
  const prefix = params.prefix || '.';
  const lang = normalizeBotLang(params.lang);
  const cfg = getLimitConfig();

  if (!Number.isFinite(params.amount) || !Number.isInteger(params.amount) || params.amount <= 0) {
    return {
      ok: false,
      exploitAttempt: params.amount <= 0,
      error: 'invalid_amount',
      mode: params.mode,
      amount: params.amount,
      totalPrice: 0,
      actorPhone,
      targetPhone: targetPhone || actorPhone,
      actorBalanceAfter: 0,
      targetLimitAfter: 0,
      message:
        lang === 'en'
          ? `Please enter a valid positive number of limits (1–${cfg.maxAddLimitPerTx}). Example: ${prefix}addlimit 10`
          : lang === 'ja'
          ? `1〜${cfg.maxAddLimitPerTx} の正しい数字を入れてね。例: ${prefix}addlimit 10`
          : `Jumlah limit harus angka bulat positif antara 1 sampai ${cfg.maxAddLimitPerTx} ya. Contoh: ${prefix}addlimit 10`,
    };
  }

  if (params.amount > cfg.maxAddLimitPerTx) {
    return {
      ok: false,
      exploitAttempt: true,
      error: 'exceeds_max_per_tx',
      mode: params.mode,
      amount: params.amount,
      totalPrice: 0,
      actorPhone,
      targetPhone: targetPhone || actorPhone,
      actorBalanceAfter: 0,
      targetLimitAfter: 0,
      message:
        lang === 'en'
          ? `Maximum per transaction is ${cfg.maxAddLimitPerTx} limits.`
          : lang === 'ja'
          ? `1回の取引上限は ${cfg.maxAddLimitPerTx} リミットだよ。`
          : `Maksimal pembelian/kirim dalam satu kali transaksi adalah ${cfg.maxAddLimitPerTx} limit ya.`,
    };
  }

  if (params.mode !== 'self' && !targetPhone) {
    return {
      ok: false,
      error: 'missing_target',
      mode: params.mode,
      amount: params.amount,
      totalPrice: 0,
      actorPhone,
      targetPhone: '',
      actorBalanceAfter: 0,
      targetLimitAfter: 0,
      message:
        lang === 'en'
          ? `Recipient number wasn't found. Reply to their message with ${prefix}addlimit <amount> or type ${prefix}addlimit 628xxx <amount>.`
          : lang === 'ja'
          ? `送り先の番号が見つからなかったよ。相手のメッセージに返信して ${prefix}addlimit <数> か ${prefix}addlimit 628xxx <数> を使ってね。`
          : `Nomor penerima belum ketemu nih. Kamu bisa balas chat penerima pakai ${prefix}addlimit <jumlah> atau ketik ${prefix}addlimit 628xxx <jumlah>.`,
    };
  }

  if (params.mode !== 'self' && targetPhone === actorPhone && !cfg.allowSelfGift) {
    return {
      ok: false,
      error: 'self_gift_disabled',
      mode: params.mode,
      amount: params.amount,
      totalPrice: 0,
      actorPhone,
      targetPhone,
      actorBalanceAfter: 0,
      targetLimitAfter: 0,
      message:
        lang === 'en'
          ? `You don't need to gift yourself—just run ${prefix}addlimit ${params.amount} to buy limits directly.`
          : lang === 'ja'
          ? `自分宛てギフトの代わりに ${prefix}addlimit ${params.amount} をそのまま使ってね。`
          : `Untuk nambah limit akun sendiri nggak perlu mode kirim ya—langsung aja ketik ${prefix}addlimit ${params.amount}.`,
    };
  }

  const txKey = params.idempotencyKey || `addlimit-${actorPhone}-${targetPhone}-${crypto.randomUUID()}`;

  return db.transaction(() => {
    const existing = db
      .prepare('SELECT limit_after, delta_balance, target_phone FROM limit_transactions WHERE tx_key = ?')
      .get(txKey) as { limit_after: number; delta_balance: number; target_phone: string } | undefined;

    if (existing) {
      const actorRow = ensureUserRecord(actorPhone, params.actorName);
      return {
        ok: true,
        mode: params.mode,
        amount: params.amount,
        totalPrice: Math.abs(existing.delta_balance),
        actorPhone,
        targetPhone: existing.target_phone,
        actorBalanceAfter: actorRow.balance,
        targetLimitAfter: existing.limit_after,
        idempotentReplay: true,
        message:
          lang === 'en'
            ? `That ${prefix}addlimit transaction was already processed. Current limit: ${existing.limit_after}.`
            : lang === 'ja'
            ? `この ${prefix}addlimit 取引はすでに処理済みだよ。現在のリミット: ${existing.limit_after}。`
            : `Transaksi ${prefix}addlimit ini sudah diproses sebelumnya. Sisa limit penerima sekarang: ${existing.limit_after}.`,
      };
    }

    const actor = ensureUserRecord(actorPhone, params.actorName);
    const target = targetPhone === actorPhone ? actor : ensureUserRecord(targetPhone, params.targetName);
    const totalPrice = params.skipBalanceChargeForOwner ? 0 : params.amount * cfg.pricePerUnit;

    if (totalPrice > 0 && actor.balance < totalPrice) {
      return {
        ok: false,
        error: 'insufficient_balance',
        mode: params.mode,
        amount: params.amount,
        totalPrice,
        actorPhone,
        targetPhone: target.phone,
        actorBalanceAfter: actor.balance,
        targetLimitAfter: target.daily_limit,
        message:
          lang === 'en'
            ? `Your balance isn't enough yet (need ${totalPrice}, you have ${actor.balance}). Each limit costs ${cfg.pricePerUnit} balance.`
            : lang === 'ja'
            ? `残高が足りないよ（必要 ${totalPrice}、現在 ${actor.balance}）。1リミット = ${cfg.pricePerUnit} 残高だよ。`
            : `Balance kamu belum cukup nih (butuh ${totalPrice}, punyamu ${actor.balance}). Harga 1 limit = ${cfg.pricePerUnit} balance.`,
      };
    }

    const actorBalanceAfter = actor.balance - totalPrice;
    const targetLimitAfter = target.daily_limit + params.amount;

    if (totalPrice > 0) {
      db.prepare(`UPDATE users SET balance = ?, updated_at = datetime('now') WHERE phone = ?`).run(
        actorBalanceAfter,
        actorPhone,
      );
      db.prepare(
        `INSERT INTO balances (user_phone, amount, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_phone) DO UPDATE SET amount = excluded.amount, updated_at = datetime('now')`,
      ).run(actorPhone, actorBalanceAfter);
      db.prepare(
        `INSERT INTO balance_transactions (user_phone, delta, reason, ref_id, balance_after) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        actorPhone,
        -totalPrice,
        params.mode === 'self' ? `Beli ${params.amount} limit` : `Kirim ${params.amount} limit ke ${target.phone}`,
        txKey,
        actorBalanceAfter,
      );
    }

    db.prepare(`UPDATE users SET daily_limit = ?, updated_at = datetime('now') WHERE phone = ?`).run(
      targetLimitAfter,
      target.phone,
    );

    const txType = params.skipBalanceChargeForOwner
      ? 'admin_grant'
      : params.mode === 'self'
      ? 'buy_self'
      : 'gift_send';

    db.prepare(
      `INSERT INTO limit_transactions (tx_key, actor_phone, target_phone, tx_type, delta_limit, delta_balance, limit_after, command_name, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'addlimit', ?)`,
    ).run(
      txKey,
      actorPhone,
      target.phone,
      txType,
      params.amount,
      -totalPrice,
      targetLimitAfter,
      params.mode === 'self'
        ? `Pembelian mandiri ${params.amount} limit`
        : params.mode === 'reply'
        ? `Kirim ${params.amount} limit via balas chat ke ${target.phone}`
        : `Kirim ${params.amount} limit ke ${target.phone}`,
    );

    const msg =
      params.mode === 'self'
        ? lang === 'en'
          ? `Added +${params.amount} limit to your account (${totalPrice} balance used). Your limit is now ${targetLimitAfter}, remaining balance ${actorBalanceAfter}.`
          : lang === 'ja'
          ? `自分のリミットを +${params.amount} 追加したよ（消費残高 ${totalPrice}）。現在のリミットは ${targetLimitAfter}、残り残高は ${actorBalanceAfter}。`
          : `Berhasil tambah +${params.amount} limit ke akunmu (pakai ${totalPrice} balance). Total limit kamu sekarang ${targetLimitAfter}, sisa balance ${actorBalanceAfter}.`
        : lang === 'en'
        ? `Sent +${params.amount} limit to ${target.display_name} (${target.phone}) for ${totalPrice} balance! Their limit is now ${targetLimitAfter}, your balance is ${actorBalanceAfter}.`
        : lang === 'ja'
        ? `${target.display_name} (${target.phone}) に +${params.amount} リミットを送ったよ（${totalPrice} 残高）。相手のリミットは ${targetLimitAfter}、あなたの残高は ${actorBalanceAfter}。`
        : `Berhasil kirim +${params.amount} limit ke ${target.display_name} (${target.phone}) dengan biaya ${totalPrice} balance! Limit penerima sekarang ${targetLimitAfter}, sisa balance kamu ${actorBalanceAfter}.`;

    return {
      ok: true,
      mode: params.mode,
      amount: params.amount,
      totalPrice,
      actorPhone,
      targetPhone: target.phone,
      actorBalanceAfter,
      targetLimitAfter,
      message: msg,
    };
  })();
}

export interface LeaderboardEntry {
  rank: number;
  phone: string;
  displayName: string;
  balance: number;
  level: number;
  exp: number;
  isPremium: boolean;
}

export function getLeaderboardEntries(params: {
  scope: 'global' | 'local';
  groupId?: string;
  limit?: number;
}): LeaderboardEntry[] {
  const cap = Math.min(50, Math.max(1, params.limit ?? (Number(getSettingValue('leaderboard_limit', '10')) || 10)));
  if (params.scope === 'local') {
    if (!params.groupId) return [];
    const rows = db
      .prepare(
        `SELECT u.phone, u.display_name, u.balance, u.level, u.exp, u.is_premium, u.premium_expires_at
         FROM group_members gm
         JOIN users u ON u.phone = gm.user_phone
         WHERE gm.group_id = ? AND u.is_banned = 0
         ORDER BY u.balance DESC, u.level DESC, u.exp DESC, u.phone ASC
         LIMIT ?`,
      )
      .all(params.groupId, cap) as Array<{
      phone: string;
      display_name: string;
      balance: number;
      level: number;
      exp: number;
      is_premium: number;
      premium_expires_at: string | null;
    }>;

    return rows.map((r, idx) => ({
      rank: idx + 1,
      phone: r.phone,
      displayName: r.display_name || r.phone,
      balance: r.balance,
      level: r.level,
      exp: r.exp,
      isPremium: isUserPremiumValid(r),
    }));
  }

  const rows = db
    .prepare(
      `SELECT phone, display_name, balance, level, exp, is_premium, premium_expires_at
       FROM users
       WHERE is_banned = 0
       ORDER BY balance DESC, level DESC, exp DESC, phone ASC
       LIMIT ?`,
    )
    .all(cap) as Array<{
    phone: string;
    display_name: string;
    balance: number;
    level: number;
    exp: number;
    is_premium: number;
    premium_expires_at: string | null;
  }>;

  return rows.map((r, idx) => ({
    rank: idx + 1,
    phone: r.phone,
    displayName: r.display_name || r.phone,
    balance: r.balance,
    level: r.level,
    exp: r.exp,
    isPremium: isUserPremiumValid(r),
  }));
}

export function getUserRankPosition(scope: 'global' | 'local', userPhone: string, groupId?: string): number | null {
  const cleanPhone = normalizePhoneDigits(userPhone) || userPhone;
  const all = getLeaderboardEntries({ scope, groupId, limit: 500 });
  const found = all.find((e) => e.phone === cleanPhone);
  return found ? found.rank : null;
}

export function formatLeaderboardMessage(params: {
  scope: 'global' | 'local';
  groupId?: string;
  groupName?: string;
  requesterPhone: string;
  lang?: string;
}): string {
  const lang = normalizeBotLang(params.lang);
  const entries = getLeaderboardEntries({ scope: params.scope, groupId: params.groupId });
  const myRank = getUserRankPosition(params.scope, params.requesterPhone, params.groupId);

  if (entries.length === 0) {
    if (params.scope === 'local') {
      return lang === 'en'
        ? 'No tracked active members in this group leaderboard yet. Chat or run a command here first!'
        : lang === 'ja'
        ? 'このグループのランキングにはまだデータがないよ。何かメッセージを送ってみてね！'
        : 'Belum ada anggota grup yang tercatat di leaderboard lokal ini. Yuk ngobrol atau pakai command dulu di grup ini!';
    }
    return lang === 'en'
      ? 'No users in the global leaderboard yet.'
      : 'Belum ada data pengguna pada leaderboard global.';
  }

  const title =
    params.scope === 'local'
      ? lang === 'en'
        ? `🏆 *Local Group Leaderboard* (${params.groupName || params.groupId})`
        : lang === 'ja'
        ? `🏆 *グループローカルランキング* (${params.groupName || params.groupId})`
        : `🏆 *Papan Peringkat Lokal Grup* (${params.groupName || params.groupId})`
      : lang === 'en'
      ? '🌍 *Global Leaderboard — Freya-san Hub*'
      : lang === 'ja'
      ? '🌍 *グローバルランキング — Freya-san Hub*'
      : '🌍 *Papan Peringkat Global — Freya-san Hub*';

  const lines = entries.map(
    (e) =>
      `${e.rank}. *${e.displayName}*${e.isPremium ? ' [PREM]' : ''}\n   Balance: ${e.balance} · Lv.${e.level} (${e.exp} EXP)`,
  );

  const footer =
    myRank !== null
      ? lang === 'en'
        ? `\nYour rank: #${myRank}`
        : lang === 'ja'
        ? `\nあなたの順位: #${myRank}`
        : `\nPeringkat kamu sekarang: #${myRank}`
      : '';

  return `${title}\n\n${lines.join('\n')}${footer}\n\n_${botText(lang).botFooter}_`;
}
