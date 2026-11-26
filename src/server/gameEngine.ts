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
import { acquireActionLock, releaseActionLock } from './abuseService';
import { botText, normalizeBotLang } from '../core/botI18n';
import {
  buildUnoCardMetadata,
  canPlayUnoCard,
  checkUnoSessionTimeout,
  computeStaggeredDelayMs,
  createBomInitialState,
  createShuffledUnoDeck,
  normalizeUnoColor,
  pickUndercoverWordPair,
  PrivateDeliveryItem,
  processBomTurn,
  resolveStickerToUnoCard,
  UNO_COLORS,
  UnoColor,
} from './multiplayerGames';

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
  lang?: string;
  withMrWhite?: boolean;
  isWw2?: boolean;
}

export interface GameStartResponse {
  ok: boolean;
  sessionId?: string;
  announcement: string;
  session?: Record<string, unknown>;
  privateDeliveries?: PrivateDeliveryItem[];
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
  privateDeliveries?: PrivateDeliveryItem[];
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

export function getMaxQuizWrongAttempts(): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'max_quiz_wrong_attempts'`).get() as { value: string } | undefined;
  return Math.max(1, Number(row?.value ?? 5) || 5);
}

function generateSessionId(): string {
  const num = db.prepare('SELECT COUNT(*) as c FROM game_sessions').get() as { c: number };
  return `GAME-${String(num.c + 1).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export function expireStaleSessions(): void {
  // Check UNO 60s turn timeouts first (stops without auto-advancing)
  const activeUno = db
    .prepare(`SELECT id FROM game_sessions WHERE game_id = 'uno' AND status = 'active'`)
    .all() as Array<{ id: string }>;
  for (const row of activeUno) {
    checkUnoSessionTimeout(row.id);
  }

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
      announcement: `Game "${params.gameId}" nggak ketemu di daftar.`,
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
    const bomInit = createBomInitialState();
    state = bomInit;
    promptText = `Papan ${bomInit.gridSize} kotak (${bomInit.bombCount} bom) dimulai.`;
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
      wrongAttempts: 0,
      maxWrongAttempts: getMaxQuizWrongAttempts(),
      prompt: `Petunjuk: ${pick.clue} (Maks ${getMaxQuizWrongAttempts()}x salah)`,
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
      prompt: 'Tic Tac Toe 3x3 dimulai! Kamu main sebagai X. Pilih posisi 1-9 ya.',
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
      wrongAttempts: 0,
      maxWrongAttempts: getMaxQuizWrongAttempts(),
      prompt: `Hitung cepat: ${a} ${op} ${b} = ? (Maks ${getMaxQuizWrongAttempts()}x salah)`,
    };
    promptText = `${a} ${op} ${b} = ?`;
  } else if (params.gameId === 'family100') {
    const pick = FAMILY_100_BANK[Math.floor(Math.random() * FAMILY_100_BANK.length)];
    state = {
      question: pick.question,
      answers: pick.answers,
      found: [] as string[],
      wrongAttempts: 0,
      maxWrongAttempts: getMaxQuizWrongAttempts(),
      prompt: `${pick.question} (Tersedia ${pick.answers.length} jawaban, maks ${getMaxQuizWrongAttempts()}x salah)`,
    };
    promptText = pick.question;
  } else if (params.gameId === 'siapakahaku') {
    const pick = SIAPA_AKU_BANK[Math.floor(Math.random() * SIAPA_AKU_BANK.length)];
    state = {
      clues: pick.clues,
      clueIndex: 0,
      answer: pick.answer,
      wrongAttempts: 0,
      maxWrongAttempts: getMaxQuizWrongAttempts(),
      prompt: `Petunjuk 1: ${pick.clues[0]}`,
    };
    promptText = pick.clues[0];
  } else if (params.gameId === 'tebakemoji') {
    const totalEmoji = (db.prepare(`SELECT COUNT(*) as c FROM tebakemoji_questions WHERE enabled = 1`).get() as { c: number }).c;
    const pickedDb = totalEmoji > 0
      ? (db
          .prepare(`SELECT * FROM tebakemoji_questions WHERE enabled = 1 LIMIT 1 OFFSET ?`)
          .get(Math.floor(Math.random() * totalEmoji)) as {
          id: string;
          category: string;
          emoji_prompt: string;
          answer: string;
          aliases_json: string;
          hint: string;
        } | undefined)
      : undefined;
    const fallbackPick = TEBAK_EMOJI_BANK[Math.floor(Math.random() * TEBAK_EMOJI_BANK.length)];
    const emojis = pickedDb?.emoji_prompt ?? fallbackPick.emojis;
    const answer = pickedDb?.answer ?? fallbackPick.answer;
    const clue = pickedDb?.hint ?? fallbackPick.clue;
    const emojiCategory = pickedDb?.category ?? 'Umum';
    const aliases = pickedDb ? (JSON.parse(pickedDb.aliases_json || '[]') as string[]) : [];
    const maxWrong = getMaxQuizWrongAttempts();

    state = {
      questionId: pickedDb?.id ?? 'fallback',
      emojiCategory,
      emojis,
      clue,
      answer,
      aliases,
      wrongAttempts: 0,
      maxWrongAttempts: maxWrong,
      prompt: `Kategori: *${emojiCategory}*\nTebak maksud emoji ini: ${emojis}\n(Maks ${maxWrong} jawaban salah)`,
    };
    promptText = `${emojis} [${emojiCategory}]`;
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
  } else if (params.gameId === 'undercover') {
    initialStatus = 'waiting';
    const botLang = normalizeBotLang(params.lang);
    state = {
      phase: 'lobby',
      round: 0,
      lang: botLang,
      withMrWhite: Boolean(params.withMrWhite),
      eliminated: [] as string[],
      clues: {} as Record<string, string>,
      votes: {} as Record<string, string>,
      prompt: `Lobby *Undercover* dibuka (Bahasa: ${botLang.toUpperCase()} | Mr. White: ${params.withMrWhite ? 'ON' : 'Otomatis 4+ pemain'}).\nKetik "gabung" untuk ikut (min 3 pemain) atau host ketik "mulai"!`,
    };
    promptText = 'Lobby Undercover dibuka';
  } else if (params.gameId === 'uno') {
    initialStatus = 'waiting';
    state = {
      phase: 'lobby',
      currentTurnIndex: 0,
      direction: 1,
      topCard: 'R-5',
      activeColor: 'merah',
      pendingWildColorFor: null,
      hands: {} as Record<string, string[]>,
      deck: [] as string[],
      turnDeadlineMs: 0,
      prompt: `Lobby *UNO Card Arena* dibuka! Ketik "gabung" untuk ikut bermain (2-8 pemain) atau host ketik "mulai".\nGunakan *.uno stop* untuk menghentikan permainan.`,
    };
    promptText = 'Lobby UNO dibuka';
  } else if (
    params.gameId === 'werewolf' ||
    params.gameId === 'mafia' ||
    params.gameId === 'spyfall' ||
    params.gameId === 'impostor' ||
    params.gameId === 'werewolf48' ||
    params.gameId === 'mafia48'
  ) {
    initialStatus = 'waiting';
    const isWw2 = Boolean(params.isWw2);
    state = {
      phase: 'lobby',
      round: 0,
      rolesAssigned: false,
      isWw2,
      theme: domain === '48group' ? '48Group Theater Edition' : isWw2 ? 'Werewolf2 Extended Edition' : 'Classic Edition',
      votes: {},
      nightActions: {},
      eliminated: [],
      prompt: `Lobby ${isWw2 ? 'Werewolf2 (#ww2)' : gameName} dibuka! Ketik "gabung" untuk ikut bermain (min ${gameDef?.min_players ?? 4} pemain) atau host ketik "mulai".`,
    };
    promptText = `Lobby ${isWw2 ? 'Werewolf2' : gameName} dibuka`;
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
      wrongAttempts: 0,
      maxWrongAttempts: getMaxQuizWrongAttempts(),
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

  if (state.isWw2) {
    announcementLines.push('', `_${botText(params.lang).botFooter}_`);
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

  // Multiplayer Lobbies (Undercover, UNO, Werewolf / WW2, Mafia, Spyfall, Impostor)
  if (session.status === 'waiting') {
    if (session.game_id === 'undercover' && (normalized === 'mrwhite on' || normalized === 'mrwhite off')) {
      state.withMrWhite = normalized === 'mrwhite on';
      db.prepare('UPDATE game_sessions SET state_json = ? WHERE id = ?').run(JSON.stringify(state), session.id);
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `Mode Mr. White sekarang ${state.withMrWhite ? 'AKTIF' : 'NONAKTIF'}.`,
        sessionStatus: 'waiting',
        state: sanitizeStateForClient(state),
      };
    }

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
      if (session.game_id === 'undercover') {
        while (players.length < 3) {
          const idx = players.length + 1;
          players.push({ phone: `bot-npc-${idx}`, name: `Pemain NPC ${idx}`, score: 0 });
        }
        const pair = pickUndercoverWordPair(String(state.lang || 'id'));
        const useMrWhite = Boolean(state.withMrWhite) || players.length >= 4;
        const rolePool: Array<'Undercover' | 'Mr. White' | 'Civilian'> = ['Undercover'];
        if (useMrWhite && players.length >= 4) rolePool.push('Mr. White');
        while (rolePool.length < players.length) rolePool.push('Civilian');
        const shuffledRoles = [...rolePool].sort(() => Math.random() - 0.5);

        const roleMap: Record<string, string> = {};
        const wordMap: Record<string, string> = {};
        const privateDeliveries: PrivateDeliveryItem[] = [];
        players.forEach((p, idx) => {
          const r = shuffledRoles[idx];
          roleMap[p.phone] = r;
          const secretWord =
            r === 'Civilian' ? pair.civilianWord : r === 'Undercover' ? pair.undercoverWord : '(MR. WHITE — tidak ada kata)';
          wordMap[p.phone] = secretWord;
          if (!p.phone.startsWith('bot-npc-')) {
            privateDeliveries.push({
              toPhone: p.phone,
              delayMs: computeStaggeredDelayMs(privateDeliveries.length),
              text:
                r === 'Mr. White'
                  ? `🕵️ [Undercover ${session.id}]\nPeran kamu: *Mr. White*!\nKamu tidak mendapat kata—dengarkan clue pemain lain dan tebak kata Civilian kalau tertangkap.`
                  : `🕵️ [Undercover ${session.id}]\nKategori: *${pair.category}*\nKata rahasia kamu: *${secretWord}*\n(Jangan bocorkan kata aslimu di grup! Berikan clue singkat saat giliranmu.)`,
            });
          }
        });

        state.phase = 'clues';
        state.round = 1;
        state.category = pair.category;
        state.civilianWord = pair.civilianWord;
        state.undercoverWord = pair.undercoverWord;
        state.roleMap = roleMap;
        state.wordMap = wordMap;
        state.eliminated = [];
        state.clues = {};
        state.votes = {};
        state.turnOrder = players.map((p) => p.phone);
        state.prompt = `Undercover dimulai (${players.length} pemain, kategori ${pair.category})!\nKata rahasia sudah dijadwalkan ke Private Chat masing-masing pemain.\nFase Clue #1: Kirim 1 clue kata singkat untuk kata milikmu!`;

        db.prepare(`UPDATE game_sessions SET status = 'active', state_json = ?, players_json = ? WHERE id = ?`).run(
          JSON.stringify(state),
          JSON.stringify(players),
          session.id,
        );
        logActivity(session, params.playerPhone, params.playerName, 'Start Undercover', trimmed, 'turn_ok', 10, 'active');
        return {
          ok: true,
          sessionId: session.id,
          answerStatus: 'turn_ok',
          scoreAwarded: 10,
          announcement: String(state.prompt),
          sessionStatus: 'active',
          state: sanitizeStateForClient(state),
          privateDeliveries,
        };
      }

      if (session.game_id === 'uno') {
        if (players.length < 2) {
          players.push({ phone: 'bot-npc-uno', name: 'Freya UNO Bot', score: 0 });
        }
        const deck = createShuffledUnoDeck();
        const hands: Record<string, string[]> = {};
        const privateDeliveries: PrivateDeliveryItem[] = [];
        for (const pl of players) {
          hands[pl.phone] = deck.splice(0, 7);
          if (!pl.phone.startsWith('bot-npc-')) {
            const readable = hands[pl.phone]
              .map((c, idx) => `${idx + 1}. ${c} (${buildUnoCardMetadata(c).label})`)
              .join('\n');
            privateDeliveries.push({
              toPhone: pl.phone,
              delayMs: computeStaggeredDelayMs(privateDeliveries.length),
              text: `🃏 [UNO ${session.id}] Kartu awal kamu (7 kartu):\n${readable}\n\nMainkan di grup dengan kirim kode kartu (contoh: ${hands[pl.phone][0]}) atau "draw" untuk ambil kartu.`,
            });
          }
        }
        let firstCard = deck.shift() || 'R-5';
        while (firstCard.startsWith('WILD')) {
          deck.push(firstCard);
          firstCard = deck.shift() || 'R-5';
        }
        const firstMeta = buildUnoCardMetadata(firstCard);
        const turnDeadlineMs = Date.now() + 60_000;

        state.phase = 'playing';
        state.hands = hands;
        state.deck = deck;
        state.topCard = firstCard;
        state.activeColor = firstMeta.color === 'wild' ? 'merah' : firstMeta.color;
        state.currentTurnIndex = 0;
        state.direction = 1;
        state.pendingWildColorFor = null;
        state.turnDeadlineMs = turnDeadlineMs;
        state.prompt = `🃏 UNO dimulai dengan ${players.length} pemain! Kartu awal di meja: *${firstMeta.label}* (${firstCard}).\nGiliran pertama: *${players[0].name}* (batas 60 detik, tidak lanjut otomatis jika timeout).`;

        db.prepare(`UPDATE game_sessions SET status = 'active', state_json = ?, players_json = ? WHERE id = ?`).run(
          JSON.stringify(state),
          JSON.stringify(players),
          session.id,
        );
        logActivity(session, params.playerPhone, params.playerName, 'Start UNO', trimmed, 'turn_ok', 10, 'active');
        return {
          ok: true,
          sessionId: session.id,
          answerStatus: 'turn_ok',
          scoreAwarded: 10,
          announcement: String(state.prompt),
          sessionStatus: 'active',
          state: sanitizeStateForClient(state),
          privateDeliveries,
        };
      }

      // Werewolf / WW2 / Mafia / Spyfall / Impostor
      while (players.length < 4) {
        const idx = players.length + 1;
        players.push({ phone: `bot-npc-${idx}`, name: `Pemain NPC ${idx}`, score: 0 });
      }
      const roles =
        session.domain === '48group'
          ? ['Shadow Saboteur', 'Center Theater', 'Senbatsu', 'Kenkyuusei']
          : state.isWw2 && players.length >= 4
          ? ['Werewolf', 'Seer', 'Guardian', 'Villager']
          : ['Werewolf', 'Seer', 'Villager', 'Villager'];
      const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);
      const roleMap = Object.fromEntries(players.map((p, i) => [p.phone, shuffledRoles[i % shuffledRoles.length]]));
      const privateDeliveries: PrivateDeliveryItem[] = [];
      players.forEach((p) => {
        if (!p.phone.startsWith('bot-npc-')) {
          privateDeliveries.push({
            toPhone: p.phone,
            delayMs: computeStaggeredDelayMs(privateDeliveries.length),
            text: `🐺 [${state.isWw2 ? 'Werewolf2 (#ww2)' : session.game_name} — ${session.id}]\nPeran rahasia kamu: *${roleMap[p.phone]}*!\nKirim vote atau aksi malam kamu di grup/room tanpa membocorkan peran secara langsung.\n_${botText().botFooter}_`,
          });
        }
      });

      state.phase = 'night';
      state.round = 1;
      state.rolesAssigned = true;
      state.roleMap = roleMap;
      state.votes = {};
      state.nightActions = {};
      state.prompt = `Fase Malam Hari ke-1 dimulai (${players.length} peserta). Peran rahasia dikirim via Private Chat (jeda aman 2-5 detik).\nKetik nama pemain untuk vote eliminasi!${state.isWw2 ? `\n\n_${botText().botFooter}_` : ''}`;
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
        announcement: `Permainan ${state.isWw2 ? 'Werewolf2 (#ww2)' : session.game_name} dimulai dengan ${players.length} pemain! Fase Malam #1 aktif.${state.isWw2 ? `\n_${botText().botFooter}_` : ''}`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
        privateDeliveries,
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

  // Active UNDERCOVER gameplay
  if (session.game_id === 'undercover' && session.status === 'active') {
    const eliminated = (state.eliminated as string[]) || [];
    const roleMap = (state.roleMap || {}) as Record<string, string>;
    const clues = (state.clues || {}) as Record<string, string>;
    const votes = (state.votes || {}) as Record<string, string>;
    const p = ensurePlayer();
    const alivePlayers = players.filter((pl) => !eliminated.includes(pl.phone));

    if (['keluar', 'quit'].includes(normalized)) {
      if (!eliminated.includes(params.playerPhone)) eliminated.push(params.playerPhone);
      state.eliminated = eliminated;
      db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `${params.playerName} keluar dari sesi Undercover (${session.id}).`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    if (state.phase === 'mrwhite_guess') {
      const targetMrWhite = String(state.mrWhiteCandidate || '');
      if (params.playerPhone !== targetMrWhite && !targetMrWhite.startsWith('bot-npc-')) {
        return {
          ok: false,
          sessionId: session.id,
          answerStatus: 'ignored',
          scoreAwarded: 0,
          announcement: 'Lagi menunggu Mr. White menebak kata Civilian.',
          sessionStatus: 'active',
          state: sanitizeStateForClient(state),
        };
      }
      const guessWord = trimmed.replace(/^tebak\s+/i, '').trim().toLowerCase();
      const civilWord = String(state.civilianWord || '').toLowerCase();
      const mrWhiteWins = guessWord === civilWord;
      const winner = mrWhiteWins ? 'Mr. White' : 'Civilian';
      const pts = mrWhiteWins ? 160 : 120;
      applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 30, `Undercover (${session.id})`, session.id);
      db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ? WHERE id = ?`).run(
        JSON.stringify({ ...state, winner }),
        session.id,
      );
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: mrWhiteWins ? 'correct' : 'wrong',
        scoreAwarded: pts,
        announcement: mrWhiteWins
          ? `🎭 TEBAKAN BENAR! Mr. White menebak "${state.civilianWord}" dan MENANG! (+${pts} Balance)`
          : `🕵️ Tebakan Mr. White keliru ("${guessWord}"). Kata Civilian adalah "${state.civilianWord}". Tim Civilian MENANG!`,
        sessionStatus: 'completed',
        state: sanitizeStateForClient({ ...state, winner }),
      };
    }

    if (state.phase === 'clues') {
      const cleanClue = trimmed.replace(/^clue\s+/i, '').trim();
      if (normalized !== 'voting' && normalized !== 'next') {
        clues[params.playerPhone] = cleanClue;
        // Fill NPC clues automatically
        for (const npc of alivePlayers) {
          if (npc.phone.startsWith('bot-npc-') && !clues[npc.phone]) {
            clues[npc.phone] = roleMap[npc.phone] === 'Mr. White' ? 'lumayan' : 'sering dipakai';
          }
        }
        state.clues = clues;
      }
      const allGaveClues = alivePlayers.every((pl) => Boolean(clues[pl.phone])) || normalized === 'voting' || normalized === 'next';
      if (allGaveClues) {
        state.phase = 'voting';
        const clueSummary = alivePlayers.map((pl) => `• ${pl.name}: "${clues[pl.phone] || '-'}"`).join('\n');
        state.prompt = `Semua clue terkumpul:\n${clueSummary}\n\nSekarang ketik "vote <nama>" untuk mengeliminasi pemain yang dicurigai!`;
        db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
        return {
          ok: true,
          sessionId: session.id,
          answerStatus: 'turn_ok',
          scoreAwarded: 0,
          announcement: String(state.prompt),
          sessionStatus: 'active',
          state: sanitizeStateForClient(state),
        };
      }
      db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `Clue dari ${params.playerName} ("${cleanClue}") dicatat.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    // Voting phase in Undercover
    const targetQuery = trimmed.replace(/^vote\s+/i, '').trim().toLowerCase();
    const suspect =
      alivePlayers.find((pl) => pl.name.toLowerCase().includes(targetQuery) || pl.phone.includes(targetQuery)) ??
      alivePlayers.find((pl) => pl.phone !== params.playerPhone);

    if (!suspect) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: 'Target vote-nya nggak ketemu di daftar pemain aktif.',
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    votes[params.playerPhone] = suspect.phone;
    eliminated.push(suspect.phone);
    state.votes = votes;
    state.eliminated = eliminated;
    const suspectRole = roleMap[suspect.phone] || 'Civilian';

    if (suspectRole === 'Mr. White' && !suspect.phone.startsWith('bot-npc-')) {
      state.phase = 'mrwhite_guess';
      state.mrWhiteCandidate = suspect.phone;
      db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `🎭 *${suspect.name}* ternyata *Mr. White*! Sebelum kalah, ${suspect.name} punya 1 kesempatan ketik kata rahasia Civilian!`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    const remaining = players.filter((pl) => !eliminated.includes(pl.phone));
    const remainingUndercovers = remaining.filter((pl) => roleMap[pl.phone] === 'Undercover');
    const remainingCivilians = remaining.filter((pl) => roleMap[pl.phone] === 'Civilian');

    if (remainingUndercovers.length === 0 || remainingUndercovers.length >= remainingCivilians.length) {
      const winner = remainingUndercovers.length === 0 ? 'Civilian' : 'Undercover';
      const pts = winner === 'Civilian' ? 140 : 160;
      p.score += pts;
      applyUserBalanceAndExp(params.playerPhone, params.playerName, pts, 30, `Undercover (${session.id})`, session.id);
      recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, pts, true);
      db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
        JSON.stringify({ ...state, winner }),
        JSON.stringify(players),
        session.id,
      );
      logActivity(session, params.playerPhone, params.playerName, 'Undercover Elimination', trimmed, 'correct', pts, 'completed');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'correct',
        scoreAwarded: pts,
        announcement: `🕵️ *${suspect.name}* tereliminasi (${suspectRole})!\nPermainan selesai — Pemenang: *Tim ${winner}*!\nKata Civilian: "${state.civilianWord}" | Undercover: "${state.undercoverWord}". (+${pts} Balance)`,
        sessionStatus: 'completed',
        state: sanitizeStateForClient({ ...state, winner }),
      };
    }

    state.phase = 'clues';
    state.clues = {};
    state.round = Number(state.round ?? 1) + 1;
    db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'turn_ok',
      scoreAwarded: 0,
      announcement: `${suspect.name} tereliminasi (${suspectRole}). Masih ada penyusup! Masuk ke Ronde Clue #${state.round}.`,
      sessionStatus: 'active',
      state: sanitizeStateForClient(state),
    };
  }

  // Active UNO gameplay
  if (session.game_id === 'uno' && session.status === 'active') {
    const hands = (state.hands || {}) as Record<string, string[]>;
    const deck = (state.deck || []) as string[];
    const currentIdx = Number(state.currentTurnIndex ?? 0);
    const currentPlayer = players[currentIdx];

    if (!currentPlayer) {
      return { ok: false, sessionId: session.id, answerStatus: 'ignored', scoreAwarded: 0, announcement: 'Pemain UNO tidak valid.', sessionStatus: 'active', state: sanitizeStateForClient(state) };
    }

    if (params.playerPhone !== currentPlayer.phone && !currentPlayer.phone.startsWith('bot-npc-')) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: `Belum giliranmu ya! Sekarang giliran *${currentPlayer.name}*.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    // Handle pending Wild color choice cleanly!
    if (state.pendingWildColorFor === params.playerPhone) {
      const pickedColor = normalizeUnoColor(trimmed);
      if (!pickedColor) {
        return {
          ok: false,
          sessionId: session.id,
          answerStatus: 'ignored',
          scoreAwarded: 0,
          announcement: 'Pilih warna Wild yang valid: *merah*, *biru*, *kuning*, atau *hijau*.',
          sessionStatus: 'active',
          state: sanitizeStateForClient(state),
        };
      }
      state.activeColor = pickedColor;
      state.pendingWildColorFor = null;
      const step = state.pendingWildPlus4 ? 2 : 1;
      const dir = Number(state.direction ?? 1);
      const nextIdx = ((currentIdx + step * dir) % players.length + players.length) % players.length;
      if (state.pendingWildPlus4) {
        const victimIdx = ((currentIdx + dir) % players.length + players.length) % players.length;
        const victim = players[victimIdx];
        hands[victim.phone] = hands[victim.phone] || [];
        hands[victim.phone].push(...deck.splice(0, 4));
      }
      state.pendingWildPlus4 = false;
      state.currentTurnIndex = nextIdx;
      state.turnDeadlineMs = Date.now() + 60_000;
      db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `🎨 Warna Wild dipilih: *${pickedColor.toUpperCase()}*!\nGiliran berikutnya: *${players[nextIdx].name}* (60 detik).`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    const myHand = hands[currentPlayer.phone] || [];

    if (normalized === 'draw' || normalized === 'ambil') {
      const drawn = deck.shift() || 'R-1';
      myHand.push(drawn);
      hands[currentPlayer.phone] = myHand;
      const dir = Number(state.direction ?? 1);
      const nextIdx = ((currentIdx + dir) % players.length + players.length) % players.length;
      state.currentTurnIndex = nextIdx;
      state.turnDeadlineMs = Date.now() + 60_000;
      db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'turn_ok',
        scoreAwarded: 0,
        announcement: `${currentPlayer.name} mengambil 1 kartu (${myHand.length} kartu di tangan). Giliran: *${players[nextIdx].name}*.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
        privateDeliveries: !currentPlayer.phone.startsWith('bot-npc-')
          ? [{ toPhone: currentPlayer.phone, delayMs: computeStaggeredDelayMs(0), text: `🃏 Kartu baru UNO kamu: *${drawn}* (${buildUnoCardMetadata(drawn).label}). Total kartu: ${myHand.join(', ')}` }]
          : undefined,
      };
    }

    // Parse card + optional color arg (e.g. "WILD biru" or sticker ID)
    const parts = trimmed.split(/\s+/);
    const cardMeta = resolveStickerToUnoCard(parts[0]);
    if (!cardMeta) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: `Format kartu UNO nggak dikenali. Ketik kode kartu (misal: R-5, WILD merah) atau "draw".`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    const handIdx = myHand.findIndex((c) => c.toUpperCase() === cardMeta.code);
    if (handIdx < 0) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: `Kartu *${cardMeta.code}* nggak ada di tanganmu.`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    const topCard = String(state.topCard || 'R-5');
    const activeColor = (state.activeColor || 'merah') as UnoColor;
    if (!canPlayUnoCard(cardMeta.code, topCard, activeColor)) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: `Kartu *${cardMeta.label}* belum cocok sama kartu meja (${buildUnoCardMetadata(topCard).label} · warna aktif: ${activeColor.toUpperCase()}).`,
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    // Play the card!
    myHand.splice(handIdx, 1);
    hands[currentPlayer.phone] = myHand;
    state.topCard = cardMeta.code;

    // Check WIN
    if (myHand.length === 0) {
      const pts = 120;
      currentPlayer.score += pts;
      applyUserBalanceAndExp(currentPlayer.phone, currentPlayer.name, pts, 30, `Menang UNO (${session.id})`, session.id);
      recordLeaderboardScore(currentPlayer.phone, currentPlayer.name, session.domain, session.game_id, pts, true);
      db.prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ?`).run(
        JSON.stringify({ ...state, winner: currentPlayer.name }),
        JSON.stringify(players),
        session.id,
      );
      logActivity(session, currentPlayer.phone, currentPlayer.name, 'UNO Win', trimmed, 'correct', pts, 'completed');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'correct',
        scoreAwarded: pts,
        announcement: `🎉 UNO!! *${currentPlayer.name}* menghabiskan semua kartu dan MENANG! (+${pts} Balance)`,
        sessionStatus: 'completed',
        state: sanitizeStateForClient({ ...state, winner: currentPlayer.name }),
      };
    }

    if (cardMeta.color === 'wild') {
      const inlineColor = parts[1] ? normalizeUnoColor(parts[1]) : null;
      if (!inlineColor) {
        state.pendingWildColorFor = currentPlayer.phone;
        state.pendingWildPlus4 = cardMeta.code === 'WILD+4';
        state.turnDeadlineMs = Date.now() + 60_000;
        db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
        return {
          ok: true,
          sessionId: session.id,
          answerStatus: 'turn_ok',
          scoreAwarded: 0,
          announcement: `${currentPlayer.name} memainkan *${cardMeta.label}*!\nPilih warna baru sekarang: *merah*, *biru*, *kuning*, atau *hijau*.`,
          sessionStatus: 'active',
          state: sanitizeStateForClient(state),
        };
      }
      state.activeColor = inlineColor;
    } else {
      state.activeColor = cardMeta.color;
    }

    let dir = Number(state.direction ?? 1);
    let step = 1;
    if (cardMeta.value === 'REVERSE') {
      dir = players.length === 2 ? dir : -dir;
      state.direction = dir;
      if (players.length === 2) step = 2;
    } else if (cardMeta.value === 'SKIP') {
      step = 2;
    } else if (cardMeta.value === '+2' || cardMeta.code === 'WILD+4') {
      const drawAmt = cardMeta.code === 'WILD+4' ? 4 : 2;
      const victimIdx = ((currentIdx + dir) % players.length + players.length) % players.length;
      const victim = players[victimIdx];
      hands[victim.phone] = hands[victim.phone] || [];
      hands[victim.phone].push(...deck.splice(0, drawAmt));
      step = 2;
    }

    const nextIdx = ((currentIdx + step * dir) % players.length + players.length) % players.length;
    state.currentTurnIndex = nextIdx;
    state.turnDeadlineMs = Date.now() + 60_000;
    db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(state), session.id);
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'turn_ok',
      scoreAwarded: 0,
      announcement: `🃏 ${currentPlayer.name} mainkan *${cardMeta.label}* (sisa ${myHand.length} kartu). Warna aktif: *${String(state.activeColor).toUpperCase()}*.\nGiliran berikutnya: *${players[nextIdx].name}* (60 detik).`,
      sessionStatus: 'active',
      state: sanitizeStateForClient(state),
    };
  }

  // Active social deduction voting round (Werewolf / WW2 / Mafia / Spyfall / Impostor / 48Group)
  if (
    ['werewolf', 'mafia', 'spyfall', 'impostor', 'werewolf48', 'mafia48'].includes(session.game_id) &&
    session.status === 'active'
  ) {
    const lockKey = `ww-vote-${session.id}-${params.playerPhone}`;
    if (!acquireActionLock(lockKey, 1500)) {
      return {
        ok: false,
        sessionId: session.id,
        answerStatus: 'ignored',
        scoreAwarded: 0,
        announcement: 'Vote kamu lagi diproses, tunggu sebentar ya.',
        sessionStatus: 'active',
        state: sanitizeStateForClient(state),
      };
    }

    try {
      return db.transaction(() => {
        const fresh = db.prepare('SELECT status, state_json, players_json FROM game_sessions WHERE id = ?').get(session.id) as {
          status: GameSessionStatus;
          state_json: string;
          players_json: string;
        };
        if (fresh.status !== 'active') {
          return {
            ok: false,
            sessionId: session.id,
            answerStatus: 'late' as const,
            scoreAwarded: 0,
            announcement: 'Sesi voting sudah selesai.',
            sessionStatus: fresh.status,
            state: sanitizeStateForClient(JSON.parse(fresh.state_json)),
          };
        }

        const freshState = JSON.parse(fresh.state_json) as Record<string, any>;
        const freshPlayers = JSON.parse(fresh.players_json) as Array<{ phone: string; name: string; score: number }>;
        let voter = freshPlayers.find((x) => x.phone === params.playerPhone);
        if (!voter) {
          voter = { phone: params.playerPhone, name: params.playerName, score: 0 };
          freshPlayers.push(voter);
        }

        const roleMap = (freshState.roleMap ?? {}) as Record<string, string>;
        const votes = (freshState.votes ?? {}) as Record<string, string>;
        const suspect =
          freshPlayers.find((pl) => pl.name.toLowerCase().includes(normalized) || normalized === 'vote') ??
          freshPlayers.find((pl) => pl.phone !== params.playerPhone);

        if (!suspect) {
          return {
            ok: false,
            sessionId: session.id,
            answerStatus: 'wrong' as const,
            scoreAwarded: 0,
            announcement: 'Target vote-nya nggak ketemu nih.',
            sessionStatus: 'active' as const,
            state: sanitizeStateForClient(freshState),
          };
        }

        votes[params.playerPhone] = suspect.phone;
        freshState.votes = votes;

        // Real players (non-NPC) needed for atomic vote completion, or immediate resolve if single real player
        const realPlayers = freshPlayers.filter((pl) => !pl.phone.startsWith('bot-npc-'));
        const allRealVoted = realPlayers.every((pl) => Boolean(votes[pl.phone]));

        if (!allRealVoted && realPlayers.length > 1) {
          db.prepare(`UPDATE game_sessions SET state_json = ?, players_json = ? WHERE id = ?`).run(
            JSON.stringify(freshState),
            JSON.stringify(freshPlayers),
            session.id,
          );
          return {
            ok: true,
            sessionId: session.id,
            answerStatus: 'turn_ok' as const,
            scoreAwarded: 0,
            announcement: `🗳️ Vote dari ${params.playerName} tercatat (${Object.keys(votes).length}/${realPlayers.length}). Menunggu pemain lain.`,
            sessionStatus: 'active' as const,
            state: sanitizeStateForClient(freshState),
          };
        }

        // Tally votes atomically!
        const tally = new Map<string, number>();
        for (const tPhone of Object.values(votes)) {
          tally.set(tPhone, (tally.get(tPhone) || 0) + 1);
        }
        let topTargetPhone = suspect.phone;
        let topVotes = -1;
        for (const [tPhone, count] of tally.entries()) {
          if (count > topVotes) {
            topVotes = count;
            topTargetPhone = tPhone;
          }
        }
        const eliminatedPlayer = freshPlayers.find((pl) => pl.phone === topTargetPhone) ?? suspect;
        const suspectRole = roleMap[eliminatedPlayer.phone] || 'Villager';
        const isWolf = suspectRole.includes('Werewolf') || suspectRole.includes('Shadow') || suspectRole.includes('Mafia');
        const scoreAwarded = isWolf ? 150 : 40;
        voter.score += scoreAwarded;

        const finishUpd = db
          .prepare(`UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), state_json = ?, players_json = ? WHERE id = ? AND status = 'active'`)
          .run(
            JSON.stringify({ ...freshState, eliminated: [eliminatedPlayer.name], winner: isWolf ? 'Tim Desa / Theater' : 'Tim Shadow' }),
            JSON.stringify(freshPlayers),
            session.id,
          );

        if (finishUpd.changes === 0) {
          return {
            ok: false,
            sessionId: session.id,
            answerStatus: 'late' as const,
            scoreAwarded: 0,
            announcement: 'Voting sudah selesai.',
            sessionStatus: 'completed' as const,
            state: sanitizeStateForClient(freshState),
          };
        }

        applyUserBalanceAndExp(params.playerPhone, params.playerName, scoreAwarded, 30, `${session.game_name} (${session.id})`, session.id);
        recordLeaderboardScore(params.playerPhone, params.playerName, session.domain, session.game_id, scoreAwarded, isWolf);
        logActivity(session, params.playerPhone, params.playerName, 'Voting Eliminasi', trimmed, isWolf ? 'correct' : 'wrong', scoreAwarded, 'completed');

        const footerNote = freshState.isWw2 ? `\n\n_${botText().botFooter}_` : '';
        return {
          ok: true,
          sessionId: session.id,
          answerStatus: (isWolf ? 'correct' : 'wrong') as 'correct' | 'wrong',
          scoreAwarded,
          announcement: `Hasil Voting ${freshState.isWw2 ? 'Werewolf2 (#ww2)' : session.game_name} (${session.id}):\nTereliminasi: ${eliminatedPlayer.name} (${suspectRole}).\nPemenang: ${isWolf ? 'Tim Desa / Theater' : 'Tim Saboteur'}! Skor: +${scoreAwarded}${footerNote}`,
          sessionStatus: 'completed' as const,
          state: sanitizeStateForClient({ ...freshState, eliminated: [eliminatedPlayer.name], winner: isWolf ? 'Tim Desa / Theater' : 'Tim Saboteur' }),
        };
      })();
    } finally {
      releaseActionLock(lockKey);
    }
  }

  // Prevent double-answering once a player already solved single-winner rounds
  const playerObj = ensurePlayer();
  if (playerObj.answered && session.game_id !== 'bom' && session.game_id !== 'tebakbom' && session.game_id !== 'tebakangka' && session.game_id !== 'tictactoe' && session.game_id !== 'sambungkata' && session.game_id !== 'family100') {
    return {
      ok: false,
      sessionId: session.id,
      answerStatus: 'ignored',
      scoreAwarded: 0,
      announcement: 'Kamu udah kirim jawaban di sesi ini.',
      sessionStatus: session.status,
      state: sanitizeStateForClient(state),
    };
  }

  // Handle Bom / Tebak Bom (v5 configurable grid, proportional bombs, negative balance allowed, voluntary stop)
  if (session.game_id === 'bom' || session.game_id === 'tebakbom') {
    const bomRes = processBomTurn({
      session,
      state,
      players,
      playerPhone: params.playerPhone,
      playerName: params.playerName,
      trimmedInput: trimmed,
      recordScoreFn: recordLeaderboardScore,
      logFn: (prompt, ans, st, score, sessSt) =>
        logActivity(session, params.playerPhone, params.playerName, prompt, ans, st, score, sessSt),
    });
    return {
      sessionId: session.id,
      ...bomRes,
      state: sanitizeStateForClient(bomRes.state),
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
      const wrongAttempts = Number(state.wrongAttempts ?? 0) + 1;
      const maxWrong = Number(state.maxWrongAttempts ?? getMaxQuizWrongAttempts());
      state.wrongAttempts = wrongAttempts;
      if (wrongAttempts >= maxWrong) {
        db.prepare(
          `UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), cancel_reason = 'Batas 5 jawaban salah tercapai', state_json = ?, players_json = ? WHERE id = ?`,
        ).run(JSON.stringify(state), JSON.stringify(players), session.id);
        logActivity(session, params.playerPhone, params.playerName, String(state.question), trimmed, 'wrong', 0, 'completed');
        const remaining = answers.filter((a) => !found.includes(a));
        return {
          ok: true,
          sessionId: session.id,
          answerStatus: 'wrong',
          scoreAwarded: 0,
          announcement: `❌ Jawaban "${trimmed}" tidak cocok (${wrongAttempts}/${maxWrong}). Batas salah tercapai!\nJawaban tersisa: ${remaining.length > 0 ? remaining.join(', ') : answers.join(', ')}`,
          sessionStatus: 'completed',
          state: sanitizeStateForClient(state),
        };
      }
      db.prepare(`UPDATE game_sessions SET state_json = ?, players_json = ? WHERE id = ?`).run(
        JSON.stringify(state),
        JSON.stringify(players),
        session.id,
      );
      logActivity(session, params.playerPhone, params.playerName, String(state.question), trimmed, 'wrong', 0, 'active');
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'wrong',
        scoreAwarded: 0,
        announcement: matched
          ? `"${matched}" sudah ditemukan (${wrongAttempts}/${maxWrong} salah).`
          : `Belum ada di daftar survei Family 100 (${wrongAttempts}/${maxWrong} salah).`,
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
  const aliases = Array.isArray(state.aliases) ? (state.aliases as string[]) : [];
  let userAnswerText = trimmed;
  if (Array.isArray(state.options)) {
    const idx = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= (state.options as string[]).length) {
      userAnswerText = (state.options as string[])[idx - 1];
    }
  }

  const normalizeAns = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
  const userNorm = normalizeAns(userAnswerText);
  const isCorrect =
    userNorm === normalizeAns(expectedRaw) || aliases.some((a) => normalizeAns(a) === userNorm);
  const difficulty = (state.difficulty as DifficultyLevel) || 'normal';
  const hintsUsed = Number(state.hintsUsed ?? 0);

  if (!isCorrect) {
    const wrongAttempts = Number(state.wrongAttempts ?? 0) + 1;
    const maxWrong = Number(state.maxWrongAttempts ?? getMaxQuizWrongAttempts());
    state.wrongAttempts = wrongAttempts;

    if (wrongAttempts >= maxWrong) {
      db.prepare(
        `UPDATE game_sessions SET status = 'completed', ended_at = datetime('now'), cancel_reason = 'Batas 5 jawaban salah tercapai', state_json = ?, players_json = ? WHERE id = ?`,
      ).run(JSON.stringify(state), JSON.stringify(players), session.id);
      logActivity(session, params.playerPhone, params.playerName, String(state.prompt ?? ''), trimmed, 'wrong', 0, 'completed');
      const expLine = state.explanation ? `\nPenjelasan: ${state.explanation}` : '';
      return {
        ok: true,
        sessionId: session.id,
        answerStatus: 'wrong',
        scoreAwarded: 0,
        announcement: `❌ Jawaban "${trimmed}" salah (${wrongAttempts}/${maxWrong}). Batas salah habis, soal langsung dihentikan!\nJawaban yang benar: *${expectedRaw}*${expLine}`,
        sessionStatus: 'completed',
        state: sanitizeStateForClient(state),
      };
    }

    db.prepare(`UPDATE game_sessions SET state_json = ?, players_json = ? WHERE id = ?`).run(
      JSON.stringify(state),
      JSON.stringify(players),
      session.id,
    );
    logActivity(session, params.playerPhone, params.playerName, String(state.prompt ?? ''), trimmed, 'wrong', 0, 'active');
    return {
      ok: true,
      sessionId: session.id,
      answerStatus: 'wrong',
      scoreAwarded: 0,
      announcement: `Jawaban "${trimmed}" belum tepat (${wrongAttempts}/${maxWrong} salah). Coba lagi atau ketik .hint / .nyerah.`,
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
  delete clone.aliases;
  delete clone.target;
  delete clone.bombIndex;
  delete clone.bombIndexes;
  delete clone.civilianWord;
  delete clone.undercoverWord;
  delete clone.wordMap;
  delete clone.roleMap;
  delete clone.hands;
  delete clone.deck;
  return clone;
}
