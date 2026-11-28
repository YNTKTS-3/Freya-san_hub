import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  KeyRound,
  Phone,
  QrCode,
  RefreshCw,
  RotateCcw,
  Shield,
  Trash2,
  X,
} from 'lucide-react';

export interface WaStatusSnapshot {
  status: string;
  connectionState?: 'disconnected' | 'connecting' | 'qr_ready' | 'pairing_code_ready' | 'authenticated' | 'connected' | 'reconnecting' | 'failed';
  phoneNumber: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  reconnectAttempts?: number;
  queueLength: number;
  blueTickEnabled: boolean;
  connectionMethod?: 'qr' | 'pairing_code';
  pairingStatus?: 'idle' | 'waiting' | 'code_ready' | 'success' | 'failed' | 'expired' | 'cancelled';
  pairingCode?: string | null;
  pairingPhoneMasked?: string | null;
  pairingRequestedAt?: string | null;
  pairingExpiresAt?: string | null;
  pairingError?: string | null;
  hasStoredAuth?: boolean;
  isOperationLocked?: boolean;
}

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

interface WhatsAppConnectionPanelProps {
  waStatus: WaStatusSnapshot | null;
  waHistory: WaConnectionHistoryItem[];
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

function validatePairingPhoneClient(rawInput: string): { ok: boolean; normalized: string; error?: string } {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      normalized: '',
      error: 'Masukin nomor WhatsApp dulu (contoh: 628xxxxxxxxxx atau 08xxxxxxxxxx).',
    };
  }
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return {
      ok: false,
      normalized: '',
      error: 'Nomor WhatsApp cuma boleh berisi angka dan kode negara (contoh: 628xxxxxxxxxx).',
    };
  }
  if (digits.startsWith('08')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('0')) {
    return {
      ok: false,
      normalized: '',
      error: 'Nomor nggak boleh diawali 0 selain awalan 08xx Indonesia (contoh: 628xxxxxxxxxx).',
    };
  }
  if (digits.length < 8 || digits.length > 15) {
    return {
      ok: false,
      normalized: '',
      error: 'Panjang nomor WhatsApp nggak valid (wajib 8–15 digit termasuk kode negara).',
    };
  }
  return { ok: true, normalized: digits };
}

function formatPairingCodeDisplay(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return code;
}

function getPairingBadgeMeta(status?: string): { label: string; className: string } {
  switch (status) {
    case 'waiting':
      return {
        label: 'Menunggu Kode...',
        className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      };
    case 'code_ready':
      return {
        label: 'Kode Siap Dimasukin',
        className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      };
    case 'success':
      return {
        label: 'Berhasil Tertaut',
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    case 'failed':
      return {
        label: 'Gagal',
        className: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800',
      };
    case 'expired':
      return {
        label: 'Kedaluwarsa',
        className: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200 dark:border-orange-800',
      };
    case 'cancelled':
      return {
        label: 'Dibatalkan',
        className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700',
      };
    default:
      return {
        label: 'Siap',
        className: 'bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      };
  }
}

function getEventTypeLabel(eventType: string): string {
  const map: Record<string, string> = {
    connect_qr: 'Koneksi QR Code',
    connect_pairing: 'Minta Pairing Code',
    pairing_code_issued: 'Kode Pairing Dibuat',
    pairing_success: 'Pairing Berhasil',
    pairing_failed: 'Pairing Gagal',
    pairing_expired: 'Pairing Kedaluwarsa',
    pairing_cancelled: 'Pairing Dibatalkan',
    connect_open: 'WhatsApp Terhubung',
    connect_error: 'Error Koneksi',
    reconnect_attempt: 'Reconnect Otomatis',
    session_logged_out: 'Sesi Logout',
    disconnect: 'Putus Koneksi',
    reset_connection: 'Reset Koneksi',
    reset_full_session: 'Reset Sesi Penuh',
  };
  return map[eventType] || eventType;
}

export const WhatsAppConnectionPanel: React.FC<WhatsAppConnectionPanelProps> = ({
  waStatus,
  waHistory,
  apiFetch,
  onRefresh,
}) => {
  const [connMethod, setConnMethod] = useState<'qr' | 'pairing_code'>(
    waStatus?.connectionMethod === 'pairing_code' ? 'pairing_code' : 'qr',
  );
  const [pairingPhone, setPairingPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [resetPanelMode, setResetPanelMode] = useState<'none' | 'connection' | 'full_session'>('none');
  const [confirmFullResetChecked, setConfirmFullResetChecked] = useState(false);

  // Dual Provider State (Baileys vs Meta Cloud API)
  const [providerData, setProviderData] = useState<{ activeProviderId: 'baileys' | 'meta_cloud'; providers: any[]; coexistencePolicy: string } | null>(null);
  const [metaPhoneId, setMetaPhoneId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaVerifyToken, setMetaVerifyToken] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [metaVerifyResult, setMetaVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);

  const loadProviders = async () => {
    const res = await apiFetch('/api/admin/whatsapp/providers');
    if (res?.ok) setProviderData(res);
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    if (!waStatus?.pairingExpiresAt || (waStatus?.pairingStatus !== 'code_ready' && waStatus?.pairingStatus !== 'waiting')) {
      setCountdownSec(null);
      return;
    }
    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((new Date(waStatus.pairingExpiresAt!).getTime() - Date.now()) / 1000));
      setCountdownSec(diff);
    };
    updateTimer();
    const t = setInterval(updateTimer, 1000);
    return () => clearInterval(t);
  }, [waStatus?.pairingExpiresAt, waStatus?.pairingStatus]);

  useEffect(() => {
    if (waStatus?.pairingStatus === 'failed' || waStatus?.pairingStatus === 'expired' || waStatus?.status === 'error') {
      setFeedback((prev) => (prev?.ok ? null : prev));
    }
  }, [waStatus?.pairingStatus, waStatus?.status]);

  const isConnected = waStatus?.status === 'connected';
  const isWaitingAuth =
    waStatus?.status === 'connecting' ||
    waStatus?.status === 'qr_ready' ||
    waStatus?.pairingStatus === 'waiting' ||
    waStatus?.pairingStatus === 'code_ready';

  const pairingBadge = getPairingBadgeMeta(waStatus?.pairingStatus);
  const activeProviderId = providerData?.activeProviderId || 'baileys';
  const metaDescriptor = providerData?.providers?.find((p) => p.id === 'meta_cloud');

  const handleConnectQr = async () => {
    setFeedback(null);
    setPhoneError(null);
    setActionBusy('qr');
    try {
      const res = await apiFetch('/api/admin/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify({ method: 'qr' }),
      });
      setFeedback({ ok: Boolean(res.ok), text: res.message || res.error || 'Status koneksi QR diperbarui.' });
      await onRefresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleRequestPairing = async () => {
    setFeedback(null);
    const check = validatePairingPhoneClient(pairingPhone);
    if (!check.ok) {
      setPhoneError(check.error || 'Nomor WhatsApp nggak valid.');
      return;
    }
    setPhoneError(null);
    setActionBusy('pairing');
    try {
      const res = await apiFetch('/api/admin/whatsapp/pairing', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: check.normalized }),
      });
      setFeedback({
        ok: Boolean(res.ok),
        text: res.message || res.error || (res.ok ? 'Permintaan pairing code diproses.' : 'Gagal minta pairing code.'),
      });
      await onRefresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancelAuth = async () => {
    setFeedback(null);
    setActionBusy('cancel');
    try {
      const res = await apiFetch('/api/admin/whatsapp/pairing/cancel', { method: 'POST' });
      setFeedback({ ok: Boolean(res.ok), text: res.message || res.error || 'Proses tautan dibatalin.' });
      await onRefresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setFeedback(null);
    setActionBusy('disconnect');
    try {
      const res = await apiFetch('/api/admin/whatsapp/disconnect', { method: 'POST' });
      setFeedback({ ok: Boolean(res.ok), text: res.message || res.error || 'Koneksi diputuskan.' });
      await onRefresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleResetConnection = async () => {
    setFeedback(null);
    setActionBusy('reset_conn');
    try {
      const res = await apiFetch('/api/admin/whatsapp/reset-connection', { method: 'POST' });
      setFeedback({ ok: Boolean(res.ok), text: res.message || res.error || 'Reset koneksi selesai.' });
      setResetPanelMode('none');
      await onRefresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleResetFullSession = async () => {
    if (!confirmFullResetChecked) {
      setFeedback({ ok: false, text: 'Centang dulu konfirmasi penghapusan sesi sebelum lanjut ya.' });
      return;
    }
    setFeedback(null);
    setActionBusy('reset_full');
    try {
      const res = await apiFetch('/api/admin/whatsapp/reset-session', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      setFeedback({ ok: Boolean(res.ok), text: res.message || res.error || 'Reset sesi penuh selesai.' });
      setResetPanelMode('none');
      setConfirmFullResetChecked(false);
      await onRefresh();
    } finally {
      setActionBusy(null);
    }
  };

  const handleCopyPairingCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Clipboard may be restricted in headless mode
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Connection Manager (@whiskeysockets/baileys)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pilih cara menautkan akun WhatsApp bot: pakai pindai QR Code atau masukin Pairing Code 8 digit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                waStatus?.hasStoredAuth
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {waStatus?.hasStoredAuth ? 'Sesi Auth Tersimpan' : 'Belum Ada Kredensial Auth'}
            </span>
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              title="Muat ulang status koneksi"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Dual Provider Switcher */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-200">WhatsApp Connection Provider</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch('/api/admin/whatsapp/providers/select', {
                    method: 'POST',
                    body: JSON.stringify({ providerId: 'baileys' }),
                  });
                  setFeedback({ ok: Boolean(res?.ok), text: res?.message || 'Provider Baileys dipilih.' });
                  await loadProviders();
                }}
                className={`px-3 py-1 rounded-lg font-semibold border ${
                  activeProviderId === 'baileys'
                    ? 'border-blue-600 bg-blue-700 text-white'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                Baileys Linked Devices
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch('/api/admin/whatsapp/providers/select', {
                    method: 'POST',
                    body: JSON.stringify({ providerId: 'meta_cloud' }),
                  });
                  setFeedback({ ok: Boolean(res?.ok), text: res?.message || 'Provider Meta Cloud API dipilih.' });
                  await loadProviders();
                }}
                className={`px-3 py-1 rounded-lg font-semibold border ${
                  activeProviderId === 'meta_cloud'
                    ? 'border-blue-600 bg-blue-700 text-white'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                Meta Cloud API (Resmi)
              </button>
            </div>
          </div>
          {providerData?.coexistencePolicy && (
            <p className="text-[11px] text-slate-500">{providerData.coexistencePolicy}</p>
          )}
        </div>

        {activeProviderId === 'meta_cloud' && (
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-slate-900 dark:text-white">
                Konfigurasi Meta WhatsApp Business Cloud API
              </div>
              <span className="font-mono px-2 py-0.5 rounded bg-slate-900 text-white text-[11px]">
                State: {metaDescriptor?.connectionState || 'disconnected'}
              </span>
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              Webhook Endpoint: <code className="font-mono">/api/webhooks/meta-whatsapp</code> (GET challenge + POST signature <code className="font-mono">X-Hub-Signature-256</code>).
            </div>
            {Array.isArray(metaDescriptor?.configurationChecklist) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {metaDescriptor.configurationChecklist.map((c: any) => (
                  <div key={c.key} className="px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="truncate">{c.label}</span>
                    <span className={`font-mono text-[10px] font-bold ${c.configured ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {c.configured ? 'SIAP' : c.required ? 'WAJIB' : 'OPSIONAL'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={metaPhoneId}
                onChange={(e) => setMetaPhoneId(e.target.value)}
                placeholder="Phone Number ID"
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="text"
                value={metaWabaId}
                onChange={(e) => setMetaWabaId(e.target.value)}
                placeholder="WABA ID (opsional)"
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="password"
                value={metaAccessToken}
                onChange={(e) => setMetaAccessToken(e.target.value)}
                placeholder="Access Token (tersimpan terenkripsi)"
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="password"
                value={metaAppSecret}
                onChange={(e) => setMetaAppSecret(e.target.value)}
                placeholder="App Secret (HMAC X-Hub-Signature-256)"
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="text"
                value={metaVerifyToken}
                onChange={(e) => setMetaVerifyToken(e.target.value)}
                placeholder="Webhook Verify Token"
                className="sm:col-span-2 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch('/api/admin/whatsapp/providers/meta', {
                    method: 'PATCH',
                    body: JSON.stringify({
                      phoneNumberId: metaPhoneId || undefined,
                      businessAccountId: metaWabaId || undefined,
                      accessToken: metaAccessToken || undefined,
                      appSecret: metaAppSecret || undefined,
                      verifyToken: metaVerifyToken || undefined,
                      enabled: true,
                    }),
                  });
                  setMetaAccessToken('');
                  setMetaAppSecret('');
                  setFeedback({ ok: Boolean(res?.ok), text: res?.message || 'Konfigurasi Meta Cloud API disimpan.' });
                  await loadProviders();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-blue-700 text-white font-semibold"
              >
                Simpan Kredensial Meta
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch('/api/admin/whatsapp/providers/meta/verify', { method: 'POST' });
                  setMetaVerifyResult({ ok: Boolean(res?.ok), message: res?.message || 'Verifikasi selesai.' });
                  await loadProviders();
                }}
                className="px-3.5 py-1.5 rounded-lg border border-blue-600 text-blue-700 dark:text-blue-400 font-semibold"
              >
                Verifikasi Meta Graph API
              </button>
            </div>
            {metaVerifyResult && (
              <div className={`p-2.5 rounded-lg border ${metaVerifyResult.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
                {metaVerifyResult.message}
              </div>
            )}
            {Array.isArray(metaDescriptor?.limitations) && (
              <ul className="list-disc pl-4 text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                {metaDescriptor.limitations.map((lim: string, i: number) => (
                  <li key={i}>{lim}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Status Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Status &amp; State Engine</span>
            <span
              className={`font-mono font-bold ${
                isConnected
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : waStatus?.status === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-blue-700 dark:text-blue-400'
              }`}
            >
              {waStatus?.connectionState || waStatus?.status || 'disconnected'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Status Pairing</span>
            <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${pairingBadge.className}`}>
              {pairingBadge.label}
              {countdownSec !== null && countdownSec > 0 ? ` (${countdownSec}s)` : ''}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Nomor Terhubung</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {waStatus?.phoneNumber || waStatus?.pairingPhoneMasked || 'Belum tertaut'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Antrean / Blue Tick</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {waStatus?.queueLength ?? 0} msg · {waStatus?.blueTickEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Connected Guard Banner */}
        {isConnected && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex flex-wrap items-center justify-between gap-2">
            <span>
              Akun WhatsApp udah terhubung ({waStatus?.phoneNumber || 'aktif'}). Nggak bakal bikin sesi baru selama masih terhubung—kalau mau ganti nomor, putusin koneksi atau pakai Reset Sesi Penuh dulu ya.
            </span>
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={handleDisconnect}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            >
              Putuskan Koneksi
            </button>
          </div>
        )}

        {/* Method Selector */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Pilih Metode Koneksi</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              data-testid="method-qr-btn"
              onClick={() => {
                setConnMethod('qr');
                setPhoneError(null);
              }}
              className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                connMethod === 'qr'
                  ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <QrCode className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-xs font-bold">Hubungkan dengan QR Code</div>
                <div className="text-[11px] opacity-80">Pindai gambar QR pakai kamera WhatsApp HP</div>
              </div>
            </button>
            <button
              type="button"
              data-testid="method-pairing-btn"
              onClick={() => {
                setConnMethod('pairing_code');
                setPhoneError(null);
              }}
              className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                connMethod === 'pairing_code'
                  ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <KeyRound className="w-5 h-5 shrink-0" />
              <div>
                <div className="text-xs font-bold">Hubungkan dengan Pairing Code</div>
                <div className="text-[11px] opacity-80">Masukin nomor + kode 8 digit tanpa perlu kamera</div>
              </div>
            </button>
          </div>
        </div>

        {/* Method 1: QR Code */}
        {connMethod === 'qr' && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="connect-qr-btn"
                disabled={isConnected || actionBusy !== null}
                onClick={handleConnectQr}
                className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2"
              >
                <QrCode className="w-3.5 h-3.5" />
                {actionBusy === 'qr' ? 'Menyiapkan QR...' : 'Hubungkan dengan QR Code'}
              </button>
              {!isConnected && (
                <button
                  type="button"
                  data-testid="refresh-qr-btn"
                  disabled={actionBusy !== null}
                  onClick={async () => {
                    setFeedback(null);
                    setActionBusy('refresh_qr');
                    try {
                      const res = await apiFetch('/api/admin/whatsapp/refresh-qr', { method: 'POST' });
                      setFeedback({ ok: Boolean(res?.ok), text: res?.message || res?.error || 'QR baru sedang disiapkan.' });
                      await onRefresh();
                    } finally {
                      setActionBusy(null);
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg border border-blue-600 text-blue-700 dark:text-blue-400 text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh QR
                </button>
              )}
              {isWaitingAuth && (
                <button
                  type="button"
                  data-testid="cancel-qr-btn"
                  disabled={actionBusy !== null}
                  onClick={handleCancelAuth}
                  className="px-3.5 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <X className="w-3.5 h-3.5" />
                  Batal
                </button>
              )}
              {isConnected && (
                <button
                  type="button"
                  disabled={actionBusy !== null}
                  onClick={handleDisconnect}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Putuskan Koneksi
                </button>
              )}
            </div>

            {waStatus?.qrDataUrl ? (
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="p-3 bg-white rounded-xl border border-slate-200 shrink-0">
                  <img src={waStatus.qrDataUrl} alt="QR Login WhatsApp" className="w-48 h-48" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                  <div className="font-bold text-slate-900 dark:text-white">Cara tautin pakai QR Code:</div>
                  <p>1. Buka WhatsApp di HP kamu, ketuk menu titik tiga / Setelan.</p>
                  <p>2. Masuk ke <strong>Perangkat Tertaut</strong> lalu pilih <strong>Tautkan Perangkat</strong>.</p>
                  <p>3. Arahin kamera HP ke QR Code di samping sampai tersambung.</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Klik tombol <strong>Hubungkan dengan QR Code</strong> buat bikin sesi login WhatsApp atau nyambungin ulang sesi tersimpan.
              </p>
            )}
          </div>
        )}

        {/* Method 2: Pairing Code */}
        {connMethod === 'pairing_code' && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nomor WhatsApp (dengan Kode Negara)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    data-testid="pairing-phone-input"
                    value={pairingPhone}
                    disabled={isConnected || actionBusy !== null}
                    onChange={(e) => {
                      setPairingPhone(e.target.value);
                      if (phoneError) setPhoneError(null);
                    }}
                    placeholder="6281234567890"
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
                <button
                  type="button"
                  data-testid="request-pairing-btn"
                  disabled={isConnected || actionBusy !== null}
                  onClick={handleRequestPairing}
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {actionBusy === 'pairing' ? 'Meminta Kode...' : 'Minta Pairing Code'}
                </button>
                {isWaitingAuth && (
                  <button
                    type="button"
                    data-testid="cancel-pairing-btn"
                    disabled={actionBusy !== null}
                    onClick={handleCancelAuth}
                    className="px-3.5 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                    Batal
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Masukin nomor pakai kode negara (contoh: <code className="font-mono">6281234567890</code>) atau awalan <code className="font-mono">08xx</code> (otomatis diubah jadi <code className="font-mono">628xx</code>).
              </p>
              {phoneError && (
                <div
                  data-testid="pairing-phone-error"
                  className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300"
                >
                  {phoneError}
                </div>
              )}
            </div>

            {/* Generated Pairing Code Box */}
            {waStatus?.pairingCode && (
              <div
                data-testid="pairing-code-card"
                className="p-4 rounded-xl bg-white dark:bg-slate-900 border-2 border-blue-500/70 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-blue-700 dark:text-blue-400">
                    Kode Pairing WhatsApp Siap!
                  </div>
                  {waStatus.pairingExpiresAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                      <Clock className="w-3 h-3" />
                      Berlaku s/d {new Date(waStatus.pairingExpiresAt).toLocaleTimeString('id-ID')}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="px-4 py-2.5 rounded-lg bg-slate-950 text-white font-mono text-2xl tracking-[0.25em] font-bold">
                    {formatPairingCodeDisplay(waStatus.pairingCode)}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyPairingCode(waStatus.pairingCode || '')}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCode ? 'Tersalin!' : 'Salin Kode'}
                  </button>
                </div>
              </div>
            )}

            {/* Linked Devices Instructions */}
            <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-bold text-slate-900 dark:text-white">Cara masukin Pairing Code di WhatsApp:</div>
              <p>1. Buka aplikasi WhatsApp di HP kamu, lalu buka <strong>Setelan</strong> (atau menu titik tiga di kanan atas).</p>
              <p>2. Ketuk <strong>Perangkat Tertaut</strong> &gt; <strong>Tautkan Perangkat</strong>.</p>
              <p>3. Pilih <strong>Tautkan dengan nomor telepon sebagai gantinya</strong> di bagian bawah layar.</p>
              <p>4. Masukin 8 karakter kode pairing yang muncul di dashboard ini ke HP kamu.</p>
            </div>
          </div>
        )}

        {/* Action Feedback / Errors */}
        {feedback && (
          <div
            data-testid="wa-feedback-banner"
            className={`p-3 rounded-lg border text-xs ${
              feedback.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {(waStatus?.pairingError || waStatus?.lastError) && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
            Catatan Koneksi: {waStatus?.pairingError || waStatus?.lastError}
          </div>
        )}

        {/* Reset Baileys Section */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Reset Baileys
              </h3>
              <p className="text-xs text-slate-500">
                Pakai menu ini kalau koneksi WhatsApp nyangkut, autentikasi gagal, atau kamu pengen ganti akun WhatsApp bot.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="open-reset-connection-btn"
                disabled={actionBusy !== null}
                onClick={() => {
                  setConfirmFullResetChecked(false);
                  setResetPanelMode(resetPanelMode === 'connection' ? 'none' : 'connection');
                }}
                className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Koneksi
              </button>
              <button
                type="button"
                data-testid="open-reset-session-btn"
                disabled={actionBusy !== null}
                onClick={() => {
                  setConfirmFullResetChecked(false);
                  setResetPanelMode(resetPanelMode === 'full_session' ? 'none' : 'full_session');
                }}
                className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-100 dark:hover:bg-rose-900/40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset Sesi Penuh
              </button>
            </div>
          </div>

          {resetPanelMode === 'connection' && (
            <div
              data-testid="confirm-reset-connection-box"
              className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 space-y-3 text-xs"
            >
              <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">Konfirmasi Reset Koneksi Baileys</div>
                  <p>
                    Dampak: koneksi aktif &amp; proses autentikasi/pairing yang lagi jalan bakal dihentikan, timer reconnect lama dimatikan, antrean/error sementara dibersihin, lalu sistem nyoba nyambung ulang pakai kredensial yang masih valid (tanpa hapus login WhatsApp kalau masih tersimpan).
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="confirm-reset-connection-btn"
                  disabled={actionBusy !== null}
                  onClick={handleResetConnection}
                  className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {actionBusy === 'reset_conn' ? 'Mereset Koneksi...' : 'Ya, Reset Koneksi Sekarang'}
                </button>
                <button
                  type="button"
                  onClick={() => setResetPanelMode('none')}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold"
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {resetPanelMode === 'full_session' && (
            <div
              data-testid="confirm-reset-session-box"
              className="p-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30 space-y-3 text-xs"
            >
              <div className="flex items-start gap-2 text-rose-900 dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">Konfirmasi Reset Sesi Penuh Baileys</div>
                  <p>
                    Dampak: semua koneksi aktif &amp; reconnect lama dihentikan, seluruh kredensial autentikasi Baileys lama di <code className="font-mono">data/wa-auth</code> dihapus bersih, lalu state auth baru disiapin. Kamu wajib menautkan ulang WhatsApp lewat QR Code atau Pairing Code setelah ini. Data aplikasi (user, command, setting, skor game, redeem) tetap aman dan nggak ikut kehapus.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="confirm-reset-session-checkbox"
                  checked={confirmFullResetChecked}
                  onChange={(e) => setConfirmFullResetChecked(e.target.checked)}
                  className="rounded border-rose-400"
                />
                Saya paham sesi autentikasi Baileys lama bakal dihapus dan harus ditautkan ulang.
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="confirm-reset-session-btn"
                  disabled={!confirmFullResetChecked || actionBusy !== null}
                  onClick={handleResetFullSession}
                  className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold"
                >
                  {actionBusy === 'reset_full' ? 'Menghapus Sesi...' : 'Ya, Hapus Sesi & Reset Penuh'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetPanelMode('none');
                    setConfirmFullResetChecked(false);
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold"
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const WhatsAppConnectionHistoryCard: React.FC<{
  waHistory: WaConnectionHistoryItem[];
  onRefresh: () => Promise<void>;
}> = ({ waHistory, onRefresh }) => {
  return (
    <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Riwayat Koneksi &amp; Reset Baileys</h3>
          <p className="text-xs text-slate-500">
            Catatan waktu, jenis event/reset, metode koneksi, dan hasil tanpa nyimpen kunci rahasia atau kredensial mentah.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {waHistory.length === 0 ? (
        <div className="text-xs text-slate-500 py-3">Belum ada riwayat koneksi atau reset yang tercatat.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Waktu</th>
                <th className="py-2 pr-3 font-semibold">Event</th>
                <th className="py-2 pr-3 font-semibold">Metode</th>
                <th className="py-2 pr-3 font-semibold">Target</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 font-semibold">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {waHistory.slice(0, 20).map((row) => (
                <tr key={row.id} className="text-slate-700 dark:text-slate-300">
                  <td className="py-2 pr-3 font-mono whitespace-nowrap text-[11px]">{row.created_at}</td>
                  <td className="py-2 pr-3 font-semibold whitespace-nowrap">{getEventTypeLabel(row.event_type)}</td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">{row.connection_method}</td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">{row.target_masked || '-'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        row.status === 'ok'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : row.status === 'cancelled'
                            ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
