import crypto from 'node:crypto';
import {
  calculateQuizScore,
  canStartSessionInChat,
  DifficultyLevel,
  filterVerifiedQuizQuestions,
  GAME_REGISTRY,
  maskPhoneNumberForGroup,
  rollSloth,
} from '../core/gameRules';
import { GameChatScope, GameHubDomain, GameSessionStatus } from '../core/types';
import { addAuditLog, applyUserBalanceAndExp, db } from './db';

export interface StartGameParams {
  gameId: string;
  chatId: string;
  chatScope: GameChatScope;
  groupName?: string;
  hostPhone: string;
  hostName: string;
  difficulty?: DifficultyLevel;
  difficultyLevel?: string;
  eraId?: string;
  teamId?: string;
  generation?: string;
}

export interface GameStartResponse {
  ok: boolean;
  sessionId?: string;
  announcement: string;
  session?: Record<string, unknown>;
  error?: string;
}

export interface GameAnswerResponse {
  ok: boolean;
  sessionId: string;
  answerStatus: 'correct' | 'wrong' | 'late' | 'ignored' | 'turn_ok';
  scoreAwarded: number;
  announcement: string | null;
  sessionStatus: GameSessionStatus;
  state: Record<string, unknown>;
}

const TEBAK_KATA_BANK = [
  { clue: 'Alat komunikasi genggam yang terhubung dengan WhatsApp Bot Freya-san Hub', answer: 'ponsel' },
  { clue: 'Ruangan panggung pertunjukan rutin milik grup 48 di fX Sudirman', answer: 'theater' },
  { clue: 'Bahasa pemrograman bertipe statis yang dikompilasi menjadi JavaScript', answer: 'typescript' },
  { clue: 'Ibu kota negara Indonesia tempat basis teater JKT48 berada', answer: 'jakarta' },
  { clue: 'Jaringan basis data terstruktur berbentuk tabel dengan kueri SQL', answer: 'database' },
];

const FAMILY_100_BANK = [
  {
    question: 'Sebutkan sesuatu yang sering dibawa saat menonton pertunjukan teater atau konser!',
    answers: ['lightstick', 'tiket', 'kipas', 'kamera', 'air minum'],
  },
  {
    question: 'Sebutkan fitur yang paling sering dipakai di grup WhatsApp!',
    answers: ['stiker', 'balas pesan', 'polling', 'tag semua', 'game'],
  },
];

const SIAPA_AKU_BANK = [
  {
    clues: ['Aku memiliki 3x3 kotak permainan.', 'Pemainku menggunakan simbol X dan O.', 'Tujuanku membentuk garis lurus 3 simbol.'],
    answer: 'tictactoe',
  },
  {
    clues: ['Aku adalah kode unik berisi huruf dan angka.', 'Aku bisa ditukar menjadi balance dan EXP di Freya-san Hub.', 'Aku dibuat oleh owner di dashboard.'],
    answer: 'redeem',
  },
];

const TEBAK_EMOJI_BANK = [
  { emojis: '🎤🎭🌸', answer: 'theater', clue: 'Tempat pertunjukan idola 48Group' },
  { emojis: '🐺🌕🏘️', answer: 'werewolf', clue: 'Permainan deduksi desa melawan serigala' },
  { emojis: '🤖💬📱', answer: 'whatsapp bot', clue: 'Otomatisasi pesan pada aplikasi chat' },
];

const TRUTH_OR_DARE_SAFE = {
  truth: [
    'Siapa member 48Group atau tokoh inspiratif pertama yang membuatmu tertarik mengikuti komunitas ini?',
    'Apa fitur favoritmu di Freya-san Hub sejauh ini?',
    'Lagu 48Group apa yang paling sering kamu dengarkan saat sedang fokus belajar atau bekerja?',
  ],
  dare: [
    'Kirimkan satu kalimat penyemangat positif untuk seluruh peserta di sesi ini!',
    'Coba tulis jikoshoukai versi dirimu sendiri dalam satu kalimat.',
    'Bagikan satu fakta menarik tentang hobi kamu hari ini.',
  ],
};

function generateSessionId(): string {
  const num = db.prepare('SELECT COUNT(*) as c FROM game_sessions').get() as { c: number };
  return `GAME-${String(num.c + 1).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export function expireStaleSessions(): void {
  const expired = db
    .prepare(
      `SELECT id, game_name, chat_scope FROM game_sessions
       WHERE status IN ('active', 'waiting', 'paused') AND datetime(expires_at) <= datetime('now')`,
    )
    .all() as Array<{ id: string; game_name: string; chat_scope: string }>;

  if (expired.length === 0) return;
  const upd = db.prepare(
    `UPDATE game_sessions SET status = 'expired', ended_at = datetime('now'), cancel_reason = 'Waktu sesi habis' WHERE id = ?`,
  );
  db.transaction(() => {
    for (const row of expired) {
      upd.run(row.id);
    }
  })();
}

export function startGameSession(params: StartGameParams): GameStartResponse {
  expireStaleSessions();

  const gameDef = db
    .prepare('SELECT * FROM game_settings WHERE game_id = ?')
    .get(params.gameId) as {
      game_id: string;
      name: string;
      domain: GameHubDomain;
      category: string;
      enabled: number;
      min_players: number;
      max_players: number;
      duration_sec: number;
    } | undefined;

  const registryFallback = GAME_REGISTRY.find((g) => g.id === params.gameId);
  if (!gameDef && !registryFallback) {
    return {
      ok: false,
      announcement: `Permainan "${params.gameId}" tidak ditemukan di registry.`,
      error: 'Game not found',
    };
  }

  if (gameDef && !gameDef.enabled) {
    return {
      ok: false,
      announcement: `Permainan "${gameDef.name}" sedang dinonaktifkan oleh owner.`,
      error: 'Game disabled',
    };
  }

  const gameName = gameDef?.name ?? registryFallback!.name;
  const domain: GameHubDomain = (gameDef?.domain ?? registryFallback!.domain) as GameHubDomain;
  const category = gameDef?.category ?? registryFallback!.category;
  const durationSec = gameDef?.duration_sec ?? registryFallback!.defaultDurationSec;

  // Enforce single-active-session lock per chat unless owner explicitly enabled multi-room
  const multiRoom = db.prepare("SELECT value FROM settings WHERE key = 'multi_room_concurrent'").get() as { value: string } | undefined;
  if (multiRoom?.value !== 'true') {
    const activeInChat = db
      .prepare("SELECT id, chat_id as chatId, status, game_name as gameName FROM game_sessions WHERE chat_id = ? AND status IN ('waiting','active','paused')")
      .all(params.chatId) as Array<{ id: string; chatId: string; status: GameSessionStatus; gameName: string }>;

    const lock = canStartSessionInChat(activeInChat, params.chatId);
    if (!lock.allowed) {
      return {
        ok: false,
        announcement: `${lock.reason} (Sesi aktif: ${activeInChat[0].gameName} [${activeInChat[0].id}]). Ketik .nyerah untuk menghentikan sesi aktif.`,
        error: 'Active session exists in chat',
      };
    }
  }

  const sessionId = generateSessionId();
  const difficulty: DifficultyLevel = params.difficulty ?? 'normal';
  const expiresAt = new Date(Date.now() + durationSec * 1000).toISOString();

  // Build game-specific initial state
  let state: Record<string, unknown> = {};
  let initialStatus: GameSessionStatus = 'active';
  let promptText = '';
  let instantResult: { answerStatus: string; score: number; balance: number; exp: number } | null = null;

  if (params.gameId === 'sloth') {
    const sloth = rollSloth();
    state = {
      reels: sloth.reels,
      tier: sloth.tier,
      rewardBalance: sloth.rewardBalance,
      rewardExp: sloth.rewardExp,
      prompt: `Putaran Sloth: [ ${sloth.reels.join(' | ')} ]`,
    };
    initialStatus = 'completed';
    const updatedUser = applyUserBalanceAndExp(
      params.hostPhone,
      params.hostName,
      sloth.rewardBalance,
      sloth.rewardExp,
      `Sloth virtual game (${sessionId})`,
      sessionId,
    );
    promptText = `Sloth Spin: ${sloth.reels.join(' | ')}`;
    instantResult = {
      answerStatus: sloth.isWin ? 'correct' : 'completed',
      score: sloth.rewardBalance,
      balance: updatedUser.balance,
      exp: updatedUser.exp,
    };
  } else if (params.gameId === 'bom' || params.gameId === 'tebakbom') {
    const bombIndex = Math.floor(Math.random() * 9);
    state = {
      board: Array(9).fill('?'),
      bombIndex,
      opened: [] as number[],
      safeOpened: 0,
      prompt: 'Pilih angka kotak 1 sampai 9 yang aman dari bom!',
    };
    promptText = 'Papan 9 kotak bom dimulai. Pilih angka 1-9.';
  } else if (params.gameId === 'tebakangka') {
    const target = Math.floor(Math.random() * 100) + 1;
    state = {
      target,
      attempts: 0,
      maxAttempts: 7,
      lastHint: 'Tebak angka antara 1 sampai 100.',
      prompt: 'Tebak angka rahasia antara 1 sampai 100 (maks 7 percobaan).',
    };
    promptText = 'Tebak angka 1-100';
  } else if (params.gameId === 'tebakkata') {
    const pick = TEBAK_KATA_BANK[Math.floor(Math.random() * TEBAK_KATA_BANK.length)];
    state = {
      clue: pick.clue,
      answer: pick.answer,
      hintsUsed: 0,
      prompt: `Petunjuk: ${pick.clue}`,
    };
    promptText = pick.clue;
  } else if (params.gameId === 'sambungkata') {
    const starters = ['freya', 'teater', 'lagu', 'bintang', 'sahabat'];
    const currentWord = starters[Math.floor(Math.random() * starters.length)];
    state = {
      words: [currentWord],
      currentWord,
      nextChar: currentWord.slice(-1),
      prompt: `Kata awal: "${currentWord}". Kirim kata yang diawali huruf "${currentWord.slice(-1).toUpperCase()}"!`,
    };
    promptText = `Kata awal: ${currentWord}`;
  } else if (params.gameId === 'tictactoe') {
    state = {
      board: Array(9).fill(''),
      currentTurn: 'X',
      mode: 'vs_bot',
      prompt: 'Tic Tac Toe 3x3 dimulai! Anda bermain sebagai X. Pilih posisi 1-9.',
    };
    promptText = 'Tic Tac Toe 3x3';
  } else if (params.gameId === 'suit') {
    state = {
      prompt: 'Pilih salah satu: batu, gunting, atau kertas!',
    };
    promptText = 'Pilih batu / gunting / kertas';
  } else if (params.gameId === 'math') {
    const a = Math.floor(Math.random() * 35) + 5;
    const b = Math.floor(Math.random() * 25) + 3;
    const ops = ['+', '-', '*'] as const;
    const op = ops[Math.floor(Math.random() * ops.length)];
    const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
    state = {
      expression: `${a} ${op} ${b}`,
      answer: String(answer),
      prompt: `Hitung cepat: ${a} ${op} ${b} = ?`,
    };
    promptText = `${a} ${op} ${b} = ?`;
  } else if (params.gameId === 'family100') {
    const pick = FAMILY_100_BANK[Math.floor(Math.random() * FAMILY_100_BANK.length)];
    state = {
      question: pick.question,
      answers: pick.answers,
      found: [] as string[],
      prompt: `${pick.question} (Tersedia ${pick.answers.length} jawaban)`,
    };
    promptText = pick.question;
  } else if (params.gameId === 'siapakahaku') {
    const pick = SIAPA_AKU_BANK[Math.floor(Math.random() * SIAPA_AKU_BANK.length)];
    state = {
      clues: pick.clues,
      clueIndex: 0,
      answer: pick.answer,
      prompt: `Petunjuk 1: ${pick.clues[0]}`,
    };
    promptText = pick.clues[0];
  } else if (params.gameId === 'tebakemoji') {
    const pick = TEBAK_EMOJI_BANK[Math.floor(Math.random() * TEBAK_EMOJI_BANK.length)];
    state = {
      emojis: pick.emojis,
      clue: pick.clue,
      answer: pick.answer,
      prompt: `Tebak maksud emoji ini: ${pick.emojis}`,
    };
    promptText = pick.emojis;
  } else if (params.gameId === 'truthordare') {
    const isTruth = Math.random() > 0.5;
    const list = isTruth ? TRUTH_OR_DARE_SAFE.truth : TRUTH_OR_DARE_SAFE.dare;
    const picked = list[Math.floor(Math.random() * list.length)];
    state = {
      mode: isTruth ? 'TRUTH' : 'DARE',
      challenge: picked,
      prompt: `[${isTruth ? 'TRUTH' : 'DARE'} AMAN] ${picked}`,
    };
    promptText = picked;
    initialStatus = 'completed';
  } else if (
    params.gameId === 'werewolf' ||
    params.gameId === 'mafia' ||
    params.gameId === 'spyfall' ||
    params.gameId === 'impostor' ||
    params.gameId === 'werewolf48' ||
    params.gameId === 'mafia48'
  ) {
    initialStatus = 'waiting';
    state = {
      phase: 'lobby',
      round: 0,
      rolesAssigned: false,
      theme: domain === '48group' ? '48Group Theater Edition' : 'Classic Edition',
      votes: {},
      eliminated: [],
      prompt: `Lobby ${gameName} dibuka! Ketik "gabung" untuk ikut bermain (min ${gameDef?.min_players ?? 4} pemain) atau host ketik "mulai" dengan bot pengisi.`,
    };
    promptText = `Lobby ${gameName} dibuka`;
  } else {
    // 48Group Verified Quizzes & Challenges
    const categoryMap: Record<string, string | null> = {
      memberquiz48: 'member',
      groupquiz48: 'group',
      songquiz48: 'discography',
      genchallenge48: 'generation',
      theaterchallenge48: 'theater',
      timeline48: 'timeline',
      guess48: null,
      daily48: null,
    };
    const desiredCat = categoryMap[params.gameId] ?? null;
    const allRows = db
      .prepare('SELECT * FROM forty_eight_questions WHERE enabled = 1')
      .all() as Array<{
        id: string;
        category: string;
        difficulty: DifficultyLevel;
        group_id: string;
        era_id: string | null;
        difficulty_level: string | null;
        team_id: string | null;
        generation: string | null;
        question: string;
        options_json: string;
        correct_answer: string;
        explanation: string;
        hint_1: string;
        hint_2: string;
        source_url: string;
        validation_status: string;
        usage_count: number;
      }>;

    // Filter strictly to official_verified questions
    let verifiedRows = filterVerifiedQuizQuestions(
      allRows.map((r) => ({ ...r, validationStatus: r.validation_status })),
    );

    const hasExplicitClassificationFilter = Boolean(
      params.difficultyLevel || params.eraId || params.teamId || params.generation,
    );

    if (params.difficultyLevel) {
      verifiedRows = verifiedRows.filter(
        (q) => q.difficulty_level === params.difficultyLevel || q.era_id === params.difficultyLevel,
      );
    }
    if (params.eraId) {
      verifiedRows = verifiedRows.filter((q) => q.era_id === params.eraId);
    }
    if (params.teamId) {
      verifiedRows = verifiedRows.filter((q) => q.team_id === params.teamId);
    }
    if (params.generation) {
      const genLower = params.generation.toLowerCase();
      verifiedRows = verifiedRows.filter((q) => (q.generation || '').toLowerCase() === genLower);
    }

    if (hasExplicitClassificationFilter && verifiedRows.length === 0) {
      return {
        ok: false,
        announcement: 'Belum ada soal 48Group berstatus official_verified untuk filter level/era/team/generasi tersebut.',
        error: 'No verified questions match the selected filter',
      };
    }

    const matching = desiredCat
      ? verifiedRows.filter((q) => q.category === desiredCat)
      : verifiedRows;
    const pool = matching.length > 0 ? matching : verifiedRows;

    if (pool.length === 0) {
      return {
        ok: false,
        announcement: 'Belum ada pertanyaan 48Group berstatus official_verified yang tersedia di database.',
        error: 'No verified questions available',
      };
    }

    // Prefer least recently used questions to avoid repetition
    pool.sort((a, b) => a.usage_count - b.usage_count);
    const selected = pool[0];
    const options = JSON.parse(selected.options_json) as string[];

    db.prepare(
      `UPDATE forty_eight_questions SET usage_count = usage_count + 1, last_used_at = datetime('now') WHERE id = ?`,
    ).run(selected.id);

    state = {
      questionId: selected.id,
      question: selected.question,
      options,
      correctAnswer: selected.correct_answer,
      explanation: selected.explanation,
      hints: [selected.hint_1, selected.hint_2],
      hintsUsed: 0,
      difficulty: selected.difficulty || difficulty,
      difficultyLevel: selected.difficulty_level ?? params.difficultyLevel ?? null,
      eraId: selected.era_id ?? params.eraId ?? null,
      teamId: selected.team_id ?? params.teamId ?? null,
      generation: selected.generation ?? params.generation ?? null,
      sourceUrl: selected.source_url,
      validationStatus: selected.validation_status,
      prompt: selected.question,
    };
    promptText = selected.question;
  }

  const players = [
    {
      phone: params.hostPhone,
      name: params.hostName,
      score: instantResult?.score ?? 0,
      answered: Boolean(instantResult),
    },
  ];

  db.prepare(`
    INSERT INTO game_sessions (
      id, game_id, game_name, domain, category, chat_id, chat_scope, group_name,
      host_phone, host_name, status, state_json, players_json, ended_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    params.gameId,
    gameName,
    domain,
    category,
    params.chatId,
    params.chatScope,
    params.groupName ?? null,
    params.hostPhone,
    params.hostName,
    initialStatus,
    JSON.stringify(state),
    JSON.stringify(players),
    initialStatus === 'completed' ? new Date().toISOString() : null,
    expiresAt,
  );

  // Record initial activity entry in server log
  db.prepare(`
    INSERT INTO game_activity_logs (
      session_id, game_name, domain, category, chat_scope, chat_id, group_name,
      player_phone, player_name, prompt_text, answer_text, answer_status, score_awarded, session_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    gameName,
    domain,
    category,
    params.chatScope,
    params.chatId,
    params.groupName ?? null,
    params.hostPhone,
    params.hostName,
    promptText,
    instantResult ? 'SPIN' : 'SESSION_STARTED',
    instantResult ? instantResult.answerStatus : 'started',
    instantResult?.score ?? 0,
    initialStatus,
  );

  if (instantResult) {
    recordLeaderboardScore(params.hostPhone, params.hostName, domain, params.gameId, instantResult.score, instantResult.answerStatus === 'correct');
  }

  const safePlayerDisplay =
    params.chatScope === 'group'
      ? `${params.hostName} (${maskPhoneNumberForGroup(params.hostPhone)})`
      : params.hostName;

  const announcementLines = [
    `[${domain === '48group' ? '48GROUP GAME CENTER' : 'GAME CENTER'}] ${gameName}`,
    `ID Sesi: ${sessionId}`,
    `Pemain awal: ${safePlayerDisplay}`,
    `Mode: ${params.chatScope === 'group' ? 'Grup WhatsApp' : 'Chat Pribadi'}`,
    '',
    String(state.prompt ?? promptText),
  ];

  if (Array.isArray(state.options)) {
    announcementLines.push('');
    (state.options as string[]).forEach((opt, i) => {
      announcementLines.push(`${i + 1}. ${opt}`);
    });
  }

  if (params.gameId === 'sloth') {
    const s = state as { reels: string[]; tier: string; rewardBalance: number; rewardExp: number };
    announcementLines.push(
      '',
      s.rewardBalance > 0
        ? `Selamat! Kombinasi cocok (${s.tier}). Hadiah virtual: +${s.rewardBalance} Balance, +${s.rewardExp} EXP.`
        : `Belum cocok kali ini. Kamu tetap mendapat +${s.rewardExp} EXP partisipasi.`,
    );
  } else if (initialStatus === 'active') {
    announcementLines.push('', 'Balas langsung dengan jawabanmu, ketik .hint untuk petunjuk, atau .nyerah untuk mengakhiri sesi.');
  }

  addAuditLog(params.hostPhone, 'game.session.start', sessionId, {
    gameId: params.gameId,
    scope: params.chatScope,
    domain,
  });

  return {
    ok: true,
    sessionId,
    announcement: announcementLines.join('\n'),
    session: {
      id: sessionId,
      gameId: params.gameId,
      gameName,
      domain,
      category,
      chatScope: params.chatScope,
      chatId: params.chatId,
      status: initialStatus,
      state: sanitizeStateForClient(state),
      players,
    },
  };
}

export function submitGameAction(params: {
  sessionId: string;
  playerPhone: string;
  playerName: string;
  chatScope: GameChatScope;
  chatId: string;
  input: string;
  actionType?: 'answer' | 'hint' | 'give_up' | 'join' | 'start_lobby' | 'vote';
}): GameAnswerResponse {
  expireStaleSessions();

  const session = db
    .prepare('SELECT * FROM game_sessions WHERE id = ?')
    .get(params.sessionId) as {
      id: string;
      game_id: string;
      game_name: string;
      domain: GameHubDomain;
      category: string;
      chat_id: string;
      chat_scope: GameChatScope;
      group_name: string | null;
      host_phone: string;
      status: GameSessionStatus;
      state_json: string;
      players_json: string;
      started_at: string;
      expires_at: string;
    } | undefined;

  if (!session) {
    return {
      ok: false,
      sessionId: params.sessionId,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: null,
      sessionStatus: 'expired',
      state: {},
    };
  }

  // Strict scope & chat isolation (never leak private <-> group or group A <-> group B)
  if (session.chat_scope !== params.chatScope || session.chat_id !== params.chatId) {
    return {
      ok: false,
      sessionId: params.sessionId,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: 'Akses ditolak: sesi berasal dari ruang percakapan berbeda.',
      sessionStatus: session.status,
      state: {},
    };
  }

  if (session.status === 'completed' || session.status === 'cancelled' || session.status === 'expired') {
    return {
      ok: false,
      sessionId: params.sessionId,
      answerStatus: 'late',
      scoreAwarded: 0,
      announcement: null,
      sessionStatus: session.status,
      state: sanitizeStateForClient(JSON.parse(session.state_json)),
    };
  }

  const state = JSON.parse(session.state_json) as Record<string, unknown>;
  const players = JSON.parse(session.players_json) as Array<{
    phone: string;
    name: string;
    score: number;
    answered?: boolean;
  }>;

  const ensurePlayer = () => {
    let p = players.find((x) => x.phone === params.playerPhone);
    if (!p) {
      p = { phone: params.playerPhone, name: params.playerName, score: 0, answered: false };
      players.push(p);
    }
    return p;
  };

  const trimmed = params.input.trim();
  const normalized = trimmed.toLowerCase();
  const elapsedSec = Math.max(
    1,
    Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000),
  );
  const maxTimeSec = Math.max(
    10,
    Math.round((new Date(session.expires_at).getTime() - new Date(session.started_at).getTime()) / 1000),
  );

  // Handle Give Up / Cancel
  if (params.actionType === 'give_up' || normalized === 'nyerah') {
    const answerReveal = state.correctAnswer || state.answer || state.target || '-';
    db.prepare(
      `UPDATE game_sessions SET status = 'cancelled', ended_at = datetime('now'), cancel_reason = 'Pemain menyerah' WHERE id = ?`,
    ).run(session.id);

    logActivity(session, params.playerPhone, params.playerName, String(state.prompt ?? ''), trimmed, 'wrong', 0, 'cancelled');
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'wrong',
      scoreAwarded: 0,
      announcement: `Sesi ${session.id} (${session.game_name}) dihentikan.\nJawaban resmi: ${answerReveal}`,
      sessionStatus: 'cancelled',
      state: sanitizeStateForClient(state),
    };
  }

  // Handle Hint Request
  if (params.actionType === 'hint' || normalized === 'hint') {
    const hintsUsed = Number(state.hintsUsed ?? 0) + 1;
    state.hintsUsed = hintsUsed;
    let hintMsg = 'Petunjuk tidak tersedia untuk mode ini.';
    if (Array.isArray(state.hints)) {
      const idx = Math.min(hintsUsed - 1, (state.hints as string[]).length - 1);
      hintMsg = `Petunjuk #${hintsUsed} (-20 poin): ${(state.hints as string[])[idx]}`;
    } else if (typeof state.answer === 'string') {
      const ans = state.answer;
      hintMsg = `Petunjuk (-20 poin): ${ans[0]} ${'_ '.repeat(Math.max(1, ans.length - 2))}${ans[ans.length - 1]} (${ans.length} huruf)`;
    }
    db.prepare('UPDATE game_sessions SET state_json = ? WHERE id = ?').run(JSON.stringify(state), session.id);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'turn_ok',
      scoreAwarded: 0,
      announcement: hintMsg,
      sessionStatus: session.status,
      state: sanitizeStateForClient(state),
    };
  }

  // Multiplayer Social Deduction Lobby (Werewolf / Mafia / Spyfall / Impostor / 48Group editions)
  if (session.status === 'waiting') {
    if (params.actionType === 'join' || normalized === 'gabung' || normalized === 'join') {
      ensurePlayer();
      db.prepare('UPDATE game_sessions SET players_json = ? WHERE id = ?').run(JSON.stringify(players), session.id);
      logActivity(session, params.playerPhone, params.playerName, 'Lobby Join', trimmed, 'turn_ok', 0, 'waiting');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `${params.chatScope === 'group' ? maskPhoneNumberForGroup(params.playerPhone) : params.playerName} bergabung ke ${session.game_name}. Total pemain: ${players.length}.`,
        sessionStatus: 'waiting',
        state: sanitizeStateForClient(state),
      };
    }

    if (params.actionType === 'start_lobby' || normalized === 'mulai' || normalized === 'start') {
      // Fill AI companions if solo/testing so lobby is always completable
      while (players.length < 4) {
        const idx = players.length + 1;
        players.push({ phone: `bot-npc-${idx}`, name: `Pemain NPC ${idx}`, score: 0 });
      }
      const roles =
        session.domain === '48group'
          ? ['Shadow Saboteur', 'Center Theater', 'Senbatsu', 'Kenkyuusei']
          : ['Werewolf', 'Seer', 'Villager', 'Villager'];
      const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);
      state.phase = 'night';
      state.round = 1;
      state.rolesAssigned = true;
      state.roleMap = Object.fromEntries(players.map((p, i) => [p.phone, shuffledRoles[i % shuffledRoles.length]]));
      state.prompt = `Fase Malam Hari ke-1 dimulai (${players.length} peserta). Ketik nama atau nomor pemain yang ingin Anda vote eliminasi di fase siang!`;
      db.prepare(`UPDATE game_sessions SET status = 'active', state_json = ?, players_json = ? WHERE id = ?`).run(
        JSON.stringify(state),
        JSON.stringify(players),
        session.id,
      );
      logActivity(session, params.playerPhone, params.playerName, 'Start Lobby', trimmed, 'turn_ok', 10, 'active');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 10,
        announcement: `Permainan ${session.game_name} dimulai dengan ${players.length} pemain! Fase Malam #1 aktif.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: 'Sesi masih menunggu di lobby. Ketik "gabung" untuk ikut atau "mulai" untuk memulai.',
      sessionStatus: 'waiting',
      state: sanitizeStateForClient(state),
    };
  }

  // Active social deduction voting round
  if (
    ['werewolf', 'mafia', 'spyfall', 'impostor', 'werewolf48', 'mafia48'].includes(session.game_id) &&
    session.status === 'active'
  ) {
    const p = ensurePlayer();
    const roleMap = (state.roleMap ?? {}) as Record<string, string>;
    const suspect = players.find(
      (pl) => pl.name.toLowerCase().includes(normalized) || normalized === 'vote',
    ) ?? players.find((pl) => pl.phone !== params.playerPhone);

    if (!suspect) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'wrong',
        scoreAwarded: 0,
        announcement: 'Target vote tidak ditemukan.',
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    const suspectRole = roleMap[suspect.phone] || 'Villager';
    const isWolf = suspectRole.includes('Werewolf') || suspectRole.includes('Shadow') || suspectRole.includes('Mafia');
    const scoreAwarded = isWolf ? 150 : 40;
    p.score += scoreAwarded;
    applyUserBalanceAndExp(params.playerPhone, params.playerName, scoreAwarded, 30, `${session.game_name} (${session.id})`, session.id);
    recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, scoreAwarded, isWolf);

    db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
      JSON.stringify({ ...state, eliminated: [suspect.name], winner: isWolf ? 'Tim Desa / Theater' : 'Tim Shadow' }),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, 'Voting Eliminasi', trimmed, isWolf ? 'correct' : 'wrong', scoreAwarded, 'completed');

    return {
      ok: true,
      sessionId: session.id,
      answerStatus: isWolf ? 'correct' : 'wrong',
      scoreAwarded,
      announcement: `Hasil Voting ${session.game_name} (${session.id}):\nTereliminasi: ${suspect.name} (${suspectRole}).\nPemenang: ${isWolf ? 'Tim Desa / Theater' : 'Tim Saboteur'}! Skor: +${scoreAwarded}`,
      sessionStatus: 'completed',
      state: sanitizeStateForClient({ ...state, eliminated: [suspect.name], winner: isWolf ? 'Tim Desa / Theater' : 'Tim Saboteur' }),
    };
  }

  // Prevent double-answering once a player already solved single-winner rounds
  const playerObj = ensurePlayer();
  if (playerObj.answered && session.game_id !== 'bom' && session.game_id !== 'tebakbom' && session.game_id !== 'tebakangka' && session.game_id !== 'tictactoe' && session.game_id !== 'sambungkata' && session.game_id !== 'family100') {
    return {
      ok: false,
      sessionId: session.id,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: 'Anda sudah mengirimkan jawaban pada sesi ini.',
      sessionStatus: session.status,
      state: sanitizeStateForClient(state),
    };
  }

  // Handle Bom / Tebak Bom
  if (session.game_id === 'bom' || session.game_id === 'tebakbom') {
    const idx = Number.parseInt(trimmed, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx > 8) {
      return { ok: false, sessionId: session.id, answerStatus: 'ignored', scoreAwarded: 0, announcement: 'Pilih nomor kotak 1 sampai 9.', sessionStatus: 'active', state: sanitizeStateForClient(state) };
    }
    const board = state.board as string[];
    const opened = state.opened as number[];
    if (opened.includes(idx)) {
      return { ok: false, sessionId: session.id, answerStatus: 'ignored', scoreAwarded: 0, announcement: 'Kotak tersebut sudah dibuka. Pilih kotak lain.', sessionStatus: 'active', state: sanitizeStateForClient(state) };
    }
    opened.push(idx);
    if (idx === state.bombIndex) {
      board[idx] = 'BOOM';
      db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
        JSON.stringify(state),
        JSON.stringify(players),
        session.id,
      );
      logActivity(session, params.playerPhone, params.playerName, 'Pilih Kotak Bom', trimmed, 'wrong', 0, 'completed');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'wrong',
        scoreAwarded: 0,
        announcement: `BOOM! Kotak ${idx + 1} berisi bom. Permainan ${session.id} berakhir dengan total ${playerObj.score} poin.`,
        sessionStatus: 'completed',
        state: sanitizeStateForClient(state),
      };
    }

    board[idx] = 'SAFE';
    const safeOpened = Number(state.safeOpened ?? 0) + 1;
    state.safeOpened = safeOpened;
    const pts = 30;
    playerObj.score += pts;
    applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 10, `Tebak Bom kotak aman (${session.id})`, session.id);

    const finished = safeOpened >= 8;
    const newStatus: GameSessionStatus = finished ? 'completed' : 'active';
    if (finished) {
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, playerObj.score, true);
    }
    db.prepare(`UPDATE game_sessions SET status = ?, ended_at = ?, state_json = ?, players_json = ? WHERE id = ?`).run(
      newStatus,
      finished ? new Date().toISOString() : null,
      JSON.stringify(state),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, 'Pilih Kotak Bom', trimmed, 'correct', pts, newStatus);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'correct',
      scoreAwarded: pts,
      announcement: finished
        ? `Luar biasa! Semua 8 kotak aman berhasil dibuka! Total hadiah virtual: +${playerObj.score} Balance.`
        : `Kotak ${idx + 1} aman! (+${pts} Balance). Sisa kotak aman: ${8 - safeOpened}.`,
      sessionStatus: newStatus,
      state: sanitizeStateForClient(state),
    };
  }

  // Handle Tebak Angka
  if (session.game_id === 'tebakangka') {
    const guess = Number.parseInt(trimmed, 10);
    if (Number.isNaN(guess) || guess < 1 || guess > 100) {
      return { ok: false, sessionId: session.id, answerStatus: 'ignored', scoreAwarded: 0, announcement: 'Masukkan angka bulat antara 1 dan 100.', sessionStatus: 'active', state: sanitizeStateForClient(state) };
    }
    const target = Number(state.target);
    const attempts = Number(state.attempts ?? 0) + 1;
    state.attempts = attempts;

    if (guess === target) {
      const score = calculateQuizScore({ difficulty: 'normal', isCorrect: true, hintsUsed: attempts - 1, elapsedSec, maxTimeSec });
      playerObj.score += score;
      applyUserBalanceAndExp(params.playerPhone, params.playerName, score, 25, `Menang Tebak Angka (${session.id})`, session.id);
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, score, true);
      db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
        JSON.stringify(state),
        JSON.stringify(players),
        session.id,
      );
      logActivity(session, params.playerPhone, params.playerName, 'Tebak Angka 1-100', trimmed, 'correct', score, 'completed');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'correct',
        scoreAwarded: score,
        announcement: `Tepat! Angka rahasianya adalah ${target} (ditemukan dalam ${attempts} percobaan). Hadiah: +${score} Balance.`,
        sessionStatus: 'completed',
        state: sanitizeStateForClient(state),
      };
    }

    const outOfTries = attempts >= Number(state.maxAttempts ?? 7);
    const hint = guess < target ? 'Terlalu RENDAH, coba angka lebih besar.' : 'Terlalu TINGGI, coba angka lebih kecil.';
    state.lastHint = hint;
    const nextStatus: GameSessionStatus = outOfTries ? 'completed' : 'active';
    db.prepare(`UPDATE game_sessions SET status = ?, ended_at = ?, state_json = ?, players_json = ? WHERE id = ?`).run(
      nextStatus,
      outOfTries ? new Date().toISOString() : null,
      JSON.stringify(state),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, 'Tebak Angka 1-100', trimmed, 'wrong', 0, nextStatus);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'wrong',
      scoreAwarded: 0,
      announcement: outOfTries ? `Kesempatan habis! Angka rahasianya adalah ${target}.` : `${hint} (Percobaan ${attempts}/7)`,
      sessionStatus: nextStatus,
      state: sanitizeStateForClient(state),
    };
  }

  // Handle Tic Tac Toe
  if (session.game_id === 'tictactoe') {
    const pos = Number.parseInt(trimmed, 10) - 1;
    const board = state.board as string[];
    if (Number.isNaN(pos) || pos < 0 || pos > 8 || board[pos] !== '') {
      return { ok: false, sessionId: session.id, answerStatus: 'ignored', scoreAwarded: 0, announcement: 'Pilih kotak kosong nomor 1-9.', sessionStatus: 'active', state: sanitizeStateForClient(state) };
    }
    board[pos] = 'X';
    const checkWinner = (b: string[]): string | null => {
      const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      for (const [a, bIdx, c] of lines) {
        if (b[a] && b[a] === b[bIdx] && b[a] === b[c]) return b[a];
      }
      return b.every((x) => x !== '') ? 'DRAW' : null;
    };

    let winner = checkWinner(board);
    if (!winner) {
      const empties = board.map((v, i) => (v === '' ? i : -1)).filter((i) => i >= 0);
      if (empties.length > 0) {
        const botMove = empties[Math.floor(Math.random() * empties.length)];
        board[botMove] = 'O';
        winner = checkWinner(board);
      }
    }

    const finished = Boolean(winner);
    const nextStatus: GameSessionStatus = finished ? 'completed' : 'active';
    const pts = winner === 'X' ? 80 : winner === 'DRAW' ? 25 : 0;
    if (pts > 0) {
      playerObj.score += pts;
      applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 15, `Tic Tac Toe (${session.id})`, session.id);
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, pts, winner === 'X');
    }

    db.prepare(`UPDATE game_sessions SET status = ?, ended_at = ?, state_json = ?, players_json = ? WHERE id = ?`).run(
      nextStatus,
      finished ? new Date().toISOString() : null,
      JSON.stringify({ ...state, winner }),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, 'Tic Tac Toe Move', trimmed, winner === 'O' ? 'wrong' : 'correct', pts, nextStatus);

    const gridPreview = [0, 3, 6]
      .map((r) => [0, 1, 2].map((c) => board[r + c] || String(r + c + 1)).join(' | '))
      .join('\n');

    return {
      ok: true,
      sessionId: session.id,
      answerStatus: winner === 'O' ? 'wrong' : 'turn_ok',
      scoreAwarded: pts,
      announcement: finished
        ? `${gridPreview}\n\nHasil akhir: ${winner === 'X' ? 'Kamu Menang!' : winner === 'O' ? 'Bot Menang!' : 'Seri!'} (+${pts} Balance)`
        : `${gridPreview}\nGiliranmu (X), pilih kotak kosong 1-9.`,
      sessionStatus: nextStatus,
      state: sanitizeStateForClient({ ...state, winner }),
    };
  }

  // Handle Suit (Rock Paper Scissors)
  if (session.game_id === 'suit') {
    const valid = ['batu', 'gunting', 'kertas'];
    if (!valid.includes(normalized)) {
      return { ok: false, sessionId: session.id, answerStatus: 'ignored', scoreAwarded: 0, announcement: 'Ketik batu, gunting, atau kertas.', sessionStatus: 'active', state: sanitizeStateForClient(state) };
    }
    const botPick = valid[Math.floor(Math.random() * valid.length)];
    const win =
      (normalized === 'batu' && botPick === 'gunting') ||
      (normalized === 'gunting' && botPick === 'kertas') ||
      (normalized === 'kertas' && botPick === 'batu');
    const draw = normalized === botPick;
    const pts = win ? 45 : draw ? 15 : 0;
    if (pts > 0) {
      playerObj.score += pts;
      applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 10, `Suit (${session.id})`, session.id);
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, pts, win);
    }
    db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
      JSON.stringify({ ...state, playerPick: normalized, botPick, outcome: win ? 'win' : draw ? 'draw' : 'lose' }),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, 'Suit', trimmed, win ? 'correct' : draw ? 'turn_ok' : 'wrong', pts, 'completed');
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: win ? 'correct' : 'wrong',
      scoreAwarded: pts,
      announcement: `Kamu: ${normalized} | Bot: ${botPick}\nHasil: ${win ? 'MENANG!' : draw ? 'SERI!' : 'KALAH'} (+${pts} Balance)`,
      sessionStatus: 'completed',
      state: sanitizeStateForClient({ ...state, playerPick: normalized, botPick }),
    };
  }

  // Handle Sambung Kata
  if (session.game_id === 'sambungkata') {
    const expectedChar = String(state.nextChar).toLowerCase();
    const words = state.words as string[];
    if (!normalized.startsWith(expectedChar) || normalized.length < 3 || words.includes(normalized)) {
      logActivity(session, params.playerPhone, params.playerName, `Sambung huruf ${expectedChar}`, trimmed, 'wrong', 0, 'active');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'wrong',
        scoreAwarded: 0,
        announcement: `Kata harus diawali huruf "${expectedChar.toUpperCase()}", minimal 3 huruf, dan belum pernah dipakai.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }
    words.push(normalized);
    state.currentWord = normalized;
    state.nextChar = normalized.slice(-1);
    const pts = 25;
    playerObj.score += pts;
    applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 10, `Sambung Kata (${session.id})`, session.id);
    const done = words.length >= 5;
    const nextStatus: GameSessionStatus = done ? 'completed' : 'active';
    if (done) {
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, playerObj.score, true);
    }
    db.prepare(`UPDATE game_sessions SET status = ?, ended_at = ?, state_json = ?, players_json = ? WHERE id = ?`).run(
      nextStatus,
      done ? new Date().toISOString() : null,
      JSON.stringify(state),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, `Sambung huruf ${expectedChar}`, trimmed, 'correct', pts, nextStatus);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'correct',
      scoreAwarded: pts,
      announcement: done
        ? `Rantai 5 kata selesai (${words.join(' -> ')})! Total skor: +${playerObj.score}.`
        : `Bagus! (+${pts} Balance). Kata berikutnya harus diawali huruf "${String(state.nextChar).toUpperCase()}".`,
      sessionStatus: nextStatus,
      state: sanitizeStateForClient(state),
    };
  }

  // Handle Family 100
  if (session.game_id === 'family100') {
    const answers = state.answers as string[];
    const found = state.found as string[];
    const matched = answers.find((a) => a.toLowerCase() === normalized);
    if (!matched || found.includes(matched)) {
      logActivity(session, params.playerPhone, params.playerName, String(state.question), trimmed, 'wrong', 0, 'active');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'wrong',
        scoreAwarded: 0,
        announcement: matched ? `"${matched}" sudah ditemukan.` : `Belum ada di daftar survei Family 100.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }
    found.push(matched);
    const pts = 40;
    playerObj.score += pts;
    applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 15, `Family 100 (${session.id})`, session.id);
    const done = found.length >= answers.length;
    const nextStatus: GameSessionStatus = done ? 'completed' : 'active';
    if (done) {
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, playerObj.score, true);
    }
    db.prepare(`UPDATE game_sessions SET status = ?, ended_at = ?, state_json = ?, players_json = ? WHERE id = ?`).run(
      nextStatus,
      done ? new Date().toISOString() : null,
      JSON.stringify(state),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, String(state.question), trimmed, 'correct', pts, nextStatus);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'correct',
      scoreAwarded: pts,
      announcement: done
        ? `Semua jawaban Family 100 terjawab (${found.join(', ')})! Skor akhir: ${playerObj.score}.`
        : `Benar! "${matched}" ditemukan (${found.length}/${answers.length}). +${pts} Balance!`,
      sessionStatus: nextStatus,
      state: sanitizeStateForClient(state),
    };
  }

  // Standard Q&A / 48Group Verified Quizzes / Tebak Kata / Math / Siapa Aku / Tebak Emoji
  const expectedRaw = String(state.correctAnswer ?? state.answer ?? '');
  let userAnswerText = trimmed;
  if (Array.isArray(state.options)) {
    const idx = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= (state.options as string[]).length) {
      userAnswerText = (state.options as string[])[idx - 1];
    }
  }

  const isCorrect = userAnswerText.trim().toLowerCase() === expectedRaw.trim().toLowerCase();
  const difficulty = (state.difficulty as DifficultyLevel) || 'normal';
  const hintsUsed = Number(state.hintsUsed ?? 0);

  if (!isCorrect) {
    logActivity(session, params.playerPhone, params.playerName, String(state.prompt ?? ''), trimmed, 'wrong', 0, 'active');
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'wrong',
      scoreAwarded: 0,
      announcement: `Jawaban "${trimmed}" belum tepat. Coba lagi atau ketik .hint / .nyerah.`,
      sessionStatus: 'active',
      state: sanitizeStateForClient(state),
    };
  }

  const scoreAwarded = calculateQuizScore({
    difficulty,
    isCorrect: true,
    hintsUsed,
    elapsedSec,
    maxTimeSec,
  });

  playerObj.score += scoreAwarded;
  playerObj.answered = true;
  applyUserBalanceAndExp(params.playerPhone, params.playerName, scoreAwarded, Math.round(scoreAwarded / 3), `${session.game_name} (${session.id})`, session.id);
  recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, scoreAwarded, true);

  db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
    JSON.stringify({ ...state, winnerName: params.playerName }),
    JSON.stringify(players),
    session.id,
  );

  logActivity(session, params.playerPhone, params.playerName, String(state.prompt ?? ''), trimmed, 'correct', scoreAwarded, 'completed');

  const safeWinner =
    session.chat_scope === 'group'
      ? `${params.playerName} (${maskPhoneNumberForGroup(params.playerPhone)})`
      : params.playerName;

  const explanationLine = state.explanation ? `\nPenjelasan: ${state.explanation}` : '';
  const sourceLine = state.sourceUrl ? `\nSumber resmi: ${state.sourceUrl}` : '';

  return {
    ok: true,
    sessionId: session.id,
    answerStatus: 'correct',
    scoreAwarded,
    announcement: `BENAR! Pemenang: ${safeWinner}\nJawaban: ${expectedRaw}\nSkor: +${scoreAwarded} Balance${explanationLine}${sourceLine}`,
    sessionStatus: 'completed',
    state: sanitizeStateForClient(state),
  };
}

function logActivity(
  session: {
    id: string;
    game_name: string;
    domain: string;
    category: string;
    chat_scope: string;
    chat_id: string;
    group_name: string | null;
  },
  playerPhone: string,
  playerName: string,
  promptText: string,
  answerText: string,
  answerStatus: string,
  scoreAwarded: number,
  sessionStatus: GameSessionStatus,
): void {
  db.prepare(`
    INSERT INTO game_activity_logs (
      session_id, game_name, domain, category, chat_scope, chat_id, group_name,
      player_phone, player_name, prompt_text, answer_text, answer_status, score_awarded, session_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.game_name,
    session.domain,
    session.category,
    session.chat_scope,
    session.chat_id,
    session.group_name,
    playerPhone,
    playerName,
    promptText,
    answerText,
    answerStatus,
    scoreAwarded,
    sessionStatus,
  );
}

function recordLeaderboardScore(
  userPhone: string,
  displayName: string,
  domain: GameHubDomain,
  gameId: string,
  score: number,
  won: boolean,
): void {
  db.prepare(`
    INSERT INTO game_scores (user_phone, display_name, domain, game_id, score, wins, games_played, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(user_phone, domain, game_id) DO UPDATE SET
      display_name = excluded.display_name,
      score = game_scores.score + excluded.score,
      wins = game_scores.wins + ?,
      games_played = game_scores.games_played + 1,
      updated_at = datetime('now')
  `).run(userPhone, displayName, domain, gameId, score, won ? 1 : 0, won ? 1 : 0);
}

function sanitizeStateForClient(state: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...state };
  delete clone.correctAnswer;
  delete clone.answer;
  delete clone.target;
  delete clone.bombIndex;
  return clone;
}
