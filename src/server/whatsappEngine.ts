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

const WA_AUTH_DIR = path.resolve(process.cwd(), 'data', 'wa-auth');
if (!fs.existsSync(WA_AUTH_DIR)) {
  fs.mkdirSync(WA_AUTH_DIR, { recursive: true });
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
  source?: 'whatsapp' | 'simulator';
}

export interface BotDispatchResponse {
  handled: boolean;
  replyText: string;
  interactiveMenu?: {
    title: string;
    subtitle: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description: string; command: string }>;
    }>;
  };
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
      phoneNumber: this.phoneNumber,
      qrDataUrl: this.qrDataUrl,
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
      SET status = ?, phone_number = ?, qr_code = ?, last_error = ?, reconnect_attempts = ?, updated_at = datetime('now')
      WHERE id = 'primary'
    `).run(this.status, this.phoneNumber, this.qrDataUrl, this.lastError, this.reconnectAttempts);
    this.broadcaster('wa:status', this.getStatus());
  }

  public async connect(): Promise<{ ok: boolean; status: string; message: string }> {
    if (this.status === 'connecting' || this.status === 'connected') {
      return { ok: true, status: this.status, message: 'WhatsApp engine sudah berjalan.' };
    }

    try {
      installWhatsAppV5ProtoExtensions();
      this.status = 'connecting';
      this.lastError = null;
      this.persistSessionState();

      const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
      const logger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        auth: state,
        logger,
        browser: Browsers.ubuntu('Freya-san Hub'),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'qr_ready';
          this.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
          this.persistSessionState();
          addSystemLog('info', 'whatsappEngine', 'QR Code login WhatsApp siap dipindai.');
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.reconnectAttempts = 0;
          this.phoneNumber = this.sock?.user?.id?.split(':')[0] ?? null;
          db.prepare(`UPDATE bot_sessions SET last_connected_at = datetime('now') WHERE id = 'primary'`).run();
          this.persistSessionState();
          addSystemLog('info', 'whatsappEngine', 'WhatsApp Bot terhubung ke server WhatsApp.');
        }

        if (connection === 'close') {
          const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const shouldReconnect = code !== DisconnectReason.loggedOut;
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.lastError = lastDisconnect?.error?.message ?? 'Koneksi WhatsApp ditutup';
          this.persistSessionState();

          if (shouldReconnect && this.reconnectAttempts < 5) {
            this.reconnectAttempts += 1;
            const delayMs = Math.min(30000, this.reconnectAttempts * 3000);
            addSystemLog('warn', 'whatsappEngine', `Menjadwalkan reconnect #${this.reconnectAttempts} dalam ${delayMs}ms.`);
            this.reconnectTimer = setTimeout(() => {
              void this.connect();
            }, delayMs);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async (m) => {
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

          const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
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
            } else if (result.replyText) {
              this.enqueueMessage(jid, result.replyText);
            }
          }
        }
      });

      return { ok: true, status: this.status, message: 'Inisialisasi koneksi WhatsApp dimulai.' };
    } catch (err) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : 'Gagal menghubungkan Baileys';
      this.persistSessionState();
      addSystemLog('error', 'whatsappEngine', this.lastError);
      return { ok: false, status: 'error', message: this.lastError };
    }
  }

  public async disconnect(): Promise<{ ok: boolean; message: string }> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const timer of this.scheduledTimers) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();
    this.reconnectAttempts = 0;
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.persistSessionState();
    addSystemLog('info', 'whatsappEngine', 'Koneksi WhatsApp diputuskan oleh owner.');
    return { ok: true, message: 'Koneksi WhatsApp diputuskan.' };
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
    const parsed = parseCommandInput(msg.text, activePrefixes, {
      mentions: msg.mentions,
      hasReply: msg.hasReply,
      hasMedia: msg.hasMedia,
    });

    // Check active interactive WhatsApp Wizard (e.g. .addredeem multi-step builder) BEFORE game fallback
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

    // Check if there is an active game session in this chat when text is NOT a command
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
      // Note: ordinary chat between members without invoking bot MUST NOT count toward group streak!
      return { handled: false, replyText: '', status: 'ignored' };
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

    // Cooldown validation
    if (!isOwner && cmdRow.cooldown_sec > 0) {
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

  private buildInteractiveMenu(prefix: string, rawArgs: string, isOwner: boolean): BotDispatchResponse {
    const sub = rawArgs.trim().toUpperCase();
    const botName = (db.prepare("SELECT value FROM settings WHERE key = 'bot_name'").get() as { value: string } | undefined)?.value || 'Freya-san bot by Pak Ujan';

    if (sub === '48GROUP') {
      const rows = [
        { id: '48_diff', title: 'Difficulty Explorer JKT48 (Level 1–3)', description: 'New Era–Fight Era (Mudah–Menengah), Era One, hingga Pre-One Era', command: `${prefix}jkt48 level` },
        { id: '48_team', title: 'Team Explorer JKT48 (Old / New / Other)', description: 'Jelajahi Team J, KIII, T, Team Love/Dream/Passion & Unassigned', command: `${prefix}jkt48 team` },
        { id: '48_info', title: '48Group Intelligence Center', description: 'Profil grup, member terverifikasi & sumber resmi', command: `${prefix}jkt48` },
        { id: '48_member_quiz', title: 'Member Quiz 48Group', description: 'Kuis member berbasis data resmi terverifikasi', command: `${prefix}memberquiz` },
        { id: '48_song_quiz', title: 'Song & Discography Quiz', description: 'Tebak single, center & tahun rilis 48Group', command: `${prefix}songquiz` },
        { id: '48_theater', title: 'Theater Challenge', description: 'Kuis setlist & panggung theater 48Group', command: `${prefix}theaterchallenge` },
        { id: '48_daily', title: 'Daily 48Group Challenge', description: 'Tantangan harian 48Group', command: `${prefix}daily48` },
        { id: '48_ww', title: 'Werewolf 48Group', description: 'Permainan sosial multiplayer bertema 48Group', command: `${prefix}werewolf48` },
        { id: 'back_game', title: 'Kembali ke Menu GAME', description: 'Kembali ke daftar Game Center', command: `${prefix}menu game` },
      ];
      const text = [
        `*${botName} — SUBMENU 48GROUP*`,
        '',
        ...rows.map((r, i) => `${i + 1}. ${r.title} (${r.command})\n   ${r.description}`),
        '',
        `Ketik ${prefix}menu untuk kembali ke Menu Utama.`,
      ].join('\n');

      return {
        handled: true,
        replyText: text,
        interactiveMenu: {
          title: '48GROUP CENTER',
          subtitle: 'Intelligence Archive, Explorer & Game Center',
          sections: [{ title: 'Submenu 48GROUP', rows }],
        },
        status: 'ok',
      };
    }

    const categories: Array<{ key: string; label: string; desc: string }> = [
      { key: 'AI', label: 'AI', desc: 'Nexara AI, OpenAI fallback & pemrosesan cerdas' },
      { key: 'DOWNLOAD', label: 'DOWNLOAD', desc: 'Adapter unduhan media sosial & video' },
      { key: 'GAME', label: 'GAME (termasuk 48GROUP)', desc: 'Game Center Umum & Submenu 48GROUP' },
      { key: 'GENERAL', label: 'GENERAL', desc: 'Menu utama, ping, info bot & changelog' },
      { key: 'GROUP', label: 'GROUP', desc: 'Moderasi grup, anti-fitur, absen & jadwal' },
      { key: 'INFO', label: 'INFO', desc: 'Balance, EXP, level, profil & status layanan' },
      ...(isOwner ? [{ key: 'OWNER', label: 'OWNER', desc: 'Manajemen prefix, broadcast, redeem & grup' }] : []),
      { key: 'RANDOM', label: 'RANDOM', desc: 'Pantun, puisi, fakta unik & generator acak' },
      { key: 'SEARCH', label: 'SEARCH', desc: 'Cuaca, jadwal shalat, Wikipedia & pencarian' },
      { key: 'STICKER', label: 'STICKER', desc: 'Pembuatan & watermark stiker WhatsApp' },
      { key: 'TEXTMAKER', label: 'TEXTMAKER', desc: '38 gaya generator teks visual' },
      { key: 'TOOLS', label: 'TOOLS', desc: 'Folio, Base64, QR Code, terjemahan & utilitas' },
    ];

    if (sub && categories.some((c) => c.key === sub)) {
      const cmds = ALL_COMMANDS.filter((c) => c.category === sub).slice(0, 14);
      const rows = cmds.map((c) => ({
        id: `cmd_${c.name}`,
        title: `${prefix}${c.name}`,
        description: c.description,
        command: c.example || `${prefix}${c.name}`,
      }));

      if (sub === 'GAME') {
        rows.unshift({
          id: 'submenu_48group',
          title: '48GROUP CENTER (Submenu Khusus)',
          description: 'Buka seluruh kuis, arsip & game 48Group',
          command: `${prefix}menu 48group`,
        });
      }

      const fallbackLines = [
        `*${botName} — KATEGORI ${sub}*`,
        '',
        ...rows.map((r, idx) => `${idx + 1}. ${r.title} — ${r.description}\n   Contoh: ${r.command}`),
        '',
        `Ketik ${prefix}menu untuk kembali ke Menu Utama.`,
      ].join('\n');

      return {
        handled: true,
        replyText: fallbackLines,
        interactiveMenu: {
          title: `MENU ${sub}`,
          subtitle: 'Pilih fitur atau salin contoh command',
          sections: [{ title: `Daftar Fitur ${sub}`, rows }],
        },
        status: 'ok',
      };
    }

    const menuSections = categories.map((c) => ({
      id: `cat_${c.key}`,
      title: c.label,
      description: c.desc,
      command: `${prefix}menu ${c.key.toLowerCase()}`,
    }));

    const fallbackMain = [
      `*${botName} — MENU UTAMA*`,
      `Prefix aktif: ${this.getActivePrefixes().join(' ')} (mendukung spasi & tanpa spasi)`,
      '',
      ...menuSections.map((s, idx) => `${idx + 1}. ${s.title} — ${s.command}`),
      '',
      `Khusus 48Group: ketik ${prefix}menu 48group atau ${prefix}48group`,
    ].join('\n');

    return {
      handled: true,
      replyText: fallbackMain,
      interactiveMenu: {
        title: botName,
        subtitle: 'Interactive List Menu (Fallback Text Otomatis Tersedia)',
        sections: [{ title: 'MENU UTAMA', rows: menuSections }],
      },
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
        replyText: `Perintah "${prefix}${name}" masih berstatus pending_specification (belum diaktifkan secara spesifik oleh owner).`,
        status: 'pending',
      };
    }

    if (cmd.status === 'pending_integration' || !cmd.has_real_handler) {
      return {
        handled: true,
        replyText: `Perintah "${prefix}${name}" masuk kategori ${cmd.category}, tapi integrasi layanan eksternalnya belum tersambung di server ini.`,
        status: 'pending',
      };
    }

    // Menu & General
    if (name === 'menu') {
      return this.buildInteractiveMenu(prefix, rawArgs, isOwner);
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
      db.transaction(() => {
        db.prepare('DELETE FROM prefixes WHERE is_default = 0').run();
        db.prepare('UPDATE prefixes SET enabled = 1 WHERE is_default = 1').run();
      })();
      addAuditLog(msg.senderPhone, 'prefix.reset', 'default_10');
      return { handled: true, replyText: 'Semua 10 prefix bawaan sudah dikembalikan jadi aktif semua!', status: 'ok' };
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
      if (!rawArgs) return { handled: true, replyText: `Gunakan: ${prefix}report <deskripsi laporan>`, status: 'error' };
      addSystemLog('warn', 'userReport', rawArgs, { from: maskPhoneNumberForGroup(msg.senderPhone) });
      return { handled: true, replyText: 'Laporan Anda telah dicatat ke log administrator Freya-san Hub. Terima kasih!', status: 'ok' };
    }

    // Redeem & Economy transactions (unified transactional service + owner wizard + management suite)
    if (name === 'redeem' || name === 'claimFreyasanredeem') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Gunakan: ${prefix}${name} <KODE>`, status: 'error' };
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
        replyText: `${claimRes.message}\nRincian hadiah: ${rewardDetails.join(', ')}\nStatus Akun Anda -> Balance: ${claimRes.userAfter?.balance ?? 0}, Level: ${claimRes.userAfter?.level ?? 1}, EXP: ${claimRes.userAfter?.exp ?? 0}`,
        status: 'ok',
      };
    }

    if (name === 'addredeem') {
      return this.startAddRedeemWizard(msg, prefix);
    }

    if (name === 'listredeem') {
      const { items } = listRedeemCodes({ limit: 25 });
      if (items.length === 0) {
        return { handled: true, replyText: 'Belum ada kode redeem yang terdaftar.', status: 'ok' };
      }
      const lines = items.map(
        (r, i) =>
          `${i + 1}. *${r.code}* (${r.name}) — ${r.active ? (r.isExpired ? 'Kedaluwarsa' : 'Aktif') : 'Nonaktif'} | Klaim: ${r.claimedCount}/${r.maxClaims || '∞'} | Bal: ${r.rewardBalance}, EXP: ${r.rewardExp}, Lv: ${r.rewardLevel}`,
      );
      return { handled: true, replyText: `*Daftar Kode Redeem (${items.length})*\n\n${lines.join('\n')}`, status: 'ok' };
    }

    if (name === 'inforedeem' || name === 'redeeminfo') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Gunakan: ${prefix}redeeminfo <KODE>`, status: 'error' };
      const detail = getRedeemDetail(code);
      if (!detail.code) return { handled: true, replyText: `Kode redeem ${code} tidak ditemukan.`, status: 'error' };
      const c = detail.code;
      const extraText = c.additionalRewards.length
        ? c.additionalRewards.map((a) => `${a.rewardId}(${JSON.stringify(a.params)})`).join(', ')
        : 'Tidak ada';
      return {
        handled: true,
        replyText: `*Detail Kode Redeem ${c.code}*\nNama: ${c.name}\nDeskripsi: ${c.description || '-'}\nStatus: ${c.active ? (c.isExpired ? 'Kedaluwarsa' : 'Aktif') : 'Nonaktif'}\nHadiah Utama: +${c.rewardBalance} Bal, +${c.rewardExp} EXP, +${c.rewardLevel} Level\nHadiah Tambahan: ${extraText}\nBatas Klaim: ${c.claimedCount}/${c.maxClaims || '∞'} (Per user: ${c.perUserLimit}x)\nCooldown: ${c.cooldownSec} dtk\nKedaluwarsa: ${c.expiresAt || 'Tidak ada'}`,
        status: 'ok',
      };
    }

    if (name === 'editredeem') {
      const code = args[0]?.toUpperCase();
      if (!code || args.length < 2) {
        return {
          handled: true,
          replyText: `Gunakan: ${prefix}editredeem <KODE> max_claims=100 per_user_limit=1 balance=200 exp=50 level=1 active=on`,
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
      if (!res.ok) return { handled: true, replyText: `Gagal memperbarui ${code}: ${res.error}`, status: 'error' };
      return { handled: true, replyText: `Kode redeem ${res.item.code} berhasil diperbarui (Klaim maks: ${res.item.maxClaims}, Balance: ${res.item.rewardBalance}, Aktif: ${res.item.active ? 'Ya' : 'Tidak'}).`, status: 'ok' };
    }

    if (name === 'deleteredeem' || name === 'delredeem') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Gunakan: ${prefix}delredeem <KODE>`, status: 'error' };
      const res = deleteRedeemCode(msg.senderPhone, code);
      if (!res.ok) return { handled: true, replyText: res.error, status: 'error' };
      return { handled: true, replyText: `Kode redeem ${res.code} dihapus dari daftar aktif. Riwayat klaim historis tetap disimpan secara utuh.`, status: 'ok' };
    }

    if (name === 'redeemdisable' || name === 'redeemenable') {
      const code = args[0]?.toUpperCase();
      if (!code) return { handled: true, replyText: `Gunakan: ${prefix}${name} <KODE>`, status: 'error' };
      const enable = name === 'redeemenable';
      const res = toggleRedeemCode(msg.senderPhone, code, enable);
      if (!res.ok) return { handled: true, replyText: res.error, status: 'error' };
      return { handled: true, replyText: `Kode redeem ${res.item.code} berhasil ${enable ? 'diaktifkan' : 'dinonaktifkan'}.`, status: 'ok' };
    }

    if (name === 'redeemreset') {
      const code = args[0]?.toUpperCase();
      const confirmed = args[1]?.toLowerCase() === 'confirm';
      if (!code) return { handled: true, replyText: `Gunakan: ${prefix}redeemreset <KODE> confirm`, status: 'error' };
      if (!confirmed) {
        return { handled: true, replyText: `Konfirmasi wajib: ketik "${prefix}redeemreset ${code} confirm" untuk mereset kuota klaim tanpa menghapus log riwayat.`, status: 'pending' };
      }
      const res = resetRedeemClaims(msg.senderPhone, code, true);
      if (!res.ok) return { handled: true, replyText: res.error, status: 'error' };
      return { handled: true, replyText: `Counter klaim kode ${res.code} telah direset ke 0 (log riwayat tetap terjaga).`, status: 'ok' };
    }

    if (name === 'redeemhistory') {
      const code = args[0]?.toUpperCase();
      const { items, total } = getClaimHistory({ code: code || undefined, limit: 10 });
      if (items.length === 0) return { handled: true, replyText: 'Belum ada catatan riwayat klaim.', status: 'ok' };
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
        return { handled: true, replyText: `Gunakan: ${prefix}tfbalance <nomor> <jumlah 1-10000>`, status: 'error' };
      }
      if (targetPhone === msg.senderPhone) {
        return { handled: true, replyText: 'Tidak bisa mentransfer balance ke diri sendiri.', status: 'error' };
      }
      try {
        db.transaction(() => {
          const sender = db.prepare('SELECT balance FROM users WHERE phone = ?').get(msg.senderPhone) as { balance: number };
          if (!sender || sender.balance < amount) throw new Error('Balance virtual Anda tidak mencukupi.');
          applyUserBalanceAndExp(msg.senderPhone, msg.senderName, -amount, 0, `Transfer balance ke ${maskPhoneNumberForGroup(targetPhone)}`);
          applyUserBalanceAndExp(targetPhone, targetPhone, amount, 0, `Terima balance dari ${maskPhoneNumberForGroup(msg.senderPhone)}`);
        })();
        return { handled: true, replyText: `Transfer virtual ${amount} Balance berhasil dicatat.`, status: 'ok' };
      } catch (err) {
        return { handled: true, replyText: err instanceof Error ? err.message : 'Gagal transfer.', status: 'error' };
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
            replyText: 'ID atau tautan saluran belum valid (@newsletter tidak ditemukan). Pastikan bot sudah jadi admin saluran tersebut.',
            status: 'error',
          };
        }
        await this.sock.sendMessage(newsletterJid, { text: contentText });
        addAuditLog(msg.senderPhone, 'owner.upswch', newsletterJid, { len: contentText.length });
        return { handled: true, replyText: `Pesan berhasil dikirim ke Saluran ${newsletterJid}!`, status: 'ok' };
      } catch (err) {
        return {
          handled: true,
          replyText: `Gagal kirim ke Saluran WhatsApp: ${err instanceof Error ? err.message : 'Akun tidak punya izin admin saluran atau tidak didukung sesi ini.'}`,
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
        replyText: 'WhatsApp Engine sedang offline, jadi bio profil belum bisa di-push ke server WhatsApp.',
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
      return { handled: true, replyText: `QR Code berhasil dibuat untuk: ${content}`, qrDataUrl, status: 'ok' };
    }
    if (name === 'cekplatform') {
      return { handled: true, replyText: `Sumber pesan terdeteksi: ${msg.source === 'simulator' ? 'Web Console Simulator' : 'WhatsApp Client'} (${msg.chatScope}).`, status: 'ok' };
    }
    if (name === 'readviewonce') {
      return { handled: true, replyText: 'Privasi chat sekali lihat tetap dijaga oleh sistem, jadi bot nggak melewati proteksi privasi WhatsApp.', status: 'denied' };
    }

    if (name === 'kirim') {
      if (!rawArgs) return { handled: true, replyText: `Gunakan: ${prefix}kirim <nomor|ke owner> <pesan>`, status: 'error' };
      const lower = rawArgs.toLowerCase();
      if (lower.startsWith('ke owner ')) {
        const messageText = rawArgs.slice('ke owner '.length).trim();
        addAuditLog(msg.senderPhone, 'kirim.to_owner', 'owner', { preview: messageText.slice(0, 80) });
        return { handled: true, replyText: `Pesan untuk owner sudah dicatat ke antrean aman (${messageText.length} karakter). Nomor privat owner tetap aman.`, status: 'ok' };
      }
      const target = args[0]?.replace(/\D/g, '');
      const bodyText = args.slice(1).join(' ');
      if (!target || !bodyText) return { handled: true, replyText: `Gunakan: ${prefix}kirim 628xxxxxxxx Pesan Anda`, status: 'error' };
      addAuditLog(msg.senderPhone, 'kirim.direct', maskPhoneNumberForGroup(target), { len: bodyText.length });
      if (this.status === 'connected') {
        this.enqueueMessage(`${target}@s.whatsapp.net`, bodyText);
      }
      return { handled: true, replyText: `Pesan ke ${maskPhoneNumberForGroup(target)} dimasukkan ke antrean pengiriman resmi.`, status: 'ok' };
    }

    // 48Group Intelligence Commands
    if (name === '48group') {
      return this.buildInteractiveMenu(prefix, '48GROUP', isOwner);
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
            const rows = JKT48_DIFFICULTY_LEVELS.map((l) => ({
              id: `jkt_lvl_${l.id}`,
              title: l.title,
              description: `${l.eraCategory} (${l.periodRange})`,
              command: `${prefix}jkt48 level ${l.levelOrder}`,
            }));
            return {
              handled: true,
              replyText: `*JKT48 Difficulty Explorer (3 Level Tetap)*\n\n${JKT48_DIFFICULTY_LEVELS.map(
                (l) => `${l.levelOrder}. *${l.title}*\n   Era: ${l.eraCategory} (${l.periodRange})\n   Ketik: ${prefix}jkt48 level ${l.levelOrder}`,
              ).join('\n\n')}`,
              interactiveMenu: {
                title: 'Difficulty Explorer JKT48',
                subtitle: 'Pilih tingkat kesulitan dan era',
                sections: [{ title: '3 Level Resmi', rows }],
              },
              status: 'ok',
            };
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
            const rows = JKT48_TEAM_GROUPS.map((g) => ({
              id: `jkt_grp_${g.id}`,
              title: g.title,
              description: g.description,
              command: `${prefix}jkt48 team ${g.id}`,
            }));
            return {
              handled: true,
              replyText: `*JKT48 Team Explorer (Klasifikasi Navigasi)*\n\n${JKT48_TEAM_GROUPS.map(
                (g, i) => `${i + 1}. *${g.title}* — ${g.description}\n   Ketik: ${prefix}jkt48 team ${g.id}`,
              ).join('\n\n')}\n\nCatatan: ${JKT48_TEAM_GROUPS[0].disclaimer}`,
              interactiveMenu: {
                title: 'Team Explorer JKT48',
                subtitle: 'Old / New / Other & Unassigned',
                sections: [{ title: 'Kategori Navigasi Team', rows }],
              },
              status: 'ok',
            };
          }

          if (targetArg === 'old' || targetArg === 'new' || targetArg === 'other') {
            const teamsInGroup = getTeamsByGroup(targetArg as Jkt48TeamGroupId);
            const grpMeta = JKT48_TEAM_GROUPS.find((g) => g.id === targetArg)!;
            const rows = teamsInGroup.map((t) => ({
              id: t.id,
              title: t.name,
              description: t.historicalStatus,
              command: `${prefix}jkt48 team ${t.id}`,
            }));
            return {
              handled: true,
              replyText: `*Team Group: ${grpMeta.title}*\n${grpMeta.disclaimer}\n\n${teamsInGroup.map((t, i) => `${i + 1}. *${t.name}*\n   Status: ${t.historicalStatus}\n   Ketik: ${prefix}jkt48 team ${t.id}`).join('\n\n')}`,
              interactiveMenu: {
                title: `Team ${grpMeta.title}`,
                subtitle: grpMeta.description || 'Pilih Team',
                sections: [{ title: `Daftar Team (${grpMeta.title})`, rows }],
              },
              status: 'ok',
            };
          }

          const teamIdLookup = targetArg.startsWith('team_') ? targetArg : `team_${targetArg}`;
          const teamMeta = getTeamMeta(teamIdLookup) || JKT48_TEAMS.find((t) => t.name.toLowerCase() === args.slice(1).join(' ').toLowerCase());
          if (!teamMeta) {
            return { handled: true, replyText: `Team "${targetArg}" tidak ditemukan. Ketik ${prefix}jkt48 team untuk membuka kategori Old / New / Other.`, status: 'error' };
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
    if (name === 'antiluar') {
      const testNum = args[0];
      if (testNum && /^\+?\d+$/.test(testNum.replace(/\D/g, ''))) {
        const isIndo = isIndonesianPhoneNumber(testNum);
        return { handled: true, replyText: `Pemeriksaan Antiluar untuk ${maskPhoneNumberForGroup(testNum)}: ${isIndo ? 'Nomor Indonesia (+62) — Diizinkan' : 'Nomor Luar Negeri — Terdeteksi'}.`, status: 'ok' };
      }
      return { handled: true, replyText: 'Pengaturan Antiluar dapat dikelola (ON/OFF, mode hapus/peringatan/kick, pengecualian) melalui Dashboard -> Group Manager.', status: 'ok' };
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
        replyText: `Reqjoin mode "${sub}": siap memproses permintaan anggota bila WhatsApp grup mengaktifkan persetujuan admin dan bot berstatus admin.`,
        status: 'ok',
      };
    }

    if (name === 'golink') {
      const groupId = args[0] || msg.chatId;
      if (!groupId.endsWith('@g.us')) return { handled: true, replyText: 'ID grup tidak valid (harus berakhiran @g.us).', status: 'error' };
      addAuditLog(msg.senderPhone, 'owner.golink', groupId);
      if (this.sock && this.status === 'connected') {
        try {
          const code = await this.sock.groupInviteCode(groupId);
          return { handled: true, replyText: `Tautan Grup (${groupId}): https://chat.whatsapp.com/${code}`, status: 'ok' };
        } catch (err) {
          return { handled: true, replyText: `Gagal mengambil tautan grup: ${err instanceof Error ? err.message : 'Pastikan bot menjadi admin grup'}`, status: 'error' };
        }
      }
      return { handled: true, replyText: `Validasi ID grup "${groupId}" berhasil. Hubungkan WhatsApp Engine untuk menarik invite code langsung.`, status: 'ok' };
    }

    if (name === 'autoread') {
      const mode = args[0]?.toLowerCase();
      const next = mode === 'on' ? 'true' : mode === 'off' ? 'false' : null;
      if (!next) return { handled: true, replyText: `Gunakan: ${prefix}autoread on | off`, status: 'error' };
      db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'blue_tick_enabled'").run(next);
      addAuditLog(msg.senderPhone, 'settings.blue_tick', next);
      return { handled: true, replyText: `Blue Tick Control WhatsApp diubah menjadi: ${next === 'true' ? 'ON' : 'OFF'}.`, status: 'ok' };
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
        return { handled: true, replyText: 'Tidak ada sesi permainan aktif pada percakapan ini.', status: 'error' };
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
      return { handled: true, replyText: res.announcement || 'Selesai.', status: 'ok' };
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
        replyText: `*Langkah 3/6: Hadiah Tambahan?*\nApakah ingin menambahkan hadiah lain dari Reward Registry?\nPilih nomor atau ketik \`tidak\`:\n${active.map((r, i) => `${i + 1}. *${r.name}* — ${r.terms}`).join('\n')}\n0. Tidak, lanjut ke batas klaim`,
        interactiveMenu: {
          title: 'Reward Registry (.addredeem)',
          subtitle: 'Pilih hadiah tambahan yang tersedia & memiliki handler aktif',
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
        return { handled: true, replyText: 'Pilihan tidak ditemukan di Reward Registry aktif. Pilih nomor 1–4 atau ketik `tidak`.', status: 'error' };
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
        return { handled: true, replyText: 'Registry tidak ditemukan, kembali pilih hadiah tambahan atau ketik `tidak`.', status: 'error' };
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
        return { handled: true, replyText: `Validasi parameter gagal: ${check.error}`, status: 'error' };
      }
      state.additionalRewards = [...(state.additionalRewards || []), check.normalized];
      state.pendingRewardId = null;
      saveWizard('ask_additional', state);
      return {
        handled: true,
        replyText: `Hadiah tambahan *${chosen.name}* ditambahkan! Total hadiah tambahan: ${state.additionalRewards.length}.\n\nTambah hadiah lain (pilih nomor 1–4) atau ketik \`lanjut\` untuk ke Langkah 4.`,
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
        return { handled: true, replyText: 'Format batas tidak valid. Contoh: `100 1 0 on none`', status: 'error' };
      }
      state.maxClaims = maxClaims;
      state.perUserLimit = perUserLimit;
      state.cooldownSec = cooldownSec;
      state.active = activeFlag;
      state.expiresAt = expRaw;
      saveWizard('summary', state);

      const extraList = (state.additionalRewards || []).map((a: ConfiguredAdditionalReward) => `${a.rewardId}: ${JSON.stringify(a.params)}`).join('\n- ') || 'Tidak ada';
      return {
        handled: true,
        replyText: `*Langkah 5/6: Ringkasan Konfigurasi Redeem*\n- Kode: *${state.code}*\n- Nama: ${state.name}\n- Hadiah Utama: +${state.rewardBalance} Bal, +${state.rewardExp} EXP, +${state.rewardLevel} Level\n- Hadiah Tambahan:\n- ${extraList}\n- Batas Total: ${state.maxClaims || '∞'} | Per User: ${state.perUserLimit}x | Cooldown: ${state.cooldownSec} dtk\n- Status: ${state.active ? 'Aktif' : 'Nonaktif'} | Kedaluwarsa: ${state.expiresAt || 'Tidak ada'}\n\nKetik *confirm* untuk menyimpan, *edit info|primary|limits* untuk mengubah, atau *batal*.`,
        interactiveMenu: {
          title: 'Konfirmasi Redeem',
          subtitle: `Simpan kode ${state.code}?`,
          sections: [
            {
              title: 'Tindakan',
              rows: [
                { id: 'wiz_confirm', title: 'Konfirmasi & Simpan', description: 'Simpan kode redeem secara atomik ke database', command: 'confirm' },
                { id: 'wiz_edit', title: 'Ubah Hadiah Utama', description: 'Kembali ke langkah hadiah utama', command: 'edit primary' },
                { id: 'wiz_cancel', title: 'Batalkan', description: 'Batalkan wizard .addredeem', command: 'batal' },
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
          return { handled: true, replyText: `Kembali ke langkah *${targetStep}*. Silakan kirim nilai baru:`, status: 'ok' };
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
