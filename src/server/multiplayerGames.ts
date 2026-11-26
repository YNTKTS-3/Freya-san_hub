import crypto from 'node:crypto';
import { applyUserBalanceAndExp, db } from './db';
import { getBomConfig, normalizePhoneDigits } from './economyService';
import { getAbuseConfig, recordAbuseEvent } from './abuseService';
import { botText, normalizeBotLang } from '../core/botI18n';
import { GameChatScope, GameHubDomain, GameSessionStatus } from '../core/types';

export interface PrivateDeliveryItem {
  toPhone: string;
  text: string;
  delayMs: number;
}

// Configurable for deterministic fast unit tests
let customQueueDelayRange: { minMs: number; maxMs: number } | null = null;
export function setGameQueueDelayRangeForTests(minMs: number, maxMs: number): void {
  customQueueDelayRange = { minMs, maxMs };
}
export function resetGameQueueDelayRangeForTests(): void {
  customQueueDelayRange = null;
}

export function computeStaggeredDelayMs(index: number): number {
  if (customQueueDelayRange) {
    const { minMs, maxMs } = customQueueDelayRange;
    if (maxMs <= 0) return 0;
    const span = Math.max(0, maxMs - minMs);
    return (index + 1) * (minMs + Math.floor(Math.random() * (span + 1)));
  }
  const cfg = getAbuseConfig().resource_protection;
  const minMs = Math.max(2000, cfg.queueMinDelayMs || 2000);
  const maxMs = Math.max(minMs, cfg.queueMaxDelayMs || 5000);
  const stepDelay = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  return index === 0 ? Math.min(2500, stepDelay) : index * stepDelay;
}

export type UnoColor = 'merah' | 'biru' | 'kuning' | 'hijau';
export const UNO_COLORS: UnoColor[] = ['merah', 'biru', 'kuning', 'hijau'];

export interface UnoCardMeta {
  code: string;
  color: UnoColor | 'wild';
  value: string;
  label: string;
  stickerId: string;
}

const COLOR_ALIASES: Record<string, UnoColor> = {
  merah: 'merah',
  red: 'merah',
  m: 'merah',
  r: 'merah',
  biru: 'biru',
  blue: 'biru',
  b: 'biru',
  kuning: 'kuning',
  yellow: 'kuning',
  k: 'kuning',
  y: 'kuning',
  hijau: 'hijau',
  green: 'hijau',
  h: 'hijau',
  g: 'hijau',
};

export function normalizeUnoColor(raw: string): UnoColor | null {
  return COLOR_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function buildUnoCardMetadata(code: string): UnoCardMeta {
  const upper = code.trim().toUpperCase();
  if (upper === 'WILD' || upper === 'WILD+4') {
    return {
      code: upper,
      color: 'wild',
      value: upper === 'WILD+4' ? '+4' : 'WILD',
      label: upper === 'WILD+4' ? 'Wild Draw +4' : 'Wild Color',
      stickerId: `uno-sticker-${upper.toLowerCase()}`,
    };
  }
  const [prefix, ...rest] = upper.split('-');
  const val = rest.join('-');
  const colorMap: Record<string, UnoColor> = { R: 'merah', B: 'biru', Y: 'kuning', G: 'hijau' };
  const color = colorMap[prefix] || 'merah';
  return {
    code: upper,
    color,
    value: val,
    label: `${color.toUpperCase()} ${val}`,
    stickerId: `uno-sticker-${color}-${val.toLowerCase()}`,
  };
}

export function resolveStickerToUnoCard(stickerOrCode: string): UnoCardMeta | null {
  const clean = stickerOrCode.trim();
  const stickerMatch = clean.match(/^uno-sticker-(wild\+4|wild|(?:merah|biru|kuning|hijau)-([a-z0-9+]+))$/i);
  if (stickerMatch) {
    const raw = stickerMatch[1].toUpperCase();
    if (raw === 'WILD' || raw === 'WILD+4') return buildUnoCardMetadata(raw);
    const [col, val] = raw.split('-');
    const revColor: Record<string, string> = { MERAH: 'R', BIRU: 'B', KUNING: 'Y', HIJAU: 'G' };
    return buildUnoCardMetadata(`${revColor[col] || 'R'}-${val}`);
  }
  const upper = clean.toUpperCase();
  if (/^(WILD|WILD\+4|[RBYG]-([0-9]|SKIP|REVERSE|\+2))$/.test(upper)) {
    return buildUnoCardMetadata(upper);
  }
  return null;
}

export function createShuffledUnoDeck(): string[] {
  const prefixes = ['R', 'B', 'Y', 'G'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2'];
  const deck: string[] = [];
  for (const p of prefixes) {
    for (const v of values) {
      deck.push(`${p}-${v}`);
      if (v !== '0') deck.push(`${p}-${v}`);
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push('WILD', 'WILD+4');
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function canPlayUnoCard(cardCode: string, topCardCode: string, activeColor: UnoColor): boolean {
  const meta = buildUnoCardMetadata(cardCode);
  const topMeta = buildUnoCardMetadata(topCardCode);
  if (meta.color === 'wild') return true;
  return meta.color === activeColor || meta.value === topMeta.value;
}

// BOM INITIAL STATE & ACTION HANDLER
export function createBomInitialState() {
  const cfg = getBomConfig();
  const bombSet = new Set<number>();
  while (bombSet.size < cfg.bombCount) {
    bombSet.add(Math.floor(Math.random() * cfg.gridSize));
  }
  const bombIndexes = Array.from(bombSet).sort((a, b) => a - b);
  return {
    board: Array(cfg.gridSize).fill('?'),
    gridSize: cfg.gridSize,
    bombCount: cfg.bombCount,
    bombIndexes,
    opened: [] as number[],
    safeOpened: 0,
    accumulatedReward: 0,
    rewardPerStep: cfg.rewardPerStep,
    clearBonus: cfg.clearBonus,
    bombPenalty: cfg.bombPenalty,
    partialRewardPct: cfg.partialRewardPct,
    settled: false,
    prompt: `Papan Tebak Bom (${cfg.gridSize} kotak, ${cfg.bombCount} bom tersembunyi).\nTanpa biaya masuk! Pilih angka 1-${cfg.gridSize} atau ketik "stop" kapan saja untuk amankan hadiah.`,
  };
}

export function processBomTurn(params: {
  session: {
    id: string;
    game_id: string;
    game_name: string;
    domain: GameHubDomain;
    chat_scope: GameChatScope;
    chat_id: string;
    group_name: string | null;
  };
  state: Record<string, any>;
  players: Array<{ phone: string; name: string; score: number; answered?: boolean }>;
  playerPhone: string;
  playerName: string;
  trimmedInput: string;
  recordScoreFn: (phone: string, name: string, domain: GameHubDomain, gameId: string, score: number, won: boolean) => void;
  logFn: (prompt: string, answer: string, status: string, score: number, sessStatus: GameSessionStatus) => void;
}): {
  ok: boolean;
  answerStatus: 'correct' | 'wrong' | 'ignored' | 'turn_ok';
  scoreAwarded: number;
  announcement: string;
  sessionStatus: GameSessionStatus;
  state: Record<string, any>;
} {
  const normalized = params.trimmedInput.toLowerCase();
  const gridSize = Number(params.state.gridSize ?? 12);
  const bombIndexes: number[] = Array.isArray(params.state.bombIndexes)
    ? params.state.bombIndexes
    : typeof params.state.bombIndex === 'number'
    ? [params.state.bombIndex]
    : [];
  const board: string[] = params.state.board;
  const opened: number[] = params.state.opened;
  const safeTotal = gridSize - bombIndexes.length;
  const accumulated = Number(params.state.accumulatedReward ?? 0);
  const rewardPerStep = Number(params.state.rewardPerStep ?? 25);
  const clearBonus = Number(params.state.clearBonus ?? 100);
  const bombPenalty = Number(params.state.bombPenalty ?? 40);
  const partialPct = Number(params.state.partialRewardPct ?? 50);

  // Voluntary stop / cashout
  if (['stop', 'berhenti', 'ambil', 'cashout', 'cairkan'].includes(normalized)) {
    const safeOpened = Number(params.state.safeOpened ?? 0);
    if (safeOpened === 0) {
      db.prepare(
        `UPDATE game_sessions SET status = 'cancelled', ended_at = datetime('now'), cancel_reason = 'Berhenti sebelum membuka kotak', state_json = ? WHERE id = ? AND status = 'active'`,
      ).run(JSON.stringify({ ...params.state, settled: true }), params.session.id);
      params.logFn('Bom Stop', params.trimmedInput, 'turn_ok', 0, 'cancelled');
      return {
        ok: true,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `Permainan Bom (${params.session.id}) dihentikan sebelum ada kotak aman yang dibuka. Balance tetap aman (0 perubahan).`,
        sessionStatus: 'cancelled',
        state: params.state,
      };
    }

    const res = db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ? AND status = 'active'`,
        )
        .run(JSON.stringify({ ...params.state, settled: true }), JSON.stringify(params.players), params.session.id);
      if (updated.changes === 0) return null;
      const u = applyUserBalanceAndExp(
        params.playerPhone,
        params.playerName,
        accumulated,
        Math.max(5, safeOpened * 5),
        `Bom cashout aman ${safeOpened} kotak (${params.session.id})`,
        `bom-cashout-${params.session.id}`,
      );
      params.recordScoreFn(params.playerPhone, params.playerName, params.session.domain, params.session.game_id, accumulated, true);
      return u;
    })();

    if (!res) {
      return {
        ok: false,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: 'Sesi Bom ini sudah selesai diselesaikan sebelumnya.',
        sessionStatus: 'completed',
        state: params.state,
      };
    }

    params.logFn('Bom Cashout', params.trimmedInput, 'correct', accumulated, 'completed');
    return {
      ok: true,
      answerStatus: 'correct',
      scoreAwarded: accumulated,
      announcement: `💰 Kamu berhenti tepat waktu setelah membuka ${safeOpened} kotak aman!\nHadiah diamankan: +${accumulated} Balance (Total balance sekarang: ${res.balance}).`,
      sessionStatus: 'completed',
      state: { ...params.state, settled: true },
    };
  }

  const idx = Number.parseInt(params.trimmedInput, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= gridSize) {
    return {
      ok: false,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: `Pilih nomor kotak 1 sampai ${gridSize}, atau ketik "stop" untuk mencairkan hadiah.`,
      sessionStatus: 'active',
      state: params.state,
    };
  }

  if (opened.includes(idx)) {
    return {
      ok: false,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: `Kotak ${idx + 1} sudah dibuka sebelumnya. Pilih kotak lain ya!`,
      sessionStatus: 'active',
      state: params.state,
    };
  }

  opened.push(idx);
  const playerObj = params.players.find((p) => p.phone === params.playerPhone)!;

  // Hit a bomb!
  if (bombIndexes.includes(idx)) {
    board[idx] = 'BOOM';
    const safeOpened = Number(params.state.safeOpened ?? 0);
    const partialReward = safeOpened > 0 ? Math.round((accumulated * partialPct) / 100) : 0;

    const settled = db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ? AND status = 'active'`,
        )
        .run(JSON.stringify({ ...params.state, settled: true, outcome: 'bomb_hit' }), JSON.stringify(params.players), params.session.id);
      if (updated.changes === 0) return null;

      let u = applyUserBalanceAndExp(
        params.playerPhone,
        params.playerName,
        -bombPenalty,
        2,
        `Terkena Bom di kotak ${idx + 1} (${params.session.id})`,
        `bom-penalty-${params.session.id}`,
        { allowNegative: true },
      );

      if (partialReward > 0) {
        u = applyUserBalanceAndExp(
          params.playerPhone,
          params.playerName,
          partialReward,
          safeOpened * 2,
          `Reward parsial Bom (${safeOpened} kotak aman, ${params.session.id})`,
          `bom-partial-${params.session.id}`,
          { allowNegative: true },
        );
      }
      return u;
    })();

    if (!settled) {
      return {
        ok: false,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: 'Sesi Bom sudah selesai.',
        sessionStatus: 'completed',
        state: params.state,
      };
    }

    const netDelta = partialReward - bombPenalty;
    params.logFn(`Pilih Kotak ${idx + 1}`, params.trimmedInput, 'wrong', netDelta, 'completed');
    return {
      ok: true,
      answerStatus: 'wrong',
      scoreAwarded: netDelta,
      announcement:
        safeOpened > 0
          ? `💥 DUAR! Kotak ${idx + 1} berisi bom!\nPenalti bom: -${bombPenalty} Balance\nReward parsial (${safeOpened} kotak aman × ${partialPct}%): +${partialReward} Balance\nSaldo kamu sekarang: ${settled.balance} Balance.`
          : `💥 DUAR! Kotak ${idx + 1} langsung kena bom!\nPenalti bom: -${bombPenalty} Balance (bisa minus).\nSaldo kamu sekarang: ${settled.balance} Balance.`,
      sessionStatus: 'completed',
      state: { ...params.state, settled: true, outcome: 'bomb_hit' },
    };
  }

  // Safe box opened!
  board[idx] = 'SAFE';
  const safeOpened = Number(params.state.safeOpened ?? 0) + 1;
  const nextAccumulated = accumulated + rewardPerStep;
  params.state.safeOpened = safeOpened;
  params.state.accumulatedReward = nextAccumulated;
  playerObj.score = nextAccumulated;

  const clearedAll = safeOpened >= safeTotal;
  if (clearedAll) {
    const totalReward = nextAccumulated + clearBonus;
    const res = db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ? AND status = 'active'`,
        )
        .run(
          JSON.stringify({ ...params.state, settled: true, outcome: 'full_clear' }),
          JSON.stringify(params.players),
          params.session.id,
        );
      if (updated.changes === 0) return null;
      const u = applyUserBalanceAndExp(
        params.playerPhone,
        params.playerName,
        totalReward,
        40,
        `Menang penuh Tebak Bom (${safeOpened}/${safeTotal} aman + bonus, ${params.session.id})`,
        `bom-clear-${params.session.id}`,
      );
      params.recordScoreFn(params.playerPhone, params.playerName, params.session.domain, params.session.game_id, totalReward, true);
      return u;
    })();

    if (!res) {
      return {
        ok: false,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: 'Sesi Bom sudah selesai.',
        sessionStatus: 'completed',
        state: params.state,
      };
    }

    params.logFn(`Clear Kotak ${idx + 1}`, params.trimmedInput, 'correct', totalReward, 'completed');
    return {
      ok: true,
      answerStatus: 'correct',
      scoreAwarded: totalReward,
      announcement: `🎉 SEMPURNA! Semua ${safeTotal} kotak aman berhasil dibuka tanpa kena bom!\nHadiah + Bonus Penuh: +${totalReward} Balance (Saldo sekarang: ${res.balance}).`,
      sessionStatus: 'completed',
      state: { ...params.state, settled: true, outcome: 'full_clear' },
    };
  }

  db.prepare(`UPDATE game_sessions SET state_json = ?, players_json = ?, updated_at = datetime('now') WHERE id = ?`).run(
    JSON.stringify(params.state),
    JSON.stringify(params.players),
    params.session.id,
  );
  params.logFn(`Buka Kotak ${idx + 1}`, params.trimmedInput, 'turn_ok', 0, 'active');

  return {
    ok: true,
    answerStatus: 'turn_ok',
    scoreAwarded: 0,
    announcement: `✅ Kotak ${idx + 1} aman! Hadiah terkumpul di sesi: ${nextAccumulated} Balance (${safeOpened}/${safeTotal} kotak aman).\nPilih kotak berikutnya (1-${gridSize}) atau ketik "stop" untuk cairkan sekarang.`,
    sessionStatus: 'active',
    state: params.state,
  };
}

// UNO TURN TIMEOUT MONITOR (called by sweeper or before UNO action — NEVER auto-advances!)
export function checkUnoSessionTimeout(sessionId: string): { timedOut: boolean; message?: string } {
  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(sessionId) as
    | { id: string; game_id: string; status: string; state_json: string; players_json: string }
    | undefined;
  if (!row || row.game_id !== 'uno' || row.status !== 'active') return { timedOut: false };

  const state = JSON.parse(row.state_json);
  const deadline = Number(state.turnDeadlineMs ?? 0);
  if (!deadline || Date.now() <= deadline) return { timedOut: false };

  const players = JSON.parse(row.players_json) as Array<{ phone: string; name: string }>;
  const currentIdx = Number(state.currentTurnIndex ?? 0);
  const timedOutPlayer = players[currentIdx];

  const changed = db
    .prepare(
      `UPDATE game_sessions SET status = 'expired', ended_at = datetime('now'), cancel_reason = ?, state_json = ? WHERE id = ? AND status = 'active'`,
    )
    .run(
      `Timeout giliran 60 detik (${timedOutPlayer?.name || 'pemain'})`,
      JSON.stringify({ ...state, timedOutPlayer: timedOutPlayer?.name || null }),
      row.id,
    );

  if (changed.changes === 0) return { timedOut: false };

  return {
    timedOut: true,
    message: `⏱️ Waktu giliran *${timedOutPlayer?.name || 'pemain'}* habis (60 detik)! Permainan UNO dihentikan tanpa lanjut otomatis.`,
  };
}

export function stopUnoSession(params: {
  chatId: string;
  actorPhone: string;
  isOwner: boolean;
  isGroupAdmin: boolean;
  lang?: string;
}): { ok: boolean; message: string; sessionId?: string } {
  const lang = normalizeBotLang(params.lang);
  const active = db
    .prepare(
      `SELECT id, host_phone, game_name, state_json FROM game_sessions
       WHERE chat_id = ? AND game_id = 'uno' AND status IN ('waiting', 'active', 'paused')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(params.chatId) as { id: string; host_phone: string; game_name: string; state_json: string } | undefined;

  if (!active) {
    return {
      ok: false,
      message: lang === 'en' ? 'There is no active UNO room in this chat.' : 'Nggak ada room UNO yang aktif di chat ini.',
    };
  }

  const actorClean = normalizePhoneDigits(params.actorPhone) || params.actorPhone;
  const hostClean = normalizePhoneDigits(active.host_phone) || active.host_phone;
  const authorized = params.isOwner || params.isGroupAdmin || actorClean === hostClean;

  if (!authorized) {
    recordAbuseEvent({
      userPhone: actorClean,
      chatId: params.chatId,
      submodule: 'permission_guard',
      severity: 'rule_violation',
      actionTaken: 'uno_stop_denied',
      commandName: 'uno stop',
      detail: `Non-admin/non-host mencoba menghentikan room UNO ${active.id}.`,
    });
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Only the room host, a group admin, or the bot Owner can stop the UNO game.'
          : 'Yang boleh pakai *.uno stop* cuma pembuat room (host), admin grup, atau Owner bot ya.',
    };
  }

  db.prepare(
    `UPDATE game_sessions SET status = 'cancelled', ended_at = datetime('now'), cancel_reason = ? WHERE id = ?`,
  ).run(`Dihentikan oleh ${actorClean} via uno stop`, active.id);

  return {
    ok: true,
    sessionId: active.id,
    message:
      lang === 'en'
        ? `🛑 UNO room (${active.id}) stopped and all active timers/queues cleared.`
        : `🛑 Room UNO (${active.id}) berhasil dihentikan dan semua timer giliran dibersihkan!`,
  };
}

export function pickUndercoverWordPair(langRaw?: string): {
  id: string;
  category: string;
  civilianWord: string;
  undercoverWord: string;
} {
  const lang = normalizeBotLang(langRaw);
  const countRow = db.prepare(`SELECT COUNT(*) as c FROM undercover_word_pairs WHERE enabled = 1`).get() as { c: number };
  const total = countRow.c || 1;
  const offset = Math.floor(Math.random() * total);
  const row = db
    .prepare(`SELECT * FROM undercover_word_pairs WHERE enabled = 1 LIMIT 1 OFFSET ?`)
    .get(offset) as Record<string, string> | undefined;

  if (!row) {
    return { id: 'uc-fallback', category: 'Umum', civilianWord: 'Kopi', undercoverWord: 'Teh' };
  }

  const civilianWord = lang === 'en' ? row.civilian_en : lang === 'ja' ? row.civilian_ja : row.civilian_id;
  const undercoverWord = lang === 'en' ? row.undercover_en : lang === 'ja' ? row.undercover_ja : row.undercover_id;

  return {
    id: row.id,
    category: row.category,
    civilianWord,
    undercoverWord,
  };
}
