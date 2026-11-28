import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';

interface ApiManagerPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
}

export const ApiManagerPanel: React.FC<ApiManagerPanelProps> = ({ apiFetch }) => {
  const [items, setItems] = useState<any[]>([]);
  const [providerName, setProviderName] = useState('');
  const [label, setLabel] = useState('');
  const [apiKeyPlain, setApiKeyPlain] = useState('');
  const [accessScope, setAccessScope] = useState<'owner_only' | 'plugins' | 'ai_agents' | 'all_bot'>('all_bot');
  const [dailyQuota, setDailyQuota] = useState(1000);
  const [rateLimit, setRateLimit] = useState(60);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadVault = async () => {
    const res = await apiFetch('/api/admin/api-vault');
    if (res?.ok) setItems(res.items || []);
  };

  useEffect(() => {
    void loadVault();
  }, []);

  const handleSave = async () => {
    setFeedback(null);
    if (!providerName.trim() || !label.trim() || !apiKeyPlain.trim()) {
      setFeedback('Provider, label, dan API key wajib diisi.');
      return;
    }
    const res = await apiFetch('/api/admin/api-vault', {
      method: 'POST',
      body: JSON.stringify({
        provider_name: providerName.trim().toLowerCase(),
        label: label.trim(),
        api_key: apiKeyPlain.trim(),
        access_scope: accessScope,
        daily_quota: dailyQuota,
        rate_limit_per_min: rateLimit,
        enabled: true,
      }),
    });
    if (res?.ok) {
      setProviderName('');
      setLabel('');
      setApiKeyPlain('');
      setFeedback('API key disimpan terenkripsi (AES-256-GCM). Secret mentah nggak bakal ditampilkan ulang.');
      await loadVault();
    } else {
      setFeedback(res?.error || 'Gagal nyimpen API key.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Central API Manager (Encrypted Vault)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola API key eksternal dengan enkripsi AES-256-GCM, masking penuh pada response UI, kuota harian, rate limit, serta kontrol akses AI Agent &amp; Plugin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadVault()}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Muat Ulang
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <label htmlFor="vault-provider" className="block font-semibold mb-1">Provider ID</label>
            <input
              id="vault-provider"
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="gemini, weather, youtube, dll"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label htmlFor="vault-label" className="block font-semibold mb-1">Label Deskriptif</label>
            <input
              id="vault-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Kunci Gemini Cadangan"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="vault-key" className="block font-semibold mb-1">API Key / Secret</label>
            <input
              id="vault-key"
              type="password"
              value={apiKeyPlain}
              onChange={(e) => setApiKeyPlain(e.target.value)}
              placeholder="Akan dienkripsi di database"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <label htmlFor="vault-scope" className="block font-semibold mb-1">Akses Scope</label>
            <select
              id="vault-scope"
              value={accessScope}
              onChange={(e) => setAccessScope(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            >
              <option value="all_bot">all_bot (Bot &amp; Semua Modul)</option>
              <option value="ai_agents">ai_agents (Khusus AI &amp; Agent)</option>
              <option value="plugins">plugins (Khusus Plugin)</option>
              <option value="owner_only">owner_only (Owner Saja)</option>
            </select>
          </div>
          <div>
            <label htmlFor="vault-quota" className="block font-semibold mb-1">Kuota Harian</label>
            <input
              id="vault-quota"
              type="number"
              min={1}
              value={dailyQuota}
              onChange={(e) => setDailyQuota(Number(e.target.value) || 100)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label htmlFor="vault-rate" className="block font-semibold mb-1">Rate Limit / Menit</label>
            <input
              id="vault-rate"
              type="number"
              min={1}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value) || 30)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Simpan ke API Vault
          </button>
          {feedback && <span className="text-xs text-blue-700 dark:text-blue-400">{feedback}</span>}
        </div>
      </div>

      {/* Vault Entries */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Daftar Kredensial Terenkripsi ({items.length})
        </h3>
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">Belum ada kunci eksternal di Central API Vault.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map((item) => (
              <div key={item.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {item.label}{' '}
                    <span className="font-mono text-blue-700 dark:text-blue-400">[{item.provider_name}]</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    Key: {item.key_masked} · Scope: {item.access_scope} · Quota: {item.daily_used}/{item.daily_quota} · Rate: {item.rate_limit_per_min}/m · Err: {item.error_count}
                  </div>
                  {item.last_error && (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400">Error terakhir: {item.last_error}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/api-vault/${encodeURIComponent(item.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ enabled: !item.enabled }),
                      });
                      await loadVault();
                    }}
                    className={`px-2.5 py-1 rounded font-semibold ${item.enabled ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                  >
                    {item.enabled ? 'Aktif' : 'Nonaktif'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus vault ${item.label}`}
                    onClick={async () => {
                      await apiFetch(`/api/admin/api-vault/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                      await loadVault();
                    }}
                    className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
