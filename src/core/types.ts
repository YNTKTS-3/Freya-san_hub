export type LanguageCode = 'id' | 'en' | 'ja';
export type ThemeMode = 'light' | 'dark' | 'system';

export type CommandCategory =
  | 'AI'
  | 'DOWNLOAD'
  | 'GAME'
  | 'GENERAL'
  | 'GROUP'
  | 'INFO'
  | 'OWNER'
  | 'RANDOM'
  | 'SEARCH'
  | 'STICKER'
  | 'TEXTMAKER'
  | 'TOOLS'
  | '48GROUP';

export type CommandStatus =
  | 'active'
  | 'inactive'
  | 'pending_specification'
  | 'pending_integration'
  | 'under_testing'
  | 'failed'
  | 'deprecated';

export type CommandPermission = 'public' | 'premium' | 'group_admin' | 'owner';

export interface CommandDefinition {
  name: string;
  aliases: string[];
  category: CommandCategory;
  description: string;
  example: string;
  permission: CommandPermission;
  status: CommandStatus;
  enabled: boolean;
  cooldownSec: number;
  dailyLimit: number;
  balanceReward: number;
  expReward: number;
  requiredProvider?: string | null;
  requiredPlugin?: string | null;
  hasRealHandler: boolean;
  isOwnerOnly: boolean;
  notes?: string;
  sourceCorrection?: string;
}

export interface CommandAuditRow {
  category: CommandCategory;
  sourceCount: number;
  registryCount: number;
  realHandlerCount: number;
  pendingCount: number;
  status: string;
}

export interface ParsedCommandInput {
  isCommand: boolean;
  prefix: string | null;
  hadSpaceAfterPrefix: boolean;
  commandName: string;
  rawArgs: string;
  args: string[];
  mentions: string[];
  hasReply: boolean;
  hasMedia: boolean;
}

export type GameSessionStatus =
  | 'waiting'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type GameChatScope = 'private' | 'group';
export type GameHubDomain = 'general' | '48group';

export interface GameDefinition {
  id: string;
  name: string;
  domain: GameHubDomain;
  category: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultDurationSec: number;
  cooldownSec: number;
  enabled: boolean;
  isMultiplayer: boolean;
}

export interface VerificationStatus {
  status: 'official_verified' | 'pending_review' | 'unconfirmed' | 'rumor';
  sourceTitle: string;
  sourceUrl: string;
  publishedAt: string | null;
  retrievedAt: string;
  reviewedBy?: string | null;
}

export type Jkt48DifficultyLevelId = 'level_1' | 'level_2' | 'level_3';
export type Jkt48TeamGroupId = 'old' | 'new' | 'other';

export interface Jkt48DifficultyMeta {
  id: Jkt48DifficultyLevelId;
  levelOrder: 1 | 2 | 3;
  title: string;
  difficultyLabel: string;
  eraCategory: string;
  periodRange: string;
  description: string;
  verificationStatus: 'official_verified' | 'partial_unverified';
  sourceTitle: string;
  sourceUrl: string;
}

export interface Jkt48TeamMeta {
  id: string;
  teamGroup: Jkt48TeamGroupId;
  name: string;
  historicalStatus: string;
  eraSummary: string;
  description: string;
  verificationStatus: 'official_verified' | 'partial_unverified';
  sourceTitle: string;
  sourceUrl: string;
  sortOrder: number;
}

export type RedeemClaimStatus = 'success' | 'failed' | 'rejected' | 'expired' | 'cancelled';

export interface RewardParamSpec {
  key: string;
  label: string;
  type: 'number' | 'string';
  required: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
}

export interface RewardRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: 'economy' | 'membership' | 'achievement' | 'utility';
  handlerKey: string;
  hasRealHandler: boolean;
  version: string;
  terms: string;
  paramsSchema: RewardParamSpec[];
}

export interface ConfiguredAdditionalReward {
  rewardId: string;
  params: Record<string, string | number>;
}

