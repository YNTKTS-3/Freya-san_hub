import { addAuditLog, db } from '../db';
import { buildBaileysDescriptor } from './baileysProvider';
import { metaCloudProvider } from './metaCloudProvider';
import type { WaConnectionState, WaProviderDescriptor, WaProviderId } from './types';

export class ConnectionProviderManager {
  public getActiveProviderId(): WaProviderId {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'active_wa_provider'`).get() as { value: string } | undefined;
    return row?.value === 'meta_cloud' ? 'meta_cloud' : 'baileys';
  }

  public setActiveProvider(providerId: WaProviderId, actor = 'owner'): { ok: boolean; activeProvider: WaProviderId; message: string } {
    if (providerId !== 'baileys' && providerId !== 'meta_cloud') {
      return { ok: false, activeProvider: this.getActiveProviderId(), message: 'Provider WhatsApp nggak dikenal.' };
    }
    db.transaction(() => {
      db.prepare(`UPDATE wa_provider_configs SET is_active = CASE WHEN provider_id = ? THEN 1 ELSE 0 END, enabled = CASE WHEN provider_id = ? THEN 1 ELSE enabled END, updated_at = datetime('now')`).run(
        providerId,
        providerId,
      );
      db.prepare(
        `INSERT INTO settings (key, value, is_secret, updated_at) VALUES ('active_wa_provider', ?, 0, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ).run(providerId);
    })();
    addAuditLog(actor, 'wa_provider.switch', providerId);
    return {
      ok: true,
      activeProvider: providerId,
      message:
        providerId === 'meta_cloud'
          ? 'Provider aktif diganti ke Meta WhatsApp Cloud API (resmi). Sesi Baileys tetap terpisah & nggak dicampur.'
          : 'Provider aktif diganti ke Baileys Linked Devices (QR & Pairing Code).',
    };
  }

  public listProviders(baileysRuntime: {
    hasStoredAuth: boolean;
    connectionState: WaConnectionState;
    libraryVersion: string;
  }): {
    activeProviderId: WaProviderId;
    providers: WaProviderDescriptor[];
    coexistencePolicy: string;
  } {
    const activeProviderId = this.getActiveProviderId();
    const rows = db.prepare(`SELECT provider_id, enabled, is_active FROM wa_provider_configs`).all() as Array<{
      provider_id: string;
      enabled: number;
      is_active: number;
    }>;
    const rowMap = new Map(rows.map((r) => [r.provider_id, r]));

    const baileysRow = rowMap.get('baileys');
    const metaRow = rowMap.get('meta_cloud');

    const baileysDesc = buildBaileysDescriptor({
      enabled: baileysRow ? Boolean(baileysRow.enabled) : true,
      isActive: activeProviderId === 'baileys',
      hasStoredAuth: baileysRuntime.hasStoredAuth,
      connectionState: baileysRuntime.connectionState,
      libraryVersion: baileysRuntime.libraryVersion,
    });

    const metaDesc = metaCloudProvider.getDescriptor(
      activeProviderId === 'meta_cloud',
      metaRow ? Boolean(metaRow.enabled) : false,
    );

    return {
      activeProviderId,
      providers: [baileysDesc, metaDesc],
      coexistencePolicy:
        'Baileys dan Meta Cloud API dipisah total (kredensial, sesi, dan event handler terpisah). Satu nomor telepon umumnya tidak bisa aktif di kedua protokol sekaligus tanpa onboarding Meta Coexistence resmi.',
    };
  }
}

export const connectionProviderManager = new ConnectionProviderManager();
