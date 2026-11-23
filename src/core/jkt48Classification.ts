import { Jkt48DifficultyLevelId, Jkt48DifficultyMeta, Jkt48TeamGroupId, Jkt48TeamMeta } from './types';

export const JKT48_DIFFICULTY_LEVELS: Jkt48DifficultyMeta[] = [
  {
    id: 'level_1',
    levelOrder: 1,
    title: 'Level 1 — Mudah–Menengah',
    difficultyLabel: 'Mudah–Menengah',
    eraCategory: 'New Era – Fight Era',
    periodRange: '2022 – 2026',
    description:
      'Mencakup periode New Era (mulai 2022) hingga Fight Era (2026) berdasarkan arsip resmi terverifikasi: member aktif, trainee, graduate dalam rentang era ini, lagu original, serta pertunjukan theater terkini.',
    verificationStatus: 'official_verified',
    sourceTitle: 'Portal Resmi & Berita JKT48',
    sourceUrl: 'https://jkt48.com/about/jkt48?lang=id',
  },
  {
    id: 'level_2',
    levelOrder: 2,
    title: 'Level 2 — Menengah',
    difficultyLabel: 'Menengah',
    eraCategory: 'Era One',
    periodRange: '2021 – 2022',
    description:
      'Mencakup periode JKT48 ONE (restrukturisasi pasca-sistem Team 2021–2022): seluruh member aktif dan graduate periode Era One, single, pertunjukan theater format ONE, serta sejarah transisi.',
    verificationStatus: 'official_verified',
    sourceTitle: 'Pengumuman Resmi JKT48 ONE',
    sourceUrl: 'https://jkt48.com/news/list?lang=id',
  },
  {
    id: 'level_3',
    levelOrder: 3,
    title: 'Level 3 — Sulit',
    difficultyLabel: 'Sulit',
    eraCategory: 'Group Release Era – Pre-One Era',
    periodRange: '2011 – 2021',
    description:
      'Periode historis paling awal sejak debut JKT48 pada November 2011 hingga berakhirnya era sebelum JKT48 ONE (2021), mencakup Team J, Team KIII, Team T, diskografi awal, unit, dan arsip sejarah klasik.',
    verificationStatus: 'official_verified',
    sourceTitle: 'Arsip Sejarah Resmi JKT48',
    sourceUrl: 'https://jkt48.com/about/jkt48?lang=id',
  },
];

export const JKT48_TEAM_GROUPS: Array<{
  id: Jkt48TeamGroupId;
  title: string;
  description: string;
  disclaimer: string;
}> = [
  {
    id: 'old',
    title: 'Old',
    description: 'Klasifikasi navigasi internal untuk Team era klasik JKT48 (Team J, Team KIII, dan Team T).',
    disclaimer: 'Klasifikasi Old/New merupakan pengelompokan navigasi arsip internal dan tidak berarti seluruh Team berstatus aktif saat ini.',
  },
  {
    id: 'new',
    title: 'New',
    description: 'Klasifikasi navigasi internal untuk pembagian Team formasi baru (Team Love, Team Dream, dan Team Passion).',
    disclaimer: 'Informasi keanggotaan dan tanggal aktivasi masing-masing Team hanya ditampilkan sesuai data yang telah diverifikasi dari pengumuman resmi.',
  },
  {
    id: 'other',
    title: 'Other / Unassigned',
    description: 'Kategori internal untuk member JKT48 ONE, Academy, Trainee/Kenkyuusei, atau data yang belum diklasifikasikan ke salah satu Team di atas.',
    disclaimer: 'Data dengan keterkaitan Team yang belum terkonfirmasi tidak akan dikarang dan ditempatkan secara jujur di kategori ini.',
  },
];

export const JKT48_TEAMS: Jkt48TeamMeta[] = [
  {
    id: 'team_j',
    teamGroup: 'old',
    name: 'Team J',
    historicalStatus: 'Historis (Dibentuk 2012 · Sistem Team dihentikan pada restrukturisasi 2021)',
    eraSummary: 'Group Release Era – Pre-One Era (2012 – 2021)',
    description: 'Team pertama yang dibentuk di JKT48 pada Desember 2012 dengan warna identitas merah dan setlist pembuka Aturan Anti Cinta (Renai Kinshi Jourei).',
    verificationStatus: 'official_verified',
    sourceTitle: 'Arsip Sejarah JKT48',
    sourceUrl: 'https://jkt48.com/about/jkt48?lang=id',
    sortOrder: 1,
  },
  {
    id: 'team_kiii',
    teamGroup: 'old',
    name: 'Team KIII',
    historicalStatus: 'Historis (Dibentuk 2013 · Sistem Team dihentikan pada restrukturisasi 2021)',
    eraSummary: 'Group Release Era – Pre-One Era (2013 – 2021)',
    description: 'Team kedua JKT48 yang dibentuk pada Juni 2013 dengan identitas warna kuning dan karakter panggung energik.',
    verificationStatus: 'official_verified',
    sourceTitle: 'Arsip Sejarah JKT48',
    sourceUrl: 'https://jkt48.com/about/jkt48?lang=id',
    sortOrder: 2,
  },
  {
    id: 'team_t',
    teamGroup: 'old',
    name: 'Team T',
    historicalStatus: 'Historis (Dibentuk 2015 · Formasi ulang & dihentikan pada restrukturisasi 2021)',
    eraSummary: 'Group Release Era – Pre-One Era (2015 – 2021)',
    description: 'Team ketiga JKT48 yang awalnya dibentuk dari Generasi 3 pada Januari 2015 dengan warna identitas magenta/pink.',
    verificationStatus: 'official_verified',
    sourceTitle: 'Arsip Sejarah JKT48',
    sourceUrl: 'https://jkt48.com/about/jkt48?lang=id',
    sortOrder: 3,
  },
  {
    id: 'team_love',
    teamGroup: 'new',
    name: 'Team Love',
    historicalStatus: 'Klasifikasi New Team (Menunggu konfirmasi daftar lengkap anggota resmi)',
    eraSummary: 'New Era – Fight Era (2025 – 2026)',
    description: 'Kategori Team baru dalam navigasi internal JKT48. Detail susunan penuh hanya dipublikasikan setelah terverifikasi di pengumuman resmi.',
    verificationStatus: 'partial_unverified',
    sourceTitle: 'Portal Resmi JKT48',
    sourceUrl: 'https://jkt48.com/news/list?lang=id',
    sortOrder: 4,
  },
  {
    id: 'team_dream',
    teamGroup: 'new',
    name: 'Team Dream',
    historicalStatus: 'Klasifikasi New Team (Menunggu konfirmasi daftar lengkap anggota resmi)',
    eraSummary: 'New Era – Fight Era (2025 – 2026)',
    description: 'Kategori Team baru dalam navigasi internal JKT48. Detail susunan penuh hanya dipublikasikan setelah terverifikasi di pengumuman resmi.',
    verificationStatus: 'partial_unverified',
    sourceTitle: 'Portal Resmi JKT48',
    sourceUrl: 'https://jkt48.com/news/list?lang=id',
    sortOrder: 5,
  },
  {
    id: 'team_passion',
    teamGroup: 'new',
    name: 'Team Passion',
    historicalStatus: 'Klasifikasi New Team (Menunggu konfirmasi daftar lengkap anggota resmi)',
    eraSummary: 'New Era – Fight Era (2025 – 2026)',
    description: 'Kategori Team baru dalam navigasi internal JKT48. Detail susunan penuh hanya dipublikasikan setelah terverifikasi di pengumuman resmi.',
    verificationStatus: 'partial_unverified',
    sourceTitle: 'Portal Resmi JKT48',
    sourceUrl: 'https://jkt48.com/news/list?lang=id',
    sortOrder: 6,
  },
  {
    id: 'team_unassigned',
    teamGroup: 'other',
    name: 'Other / Unassigned',
    historicalStatus: 'Kategori Internal (JKT48 ONE / Academy / Trainee / Belum diklasifikasikan)',
    eraSummary: 'Lintas Era (2011 – 2026)',
    description: 'Menampung data member JKT48 ONE, Academy, Trainee, atau arsip yang tidak termasuk maupun belum terkonfirmasi masuk ke Team Old/New.',
    verificationStatus: 'official_verified',
    sourceTitle: 'Daftar Member Resmi JKT48',
    sourceUrl: 'https://jkt48.com/member/list?lang=id',
    sortOrder: 7,
  },
];

export function getDifficultyLevelMeta(levelId: Jkt48DifficultyLevelId): Jkt48DifficultyMeta | undefined {
  return JKT48_DIFFICULTY_LEVELS.find((l) => l.id === levelId);
}

export function getTeamMeta(teamId: string): Jkt48TeamMeta | undefined {
  return JKT48_TEAMS.find((t) => t.id === teamId);
}

export function getTeamsByGroup(groupId: Jkt48TeamGroupId): Jkt48TeamMeta[] {
  return JKT48_TEAMS.filter((t) => t.teamGroup === groupId).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function classifyDifficultyByYear(year: number): Jkt48DifficultyLevelId {
  // Never flip levels: Level 1 = newest (New Era - Fight Era >= 2022), Level 2 = Era One (2021 transition), Level 3 = earliest (2011 - 2020)
  if (year >= 2022) return 'level_1';
  if (year === 2021) return 'level_2';
  return 'level_3';
}
