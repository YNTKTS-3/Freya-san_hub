import crypto from 'node:crypto';
import { addAuditLog, addSystemLog, db, decryptVaultSecret, encryptVaultSecret, maskSecretValue } from '../db';
import type { InteractiveMenuPayload } from '../menuService';
import type { MetaWebhookNormalizedMessage, WaProviderCapabilities, WaProviderDescriptor } from './types';

export interface MetaCloudRuntimeConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  appSecret: string;
  verifyToken: string;
  apiVersion: string;
}

export const META_CLOUD_CAPABILITIES: WaProviderCapabilities = {
  supportsQr: false,
  supportsPairingCode: false,
  supportsInteractiveList: true,
  interactiveListMaxRows: 10,
  supportsAudioStickerCombo: false,
  supportsGroupManagement: false,
  requiresWebhook: true,
  requiresOfficialBusinessCredentials: true,
  coexistenceNote:
    'Meta WhatsApp Cloud API resmi tidak memakai QR Code maupun Pairing Code WhatsApp Web. Satu nomor yang didaftarkan ke Cloud API umumnya tidak dapat dipakai bersamaan sebagai sesi Baileys standar kecuali melalui program resmi Meta Coexistence.',
};

export class MetaCloudApiProvider {
  private lastError: string | null = null;
  private lastWebhookAt: string | null = null;
  private lastVerifiedAt: string | null = null;

  public getRuntimeConfig(): MetaCloudRuntimeConfig {
    const row = db.prepare(`SELECT config_json FROM wa_provider_configs WHERE provider_id = 'meta_cloud'`).get() as
      | { config_json: string }
      | undefined;
    let stored: Record<string, string> = {};
    try {
      stored = row?.config_json ? JSON.parse(row.config_json) : {};
    } catch {
      stored = {};
    }

    const decryptedToken = stored.encryptedAccessToken ? decryptVaultSecret(stored.encryptedAccessToken) || '' : '';
    const decryptedSecret = stored.encryptedAppSecret ? decryptVaultSecret(stored.encryptedAppSecret) || '' : '';

    return {
      accessToken: process.env.META_WA_ACCESS_TOKEN?.trim() || decryptedToken,
      phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID?.trim() || stored.phoneNumberId || '',
      businessAccountId: process.env.META_WA_BUSINESS_ACCOUNT_ID?.trim() || stored.businessAccountId || '',
      appSecret: process.env.META_WA_APP_SECRET?.trim() || decryptedSecret,
      verifyToken: process.env.META_WA_VERIFY_TOKEN?.trim() || stored.verifyToken || '',
      apiVersion: process.env.META_WA_API_VERSION?.trim() || stored.apiVersion || 'v21.0',
    };
  }

  public isConfigured(): boolean {
    const cfg = this.getRuntimeConfig();
    return Boolean(cfg.accessToken && cfg.phoneNumberId);
  }

  public updateConfig(patch: {
    accessToken?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    appSecret?: string;
    verifyToken?: string;
    apiVersion?: string;
    enabled?: boolean;
  }): { ok: boolean; message: string } {
    const row = db.prepare(`SELECT enabled, config_json FROM wa_provider_configs WHERE provider_id = 'meta_cloud'`).get() as
      | { enabled: number; config_json: string }
      | undefined;
    let current: Record<string, unknown> = {};
    try {
      current = row?.config_json ? JSON.parse(row.config_json) : {};
    } catch {
      current = {};
    }

    if (typeof patch.phoneNumberId === 'string') current.phoneNumberId = patch.phoneNumberId.trim();
    if (typeof patch.businessAccountId === 'string') current.businessAccountId = patch.businessAccountId.trim();
    if (typeof patch.verifyToken === 'string') current.verifyToken = patch.verifyToken.trim();
    if (typeof patch.apiVersion === 'string' && /^v\d+\.\d+$/.test(patch.apiVersion.trim())) {
      current.apiVersion = patch.apiVersion.trim();
    }
    if (typeof patch.accessToken === 'string' && patch.accessToken.trim()) {
      current.encryptedAccessToken = encryptVaultSecret(patch.accessToken.trim());
      current.accessTokenMasked = maskSecretValue(patch.accessToken.trim());
    }
    if (typeof patch.appSecret === 'string' && patch.appSecret.trim()) {
      current.encryptedAppSecret = encryptVaultSecret(patch.appSecret.trim());
      current.appSecretMasked = maskSecretValue(patch.appSecret.trim());
    }

    const nextEnabled = typeof patch.enabled === 'boolean' ? (patch.enabled ? 1 : 0) : row?.enabled ?? 0;

    db.prepare(`
      INSERT INTO wa_provider_configs (provider_id, enabled, is_active, config_json, updated_at)
      VALUES ('meta_cloud', ?, COALESCE((SELECT is_active FROM wa_provider_configs WHERE provider_id = 'meta_cloud'), 0), ?, datetime('now'))
      ON CONFLICT(provider_id) DO UPDATE SET
        enabled = excluded.enabled,
        config_json = excluded.config_json,
        updated_at = datetime('now')
    `).run(nextEnabled, JSON.stringify(current));

    addAuditLog('owner', 'wa_provider.meta_config_update', 'meta_cloud', {
      hasPhoneNumberId: Boolean(current.phoneNumberId),
      hasAccessToken: Boolean(current.encryptedAccessToken),
      enabled: Boolean(nextEnabled),
    });

    return {
      ok: true,
      message: 'Konfigurasi Meta Cloud API tersimpan terenkripsi. Status koneksi tetap jujur sesuai hasil verifikasi Graph API & webhook.',
    };
  }

  public getDescriptor(isActive: boolean, enabled: boolean): WaProviderDescriptor {
    const cfg = this.getRuntimeConfig();
    const configured = Boolean(cfg.accessToken && cfg.phoneNumberId);
    const webhookReady = Boolean(cfg.verifyToken && cfg.appSecret);

    let connectionState: WaProviderDescriptor['connectionState'] = 'disconnected';
    if (this.lastError) connectionState = 'failed';
    else if (configured && isActive && this.lastVerifiedAt) connectionState = 'connected';
    else if (configured && isActive) connectionState = 'authenticated';

    return {
      id: 'meta_cloud',
      name: 'Meta WhatsApp Business Cloud API (Resmi)',
      library: `Meta Graph API ${cfg.apiVersion}`,
      description:
        'Provider resmi Meta berbasis Cloud API & Webhook HTTPS. Cocok untuk penggunaan resmi jangka panjang dengan Interactive List standar Meta (maksimal 10 baris per pesan).',
      enabled,
      isActive,
      configured,
      connectionState,
      capabilities: META_CLOUD_CAPABILITIES,
      configurationChecklist: [
        { key: 'META_WA_ACCESS_TOKEN', label: 'Permanent/System User Access Token', configured: Boolean(cfg.accessToken), required: true },
        { key: 'META_WA_PHONE_NUMBER_ID', label: 'Phone Number ID (Meta Business)', configured: Boolean(cfg.phoneNumberId), required: true },
        { key: 'META_WA_VERIFY_TOKEN', label: 'Webhook Verify Token', configured: Boolean(cfg.verifyToken), required: true },
        { key: 'META_WA_APP_SECRET', label: 'App Secret (X-Hub-Signature-256)', configured: Boolean(cfg.appSecret), required: true },
        { key: 'META_WA_BUSINESS_ACCOUNT_ID', label: 'WABA ID (Opsional untuk info akun)', configured: Boolean(cfg.businessAccountId), required: false },
      ],
      limitations: [
        'Tidak menyediakan QR Code maupun Pairing Code WhatsApp Web.',
        'Interactive List resmi Cloud API dibatasi maksimal total 10 baris (rows) gabungan di seluruh section.',
        'Memerlukan URL Webhook HTTPS publik yang dapat diakses oleh server Meta dan verifikasi X-Hub-Signature-256.',
        'Tidak mendukung manajemen grup WhatsApp reguler maupun stiker+audio kombo non-resmi seperti Baileys.',
        webhookReady ? 'Webhook signature & verify token sudah terkonfigurasi.' : 'Webhook verify token / app secret belum lengkap.',
      ],
    };
  }

  public verifyWebhookChallenge(query: { mode?: string; token?: string; challenge?: string }): {
    ok: boolean;
    status: number;
    body: string;
  } {
    const cfg = this.getRuntimeConfig();
    if (!cfg.verifyToken) {
      return { ok: false, status: 503, body: 'META_WA_VERIFY_TOKEN belum dikonfigurasi.' };
    }
    if (query.mode === 'subscribe' && query.token && query.challenge) {
      const a = Buffer.from(query.token);
      const b = Buffer.from(cfg.verifyToken);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        this.lastWebhookAt = new Date().toISOString();
        return { ok: true, status: 200, body: query.challenge };
      }
    }
    return { ok: false, status: 403, body: 'Forbidden' };
  }

  public verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): { ok: boolean; reason?: string } {
    const cfg = this.getRuntimeConfig();
    if (!cfg.appSecret) {
      return { ok: false, reason: 'META_WA_APP_SECRET belum dikonfigurasi untuk memvalidasi signature webhook.' };
    }
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return { ok: false, reason: 'Header X-Hub-Signature-256 tidak ditemukan atau formatnya salah.' };
    }
    const providedHex = signatureHeader.slice('sha256='.length).trim();
    const expectedHex = crypto.createHmac('sha256', cfg.appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(providedHex, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Signature HMAC-SHA256 webhook tidak valid.' };
    }
    this.lastWebhookAt = new Date().toISOString();
    return { ok: true };
  }

  public extractIncomingMessages(payload: any): MetaWebhookNormalizedMessage[] {
    const out: MetaWebhookNormalizedMessage[] = [];
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        if (!value || !Array.isArray(value.messages)) continue;
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];
        const contactNameMap = new Map<string, string>();
        for (const c of contacts) {
          if (c?.wa_id && c?.profile?.name) {
            contactNameMap.set(String(c.wa_id), String(c.profile.name));
          }
        }
        for (const msg of value.messages) {
          const fromPhone = String(msg?.from || '').replace(/\D/g, '');
          if (!fromPhone) continue;
          const senderName = contactNameMap.get(fromPhone) || fromPhone;
          let text = '';
          let selectedRowId: string | undefined;

          if (msg.type === 'text' && msg.text?.body) {
            text = String(msg.text.body);
          } else if (msg.type === 'interactive' && msg.interactive) {
            if (msg.interactive.list_reply) {
              selectedRowId = String(msg.interactive.list_reply.id || '');
              text = String(msg.interactive.list_reply.title || selectedRowId);
            } else if (msg.interactive.button_reply) {
              selectedRowId = String(msg.interactive.button_reply.id || '');
              text = String(msg.interactive.button_reply.title || selectedRowId);
            }
          } else if (msg.type === 'button' && msg.button?.text) {
            text = String(msg.button.text);
          }

          if (!text && !selectedRowId) continue;

          out.push({
            messageId: String(msg.id || `meta-${Date.now()}`),
            fromPhone,
            senderName,
            chatId: `${fromPhone}@s.whatsapp.net`,
            text,
            selectedRowId,
            timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          });
        }
      }
    }
    return out;
  }

  public buildOfficialInteractiveListPayload(toPhoneDigits: string, menu: InteractiveMenuPayload, bodyText: string) {
    // Cloud API enforces max 10 rows total across all sections, title <= 24 chars, description <= 72 chars
    const sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> = [];
    let remaining = 10;
    for (const sec of menu.sections) {
      if (remaining <= 0) break;
      const sliced = sec.rows.slice(0, remaining).map((r) => ({
        id: r.id.slice(0, 200),
        title: r.title.slice(0, 24),
        description: r.description ? r.description.slice(0, 72) : undefined,
      }));
      remaining -= sliced.length;
      if (sliced.length > 0) {
        sections.push({
          title: sec.title.slice(0, 24),
          rows: sliced,
        });
      }
    }

    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhoneDigits,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: {
          type: 'text',
          text: menu.title.slice(0, 60),
        },
        body: {
          text: (bodyText || menu.subtitle || 'Pilih menu').slice(0, 1024),
        },
        footer: {
          text: menu.footer.slice(0, 60),
        },
        action: {
          button: menu.buttonText.slice(0, 20),
          sections,
        },
      },
    };
  }

  public async verifyConnectivity(): Promise<{ ok: boolean; message: string; phoneDisplay?: string }> {
    const cfg = this.getRuntimeConfig();
    if (!cfg.accessToken || !cfg.phoneNumberId) {
      return {
        ok: false,
        message: 'Meta Cloud API belum dikonfigurasi: isi META_WA_ACCESS_TOKEN dan META_WA_PHONE_NUMBER_ID dulu ya.',
      };
    }
    try {
      const url = `https://graph.facebook.com/${cfg.apiVersion}/${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json()) as any;
      if (!res.ok || json.error) {
        const errMsg = json?.error?.message || `HTTP ${res.status}`;
        this.lastError = errMsg;
        addSystemLog('error', 'metaCloudProvider', `Verifikasi Graph API gagal: ${errMsg}`);
        return { ok: false, message: `Verifikasi Meta Graph API gagal: ${errMsg}` };
      }
      this.lastError = null;
      this.lastVerifiedAt = new Date().toISOString();
      return {
        ok: true,
        message: `Meta Cloud API terhubung ke ${json.verified_name || 'Business'} (${json.display_phone_number || cfg.phoneNumberId}).`,
        phoneDisplay: json.display_phone_number,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Graph API Meta.';
      this.lastError = msg;
      return { ok: false, message: msg };
    }
  }

  public async sendText(toPhoneDigits: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getRuntimeConfig();
    if (!cfg.accessToken || !cfg.phoneNumberId) {
      return { ok: false, error: 'Meta Cloud API belum dikonfigurasi (butuh Access Token & Phone Number ID).' };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhoneDigits,
          type: 'text',
          text: { body: text.slice(0, 4096) },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await res.json()) as any;
      if (!res.ok || data.error) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        this.lastError = msg;
        return { ok: false, error: msg };
      }
      this.lastError = null;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      this.lastError = msg;
      return { ok: false, error: msg };
    }
  }

  public async sendInteractiveList(toPhoneDigits: string, menu: InteractiveMenuPayload, bodyText: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getRuntimeConfig();
    if (!cfg.accessToken || !cfg.phoneNumberId) {
      return { ok: false, error: 'Meta Cloud API belum dikonfigurasi.' };
    }
    const payload = this.buildOfficialInteractiveListPayload(toPhoneDigits, menu, bodyText);
    try {
      const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await res.json()) as any;
      if (!res.ok || data.error) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        this.lastError = msg;
        return { ok: false, error: msg };
      }
      this.lastError = null;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      this.lastError = msg;
      return { ok: false, error: msg };
    }
  }
}

export const metaCloudProvider = new MetaCloudApiProvider();
