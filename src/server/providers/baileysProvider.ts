import type { WaConnectionState, WaProviderCapabilities, WaProviderDescriptor } from './types';

export const BAILEYS_CAPABILITIES: WaProviderCapabilities = {
  supportsQr: true,
  supportsPairingCode: true,
  supportsInteractiveList: true,
  interactiveListMaxRows: 25,
  supportsAudioStickerCombo: true,
  supportsGroupManagement: true,
  requiresWebhook: false,
  requiresOfficialBusinessCredentials: false,
  coexistenceNote:
    'Baileys menghubungkan akun WhatsApp melalui protokol Linked Devices (WhatsApp Web). Satu nomor yang ditautkan ke Meta Cloud API tidak boleh dijalankan bersamaan pada sesi Baileys tanpa program coexistence resmi.',
};

export function buildBaileysDescriptor(params: {
  enabled: boolean;
  isActive: boolean;
  hasStoredAuth: boolean;
  connectionState: WaConnectionState;
  libraryVersion: string;
}): WaProviderDescriptor {
  return {
    id: 'baileys',
    name: 'Baileys Linked Devices (WhatsApp Web)',
    library: `@whiskeysockets/baileys ${params.libraryVersion}`,
    description:
      'Koneksi langsung lewat mekanisme Perangkat Tertaut WhatsApp (QR Code & Pairing Code) tanpa server webhook publik. Mendukung manajemen grup penuh, stiker, media, dan Hybrid Interactive List.',
    enabled: params.enabled,
    isActive: params.isActive,
    configured: true,
    connectionState: params.connectionState,
    capabilities: BAILEYS_CAPABILITIES,
    configurationChecklist: [
      { key: 'wa_auth_dir', label: 'Direktori Sesi Auth (data/wa-auth)', configured: true, required: true },
      { key: 'creds_json', label: 'Kredensial Perangkat Tertaut', configured: params.hasStoredAuth, required: false },
    ],
    limitations: [
      'Merupakan library WhatsApp Web tidak resmi; stabilitas Interactive List (`nativeFlowMessage` / `listMessage`) di klien Android/iOS tertentu bergantung pada dukungan server WhatsApp sehingga Hybrid Text Fallback otomatis disiapkan.',
      'Pairing Code mewajibkan format nomor internasional digit saja (contoh Indonesia: 62812xxxxxxxx) dan restart otomatis saat server WhatsApp mengirim kode 515 (restartRequired).',
    ],
  };
}
