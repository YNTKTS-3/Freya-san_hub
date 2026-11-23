import { LanguageCode } from './types';

export interface TranslationPack {
  navFeatures: string;
  navCommands: string;
  nav48Group: string;
  navGames: string;
  navDocs: string;
  navDashboard: string;
  heroTitle: string;
  heroSubtitle: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  statusOnline: string;
  statusOffline: string;
  commandExplorerTitle: string;
  searchPlaceholder: string;
  allCategories: string;
  ownerLoginTitle: string;
  ownerLoginButton: string;
  footerRights: string;
}

export const TRANSLATIONS: Record<LanguageCode, TranslationPack> = {
  id: {
    navFeatures: 'Fitur',
    navCommands: 'Command',
    nav48Group: '48Group Center',
    navGames: 'Game Center',
    navDocs: 'Dokumentasi',
    navDashboard: 'Console Owner',
    heroTitle: 'Platform Bot WhatsApp, Arsip 48Group & Ekosistem Game Terpadu',
    heroSubtitle:
      'Freya-san Hub menyatukan WhatsApp Bot Engine dengan 10 prefix aktif, pusat kecerdasan & arsip terverifikasi 48Group, AI Agent Orchestration, dan sistem permainan multi-pemain dengan pelacakan aktivitas penuh.',
    heroPrimaryCta: 'Buka 48Group Center',
    heroSecondaryCta: 'Jelajahi Command',
    statusOnline: 'Operasional',
    statusOffline: 'Terputus',
    commandExplorerTitle: 'Penjelajah Command Publik',
    searchPlaceholder: 'Cari command, alias, atau deskripsi...',
    allCategories: 'Semua Kategori',
    ownerLoginTitle: 'Akses Console Administrator',
    ownerLoginButton: 'Masuk ke Console',
    footerRights: 'Freya-san Hub v5.0 — WhatsApp Bot Platform Digital.',
  },
  en: {
    navFeatures: 'Features',
    navCommands: 'Commands',
    nav48Group: '48Group Center',
    navGames: 'Game Center',
    navDocs: 'Docs',
    navDashboard: 'Owner Console',
    heroTitle: 'WhatsApp Bot Platform, 48Group Archive & Unified Game System',
    heroSubtitle:
      'Freya-san Hub unifies a resilient WhatsApp Bot Engine with 10 active prefixes, a verified 48Group Intelligence & Archive Center, AI Agent Orchestration, and stateful multiplayer games.',
    heroPrimaryCta: 'Open 48Group Center',
    heroSecondaryCta: 'Explore Commands',
    statusOnline: 'Operational',
    statusOffline: 'Disconnected',
    commandExplorerTitle: 'Public Command Explorer',
    searchPlaceholder: 'Search command, alias, or description...',
    allCategories: 'All Categories',
    ownerLoginTitle: 'Administrator Console Access',
    ownerLoginButton: 'Sign In to Console',
    footerRights: 'Freya-san Hub v5.0 — Digital WhatsApp Bot Platform.',
  },
  ja: {
    navFeatures: '機能',
    navCommands: 'コマンド',
    nav48Group: '48Groupセンター',
    navGames: 'ゲームセンター',
    navDocs: 'ドキュメント',
    navDashboard: '管理コンソール',
    heroTitle: 'WhatsAppボット基盤・48Groupアーカイブ・統合ゲームシステム',
    heroSubtitle:
      'Freya-san Hubは10種類のプレフィックスに対応したWhatsAppボットエンジン、検証済み48Groupデータベース、AIオーケストレーション、マルチプレイゲームを一つの基盤で統合します。',
    heroPrimaryCta: '48Groupセンターを開く',
    heroSecondaryCta: 'コマンド一覧',
    statusOnline: '稼働中',
    statusOffline: '未接続',
    commandExplorerTitle: '公開コマンド検索',
    searchPlaceholder: 'コマンド名・エイリアス・説明を検索...',
    allCategories: 'すべて',
    ownerLoginTitle: '管理者コンソールログイン',
    ownerLoginButton: 'コンソールへ',
    footerRights: 'Freya-san Hub v5.0 — デジタルWhatsAppボットプラットフォーム',
  },
};
