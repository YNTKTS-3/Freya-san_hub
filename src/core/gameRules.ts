import { GameChatScope, GameDefinition, GameHubDomain, GameSessionStatus } from './types';

export const GAME_REGISTRY: GameDefinition[] = [
  // General Game Center (non-48Group)
  {
    id: 'sloth',
    name: 'Sloth',
    domain: 'general',
    category: 'Arcade Virtual',
    description: 'Kombinasi 3 simbol acak transparan dengan hadiah balance virtual (bukan taruhan uang asli).',
    minPlayers: 1,
    maxPlayers: 1,
    defaultDurationSec: 30,
    cooldownSec: 5,
    enabled: true,
    isMultiplayer: false,
  },
  {
    id: 'bom',
    name: 'Tebak Bom',
    domain: 'general',
    category: 'Arcade Virtual',
    description: 'Buka kotak aman satu per satu dan hindari kotak bom tersembunyi.',
    minPlayers: 1,
    maxPlayers: 6,
    defaultDurationSec: 120,
    cooldownSec: 5,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'tebakangka',
    name: 'Tebak Angka',
    domain: 'general',
    category: 'Logika',
    description: 'Tebak angka rahasia 1 sampai 100 dengan petunjuk lebih tinggi/rendah.',
    minPlayers: 1,
    maxPlayers: 8,
    defaultDurationSec: 90,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'tebakkata',
    name: 'Tebak Kata',
    domain: 'general',
    category: 'Kata & Bahasa',
    description: 'Tebak kata dari petunjuk definisi dengan pelacakan jawaban sesi.',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 90,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'sambungkata',
    name: 'Sambung Kata',
    domain: 'general',
    category: 'Kata & Bahasa',
    description: 'Sambung kata berantai berdasarkan huruf atau suku kata terakhir.',
    minPlayers: 1,
    maxPlayers: 12,
    defaultDurationSec: 120,
    cooldownSec: 5,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    domain: 'general',
    category: 'Strategi Papan',
    description: 'Permainan strategi papan 3x3 melawan AI atau pemain lain.',
    minPlayers: 1,
    maxPlayers: 2,
    defaultDurationSec: 180,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'suit',
    name: 'Rock Paper Scissors (Suit)',
    domain: 'general',
    category: 'Aksi Cepat',
    description: 'Batu Gunting Kertas melawan server dengan riwayat menang/kalah.',
    minPlayers: 1,
    maxPlayers: 2,
    defaultDurationSec: 45,
    cooldownSec: 2,
    enabled: true,
    isMultiplayer: false,
  },
  {
    id: 'family100',
    name: 'Family 100',
    domain: 'general',
    category: 'Kuis Survei',
    description: 'Tebak semua jawaban populer dari pertanyaan survei.',
    minPlayers: 1,
    maxPlayers: 12,
    defaultDurationSec: 120,
    cooldownSec: 5,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'siapakahaku',
    name: 'Siapa Aku?',
    domain: 'general',
    category: 'Teka-teki',
    description: 'Tebak tokoh, benda, atau profesi dari petunjuk bertahap.',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 90,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'tebakemoji',
    name: 'Tebak Emoji',
    domain: 'general',
    category: 'Visual',
    description: 'Tebak frasa atau objek dari rangkaian emoji.',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 90,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'math',
    name: 'Adu Cepat Matematika',
    domain: 'general',
    category: 'Logika',
    description: 'Selesaikan hitungan cepat dengan bonus waktu.',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 60,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'werewolf',
    name: 'Werewolf Classic',
    domain: 'general',
    category: 'Social Deduction',
    description: 'Permainan peran Villager vs Werewolf vs Seer dengan fase siang/malam & pembagian peran private.',
    minPlayers: 4,
    maxPlayers: 16,
    defaultDurationSec: 600,
    cooldownSec: 15,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'undercover',
    name: 'Undercover Word Deduction',
    domain: 'general',
    category: 'Social Deduction',
    description: 'Permainan deduksi kata multibahasa (210 pasangan kata & opsi Mr. White) dengan pembagian kata private.',
    minPlayers: 3,
    maxPlayers: 12,
    defaultDurationSec: 420,
    cooldownSec: 10,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'uno',
    name: 'UNO Card Arena',
    domain: 'general',
    category: 'Permainan Kartu',
    description: 'Permainan kartu UNO berbasis giliran dalam grup dengan kartu aksi, Wild color, timeout 60 detik, dan .uno stop.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultDurationSec: 600,
    cooldownSec: 10,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'mafia',
    name: 'Mafia Game',
    domain: 'general',
    category: 'Social Deduction',
    description: 'Permainan strategi Mafia vs Detective vs Citizen.',
    minPlayers: 4,
    maxPlayers: 16,
    defaultDurationSec: 600,
    cooldownSec: 15,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'spyfall',
    name: 'Spyfall',
    domain: 'general',
    category: 'Social Deduction',
    description: 'Temukan mata-mata sebelum lokasi rahasia terbongkar.',
    minPlayers: 3,
    maxPlayers: 10,
    defaultDurationSec: 300,
    cooldownSec: 10,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'impostor',
    name: 'Impostor Game',
    domain: 'general',
    category: 'Social Deduction',
    description: 'Diskusi dan eliminasi untuk menemukan Impostor.',
    minPlayers: 3,
    maxPlayers: 12,
    defaultDurationSec: 300,
    cooldownSec: 10,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'truthordare',
    name: 'Truth or Dare (Versi Aman)',
    domain: 'general',
    category: 'Sosial',
    description: 'Pertanyaan dan tantangan ramah komunitas.',
    minPlayers: 1,
    maxPlayers: 12,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },

  // 48GROUP CENTER -> GAME CENTER
  {
    id: 'memberquiz48',
    name: 'Member Quiz 48Group',
    domain: '48group',
    category: 'Member Intelligence',
    description: 'Kuis profil member, generasi, dan nama panggilan dari database resmi terverifikasi.',
    minPlayers: 1,
    maxPlayers: 12,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'groupquiz48',
    name: 'Group Quiz 48Group',
    domain: '48group',
    category: 'Group Intelligence',
    description: 'Kuis sejarah pembentukan, basis kota, dan sister group 48Group.',
    minPlayers: 1,
    maxPlayers: 12,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'songquiz48',
    name: 'Song & Discography Quiz',
    domain: '48group',
    category: 'Discography',
    description: 'Tebak judul single, center resmi, dan tahun rilis (tanpa reproduksi lirik panjang).',
    minPlayers: 1,
    maxPlayers: 12,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'genchallenge48',
    name: 'Generation Challenge',
    domain: '48group',
    category: 'Generasi',
    description: 'Kuis lintas generasi termasuk perbedaan penomoran antar grup.',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'theaterchallenge48',
    name: 'Theater Challenge',
    domain: '48group',
    category: 'Theater Archive',
    description: 'Kuis setlist theater, grup pemilik setlist, dan lagu pembuka.',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'timeline48',
    name: '48Group Timeline Challenge',
    domain: '48group',
    category: 'Sejarah',
    description: 'Urutkan tahun pembentukan grup, rilisan single, dan peristiwa sejarah.',
    minPlayers: 1,
    maxPlayers: 8,
    defaultDurationSec: 150,
    cooldownSec: 5,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'guess48',
    name: 'Guessing Game 48Group',
    domain: '48group',
    category: 'Petunjuk Bertahap',
    description: 'Tebak member, lagu, atau setlist dengan petunjuk bertahap (mengurangi poin jika dibuka).',
    minPlayers: 1,
    maxPlayers: 10,
    defaultDurationSec: 120,
    cooldownSec: 3,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'daily48',
    name: 'Daily 48Group Challenge',
    domain: '48group',
    category: 'Tantangan Harian',
    description: 'Tantangan harian unik tanpa pengulangan pertanyaan dalam periode berdekatan.',
    minPlayers: 1,
    maxPlayers: 1,
    defaultDurationSec: 180,
    cooldownSec: 60,
    enabled: true,
    isMultiplayer: false,
  },
  {
    id: 'werewolf48',
    name: 'Werewolf 48Group',
    domain: '48group',
    category: 'Multiplayer 48Group',
    description: 'Werewolf bertema Theater 48Group (Center, Senbatsu, Undergirls, Shadow).',
    minPlayers: 4,
    maxPlayers: 16,
    defaultDurationSec: 600,
    cooldownSec: 15,
    enabled: true,
    isMultiplayer: true,
  },
  {
    id: 'mafia48',
    name: 'Mafia 48Group',
    domain: '48group',
    category: 'Multiplayer 48Group',
    description: 'Mafia bertema Manajemen & Theater 48Group berbasis room.',
    minPlayers: 4,
    maxPlayers: 16,
    defaultDurationSec: 600,
    cooldownSec: 15,
    enabled: true,
    isMultiplayer: true,
  },
];

export type SlothSymbol = '★' | '◆' | '♪' | '✿' | '7';

const SLOTH_SYMBOLS: SlothSymbol[] = ['★', '◆', '♪', '✿', '7'];

export interface SlothResult {
  reels: [SlothSymbol, SlothSymbol, SlothSymbol];
  isWin: boolean;
  rewardBalance: number;
  rewardExp: number;
  tier: 'jackpot' | 'match_two' | 'miss';
}

export function rollSloth(rng: () => number = Math.random): SlothResult {
  const pick = (): SlothSymbol =>
    SLOTH_SYMBOLS[Math.min(SLOTH_SYMBOLS.length - 1, Math.floor(rng() * SLOTH_SYMBOLS.length))];
  const reels: [SlothSymbol, SlothSymbol, SlothSymbol] = [pick(), pick(), pick()];

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    const isSeven = reels[0] === '7';
    return {
      reels,
      isWin: true,
      rewardBalance: isSeven ? 250 : 120,
      rewardExp: isSeven ? 60 : 30,
      tier: 'jackpot',
    };
  }

  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    return {
      reels,
      isWin: true,
      rewardBalance: 35,
      rewardExp: 10,
      tier: 'match_two',
    };
  }

  return {
    reels,
    isWin: false,
    rewardBalance: 0,
    rewardExp: 2,
    tier: 'miss',
  };
}

export type DifficultyLevel = 'easy' | 'normal' | 'hard' | 'expert';

export function calculateQuizScore(params: {
  difficulty: DifficultyLevel;
  isCorrect: boolean;
  hintsUsed: number;
  elapsedSec: number;
  maxTimeSec: number;
}): number {
  if (!params.isCorrect) return 0;

  const baseMap: Record<DifficultyLevel, number> = {
    easy: 50,
    normal: 100,
    hard: 160,
    expert: 240,
  };

  const base = baseMap[params.difficulty];
  const hintPenalty = Math.max(0, params.hintsUsed) * 20;
  const remainingRatio = Math.max(
    0,
    Math.min(1, (params.maxTimeSec - params.elapsedSec) / Math.max(1, params.maxTimeSec)),
  );
  const speedBonus = Math.round(remainingRatio * 30);

  return Math.max(10, base - hintPenalty + speedBonus);
}

export function canStartSessionInChat(
  existingActiveSessions: Array<{ chatId: string; status: GameSessionStatus }>,
  chatId: string,
): { allowed: boolean; reason?: string } {
  const active = existingActiveSessions.find(
    (s) => s.chatId === chatId && (s.status === 'active' || s.status === 'waiting' || s.status === 'paused'),
  );
  if (active) {
    return {
      allowed: false,
      reason: 'Masih ada sesi permainan aktif di percakapan ini. Selesaikan atau batalkan sesi sebelumnya terlebih dahulu.',
    };
  }
  return { allowed: true };
}

export function maskPhoneNumberForGroup(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}-****-${digits.slice(-3)}`;
}

export function filterVerifiedQuizQuestions<
  T extends { validationStatus: string; domain?: GameHubDomain },
>(questions: T[]): T[] {
  return questions.filter((q) => q.validationStatus === 'official_verified');
}

export function isIndonesianPhoneNumber(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+62') || cleaned.startsWith('62')) {
    return /^(\+?62)8\d{7,12}$/.test(cleaned);
  }
  if (cleaned.startsWith('08')) {
    return /^08\d{7,12}$/.test(cleaned);
  }
  return false;
}

export function validateChatScopeIsolation(
  sessionScope: GameChatScope,
  sessionChatId: string,
  incomingScope: GameChatScope,
  incomingChatId: string,
): boolean {
  return sessionScope === incomingScope && sessionChatId === incomingChatId;
}
