import crypto from 'node:crypto';
import { db } from './db';
import { normalizePhoneDigits } from './economyService';
import { botText, getJakartaDateKey, getMonthKeyFromDateKey, normalizeBotLang, shiftDateKey } from '../core/botI18n';

export function getConfiguredTimezone(): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'bot_timezone'`).get() as { value: string } | undefined;
  return row?.value || 'Asia/Jakarta';
}

export function getStreakSettings(): { maxPairs: number; maxRestoresPerMonth: number; timezone: string } {
  const maxPairsRow = db.prepare(`SELECT value FROM settings WHERE key = 'streak_max_pairs'`).get() as { value: string } | undefined;
  const maxRestoreRow = db.prepare(`SELECT value FROM settings WHERE key = 'streak_max_restores_per_month'`).get() as { value: string } | undefined;
  return {
    maxPairs: Math.max(1, Number(maxPairsRow?.value ?? 10) || 10),
    maxRestoresPerMonth: Math.max(1, Number(maxRestoreRow?.value ?? 5) || 5),
    timezone: getConfiguredTimezone(),
  };
}

export function isBotOrMinbotPhone(rawPhone: string, knownBotPhones: string[] = []): boolean {
  const clean = normalizePhoneDigits(rawPhone);
  const rawLower = String(rawPhone || '').trim().toLowerCase();
  if (!clean && !rawLower) return false;
  if (rawLower === 'bot' || rawLower === 'minbot' || rawLower === 'freyabot' || rawLower.includes('minbot')) {
    return true;
  }

  const botSession = db.prepare(`SELECT phone_number FROM bot_sessions WHERE id = 'primary'`).get() as
    | { phone_number: string | null }
    | undefined;
  const minbotsSetting = db.prepare(`SELECT value FROM settings WHERE key = 'minbot_numbers'`).get() as
    | { value: string }
    | undefined;

  const botNumbers = new Set<string>(knownBotPhones.map((p) => normalizePhoneDigits(p)).filter(Boolean));
  if (botSession?.phone_number) {
    botNumbers.add(normalizePhoneDigits(botSession.phone_number));
  }
  if (minbotsSetting?.value) {
    for (const part of minbotsSetting.value.split(',')) {
      const n = normalizePhoneDigits(part);
      if (n) botNumbers.add(n);
    }
  }

  return clean ? botNumbers.has(clean) : false;
}

function canonicalPairKey(a: string, b: string): [string, string, string] {
  const sorted = [a, b].sort();
  return [sorted[0], sorted[1], `${sorted[0]}::${sorted[1]}`];
}

export interface PairStreakRow {
  id: string;
  pair_key: string;
  user_a: string;
  user_b: string;
  initiator_phone: string;
  partner_phone: string;
  status: 'pending' | 'active' | 'broken' | 'ended';
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  user_a_last_ping_date: string | null;
  user_b_last_ping_date: string | null;
}

export function getUserPairStreaks(rawPhone: string): PairStreakRow[] {
  const phone = normalizePhoneDigits(rawPhone) || rawPhone;
  return db
    .prepare(
      `SELECT * FROM pair_streaks
       WHERE (user_a = ? OR user_b = ?) AND status != 'ended'
       ORDER BY current_streak DESC, updated_at DESC`,
    )
    .all(phone, phone) as PairStreakRow[];
}

export function invitePairStreak(params: {
  initiatorPhone: string;
  partnerPhone: string;
  lang?: string;
  knownBotPhones?: string[];
  todayKey?: string;
}): { ok: boolean; ignoredBot?: boolean; message: string; streakId?: string } {
  const lang = normalizeBotLang(params.lang);
  const initPhone = normalizePhoneDigits(params.initiatorPhone) || params.initiatorPhone;
  const partnerPhone = normalizePhoneDigits(params.partnerPhone) || params.partnerPhone;

  // Reject/ignore automatically if bot or minbot is the initiator OR the target!
  if (
    isBotOrMinbotPhone(params.initiatorPhone, params.knownBotPhones) ||
    isBotOrMinbotPhone(params.partnerPhone, params.knownBotPhones)
  ) {
    return {
      ok: false,
      ignoredBot: true,
      message:
        lang === 'en'
          ? 'Streaks are only for real users—bot/minbot accounts cannot join pair streaks.'
          : lang === 'ja'
          ? 'ストリークはユーザー同士専用だよ。ボットやミニボットとは組めないんだ。'
          : 'Streak cuma bisa dibuat sesama user ya—bot atau minbot nggak ikut bikin streak.',
    };
  }

  if (!partnerPhone || partnerPhone === initPhone) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Mention or reply to a friend to invite them to a streak!'
          : lang === 'ja'
          ? '友達をメンションするか返信してストリークに誘ってね！'
          : 'Tag atau balas pesan teman kamu buat ngajak bikin streak bareng!',
    };
  }

  const cfg = getStreakSettings();
  const [userA, userB, pairKey] = canonicalPairKey(initPhone, partnerPhone);
  const existing = db.prepare(`SELECT * FROM pair_streaks WHERE pair_key = ?`).get(pairKey) as PairStreakRow | undefined;

  if (existing && existing.status !== 'ended') {
    if (existing.status === 'pending') {
      return {
        ok: false,
        streakId: existing.id,
        message:
          lang === 'en'
            ? `There's already a pending streak invite with ${partnerPhone}. They just need to reply with .streak acc!`
            : `Undangan streak sama ${partnerPhone} masih nunggu persetujuan dia nih. Tinggal partnernya ketik .streak acc ya!`,
      };
    }
    return {
      ok: false,
      streakId: existing.id,
      message:
        lang === 'en'
          ? `You already have an active streak with ${partnerPhone} (🔥 ${existing.current_streak} days).`
          : `Kamu udah punya streak aktif bareng ${partnerPhone} (🔥 ${existing.current_streak} hari).`,
    };
  }

  const initCount = (
    db
      .prepare(`SELECT COUNT(*) as c FROM pair_streaks WHERE (user_a = ? OR user_b = ?) AND status IN ('pending','active','broken')`)
      .get(initPhone, initPhone) as { c: number }
  ).c;
  if (initCount >= cfg.maxPairs) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? `You've reached the maximum of ${cfg.maxPairs} streak pairs.`
          : `Pasangan streak kamu udah mentok di batas maksimal ${cfg.maxPairs} orang nih.`,
    };
  }

  const partnerCount = (
    db
      .prepare(`SELECT COUNT(*) as c FROM pair_streaks WHERE (user_a = ? OR user_b = ?) AND status IN ('pending','active','broken')`)
      .get(partnerPhone, partnerPhone) as { c: number }
  ).c;
  if (partnerCount >= cfg.maxPairs) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? `Your partner has already reached the maximum of ${cfg.maxPairs} streak pairs.`
          : `Teman kamu udah penuh nih kuota ${cfg.maxPairs} pasangan streak-nya.`,
    };
  }

  const id = existing?.id || `ps-${crypto.randomBytes(5).toString('hex')}`;
  if (existing) {
    db.prepare(
      `UPDATE pair_streaks
       SET initiator_phone = ?, partner_phone = ?, status = 'pending', current_streak = 0,
           last_active_date = NULL, user_a_last_ping_date = NULL, user_b_last_ping_date = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(initPhone, partnerPhone, id);
  } else {
    db.prepare(
      `INSERT INTO pair_streaks (id, pair_key, user_a, user_b, initiator_phone, partner_phone, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(id, pairKey, userA, userB, initPhone, partnerPhone);
  }

  return {
    ok: true,
    streakId: id,
    message:
      lang === 'en'
        ? `Streak invite sent to ${partnerPhone}! Once ${partnerPhone} accepts with .streak acc, your streak starts right away (no second confirmation needed).`
        : lang === 'ja'
        ? `${partnerPhone} にストリーク招待を送ったよ！相手が .streak acc で承認したらすぐスタートするよ。`
        : `Undangan streak udah dikirim ke ${partnerPhone}! Kalau dia setuju, cukup ${partnerPhone} ketik *.streak acc*—langsung aktif tanpa perlu konfirmasi ulang dari kamu.`,
  };
}

export function respondPairStreakInvite(params: {
  responderPhone: string;
  accept: boolean;
  initiatorHintPhone?: string;
  lang?: string;
  todayKey?: string;
}): { ok: boolean; message: string; streak?: PairStreakRow } {
  const lang = normalizeBotLang(params.lang);
  const responder = normalizePhoneDigits(params.responderPhone) || params.responderPhone;

  if (isBotOrMinbotPhone(responder)) {
    return { ok: false, message: 'Bot tidak dapat menyetujui streak.' };
  }

  let invite: PairStreakRow | undefined;
  if (params.initiatorHintPhone) {
    const init = normalizePhoneDigits(params.initiatorHintPhone) || params.initiatorHintPhone;
    const [, , pairKey] = canonicalPairKey(responder, init);
    invite = db
      .prepare(`SELECT * FROM pair_streaks WHERE pair_key = ? AND partner_phone = ? AND status = 'pending'`)
      .get(pairKey, responder) as PairStreakRow | undefined;
  } else {
    invite = db
      .prepare(`SELECT * FROM pair_streaks WHERE partner_phone = ? AND status = 'pending' ORDER BY updated_at DESC LIMIT 1`)
      .get(responder) as PairStreakRow | undefined;
  }

  if (!invite) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'No pending streak invite found for you.'
          : lang === 'ja'
          ? '承認待ちのストリーク招待が見つからないよ。'
          : 'Nggak ada ajakan streak yang lagi nunggu persetujuan kamu nih.',
    };
  }

  if (!params.accept) {
    db.prepare(`UPDATE pair_streaks SET status = 'ended', updated_at = datetime('now') WHERE id = ?`).run(invite.id);
    return {
      ok: true,
      message:
        lang === 'en'
          ? `Declined the streak invite from ${invite.initiator_phone}.`
          : `Ajakan streak dari ${invite.initiator_phone} ditolak ya.`,
    };
  }

  const today = params.todayKey || getJakartaDateKey(new Date(), getConfiguredTimezone());
  db.prepare(
    `UPDATE pair_streaks
     SET status = 'active', current_streak = 1, longest_streak = MAX(longest_streak, 1),
         last_active_date = ?, user_a_last_ping_date = ?, user_b_last_ping_date = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(today, today, today, invite.id);

  const updated = db.prepare(`SELECT * FROM pair_streaks WHERE id = ?`).get(invite.id) as PairStreakRow;
  return {
    ok: true,
    streak: updated,
    message:
      lang === 'en'
        ? `🔥 Streak started with ${invite.initiator_phone}! Day 1 active. Reply or mention each other daily to keep it going!`
        : lang === 'ja'
        ? `🔥 ${invite.initiator_phone} とのストリークがスタートしたよ（1日目）！毎日リプライかメンションし合ってね！`
        : `🔥 Mantap! Streak bareng ${invite.initiator_phone} resmi mulai hari ke-1! Jangan lupa saling balas atau mention tiap hari ya.`,
  };
}

export function recordPairStreakMutualInteraction(params: {
  senderPhone: string;
  targetPhones: string[];
  todayKey?: string;
}): Array<{ streakId: string; newCount: number; partnerPhone: string }> {
  const sender = normalizePhoneDigits(params.senderPhone) || params.senderPhone;
  if (!sender || isBotOrMinbotPhone(sender) || params.targetPhones.length === 0) return [];

  const tz = getConfiguredTimezone();
  const today = params.todayKey || getJakartaDateKey(new Date(), tz);
  const yesterday = shiftDateKey(today, -1);
  const advanced: Array<{ streakId: string; newCount: number; partnerPhone: string }> = [];

  for (const rawTarget of params.targetPhones) {
    const target = normalizePhoneDigits(rawTarget) || rawTarget;
    if (!target || target === sender || isBotOrMinbotPhone(target)) continue;

    const [, , pairKey] = canonicalPairKey(sender, target);
    const row = db.prepare(`SELECT * FROM pair_streaks WHERE pair_key = ? AND status = 'active'`).get(pairKey) as
      | PairStreakRow
      | undefined;
    if (!row) continue;

    const isUserA = row.user_a === sender;
    const nextAPing = isUserA ? today : row.user_a_last_ping_date;
    const nextBPing = !isUserA ? today : row.user_b_last_ping_date;

    let nextStreak = row.current_streak;
    let nextLongest = row.longest_streak;
    let nextLastActive = row.last_active_date;

    if (nextAPing === today && nextBPing === today && row.last_active_date !== today) {
      if (row.last_active_date === yesterday) {
        nextStreak = row.current_streak + 1;
      } else {
        nextStreak = 1;
      }
      nextLongest = Math.max(row.longest_streak, nextStreak);
      nextLastActive = today;
      advanced.push({ streakId: row.id, newCount: nextStreak, partnerPhone: target });
    }

    db.prepare(
      `UPDATE pair_streaks
       SET user_a_last_ping_date = ?, user_b_last_ping_date = ?,
           current_streak = ?, longest_streak = ?, last_active_date = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(nextAPing, nextBPing, nextStreak, nextLongest, nextLastActive, row.id);
  }

  return advanced;
}

export function restorePairStreak(params: {
  userPhone: string;
  partnerPhoneHint?: string;
  lang?: string;
  todayKey?: string;
}): { ok: boolean; message: string; restoresUsedThisMonth?: number } {
  const lang = normalizeBotLang(params.lang);
  const user = normalizePhoneDigits(params.userPhone) || params.userPhone;
  const cfg = getStreakSettings();
  const today = params.todayKey || getJakartaDateKey(new Date(), cfg.timezone);
  const yesterday = shiftDateKey(today, -1);
  const twoDaysAgo = shiftDateKey(today, -2);
  const monthKey = getMonthKeyFromDateKey(today);

  const streaks = getUserPairStreaks(user).filter((s) => s.status === 'active' || s.status === 'broken');
  const candidate = params.partnerPhoneHint
    ? streaks.find((s) => s.user_a === normalizePhoneDigits(params.partnerPhoneHint!) || s.user_b === normalizePhoneDigits(params.partnerPhoneHint!))
    : streaks.find((s) => s.last_active_date === twoDaysAgo || s.status === 'broken') || streaks[0];

  if (!candidate) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'No restorable pair streak found.'
          : 'Belum ada pasangan streak yang perlu dipulihkan nih.',
    };
  }

  if (candidate.last_active_date === today || candidate.last_active_date === yesterday) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Your streak is still safe and unbroken—no restore needed!'
          : 'Streak kalian masih aman kok, belum putus jadi nggak perlu dipulihkan!',
    };
  }

  // Must restore on the same day the miss becomes apparent (last_active_date === twoDaysAgo, i.e., missed yesterday)
  if (candidate.last_active_date !== twoDaysAgo) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Streak recovery can only be done on the same day after a missed day.'
          : 'Pemulihan streak cuma bisa dilakukan di hari yang sama setelah terlewat 1 hari ya.',
    };
  }

  const usedThisMonth = (
    db
      .prepare(`SELECT COUNT(*) as c FROM pair_streak_restores WHERE streak_id = ? AND month_key = ?`)
      .get(candidate.id, monthKey) as { c: number }
  ).c;

  if (usedThisMonth >= cfg.maxRestoresPerMonth) {
    return {
      ok: false,
      restoresUsedThisMonth: usedThisMonth,
      message:
        lang === 'en'
          ? `Monthly restore limit reached (${usedThisMonth}/${cfg.maxRestoresPerMonth} this month for this pair).`
          : `Kuota pemulihan streak pasangan ini udah habis bulan ini (${usedThisMonth}/${cfg.maxRestoresPerMonth} kali).`,
    };
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO pair_streak_restores (streak_id, month_key, restored_date, restored_by) VALUES (?, ?, ?, ?)`,
    ).run(candidate.id, monthKey, today, user);
    db.prepare(
      `UPDATE pair_streaks SET status = 'active', last_active_date = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(yesterday, candidate.id);
  })();

  const partner = candidate.user_a === user ? candidate.user_b : candidate.user_a;
  return {
    ok: true,
    restoresUsedThisMonth: usedThisMonth + 1,
    message:
      lang === 'en'
        ? `✅ Streak with ${partner} restored (🔥 ${candidate.current_streak} days saved)! Monthly restores used: ${usedThisMonth + 1}/${cfg.maxRestoresPerMonth}.`
        : `✅ Streak bareng ${partner} berhasil dipulihkan (🔥 ${candidate.current_streak} hari aman)! Sisa pemulihan bulan ini: ${cfg.maxRestoresPerMonth - (usedThisMonth + 1)}/${cfg.maxRestoresPerMonth}.`,
  };
}

export function formatPairStreakStatus(rawPhone: string, prefix = '.', langRaw?: string): string {
  const lang = normalizeBotLang(langRaw);
  const phone = normalizePhoneDigits(rawPhone) || rawPhone;
  const cfg = getStreakSettings();
  const today = getJakartaDateKey(new Date(), cfg.timezone);
  const monthKey = getMonthKeyFromDateKey(today);
  const rows = getUserPairStreaks(phone);

  if (rows.length === 0) {
    return lang === 'en'
      ? `You have no streak pairs yet (0/${cfg.maxPairs}). Invite a friend with ${prefix}streak @user!`
      : lang === 'ja'
      ? `まだストリーク相手がいないよ (0/${cfg.maxPairs})。${prefix}streak @user で誘ってみてね！`
      : `Kamu belum punya pasangan streak (0/${cfg.maxPairs}). Tag teman pakai *${prefix}streak @teman* atau balas pesannya buat mulai!`;
  }

  const lines = rows.map((r, i) => {
    const partner = r.user_a === phone ? r.user_b : r.user_a;
    const partnerUser = db.prepare(`SELECT display_name FROM users WHERE phone = ?`).get(partner) as
      | { display_name: string }
      | undefined;
    const partnerLabel = partnerUser?.display_name ? `${partnerUser.display_name} (${partner})` : partner;
    const used = (
      db.prepare(`SELECT COUNT(*) as c FROM pair_streak_restores WHERE streak_id = ? AND month_key = ?`).get(r.id, monthKey) as {
        c: number;
      }
    ).c;
    const stateLabel = r.status === 'pending' ? 'Menunggu persetujuan' : `🔥 ${r.current_streak} hari (rekor ${r.longest_streak})`;
    return `${i + 1}. ${partnerLabel} — ${stateLabel} · Pulihkan bulan ini ${used}/${cfg.maxRestoresPerMonth}`;
  });

  return `🔥 *Daftar Streak Kamu (${rows.length}/${cfg.maxPairs})*\n\n${lines.join('\n')}\n\nTips: Pakai *${prefix}streak acc* untuk terima ajakan atau *${prefix}streak pulihkan* kalau sempat kelewat.\n\n_${botText(lang).botFooter}_`;
}

// GROUP STREAK
export function setGroupStreakEnabled(groupId: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO group_streaks (group_id, enabled, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(group_id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
  ).run(groupId, enabled ? 1 : 0);
}

export function recordGroupStreakBotInteraction(params: {
  groupId: string;
  userPhone: string;
  todayKey?: string;
}): { activatedToday: boolean; currentStreak: number; uniqueActors: number; botMessagesToday: number } {
  const row = db.prepare(`SELECT * FROM group_streaks WHERE group_id = ?`).get(params.groupId) as
    | { group_id: string; enabled: number; current_streak: number; longest_streak: number; last_active_date: string | null }
    | undefined;

  if (!row || row.enabled !== 1) {
    return { activatedToday: false, currentStreak: row?.current_streak ?? 0, uniqueActors: 0, botMessagesToday: 0 };
  }

  const user = normalizePhoneDigits(params.userPhone) || params.userPhone;
  if (isBotOrMinbotPhone(user)) {
    return { activatedToday: false, currentStreak: row.current_streak, uniqueActors: 0, botMessagesToday: 0 };
  }

  const tz = getConfiguredTimezone();
  const today = params.todayKey || getJakartaDateKey(new Date(), tz);
  const yesterday = shiftDateKey(today, -1);

  return db.transaction(() => {
    const daily = db
      .prepare(`SELECT * FROM group_streak_daily_logs WHERE group_id = ? AND date_key = ?`)
      .get(params.groupId, today) as
      | { actors_json: string; bot_message_count: number; activated: number }
      | undefined;

    const actors = new Set<string>(daily ? JSON.parse(daily.actors_json) : []);
    actors.add(user);
    const botCount = (daily?.bot_message_count ?? 0) + 1;
    const qualifies = actors.size >= 3 || botCount >= 5;
    let activatedToday = false;
    let nextStreak = row.current_streak;
    let nextLongest = row.longest_streak;

    if (qualifies && !(daily?.activated === 1)) {
      activatedToday = true;
      nextStreak = row.last_active_date === yesterday ? row.current_streak + 1 : row.last_active_date === today ? row.current_streak : 1;
      nextLongest = Math.max(row.longest_streak, nextStreak);
      db.prepare(
        `UPDATE group_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ?, updated_at = datetime('now') WHERE group_id = ?`,
      ).run(nextStreak, nextLongest, today, params.groupId);
    }

    db.prepare(
      `INSERT INTO group_streak_daily_logs (group_id, date_key, actors_json, bot_message_count, activated)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, date_key) DO UPDATE SET
         actors_json = excluded.actors_json,
         bot_message_count = excluded.bot_message_count,
         activated = MAX(group_streak_daily_logs.activated, excluded.activated)`,
    ).run(params.groupId, today, JSON.stringify(Array.from(actors)), botCount, qualifies ? 1 : 0);

    return {
      activatedToday,
      currentStreak: nextStreak,
      uniqueActors: actors.size,
      botMessagesToday: botCount,
    };
  })();
}

export function restoreGroupStreak(params: {
  groupId: string;
  actorPhone: string;
  lang?: string;
  todayKey?: string;
}): { ok: boolean; message: string } {
  const lang = normalizeBotLang(params.lang);
  const cfg = getStreakSettings();
  const today = params.todayKey || getJakartaDateKey(new Date(), cfg.timezone);
  const yesterday = shiftDateKey(today, -1);
  const twoDaysAgo = shiftDateKey(today, -2);
  const monthKey = getMonthKeyFromDateKey(today);

  const row = db.prepare(`SELECT * FROM group_streaks WHERE group_id = ?`).get(params.groupId) as
    | { group_id: string; enabled: number; current_streak: number; last_active_date: string | null }
    | undefined;

  if (!row || row.enabled !== 1) {
    return {
      ok: false,
      message: lang === 'en' ? 'Group streak is currently off here.' : 'Fitur streak grup belum aktif di grup ini.',
    };
  }

  if (row.last_active_date === today || row.last_active_date === yesterday) {
    return {
      ok: false,
      message: lang === 'en' ? 'This group streak is still intact!' : 'Streak grup masih aktif kok, belum putus!',
    };
  }

  if (row.last_active_date !== twoDaysAgo) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Group streak recovery is only available on the same day after missing yesterday.'
          : 'Pemulihan streak grup cuma bisa dilakukan di hari yang sama setelah terlewat 1 hari ya.',
    };
  }

  const used = (
    db.prepare(`SELECT COUNT(*) as c FROM group_streak_restores WHERE group_id = ? AND month_key = ?`).get(params.groupId, monthKey) as {
      c: number;
    }
  ).c;

  if (used >= cfg.maxRestoresPerMonth) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? `Monthly restore limit reached (${used}/${cfg.maxRestoresPerMonth}).`
          : `Batas pemulihan streak grup bulan ini sudah habis (${used}/${cfg.maxRestoresPerMonth} kali).`,
    };
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO group_streak_restores (group_id, month_key, restored_date, restored_by) VALUES (?, ?, ?, ?)`,
    ).run(params.groupId, monthKey, today, normalizePhoneDigits(params.actorPhone) || params.actorPhone);
    db.prepare(`UPDATE group_streaks SET last_active_date = ?, updated_at = datetime('now') WHERE group_id = ?`).run(
      yesterday,
      params.groupId,
    );
  })();

  return {
    ok: true,
    message:
      lang === 'en'
        ? `✅ Group streak restored (🔥 ${row.current_streak} days)! Remaining this month: ${cfg.maxRestoresPerMonth - (used + 1)}/${cfg.maxRestoresPerMonth}.`
        : `✅ Streak grup berhasil dipulihkan (🔥 ${row.current_streak} hari aman)! Sisa pemulihan bulan ini: ${cfg.maxRestoresPerMonth - (used + 1)}/${cfg.maxRestoresPerMonth}.`,
  };
}

export function getGroupStreakTopList(limit = 10): Array<{ rank: number; groupId: string; groupName: string; currentStreak: number; longestStreak: number }> {
  const rows = db
    .prepare(
      `SELECT gs.group_id, COALESCE(g.name, gs.group_id) as group_name, gs.current_streak, gs.longest_streak
       FROM group_streaks gs
       LEFT JOIN groups g ON g.id = gs.group_id
       WHERE gs.enabled = 1
       ORDER BY gs.current_streak DESC, gs.longest_streak DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ group_id: string; group_name: string; current_streak: number; longest_streak: number }>;

  return rows.map((r, idx) => ({
    rank: idx + 1,
    groupId: r.group_id,
    groupName: r.group_name,
    currentStreak: r.current_streak,
    longestStreak: r.longest_streak,
  }));
}

export function formatGroupStreakStatus(groupId: string, prefix = '.', langRaw?: string): string {
  const lang = normalizeBotLang(langRaw);
  const cfg = getStreakSettings();
  const today = getJakartaDateKey(new Date(), cfg.timezone);
  const monthKey = getMonthKeyFromDateKey(today);

  const row = db.prepare(`SELECT * FROM group_streaks WHERE group_id = ?`).get(groupId) as
    | { enabled: number; current_streak: number; longest_streak: number; last_active_date: string | null }
    | undefined;
  const daily = db
    .prepare(`SELECT actors_json, bot_message_count, activated FROM group_streak_daily_logs WHERE group_id = ? AND date_key = ?`)
    .get(groupId, today) as { actors_json: string; bot_message_count: number; activated: number } | undefined;

  const uniqueCount = daily ? (JSON.parse(daily.actors_json) as string[]).length : 0;
  const botMsgs = daily?.bot_message_count ?? 0;
  const used = (
    db.prepare(`SELECT COUNT(*) as c FROM group_streak_restores WHERE group_id = ? AND month_key = ?`).get(groupId, monthKey) as {
      c: number;
    }
  ).c;

  if (!row || row.enabled !== 1) {
    return lang === 'en'
      ? `Group streak is OFF here. Admins can turn it on with ${prefix}streakgrup on.`
      : `Streak grup lagi nonaktif nih. Admin bisa aktifkan pakai *${prefix}streakgrup on*.`;
  }

  return `🔥 *Status Streak Grup*\nStreak Saat Ini: ${row.current_streak} hari (Rekor: ${row.longest_streak})\nProgress Hari Ini (${today}):\n• Member aktif ke bot: ${uniqueCount}/3 orang\n• Interaksi command/bot: ${botMsgs}/5 pesan\n• Status hari ini: ${daily?.activated ? 'Sudah menyala ✅' : 'Belum menyala'}\nKuota pulihkan bulan ini: ${used}/${cfg.maxRestoresPerMonth}\n\nSubcommand: *${prefix}streakgrup top* | *${prefix}streakgrup pulihkan*\n_${botText(lang).botFooter}_`;
}
