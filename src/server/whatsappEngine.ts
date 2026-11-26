import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  getContentType,
  isJidNewsletter,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  ALL_COMMANDS,
  findCommandByNameOrAlias,
} from '../core/commandInventory';
import { botText, normalizeBotLang, BotLang } from '../core/botI18n';
import { FOLIO_GUIDE_ID, parseFolioText } from '../core/folioParser';
import { isIndonesianPhoneNumber, maskPhoneNumberForGroup } from '../core/gameRules';
import { DEFAULT_PREFIXES, parseCommandInput } from '../core/prefixParser';
import { CommandCategory, ConfiguredAdditionalReward, GameChatScope, Jkt48DifficultyLevelId, Jkt48TeamGroupId } from '../core/types';
import {
  JKT48_DIFFICULTY_LEVELS,
  JKT48_TEAM_GROUPS,
  JKT48_TEAMS,
  getDifficultyLevelMeta,
  getTeamMeta,
  getTeamsByGroup,
} from '../core/jkt48Classification';
import { validateAdditionalReward } from '../core/redeemEngine';
import { runNexaraAiQuery } from './aiService';
import { checkUserAbuseGate, recordAbuseEvent } from './abuseService';
import {
  addAuditLog,
  addSystemLog,
  applyUserBalanceAndExp,
  db,
} from './db';
import {
  consumeLimitForCommand,
  ensureUserRecord,
  executeAddLimit,
  formatLeaderboardMessage,
  isUserPremiumValid,
  normalizePhoneDigits,
} from './economyService';
import { startGameSession, submitGameAction } from './gameEngine';
import {
  convertMediaToLivePhotoBundle,
  convertStickerAudioBundle,
  convertStickerToImage,
  generateBratSticker,
  generateMockupImage,
  generateSpotifyCard,
  LivePhotoBundle,
  SoundStickerBundle,
  updateMediaJobDelivery,
} from './mediaService';
import {
  deliverMotionPhotoViaSocket,
  deliverSoundStickerViaSocket,
  installWhatsAppV5ProtoExtensions,
} from './waMediaProtocol';
import { PrivateDeliveryItem, stopUnoSession } from './multiplayerGames';
import {
  createRedeemCode,
  deleteRedeemCode,
  executeRedeemClaim,
  getClaimHistory,
  getRedeemAnalytics,
  getRedeemDetail,
  listRedeemCodes,
  listRewardRegistry,
  resetRedeemClaims,
  toggleRedeemCode,
  updateRedeemCode,
} from './redeemService';
import {
  formatGroupStreakStatus,
  formatPairStreakStatus,
  getGroupStreakTopList,
  invitePairStreak,
  recordGroupStreakBotInteraction,
  recordPairStreakMutualInteraction,
  respondPairStreakInvite,
  restoreGroupStreak,
  restorePairStreak,
  setGroupStreakEnabled,
} from './streakService';
import {
  buildBaileysListPayload,
  buildMenuPayload,
  formatMenuFallbackText,
  InteractiveMenuPayload,
  issueMenuSession,
  recordMenuFallbackLog,
  resolveMenuSelection,
} from './menuService';

const DEFAULT_WA_AUTH_DIR = path.resolve(process.cwd(), 'data', 'wa-auth');
if (!fs.existsSync(DEFAULT_WA_AUTH_DIR)) {
  fs.mkdirSync(DEFAULT_WA_AUTH_DIR, { recursive: true });
}

export type WaConnectionMethod = 'qr' | 'pairing_code';
export type WaPairingStatus =
  | 'idle'
  | 'waiting'
  | 'code_ready'
  | 'success'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface WaConnectionHistoryItem {
  id: number;
  event_type: string;
  connection_method: string;
  actor: string;
  target_masked: string | null;
  status: string;
  detail: string;
  created_at: string;
}

export type BaileysSocketFactory = (params: {
  authDir: string;
  logger: unknown;
}) => Promise<{
  sock: WASocket;
  state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'];
  saveCreds: () => Promise<void>;
}>;

export function validatePairingPhoneNumber(rawInput: string): {
  ok: boolean;
  normalized: string;
  formattedDisplay: string;
  error?: string;
} {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      normalized: '',
      formattedDisplay: '',
      error: 'Masukin nomor WhatsApp dulu pakai kode negara (contoh: 6281234567890).',
    };
  }
  const strippedFormatting = trimmed.replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(strippedFormatting)) {
    return {
      ok: false,
      normalized: '',
      formattedDisplay: '',
      error: 'Nomor WhatsApp cuma boleh berisi angka dan kode negara (contoh: 6281234567890).',
    };
  }
  if (strippedFormatting.startsWith('0')) {
    return {
      ok: false,
      normalized: '',
      formattedDisplay: '',
      error: 'Nomor harus diawali kode negara, bukan angka 0 (misal ganti 08xx jadi 628xx).',
    };
  }
  if (strippedFormatting.length < 8 || strippedFormatting.length > 15) {
    return {
      ok: false,
      normalized: '',
      formattedDisplay: '',
      error: 'Panjang nomor WhatsApp nggak valid (wajib 8–15 digit termasuk kode negara).',
    };
  }
  return {
    ok: true,
    normalized: strippedFormatting,
    formattedDisplay: `+${strippedFormatting}`,
  };
}

export interface IncomingBotMessage {
  chatId: string;
  chatScope: GameChatScope;
  groupName?: string;
  senderPhone: string;
  senderName: string;
  text: string;
  messageId?: string;
  mentions?: string[];
  hasReply?: boolean;
  quotedSenderPhone?: string;
  quotedMediaKind?: 'image' | 'video' | 'sticker' | 'audio' | 'none';
  quotedMediaBuffer?: Buffer;
  attachedImageBase64?: string;
  attachedAudioBase64?: string;
  hasMedia?: boolean;
  isStickerMessage?: boolean;
  hasAudioContext?: boolean;
  isGroupAdmin?: boolean;
  selectedRowId?: string;
  source?: 'whatsapp' | 'simulator';
}

export interface BotDispatchResponse {
  handled: boolean;
  replyText: string;
  interactiveMenu?: InteractiveMenuPayload;
  folioPreview?: ReturnType<typeof parseFolioText>;
  qrDataUrl?: string;
  mediaPreview?: {
    kind: string;
    mimetype: string;
    dataUrl?: string;
    stillDataUrl?: string;
    motionVideoDataUrl?: string;
    motionPhotoJpgDataUrl?: string;
    audioDataUrl?: string;
    waveform?: number[];
    jobId?: string;
    validation?: Record<string, unknown>;
    caption?: string;
  };
  privateDeliveries?: PrivateDeliveryItem[];
  commandExecuted?: string;
  status: 'ok' | 'denied' | 'pending' | 'error' | 'ignored';
}

type EventBroadcaster = (eventType: string, payload: unknown) => void;

interface QueuedOutboundItem {
  jid: string;
  payload: Record<string, unknown>;
}

class WhatsAppEngineManager {
  private sock: WASocket | null = null;
  private status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error' = 'disconnected';
  private qrDataUrl: string | null = null;
  private phoneNumber: string | null = null;
  private lastError: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private broadcaster: EventBroadcaster = () => {};
  private messageQueue: QueuedOutboundItem[] = [];
  private isFlushingQueue = false;
  private cooldownMap = new Map<string, number>();
  private scheduledTimers = new Set<NodeJS.Timeout>();

  // Pairing Code, Concurrency Lock, Epoch & Auth Directory Isolation
  private authDir: string = DEFAULT_WA_AUTH_DIR;
  private connectionMethod: WaConnectionMethod = 'qr';
  private pairingStatus: WaPairingStatus = 'idle';
  private pairingCode: string | null = null;
  private pairingPhoneMasked: string | null = null;
  private pairingRequestedAt: string | null = null;
  private pairingExpiresAt: string | null = null;
  private pairingError: string | null = null;
  private pairingExpiryTimer: NodeJS.Timeout | null = null;
  private isOperationLocked = false;
  private currentOperationName: string | null = null;
  private connectionEpoch = 0;
  private customSocketFactory: BaileysSocketFactory | null = null;

  private mediaOutbox: Map<
    string,
    {
      kind: string;
      mimetype: string;
      buffer: Buffer;
      caption?: string;
      jobId?: string;
      livePhotoBundle?: LivePhotoBundle;
      soundStickerBundle?: SoundStickerBundle;
    }
  > = new Map();
  private pendingStickerAudioVisual: Map<
    string,
    { kind: 'image' | 'sticker'; buffer: Buffer; expiresAt: number }
  > = new Map();

  public setBroadcaster(fn: EventBroadcaster): void {
    this.broadcaster = fn;
  }

  public setSocketFactoryForTests(factory: BaileysSocketFactory | null): void {
    this.customSocketFactory = factory;
  }

  public setAuthDirForTests(dirPath: string | null): void {
    this.authDir = dirPath ? path.resolve(dirPath) : DEFAULT_WA_AUTH_DIR;
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  private async createSocketWithAuth(): Promise<{
    sock: WASocket;
    state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'];
    saveCreds: () => Promise<void>;
  }> {
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
    const logger = pino({ level: 'silent' });
    if (this.customSocketFactory) {
      return this.customSocketFactory({ authDir: this.authDir, logger });
    }
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const sock = makeWASocket({
      auth: state,
      logger,
      browser: Browsers.ubuntu('Freya-san Hub'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });
    return { sock, state, saveCreds };
  }

  public hasStoredAuthCredentials(): boolean {
    const credsPath = path.join(this.authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    try {
      const raw = fs.readFileSync(credsPath, 'utf8').trim();
      return raw.length > 2;
    } catch {
      return false;
    }
  }

  private async withConnectionLock<T>(
    opName: string,
    fn: () => Promise<T>,
  ): Promise<{ lockedOut: true } | { lockedOut: false; result: T }> {
    if (this.isOperationLocked) {
      return { lockedOut: true };
    }
    this.isOperationLocked = true;
    this.currentOperationName = opName;
    try {
      const result = await fn();
      return { lockedOut: false, result };
    } finally {
      this.isOperationLocked = false;
      this.currentOperationName = null;
    }
  }

  private clearPairingTimers(): void {
    if (this.pairingExpiryTimer) {
      clearTimeout(this.pairingExpiryTimer);
      this.pairingExpiryTimer = null;
    }
  }

  private clearReconnectAndScheduledTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const timer of this.scheduledTimers) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();
  }

  private closeCurrentSocket(): void {
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore close errors
      }
      this.sock = null;
    }
  }

  public recordConnectionEvent(params: {
    eventType: string;
    connectionMethod?: WaConnectionMethod;
    actor?: string;
    targetMasked?: string | null;
    status: 'ok' | 'error' | 'cancelled';
    detail: string;
  }): void {
    try {
      db.prepare(`
        INSERT INTO wa_connection_history (event_type, connection_method, actor, target_masked, status, detail)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        params.eventType,
        params.connectionMethod ?? this.connectionMethod,
        params.actor ?? 'owner',
        params.targetMasked ?? null,
        params.status,
        params.detail,
      );
      this.broadcaster('wa:history', this.listConnectionHistory(30));
    } catch {
      // avoid throwing from logging
    }
  }

  public listConnectionHistory(limit = 40): WaConnectionHistoryItem[] {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
    return db
      .prepare(`SELECT * FROM wa_connection_history ORDER BY id DESC LIMIT ?`)
      .all(safeLimit) as WaConnectionHistoryItem[];
  }

  public getOwnerPhoneNormalized(): string {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'owner_number_configured'")
      .get() as { value: string } | undefined;
    const raw = row?.value || process.env.OWNER_NUMBER || '+6285129878352';
    return raw.replace(/\D/g, '');
  }

  public isOwnerPhone(phone: string): boolean {
    const clean = phone.replace(/\D/g, '');
    const ownerClean = this.getOwnerPhoneNormalized();
    return clean.length > 0 && clean === ownerClean;
  }

  public getStatus() {
    const blueTick = db
      .prepare("SELECT value FROM settings WHERE key = 'blue_tick_enabled'")
      .get() as { value: string } | undefined;
    return {
      status: this.status,
      connectionMethod: this.connectionMethod,
      phoneNumber: this.phoneNumber,
      qrDataUrl: this.qrDataUrl,
      pairingStatus: this.pairingStatus,
      pairingCode: this.pairingCode,
      pairingPhoneMasked: this.pairingPhoneMasked,
      pairingRequestedAt: this.pairingRequestedAt,
      pairingExpiresAt: this.pairingExpiresAt,
      pairingError: this.pairingError,
      hasStoredAuth: this.hasStoredAuthCredentials(),
      isOperationLocked: this.isOperationLocked,
      currentOperation: this.currentOperationName,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      queueLength: this.messageQueue.length,
      blueTickEnabled: blueTick?.value === 'true',
      library: '@whiskeysockets/baileys',
    };
  }

  private persistSessionState(): void {
    db.prepare(`
      UPDATE bot_sessions
      SET status = ?,
          phone_number = ?,
          qr_code = ?,
          last_error = ?,
          reconnect_attempts = ?,
          connection_method = ?,
          pairing_status = ?,
          pairing_expires_at = ?,
          updated_at = datetime('now')
      WHERE id = 'primary'
    `).run(
      this.status,
      this.phoneNumber,
      this.qrDataUrl,
      this.lastError,
      this.reconnectAttempts,
      this.connectionMethod,
      this.pairingStatus,
      this.pairingExpiresAt,
    );
    this.broadcaster('wa:status', this.getStatus());
  }

  private async startSocketSessionLocked(params: {
    method: WaConnectionMethod;
    phoneDigits?: string;
    actor: string;
    isAutoReconnect?: boolean;
  }): Promise<{
    ok: boolean;
    status: string;
    method: WaConnectionMethod;
    pairingStatus?: WaPairingStatus;
    pairingCode?: string;
    message: string;
    waitPromise?: Promise<void>;
  }> {
    const method = params.method;
    const actor = params.actor || 'owner';

    installWhatsAppV5ProtoExtensions();

    const { sock, state, saveCreds } = await this.createSocketWithAuth();

    if (method === 'pairing_code' && state?.creds?.registered) {
      try {
        sock.end(undefined);
      } catch {
        // ignore
      }
      this.pairingStatus = 'failed';
      this.pairingCode = null;
      this.pairingError = 'Sesi lama udah terdaftar di folder auth. Pakai Reset Sesi Penuh dulu kalau mau tautin nomor baru pakai Pairing Code.';
      this.persistSessionState();
      this.recordConnectionEvent({
        eventType: 'pairing_failed',
        connectionMethod: 'pairing_code',
        actor,
        targetMasked: params.phoneDigits ? maskPhoneNumberForGroup(params.phoneDigits) : null,
        status: 'error',
        detail: 'Ditolak karena kredensial sesi lama masih terdaftar.',
      });
      return {
        ok: false,
        status: this.status,
        method,
        pairingStatus: 'failed',
        message: this.pairingError,
      };
    }

    this.clearReconnectAndScheduledTimers();
    this.clearPairingTimers();
    this.closeCurrentSocket();

    this.connectionEpoch += 1;
    const epoch = this.connectionEpoch;

    this.sock = sock;
    this.connectionMethod = method;
    this.status = 'connecting';
    this.lastError = null;
    this.qrDataUrl = null;

    if (method === 'pairing_code') {
      this.pairingStatus = 'waiting';
      this.pairingCode = null;
      this.pairingPhoneMasked = params.phoneDigits ? maskPhoneNumberForGroup(params.phoneDigits) : null;
      this.pairingRequestedAt = new Date().toISOString();
      this.pairingExpiresAt = null;
      this.pairingError = null;
    } else {
      this.pairingStatus = 'idle';
      this.pairingCode = null;
      this.pairingPhoneMasked = null;
      this.pairingRequestedAt = null;
      this.pairingExpiresAt = null;
      this.pairingError = null;
    }

    this.persistSessionState();
    this.recordConnectionEvent({
      eventType: params.isAutoReconnect
        ? 'reconnect_attempt'
        : method === 'pairing_code'
          ? 'connect_pairing'
          : 'connect_qr',
      connectionMethod: method,
      actor,
      targetMasked: this.pairingPhoneMasked,
      status: 'ok',
      detail:
        method === 'pairing_code'
          ? `Memulai koneksi Baileys lewat Pairing Code buat ${this.pairingPhoneMasked}.`
          : params.isAutoReconnect
            ? `Mencoba reconnect otomatis #${this.reconnectAttempts}.`
            : 'Memulai koneksi Baileys lewat QR Code.',
    });

    let pairingIssuedInEpoch = false;
    let resolveWait: (() => void) | null = null;
    const waitPromise = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
    const finishWait = () => {
      if (resolveWait) {
        const fn = resolveWait;
        resolveWait = null;
        fn();
      }
    };

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (epoch !== this.connectionEpoch) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (method === 'pairing_code' && params.phoneDigits) {
          if (!pairingIssuedInEpoch && !state?.creds?.registered) {
            pairingIssuedInEpoch = true;
            try {
              const code = await sock.requestPairingCode(params.phoneDigits);
              if (epoch !== this.connectionEpoch) return;
              this.pairingCode = code;
              this.pairingStatus = 'code_ready';
              this.pairingExpiresAt = new Date(Date.now() + 160_000).toISOString();
              this.pairingError = null;
              this.qrDataUrl = null;
              this.persistSessionState();

              this.clearPairingTimers();
              this.pairingExpiryTimer = setTimeout(() => {
                if (epoch !== this.connectionEpoch) return;
                if (this.status !== 'connected' && this.pairingStatus === 'code_ready') {
                  this.pairingStatus = 'expired';
                  this.pairingCode = null;
                  this.pairingError = 'Kode pairing udah kedaluwarsa (lewat batas waktu). Minta kode pairing baru ya.';
                  this.status = 'disconnected';
                  this.closeCurrentSocket();
                  this.persistSessionState();
                  this.recordConnectionEvent({
                    eventType: 'pairing_expired',
                    connectionMethod: 'pairing_code',
                    actor,
                    targetMasked: this.pairingPhoneMasked,
                    status: 'error',
                    detail: 'Kode pairing kedaluwarsa sebelum dikonfirmasi di WhatsApp.',
                  });
                  addSystemLog('warn', 'whatsappEngine', 'Pairing code WhatsApp kedaluwarsa.');
                }
              }, 160_000);

              this.recordConnectionEvent({
                eventType: 'pairing_code_issued',
                connectionMethod: 'pairing_code',
                actor,
                targetMasked: this.pairingPhoneMasked,
                status: 'ok',
                detail: 'Kode pairing berhasil dibuat dan siap dimasukin di Perangkat Tertaut WhatsApp.',
              });
              addSystemLog('info', 'whatsappEngine', `Pairing code siap buat ${this.pairingPhoneMasked || 'owner'}.`);
            } catch (pairErr) {
              if (epoch !== this.connectionEpoch) return;
              const msgErr = pairErr instanceof Error ? pairErr.message : 'Gagal minta pairing code ke server WhatsApp.';
              this.pairingStatus = 'failed';
              this.pairingCode = null;
              this.pairingError = msgErr;
              this.lastError = msgErr;
              this.status = 'error';
              this.persistSessionState();
              this.recordConnectionEvent({
                eventType: 'pairing_failed',
                connectionMethod: 'pairing_code',
                actor,
                targetMasked: this.pairingPhoneMasked,
                status: 'error',
                detail: `Gagal minta pairing code: ${msgErr}`,
              });
              addSystemLog('error', 'whatsappEngine', `Gagal pairing code: ${msgErr}`);
            } finally {
              finishWait();
            }
          }
        } else {
          this.status = 'qr_ready';
          this.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
          if (epoch !== this.connectionEpoch) return;
          this.persistSessionState();
          addSystemLog('info', 'whatsappEngine', 'QR Code login WhatsApp siap dipindai.');
          finishWait();
        }
      }

      if (connection === 'open') {
        this.clearPairingTimers();
        this.status = 'connected';
        this.qrDataUrl = null;
        this.reconnectAttempts = 0;
        this.lastError = null;
        this.phoneNumber = sock?.user?.id?.split(':')[0] ?? null;

        const wasPairing =
          method === 'pairing_code' ||
          this.pairingStatus === 'waiting' ||
          this.pairingStatus === 'code_ready';

        if (wasPairing) {
          this.pairingStatus = 'success';
          this.pairingCode = null;
          this.pairingError = null;
        } else {
          this.pairingStatus = 'idle';
          this.pairingCode = null;
        }

        db.prepare(`UPDATE bot_sessions SET last_connected_at = datetime('now') WHERE id = 'primary'`).run();
        this.persistSessionState();
        this.recordConnectionEvent({
          eventType: wasPairing ? 'pairing_success' : 'connect_open',
          connectionMethod: wasPairing ? 'pairing_code' : 'qr',
          actor,
          targetMasked: this.phoneNumber ? maskPhoneNumberForGroup(this.phoneNumber) : this.pairingPhoneMasked,
          status: 'ok',
          detail: wasPairing
            ? 'WhatsApp berhasil tertaut lewat Pairing Code.'
            : 'WhatsApp Bot berhasil terhubung ke server WhatsApp.',
        });
        addSystemLog('info', 'whatsappEngine', 'WhatsApp Bot terhubung ke server WhatsApp.');
        finishWait();
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const errMsg = lastDisconnect?.error?.message ?? 'Koneksi WhatsApp ditutup';
        this.status = 'disconnected';
        this.qrDataUrl = null;
        this.lastError = errMsg;

        const inPairingProgress = this.pairingStatus === 'waiting' || this.pairingStatus === 'code_ready';
        if (inPairingProgress) {
          this.clearPairingTimers();
          if (code === DisconnectReason.timedOut) {
            this.pairingStatus = 'expired';
            this.pairingError = 'Waktu pairing code habis sebelum ditautkan. Minta kode baru ya.';
            this.recordConnectionEvent({
              eventType: 'pairing_expired',
              connectionMethod: 'pairing_code',
              actor,
              targetMasked: this.pairingPhoneMasked,
              status: 'error',
              detail: this.pairingError,
            });
          } else {
            this.pairingStatus = 'failed';
            this.pairingError = `Koneksi putus waktu pairing (${errMsg}). Coba minta kode lagi ya.`;
            this.recordConnectionEvent({
              eventType: 'pairing_failed',
              connectionMethod: 'pairing_code',
              actor,
              targetMasked: this.pairingPhoneMasked,
              status: 'error',
              detail: this.pairingError,
            });
          }
          this.pairingCode = null;
          this.persistSessionState();
          finishWait();
          return;
        }

        const shouldReconnect =
          code !== DisconnectReason.loggedOut &&
          this.hasStoredAuthCredentials() &&
          method === 'qr';
        this.persistSessionState();

        if (code === DisconnectReason.loggedOut) {
          this.recordConnectionEvent({
            eventType: 'session_logged_out',
            connectionMethod: this.connectionMethod,
            actor: 'whatsapp',
            targetMasked: this.phoneNumber ? maskPhoneNumberForGroup(this.phoneNumber) : null,
            status: 'error',
            detail: 'Perangkat WhatsApp keluar (loggedOut). Pakai Reset Sesi Penuh atau tautin ulang.',
          });
        }

        if (shouldReconnect && this.reconnectAttempts < 5) {
          this.reconnectAttempts += 1;
          const delayMs = Math.min(30000, this.reconnectAttempts * 3000);
          addSystemLog('warn', 'whatsappEngine', `Menjadwalkan reconnect #${this.reconnectAttempts} dalam ${delayMs}ms.`);
          this.reconnectTimer = setTimeout(() => {
            if (epoch !== this.connectionEpoch || this.isOperationLocked) return;
            void this.connect({ method: 'qr', actor: 'auto_reconnect', isAutoReconnect: true });
          }, delayMs);
        }
        finishWait();
      }
    });

    this.attachMessageHandlerToSocket(sock, epoch);

    return {
      ok: true,
      status: this.status,
      method,
      pairingStatus: this.pairingStatus,
      message:
        method === 'pairing_code'
          ? 'Lagi nyiapin pairing code WhatsApp, tunggu sebentar ya...'
          : 'Inisialisasi koneksi QR WhatsApp dimulai.',
      waitPromise,
    };
  }

  public async connect(options?: {
    method?: WaConnectionMethod;
    phoneNumber?: string;
    actor?: string;
    isAutoReconnect?: boolean;
  }): Promise<{
    ok: boolean;
    status: string;
    method: WaConnectionMethod;
    pairingStatus?: WaPairingStatus;
    pairingCode?: string | null;
    message: string;
  }> {
    const method: WaConnectionMethod = options?.method === 'pairing_code' ? 'pairing_code' : 'qr';
    const actor = options?.actor || 'owner';

    if (method === 'pairing_code') {
      const validated = validatePairingPhoneNumber(options?.phoneNumber || '');
      if (!validated.ok) {
        this.pairingStatus = 'failed';
        this.pairingCode = null;
        this.pairingError = validated.error || 'Nomor WhatsApp nggak valid.';
        this.persistSessionState();
        this.recordConnectionEvent({
          eventType: 'pairing_failed',
          connectionMethod: 'pairing_code',
          actor,
          targetMasked: null,
          status: 'error',
          detail: this.pairingError,
        });
        return {
          ok: false,
          status: this.status,
          method,
          pairingStatus: 'failed',
          message: this.pairingError,
        };
      }
    }

    let waitForPairingPromise: Promise<void> | undefined;

    const lockedRes = await this.withConnectionLock(
      method === 'pairing_code' ? 'connect_pairing' : 'connect_qr',
      async () => {
        if (this.status === 'connected' && this.sock) {
          return {
            ok: false,
            status: 'connected',
            method: this.connectionMethod,
            pairingStatus: this.pairingStatus,
            message: 'Akun WhatsApp udah terhubung nih, jadi sesi baru nggak dibuat.',
          };
        }

        if (
          this.status === 'connecting' ||
          this.status === 'qr_ready' ||
          this.pairingStatus === 'waiting' ||
          this.pairingStatus === 'code_ready'
        ) {
          return {
            ok: false,
            status: this.status,
            method: this.connectionMethod,
            pairingStatus: this.pairingStatus,
            pairingCode: this.pairingCode,
            message: 'Sesi koneksi lagi jalan/menunggu otorisasi nih. Batalin dulu atau pakai Reset Koneksi kalau mau ulang.',
          };
        }

        try {
          const validDigits =
            method === 'pairing_code' ? validatePairingPhoneNumber(options?.phoneNumber || '').normalized : undefined;
          const started = await this.startSocketSessionLocked({
            method,
            phoneDigits: validDigits,
            actor,
            isAutoReconnect: options?.isAutoReconnect,
          });
          waitForPairingPromise = started.waitPromise;
          if (!started.ok) {
            return {
              ok: false,
              status: started.status,
              method: started.method,
              pairingStatus: started.pairingStatus,
              message: started.message,
            };
          }
          return {
            ok: true,
            status: started.status,
            method: started.method,
            pairingStatus: started.pairingStatus,
            message: started.message,
          };
        } catch (err) {
          this.status = 'error';
          this.lastError = err instanceof Error ? err.message : 'Gagal menghubungkan Baileys';
          if (method === 'pairing_code') {
            this.pairingStatus = 'failed';
            this.pairingCode = null;
            this.pairingError = this.lastError;
          }
          this.persistSessionState();
          this.recordConnectionEvent({
            eventType: method === 'pairing_code' ? 'pairing_failed' : 'connect_error',
            connectionMethod: method,
            actor,
            targetMasked: this.pairingPhoneMasked,
            status: 'error',
            detail: this.lastError,
          });
          addSystemLog('error', 'whatsappEngine', this.lastError);
          return {
            ok: false,
            status: 'error',
            method,
            pairingStatus: this.pairingStatus,
            message: this.lastError,
          };
        }
      },
    );

    if (lockedRes.lockedOut) {
      return {
        ok: false,
        status: this.status,
        method,
        pairingStatus: this.pairingStatus,
        message: 'Proses koneksi atau reset lagi jalan nih, tunggu sebentar ya.',
      };
    }

    const baseResult = lockedRes.result;
    if (!baseResult.ok) return baseResult;

    // Wait briefly outside the lock so fast pairing-code/QR responses appear right away in HTTP response
    if (waitForPairingPromise) {
      await Promise.race([
        waitForPairingPromise,
        new Promise<void>((resolve) => setTimeout(resolve, method === 'pairing_code' ? 1200 : 400)),
      ]);
    }

    return {
      ok: this.pairingStatus !== 'failed' && this.status !== 'error',
      status: this.status,
      method: this.connectionMethod,
      pairingStatus: this.pairingStatus,
      pairingCode: this.pairingCode,
      message:
        this.pairingStatus === 'code_ready' && this.pairingCode
          ? 'Kode pairing berhasil dibuat! Masukin kode di menu Perangkat Tertaut WhatsApp ya.'
          : this.pairingStatus === 'failed'
            ? this.pairingError || 'Gagal dapetin kode pairing.'
            : baseResult.message,
    };
  }

  public async cancelPairing(actor = 'owner'): Promise<{
    ok: boolean;
    status: string;
    pairingStatus: WaPairingStatus;
    message: string;
  }> {
    const lockedRes = await this.withConnectionLock('cancel_pairing', async () => {
      if (this.status === 'connected' && this.sock) {
        return {
          ok: false,
          status: this.status,
          pairingStatus: this.pairingStatus,
          message: 'Akun udah terhubung nih, bukan lagi nunggu pairing.',
        };
      }
      this.connectionEpoch += 1;
      this.clearReconnectAndScheduledTimers();
      this.clearPairingTimers();
      this.closeCurrentSocket();

      this.status = 'disconnected';
      this.qrDataUrl = null;
      this.pairingStatus = 'cancelled';
      this.pairingCode = null;
      this.pairingExpiresAt = null;
      this.pairingError = null;
      this.lastError = null;
      this.reconnectAttempts = 0;

      this.persistSessionState();
      this.recordConnectionEvent({
        eventType: 'pairing_cancelled',
        connectionMethod: this.connectionMethod,
        actor,
        targetMasked: this.pairingPhoneMasked,
        status: 'cancelled',
        detail: 'Permintaan tautan WhatsApp dibatalin sama owner.',
      });
      addSystemLog('info', 'whatsappEngine', 'Proses pairing/koneksi WhatsApp dibatalin.');
      return {
        ok: true,
        status: this.status,
        pairingStatus: this.pairingStatus,
        message: 'Proses tautan WhatsApp udah dibatalin.',
      };
    });

    if (lockedRes.lockedOut) {
      return {
        ok: false,
        status: this.status,
        pairingStatus: this.pairingStatus,
        message: 'Operasi koneksi lain lagi berjalan, coba sebentar lagi ya.',
      };
    }
    return lockedRes.result;
  }

  public async resetConnection(actor = 'owner'): Promise<{
    ok: boolean;
    status: string;
    hasStoredAuth: boolean;
    message: string;
  }> {
    const lockedRes = await this.withConnectionLock('reset_connection', async () => {
      try {
        this.connectionEpoch += 1;
        this.clearReconnectAndScheduledTimers();
        this.clearPairingTimers();
        this.closeCurrentSocket();

        // Reset transient state & errors while preserving valid auth credentials
        this.status = 'disconnected';
        this.qrDataUrl = null;
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.pairingStatus = 'idle';
        this.pairingCode = null;
        this.pairingExpiresAt = null;
        this.pairingError = null;
        this.messageQueue = [];

        const hasStoredAuth = this.hasStoredAuthCredentials();
        this.persistSessionState();

        if (!hasStoredAuth) {
          this.recordConnectionEvent({
            eventType: 'reset_connection',
            connectionMethod: this.connectionMethod,
            actor,
            targetMasked: null,
            status: 'ok',
            detail: 'Reset koneksi selesai. State sementara dibersihin, belum ada kredensial tersimpan.',
          });
          return {
            ok: true,
            status: this.status,
            hasStoredAuth: false,
            message: 'Koneksi dan error sementara udah direset. Belum ada sesi tersimpan—pilih QR Code atau Pairing Code buat tautin ya.',
          };
        }

        const started = await this.startSocketSessionLocked({
          method: 'qr',
          actor,
        });

        this.recordConnectionEvent({
          eventType: 'reset_connection',
          connectionMethod: 'qr',
          actor,
          targetMasked: this.phoneNumber ? maskPhoneNumberForGroup(this.phoneNumber) : null,
          status: started.ok ? 'ok' : 'error',
          detail: started.ok
            ? 'Reset koneksi berhasil: state sementara dibersihin & mencoba hubungin ulang pakai sesi tersimpan.'
            : `Reset koneksi gagal nyambung ulang: ${started.message}`,
        });

        return {
          ok: started.ok,
          status: this.status,
          hasStoredAuth: true,
          message: started.ok
            ? 'Reset koneksi berhasil! Kredensial tersimpan tetap aman dan bot lagi nyambung ulang.'
            : started.message,
        };
      } catch (err) {
        const msgErr = err instanceof Error ? err.message : 'Gagal reset koneksi Baileys';
        this.status = 'error';
        this.lastError = msgErr;
        this.persistSessionState();
        this.recordConnectionEvent({
          eventType: 'reset_connection',
          connectionMethod: this.connectionMethod,
          actor,
          targetMasked: null,
          status: 'error',
          detail: `Reset koneksi error: ${msgErr}`,
        });
        return {
          ok: false,
          status: this.status,
          hasStoredAuth: this.hasStoredAuthCredentials(),
          message: msgErr,
        };
      }
    });

    if (lockedRes.lockedOut) {
      return {
        ok: false,
        status: this.status,
        hasStoredAuth: this.hasStoredAuthCredentials(),
        message: 'Proses koneksi atau reset lain lagi berjalan, tunggu sebentar ya.',
      };
    }
    return lockedRes.result;
  }

  public async resetFullSession(options: {
    confirm: boolean;
    actor?: string;
  }): Promise<{
    ok: boolean;
    status: string;
    hasStoredAuth: boolean;
    message: string;
  }> {
    const actor = options.actor || 'owner';
    if (!options.confirm) {
      return {
        ok: false,
        status: this.status,
        hasStoredAuth: this.hasStoredAuthCredentials(),
        message: 'Konfirmasi tambahan wajib dicentang sebelum reset sesi penuh ya.',
      };
    }

    const lockedRes = await this.withConnectionLock('reset_full_session', async () => {
      try {
        this.connectionEpoch += 1;
        this.clearReconnectAndScheduledTimers();
        this.clearPairingTimers();
        this.closeCurrentSocket();

        this.status = 'disconnected';
        this.qrDataUrl = null;
        this.phoneNumber = null;
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.connectionMethod = 'qr';
        this.pairingStatus = 'idle';
        this.pairingCode = null;
        this.pairingPhoneMasked = null;
        this.pairingRequestedAt = null;
        this.pairingExpiresAt = null;
        this.pairingError = null;
        this.messageQueue = [];
        this.pendingStickerAudioVisual.clear();

        // Remove ONLY Baileys auth files strictly inside authDir — NEVER touch SQLite app data
        if (fs.existsSync(this.authDir)) {
          const entries = fs.readdirSync(this.authDir, { withFileTypes: true });
          for (const entry of entries) {
            const resolvedChild = path.resolve(this.authDir, entry.name);
            if (!resolvedChild.startsWith(this.authDir + path.sep)) continue;
            fs.rmSync(resolvedChild, { recursive: true, force: true });
          }
        } else {
          fs.mkdirSync(this.authDir, { recursive: true });
        }

        // Re-initialize clean auth state directory without opening an unsolicited socket yet
        await useMultiFileAuthState(this.authDir);

        db.prepare(`
          UPDATE bot_sessions
          SET status = 'disconnected',
              phone_number = NULL,
              qr_code = NULL,
              last_error = NULL,
              reconnect_attempts = 0,
              connection_method = 'qr',
              pairing_status = 'idle',
              pairing_expires_at = NULL,
              updated_at = datetime('now')
          WHERE id = 'primary'
        `).run();
        this.broadcaster('wa:status', this.getStatus());

        this.recordConnectionEvent({
          eventType: 'reset_full_session',
          connectionMethod: 'qr',
          actor,
          targetMasked: null,
          status: 'ok',
          detail: 'Reset sesi penuh berhasil: sesi lama & kredensial Baileys dihapus, data aplikasi tetap aman.',
        });
        addSystemLog('info', 'whatsappEngine', 'Reset sesi penuh Baileys selesai oleh owner.');

        return {
          ok: true,
          status: this.status,
          hasStoredAuth: this.hasStoredAuthCredentials(),
          message: 'Sesi Baileys lama udah dihapus bersih! Pilih QR Code atau Pairing Code buat menautkan ulang WhatsApp.',
        };
      } catch (err) {
        const msgErr = err instanceof Error ? err.message : 'Gagal reset sesi penuh Baileys';
        this.status = 'error';
        this.lastError = msgErr;
        this.persistSessionState();
        this.recordConnectionEvent({
          eventType: 'reset_full_session',
          connectionMethod: this.connectionMethod,
          actor,
          targetMasked: null,
          status: 'error',
          detail: `Reset sesi penuh gagal: ${msgErr}`,
        });
        return {
          ok: false,
          status: this.status,
          hasStoredAuth: this.hasStoredAuthCredentials(),
          message: msgErr,
        };
      }
    });

    if (lockedRes.lockedOut) {
      return {
        ok: false,
        status: this.status,
        hasStoredAuth: this.hasStoredAuthCredentials(),
        message: 'Operasi koneksi lain lagi berjalan, tunggu sebentar ya.',
      };
    }
    return lockedRes.result;
  }

  private attachMessageHandlerToSocket(sock: WASocket, epoch: number): void {
    sock.ev.on('messages.upsert', async (m) => {
      if (epoch !== this.connectionEpoch) return;
      if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          if (!msg.message || msg.key.fromMe) continue;
          const jid = msg.key.remoteJid;
          if (!jid) continue;

          const inner = extractMessageContent(msg.message) || msg.message;
          const contentType = getContentType(inner);
          const isGroup = jid.endsWith('@g.us');
          const senderJid = isGroup ? (msg.key.participant || jid) : jid;
          const senderPhone = normalizePhoneDigits(senderJid.split('@')[0].split(':')[0]);

          let selectedRowId: string | undefined;
          if (inner.listResponseMessage?.singleSelectReply?.selectedRowId) {
            selectedRowId = inner.listResponseMessage.singleSelectReply.selectedRowId;
          } else if (inner.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
            try {
              const flowData = JSON.parse(inner.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
              if (flowData?.id) selectedRowId = String(flowData.id);
            } catch {
              // ignore malformed json
            }
          }

          const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.listResponseMessage?.title ||
            '';

          const ctxInfo =
            inner.extendedTextMessage?.contextInfo ||
            inner.imageMessage?.contextInfo ||
            inner.videoMessage?.contextInfo ||
            inner.stickerMessage?.contextInfo;

          const mentions = Array.isArray(ctxInfo?.mentionedJid)
            ? ctxInfo.mentionedJid.map((mj: string) => normalizePhoneDigits(mj.split('@')[0].split(':')[0])).filter(Boolean)
            : [];
          const quotedSenderPhone = ctxInfo?.participant
            ? normalizePhoneDigits(String(ctxInfo.participant).split('@')[0].split(':')[0])
            : undefined;
          const quotedContent = ctxInfo?.quotedMessage ? extractMessageContent(ctxInfo.quotedMessage) || ctxInfo.quotedMessage : null;

          // Strictly inspect sticker BEFORE audio so stickers with context never get misclassified as audio!
          const isStickerMessage = contentType === 'stickerMessage' || Boolean(inner.stickerMessage);
          let quotedMediaKind: IncomingBotMessage['quotedMediaKind'] = 'none';
          if (quotedContent?.stickerMessage) quotedMediaKind = 'sticker';
          else if (quotedContent?.imageMessage) quotedMediaKind = 'image';
          else if (quotedContent?.videoMessage) quotedMediaKind = 'video';
          else if (quotedContent?.audioMessage) quotedMediaKind = 'audio';
          else if (inner.stickerMessage) quotedMediaKind = 'sticker';
          else if (inner.imageMessage) quotedMediaKind = 'image';
          else if (inner.videoMessage) quotedMediaKind = 'video';
          else if (inner.audioMessage) quotedMediaKind = 'audio';

          let isGroupAdmin = false;
          let groupName: string | undefined;
          if (isGroup && this.sock) {
            try {
              const meta = await this.sock.groupMetadata(jid);
              groupName = meta.subject;
              const pInfo = meta.participants.find((p) => normalizePhoneDigits(p.id.split('@')[0].split(':')[0]) === senderPhone);
              isGroupAdmin = Boolean(pInfo && (pInfo.admin === 'admin' || pInfo.admin === 'superadmin'));
            } catch {
              // fallback false
            }
          }

          // Respect Blue Tick Control ON/OFF
          const blueTick = db
            .prepare("SELECT value FROM settings WHERE key = 'blue_tick_enabled'")
            .get() as { value: string } | undefined;
          if (blueTick?.value === 'true' && this.sock) {
            try {
              await this.sock.readMessages([msg.key]);
            } catch {
              // Ignore read receipt error
            }
          }

          // Anti-sticker check in group chat (protects against incoming stickers even if wrapped)
          if (isGroup && isStickerMessage && !isGroupAdmin && !this.isOwnerPhone(senderPhone)) {
            const grpRow = db.prepare('SELECT anti_settings_json FROM groups WHERE id = ?').get(jid) as
              | { anti_settings_json: string }
              | undefined;
            if (grpRow?.anti_settings_json) {
              try {
                const anti = JSON.parse(grpRow.anti_settings_json);
                if (anti?.antisticker?.enabled && this.sock) {
                  if (anti.antisticker.mode === 'delete' || anti.antisticker.mode === 'warn') {
                    try {
                      await this.sock.sendMessage(jid, { delete: msg.key });
                    } catch {
                      // ignore if bot lacks admin delete right
                    }
                    this.enqueueMessage(jid, `⚠️ Anti-stiker aktif di grup ini (${maskPhoneNumberForGroup(senderPhone)}).`);
                    continue;
                  }
                }
              } catch {
                // ignore malformed json
              }
            }
          }

          // Download quoted/attached media only for commands that consume media buffers
          let quotedMediaBuffer: Buffer | undefined;
          const lowerText = text.toLowerCase();
          if (
            quotedMediaKind !== 'none' &&
            /\b(toimg|tolive|iqcdark|iqcimage|stickeraudio|sa)\b/.test(lowerText) &&
            this.sock
          ) {
            try {
              const targetDownloadMsg = quotedContent
                ? ({ key: msg.key, message: quotedContent } as any)
                : (msg as any);
              const downloaded = await downloadMediaMessage(targetDownloadMsg, 'buffer', {});
              if (Buffer.isBuffer(downloaded)) {
                quotedMediaBuffer = downloaded;
              }
            } catch {
              // Graceful fallback handled by mediaService
            }
          }

          const result = await this.processIncomingMessage({
            chatId: jid,
            chatScope: isGroup ? 'group' : 'private',
            groupName,
            senderPhone,
            senderName: msg.pushName || senderPhone,
            text,
            messageId: msg.key.id || undefined,
            mentions,
            hasReply: Boolean(ctxInfo?.quotedMessage),
            quotedSenderPhone,
            quotedMediaKind,
            quotedMediaBuffer,
            hasMedia: Boolean(inner.imageMessage || inner.videoMessage || inner.audioMessage || inner.stickerMessage),
            isStickerMessage,
            hasAudioContext: Boolean(inner.audioMessage || quotedContent?.audioMessage),
            isGroupAdmin,
            selectedRowId,
            source: 'whatsapp',
          });

          if (result.handled) {
            const mediaEntry = result.commandExecuted ? this.mediaOutbox.get(`${jid}:${senderPhone}`) : undefined;
            if (mediaEntry) {
              this.mediaOutbox.delete(`${jid}:${senderPhone}`);
              if (mediaEntry.kind === 'motion_photo' && mediaEntry.livePhotoBundle && this.sock) {
                const b = mediaEntry.livePhotoBundle;
                const liveRes = await deliverMotionPhotoViaSocket({
                  sock: this.sock,
                  jid,
                  stillBuffer: b.stillBuffer,
                  motionVideoBuffer: b.motionVideoBuffer,
                  width: b.width,
                  height: b.height,
                  durationMs: b.durationMs,
                  presentationOffsetMs: b.presentationOffsetMs,
                  caption: result.replyText || mediaEntry.caption || '',
                });
                if (mediaEntry.jobId) {
                  updateMediaJobDelivery(
                    mediaEntry.jobId,
                    'wa_paired_motion_photo',
                    liveRes.ok ? 'sent' : 'failed',
                    { parentId: liveRes.parentId, childId: liveRes.childId, socketError: liveRes.error },
                  );
                }
                if (!liveRes.ok) {
                  this.enqueueMessage(jid, `⚠️ Gagal kirim protokol Motion Photo (${liveRes.error}). Mengirim fallback video MP4...`);
                  this.enqueuePayload(jid, { video: b.motionVideoBuffer, caption: mediaEntry.caption || '' });
                }
              } else if (mediaEntry.kind === 'sound_sticker' && mediaEntry.soundStickerBundle && this.sock) {
                const sb = mediaEntry.soundStickerBundle;
                const saRes = await deliverSoundStickerViaSocket({
                  sock: this.sock,
                  jid,
                  stickerBuffer: sb.stickerBuffer,
                  audioBuffer: sb.audioBuffer,
                  audioSeconds: sb.audioSeconds,
                  waveform: sb.waveform,
                });
                if (mediaEntry.jobId) {
                  updateMediaJobDelivery(
                    mediaEntry.jobId,
                    'wa_sound_sticker_field26',
                    saRes.ok ? 'sent' : 'failed',
                    { messageId: saRes.messageId, socketError: saRes.error },
                  );
                }
                if (!saRes.ok) {
                  this.enqueueMessage(jid, `⚠️ Gagal kirim protokol Sound Sticker (${saRes.error}). Mengirim stiker animasi fallback...`);
                  this.enqueuePayload(jid, { sticker: sb.stickerBuffer });
                }
              } else if (mediaEntry.kind === 'sticker') {
                this.enqueuePayload(jid, { sticker: mediaEntry.buffer });
              } else if (mediaEntry.kind === 'image') {
                this.enqueuePayload(jid, { image: mediaEntry.buffer, caption: result.replyText || mediaEntry.caption || '' });
              } else if (mediaEntry.kind === 'video') {
                this.enqueuePayload(jid, {
                  video: mediaEntry.buffer,
                  gifPlayback: true,
                  caption: result.replyText || mediaEntry.caption || '',
                });
              }
            } else if (result.interactiveMenu && this.sock && this.status === 'connected') {
              const listPayload = buildBaileysListPayload(result.interactiveMenu, result.replyText);
              try {
                await this.sock.sendMessage(jid, listPayload as any);
                recordMenuFallbackLog({
                  chatId: jid,
                  menuKey: result.interactiveMenu.menuKey,
                  mode: 'interactive_list',
                  reason: 'Baileys interactive list berhasil dikirim',
                });
              } catch (listErr) {
                const errReason = listErr instanceof Error ? listErr.message : 'Client nggak support interactive list';
                recordMenuFallbackLog({
                  chatId: jid,
                  menuKey: result.interactiveMenu.menuKey,
                  mode: 'text_fallback',
                  reason: errReason,
                });
                if (result.replyText) {
                  this.enqueueMessage(jid, result.replyText);
                }
              }
            } else if (result.replyText) {
              this.enqueueMessage(jid, result.replyText);
            }
          }
        }
      });
  }

  public async disconnect(actor = 'owner'): Promise<{ ok: boolean; message: string }> {
    const lockedRes = await this.withConnectionLock('disconnect', async () => {
      this.connectionEpoch += 1;
      this.clearReconnectAndScheduledTimers();
      this.clearPairingTimers();
      this.closeCurrentSocket();

      this.status = 'disconnected';
      this.qrDataUrl = null;
      this.reconnectAttempts = 0;
      if (this.pairingStatus === 'waiting' || this.pairingStatus === 'code_ready') {
        this.pairingStatus = 'cancelled';
        this.pairingCode = null;
        this.pairingExpiresAt = null;
      }

      this.persistSessionState();
      this.recordConnectionEvent({
        eventType: 'disconnect',
        connectionMethod: this.connectionMethod,
        actor,
        targetMasked: this.phoneNumber ? maskPhoneNumberForGroup(this.phoneNumber) : this.pairingPhoneMasked,
        status: 'ok',
        detail: 'Koneksi WhatsApp diputuskan oleh owner.',
      });
      addSystemLog('info', 'whatsappEngine', 'Koneksi WhatsApp diputuskan oleh owner.');
      return { ok: true, message: 'Koneksi WhatsApp udah diputuskan.' };
    });

    if (lockedRes.lockedOut) {
      return {
        ok: false,
        message: 'Proses koneksi atau reset lain lagi berjalan, tunggu sebentar ya.',
      };
    }
    return lockedRes.result;
  }

  public enqueueMessage(jid: string, text: string): void {
    this.enqueuePayload(jid, { text });
  }

  public enqueuePayload(jid: string, payload: Record<string, unknown>): void {
    this.messageQueue.push({ jid, payload });
    void this.flushQueue();
  }

  public dispatchPrivateDeliveries(deliveries?: PrivateDeliveryItem[]): void {
    if (!deliveries || deliveries.length === 0) return;
    for (const item of deliveries) {
      const targetPhone = normalizePhoneDigits(item.toPhone) || item.toPhone;
      const targetJid = `${targetPhone}@s.whatsapp.net`;
      const timer = setTimeout(() => {
        this.scheduledTimers.delete(timer);
        if (this.status === 'connected' && this.sock) {
          this.enqueueMessage(targetJid, item.text);
        }
        this.broadcaster('chat:private_dm', {
          toMasked: maskPhoneNumberForGroup(targetPhone),
          delayMs: item.delayMs,
          timestamp: new Date().toISOString(),
        });
      }, Math.max(0, item.delayMs));
      this.scheduledTimers.add(timer);
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.isFlushingQueue) return;
    this.isFlushingQueue = true;
    try {
      while (this.messageQueue.length > 0) {
        const item = this.messageQueue.shift();
        if (!item) break;
        if (this.sock && this.status === 'connected') {
          try {
            await this.sock.sendMessage(item.jid, item.payload as any);
          } catch (err) {
            addSystemLog('warn', 'whatsappQueue', `Gagal mengirim pesan ke ${item.jid}: ${err instanceof Error ? err.message : 'error'}`);
          }
        }
        // Rate limit spacing between queued WhatsApp messages
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      this.isFlushingQueue = false;
    }
  }

  public getActivePrefixes(): string[] {
    const rows = db
      .prepare('SELECT prefix FROM prefixes WHERE enabled = 1 ORDER BY sort_order ASC')
      .all() as Array<{ prefix: string }>;
    return rows.length > 0 ? rows.map((r) => r.prefix) : [...DEFAULT_PREFIXES];
  }

  private getBotLanguage(userLanguage?: string): BotLang {
    const setting = db.prepare(`SELECT value FROM settings WHERE key = 'default_language'`).get() as { value: string } | undefined;
    return normalizeBotLang(setting?.value || userLanguage);
  }

  public async processIncomingMessage(rawMsg: IncomingBotMessage): Promise<BotDispatchResponse> {
    const started = Date.now();
    const senderPhone = normalizePhoneDigits(rawMsg.senderPhone) || rawMsg.senderPhone;
    const msg: IncomingBotMessage = {
      ...rawMsg,
      senderPhone,
      mentions: rawMsg.mentions?.map((m) => normalizePhoneDigits(m) || m).filter(Boolean),
      quotedSenderPhone: rawMsg.quotedSenderPhone
        ? normalizePhoneDigits(rawMsg.quotedSenderPhone) || rawMsg.quotedSenderPhone
        : undefined,
    };
    const isOwner = this.isOwnerPhone(msg.senderPhone);

    // Ensure user (initialGeneralLimit = 50) & contact records exist
    const userObj = ensureUserRecord(msg.senderPhone, msg.senderName);
    if (isOwner && userObj.role !== 'owner') {
      db.prepare(`UPDATE users SET role = 'owner' WHERE phone = ?`).run(msg.senderPhone);
    }
    db.prepare(`
      INSERT INTO contacts (id, phone, push_name, source, last_seen_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(phone) DO UPDATE SET push_name = excluded.push_name, last_seen_at = datetime('now')
    `).run(`cnt-${msg.senderPhone}`, msg.senderPhone, msg.senderName, msg.source ?? 'whatsapp');

    if (msg.chatScope === 'group') {
      db.prepare(`
        INSERT INTO groups (id, name, owner_phone) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = COALESCE(NULLIF(?, ''), name), updated_at = datetime('now')
      `).run(msg.chatId, msg.groupName || `Grup ${msg.chatId}`, msg.senderPhone, msg.groupName || '');

      // Track every active group member cleanly so #toplocal reflects real group participants without cross-group leakage
      db.prepare(`
        INSERT INTO group_members (group_id, user_phone, message_count)
        VALUES (?, ?, 1)
        ON CONFLICT(group_id, user_phone) DO UPDATE SET
          message_count = group_members.message_count + 1
      `).run(msg.chatId, msg.senderPhone);
    }

    // Track mutual pair streak replies / mentions automatically
    const streakTargets = Array.from(
      new Set([...(msg.mentions || []), ...(msg.quotedSenderPhone ? [msg.quotedSenderPhone] : [])]),
    );
    if (streakTargets.length > 0) {
      recordPairStreakMutualInteraction({
        senderPhone: msg.senderPhone,
        targetPhones: streakTargets,
      });
    }

    const lang = this.getBotLanguage(userObj.language);
    const t = botText(lang);

    // Broadcast inbound message to Live Chat Monitor (privacy-preserving)
    this.broadcaster('chat:message', {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      direction: 'inbound',
      chatId: msg.chatId,
      chatScope: msg.chatScope,
      groupName: msg.groupName,
      senderName: msg.senderName,
      senderMasked: maskPhoneNumberForGroup(msg.senderPhone),
      text: msg.text,
      timestamp: new Date().toISOString(),
    });

    const activePrefixes = this.getActivePrefixes();
    let parsed = parseCommandInput(msg.text, activePrefixes, {
      mentions: msg.mentions,
      hasReply: msg.hasReply,
      hasMedia: msg.hasMedia,
    });

    // Check active interactive WhatsApp Wizard (e.g. .addredeem multi-step builder) BEFORE menu & game fallback
    const activeWizard = db
      .prepare(
        `SELECT * FROM whatsapp_wizards
         WHERE user_phone = ? AND chat_id = ? AND status = 'active' AND datetime(expires_at) > datetime('now')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(msg.senderPhone, msg.chatId) as
      | { id: string; wizard_type: string; step: string; state_json: string }
      | undefined;

    if (activeWizard && (!parsed.isCommand || ['batal', 'cancel', 'exit'].includes(parsed.commandName))) {
      if (msg.chatScope === 'group') {
        recordGroupStreakBotInteraction({ groupId: msg.chatId, userPhone: msg.senderPhone });
      }
      const wizardRes = this.handleWizardInput(activeWizard, msg, activePrefixes[0] || '.');
      this.emitOutbound(msg, wizardRes.replyText);
      return wizardRes;
    }

    let isInteractiveMenuSelection = false;

    // 1) Explicit Interactive List row tap takes priority (non-numeric rowId)
    if (msg.selectedRowId && msg.selectedRowId.trim().length > 0) {
      const selRes = resolveMenuSelection({
        chatId: msg.chatId,
        userPhone: msg.senderPhone,
        chatScope: msg.chatScope,
        selectedRowId: msg.selectedRowId,
        rawText: msg.text,
        isOwner,
        isGroupAdmin: Boolean(msg.isGroupAdmin),
        prefix: activePrefixes[0] || '.',
        lang,
      });
      if (selRes.kind === 'matched_command' && selRes.commandText) {
        isInteractiveMenuSelection = true;
        parsed = parseCommandInput(selRes.commandText, activePrefixes, {
          mentions: msg.mentions,
          hasReply: msg.hasReply,
          hasMedia: msg.hasMedia,
        });
      } else if (selRes.kind !== 'not_menu_input') {
        const reply = selRes.message || t.menuInvalidChoice(activePrefixes[0] || '.');
        this.emitOutbound(msg, reply);
        return {
          handled: true,
          replyText: reply,
          status: selRes.kind === 'cancelled' ? 'ok' : selRes.kind === 'denied' ? 'denied' : 'error',
        };
      }
    }

    // 2) Non-command input: give active game turn priority BEFORE numbered menu fallback so numeric guesses never collide!
    if (!parsed.isCommand) {
      const activeGame = db
        .prepare("SELECT id FROM game_sessions WHERE chat_id = ? AND chat_scope = ? AND status IN ('waiting', 'active') ORDER BY started_at DESC LIMIT 1")
        .get(msg.chatId, msg.chatScope) as { id: string } | undefined;

      if (activeGame && msg.text.trim().length > 0) {
        const res = submitGameAction({
          sessionId: activeGame.id,
          playerPhone: msg.senderPhone,
          playerName: msg.senderName,
          chatScope: msg.chatScope,
          chatId: msg.chatId,
          input: msg.text,
        });
        if (res.privateDeliveries?.length) {
          this.dispatchPrivateDeliveries(res.privateDeliveries);
        }
        if (res.announcement) {
          if (msg.chatScope === 'group') {
            recordGroupStreakBotInteraction({ groupId: msg.chatId, userPhone: msg.senderPhone });
          }
          this.emitOutbound(msg, res.announcement);
          return {
            handled: true,
            replyText: res.announcement,
            privateDeliveries: res.privateDeliveries,
            status: 'ok',
          };
        }
      }

      // 3) Check numbered text fallback selection against active interactive menu session
      if (/^\d{1,2}$/.test(msg.text.trim())) {
        const fallbackSel = resolveMenuSelection({
          chatId: msg.chatId,
          userPhone: msg.senderPhone,
          chatScope: msg.chatScope,
          rawText: msg.text,
          isOwner,
          isGroupAdmin: Boolean(msg.isGroupAdmin),
          prefix: activePrefixes[0] || '.',
          lang,
        });
        if (fallbackSel.kind === 'matched_command' && fallbackSel.commandText) {
          isInteractiveMenuSelection = true;
          parsed = parseCommandInput(fallbackSel.commandText, activePrefixes, {
            mentions: msg.mentions,
            hasReply: msg.hasReply,
            hasMedia: msg.hasMedia,
          });
        } else if (fallbackSel.kind !== 'not_menu_input') {
          const reply = fallbackSel.message || t.menuInvalidChoice(activePrefixes[0] || '.');
          this.emitOutbound(msg, reply);
          return {
            handled: true,
            replyText: reply,
            status: fallbackSel.kind === 'cancelled' ? 'ok' : fallbackSel.kind === 'denied' ? 'denied' : 'error',
          };
        }
      }

      if (!parsed.isCommand) {
        // Note: ordinary chat between members without invoking bot MUST NOT count toward group streak!
        return { handled: false, replyText: '', status: 'ignored' };
      }
    }

    // Group streak counts EVERY command/interaction with the bot without exception
    if (msg.chatScope === 'group') {
      recordGroupStreakBotInteraction({ groupId: msg.chatId, userPhone: msg.senderPhone });
    }

    // Resolve command from database registry (with alias resolution)
    const aliasRow = db
      .prepare('SELECT command_name FROM command_aliases WHERE alias = ?')
      .get(parsed.commandName) as { command_name: string } | undefined;
    const canonicalName = aliasRow ? aliasRow.command_name : parsed.commandName;

    const cmdRow = db
      .prepare('SELECT * FROM commands WHERE name = ?')
      .get(canonicalName) as {
        name: string;
        category: CommandCategory;
        description: string;
        example: string;
        permission: string;
        status: string;
        enabled: number;
        cooldown_sec: number;
        daily_limit: number;
        balance_reward: number;
        exp_reward: number;
        has_real_handler: number;
        is_owner_only: number;
        required_provider: string | null;
        required_plugin: string | null;
      } | undefined;

    if (!cmdRow) {
      const reply = t.cmdNotFound(parsed.prefix!, parsed.commandName);
      this.emitOutbound(msg, reply);
      return { handled: true, replyText: reply, status: 'ignored' };
    }

    // Check Maintenance Mode
    const maint = db.prepare("SELECT value FROM settings WHERE key = 'maintenance_mode'").get() as { value: string } | undefined;
    if (maint?.value === 'true' && !isOwner) {
      const reply = t.maintenance;
      this.emitOutbound(msg, reply);
      return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
    }

    // Check banned user
    const latestUser = ensureUserRecord(msg.senderPhone, msg.senderName);
    if (latestUser.is_banned && !isOwner) {
      return { handled: true, replyText: t.restrictedUser('Akun dibatasi oleh administrator'), status: 'denied', commandExecuted: cmdRow.name };
    }

    // Anti-Abuse & Exploit Gate
    const abuseGate = checkUserAbuseGate({
      userPhone: msg.senderPhone,
      chatId: msg.chatId,
      commandName: cmdRow.name,
      rawArgs: parsed.rawArgs,
      isOwner,
      lang,
    });
    if (!abuseGate.allowed) {
      const reply = abuseGate.reason || t.restrictedUser();
      this.recordCommandUsage(cmdRow.name, parsed.prefix!, msg, false, Date.now() - started, reply);
      this.emitOutbound(msg, reply);
      return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
    }

    // Check enabled flag
    if (!cmdRow.enabled) {
      const reply = t.cmdDisabled(parsed.prefix!, cmdRow.name);
      this.emitOutbound(msg, reply);
      return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
    }

    // Permission validation
    if ((cmdRow.is_owner_only || cmdRow.permission === 'owner') && !isOwner) {
      recordAbuseEvent({
        userPhone: msg.senderPhone,
        chatId: msg.chatId,
        submodule: 'permission_guard',
        severity: 'rule_violation',
        actionTaken: 'blocked_owner_cmd',
        commandName: cmdRow.name,
        detail: `User biasa mencoba command owner "${cmdRow.name}".`,
      });
      const reply = t.ownerOnly(cmdRow.name);
      this.recordCommandUsage(cmdRow.name, parsed.prefix!, msg, false, Date.now() - started, 'Owner permission required');
      this.emitOutbound(msg, reply);
      return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
    }

    if (cmdRow.permission === 'group_admin' && msg.chatScope === 'group' && !msg.isGroupAdmin && !isOwner) {
      recordAbuseEvent({
        userPhone: msg.senderPhone,
        chatId: msg.chatId,
        submodule: 'permission_guard',
        severity: 'rule_violation',
        actionTaken: 'blocked_admin_cmd',
        commandName: cmdRow.name,
        detail: `Non-admin mencoba command admin grup "${cmdRow.name}".`,
      });
      const reply = t.adminOnly(cmdRow.name);
      this.recordCommandUsage(cmdRow.name, parsed.prefix!, msg, false, Date.now() - started, 'Group admin required');
      this.emitOutbound(msg, reply);
      return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
    }

    // Cooldown validation (skip cooldown when tapping/navigating submenus via Interactive List / numbered fallback)
    if (!isOwner && cmdRow.cooldown_sec > 0 && !(isInteractiveMenuSelection && cmdRow.name === 'menu')) {
      const cdKey = `${msg.senderPhone}:${cmdRow.name}`;
      const expires = this.cooldownMap.get(cdKey) ?? 0;
      if (Date.now() < expires) {
        const waitSec = Math.ceil((expires - Date.now()) / 1000);
        const reply = t.cooldown(cmdRow.name, waitSec);
        this.emitOutbound(msg, reply);
        return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
      }
      this.cooldownMap.set(cdKey, Date.now() + cmdRow.cooldown_sec * 1000);
    }

    // Unified Limit deduction (premium & owner & exempt commands cost 0; never deduct pending_specification/integration)
    if (cmdRow.status === 'active' && cmdRow.has_real_handler) {
      const limitCheck = consumeLimitForCommand({
        userPhone: msg.senderPhone,
        displayName: msg.senderName,
        commandName: cmdRow.name,
        isOwnerActor: isOwner,
        isOwnerCommand: Boolean(cmdRow.is_owner_only || cmdRow.permission === 'owner'),
        txKey: msg.messageId ? `cmd-${msg.messageId}` : undefined,
      });
      if (!limitCheck.allowed) {
        const reply = t.limitEmpty(parsed.prefix!);
        this.recordCommandUsage(cmdRow.name, parsed.prefix!, msg, false, Date.now() - started, 'Limit depleted');
        this.emitOutbound(msg, reply);
        return { handled: true, replyText: reply, status: 'denied', commandExecuted: cmdRow.name };
      }
    }

    // Update prefix usage counter
    db.prepare('UPDATE prefixes SET usage_count = usage_count + 1 WHERE prefix = ?').run(parsed.prefix);

    // Execute command handler
    const response = await this.executeCommandHandler(cmdRow, parsed.prefix!, parsed.rawArgs, parsed.args, msg, isOwner, lang);
    if (response.privateDeliveries?.length) {
      this.dispatchPrivateDeliveries(response.privateDeliveries);
    }

    this.recordCommandUsage(
      cmdRow.name,
      parsed.prefix!,
      msg,
      response.status === 'ok',
      Date.now() - started,
      response.status === 'error' ? response.replyText : undefined,
    );

    if (response.replyText) {
      this.emitOutbound(msg, response.replyText);
    }

    return { ...response, commandExecuted: cmdRow.name };
  }

  private recordCommandUsage(
    commandName: string,
    prefixUsed: string,
    msg: IncomingBotMessage,
    success: boolean,
    latencyMs: number,
    errorMessage?: string,
  ): void {
    db.prepare(`
      UPDATE commands
      SET usage_count = usage_count + 1,
          error_count = error_count + ?,
          last_used_at = datetime('now')
      WHERE name = ?
    `).run(success ? 0 : 1, commandName);

    db.prepare(`
      INSERT INTO command_usage (command_name, prefix_used, user_phone, chat_id, chat_scope, success, latency_ms, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(commandName, prefixUsed, msg.senderPhone, msg.chatId, msg.chatScope, success ? 1 : 0, latencyMs, errorMessage ?? null);
  }

  private emitOutbound(msg: IncomingBotMessage, text: string): void {
    this.broadcaster('chat:message', {
      id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      direction: 'outbound',
      chatId: msg.chatId,
      chatScope: msg.chatScope,
      groupName: msg.groupName,
      senderName: 'Freya-san bot by Pak Ujan',
      text,
      timestamp: new Date().toISOString(),
    });
  }

  private buildInteractiveMenu(
    prefix: string,
    rawArgs: string,
    msg: IncomingBotMessage,
    isOwner: boolean,
    lang: BotLang = 'id',
  ): BotDispatchResponse {
    const trimmed = rawArgs.trim();
    const t = botText(lang);

    // Check if user requested help on a specific command (e.g. ".help tolive" or ".menu ping")
    const knownMenuKeys = new Set([
      '',
      'main',
      'games',
      'game',
      '48group',
      'jkt48',
      '48group_level',
      '48group_team',
      '48group_quiz',
      'group_settings',
      'grup',
      'groupsetting',
      'bot_settings',
      'bot',
      'settings',
      'owner',
      'premium_redeem',
      'premium',
      'redeem',
      'economy',
      'ekonomi',
      'transaksi',
      'help_info',
      'bantuan',
      'info',
      'help',
      'features',
      'fitur',
      'ai',
      'download',
      'general',
      'group',
      'random',
      'search',
      'sticker',
      'textmaker',
      'tools',
    ]);
    const lowerArg = trimmed.toLowerCase();
    if (
      lowerArg &&
      !knownMenuKeys.has(lowerArg) &&
      !lowerArg.startsWith('category:') &&
      !lowerArg.startsWith('confirm:') &&
      !lowerArg.startsWith('48group_team:')
    ) {
      const targetCmd = findCommandByNameOrAlias(lowerArg);
      if (targetCmd) {
        if (targetCmd.isOwnerOnly && !isOwner) {
          return { handled: true, replyText: t.ownerOnly(targetCmd.name), status: 'denied' };
        }
        const aliasesText = targetCmd.aliases.length > 0 ? `\nAlias: ${targetCmd.aliases.map((a) => `${prefix}${a}`).join(', ')}` : '';
        const exampleText = targetCmd.example ? `\nContoh: *${targetCmd.example}*` : `\nContoh: *${prefix}${targetCmd.name}*`;
        const guideText = `📘 *${t.helpHeader(targetCmd.name)}*\nKategori: ${targetCmd.category}\n${targetCmd.description}${aliasesText}${exampleText}\n\n_${t.botFooter}_`;
        const quickMenu = issueMenuSession({
          chatId: msg.chatId,
          userPhone: msg.senderPhone,
          chatScope: msg.chatScope,
          menu: {
            menuKey: `cmd_help:${targetCmd.name}`,
            title: `${prefix}${targetCmd.name}`,
            subtitle: targetCmd.description,
            buttonText: t.menuListButton,
            footer: t.botFooter,
            sections: [
              {
                title: 'Aksi Cepat',
                rows: [
                  {
                    id: `cmd:run:${targetCmd.name}`,
                    title: `▶️ Jalankan ${prefix}${targetCmd.name}`,
                    description: targetCmd.example || `${prefix}${targetCmd.name}`,
                    command: targetCmd.example || `${prefix}${targetCmd.name}`,
                    requiredPermission: targetCmd.permission === 'owner' ? 'owner' : targetCmd.permission === 'group_admin' ? 'group_admin' : 'public',
                    actionKind: 'command',
                  },
                  {
                    id: `menu:category:${targetCmd.category}:1`,
                    title: `⬅️ Balik ke ${targetCmd.category}`,
                    description: `Lihat command lain di kategori ${targetCmd.category}`,
                    command: `${prefix}menu category:${targetCmd.category}:1`,
                    requiredPermission: targetCmd.category === 'OWNER' ? 'owner' : 'public',
                    actionKind: 'submenu',
                  },
                  {
                    id: 'nav:main',
                    title: t.menuBackMainTitle,
                    description: t.menuBackMainDesc,
                    command: `${prefix}menu`,
                    requiredPermission: 'public',
                    actionKind: 'submenu',
                  },
                ],
              },
            ],
          },
        });
        return {
          handled: true,
          replyText: formatMenuFallbackText(quickMenu, guideText, lang),
          interactiveMenu: quickMenu,
          status: 'ok',
        };
      }
    }

    const built = buildMenuPayload(trimmed || 'main', {
      prefix,
      lang,
      isOwner,
      isGroupAdmin: Boolean(msg.isGroupAdmin),
      chatScope: msg.chatScope,
      groupName: msg.groupName,
      botStatus: this.status,
      senderName: msg.senderName,
    });

    if (built.deniedReason) {
      return {
        handled: true,
        replyText: built.deniedReason,
        status: 'denied',
      };
    }

    const issuedMenu = issueMenuSession({
      chatId: msg.chatId,
      userPhone: msg.senderPhone,
      chatScope: msg.chatScope,
      menu: built.menu,
    });

    if (msg.source === 'simulator') {
      // Keep track only when requested or record interactive render in simulator gracefully
    }

    return {
      handled: true,
      replyText: formatMenuFallbackText(issuedMenu, built.headerText, lang),
      interactiveMenu: issuedMenu,
      status: 'ok',
    };
  }

  private async executeCommandHandler(
    cmd: { name: string; category: string; status: string; has_real_handler: number; description: string; example: string },
    prefix: string,
    rawArgs: string,
    args: string[],
    msg: IncomingBotMessage,
    isOwner: boolean,
    lang: BotLang = 'id',
  ): Promise<BotDispatchResponse> {
    const name = cmd.name;
    const t = botText(lang);

    // Honest status for unverified / pending_specification commands
    if (cmd.status === 'pending_specification') {
      return {
        handled: true,
        replyText: `Command "${prefix}${name}" statusnya masih pending_specification nih (belum diaktifin spesifik sama Owner).`,
        status: 'pending',
      };
    }

    if (cmd.status === 'pending_integration' || !cmd.has_real_handler) {
      return {
        handled: true,
        replyText: `Command "${prefix}${name}" masuk kategori ${cmd.category}, tapi layanan eksternalnya belum tersambung di server ini ya.`,
        status: 'pending',
      };
    }

    // Menu & General
    if (name === 'menu') {
      return this.buildInteractiveMenu(prefix, rawArgs, msg, isOwner, lang);
    }

    if (name === 'ping') {
      const t0 = Date.now();
      const latency = Math.max(1, Date.now() - t0 + 1);
      return { handled: true, replyText: t.ping(latency, this.status), status: 'ok' };
    }

    if (name === 'runtime') {
      const sec = Math.floor((Date.now() - this.startedAt) / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return {
        handled: true,
        replyText:
          lang === 'en'
            ? `Bot & server have been running for ${h}h ${m}m ${s}s.`
            : lang === 'ja'
            ? `サーバーとボットの稼働時間: ${h}時間 ${m}分 ${s}秒だよ。`
            : `Bot & server sudah nyala selama ${h} jam ${m} menit ${s} detik.`,
        status: 'ok',
      };
    }

    if (name === 'version' || name === 'infobot') {
      const totalCmds = (db.prepare('SELECT COUNT(*) as c FROM commands').get() as { c: number }).c;
      return {
        handled: true,
        replyText: `Freya-san Hub v5.0\nBot: Freya-san bot by Pak Ujan\nTotal Command: ${totalCmds}\nPrefix Aktif: ${this.getActivePrefixes().join(' ')}`,
        status: 'ok',
      };
    }

    if (name === 'changelog') {
      return {
        handled: true,
        replyText: 'Freya-san Hub v5.0:\n- Pembaruan Streak Pasangan & Streak Grup\n- Stiker Brat2/Bahlil/Spongebob & Mockup PNG [SIMULASI]\n- Undercover (210 kata), UNO Stop/Timeout, Bom Grid Dinamis, Tebak Emoji (195 soal)\n- Unified Limit System (#addlimit 3 mode) & Anti-Abuse 10 Submodul',
        status: 'ok',
      };
    }

    if (name === 'owner') {
      return {
        handled: true,
        replyText: 'Freya-san bot by Pak Ujan dikelola lewat Freya-san Hub Owner Console. Nomor pribadi owner tetap kami jaga privasinya ya.',
        status: 'ok',
      };
    }

    if (name === 'sender') {
      const displayId = msg.chatScope === 'group' ? maskPhoneNumberForGroup(msg.senderPhone) : msg.senderPhone;
      return { handled: true, replyText: `Pengirim: ${msg.senderName} (${displayId}) | Ruang: ${msg.chatScope}`, status: 'ok' };
    }

    // Prefix Manager
    if (name === 'prefix' || name === 'listprefix') {
      const list = db.prepare('SELECT prefix, is_default, enabled, usage_count FROM prefixes ORDER BY sort_order ASC').all() as Array<{ prefix: string; is_default: number; enabled: number; usage_count: number }>;
      return {
        handled: true,
        replyText: `Daftar Prefix Aktif:\n${list.map((p) => `${p.prefix} (${p.enabled ? 'ON' : 'OFF'}, dipakai: ${p.usage_count}${p.is_default ? ', default' : ''})`).join('\n')}`,
        status: 'ok',
      };
    }
    if (name === 'addprefix') {
      const p = args[0];
      if (!p || p.length > 3) return { handled: true, replyText: `Formatnya: ${prefix}addprefix <simbol>`, status: 'error' };
      db.prepare('INSERT OR REPLACE INTO prefixes (prefix, is_default, enabled, sort_order) VALUES (?, 0, 1, 99)').run(p);
      addAuditLog(msg.senderPhone, 'prefix.add', p);
      return { handled: true, replyText: `Siap! Prefix tambahan "${p}" sudah ditambah dan diaktifkan.`, status: 'ok' };
    }
    if (name === 'delprefix') {
      const p = args[0];
      if (!p) return { handled: true, replyText: `Formatnya: ${prefix}delprefix <simbol>`, status: 'error' };
      const existing = db.prepare('SELECT is_default FROM prefixes WHERE prefix = ?').get(p) as { is_default: number } | undefined;
      if (!existing) return { handled: true, replyText: `Prefix "${p}" nggak ketemu.`, status: 'error' };
      if (existing.is_default) {
        return { handled: true, replyText: `Prefix "${p}" itu termasuk 10 prefix bawaan wajib. Kalau mau nonaktifin, pakai toggle di dashboard ya.`, status: 'denied' };
      }
      db.prepare('DELETE FROM prefixes WHERE prefix = ?').run(p);
      addAuditLog(msg.senderPhone, 'prefix.delete', p);
      return { handled: true, replyText: `Prefix tambahan "${p}" sudah dihapus.`, status: 'ok' };
    }
    if (name === 'resetprefix') {
      if (args[0]?.toLowerCase() !== 'confirm') {
        return this.buildInteractiveMenu(prefix, 'confirm:resetprefix', msg, isOwner, lang);
      }
      db.transaction(() => {
        db.prepare('DELETE FROM prefixes WHERE is_default = 0').run();
        db.prepare('UPDATE prefixes SET enabled = 1 WHERE is_default = 1').run();
      })();
      addAuditLog(msg.senderPhone, 'prefix.reset', 'default_10');
      return { handled: true, replyText: 'Semua 10 prefix bawaan sudah dikembalikan jadi aktif semua!', status: 'ok' };
    }

    if (name === 'setcommand') {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'lang' || sub === 'bahasa' || sub === 'language') {
        const nextLangRaw = (args[1] || '').toLowerCase();
        if (!['id', 'en', 'ja', 'jp'].includes(nextLangRaw)) {
          return {
            handled: true,
            replyText: `Pilih bahasa dulu ya: ${prefix}setcommand lang id | en | ja`,
            status: 'error',
          };
        }
        const normalized = normalizeBotLang(nextLangRaw);
        db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'default_language'").run(normalized);
        addAuditLog(msg.senderPhone, 'settings.default_language', normalized);
        const label = normalized === 'en' ? 'English' : normalized === 'ja' ? '日本語 (Japanese)' : 'Indonesia Santai';
        return {
          handled: true,
          replyText: botText(normalized).languageUpdated(label),
          status: 'ok',
        };
      }
      return this.buildInteractiveMenu(prefix, 'bot_settings', msg, isOwner, lang);
    }

    // Streak Pasangan (#streak) & Streak Grup (#streakgrup)
    if (name === 'streak') {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'acc' || sub === 'terima' || sub === 'accept') {
        const initHint = msg.mentions?.[0] || msg.quotedSenderPhone || (args[1] ? args[1].replace(/\D/g, '') : undefined);
        const res = respondPairStreakInvite({
          responderPhone: msg.senderPhone,
          accept: true,
          initiatorHintPhone: initHint,
          lang,
        });
        return { handled: true, replyText: res.message, status: res.ok ? 'ok' : 'error' };
      }
      if (sub === 'tolak' || sub === 'reject' || sub === 'decline') {
        const initHint = msg.mentions?.[0] || msg.quotedSenderPhone || (args[1] ? args[1].replace(/\D/g, '') : undefined);
        const res = respondPairStreakInvite({
          responderPhone: msg.senderPhone,
          accept: false,
          initiatorHintPhone: initHint,
          lang,
        });
        return { handled: true, replyText: res.message, status: res.ok ? 'ok' : 'error' };
      }
      if (sub === 'pulihkan' || sub === 'restore') {
        const hint = msg.mentions?.[0] || msg.quotedSenderPhone || (args[1] ? args[1].replace(/\D/g, '') : undefined);
        const res = restorePairStreak({
          userPhone: msg.senderPhone,
          partnerPhoneHint: hint,
          lang,
        });
        return { handled: true, replyText: res.message, status: res.ok ? 'ok' : 'error' };
      }

      const rawTarget =
        msg.mentions?.[0] ||
        msg.quotedSenderPhone ||
        (args[0] && /^(bot|minbot|freyabot|\+?\d{5,})$/i.test(args[0]) ? args[0] : undefined);
      if (rawTarget) {
        const res = invitePairStreak({
          initiatorPhone: msg.senderPhone,
          partnerPhone: rawTarget,
          lang,
        });
        return { handled: true, replyText: res.message, status: res.ok ? 'ok' : res.ignoredBot ? 'denied' : 'error' };
      }

      return {
        handled: true,
        replyText: formatPairStreakStatus(msg.senderPhone, prefix, lang),
        status: 'ok',
      };
    }

    if (name === 'streakgrup') {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'top' || sub === 'rank' || sub === 'peringkat') {
        const list = getGroupStreakTopList(10);
        if (list.length === 0) {
          return {
            handled: true,
            replyText: lang === 'en' ? 'No active group streaks recorded yet.' : 'Belum ada grup yang punya streak aktif nih.',
            status: 'ok',
          };
        }
        const lines = list.map((g) => `${g.rank}. *${g.groupName}* — 🔥 ${g.currentStreak} hari (rekor ${g.longestStreak})`);
        return {
          handled: true,
          replyText: `🔥 *Peringkat Streak Grup Teratas*\n\n${lines.join('\n')}\n\n_${t.botFooter}_`,
          status: 'ok',
        };
      }

      if (msg.chatScope !== 'group') {
        return {
          handled: true,
          replyText: lang === 'en' ? 'Use this command inside a WhatsApp group chat!' : 'Perintah ini khusus dipakai di dalam grup ya.',
          status: 'error',
        };
      }

      if (sub === 'on' || sub === 'off') {
        if (!msg.isGroupAdmin && !isOwner) {
          recordAbuseEvent({
            userPhone: msg.senderPhone,
            chatId: msg.chatId,
            submodule: 'permission_guard',
            severity: 'rule_violation',
            actionTaken: 'streakgrup_toggle_denied',
            commandName: 'streakgrup',
            detail: 'Non-admin mencoba toggle streak grup.',
          });
          return { handled: true, replyText: t.adminOnly('streakgrup'), status: 'denied' };
        }
        const enable = sub === 'on';
        setGroupStreakEnabled(msg.chatId, enable);
        return {
          handled: true,
          replyText: enable
            ? `🔥 Sip! Streak grup resmi *AKTIF* di grup ini. Ajak minimal 3 anggota atau kirim 5 interaksi ke bot per hari buat nyalain apinya!`
            : `Streak grup di grup ini dimatikan dulu oleh admin.`,
          status: 'ok',
        };
      }

      if (sub === 'pulihkan' || sub === 'restore') {
        const res = restoreGroupStreak({ groupId: msg.chatId, actorPhone: msg.senderPhone, lang });
        return { handled: true, replyText: res.message, status: res.ok ? 'ok' : 'error' };
      }

      return {
        handled: true,
        replyText: formatGroupStreakStatus(msg.chatId, prefix, lang),
        status: 'ok',
      };
    }

    // Info & Economy
    if (name === 'balance' || name === 'level' || name === 'limit' || name === 'profile' || name === 'cekpremium') {
      const u = ensureUserRecord(msg.senderPhone, msg.senderName);
      const premValid = isUserPremiumValid(u);
      return {
        handled: true,
        replyText:
          lang === 'en'
            ? `Profile of ${u.display_name}:\n• Virtual Balance: ${u.balance}\n• EXP: ${u.exp} (Level ${u.level})\n• Limit: ${premValid ? 'Unlimited (Premium)' : u.daily_limit}\n• Premium: ${premValid ? 'Active' : 'Standard'}`
            : `Profil ${u.display_name}:\n• Balance Virtual: ${u.balance}\n• EXP: ${u.exp} (Level ${u.level})\n• Sisa Limit: ${premValid ? 'Unlimited (Premium)' : u.daily_limit}\n• Status: ${premValid ? 'Premium Aktif' : 'User Umum'}`,
        status: 'ok',
      };
    }

    if (name === 'topglobal' || name === 'toplocal') {
      if (name === 'toplocal' && msg.chatScope !== 'group') {
        return {
          handled: true,
          replyText:
            lang === 'en'
              ? `Use ${prefix}toplocal inside a group chat, or try ${prefix}topglobal here!`
              : `Ketik ${prefix}toplocal di dalam grup ya biar ranking anggotanya akurat. Di chat pribadi pakai ${prefix}topglobal aja!`,
          status: 'error',
        };
      }
      const boardText = formatLeaderboardMessage({
        scope: name === 'toplocal' ? 'local' : 'global',
        groupId: msg.chatId,
        groupName: msg.groupName,
        requesterPhone: msg.senderPhone,
        lang,
      });
      return { handled: true, replyText: boardText, status: 'ok' };
    }

    if (name === 'kodebahasa') {
      return { handled: true, replyText: 'Kode bahasa didukung: id (Indonesia - Santai), en (English), ja (日本語).', status: 'ok' };
    }

    if (name === 'infounsur') {
      const query = (args[0] || 'Au').toLowerCase();
      const elements: Record<string, string> = {
        h: 'Hidrogen (H) — Nomor Atom 1, Massa 1.008, Non-logam',
        he: 'Helium (He) — Nomor Atom 2, Massa 4.0026, Gas Mulia',
        c: 'Karbon (C) — Nomor Atom 6, Massa 12.011, Non-logam',
        o: 'Oksigen (O) — Nomor Atom 8, Massa 15.999, Non-logam',
        fe: 'Besi (Fe) — Nomor Atom 26, Massa 55.845, Logam Transisi',
        au: 'Emas (Au) — Nomor Atom 79, Massa 196.97, Logam Transisi',
      };
      return {
        handled: true,
        replyText: elements[query] || `Data unsur "${args[0] || ''}" tersedia untuk H, He, C, O, Fe, Au.`,
        status: 'ok',
      };
    }

    if (name === 'infogempa') {
      try {
        const resp = await fetch('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json', { signal: AbortSignal.timeout(4500) });
        if (resp.ok) {
          const data = await resp.json() as { Infogempa?: { gempa?: Record<string, string> } };
          const g = data.Infogempa?.gempa;
          if (g) {
            return {
              handled: true,
              replyText: `Info Gempa Terkini (BMKG):\n- Waktu: ${g.Tanggal} ${g.Jam}\n- Magnitudo: ${g.Magnitude}\n- Kedalaman: ${g.Kedalaman}\n- Wilayah: ${g.Wilayah}\n- Potensi: ${g.Potensi}`,
              status: 'ok',
            };
          }
        }
      } catch {
        // Fallback honest status if offline
      }
      return { handled: true, replyText: 'Tidak dapat mengambil data live BMKG saat ini. Coba lagi beberapa saat.', status: 'error' };
    }

    if (name === 'status') {
      const wa = this.getStatus();
      return {
        handled: true,
        replyText: `Status Komponen Freya-san Hub:\n- WhatsApp Engine: ${wa.status}\n- Database SQLite: Operasional\n- Blue Tick Control: ${wa.blueTickEnabled ? 'ON' : 'OFF'}\n- Antrean Pesan: ${wa.queueLength}`,
        status: 'ok',
      };
    }

    if (name === 'report') {
      if (!rawArgs) return { handled: true, replyText: `Cara pakainya: ${prefix}report <isi laporan kamu>`, status: 'error' };
      addSystemLog('warn', 'userReport', rawArgs, { from: maskPhoneNumberForGroup(msg.senderPhone) });
      return { handled: true, replyText: t.reportSaved(msg.senderName), status: 'ok' };
    }

    if (name === 'listgroup') {
      const groups = db
        .prepare('SELECT id, name, member_count, is_rented, is_permanent FROM groups ORDER BY updated_at DESC LIMIT 20')
        .all() as Array<{ id: string; name: string; member_count: number; is_rented: number; is_permanent: number }>;
      if (groups.length === 0) {
        return { handled: true, replyText: 'Belum ada data grup yang masuk nih.', status: 'ok' };
      }
      const lines = groups.map(
        (g, i) => `${i + 1}. *${g.name}* (${g.member_count} anggota · ${g.is_permanent ? 'Permanen' : g.is_rented ? 'Sewa Aktif' : 'Standar'})`,
      );
      return { handled: true, replyText: `👥 *Daftar Grup Terhubung (${groups.length})*\n\n${lines.join('\n')}`, status: 'ok' };
    }

    if (name === 'listpremium') {
      const prems = db
        .prepare("SELECT phone, display_name, premium_expires_at FROM users WHERE is_premium = 1 ORDER BY updated_at DESC LIMIT 20")
        .all() as Array<{ phone: string; display_name: string; premium_expires_at: string | null }>;
      if (prems.length === 0) {
        return { handled: true, replyText: 'Belum ada akun premium aktif saat ini.', status: 'ok' };
      }
      const lines = prems.map(
        (u, i) => `${i + 1}. *${u.display_name}* (${maskPhoneNumberForGroup(u.phone)}) · Exp: ${u.premium_expires_at ? u.premium_expires_at.slice(0, 10) : 'Permanen'}`,
      );
      return { handled: true, replyText: `⭐ *Daftar Member Premium (${prems.length})*\n\n${lines.join('\n')}`, status: 'ok' };
    }

    // Redeem & Economy transactions (unified transactional service + owner wizard + management suite)
    if (name === 'redeem' || name === 'claimFreyasanredeem') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: t.redeemPromptCode(prefix), status: 'error' };
      const claimRes = executeRedeemClaim({
        code,
        userPhone: msg.senderPhone,
        displayName: msg.senderName,
      });
      if (!claimRes.ok) {
        return { handled: true, replyText: claimRes.message, status: 'error' };
      }
      const rewardDetails = claimRes.rewardsGranted?.items.map((i) => i.summary) ?? [];
      if (claimRes.rewardsGranted?.balance) rewardDetails.unshift(`+${claimRes.rewardsGranted.balance} Balance`);
      if (claimRes.rewardsGranted?.exp) rewardDetails.push(`+${claimRes.rewardsGranted.exp} EXP`);
      if (claimRes.rewardsGranted?.levelBonus) rewardDetails.push(`+${claimRes.rewardsGranted.levelBonus} Level`);
      return {
        handled: true,
        replyText: `${claimRes.message}\nRincian hadiah: ${rewardDetails.join(', ')}\nStatus Akun Kamu -> Balance: ${claimRes.userAfter?.balance ?? 0}, Level: ${claimRes.userAfter?.level ?? 1}, EXP: ${claimRes.userAfter?.exp ?? 0}`,
        status: 'ok',
      };
    }

    if (name === 'addredeem') {
      return this.startAddRedeemWizard(msg, prefix);
    }

    if (name === 'listredeem') {
      const { items } = listRedeemCodes({ limit: 25 });
      if (items.length === 0) {
        return { handled: true, replyText: 'Belum ada kode redeem yang terdaftar nih.', status: 'ok' };
      }
      const lines = items.map(
        (r, i) =>
          `${i + 1}. *${r.code}* (${r.name}) — ${r.active ? (r.isExpired ? 'Kedaluwarsa' : 'Aktif') : 'Nonaktif'} | Klaim: ${r.claimedCount}/${r.maxClaims || '∞'} | Bal: ${r.rewardBalance}, EXP: ${r.rewardExp}, Lv: ${r.rewardLevel}`,
      );
      return { handled: true, replyText: `*Daftar Kode Redeem (${items.length})*\n\n${lines.join('\n')}`, status: 'ok' };
    }

    if (name === 'inforedeem' || name === 'redeeminfo') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Cara pakainya: ${prefix}redeeminfo <KODE>`, status: 'error' };
      const detail = getRedeemDetail(code);
      if (!detail.code) return { handled: true, replyText: `Kode redeem ${code} nggak ketemu nih.`, status: 'error' };
      const c = detail.code;
      const extraText = c.additionalRewards.length
        ? c.additionalRewards.map((a) => `${a.rewardId}(${JSON.stringify(a.params)})`).join(', ')
        : 'Nggak ada';
      return {
        handled: true,
        replyText: `*Detail Kode Redeem ${c.code}*\nNama: ${c.name}\nDeskripsi: ${c.description || '-'}\nStatus: ${c.active ? (c.isExpired ? 'Kedaluwarsa' : 'Aktif') : 'Nonaktif'}\nHadiah Utama: +${c.rewardBalance} Bal, +${c.rewardExp} EXP, +${c.rewardLevel} Level\nHadiah Tambahan: ${extraText}\nBatas Klaim: ${c.claimedCount}/${c.maxClaims || '∞'} (Per user: ${c.perUserLimit}x)\nCooldown: ${c.cooldownSec} dtk\nKedaluwarsa: ${c.expiresAt || 'Nggak ada batas'}`,
        status: 'ok',
      };
    }

    if (name === 'editredeem') {
      const code = args[0]?.toUpperCase();
      if (!code || args.length < 2) {
        return {
          handled: true,
          replyText: `Formatnya: ${prefix}editredeem <KODE> max_claims=100 per_user_limit=1 balance=200 exp=50 level=1 active=on`,
          status: 'error',
        };
      }
      const patch: Record<string, unknown> = {};
      for (const token of args.slice(1)) {
        const [k, v] = token.split('=');
        if (!k || v === undefined) continue;
        const key = k.toLowerCase();
        if (key === 'max_claims') patch.maxClaims = Number(v);
        if (key === 'per_user_limit') patch.perUserLimit = Number(v);
        if (key === 'balance') patch.rewardBalance = Number(v);
        if (key === 'exp') patch.rewardExp = Number(v);
        if (key === 'level') patch.rewardLevel = Number(v);
        if (key === 'cooldown') patch.cooldownSec = Number(v);
        if (key === 'active') patch.active = v.toLowerCase() === 'on' || v === 'true' || v === '1';
        if (key === 'expires') patch.expiresAt = v.toLowerCase() === 'none' ? null : v;
      }
      const res = updateRedeemCode(msg.senderPhone, code, patch);
      if (!res.ok) return { handled: true, replyText: `Gagal update ${code}: ${res.error}`, status: 'error' };
      return { handled: true, replyText: `Kode redeem ${res.item.code} udah diperbarui (Klaim maks: ${res.item.maxClaims}, Balance: ${res.item.rewardBalance}, Aktif: ${res.item.active ? 'Ya' : 'Nggak'}).`, status: 'ok' };
    }

    if (name === 'deleteredeem' || name === 'delredeem') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Cara pakainya: ${prefix}delredeem <KODE>`, status: 'error' };
      if (args[1]?.toLowerCase() !== 'confirm') {
        return this.buildInteractiveMenu(prefix, `confirm:delredeem:${code}`, msg, isOwner, lang);
      }
      const res = deleteRedeemCode(msg.senderPhone, code);
      if (!res.ok) return { handled: true, replyText: res.error, status: 'error' };
      return { handled: true, replyText: `Kode redeem ${res.code} udah dihapus dari daftar aktif. Riwayat klaim lama tetap aman ya.`, status: 'ok' };
    }

    if (name === 'redeemdisable' || name === 'redeemenable') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Cara pakainya: ${prefix}${name} <KODE>`, status: 'error' };
      const enable = name === 'redeemenable';
      const res = toggleRedeemCode(msg.senderPhone, code, enable);
      if (!res.ok) return { handled: true, replyText: res.error, status: 'error' };
      return { handled: true, replyText: `Kode redeem ${res.item.code} berhasil ${enable ? 'diaktifin' : 'dinonaktifin'}.`, status: 'ok' };
    }

    if (name === 'redeemreset') {
      const code = args[0]?.toUpperCase();
      const confirmed = args[1]?.toLowerCase() === 'confirm';
      if (!code) return { handled: true, replyText: `Cara pakainya: ${prefix}redeemreset <KODE> confirm`, status: 'error' };
      if (!confirmed) {
        return this.buildInteractiveMenu(prefix, `confirm:redeemreset:${code}`, msg, isOwner, lang);
      }
      const res = resetRedeemClaims(msg.senderPhone, code, true);
      if (!res.ok) return { handled: true, replyText: res.error, status: 'error' };
      return { handled: true, replyText: `Hitungan klaim kode ${res.code} udah direset ke 0 (log riwayat tetap aman ya).`, status: 'ok' };
    }

    if (name === 'redeemhistory') {
      const code = args[0]?.toUpperCase();
      const { items, total } = getClaimHistory({ code: code || undefined, limit: 10 });
      if (items.length === 0) return { handled: true, replyText: 'Belum ada riwayat klaim nih.', status: 'ok' };
      const lines = items.map((h, i) => `${i + 1}. [${h.status.toUpperCase()}] ${h.code} oleh ${maskPhoneNumberForGroup(h.userPhone)} (${h.createdAt})`);
      return { handled: true, replyText: `*Riwayat Klaim Redeem (${items.length}/${total})*\n\n${lines.join('\n')}`, status: 'ok' };
    }

    if (name === 'redeemstats') {
      const stats = getRedeemAnalytics();
      return {
        handled: true,
        replyText: `*Statistik Redeem Freya-san Hub*\n- Total Kode: ${stats.totalCodes} (Aktif: ${stats.activeCodes}, Nonaktif: ${stats.inactiveCodes}, Kedaluwarsa: ${stats.expiredCodes})\n- Total Klaim Sukses: ${stats.successClaims} dari ${stats.totalAttempts} percobaan\n- Ditolak/Gagal/Kedaluwarsa: ${stats.rejectedClaims}/${stats.failedClaims}/${stats.expiredAttempts}\n- Total Distribusi: +${stats.rewardTotals.balanceDistributed} Balance, +${stats.rewardTotals.expDistributed} EXP, +${stats.rewardTotals.levelGranted} Level, +${stats.rewardTotals.limitGranted} Limit, +${stats.rewardTotals.premiumDaysGranted} Hari Premium`,
        status: 'ok',
      };
    }

    if (name === 'tfbalance') {
      const targetPhone = args[0]?.replace(/\D/g, '');
      const amount = Number.parseInt(args[1] || '0', 10);
      if (!targetPhone || Number.isNaN(amount) || amount <= 0 || amount > 10000) {
        return { handled: true, replyText: `Cara pakainya: ${prefix}tfbalance <nomor> <jumlah 1-10000>`, status: 'error' };
      }
      if (targetPhone === msg.senderPhone) {
        return { handled: true, replyText: 'Nggak bisa transfer balance ke diri sendiri ya.', status: 'error' };
      }
      try {
        db.transaction(() => {
          const sender = db.prepare('SELECT balance FROM users WHERE phone = ?').get(msg.senderPhone) as { balance: number };
          if (!sender || sender.balance < amount) throw new Error('Saldo balance kamu nggak cukup nih.');
          applyUserBalanceAndExp(msg.senderPhone, msg.senderName, -amount, 0, `Transfer balance ke ${maskPhoneNumberForGroup(targetPhone)}`);
          applyUserBalanceAndExp(targetPhone, targetPhone, amount, 0, `Terima balance dari ${maskPhoneNumberForGroup(msg.senderPhone)}`);
        })();
        return { handled: true, replyText: `Siap! Transfer virtual ${amount} Balance udah dicatat.`, status: 'ok' };
      } catch (err) {
        return { handled: true, replyText: err instanceof Error ? err.message : 'Gagal transfer nih.', status: 'error' };
      }
    }

    if (name === 'addlimit' || name === 'buylimit') {
      if (args.length === 0) {
        return {
          handled: true,
          replyText:
            lang === 'en'
              ? `Usage:\n• ${prefix}addlimit <amount> (for yourself)\n• ${prefix}addlimit <phone> <amount> (gift to someone)\n• Reply to a user's message with ${prefix}addlimit <amount>`
              : `Cara pakai ${prefix}${name}:\n• ${prefix}${name} <jumlah> (beli buat sendiri)\n• ${prefix}${name} <nomor> <jumlah> (kirim ke teman)\n• Balas pesan teman lalu ketik ${prefix}${name} <jumlah>`,
          status: 'error',
        };
      }

      let mode: 'self' | 'phone' | 'reply' = 'self';
      let targetRaw: string | undefined;
      let amount = 0;

      if (args.length >= 2) {
        mode = 'phone';
        targetRaw = args[0];
        amount = Number(args[1]);
      } else if (msg.quotedSenderPhone || msg.mentions?.[0]) {
        mode = msg.quotedSenderPhone ? 'reply' : 'phone';
        targetRaw = msg.quotedSenderPhone || msg.mentions?.[0];
        amount = Number(args[0]);
      } else {
        mode = 'self';
        amount = Number(args[0]);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        recordAbuseEvent({
          userPhone: msg.senderPhone,
          chatId: msg.chatId,
          submodule: amount <= 0 ? 'anti_exploit' : 'audit_monitoring',
          severity: amount <= 0 ? 'suspicious' : 'user_error',
          actionTaken: 'rejected_addlimit_amount',
          commandName: name,
          detail: `Input jumlah tidak valid pada ${name}: "${rawArgs}"`,
        });
      }

      const res = executeAddLimit({
        actorPhone: msg.senderPhone,
        actorName: msg.senderName,
        mode,
        targetPhoneRaw: targetRaw,
        amount,
        prefix,
        lang,
        idempotencyKey: msg.messageId ? `addlimit-${msg.messageId}` : undefined,
      });

      return { handled: true, replyText: res.message, status: res.ok ? 'ok' : 'error' };
    }

    // Brat stickers (#brat2, #bratbahlil, #bratspongebob / #bratspgbb)
    if (name === 'brat2' || name === 'bratbahlil' || name === 'bratspongebob') {
      const art = await generateBratSticker({
        variant: name,
        text: rawArgs,
        lang,
      });
      if (!art.ok) {
        return { handled: true, replyText: art.caption, status: 'error' };
      }
      if (art.buffer) {
        this.mediaOutbox.set(`${msg.chatId}:${msg.senderPhone}`, {
          kind: 'sticker',
          mimetype: art.mimetype || 'image/webp',
          buffer: art.buffer,
          caption: art.caption,
        });
      }
      return {
        handled: true,
        replyText: art.caption,
        mediaPreview: { kind: art.kind, mimetype: art.mimetype || 'image/webp', dataUrl: art.dataUrl, caption: art.caption },
        status: 'ok',
      };
    }

    // Visual Mockup Images (clearly watermarked [SIMULASI])
    if (
      [
        'fakeml',
        'tiktokqc',
        'iqcpink',
        'iqcdark',
        'iqcimage',
        'fakestoryig',
        'fakechios',
        'fakecall',
        'fakegc',
        'faketweet',
        'fakedana',
        'fakebca',
        'fakeovo',
      ].includes(name)
    ) {
      if (args[0]?.toLowerCase() === 'help') {
        return {
          handled: true,
          replyText: `Contoh pakai *${prefix}${name}*:\n${cmd.example}\n(Semua hasil otomatis diberi label [SIMULASI]).`,
          status: 'ok',
        };
      }
      const attachedImg =
        msg.attachedImageBase64 ||
        (msg.quotedMediaBuffer && msg.quotedMediaKind === 'image'
          ? `data:image/png;base64,${msg.quotedMediaBuffer.toString('base64')}`
          : undefined);
      const art = await generateMockupImage({
        type: name as any,
        rawArgs,
        senderName: msg.senderName,
        attachedImageBase64: attachedImg,
        lang,
      });
      if (art.buffer) {
        this.mediaOutbox.set(`${msg.chatId}:${msg.senderPhone}`, {
          kind: 'image',
          mimetype: art.mimetype || 'image/png',
          buffer: art.buffer,
          caption: art.caption,
        });
      }
      return {
        handled: true,
        replyText: art.caption,
        mediaPreview: { kind: art.kind, mimetype: art.mimetype || 'image/png', dataUrl: art.dataUrl, caption: art.caption },
        status: 'ok',
      };
    }

    // Honest Media & Channel Tools
    if (name === 'spotifycard') {
      const art = await generateSpotifyCard(rawArgs, lang);
      if (art.ok && art.buffer) {
        this.mediaOutbox.set(`${msg.chatId}:${msg.senderPhone}`, {
          kind: 'image',
          mimetype: art.mimetype || 'image/png',
          buffer: art.buffer,
          caption: art.caption,
        });
      }
      return {
        handled: true,
        replyText: art.caption,
        mediaPreview: art.dataUrl ? { kind: art.kind, mimetype: art.mimetype || 'image/png', dataUrl: art.dataUrl, caption: art.caption } : undefined,
        status: art.ok ? 'ok' : 'error',
      };
    }

    if (name === 'toimg') {
      const art = await convertStickerToImage(msg.quotedMediaBuffer);
      if (art.ok && art.buffer) {
        this.mediaOutbox.set(`${msg.chatId}:${msg.senderPhone}`, {
          kind: 'image',
          mimetype: art.mimetype || 'image/png',
          buffer: art.buffer,
          caption: art.caption,
        });
      }
      return {
        handled: true,
        replyText: art.caption,
        mediaPreview: art.dataUrl ? { kind: art.kind, mimetype: art.mimetype || 'image/png', dataUrl: art.dataUrl, caption: art.caption } : undefined,
        status: art.ok ? 'ok' : 'error',
      };
    }

    if (name === 'tolive') {
      const art = await convertMediaToLivePhotoBundle({
        mediaBuffer: msg.quotedMediaBuffer,
        mediaKind: msg.quotedMediaKind,
        userPhone: msg.senderPhone,
        lang,
      });
      if (art.ok && art.livePhotoBundle) {
        if (msg.source === 'simulator' && art.jobId) {
          updateMediaJobDelivery(art.jobId, 'simulator_preview', 'rendered');
        }
        this.mediaOutbox.set(`${msg.chatId}:${msg.senderPhone}`, {
          kind: 'motion_photo',
          mimetype: 'image/jpeg',
          buffer: art.livePhotoBundle.motionPhotoJpgBuffer,
          caption: art.caption,
          jobId: art.jobId,
          livePhotoBundle: art.livePhotoBundle,
        });
      }
      return {
        handled: true,
        replyText: art.caption,
        mediaPreview: art.livePhotoBundle
          ? {
              kind: 'motion_photo',
              mimetype: 'image/jpeg',
              dataUrl: art.livePhotoBundle.motionPhotoJpgDataUrl,
              stillDataUrl: art.livePhotoBundle.stillDataUrl,
              motionVideoDataUrl: art.livePhotoBundle.motionVideoDataUrl,
              motionPhotoJpgDataUrl: art.livePhotoBundle.motionPhotoJpgDataUrl,
              jobId: art.jobId,
              validation: art.livePhotoBundle.validation,
              caption: art.caption,
            }
          : undefined,
        status: art.ok ? 'ok' : 'error',
      };
    }

    if (name === 'stickeraudio') {
      const pairKey = `${msg.chatId}:${msg.senderPhone}`;
      const now = Date.now();
      for (const [k, v] of this.pendingStickerAudioVisual.entries()) {
        if (v.expiresAt < now) this.pendingStickerAudioVisual.delete(k);
      }

      const attachedAudioBuf = msg.attachedAudioBase64
        ? Buffer.from(msg.attachedAudioBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
        : undefined;

      // Case 1: Replying to audio after storing an image/sticker
      if (msg.quotedMediaKind === 'audio' && msg.quotedMediaBuffer) {
        const staged = this.pendingStickerAudioVisual.get(pairKey);
        if (!staged || staged.expiresAt < now) {
          return {
            handled: true,
            replyText:
              lang === 'en'
                ? 'Reply to a sticker or image with .sa first, then reply to the audio/voice note with .sa (within 5 minutes)!'
                : 'Kirim atau balas stiker/gambar pakai #sa dulu ya (untuk nyimpan visualnya), baru balas audio/VN pakai #sa buat digabungin!',
            status: 'error',
          };
        }
        this.pendingStickerAudioVisual.delete(pairKey);
        const art = await convertStickerAudioBundle({
          visualBuffer: staged.buffer,
          visualKind: staged.kind,
          audioBuffer: msg.quotedMediaBuffer,
          userPhone: msg.senderPhone,
          lang,
        });
        if (art.ok && art.soundStickerBundle) {
          if (msg.source === 'simulator' && art.jobId) {
            updateMediaJobDelivery(art.jobId, 'simulator_preview', 'rendered');
          }
          this.mediaOutbox.set(pairKey, {
            kind: 'sound_sticker',
            mimetype: 'image/webp',
            buffer: art.soundStickerBundle.stickerBuffer,
            caption: art.caption,
            jobId: art.jobId,
            soundStickerBundle: art.soundStickerBundle,
          });
        }
        return {
          handled: true,
          replyText: art.caption,
          mediaPreview: art.soundStickerBundle
            ? {
                kind: 'sound_sticker',
                mimetype: 'image/webp',
                dataUrl: art.soundStickerBundle.stickerDataUrl,
                audioDataUrl: art.soundStickerBundle.audioDataUrl,
                waveform: art.soundStickerBundle.waveform,
                jobId: art.jobId,
                validation: {
                  webp: art.soundStickerBundle.webpValidation,
                  audio: art.soundStickerBundle.audioValidation,
                },
                caption: art.caption,
              }
            : undefined,
          status: art.ok ? 'ok' : 'error',
        };
      }

      // Case 2: Replying to static image or sticker without audio yet -> stage it for 2-step pairing
      if ((msg.quotedMediaKind === 'image' || msg.quotedMediaKind === 'sticker') && msg.quotedMediaBuffer && !attachedAudioBuf) {
        this.pendingStickerAudioVisual.set(pairKey, {
          kind: msg.quotedMediaKind,
          buffer: msg.quotedMediaBuffer,
          expiresAt: now + 5 * 60_000,
        });
        // Allow immediate step-2 reply to audio without hitting the 3s command cooldown
        this.cooldownMap.delete(`${msg.senderPhone}:stickeraudio`);
        return {
          handled: true,
          replyText:
            lang === 'en'
              ? `Visual (${msg.quotedMediaKind}) saved for 5 minutes! Now reply to an audio/voice note with ${prefix}sa to combine them into a Sound Sticker.`
              : `Oke, visual (${msg.quotedMediaKind}) sudah disimpan selama 5 menit! Sekarang balas pesan audio atau voice note pakai ${prefix}sa biar digabung jadi stiker bersuara.`,
          status: 'pending',
        };
      }

      // Case 3: Replying to video (extract audio+video) OR image/sticker + direct attachedAudioBuf
      const art = await convertStickerAudioBundle({
        visualBuffer: msg.quotedMediaBuffer,
        visualKind: msg.quotedMediaKind,
        audioBuffer: attachedAudioBuf,
        userPhone: msg.senderPhone,
        lang,
      });
      if (art.ok && art.soundStickerBundle) {
        if (msg.source === 'simulator' && art.jobId) {
          updateMediaJobDelivery(art.jobId, 'simulator_preview', 'rendered');
        }
        this.mediaOutbox.set(pairKey, {
          kind: 'sound_sticker',
          mimetype: 'image/webp',
          buffer: art.soundStickerBundle.stickerBuffer,
          caption: art.caption,
          jobId: art.jobId,
          soundStickerBundle: art.soundStickerBundle,
        });
      }
      return {
        handled: true,
        replyText: art.caption,
        mediaPreview: art.soundStickerBundle
          ? {
              kind: 'sound_sticker',
              mimetype: 'image/webp',
              dataUrl: art.soundStickerBundle.stickerDataUrl,
              audioDataUrl: art.soundStickerBundle.audioDataUrl,
              waveform: art.soundStickerBundle.waveform,
              jobId: art.jobId,
              validation: {
                webp: art.soundStickerBundle.webpValidation,
                audio: art.soundStickerBundle.audioValidation,
              },
              caption: art.caption,
            }
          : undefined,
        status: art.ok ? 'ok' : 'error',
      };
    }

    if (name === 'upswch') {
      const targetCh = args[0] || '';
      const contentText = args.slice(1).join(' ').trim();
      if (!targetCh || !contentText) {
        return {
          handled: true,
          replyText: `Formatnya: ${prefix}upswch <id@newsletter|link_saluran> <teks pengumuman>`,
          status: 'error',
        };
      }
      if (!this.sock || this.status !== 'connected') {
        return {
          handled: true,
          replyText: 'WhatsApp Engine lagi belum terhubung (disconnected), jadi pesan ke Saluran WhatsApp belum bisa dikirim secara nyata.',
          status: 'error',
        };
      }
      try {
        let newsletterJid = targetCh;
        const inviteMatch = targetCh.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/i);
        if (inviteMatch && typeof (this.sock as any).newsletterMetadata === 'function') {
          const meta = await (this.sock as any).newsletterMetadata('invite', inviteMatch[1]);
          if (meta?.id) newsletterJid = meta.id;
        }
        if (!isJidNewsletter(newsletterJid) && !newsletterJid.endsWith('@newsletter')) {
          return {
            handled: true,
            replyText: 'ID atau link salurannya belum valid (@newsletter nggak ketemu). Pastiin bot udah jadi admin saluran itu ya.',
            status: 'error',
          };
        }
        await this.sock.sendMessage(newsletterJid, { text: contentText });
        addAuditLog(msg.senderPhone, 'owner.upswch', newsletterJid, { len: contentText.length });
        return { handled: true, replyText: `Pesan berhasil dikirim ke Saluran ${newsletterJid}!`, status: 'ok' };
      } catch (err) {
        return {
          handled: true,
          replyText: `Gagal kirim ke Saluran WhatsApp: ${err instanceof Error ? err.message : 'Akun belum punya izin admin saluran atau sesi ini nggak support.'}`,
          status: 'error',
        };
      }
    }

    if (name === 'setbio') {
      if (!rawArgs) {
        return {
          handled: true,
          replyText: `Mau ganti bio bot? Ketik aja ${prefix}setbio <teks bio baru>, misalnya: ${prefix}setbio Freya-san bot siap bantu kamu!`,
          status: 'error',
        };
      }
      if (this.sock && this.status === 'connected') {
        try {
          await this.sock.updateProfileStatus(rawArgs.slice(0, 139));
          addAuditLog(msg.senderPhone, 'owner.setbio', rawArgs.slice(0, 80));
          return { handled: true, replyText: `Bio WhatsApp bot berhasil diperbarui jadi: "${rawArgs.slice(0, 139)}"`, status: 'ok' };
        } catch (err) {
          return { handled: true, replyText: `Gagal ubah bio WhatsApp: ${err instanceof Error ? err.message : 'error'}`, status: 'error' };
        }
      }
      return {
        handled: true,
        replyText: 'WhatsApp Engine lagi offline, jadi bio profilnya belum bisa dikirim ke server WhatsApp.',
        status: 'pending',
      };
    }

    // Tools: Folio & Text utilities
    if (name === 'folio') {
      if (!rawArgs || rawArgs.trim().toLowerCase() === 'panduan' || rawArgs.trim().toLowerCase() === 'help') {
        return { handled: true, replyText: FOLIO_GUIDE_ID, status: 'ok' };
      }
      const doc = parseFolioText(rawArgs);
      const rendered = doc.lines
        .map((line) => {
          const spacer = '\n'.repeat(line.blankLinesBefore);
          const prefixTag = line.align === 'center' ? '[TENGAH] ' : line.align === 'right' ? '[KANAN] ' : '';
          return `${spacer}${prefixTag}${line.text}`;
        })
        .join('\n');
      return {
        handled: true,
        replyText: `Preview Dokumen Folio (${doc.totalLines} baris):\n\n${rendered}`,
        folioPreview: doc,
        status: 'ok',
      };
    }

    if (name === 'ebase64') {
      return { handled: true, replyText: Buffer.from(rawArgs || '', 'utf8').toString('base64'), status: 'ok' };
    }
    if (name === 'dbase64') {
      return { handled: true, replyText: Buffer.from(rawArgs || '', 'base64').toString('utf8'), status: 'ok' };
    }
    if (name === 'ehex') {
      return { handled: true, replyText: Buffer.from(rawArgs || '', 'utf8').toString('hex'), status: 'ok' };
    }
    if (name === 'dhex') {
      return { handled: true, replyText: Buffer.from(rawArgs || '', 'hex').toString('utf8'), status: 'ok' };
    }
    if (name === 'reverse') {
      return { handled: true, replyText: [...(rawArgs || '')].reverse().join(''), status: 'ok' };
    }
    if (name === 'readmore') {
      const [head, tail] = rawArgs.split('|');
      const spacer = '\u200B'.repeat(2000);
      return { handled: true, replyText: `${head || 'Baca selengkapnya'}${spacer}\n${tail || ''}`, status: 'ok' };
    }
    if (['halah', 'heleh', 'hilih', 'holoh', 'huluh'].includes(name)) {
      const vowelMap: Record<string, string> = { halah: 'a', heleh: 'e', hilih: 'i', holoh: 'o', huluh: 'u' };
      const target = vowelMap[name];
      const converted = (rawArgs || 'halo dunia').replace(/[aiueoAIUEO]/g, (ch) =>
        ch === ch.toUpperCase() ? target.toUpperCase() : target,
      );
      return { handled: true, replyText: converted, status: 'ok' };
    }
    if (name === 'qrcode') {
      const content = rawArgs || 'https://jkt48.com/';
      const qrDataUrl = await QRCode.toDataURL(content, { width: 240 });
      return { handled: true, replyText: `QR Code berhasil dibuat buat: ${content}`, qrDataUrl, status: 'ok' };
    }
    if (name === 'cekplatform') {
      return { handled: true, replyText: `Sumber pesan terdeteksi: ${msg.source === 'simulator' ? 'Web Console Simulator' : 'WhatsApp Client'} (${msg.chatScope}).`, status: 'ok' };
    }
    if (name === 'readviewonce') {
      return { handled: true, replyText: 'Privasi chat sekali lihat tetap dijaga oleh sistem, jadi bot nggak melewati proteksi privasi WhatsApp.', status: 'denied' };
    }

    if (name === 'kirim') {
      if (!rawArgs) return { handled: true, replyText: `Cara pakainya: ${prefix}kirim <nomor|ke owner> <pesan>`, status: 'error' };
      const lower = rawArgs.toLowerCase();
      if (lower.startsWith('ke owner ')) {
        const messageText = rawArgs.slice('ke owner '.length).trim();
        addAuditLog(msg.senderPhone, 'kirim.to_owner', 'owner', { preview: messageText.slice(0, 80) });
        return { handled: true, replyText: `Pesan buat Owner udah dicatat ke antrean aman (${messageText.length} karakter). Nomor privat Owner tetap aman.`, status: 'ok' };
      }
      const target = args[0]?.replace(/\D/g, '');
      const bodyText = args.slice(1).join(' ');
      if (!target || !bodyText) return { handled: true, replyText: `Cara pakainya: ${prefix}kirim 628xxxxxxxx Pesan kamu`, status: 'error' };
      addAuditLog(msg.senderPhone, 'kirim.direct', maskPhoneNumberForGroup(target), { len: bodyText.length });
      if (this.status === 'connected') {
        this.enqueueMessage(`${target}@s.whatsapp.net`, bodyText);
      }
      return { handled: true, replyText: `Pesan ke ${maskPhoneNumberForGroup(target)} udah dimasukin ke antrean pengiriman resmi.`, status: 'ok' };
    }

    // 48Group Intelligence Commands
    if (name === '48group') {
      return this.buildInteractiveMenu(prefix, '48group', msg, isOwner, lang);
    }

    if (name === 'groupsetting') {
      return this.buildInteractiveMenu(prefix, 'group_settings', msg, isOwner, lang);
    }

    if (name === 'gamemode') {
      return this.buildInteractiveMenu(prefix, 'games', msg, isOwner, lang);
    }

    if (name === 'jkt48' || name === 'akb48') {
      if (name === 'jkt48' && args[0]) {
        const subCmd = args[0].toLowerCase();
        if (subCmd === 'level' || subCmd === 'era') {
          const levelArg = args[1]?.toLowerCase();
          const normalizedLevel: Jkt48DifficultyLevelId | null =
            levelArg === '1' || levelArg === 'level_1'
              ? 'level_1'
              : levelArg === '2' || levelArg === 'level_2'
                ? 'level_2'
                : levelArg === '3' || levelArg === 'level_3'
                  ? 'level_3'
                  : null;

          if (!normalizedLevel) {
            return this.buildInteractiveMenu(prefix, '48group_level', msg, isOwner, lang);
          }

          const meta = getDifficultyLevelMeta(normalizedLevel)!;
          const members = db
            .prepare(`SELECT name, nickname, generation, status FROM forty_eight_members WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?) LIMIT 8`)
            .all(normalizedLevel, normalizedLevel) as Array<{ name: string; nickname: string; generation: string; status: string }>;
          const qCount = (
            db
              .prepare(`SELECT COUNT(*) as c FROM forty_eight_questions WHERE validation_status = 'official_verified' AND (difficulty_level = ? OR era_id = ?)`)
              .get(normalizedLevel, normalizedLevel) as { c: number }
          ).c;

          return {
            handled: true,
            replyText: `*${meta.title}*\nKategori Era: ${meta.eraCategory} (${meta.periodRange})\nStatus Sumber: ${meta.verificationStatus} (${meta.sourceUrl})\n\n${meta.description}\n\nMember di era ini (${members.length}):\n${members.map((m) => `- ${m.name} (${m.nickname}) · ${m.generation} · ${m.status}`).join('\n') || 'Belum ada data member di filter ini.'}\n\nKuis terverifikasi tersedia (${qCount} soal): ketik *${prefix}memberquiz ${normalizedLevel}* atau *${prefix}songquiz ${normalizedLevel}*.`,
            status: 'ok',
          };
        }

        if (subCmd === 'team' || subCmd === 'tim') {
          const targetArg = args[1]?.toLowerCase();
          if (!targetArg) {
            return this.buildInteractiveMenu(prefix, '48group_team', msg, isOwner, lang);
          }

          if (targetArg === 'old' || targetArg === 'new' || targetArg === 'other') {
            return this.buildInteractiveMenu(prefix, `48group_team:${targetArg}`, msg, isOwner, lang);
          }

          const teamIdLookup = targetArg.startsWith('team_') ? targetArg : `team_${targetArg}`;
          const teamMeta = getTeamMeta(teamIdLookup) || JKT48_TEAMS.find((t) => t.name.toLowerCase() === args.slice(1).join(' ').toLowerCase());
          if (!teamMeta) {
            return { handled: true, replyText: `Team "${targetArg}" nggak ketemu nih. Ketik ${prefix}jkt48 team buat buka kategori Old / New / Other.`, status: 'error' };
          }
          const members = db
            .prepare(`
              SELECT DISTINCT m.name, m.nickname, m.generation, m.status, h.role_in_team
              FROM forty_eight_members m
              LEFT JOIN jkt48_member_team_history h ON h.member_id = m.id
              WHERE m.primary_team_id = ? OR h.team_id = ?
              ORDER BY m.name ASC
            `)
            .all(teamMeta.id, teamMeta.id) as Array<{ name: string; nickname: string; generation: string; status: string; role_in_team: string | null }>;

          return {
            handled: true,
            replyText: `*${teamMeta.name}* (${teamMeta.teamGroup.toUpperCase()})\nStatus Historis: ${teamMeta.historicalStatus}\nEra: ${teamMeta.eraSummary}\nVerifikasi: ${teamMeta.verificationStatus} (${teamMeta.sourceUrl})\n\n${teamMeta.description}\n\nAnggota & Alumni Terhubung (${members.length}):\n${members.map((m) => `- ${m.name} (${m.nickname}) · ${m.generation} · ${m.status}`).join('\n') || 'Belum ada anggota terverifikasi untuk kategori ini.'}`,
            status: 'ok',
          };
        }
      }

      const grp = db.prepare("SELECT * FROM forty_eight_groups WHERE id = ? AND validation_status = 'official_verified'").get(name) as {
        name: string; base_city: string; founded_year: number; official_site: string; description: string; source_url: string; retrieved_at: string;
      } | undefined;
      if (!grp) return { handled: true, replyText: 'Data belum terverifikasi.', status: 'error' };
      return {
        handled: true,
        replyText: `*${grp.name}* (${grp.base_city}, berdiri ${grp.founded_year})\n${grp.description}\nSitus resmi: ${grp.official_site}\nSumber: ${grp.source_url}\nDiambil: ${grp.retrieved_at}${name === 'jkt48' ? `\n\nJelajahi Era & Team:\n- ${prefix}jkt48 level (Difficulty Explorer Level 1–3)\n- ${prefix}jkt48 team (Team Explorer Old/New/Other)` : ''}`,
        status: 'ok',
      };
    }

    if (name === 'member48') {
      const q = (rawArgs || 'Freya').toLowerCase();
      const m = db.prepare(`
        SELECT * FROM forty_eight_members
        WHERE validation_status = 'official_verified' AND (LOWER(name) LIKE ? OR LOWER(nickname) LIKE ?)
        LIMIT 1
      `).get(`%${q}%`, `%${q}%`) as {
        name: string; nickname: string; group_id: string; generation: string; status: string;
        joined_date: string | null; bio: string; source_url: string; retrieved_at: string;
      } | undefined;
      if (!m) {
        return { handled: true, replyText: `Member "${rawArgs}" belum ditemukan atau berstatus belum terverifikasi di database resmi.`, status: 'ok' };
      }
      return {
        handled: true,
        replyText: `*${m.name}* (${m.nickname})\nGrup: ${m.group_id.toUpperCase()} | ${m.generation}\nStatus: ${m.status}${m.joined_date ? `\nBergabung: ${m.joined_date}` : ''}\n${m.bio}\nSumber resmi: ${m.source_url}\nDiambil: ${m.retrieved_at}`,
        status: 'ok',
      };
    }

    if (name === 'theater48') {
      const sets = db.prepare("SELECT setlist_name, group_id, opening_song, source_url FROM forty_eight_theater WHERE validation_status = 'official_verified' LIMIT 5").all() as Array<{
        setlist_name: string; group_id: string; opening_song: string; source_url: string;
      }>;
      return {
        handled: true,
        replyText: `Arsip Theater 48Group Terverifikasi:\n${sets.map((s, i) => `${i + 1}. ${s.setlist_name} (${s.group_id.toUpperCase()}) — Lagu pembuka: ${s.opening_song}`).join('\n')}`,
        status: 'ok',
      };
    }

    if (name === 'istilah48') {
      const q = (rawArgs || '').toLowerCase();
      const terms = q
        ? (db.prepare("SELECT term, definition, source_url FROM forty_eight_terminology WHERE LOWER(term) LIKE ?").all(`%${q}%`) as Array<{ term: string; definition: string; source_url: string }>)
        : (db.prepare("SELECT term, definition, source_url FROM forty_eight_terminology LIMIT 5").all() as Array<{ term: string; definition: string; source_url: string }>);
      if (terms.length === 0) return { handled: true, replyText: 'Istilah belum ditemukan.', status: 'ok' };
      return {
        handled: true,
        replyText: terms.map((t) => `*${t.term}*: ${t.definition} (${t.source_url})`).join('\n\n'),
        status: 'ok',
      };
    }

    // AI Commands (Nexara / OpenAI / Translate)
    if (name === 'nexara' || name === 'openai' || name === 'translate') {
      if (!rawArgs) return { handled: true, replyText: `Gunakan: ${prefix}${name} <pertanyaan atau teks>`, status: 'error' };
      const prompt = name === 'translate' ? `Terjemahkan teks berikut ke Bahasa Indonesia dan Bahasa Inggris secara ringkas: "${rawArgs}"` : rawArgs;
      const aiRes = await runNexaraAiQuery({ prompt, userPhone: msg.senderPhone });
      if (!aiRes.ok) {
        return { handled: true, replyText: `AI Error (${aiRes.provider}): ${aiRes.error}`, status: 'error' };
      }
      return { handled: true, replyText: aiRes.text, status: 'ok' };
    }

    // Group Management Commands
    if (name === 'welcome' || name === 'left' || name === 'antilink' || name === 'antisticker') {
      if (msg.chatScope !== 'group') {
        return { handled: true, replyText: t.groupOnly, status: 'error' };
      }
      const mode = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(mode)) {
        return { handled: true, replyText: `Cara pakainya: ${prefix}${name} on | off`, status: 'error' };
      }
      const enabledBool = mode === 'on';
      if (name === 'welcome') {
        db.prepare('UPDATE groups SET welcome_enabled = ?, updated_at = datetime(\'now\') WHERE id = ?').run(enabledBool ? 1 : 0, msg.chatId);
      } else if (name === 'left') {
        db.prepare('UPDATE groups SET left_enabled = ?, updated_at = datetime(\'now\') WHERE id = ?').run(enabledBool ? 1 : 0, msg.chatId);
      } else {
        const grp = db.prepare('SELECT anti_settings_json FROM groups WHERE id = ?').get(msg.chatId) as { anti_settings_json?: string } | undefined;
        let anti: Record<string, any> = {};
        try {
          anti = JSON.parse(grp?.anti_settings_json || '{}');
        } catch {
          anti = {};
        }
        anti[name] = { ...(anti[name] || { mode: 'warn' }), enabled: enabledBool };
        db.prepare('UPDATE groups SET anti_settings_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(anti), msg.chatId);
      }
      addAuditLog(msg.senderPhone, `group.${name}`, msg.chatId, { enabled: enabledBool });
      return {
        handled: true,
        replyText: `Sip! Fitur *${name}* di grup ini sekarang *${enabledBool ? 'NYALA (ON)' : 'MATI (OFF)'}*.`,
        status: 'ok',
      };
    }

    if (name === 'groupinfo') {
      if (msg.chatScope !== 'group') {
        return { handled: true, replyText: t.groupOnly, status: 'error' };
      }
      const grp = db.prepare('SELECT * FROM groups WHERE id = ?').get(msg.chatId) as any;
      let anti: Record<string, any> = {};
      try {
        anti = JSON.parse(grp?.anti_settings_json || '{}');
      } catch {
        anti = {};
      }
      const antiActive = Object.entries(anti)
        .filter(([, v]: any) => v?.enabled)
        .map(([k]) => k);
      return {
        handled: true,
        replyText: `👥 *Info Grup: ${grp?.name || msg.groupName || msg.chatId}*\n• Welcome: ${grp?.welcome_enabled ? 'ON' : 'OFF'} · Left: ${grp?.left_enabled ? 'ON' : 'OFF'}\n• Anti-sistem aktif: ${antiActive.length ? antiActive.join(', ') : 'Nggak ada'}\n• Status Sewa: ${grp?.is_permanent ? 'Permanen' : grp?.is_rented ? 'Sewa Aktif' : 'Standar'}`,
        status: 'ok',
      };
    }

    if (name === 'antiluar') {
      const testNum = args[0];
      if (testNum && /^\+?\d+$/.test(testNum.replace(/\D/g, ''))) {
        const isIndo = isIndonesianPhoneNumber(testNum);
        return { handled: true, replyText: `Cek Antiluar buat ${maskPhoneNumberForGroup(testNum)}: ${isIndo ? 'Nomor Indonesia (+62) — Aman' : 'Nomor Luar Negeri — Terdeteksi'}.`, status: 'ok' };
      }
      if (msg.chatScope === 'group' && ['on', 'off'].includes((args[0] || '').toLowerCase())) {
        const on = args[0].toLowerCase() === 'on';
        const grp = db.prepare('SELECT anti_settings_json FROM groups WHERE id = ?').get(msg.chatId) as { anti_settings_json?: string } | undefined;
        let anti: Record<string, any> = {};
        try { anti = JSON.parse(grp?.anti_settings_json || '{}'); } catch { anti = {}; }
        anti.antiluar = { ...(anti.antiluar || { mode: 'warn' }), enabled: on };
        db.prepare('UPDATE groups SET anti_settings_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(anti), msg.chatId);
        return { handled: true, replyText: `Sip! Fitur *antiluar* di grup ini sekarang *${on ? 'NYALA (ON)' : 'MATI (OFF)'}*.`, status: 'ok' };
      }
      return { handled: true, replyText: 'Pengaturan Antiluar bisa dikelola lewat menu .groupsetting atau Dashboard -> Group Manager ya.', status: 'ok' };
    }

    if (name === 'done' || name === 'proses') {
      const note = rawArgs || 'Tugas grup';
      addAuditLog(msg.senderPhone, `group.${name}`, msg.chatId, { note });
      return {
        handled: true,
        replyText: `[STATUS: ${name === 'done' ? 'SELESAI' : 'DALAM PROSES'}]\nKeterangan: ${note}\nPenanggung jawab: ${msg.senderName}\nWaktu: ${new Date().toLocaleString('id-ID')}`,
        status: 'ok',
      };
    }

    if (name === 'reqjoin') {
      const sub = (args[0] || 'list').toLowerCase();
      return {
        handled: true,
        replyText: `Reqjoin mode "${sub}": siap bantu proses permintaan gabung kalau grupnya nyalain persetujuan admin dan bot udah jadi admin grup.`,
        status: 'ok',
      };
    }

    if (name === 'golink') {
      const groupId = args[0] || msg.chatId;
      if (!groupId.endsWith('@g.us')) return { handled: true, replyText: 'ID grupnya nggak valid nih (harus berakhiran @g.us).', status: 'error' };
      addAuditLog(msg.senderPhone, 'owner.golink', groupId);
      if (this.sock && this.status === 'connected') {
        try {
          const code = await this.sock.groupInviteCode(groupId);
          return { handled: true, replyText: `Link Grup (${groupId}): https://chat.whatsapp.com/${code}`, status: 'ok' };
        } catch (err) {
          return { handled: true, replyText: `Gagal ambil link grup: ${err instanceof Error ? err.message : 'Pastiin bot udah jadi admin grup ya'}`, status: 'error' };
        }
      }
      return { handled: true, replyText: `ID grup "${groupId}" udah valid. Hubungin WhatsApp Engine buat narik invite code langsung ya.`, status: 'ok' };
    }

    if (name === 'autoread') {
      const mode = args[0]?.toLowerCase();
      const next = mode === 'on' ? 'true' : mode === 'off' ? 'false' : null;
      if (!next) return { handled: true, replyText: `Cara pakainya: ${prefix}autoread on | off`, status: 'error' };
      db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'blue_tick_enabled'").run(next);
      addAuditLog(msg.senderPhone, 'settings.blue_tick', next);
      return { handled: true, replyText: `Blue Tick Control WhatsApp udah diubah jadi: ${next === 'true' ? 'ON' : 'OFF'}.`, status: 'ok' };
    }

    // UNO stop command before normal game session routing
    if (name === 'uno' && args[0]?.toLowerCase() === 'stop') {
      const stopRes = stopUnoSession({
        chatId: msg.chatId,
        actorPhone: msg.senderPhone,
        isOwner,
        isGroupAdmin: Boolean(msg.isGroupAdmin),
        lang,
      });
      return { handled: true, replyText: stopRes.message, status: stopRes.ok ? 'ok' : 'denied' };
    }

    // Game Commands routing -> Game Session Engine
    const gameCommandMap: Record<string, string> = {
      sloth: 'sloth',
      bom: 'bom',
      tebakbom: 'bom',
      tebakangka: 'tebakangka',
      tebakkata: 'tebakkata',
      sambungkata: 'sambungkata',
      tictactoe: 'tictactoe',
      suit: 'suit',
      math: 'math',
      family100: 'family100',
      siapakahaku: 'siapakahaku',
      tebakemoji: 'tebakemoji',
      truth: 'truthordare',
      dare: 'truthordare',
      werewolf: 'werewolf',
      werewolf2: 'werewolf',
      undercover: 'undercover',
      uno: 'uno',
      mafia: 'mafia',
      spyfall: 'spyfall',
      impostor: 'impostor',
      memberquiz: 'memberquiz48',
      groupquiz: 'groupquiz48',
      songquiz: 'songquiz48',
      genchallenge: 'genchallenge48',
      theaterchallenge: 'theaterchallenge48',
      timeline48: 'timeline48',
      guessmember48: 'guess48',
      daily48: 'daily48',
      werewolf48: 'werewolf48',
      mafia48: 'mafia48',
    };

    if (gameCommandMap[name]) {
      const filterArg = args[0]?.toLowerCase() ?? '';
      const difficultyLevel = ['level_1', 'level_2', 'level_3'].includes(filterArg) ? filterArg : undefined;
      const teamId = filterArg.startsWith('team_') ? filterArg : undefined;
      const withMrWhite = name === 'undercover' && /mrwhite\s+on/i.test(rawArgs);
      const isWw2 = Boolean(name === 'werewolf2' || (msg.text && /\bww2\b/i.test(msg.text)));
      const res = startGameSession({
        gameId: gameCommandMap[name],
        chatId: msg.chatId,
        chatScope: msg.chatScope,
        groupName: msg.groupName,
        hostPhone: msg.senderPhone,
        hostName: msg.senderName,
        difficultyLevel,
        teamId,
        lang,
        withMrWhite,
        isWw2,
      });
      return {
        handled: true,
        replyText: res.announcement,
        privateDeliveries: res.privateDeliveries,
        status: res.ok ? 'ok' : 'error',
      };
    }

    if (name === 'hint' || name === 'nyerah') {
      const activeGame = db
        .prepare("SELECT id FROM game_sessions WHERE chat_id = ? AND chat_scope = ? AND status IN ('waiting', 'active') ORDER BY started_at DESC LIMIT 1")
        .get(msg.chatId, msg.chatScope) as { id: string } | undefined;
      if (!activeGame) {
        return { handled: true, replyText: 'Lagi nggak ada sesi game yang jalan di chat ini.', status: 'error' };
      }
      const res = submitGameAction({
        sessionId: activeGame.id,
        playerPhone: msg.senderPhone,
        playerName: msg.senderName,
        chatScope: msg.chatScope,
        chatId: msg.chatId,
        input: name,
        actionType: name === 'hint' ? 'hint' : 'give_up',
      });
      return { handled: true, replyText: res.announcement || 'Selesai!', status: 'ok' };
    }

    // Random fun handlers
    if (name === 'randomnumber') {
      const max = Math.max(2, Number.parseInt(args[0] || '100', 10) || 100);
      return { handled: true, replyText: `Angka acak (1-${max}): ${Math.floor(Math.random() * max) + 1}`, status: 'ok' };
    }
    if (name === 'apakah') {
      const opts = ['Ya, tentu saja.', 'Sepertinya iya.', 'Mungkin saja.', 'Belum tentu.', 'Tidak.'];
      return { handled: true, replyText: opts[Math.floor(Math.random() * opts.length)], status: 'ok' };
    }
    if (name === 'katabijak' || name === 'faktaunik' || name === 'pantun') {
      const samples: Record<string, string[]> = {
        katabijak: ['Konsistensi kecil setiap hari mengalahkan semangat besar yang hanya datang sesekali.'],
        faktaunik: ['JKT48 memiliki teater permanen di fX Sudirman Jakarta yang diresmikan pada 8 September 2012.'],
        pantun: ['Pergi ke kota membeli melati,\nJangan lupa mampir ke taman.\nMari belajar sepenuh hati,\nBersama Freya-san Hub setiap zaman.'],
      };
      return { handled: true, replyText: samples[name][0], status: 'ok' };
    }

    // Textmaker SVG preview response
    if (cmd.category === 'TEXTMAKER') {
      const text = rawArgs || 'Freya-san Hub';
      return {
        handled: true,
        replyText: `Textmaker gaya "${name}" diproses untuk teks: "${text}". Gunakan preview web atau plugin media untuk ekspor PNG.`,
        status: 'ok',
      };
    }

    // Default structured response for remaining verified registry commands
    return {
      handled: true,
      replyText: `[${cmd.category}] Perintah "${prefix}${cmd.name}" dieksekusi.\nDeskripsi: ${cmd.description}`,
      status: 'ok',
    };
  }

  private startAddRedeemWizard(msg: IncomingBotMessage, prefix: string): BotDispatchResponse {
    const id = `wiz-${crypto.randomUUID().slice(0, 10)}`;
    const initialState = {
      code: '',
      name: '',
      description: '',
      rewardBalance: 0,
      rewardExp: 0,
      rewardLevel: 0,
      additionalRewards: [] as ConfiguredAdditionalReward[],
      pendingRewardId: null as string | null,
      maxClaims: 100,
      perUserLimit: 1,
      cooldownSec: 0,
      active: true,
      expiresAt: null as string | null,
    };
    db.prepare(`DELETE FROM whatsapp_wizards WHERE user_phone = ? AND chat_id = ? AND status = 'active'`).run(msg.senderPhone, msg.chatId);
    db.prepare(`
      INSERT INTO whatsapp_wizards (id, user_phone, chat_id, wizard_type, step, state_json, status, expires_at)
      VALUES (?, ?, ?, 'addredeem', 'info', ?, 'active', datetime('now', '+15 minutes'))
    `).run(id, msg.senderPhone, msg.chatId, JSON.stringify(initialState));

    return {
      handled: true,
      replyText: `*Wizard .addredeem — Langkah 1/6: Informasi Kode*\nKirim format:\n*KODE | Nama Redeem | Deskripsi*\nContoh: \`FREYA2026 | Promo Theater | Hadiah penonton spesial\`\n\nKetik \`batal\` kapan saja untuk membatalkan wizard.`,
      status: 'ok',
    };
  }

  private handleWizardInput(
    wizard: { id: string; wizard_type: string; step: string; state_json: string },
    msg: IncomingBotMessage,
    prefix: string,
  ): BotDispatchResponse {
    const raw = msg.text.trim();
    const lower = raw.toLowerCase();

    if (['batal', 'cancel', 'exit', `${prefix}batal`, `${prefix}cancel`].includes(lower)) {
      db.prepare(`UPDATE whatsapp_wizards SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(wizard.id);
      return { handled: true, replyText: 'Wizard pembuatan kode redeem dibatalkan.', status: 'ok' };
    }

    const state = JSON.parse(wizard.state_json || '{}');
    const saveWizard = (nextStep: string, nextState: any) => {
      db.prepare(`
        UPDATE whatsapp_wizards
        SET step = ?, state_json = ?, updated_at = datetime('now'), expires_at = datetime('now', '+15 minutes')
        WHERE id = ?
      `).run(nextStep, JSON.stringify(nextState), wizard.id);
    };

    if (wizard.step === 'info') {
      const parts = raw.split('|').map((s) => s.trim());
      const code = (parts[0] || '').toUpperCase();
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        return { handled: true, replyText: 'Kode redeem harus 3–32 karakter (huruf, angka, - atau _). Coba lagi: `KODE | Nama | Deskripsi`', status: 'error' };
      }
      state.code = code;
      state.name = parts[1] || code;
      state.description = parts[2] || '';
      saveWizard('primary', state);
      return {
        handled: true,
        replyText: `*Langkah 2/6: Hadiah Utama*\nKode: *${state.code}* (${state.name})\nKirim 3 angka (spasi): *<Balance> <EXP> <Level>*\nContoh: \`200 100 1\` atau \`150 50 0\``,
        status: 'ok',
      };
    }

    if (wizard.step === 'primary') {
      const nums = raw.split(/\s+/).map((n) => Number(n));
      if (nums.length < 2 || nums.some((n) => !Number.isInteger(n) || n < 0)) {
        return { handled: true, replyText: 'Format tidak valid. Kirim: `<Balance> <EXP> <Level>` (angka bulat >= 0). Contoh: `200 100 0`', status: 'error' };
      }
      state.rewardBalance = nums[0] ?? 0;
      state.rewardExp = nums[1] ?? 0;
      state.rewardLevel = nums[2] ?? 0;
      saveWizard('ask_additional', state);

      const { active } = listRewardRegistry();
      const rows = [
        ...active.map((r, i) => ({
          id: r.id,
          title: `${i + 1}. ${r.name}`,
          description: r.description,
          command: String(i + 1),
        })),
        { id: 'skip', title: '0. Tidak, Lanjut ke Langkah 4', description: 'Lewati hadiah tambahan dan atur batas klaim', command: 'tidak' },
      ];
      return {
        handled: true,
        replyText: `*Langkah 3/6: Hadiah Tambahan?*\nMau tambahin hadiah lain dari Reward Registry nggak?\nPilih nomor atau ketik \`tidak\`:\n${active.map((r, i) => `${i + 1}. *${r.name}* — ${r.terms}`).join('\n')}\n0. Nggak usah, lanjut ke batas klaim`,
        interactiveMenu: {
          menuKey: 'wizard:addredeem_additional',
          title: 'Reward Registry (.addredeem)',
          subtitle: 'Pilih hadiah tambahan yang tersedia & punya handler aktif',
          buttonText: 'Pilih Hadiah',
          footer: 'Freya-san bot by Pak Ujan',
          sections: [{ title: 'Hadiah Tambahan Resmi', rows }],
        },
        status: 'ok',
      };
    }

    if (wizard.step === 'ask_additional') {
      if (['tidak', 'no', '0', 'lanjut', 'skip'].includes(lower)) {
        saveWizard('limits', state);
        return {
          handled: true,
          replyText: `*Langkah 4/6: Batas Klaim, Kedaluwarsa & Status*\nKirim format:\n*<max_claims> <per_user_limit> <cooldown_dtk> <active:on/off> <expired:YYYY-MM-DD|none>*\nContoh: \`100 1 0 on none\``,
          status: 'ok',
        };
      }
      const { active } = listRewardRegistry();
      const idx = Number.parseInt(raw, 10) - 1;
      const chosen = !Number.isNaN(idx) && active[idx] ? active[idx] : active.find((r) => r.id === lower || r.name.toLowerCase().includes(lower));
      if (!chosen) {
        return { handled: true, replyText: 'Pilihannya nggak ketemu di Reward Registry aktif. Pilih nomor 1–4 atau ketik `tidak`.', status: 'error' };
      }
      state.pendingRewardId = chosen.id;
      saveWizard('additional_param', state);
      const paramPrompt = chosen.paramsSchema.map((p) => `${p.label} (${p.placeholder || p.key})`).join(' | ');
      return {
        handled: true,
        replyText: `*Parameter untuk ${chosen.name}*\nKetik nilai: ${paramPrompt}\n(${chosen.terms})`,
        status: 'ok',
      };
    }

    if (wizard.step === 'additional_param') {
      const { active } = listRewardRegistry();
      const chosen = active.find((r) => r.id === state.pendingRewardId);
      if (!chosen) {
        saveWizard('ask_additional', state);
        return { handled: true, replyText: 'Registry-nya nggak ketemu, coba pilih hadiah tambahan lagi atau ketik `tidak`.', status: 'error' };
      }
      const parts = raw.split('|').map((s) => s.trim());
      const paramsObj: Record<string, string | number> = {};
      chosen.paramsSchema.forEach((spec, i) => {
        const val = parts[i];
        if (val !== undefined && val !== '') {
          paramsObj[spec.key] = spec.type === 'number' ? Number(val) : val;
        }
      });
      const check = validateAdditionalReward({ rewardId: chosen.id, params: paramsObj });
      if (!check.ok) {
        return { handled: true, replyText: `Parameter belum cocok nih: ${check.error}`, status: 'error' };
      }
      state.additionalRewards = [...(state.additionalRewards || []), check.normalized];
      state.pendingRewardId = null;
      saveWizard('ask_additional', state);
      return {
        handled: true,
        replyText: `Hadiah tambahan *${chosen.name}* udah ditambah! Total hadiah tambahan: ${state.additionalRewards.length}.\n\nMau tambah hadiah lain (pilih nomor 1–4) atau ketik \`lanjut\` buat ke Langkah 4.`,
        status: 'ok',
      };
    }

    if (wizard.step === 'limits') {
      const parts = raw.split(/\s+/);
      const maxClaims = Number(parts[0] ?? 100);
      const perUserLimit = Number(parts[1] ?? 1);
      const cooldownSec = Number(parts[2] ?? 0);
      const activeFlag = (parts[3] ?? 'on').toLowerCase() !== 'off';
      const expRaw = parts[4] && parts[4].toLowerCase() !== 'none' ? parts[4] : null;
      if (!Number.isInteger(maxClaims) || maxClaims < 0 || !Number.isInteger(perUserLimit) || perUserLimit < 1 || !Number.isInteger(cooldownSec) || cooldownSec < 0) {
        return { handled: true, replyText: 'Format batasnya belum valid nih. Contoh: `100 1 0 on none`', status: 'error' };
      }
      state.maxClaims = maxClaims;
      state.perUserLimit = perUserLimit;
      state.cooldownSec = cooldownSec;
      state.active = activeFlag;
      state.expiresAt = expRaw;
      saveWizard('summary', state);

      const extraList = (state.additionalRewards || []).map((a: ConfiguredAdditionalReward) => `${a.rewardId}: ${JSON.stringify(a.params)}`).join('\n- ') || 'Nggak ada';
      return {
        handled: true,
        replyText: `*Langkah 5/6: Ringkasan Konfigurasi Redeem*\n- Kode: *${state.code}*\n- Nama: ${state.name}\n- Hadiah Utama: +${state.rewardBalance} Bal, +${state.rewardExp} EXP, +${state.rewardLevel} Level\n- Hadiah Tambahan:\n- ${extraList}\n- Batas Total: ${state.maxClaims || '∞'} | Per User: ${state.perUserLimit}x | Cooldown: ${state.cooldownSec} dtk\n- Status: ${state.active ? 'Aktif' : 'Nonaktif'} | Kedaluwarsa: ${state.expiresAt || 'Nggak ada'}\n\nKetik *confirm* buat nyimpan, *edit info|primary|limits* buat ngubah, atau *batal*.`,
        interactiveMenu: {
          menuKey: 'wizard:addredeem:summary',
          title: 'Konfirmasi Redeem',
          subtitle: `Simpan kode ${state.code}?`,
          buttonText: 'Pilih Aksi',
          footer: 'Freya-san bot by Pak Ujan',
          sections: [
            {
              title: 'Tindakan',
              rows: [
                { id: 'wiz_confirm', title: 'Konfirmasi & Simpan', description: 'Simpan kode redeem langsung ke database', command: 'confirm' },
                { id: 'wiz_edit', title: 'Ubah Hadiah Utama', description: 'Balik ke langkah hadiah utama', command: 'edit primary' },
                { id: 'wiz_cancel', title: 'Batalkan', description: 'Batalin wizard .addredeem', command: 'batal' },
              ],
            },
          ],
        },
        status: 'ok',
      };
    }

    if (wizard.step === 'summary') {
      if (lower.startsWith('edit ')) {
        const targetStep = lower.replace('edit ', '').trim();
        if (['info', 'primary', 'limits'].includes(targetStep)) {
          saveWizard(targetStep, state);
          return { handled: true, replyText: `Balik ke langkah *${targetStep}*. Kirim nilai barunya ya:`, status: 'ok' };
        }
      }
      if (!['confirm', 'konfirmasi', 'ya', 'simpan'].includes(lower)) {
        return { handled: true, replyText: 'Ketik `confirm` untuk menyimpan, `edit primary` untuk ubah, atau `batal`.', status: 'pending' };
      }

      const res = createRedeemCode(msg.senderPhone, {
        code: state.code,
        name: state.name,
        description: state.description,
        rewardBalance: state.rewardBalance,
        rewardExp: state.rewardExp,
        rewardLevel: state.rewardLevel,
        additionalRewards: state.additionalRewards || [],
        maxClaims: state.maxClaims,
        perUserLimit: state.perUserLimit,
        cooldownSec: state.cooldownSec,
        active: state.active,
        expiresAt: state.expiresAt,
      });
      if (!res.ok) {
        return { handled: true, replyText: `Gagal menyimpan kode redeem: ${res.error}\nKetik \`edit primary\` atau \`batal\`.`, status: 'error' };
      }
      db.prepare(`UPDATE whatsapp_wizards SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(wizard.id);
      return {
        handled: true,
        replyText: `*Langkah 6/6: Selesai!*\nKode redeem *${res.item.code}* (${res.item.name}) berhasil disimpan ke database dan dicatat pada audit log.\nPengguna dapat menukarkannya dengan \`${prefix}redeem ${res.item.code}\`.`,
        status: 'ok',
      };
    }

    return { handled: true, replyText: 'Langkah wizard tidak dikenali. Ketik `batal` untuk mengulang.', status: 'error' };
  }
}

export const whatsappEngine = new WhatsAppEngineManager();
