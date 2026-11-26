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
    navDocs: 'Panduan',
    navDashboard: 'Console Owner',
    heroTitle: 'Hub Bot WhatsApp, Arsip 48Group & Game Seru dalam Satu Tempat',
    heroSubtitle:
      'Freya-san Hub nyatuin mesin WhatsApp Bot dengan 10 prefix aktif, pusat arsip & kuis terverifikasi 48Group, AI Nexara, sampai game multiplayer lengkap.',
    heroPrimaryCta: 'Buka 48Group Center',
    heroSecondaryCta: 'Lihat Semua Command',
    statusOnline: 'Aktif',
    statusOffline: 'Lagi Putus',
    commandExplorerTitle: 'Daftar Command Publik',
    searchPlaceholder: 'Cari command, alias, atau fungsinya...',
    allCategories: 'Semua Kategori',
    ownerLoginTitle: 'Masuk ke Console Owner',
    ownerLoginButton: 'Masuk Console',
    footerRights: 'Freya-san Hub v5.0 — Platform Bot WhatsApp & Komunitas.',
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
    navDocs: 'ガイド',
    navDashboard: '管理コンソール',
    heroTitle: 'WhatsAppボット基盤・48Groupアーカイブ・統合ゲームシステム',
    heroSubtitle:
      'Freya-san Hubは10種類のプレフィックスに対応したWhatsAppボット、検証済み48Groupデータベース、AI機能、マルチプレイゲームをひとつにまとめたプラットフォームだよ。',
    heroPrimaryCta: '48Groupセンターを開く',
    heroSecondaryCta: 'コマンド一覧',
    statusOnline: '稼働中',
    statusOffline: '未接続',
    commandExplorerTitle: '公開コマンド検索',
    searchPlaceholder: 'コマンド名や使い方を検索...',
    allCategories: 'すべて',
    ownerLoginTitle: 'オーナーコンソールにログイン',
    ownerLoginButton: 'コンソールへ',
    footerRights: 'Freya-san Hub v5.0 — デジタルWhatsAppボットプラットフォーム',
  },
};
