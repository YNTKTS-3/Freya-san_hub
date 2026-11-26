import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Shield, ShieldAlert, Unlock } from 'lucide-react';

interface AbusePreventionPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
}

const SUBMODULE_LABELS: Array<{ key: string; title: string; desc: string }> = [
  { key: 'anti_spam', title: '1. Anti-Spam & Flood Protection', desc: 'Batasi burst command, interval minimum, & cooldown per user.' },
  { key: 'anti_exploit', title: '2. Anti-Exploit & Payload Sanitization', desc: 'Deteksi angka negatif, kegagalan berulang, dan injection payload.' },
  { key: 'anti_double_claim', title: '3. Anti-Double Claim & Concurrency Guard', desc: 'Kunci transaksi per user+aksi agar redeem, bom cashout, & reward anti-dobel.' },
  { key: 'session_protection', title: '4. Session & Game Protection', desc: 'Validasi host/admin UNO & Werewolf, urutan giliran, dan timeout 60s.' },
  { key: 'economy_protection', title: '5. Economy & Limit Integrity', desc: 'Audit transaksi limit/balance & batas per transaksi #addlimit.' },
  { key: 'permission_guard', title: '6. Access Control & Permission Guard', desc: 'Tolak akses command owner/admin dari akun non-berwenang.' },
  { key: 'resource_protection', title: '7. Media & Resource Protection', desc: 'Batasi panjang teks sticker/mockup (100 char) & jeda antrean DM 2–5s.' },
  { key: 'audit_monitoring', title: '8. Security Audit & Monitoring', desc: 'Catat user_error, rule_violation, suspicious, dan confirmed_exploit real-time.' },
  { key: 'auto_recovery', title: '9. Auto-Recovery & Safe Fallback', desc: 'Release lock otomatis & sapu sesi kadaluarsa berkala.' },
  { key: 'abuse_management', title: '10. User Abuse Action Engine', desc: 'Otomatis atau manual berikan Warn, Temp Restrict, Block, atau Restore.' },
];

export const AbusePreventionPanel: React.FC<AbusePreventionPanelProps> = ({ apiFetch }) => {
  const [data, setData] = useState<{
    config: Record<string, any>;
    restrictions: any[];
    events: any[];
    runtimeHealth: { activeActionLocks: number; trackedRateWindows: number };
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [targetPhone, setTargetPhone] = useState('');
  const [actionType, setActionType] = useState<'warn' | 'temp_restrict' | 'block' | 'restore'>('warn');
  const [durationMin, setDurationMin] = useState(30);
  const [reason, setReason] = useState('Terindikasi spam berulang');

  const loadData = async () => {
    const res = await apiFetch('/api/admin/abuse');
    if (res.ok) setData(res);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSaveConfig = async (nextConfig: Record<string, any>) => {
    setSaving(true);
    setFeedback(null);
    const res = await apiFetch('/api/admin/abuse/config', {
      method: 'PATCH',
      body: JSON.stringify(nextConfig),
    });
    setSaving(false);
    if (res.ok) {
      setFeedback('Konfigurasi Anti-Abuse tersimpan.');
      void loadData();
    } else {
      setFeedback(res.error || 'Gagal menyimpan konfigurasi.');
    }
  };

  const handleManualAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const res = await apiFetch('/api/admin/abuse/action', {
      method: 'POST',
      body: JSON.stringify({
        userPhone: targetPhone,
        action: actionType,
        durationMinutes: durationMin,
        reason,
      }),
    });
    if (res.ok) {
      setFeedback(`Aksi "${actionType}" diterapkan ke ${targetPhone}.`);
      setTargetPhone('');
      void loadData();
    } else {
      setFeedback(res.error || 'Gagal menerapkan aksi moderasi.');
    }
  };

  const cfg = data?.config ?? {};
  const unresolvedEvents = (data?.events ?? []).filter((e) => !e.resolved).length;
  const activeBlocked = (data?.restrictions ?? []).filter((r) => r.restriction_level === 'blocked').length;
  const activeTemp = (data?.restrictions ?? []).filter((r) => r.restriction_level === 'temp_restricted').length;

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Summary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500">Event Belum Ditinjau</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-amber-600 dark:text-amber-400">
            {unresolvedEvents}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500">Status Restriksi Aktif</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-rose-600 dark:text-rose-400">
            {activeBlocked} Block · {activeTemp} Temp
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500">Rate Windows Aktif</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1">
            {data?.runtimeHealth?.trackedRateWindows ?? 0}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500">Concurrency Action Locks</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1">
            {data?.runtimeHealth?.activeActionLocks ?? 0}
          </div>
        </div>
      </div>

      {/* 10 Submodules Matrix */}
      <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              10 Submodul Keamanan & Anti-Abuse
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Aktifkan/nonaktifkan modul pengaman real-time tanpa restart bot.</p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSaveConfig(cfg)}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold"
          >
            {saving ? 'Menyimpan...' : 'Simpan Semua Parameter'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SUBMODULE_LABELS.map((sub) => {
            const subObj = cfg[sub.key] ?? { enabled: true };
            const isOn = Boolean(subObj.enabled ?? true);
            return (
              <div
                key={sub.key}
                className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">{sub.title}</div>
                  <div className="text-xs text-slate-500">{sub.desc}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = {
                      ...cfg,
                      [sub.key]: { ...subObj, enabled: !isOn },
                    };
                    setData((prev) => (prev ? { ...prev, config: next } : prev));
                    void handleSaveConfig(next);
                  }}
                  className={`px-3 py-1 rounded text-xs font-semibold shrink-0 ${
                    isOn ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {isOn ? 'AKTIF' : 'MATI'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label htmlFor="ab-max-cmd" className="block text-[11px] text-slate-500 mb-1">Max Cmd / Menit</label>
            <input
              id="ab-max-cmd"
              type="number"
              min={2}
              max={120}
              value={Number(cfg.anti_spam?.maxPerMinute ?? 20)}
              onChange={(e) =>
                setData((prev) =>
                  prev
                    ? { ...prev, config: { ...prev.config, anti_spam: { ...prev.config.anti_spam, maxPerMinute: Number(e.target.value) } } }
                    : prev,
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="ab-win-sec" className="block text-[11px] text-slate-500 mb-1">Min Interval (ms)</label>
            <input
              id="ab-win-sec"
              type="number"
              min={100}
              max={10000}
              value={Number(cfg.anti_spam?.minIntervalMs ?? 600)}
              onChange={(e) =>
                setData((prev) =>
                  prev
                    ? { ...prev, config: { ...prev.config, anti_spam: { ...prev.config.anti_spam, minIntervalMs: Number(e.target.value) } } }
                    : prev,
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="ab-dup-sec" className="block text-[11px] text-slate-500 mb-1">Double-Claim Lock (s)</label>
            <input
              id="ab-dup-sec"
              type="number"
              min={1}
              max={60}
              value={Number(cfg.anti_double_claim?.lockWindowSec ?? 5)}
              onChange={(e) =>
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        config: {
                          ...prev.config,
                          anti_double_claim: { ...prev.config.anti_double_claim, lockWindowSec: Number(e.target.value) },
                        },
                      }
                    : prev,
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="ab-max-len" className="block text-[11px] text-slate-500 mb-1">Max Teks Sticker/Mockup</label>
            <input
              id="ab-max-len"
              type="number"
              min={40}
              max={500}
              value={Number(cfg.resource_protection?.maxMediaTextLength ?? 100)}
              onChange={(e) =>
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        config: {
                          ...prev.config,
                          resource_protection: { ...prev.config.resource_protection, maxMediaTextLength: Number(e.target.value) },
                        },
                      }
                    : prev,
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="ab-strike" className="block text-[11px] text-slate-500 mb-1">Auto-Warn Threshold</label>
            <input
              id="ab-strike"
              type="number"
              min={1}
              max={20}
              value={Number(cfg.abuse_management?.autoWarnThreshold ?? 3)}
              onChange={(e) =>
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        config: {
                          ...prev.config,
                          abuse_management: { ...prev.config.abuse_management, autoWarnThreshold: Number(e.target.value) },
                        },
                      }
                    : prev,
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="ab-restrict-min" className="block text-[11px] text-slate-500 mb-1">Auto-Restrict (menit)</label>
            <input
              id="ab-restrict-min"
              type="number"
              min={1}
              max={1440}
              value={Number(cfg.abuse_management?.autoTempRestrictMinutes ?? 10)}
              onChange={(e) =>
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        config: {
                          ...prev.config,
                          abuse_management: { ...prev.config.abuse_management, autoTempRestrictMinutes: Number(e.target.value) },
                        },
                      }
                    : prev,
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
        </div>
      </div>

      {/* Manual Abuse Action + Active Restrictions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleManualAction}
          className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
        >
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Lock className="w-4 h-4 text-rose-600" />
            Moderasi Pengguna Manual (Warn / Restrict / Block / Restore)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ab-phone" className="block text-xs text-slate-500 mb-1">Nomor WhatsApp</label>
              <input
                id="ab-phone"
                type="text"
                value={targetPhone}
                onChange={(e) => setTargetPhone(e.target.value)}
                placeholder="6281234567890"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="ab-act" className="block text-xs text-slate-500 mb-1">Aksi Moderasi</label>
              <select
                id="ab-act"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="warn">Warn (Tambah Peringatan)</option>
                <option value="temp_restrict">Temp Restrict (Pembatasan Sementara)</option>
                <option value="block">Block Permanen</option>
                <option value="restore">Restore (Pulihkan Akses)</option>
              </select>
            </div>
            <div>
              <label htmlFor="ab-dur" className="block text-xs text-slate-500 mb-1">Durasi Temp Restrict (menit)</label>
              <input
                id="ab-dur"
                type="number"
                min={1}
                max={43200}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="ab-reason" className="block text-xs text-slate-500 mb-1">Alasan Audit</label>
              <input
                id="ab-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold"
          >
            Eksekusi Aksi Moderasi
          </button>
        </form>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Daftar Restriksi & Strike Pengguna</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
            {(data?.restrictions ?? []).length === 0 ? (
              <p className="text-slate-500">Belum ada pengguna dengan catatan pelanggaran atau restriksi.</p>
            ) : (
              data?.restrictions.map((r) => (
                <div
                  key={r.user_phone}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-mono font-semibold">
                      +{r.user_phone}{' '}
                      <span
                        className={`ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase ${
                          r.restriction_level === 'blocked'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : r.restriction_level === 'temp_restricted'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {r.restriction_level}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      Warnings: {r.warnings_count} · {r.reason || '-'}
                    </div>
                  </div>
                  {r.restriction_level !== 'none' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/api/admin/abuse/action', {
                          method: 'POST',
                          body: JSON.stringify({ userPhone: r.user_phone, action: 'restore', reason: 'Dipulihkan oleh owner' }),
                        });
                        void loadData();
                      }}
                      className="px-2.5 py-1 rounded border border-emerald-600 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <Unlock className="w-3 h-3" /> Restore
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Security Events Table */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          Log Security & Abuse Events ({data?.events?.length ?? 0})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Submodul</th>
                <th className="py-2 pr-3">Klasifikasi</th>
                <th className="py-2 pr-3">Detail</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(data?.events ?? []).slice(0, 40).map((ev) => (
                <tr key={ev.id}>
                  <td className="py-2 pr-3 font-mono text-slate-400 whitespace-nowrap">{ev.created_at}</td>
                  <td className="py-2 pr-3 font-mono">+{ev.user_phone}</td>
                  <td className="py-2 pr-3 font-mono text-blue-700 dark:text-blue-400">{ev.submodule}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`px-1.5 py-0.5 rounded font-semibold ${
                        ev.severity === 'confirmed_exploit'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : ev.severity === 'suspicious'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : ev.severity === 'rule_violation'
                          ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {ev.severity}
                    </span>
                  </td>
                  <td className="py-2 pr-3 max-w-sm truncate">{ev.detail}</td>
                  <td className="py-2 pr-3">
                    {ev.resolved ? (
                      <span className="text-emerald-600 font-semibold">Selesai</span>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/abuse/events/${ev.id}/resolve`, { method: 'POST' });
                          void loadData();
                        }}
                        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 hover:border-emerald-600"
                      >
                        Tandai Selesai
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.events ?? []).length === 0 && (
            <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4 text-slate-400" />
              Belum ada pelanggaran atau indikasi eksploitasi tercatat.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
