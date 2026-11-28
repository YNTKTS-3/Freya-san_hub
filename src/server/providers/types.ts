export type WaProviderId = 'baileys' | 'meta_cloud';

export type WaConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'waiting_qr'
  | 'waiting_pairing'
  | 'authenticated'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface WaProviderCapabilities {
  supportsQr: boolean;
  supportsPairingCode: boolean;
  supportsInteractiveList: boolean;
  interactiveListMaxRows: number;
  supportsAudioStickerCombo: boolean;
  supportsGroupManagement: boolean;
  requiresWebhook: boolean;
  requiresOfficialBusinessCredentials: boolean;
  coexistenceNote: string;
}

export interface WaProviderDescriptor {
  id: WaProviderId;
  name: string;
  library: string;
  description: string;
  enabled: boolean;
  isActive: boolean;
  configured: boolean;
  connectionState: WaConnectionState;
  capabilities: WaProviderCapabilities;
  configurationChecklist: Array<{
    key: string;
    label: string;
    configured: boolean;
    required: boolean;
  }>;
  limitations: string[];
}

export interface MetaWebhookNormalizedMessage {
  messageId: string;
  fromPhone: string;
  senderName: string;
  chatId: string;
  text: string;
  selectedRowId?: string;
  timestamp: string;
}
