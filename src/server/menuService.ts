import crypto from 'node:crypto';
import { ALL_COMMANDS } from '../core/commandInventory';
import { botText, normalizeBotLang, BotLang } from '../core/botI18n';
import { JKT48_DIFFICULTY_LEVELS, JKT48_TEAM_GROUPS, getTeamsByGroup } from '../core/jkt48Classification';
import { CommandCategory } from '../core/types';
import { db } from './db';

export interface InteractiveMenuRow {
  id: string;
  title: string;
  description: string;
  command: string;
  requiredPermission?: 'public' | 'group_admin' | 'owner';
  requiresGroup?: boolean;
  actionKind?: 'submenu' | 'command' | 'confirm_yes' | 'confirm_cancel';
}

export interface InteractiveMenuSection {
  title: string;
  rows: InteractiveMenuRow[];
}

export interface InteractiveMenuPayload {
  menuKey: string;
  title: string;
  subtitle: string;
  buttonText: string;
  footer: string;
  sections: InteractiveMenuSection[];
  sessionId?: string;
}

export interface MenuBuildContext {
  prefix: string;
  lang?: string | null;
  isOwner: boolean;
  isGroupAdmin: boolean;
  chatScope: 'private' | 'group';
  groupName?: string;
  botStatus?: string;
  senderName?: string;
}

export interface MenuResolutionResult {
  kind: 'matched_command' | 'cancelled' | 'expired' | 'invalid' | 'denied' | 'not_menu_input';
  commandText?: string;
  message?: string;
  menuKey?: string;
  rowTitle?: string;
  requiredPermission?: 'public' | 'group_admin' | 'owner';
}

const ALL_CATEGORIES: CommandCategory[] = [
  '48GROUP',
  'GAME',
  'AI',
  'GENERAL',
  'STICKER',
  'TEXTMAKER',
  'TOOLS',
  'INFO',
  'SEARCH',
  'RANDOM',
  'GROUP',
  'OWNER',
  'DOWNLOAD',
];

const CATEGORY_META: Record<CommandCategory, { icon: string; descId: string; descEn: string; descJa: string }> = {
  '48GROUP': {
    icon: '🌸',
    descId: 'Info, arsip, member, theater & kuis 48Group',
    descEn: '48Group archive, members, theater & quizzes',
    descJa: '48Groupのアーカイブ・メンバー・クイズ',
  },
  GAME: {
    icon: '🎮',
    descId: 'Game solo, kuis seru & multiplayer bareng teman',
    descEn: 'Solo games, quizzes & multiplayer rooms',
    descJa: 'ソロゲーム・クイズ・マルチプレイ',
  },
  AI: {
    icon: '🤖',
    descId: 'Ngobrol sama AI Nexara & generator gambar',
    descEn: 'Chat with Nexara AI & generate images',
    descJa: 'Nexara AIチャットと画像生成',
  },
  GENERAL: {
    icon: '🧭',
    descId: 'Menu utama, info bot, ping & streak teman',
    descEn: 'Main menu, bot info, ping & friend streaks',
    descJa: 'メイン・ボット情報・ストリーク',
  },
  STICKER: {
    icon: '✨',
    descId: 'Bikin stiker WhatsApp, brat & stiker bersuara',
    descEn: 'WhatsApp stickers, brat & sound stickers',
    descJa: 'スタンプ作成・音声付きスタンプ',
  },
  TEXTMAKER: {
    icon: '🎨',
    descId: 'Bikin gambar teks keren berbagai gaya visual',
    descEn: 'Generate stylized text artwork',
    descJa: 'スタイリッシュなテキスト画像作成',
  },
  TOOLS: {
    icon: '🛠️',
    descId: 'Folio, tolive, mockup chat, QR & tools teks',
    descEn: 'Folio, tolive, mockups, QR & text tools',
    descJa: '書類整形・tolive・QR・便利ツール',
  },
  INFO: {
    icon: '📊',
    descId: 'Cek profil, saldo, limit, gempa & leaderboard',
    descEn: 'Profile, balance, limit, quake & leaderboards',
    descJa: 'プロフィール・残高・ランキング',
  },
  SEARCH: {
    icon: '🔍',
    descId: 'Cari Wikipedia, cuaca, jadwal shalat & IP',
    descEn: 'Search Wikipedia, weather, prayer times & IP',
    descJa: 'Wikipedia・天気・IPチェック検索',
  },
  RANDOM: {
    icon: '🎲',
    descId: 'Pantun, fakta unik, cek khodam & konten acak',
    descEn: 'Random quotes, fun facts & playful prompts',
    descJa: '豆知識・ランダムコンテンツ',
  },
  GROUP: {
    icon: '👥',
    descId: 'Atur grup, welcome, anti-spam, absen & streakgrup',
    descEn: 'Group controls, welcome, anti-spam & streaks',
    descJa: 'グループ管理・ウェルカム・荒らし対策',
  },
  OWNER: {
    icon: '👑',
    descId: 'Panel khusus Owner, prefix, redeem & server',
    descEn: 'Owner controls, prefixes, redeems & server',
    descJa: 'オーナー専用・プレフィックス・サーバー管理',
  },
  DOWNLOAD: {
    icon: '⬇️',
    descId: 'Downloader media (butuh plugin aktif)',
    descEn: 'Media downloaders (requires plugin)',
    descJa: 'メディアダウンローダー',
  },
};

function clampTitle(text: string, maxLen = 24): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function clampDesc(text: string, maxLen = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function backToMainRow(prefix: string, lang: BotLang): InteractiveMenuRow {
  const t = botText(lang);
  return {
    id: 'nav:main',
    title: clampTitle(t.menuBackMainTitle),
    description: clampDesc(t.menuBackMainDesc),
    command: `${prefix}menu`,
    requiredPermission: 'public',
    actionKind: 'submenu',
  };
}

function hasRowPermission(row: InteractiveMenuRow, ctx: { isOwner: boolean; isGroupAdmin: boolean }): boolean {
  const perm = row.requiredPermission || 'public';
  if (perm === 'owner') return ctx.isOwner;
  if (perm === 'group_admin') return ctx.isOwner || ctx.isGroupAdmin;
  return true;
}

function formatCategoryDescription(cat: CommandCategory, lang: BotLang): string {
  const m = CATEGORY_META[cat];
  if (lang === 'en') return m.descEn;
  if (lang === 'ja') return m.descJa;
  return m.descId;
}

export function buildMenuPayload(
  rawTarget: string,
  ctx: MenuBuildContext,
): { menu: InteractiveMenuPayload; headerText: string; deniedReason?: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const normalized = (rawTarget || 'main').trim().toLowerCase();

  // Check top-level protected menus before building
  if (
    (normalized === 'owner' || normalized === 'bot_settings' || normalized === 'bot' || normalized === 'category:owner') &&
    !ctx.isOwner
  ) {
    return {
      menu: buildMainMenu(ctx),
      headerText: t.ownerOnly(normalized),
      deniedReason: t.ownerOnly(normalized),
    };
  }
  if (
    (normalized === 'group_settings' || normalized === 'grup' || normalized === 'groupsetting' || normalized === 'category:group') &&
    !ctx.isOwner &&
    !ctx.isGroupAdmin &&
    ctx.chatScope === 'group'
  ) {
    return {
      menu: buildMainMenu(ctx),
      headerText: t.adminOnly('groupsetting'),
      deniedReason: t.adminOnly('groupsetting'),
    };
  }

  // Category route: category:<CAT>[:page] or exact category name
  const catMatch = normalized.match(/^category:([a-z0-9_]+)(?::(\d+))?$/i);
  if (catMatch) {
    const catName = catMatch[1].toUpperCase() as CommandCategory;
    const page = Math.max(1, Number(catMatch[2] || 1));
    if (ALL_CATEGORIES.includes(catName)) {
      return buildCategoryMenu(catName, page, ctx);
    }
  }

  // Confirmation route: confirm:<actionKey>:<payload>
  if (normalized.startsWith('confirm:')) {
    return buildConfirmMenu(rawTarget.trim(), ctx);
  }

  // Aliases & submenus
  if (normalized === 'games' || normalized === 'game') return buildGamesMenu(ctx);
  if (normalized === '48group' || normalized === 'jkt48') return build48GroupMenu(ctx);
  if (normalized === '48group_level') return build48LevelMenu(ctx);
  if (normalized === '48group_team') return build48TeamGroupMenu(ctx);
  if (normalized.startsWith('48group_team:')) return build48TeamDetailMenu(normalized.split(':')[1] || 'old', ctx);
  if (normalized === '48group_quiz') return build48QuizMenu(ctx);
  if (normalized === 'group_settings' || normalized === 'grup' || normalized === 'groupsetting') return buildGroupSettingsMenu(ctx);
  if (normalized === 'bot_settings' || normalized === 'bot' || normalized === 'settings') return buildBotSettingsMenu(ctx);
  if (normalized === 'owner') return buildOwnerMenu(ctx);
  if (normalized === 'premium_redeem' || normalized === 'premium' || normalized === 'redeem') return buildPremiumRedeemMenu(ctx);
  if (normalized === 'economy' || normalized === 'ekonomi' || normalized === 'transaksi') return buildEconomyMenu(ctx);
  if (normalized === 'help_info' || normalized === 'bantuan' || normalized === 'info' || normalized === 'help') return buildHelpInfoMenu(ctx);
  if (normalized === 'features' || normalized === 'fitur') return buildFeaturesMenu(ctx);

  // Direct category name fallback (e.g. ".menu sticker", ".menu tools", ".menu ai")
  const upperDirect = normalized.toUpperCase() as CommandCategory;
  if (ALL_CATEGORIES.includes(upperDirect)) {
    return buildCategoryMenu(upperDirect, 1, ctx);
  }

  return {
    menu: buildMainMenu(ctx),
    headerText: buildMainHeader(ctx),
  };
}

function buildMainHeader(ctx: MenuBuildContext): string {
  const lang = normalizeBotLang(ctx.lang);
  if (lang === 'en') {
    return `Hi ${ctx.senderName || 'there'}! Welcome to *Freya-san Hub v5.0* (${ctx.botStatus || 'online'}).\nActive prefix: *${ctx.prefix}* (supports 10 prefixes).\nPick a menu from the list below!`;
  }
  if (lang === 'ja') {
    return `やっほー ${ctx.senderName || 'ゲスト'}さん！*Freya-san Hub v5.0* (${ctx.botStatus || 'online'}) へようこそ。\n今のプレフィックス: *${ctx.prefix}*\n下のリストからメニューを選んでね！`;
  }
  return `Halo ${ctx.senderName || 'Kamu'}! Selamat datang di *Freya-san Hub v5.0*.\nPrefix aktif sekarang: *${ctx.prefix}* (semua 10 prefix nyala).\nPilih menu atau fitur langsung dari daftar di bawah ya!`;
}

function buildMainMenu(ctx: MenuBuildContext): InteractiveMenuPayload {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;

  const quickNavRows: InteractiveMenuRow[] = [
    {
      id: 'menu:games',
      title: clampTitle(lang === 'en' ? '🎮 Games & Quizzes' : lang === 'ja' ? '🎮 ゲーム＆クイズ' : '🎮 Menu Game & Kuis'),
      description: clampDesc(lang === 'en' ? 'Solo, Bom, UNO, Werewolf & Undercover' : lang === 'ja' ? 'ボム・UNO・人狼・ワードウルフなど' : 'Game solo, Tebak Bom, UNO, Undercover & WW2'),
      command: `${p}menu games`,
      requiredPermission: 'public',
      actionKind: 'submenu',
    },
    {
      id: 'menu:48group',
      title: clampTitle(lang === 'en' ? '🌸 48Group Center' : lang === 'ja' ? '🌸 48Groupセンター' : '🌸 Menu 48GROUP'),
      description: clampDesc(lang === 'en' ? 'Archive, Levels 1-3, Teams & 48 Quizzes' : lang === 'ja' ? 'アーカイブ・難易度1-3・チーム・クイズ' : 'Arsip JKT48/AKB48, Level 1-3, Team & Kuis'),
      command: `${p}menu 48group`,
      requiredPermission: 'public',
      actionKind: 'submenu',
    },
    {
      id: 'menu:economy',
      title: clampTitle(lang === 'en' ? '💰 Economy & Streak' : lang === 'ja' ? '💰 残高・リミット' : '💰 Ekonomi & Streak'),
      description: clampDesc(lang === 'en' ? 'Balance, EXP, addlimit, leaderboard & streak' : lang === 'ja' ? '残高・EXP・リミット購入・ランキング' : 'Balance, limit, transfer, leaderboard & streak'),
      command: `${p}menu economy`,
      requiredPermission: 'public',
      actionKind: 'submenu',
    },
    {
      id: 'menu:premium_redeem',
      title: clampTitle(lang === 'en' ? '🎁 Premium & Redeem' : lang === 'ja' ? '🎁 プレミアム・引き換え' : '🎁 Premium & Redeem'),
      description: clampDesc(lang === 'en' ? 'Check premium status & claim redeem codes' : lang === 'ja' ? 'プレミアム確認とコード引き換え' : 'Cek status premium, klaim kode & benefit'),
      command: `${p}menu premium_redeem`,
      requiredPermission: 'public',
      actionKind: 'submenu',
    },
    {
      id: 'menu:features',
      title: clampTitle(lang === 'en' ? '⚡ Quick Features' : lang === 'ja' ? '⚡ クイック機能' : '⚡ Fitur Populer Cepat'),
      description: clampDesc(lang === 'en' ? 'Stickers (#sa/#brat2), #tolive, Nexara & mockups' : lang === 'ja' ? '音声スタンプ・tolive・AI・モックアップ' : 'Stiker #sa/#brat2, #tolive, AI Nexara & mockup'),
      command: `${p}menu features`,
      requiredPermission: 'public',
      actionKind: 'submenu',
    },
    {
      id: 'menu:help_info',
      title: clampTitle(lang === 'en' ? '❓ Help & Bot Info' : lang === 'ja' ? '❓ ヘルプ＆情報' : '❓ Bantuan & Info Bot'),
      description: clampDesc(lang === 'en' ? 'Prefix guide, quake info, folio & owner contact' : lang === 'ja' ? '使い方ガイド・地震情報・オーナー連絡' : 'Cara pakai prefix, gempa, folio & kontak owner'),
      command: `${p}menu help_info`,
      requiredPermission: 'public',
      actionKind: 'submenu',
    },
  ];

  const manageRows: InteractiveMenuRow[] = [];
  if (ctx.chatScope === 'group' && (ctx.isGroupAdmin || ctx.isOwner)) {
    manageRows.push({
      id: 'menu:group_settings',
      title: clampTitle(lang === 'en' ? '👥 Group Settings' : lang === 'ja' ? '👥 グループ設定' : '👥 Pengaturan Grup'),
      description: clampDesc(lang === 'en' ? 'Welcome, left, anti-spam & group streaks' : lang === 'ja' ? 'ウェルカム・荒らし対策・グループ記録' : 'Welcome, left, anti-sistem & streak grup'),
      command: `${p}menu group_settings`,
      requiredPermission: 'group_admin',
      actionKind: 'submenu',
    });
  }
  if (ctx.isOwner) {
    manageRows.push({
      id: 'menu:bot_settings',
      title: clampTitle(lang === 'en' ? '⚙️ Bot Settings' : lang === 'ja' ? '⚙️ ボット設定' : '⚙️ Pengaturan Bot'),
      description: clampDesc(lang === 'en' ? 'Language, blue tick, maintenance & prefix' : lang === 'ja' ? '言語・既読・メンテナンス・プレフィックス' : 'Bahasa ID/EN/JA, blue tick & maintenance'),
      command: `${p}menu bot_settings`,
      requiredPermission: 'owner',
      actionKind: 'submenu',
    });
    manageRows.push({
      id: 'menu:owner',
      title: clampTitle(lang === 'en' ? '👑 Owner Console' : lang === 'ja' ? '👑 オーナーメニュー' : '👑 Menu Owner & Admin'),
      description: clampDesc(lang === 'en' ? 'Prefixes, redeems, server status & groups' : lang === 'ja' ? 'プレフィックス・引き換え・ステータス管理' : 'Manajemen prefix, redeem, grup & server'),
      command: `${p}menu owner`,
      requiredPermission: 'owner',
      actionKind: 'submenu',
    });
  }

  const categoryRows: InteractiveMenuRow[] = ALL_CATEGORIES
    .filter((cat) => (cat === 'OWNER' ? ctx.isOwner : true))
    .map((cat) => {
      const count = ALL_COMMANDS.filter((c) => c.category === cat).length;
      return {
        id: `menu:category:${cat}:1`,
        title: clampTitle(`${CATEGORY_META[cat].icon} ${cat} (${count})`),
        description: clampDesc(formatCategoryDescription(cat, lang)),
        command: `${p}menu category:${cat}:1`,
        requiredPermission: cat === 'OWNER' ? 'owner' : 'public',
        actionKind: 'submenu' as const,
      };
    });

  const sections: InteractiveMenuSection[] = [
    {
      title: lang === 'en' ? 'Quick Navigation' : lang === 'ja' ? 'クイックメニュー' : 'Menu Utama & Fitur',
      rows: quickNavRows,
    },
  ];
  if (manageRows.length > 0) {
    sections.push({
      title: lang === 'en' ? 'Admin & Owner Controls' : lang === 'ja' ? '管理・オーナー設定' : 'Kontrol Admin & Owner',
      rows: manageRows,
    });
  }
  sections.push({
    title: lang === 'en' ? 'All Command Categories' : lang === 'ja' ? '全コマンドカテゴリ' : 'Semua Kategori Command (13)',
    rows: categoryRows,
  });

  return {
    menuKey: 'main',
    title: 'Freya-san Hub v5.0',
    subtitle: t.menuWelcomeSubtitle,
    buttonText: t.menuListButton,
    footer: t.botFooter,
    sections,
  };
}

function buildCategoryMenu(
  cat: CommandCategory,
  page: number,
  ctx: MenuBuildContext,
): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;

  const list = ALL_COMMANDS.filter((c) => c.category === cat && c.enabled);
  const perPage = 8;
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const slice = list.slice((safePage - 1) * perPage, safePage * perPage);

  const cmdRows: InteractiveMenuRow[] = slice.map((c) => ({
    id: `cmd:help:${c.name}`,
    title: clampTitle(`${p}${c.name}`),
    description: clampDesc(c.description),
    command:
      c.name === 'menu' || c.name === '48group'
        ? `${p}${c.name}`
        : `${p}help ${c.name}`,
    requiredPermission: c.permission === 'owner' ? 'owner' : c.permission === 'group_admin' ? 'group_admin' : 'public',
    actionKind: 'command',
  }));

  const navRows: InteractiveMenuRow[] = [];
  if (safePage > 1) {
    navRows.push({
      id: `menu:category:${cat}:${safePage - 1}`,
      title: clampTitle(t.menuPrevPageTitle),
      description: clampDesc(lang === 'en' ? `Go to page ${safePage - 1} of ${totalPages}` : lang === 'ja' ? `ページ ${safePage - 1}/${totalPages} へ` : `Buka halaman ${safePage - 1} dari ${totalPages}`),
      command: `${p}menu category:${cat}:${safePage - 1}`,
      requiredPermission: cat === 'OWNER' ? 'owner' : 'public',
      actionKind: 'submenu',
    });
  }
  if (safePage < totalPages) {
    navRows.push({
      id: `menu:category:${cat}:${safePage + 1}`,
      title: clampTitle(t.menuNextPageTitle),
      description: clampDesc(lang === 'en' ? `Go to page ${safePage + 1} of ${totalPages}` : lang === 'ja' ? `ページ ${safePage + 1}/${totalPages} へ` : `Lihat halaman ${safePage + 1} dari ${totalPages}`),
      command: `${p}menu category:${cat}:${safePage + 1}`,
      requiredPermission: cat === 'OWNER' ? 'owner' : 'public',
      actionKind: 'submenu',
    });
  }
  navRows.push(backToMainRow(p, lang));

  const headerText =
    lang === 'en'
      ? `*${cat} Category* (Page ${safePage}/${totalPages}, ${list.length} commands)\nTap any command to view usage or run it.`
      : lang === 'ja'
      ? `*${cat} カテゴリ* (${safePage}/${totalPages} ページ・全${list.length}件)\nコマンドを選ぶと使い方を見たり実行できるよ。`
      : `*Kategori ${cat}* (Halaman ${safePage}/${totalPages} · ${list.length} command)\nPilih command di bawah buat lihat panduan atau langsung pakai ya!`;

  return {
    headerText,
    menu: {
      menuKey: `category:${cat}:${safePage}`,
      title: clampTitle(`${CATEGORY_META[cat].icon} ${cat} (${safePage}/${totalPages})`, 24),
      subtitle: formatCategoryDescription(cat, lang),
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [
        {
          title: `${cat} (${safePage}/${totalPages})`,
          rows: cmdRows,
        },
        {
          title: lang === 'en' ? 'Navigation' : lang === 'ja' ? 'ナビゲーション' : 'Navigasi',
          rows: navRows,
        },
      ],
    },
  };
}

function buildGamesMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;

  const soloRows: InteractiveMenuRow[] = [
    { id: 'cmd:bom', title: '💣 Tebak Bom', description: clampDesc('Buka kotak aman satu-satu, awas kena bom!'), command: `${p}bom`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:sloth', title: '🎰 Sloth Virtual', description: clampDesc('Putar 3 simbol acak berhadiah balance virtual'), command: `${p}sloth`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:tebakangka', title: '🔢 Tebak Angka', description: clampDesc('Tebak angka rahasia 1 sampai 100'), command: `${p}tebakangka`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:tebakemoji', title: '🧩 Tebak Emoji', description: clampDesc('Tebak 195+ soal film, lagu & makanan dari emoji'), command: `${p}tebakemoji`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:math', title: '➗ Adu Matematika', description: clampDesc('Hitung cepat sebelum timer server habis'), command: `${p}math`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:suit', title: '✊ Suit Batu/Gunting', description: clampDesc('Main batu gunting kertas lawan bot'), command: `${p}suit batu`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:tictactoe', title: '⭕ Tic Tac Toe', description: clampDesc('Main papan 3x3 lawan AI atau teman'), command: `${p}tictactoe`, requiredPermission: 'public', actionKind: 'command' },
  ];

  const multiRows: InteractiveMenuRow[] = [
    { id: 'cmd:undercover', title: '🕵️ Undercover', description: clampDesc('Deduksi 210+ kata + Mr. White (peran via PM)'), command: `${p}undercover`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:uno', title: '🃏 UNO Arena', description: clampDesc('Main kartu UNO di grup dengan timeout 60 detik'), command: `${p}uno`, requiredPermission: 'public', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:ww2', title: '🐺 Werewolf 2', description: clampDesc('Werewolf klasik mode lanjutan bareng teman'), command: `${p}ww2`, requiredPermission: 'public', requiresGroup: true, actionKind: 'command' },
    { id: 'menu:48group_quiz', title: '🌸 Kuis 48Group', description: clampDesc('MemberQuiz, SongQuiz, Theater & Daily48'), command: `${p}menu 48group_quiz`, requiredPermission: 'public', actionKind: 'submenu' },
    { id: 'cmd:topglobal', title: '🏆 Top Global', description: clampDesc('Lihat papan peringkat global semua pemain'), command: `${p}topglobal`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'menu:category:GAME:1', title: '📋 Semua Game (44)', description: clampDesc('Lihat semua daftar command di kategori GAME'), command: `${p}menu category:GAME:1`, requiredPermission: 'public', actionKind: 'submenu' },
    backToMainRow(p, lang),
  ];

  const headerText =
    lang === 'en'
      ? '*Games & Quizzes Menu*\nPick a game directly to start playing or open the 48Group quizzes!'
      : lang === 'ja'
      ? '*ゲーム＆クイズメニュー*\n遊びたいゲームを選ぶとすぐスタートできるよ！'
      : '*Menu Game & Kuis Freya-san*\nPilih game yang mau langsung kamu mainin di bawah ini ya!';

  return {
    headerText,
    menu: {
      menuKey: 'games',
      title: '🎮 Menu Game & Kuis',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [
        { title: lang === 'en' ? 'Quick & Solo Games' : lang === 'ja' ? 'ソロ＆クイックゲーム' : 'Game Cepat & Kuis', rows: soloRows },
        { title: lang === 'en' ? 'Multiplayer & More' : lang === 'ja' ? 'マルチプレイ＆その他' : 'Multiplayer & Navigasi', rows: multiRows },
      ],
    },
  };
}

function build48GroupMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;

  const headerText =
    '🌸 *48GROUP CENTER — Arsip & Game Resmi*\nSemua info & kuis di sini pakai data resmi terverifikasi. Pilih menu di bawah ya!';

  return {
    headerText,
    menu: {
      menuKey: '48group',
      title: '🌸 48GROUP CENTER',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [
        {
          title: 'Eksplorasi & Database',
          rows: [
            { id: 'menu:48group_level', title: '📊 Difficulty Level 1-3', description: clampDesc('Filter kuis & arsip JKT48 dari era terbaru sampai klasik'), command: `${p}menu 48group_level`, requiredPermission: 'public', actionKind: 'submenu' },
            { id: 'menu:48group_team', title: '🏷️ Team Explorer', description: clampDesc('Jelajahi Old Team (J/KIII/T), New Team & Other'), command: `${p}menu 48group_team`, requiredPermission: 'public', actionKind: 'submenu' },
            { id: 'cmd:jkt48', title: '🇮🇩 Profil JKT48', description: clampDesc('Lihat profil JKT48, jadwal theater & member aktif'), command: `${p}jkt48`, requiredPermission: 'public', actionKind: 'command' },
            { id: 'cmd:akb48', title: '🇯🇵 Profil AKB48', description: clampDesc('Lihat profil AKB48 & sister group resmi'), command: `${p}akb48`, requiredPermission: 'public', actionKind: 'command' },
            { id: 'cmd:member48', title: '🎤 Cari Member 48', description: clampDesc('Cek profil member (contoh default: Freya)'), command: `${p}member48 Freya`, requiredPermission: 'public', actionKind: 'command' },
            { id: 'cmd:theater48', title: '🎭 Arsip Theater', description: clampDesc('Lihat daftar setlist & show theater 48Group'), command: `${p}theater48`, requiredPermission: 'public', actionKind: 'command' },
            { id: 'cmd:istilah48', title: '📖 Kamus Istilah 48', description: clampDesc('Cari arti istilah Jiko, Oshimen, Senbatsu, dll.'), command: `${p}istilah48 oshimen`, requiredPermission: 'public', actionKind: 'command' },
          ],
        },
        {
          title: 'Kuis & Navigasi',
          rows: [
            { id: 'menu:48group_quiz', title: '🧠 Menu Kuis 48Group', description: clampDesc('MemberQuiz, SongQuiz, TheaterChallenge & Daily48'), command: `${p}menu 48group_quiz`, requiredPermission: 'public', actionKind: 'submenu' },
            { id: 'menu:category:48GROUP:1', title: '📋 Semua Cmd 48GROUP', description: clampDesc('Lihat daftar 16 command kategori 48GROUP'), command: `${p}menu category:48GROUP:1`, requiredPermission: 'public', actionKind: 'submenu' },
            backToMainRow(p, lang),
          ],
        },
      ],
    },
  };
}

function build48LevelMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = JKT48_DIFFICULTY_LEVELS.map((lvl) => ({
    id: `cmd:jkt48_level_${lvl.id}`,
    title: clampTitle(lvl.title),
    description: clampDesc(`${lvl.eraCategory} (${lvl.periodRange})`),
    command: `${p}jkt48 level ${lvl.levelOrder}`,
    requiredPermission: 'public',
    actionKind: 'command',
  }));
  rows.push({
    id: 'menu:48group',
    title: clampTitle(t.menuBackTitle),
    description: clampDesc('Balik ke Menu 48GROUP'),
    command: `${p}menu 48group`,
    requiredPermission: 'public',
    actionKind: 'submenu',
  });
  rows.push(backToMainRow(p, lang));

  const headerText = '*Klasifikasi Era & Kesulitan JKT48*\nPilih level buat lihat arsip era dan soal kuisnya:';
  return {
    headerText,
    menu: {
      menuKey: '48group_level',
      title: '📊 JKT48 Level 1-3',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Urutan Level Resmi', rows }],
    },
  };
}

function build48TeamGroupMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = JKT48_TEAM_GROUPS.map((g) => ({
    id: `menu:48group_team:${g.id}`,
    title: clampTitle(`${g.title}`),
    description: clampDesc(g.description),
    command: `${p}jkt48 team ${g.id}`,
    requiredPermission: 'public',
    actionKind: 'command',
  }));
  rows.push({
    id: 'menu:48group',
    title: clampTitle(t.menuBackTitle),
    description: clampDesc('Balik ke Menu 48GROUP'),
    command: `${p}menu 48group`,
    requiredPermission: 'public',
    actionKind: 'submenu',
  });
  rows.push(backToMainRow(p, lang));

  const headerText = '*Team Explorer JKT48 (Old / New / Other)*\nPilih grup team di bawah buat lihat rinciannya:';
  return {
    headerText,
    menu: {
      menuKey: '48group_team',
      title: '🏷️ Team Explorer',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Kategori Team', rows }],
    },
  };
}

function build48TeamDetailMenu(groupId: string, ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const safeGroup = (groupId === 'old' || groupId === 'new' || groupId === 'other' ? groupId : 'old') as 'old' | 'new' | 'other';
  const teams = getTeamsByGroup(safeGroup);
  const rows: InteractiveMenuRow[] = teams.map((tm) => ({
    id: `cmd:jkt48_team_${tm.id}`,
    title: clampTitle(tm.name),
    description: clampDesc(`${tm.eraSummary} — ${tm.historicalStatus}`),
    command: `${p}jkt48 team ${tm.id}`,
    requiredPermission: 'public',
    actionKind: 'command',
  }));
  rows.push({
    id: 'menu:48group_team',
    title: clampTitle(t.menuBackTitle),
    description: clampDesc('Balik ke pilihan kategori Team'),
    command: `${p}menu 48group_team`,
    requiredPermission: 'public',
    actionKind: 'submenu',
  });
  rows.push(backToMainRow(p, lang));

  const headerText = `*Daftar Team JKT48 (${safeGroup.toUpperCase()})*\nPilih team untuk lihat sejarah & detail resminya:`;
  return {
    headerText,
    menu: {
      menuKey: `48group_team:${safeGroup}`,
      title: clampTitle(`🏷️ Team ${safeGroup.toUpperCase()}`),
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: `Team ${safeGroup.toUpperCase()}`, rows }],
    },
  };
}

function build48QuizMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:memberquiz', title: '🎤 Member Quiz', description: clampDesc('Tebak profil, generasi & nickname member 48Group'), command: `${p}memberquiz`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:groupquiz', title: '🏢 Group Quiz', description: clampDesc('Kuis kota basis & sejarah sister group 48'), command: `${p}groupquiz`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:songquiz', title: '🎵 Song & Single Quiz', description: clampDesc('Tebak single, center & tahun rilis terverifikasi'), command: `${p}songquiz`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:theaterchallenge', title: '🎭 Theater Challenge', description: clampDesc('Kuis setlist & lagu pembuka theater 48Group'), command: `${p}theaterchallenge`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:genchallenge', title: '🕰️ Generation Quiz', description: clampDesc('Tantangan sejarah generasi lintas grup'), command: `${p}genchallenge`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:daily48', title: '📅 Daily 48 Challenge', description: clampDesc('Tantangan harian 48Group yang selalu fresh'), command: `${p}daily48`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'menu:48group', title: clampTitle(t.menuBackTitle), description: clampDesc('Balik ke Menu 48GROUP'), command: `${p}menu 48group`, requiredPermission: 'public', actionKind: 'submenu' },
    backToMainRow(p, lang),
  ];

  const headerText = '🧠 *Kuis Interaktif 48GROUP*\nPilih jenis kuis 48Group yang mau kamu coba sekarang:';
  return {
    headerText,
    menu: {
      menuKey: '48group_quiz',
      title: '🧠 Kuis 48Group',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Pilih Mode Kuis', rows }],
    },
  };
}

function buildGroupSettingsMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:welcome_on', title: '👋 Welcome ON', description: clampDesc('Nyalain sambutan otomatis buat member baru'), command: `${p}welcome on`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:welcome_off', title: '👋 Welcome OFF', description: clampDesc('Matiin sambutan otomatis member baru'), command: `${p}welcome off`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:left_on', title: '🚪 Left ON', description: clampDesc('Nyalain pesan perpisahan kalau ada yang keluar'), command: `${p}left on`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:left_off', title: '🚪 Left OFF', description: clampDesc('Matiin pesan perpisahan member keluar'), command: `${p}left off`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:antilink_on', title: '🔗 Anti-Link ON', description: clampDesc('Aktifin proteksi link grup di chat ini'), command: `${p}antilink on`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:antiluar_on', title: '🌍 Anti-Nomor Luar ON', description: clampDesc('Filter nomor luar negeri selain +62'), command: `${p}antiluar on`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:antisticker_on', title: '🚫 Anti-Stiker ON', description: clampDesc('Aktifin filter anti-stiker termasuk stiker bersuara'), command: `${p}antisticker on`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:streakgrup_on', title: '🔥 Streak Grup ON', description: clampDesc('Nyalain streak harian grup (3 user/5 cmd bot)'), command: `${p}streakgrup on`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:streakgrup_status', title: '🔥 Status Streak Grup', description: clampDesc('Cek progres streak grup hari ini'), command: `${p}streakgrup`, requiredPermission: 'public', requiresGroup: true, actionKind: 'command' },
    { id: 'cmd:groupinfo', title: 'ℹ️ Info Grup', description: clampDesc('Lihat status sewa, welcome, anti-sistem & admin grup'), command: `${p}groupinfo`, requiredPermission: 'group_admin', requiresGroup: true, actionKind: 'command' },
    backToMainRow(p, lang),
  ];

  const headerText = `👥 *Pengaturan Grup*${ctx.groupName ? ` (${ctx.groupName})` : ''}\nPilih pengaturan yang mau diubah atau dicek (khusus admin grup & Owner):`;
  return {
    headerText,
    menu: {
      menuKey: 'group_settings',
      title: '👥 Pengaturan Grup',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Kontrol Grup', rows }],
    },
  };
}

function buildBotSettingsMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:lang_id', title: '🇮🇩 Bahasa Indonesia', description: clampDesc('Set bahasa bot ke Indonesia santai nonbaku'), command: `${p}setcommand lang id`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:lang_en', title: '🇺🇸 English Mode', description: clampDesc('Switch bot language to natural English'), command: `${p}setcommand lang en`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:lang_ja', title: '🇯🇵 日本語モード', description: clampDesc('Switch bot language to natural Japanese'), command: `${p}setcommand lang ja`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:autoread_on', title: '🔵 Blue Tick ON', description: clampDesc('Nyalain centang biru otomatis (autoread)'), command: `${p}autoread on`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:autoread_off', title: '⚪ Blue Tick OFF', description: clampDesc('Matiin centang biru otomatis (autoread)'), command: `${p}autoread off`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:listprefix', title: '🔣 Lihat Prefix Aktif', description: clampDesc('Cek 10 prefix bawaan & prefix tambahan'), command: `${p}listprefix`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:status', title: '📈 Status Engine', description: clampDesc('Cek status WhatsApp, database & antrean bot'), command: `${p}status`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'menu:owner', title: '👑 Menu Owner', description: clampDesc('Buka menu kontrol Owner lengkap'), command: `${p}menu owner`, requiredPermission: 'owner', actionKind: 'submenu' },
    backToMainRow(p, lang),
  ];

  const headerText = '⚙️ *Pengaturan Bot (Owner Only)*\nAtur bahasa natural, centang biru, atau cek prefix & engine bot di bawah:';
  return {
    headerText,
    menu: {
      menuKey: 'bot_settings',
      title: '⚙️ Pengaturan Bot',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Bahasa & Fitur Bot', rows }],
    },
  };
}

function buildOwnerMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'menu:bot_settings', title: '⚙️ Pengaturan Bot', description: clampDesc('Ubah bahasa ID/EN/JA & pengaturan Blue Tick'), command: `${p}menu bot_settings`, requiredPermission: 'owner', actionKind: 'submenu' },
    { id: 'cmd:listprefix', title: '🔣 Prefix Manager', description: clampDesc('Lihat daftar prefix aktif & cara tambah/hapus'), command: `${p}listprefix`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:resetprefix_confirm', title: '♻️ Reset 10 Prefix', description: clampDesc('Reset prefix ke 10 bawaan lewat menu konfirmasi'), command: `${p}resetprefix`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:listredeem', title: '🎟️ List Kode Redeem', description: clampDesc('Lihat semua kode redeem & kuota klaim aktif'), command: `${p}listredeem`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:addredeem', title: '➕ Buat Kode Redeem', description: clampDesc('Buka wizard interaktif buat bikin kode redeem baru'), command: `${p}addredeem`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:redeemstats', title: '📊 Statistik Redeem', description: clampDesc('Lihat rekap klaim sukses, gagal & distribusi hadiah'), command: `${p}redeemstats`, requiredPermission: 'owner', actionKind: 'command' },
    { id: 'cmd:listgroup', title: '👥 Daftar Grup Bot', description: clampDesc('Lihat daftar grup terhubung & status sewanya'), command: `${p}listgroup`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:status', title: '🖥️ Status Server', description: clampDesc('Cek kesehatan mesin WhatsApp, SQLite & AI'), command: `${p}status`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'menu:category:OWNER:1', title: '📋 Semua Cmd Owner', description: clampDesc('Jelajahi seluruh command kategori OWNER'), command: `${p}menu category:OWNER:1`, requiredPermission: 'owner', actionKind: 'submenu' },
    backToMainRow(p, lang),
  ];

  const headerText = '👑 *Menu Owner & Admin Freya-san Hub*\nSemua kontrol inti bot ada di daftar ini ya:';
  return {
    headerText,
    menu: {
      menuKey: 'owner',
      title: '👑 Menu Owner & Admin',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Kontrol Owner', rows }],
    },
  };
}

function buildPremiumRedeemMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:cekpremium', title: '⭐ Cek Status Premium', description: clampDesc('Lihat status akun kamu & sisa masa aktif premium'), command: `${p}cekpremium`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:redeem_guide', title: '🎟️ Cara Klaim Redeem', description: clampDesc('Lihat cara klaim kode redeem berhadiah balance & limit'), command: `${p}redeem`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:redeem_demo', title: '🎁 Klaim FREYAHUB50', description: clampDesc('Coba klaim kode sambutan FREYAHUB50 (kalau belum pernah)'), command: `${p}redeem FREYAHUB50`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:listpremium', title: '👑 Daftar Member Prem', description: clampDesc('Lihat daftar akun dengan status premium aktif'), command: `${p}listpremium`, requiredPermission: 'public', actionKind: 'command' },
  ];
  if (ctx.isOwner) {
    rows.push({ id: 'cmd:redeemstats', title: '📊 Statistik Redeem', description: clampDesc('Lihat statistik klaim redeem (Owner only)'), command: `${p}redeemstats`, requiredPermission: 'owner', actionKind: 'command' });
  }
  rows.push(backToMainRow(p, lang));

  const headerText = '🎁 *Menu Premium & Redeem*\nCek status premium atau tukar kode redeem buat dapat hadiah tambahan!';
  return {
    headerText,
    menu: {
      menuKey: 'premium_redeem',
      title: '🎁 Premium & Redeem',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Layanan Premium & Kode', rows }],
    },
  };
}

function buildEconomyMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:profile', title: '🪪 Profil & Balance', description: clampDesc('Cek saldo balance, level, EXP & streak akun kamu'), command: `${p}profile`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:limit', title: '⚡ Cek Sisa Limit', description: clampDesc('Lihat sisa kuota limit command harian kamu'), command: `${p}limit`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:addlimit_guide', title: '➕ Tambah / Kirim Limit', description: clampDesc('Cara beli limit sendiri atau kirim limit ke teman'), command: `${p}addlimit`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:tfbalance_guide', title: '💸 Transfer Balance', description: clampDesc('Lihat cara kirim balance virtual ke teman'), command: `${p}help tfbalance`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:streak_status', title: '🔥 Cek Streak Teman', description: clampDesc('Lihat daftar pasangan streak aktif & cara ajak teman'), command: `${p}streak`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:topglobal', title: '🌍 Top Global', description: clampDesc('Papan peringkat teratas seluruh pengguna bot'), command: `${p}topglobal`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:toplocal', title: '🏘️ Top Lokal Grup', description: clampDesc('Papan peringkat khusus di dalam grup chat aktif'), command: `${p}toplocal`, requiredPermission: 'public', requiresGroup: true, actionKind: 'command' },
    backToMainRow(p, lang),
  ];

  const headerText = '💰 *Menu Ekonomi, Limit & Streak*\nCek profil, isi limit harian, atau lihat leaderboard terbaru di sini:';
  return {
    headerText,
    menu: {
      menuKey: 'economy',
      title: '💰 Ekonomi & Streak',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Akun & Peringkat', rows }],
    },
  };
}

function buildHelpInfoMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:infobot', title: '🤖 Info Bot & Prefix', description: clampDesc('Penjelasan bot, 10 prefix aktif & fitur utama'), command: `${p}infobot`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:ping', title: '📡 Ping Server', description: clampDesc('Uji kecepatan respon bot sekarang'), command: `${p}ping`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:status', title: '📊 Status Layanan', description: clampDesc('Cek kondisi WhatsApp engine, DB, AI & antrean'), command: `${p}status`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:changelog', title: '📝 Changelog v5.0', description: clampDesc('Lihat catatan fitur baru di Freya-san Hub v5.0'), command: `${p}changelog`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:infogempa', title: '🌋 Info Gempa BMKG', description: clampDesc('Cek info gempa terbaru resmi dari BMKG'), command: `${p}infogempa`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:infounsur', title: '🧪 Info Unsur Kimia', description: clampDesc('Contoh cek unsur emas (Au) dari tabel periodik'), command: `${p}infounsur Au`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:folio', title: '📄 Panduan Kertas Folio', description: clampDesc('Lihat cara bikin dokumen folio rapi pakai tag'), command: `${p}folio`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:owner', title: '📞 Kontak Owner', description: clampDesc('Info kontak resmi Owner Freya-san Hub'), command: `${p}owner`, requiredPermission: 'public', actionKind: 'command' },
    backToMainRow(p, lang),
  ];

  const headerText = '❓ *Menu Bantuan & Informasi Publik*\nButuh panduan atau mau cek info cepat? Pilih aja dari daftar di bawah:';
  return {
    headerText,
    menu: {
      menuKey: 'help_info',
      title: '❓ Bantuan & Info',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Panduan & Info', rows }],
    },
  };
}

function buildFeaturesMenu(ctx: MenuBuildContext): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const rows: InteractiveMenuRow[] = [
    { id: 'cmd:brat2', title: '🟩 Stiker #brat2', description: clampDesc('Coba bikin stiker brat teks santai otomatis'), command: `${p}brat2 Halo Freya ✨`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:tolive_guide', title: '📸 Live Photo (#tolive)', description: clampDesc('Cara ubah gambar/video jadi Motion Photo'), command: `${p}help tolive`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:sa_guide', title: '🔊 Sound Sticker (#sa)', description: clampDesc('Cara gabungin stiker WebP animasi + audio Opus'), command: `${p}help stickeraudio`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:nexara', title: '✨ Tanya AI Nexara', description: clampDesc('Contoh tanya AI Nexara soal sejarah JKT48'), command: `${p}nexara Ceritain singkat awal JKT48 dong`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:faketweet', title: '🐦 Mockup Tweet', description: clampDesc('Contoh bikin kartu mockup gaya X/Twitter [SIMULASI]'), command: `${p}faketweet Freya-san | Jangan lupa senyum hari ini!`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:iqcpink', title: '💬 Mockup iPhone Pink', description: clampDesc('Contoh bikin quoted chat gaya iPhone tema pink'), command: `${p}iqcpink -s right Halo warga Hub!`, requiredPermission: 'public', actionKind: 'command' },
    { id: 'cmd:qrcode', title: '📱 Bikin QR Code', description: clampDesc('Contoh ubah teks/link jadi gambar QR Code'), command: `${p}qrcode https://jkt48.com`, requiredPermission: 'public', actionKind: 'command' },
    backToMainRow(p, lang),
  ];

  const headerText = '⚡ *Menu Fitur Cepat Freya-san*\nLangsung coba fitur stiker, media interaktif, AI & mockup di bawah ini ya:';
  return {
    headerText,
    menu: {
      menuKey: 'features',
      title: '⚡ Fitur Populer',
      subtitle: headerText,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Coba Fitur Cepat', rows }],
    },
  };
}

function buildConfirmMenu(
  target: string,
  ctx: MenuBuildContext,
): { menu: InteractiveMenuPayload; headerText: string } {
  const lang = normalizeBotLang(ctx.lang);
  const t = botText(lang);
  const p = ctx.prefix;
  const parts = target.split(':');
  const actionKey = (parts[1] || '').toLowerCase();
  const payload = parts.slice(2).join(':').trim();

  let title = '⚠️ Konfirmasi Aksi';
  let detail = 'Pastikan kamu beneran mau lanjutin aksi ini ya.';
  let yesCmd = `${p}menu`;
  let perm: 'public' | 'group_admin' | 'owner' = 'public';

  if (actionKey === 'resetprefix') {
    title = '♻️ Reset 10 Prefix?';
    detail = 'Prefix tambahan bakal dihapus dan dibalikin ke 10 prefix bawaan. Lanjut?';
    yesCmd = `${p}resetprefix confirm`;
    perm = 'owner';
  } else if (actionKey === 'redeemreset' && payload) {
    title = `♻️ Reset ${payload}?`;
    detail = `Hitungan klaim kode *${payload}* bakal direset ke 0 (log lama tetap aman). Lanjut?`;
    yesCmd = `${p}redeemreset ${payload} confirm`;
    perm = 'owner';
  } else if (actionKey === 'delredeem' && payload) {
    title = `🗑️ Hapus ${payload}?`;
    detail = `Kode *${payload}* bakal dihapus dari daftar aktif (riwayat klaim lama tetap aman). Lanjut?`;
    yesCmd = `${p}delredeem ${payload} confirm`;
    perm = 'owner';
  } else if (actionKey === 'nyerah') {
    title = '🏳️ Nyerah dari Game?';
    detail = 'Sesi game yang lagi jalan di chat ini bakal langsung selesai. Yakin mau nyerah?';
    yesCmd = `${p}nyerah`;
    perm = 'public';
  }

  const rows: InteractiveMenuRow[] = [
    {
      id: `confirm:yes:${actionKey}:${payload}`,
      title: clampTitle(t.menuConfirmYes),
      description: clampDesc(detail),
      command: yesCmd,
      requiredPermission: perm,
      actionKind: 'confirm_yes',
    },
    {
      id: `confirm:cancel:${actionKey}`,
      title: clampTitle(t.menuConfirmCancel),
      description: clampDesc('Batalkan aksi ini dan nggak ada data yang diubah'),
      command: '',
      requiredPermission: 'public',
      actionKind: 'confirm_cancel',
    },
    backToMainRow(p, lang),
  ];

  return {
    headerText: `*${title}*\n${detail}\nPilih opsi konfirmasi di daftar atau balas angka *1* (Ya) / *2* (Batal).`,
    menu: {
      menuKey: target,
      title: clampTitle(title),
      subtitle: detail,
      buttonText: t.menuListButton,
      footer: t.botFooter,
      sections: [{ title: 'Konfirmasi Tindakan', rows }],
    },
  };
}

export function formatMenuFallbackText(menu: InteractiveMenuPayload, headerText: string, lang?: string | null): string {
  const t = botText(lang);
  const lines: string[] = [headerText, ''];
  let idx = 1;
  for (const sec of menu.sections) {
    lines.push(`*${sec.title}*`);
    for (const row of sec.rows) {
      lines.push(`${idx}. *${row.title}* — ${row.description}`);
      idx += 1;
    }
    lines.push('');
  }
  lines.push(t.menuFallbackHint);
  lines.push(`_${t.botFooter}_`);
  return lines.join('\n').trim();
}

export function issueMenuSession(params: {
  chatId: string;
  userPhone: string;
  chatScope: 'private' | 'group';
  menu: InteractiveMenuPayload;
  ttlSeconds?: number;
}): InteractiveMenuPayload {
  const ttlSec = Math.max(60, params.ttlSeconds ?? 600);
  const id = `ms-${crypto.randomBytes(6).toString('hex')}`;
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

  // Flatten rows with 1-based fallback index and clear expired sessions opportunistically
  const flatRows = params.menu.sections.flatMap((s) => s.rows);
  db.prepare(`DELETE FROM whatsapp_menu_sessions WHERE expires_at < ?`).run(new Date().toISOString());
  db.prepare(`
    INSERT INTO whatsapp_menu_sessions (id, chat_id, user_phone, chat_scope, menu_key, rows_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chatId,
    params.userPhone,
    params.chatScope,
    params.menu.menuKey,
    JSON.stringify(flatRows),
    expiresAt,
  );

  return {
    ...params.menu,
    sessionId: id,
  };
}

export function resolveMenuSelection(params: {
  chatId: string;
  userPhone: string;
  chatScope: 'private' | 'group';
  selectedRowId?: string;
  rawText: string;
  isOwner: boolean;
  isGroupAdmin: boolean;
  prefix: string;
  lang?: string | null;
}): MenuResolutionResult {
  const lang = normalizeBotLang(params.lang);
  const t = botText(lang);
  const nowIso = new Date().toISOString();
  const trimmed = params.rawText.trim();
  const isNumericInput = /^\d{1,2}$/.test(trimmed);
  const hasExplicitRowId = Boolean(params.selectedRowId && params.selectedRowId.trim().length > 0);

  if (!hasExplicitRowId && !isNumericInput) {
    return { kind: 'not_menu_input' };
  }

  // Fetch latest menu session for this user+chat
  const latestRow = db
    .prepare(
      `SELECT * FROM whatsapp_menu_sessions
       WHERE chat_id = ? AND user_phone = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(params.chatId, params.userPhone) as
    | { id: string; menu_key: string; rows_json: string; expires_at: string }
    | undefined;

  if (!latestRow) {
    if (hasExplicitRowId) {
      return {
        kind: 'expired',
        message: t.menuSessionExpired(params.prefix),
      };
    }
    return { kind: 'not_menu_input' };
  }

  if (latestRow.expires_at <= nowIso) {
    return {
      kind: 'expired',
      menuKey: latestRow.menu_key,
      message: t.menuSessionExpired(params.prefix),
    };
  }

  let rows: InteractiveMenuRow[] = [];
  try {
    rows = JSON.parse(latestRow.rows_json) as InteractiveMenuRow[];
  } catch {
    rows = [];
  }

  let chosen: InteractiveMenuRow | undefined;
  if (hasExplicitRowId) {
    const wantedId = params.selectedRowId!.trim();
    chosen = rows.find((r) => r.id === wantedId);
    // Also scan recent unexpired sessions in case user tapped an older message in the same chat
    if (!chosen) {
      const recentSessions = db
        .prepare(
          `SELECT menu_key, rows_json FROM whatsapp_menu_sessions
           WHERE chat_id = ? AND user_phone = ? AND expires_at > ?
           ORDER BY created_at DESC, rowid DESC LIMIT 10`,
        )
        .all(params.chatId, params.userPhone, nowIso) as Array<{ menu_key: string; rows_json: string }>;
      for (const s of recentSessions) {
        try {
          const parsed = JSON.parse(s.rows_json) as InteractiveMenuRow[];
          const found = parsed.find((r) => r.id === wantedId);
          if (found) {
            chosen = found;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
    if (!chosen) {
      return {
        kind: 'invalid',
        menuKey: latestRow.menu_key,
        message: t.menuInvalidChoice(params.prefix),
      };
    }
  } else if (isNumericInput) {
    const idx = Number(trimmed);
    if (idx < 1 || idx > rows.length) {
      return {
        kind: 'invalid',
        menuKey: latestRow.menu_key,
        message: t.menuInvalidChoice(params.prefix),
      };
    }
    chosen = rows[idx - 1];
  }

  if (!chosen) {
    return { kind: 'invalid', menuKey: latestRow.menu_key, message: t.menuInvalidChoice(params.prefix) };
  }

  // Strictly re-verify permission & scope server-side
  if (!hasRowPermission(chosen, { isOwner: params.isOwner, isGroupAdmin: params.isGroupAdmin })) {
    return {
      kind: 'denied',
      menuKey: latestRow.menu_key,
      rowTitle: chosen.title,
      requiredPermission: chosen.requiredPermission,
      message: t.menuOptionDenied,
    };
  }
  if (chosen.requiresGroup && params.chatScope !== 'group') {
    return {
      kind: 'denied',
      menuKey: latestRow.menu_key,
      rowTitle: chosen.title,
      requiredPermission: 'public',
      message: t.groupOnly,
    };
  }

  if (chosen.actionKind === 'confirm_cancel') {
    return {
      kind: 'cancelled',
      menuKey: latestRow.menu_key,
      rowTitle: chosen.title,
      message: t.menuCancelled,
    };
  }

  return {
    kind: 'matched_command',
    menuKey: latestRow.menu_key,
    rowTitle: chosen.title,
    commandText: chosen.command,
  };
}

export function buildBaileysListPayload(
  menu: InteractiveMenuPayload,
  bodyText: string,
): Record<string, unknown> {
  return {
    text: bodyText,
    footer: menu.footer,
    title: menu.title,
    buttonText: menu.buttonText,
    sections: menu.sections.map((sec) => ({
      title: clampTitle(sec.title, 24),
      rows: sec.rows.slice(0, 20).map((row) => ({
        title: clampTitle(row.title, 24),
        rowId: row.id,
        description: clampDesc(row.description, 72),
      })),
    })),
  };
}

export function recordMenuFallbackLog(params: {
  chatId: string;
  menuKey: string;
  mode: 'interactive_list' | 'text_fallback';
  reason: string;
  clientInfo?: string;
}): void {
  db.prepare(
    `INSERT INTO menu_fallback_logs (chat_id, menu_key, mode, reason, client_info) VALUES (?, ?, ?, ?, ?)`,
  ).run(params.chatId, params.menuKey, params.mode, params.reason, params.clientInfo ?? null);
}

export function listMenuFallbackLogs(limit = 50): Array<{
  id: number;
  chat_id: string;
  menu_key: string;
  mode: string;
  reason: string;
  client_info: string | null;
  created_at: string;
}> {
  return db
    .prepare(`SELECT * FROM menu_fallback_logs ORDER BY id DESC LIMIT ?`)
    .all(Math.max(1, Math.min(200, limit))) as any[];
}
