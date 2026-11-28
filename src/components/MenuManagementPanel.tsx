import React, { useEffect, useState } from 'react';
import { Eye, Layers, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';

interface MenuManagementPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
}

export const MenuManagementPanel: React.FC<MenuManagementPanelProps> = ({ apiFetch }) => {
  const [config, setConfig] = useState<{ mode: 'hybrid' | 'interactive_only' | 'text_only'; defaultLanguage: 'id' | 'en' | 'ja'; footerText: string }>({
    mode: 'hybrid',
    defaultLanguage: 'id',
    footerText: 'Freya-san bot by Pak Ujan',
  });
  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [fallbackLogs, setFallbackLogs] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Category & Item quick form states
  const [catTitle, setCatTitle] = useState('');
  const [catTarget, setCatTarget] = useState('');
  const [catPerm, setCatPerm] = useState<'public' | 'group_admin' | 'owner'>('public');

  const [itemCatId, setItemCatId] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [itemCmd, setItemCmd] = useState('');
  const [itemDesc, setItemDesc] = useState('');

  // Preview state
  const [previewKey, setPreviewKey] = useState('main');
  const [previewLang, setPreviewLang] = useState<'id' | 'en' | 'ja'>('id');
  const [previewData, setPreviewData] = useState<any | null>(null);

  const loadAll = async () => {
    const [mRes, fbRes] = await Promise.all([apiFetch('/api/admin/menus'), apiFetch('/api/admin/menus/fallbacks')]);
    if (mRes?.ok) {
      if (mRes.config) setConfig(mRes.config);
      setCategories(mRes.categories || []);
      setItems(mRes.items || []);
      const analyticsList = Array.isArray(mRes.analytics)
        ? mRes.analytics
        : Array.isArray(mRes.analytics?.topItems)
          ? mRes.analytics.topItems
          : [];
      setAnalytics(analyticsList);
      if (!itemCatId && Array.isArray(mRes.categories) && mRes.categories[0]) {
        setItemCatId(mRes.categories[0].id);
      }
    }
    if (fbRes?.ok) setFallbackLogs(fbRes.logs || []);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const runPreview = async () => {
    const res = await apiFetch('/api/admin/menus/preview', {
      method: 'POST',
      body: JSON.stringify({ menuKey: previewKey, lang: previewLang, prefix: '#' }),
    });
    if (res?.ok) setPreviewData(res);
  };

  return (
    <div className="space-y-6">
      {/* Mode & Global Config */}
      <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Menu Management &amp; WhatsApp Interactive List
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Atur mode pengiriman menu (<code className="font-mono">hybrid</code> / <code className="font-mono">interactive_only</code> / <code className="font-mono">text_only</code>), kategori, item, dan preview langsung payload WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Muat Ulang
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label htmlFor="menu-mode-select" className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Mode Pengiriman Menu
            </label>
            <select
              id="menu-mode-select"
              value={config.mode}
              onChange={(e) => setConfig((c) => ({ ...c, mode: e.target.value as any }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            >
              <option value="hybrid">Hybrid (Interactive List + Teks Fallback Otomatis)</option>
              <option value="interactive_only">Interactive List Only (Coba Protokol List Dulu)</option>
              <option value="text_only">Text Only (Menu Teks Bernomor Saja)</option>
            </select>
          </div>
          <div>
            <label htmlFor="menu-lang-select" className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Bahasa Default Menu
            </label>
            <select
              id="menu-lang-select"
              value={config.defaultLanguage}
              onChange={(e) => setConfig((c) => ({ ...c, defaultLanguage: e.target.value as any }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            >
              <option value="id">Indonesia (Santai Nonbaku)</option>
              <option value="en">English (Natural)</option>
              <option value="ja">日本語 (Natural)</option>
            </select>
          </div>
          <div>
            <label htmlFor="menu-footer-input" className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Footer Text Menu
            </label>
            <input
              id="menu-footer-input"
              type="text"
              value={config.footerText}
              onChange={(e) => setConfig((c) => ({ ...c, footerText: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const res = await apiFetch('/api/admin/menus/config', {
                method: 'PATCH',
                body: JSON.stringify(config),
              });
              setFeedback(res?.ok ? 'Pengaturan menu disimpan ke database.' : res?.error || 'Gagal menyimpan pengaturan menu.');
              await loadAll();
            }}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> Simpan Pengaturan Menu
          </button>
          {feedback && <span className="text-xs text-blue-700 dark:text-blue-400">{feedback}</span>}
        </div>
      </div>

      {/* Category & Item CRUD */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Categories */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Kategori Menu ({categories.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <input
              type="text"
              value={catTitle}
              onChange={(e) => setCatTitle(e.target.value)}
              placeholder="Judul kategori (mis. AI Hub)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              value={catTarget}
              onChange={(e) => setCatTarget(e.target.value)}
              placeholder="Target key (mis. ai)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
            <div className="flex gap-1.5">
              <select
                aria-label="Permission kategori"
                value={catPerm}
                onChange={(e) => setCatPerm(e.target.value as any)}
                className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="public">public</option>
                <option value="group_admin">group_admin</option>
                <option value="owner">owner</option>
              </select>
              <button
                type="button"
                onClick={async () => {
                  if (!catTitle.trim() || !catTarget.trim()) return;
                  await apiFetch('/api/admin/menus/categories', {
                    method: 'POST',
                    body: JSON.stringify({ title: catTitle.trim(), target_menu_key: catTarget.trim(), permission: catPerm }),
                  });
                  setCatTitle('');
                  setCatTarget('');
                  await loadAll();
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-700 text-white font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto text-xs">
            {categories.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">{c.title}</div>
                  <div className="font-mono text-[11px] text-slate-500">
                    key: {c.target_menu_key} · perm: {c.permission} · order: {c.sort_order}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch('/api/admin/menus/categories', {
                        method: 'POST',
                        body: JSON.stringify({ ...c, visible: c.visible ? 0 : 1 }),
                      });
                      await loadAll();
                    }}
                    className={`px-2 py-1 rounded text-[11px] font-semibold ${c.visible ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                  >
                    {c.visible ? 'Tampil' : 'Sembunyi'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus kategori ${c.title}`}
                    onClick={async () => {
                      await apiFetch(`/api/admin/menus/categories/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
                      await loadAll();
                    }}
                    className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Menu Items */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Item Menu DB ({items.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <select
              aria-label="Pilih kategori item"
              value={itemCatId}
              onChange={(e) => setItemCatId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.target_menu_key})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={itemLabel}
              onChange={(e) => setItemLabel(e.target.value)}
              placeholder="Label item (mis. Cek Streak)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              value={itemCmd}
              onChange={(e) => setItemCmd(e.target.value)}
              placeholder="Command (mis. #streak)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                value={itemDesc}
                onChange={(e) => setItemDesc(e.target.value)}
                placeholder="Deskripsi singkat"
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!itemCatId || !itemLabel.trim() || !itemCmd.trim()) return;
                  await apiFetch('/api/admin/menus/items', {
                    method: 'POST',
                    body: JSON.stringify({
                      category_id: itemCatId,
                      label: itemLabel.trim(),
                      command_name: itemCmd.trim(),
                      description: itemDesc.trim(),
                    }),
                  });
                  setItemLabel('');
                  setItemCmd('');
                  setItemDesc('');
                  await loadAll();
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-700 text-white font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto text-xs">
            {items.map((it) => (
              <div key={it.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">{it.label}</div>
                  <div className="font-mono text-[11px] text-slate-500 truncate">
                    {it.command_name} · tap: {it.tap_count ?? 0}x · {it.description || '-'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch('/api/admin/menus/items', {
                        method: 'POST',
                        body: JSON.stringify({ ...it, visible: it.visible ? 0 : 1 }),
                      });
                      await loadAll();
                    }}
                    className={`px-2 py-1 rounded text-[11px] font-semibold ${it.visible ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                  >
                    {it.visible ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus item ${it.label}`}
                    onClick={async () => {
                      await apiFetch(`/api/admin/menus/items/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
                      await loadAll();
                    }}
                    className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Preview + Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Preview Payload Interactive vs Teks Fallback</h3>
            <div className="flex gap-2 text-xs">
              <input
                type="text"
                value={previewKey}
                onChange={(e) => setPreviewKey(e.target.value)}
                aria-label="Menu key preview"
                className="w-28 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
              <select
                aria-label="Bahasa preview"
                value={previewLang}
                onChange={(e) => setPreviewLang(e.target.value as any)}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="id">ID</option>
                <option value="en">EN</option>
                <option value="ja">JA</option>
              </select>
              <button
                type="button"
                onClick={() => void runPreview()}
                className="px-3 py-1 rounded bg-blue-700 text-white font-semibold inline-flex items-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </button>
            </div>
          </div>

          {previewData && (
            <div className="space-y-2 text-xs">
              {previewData.metaCloudRowCapWarning && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                  {previewData.metaCloudRowCapWarning}
                </div>
              )}
              <div className="text-slate-500 font-mono">
                Total Baris: {previewData.totalRows} · Mode Aktif: {previewData.mode}
              </div>
              <pre className="p-3 rounded-lg bg-slate-950 text-slate-100 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                {previewData.fallbackText}
              </pre>
            </div>
          )}
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Menu Analytics &amp; Log Fallback</h3>
          {analytics.length > 0 && (
            <div className="space-y-1.5 text-xs">
              {analytics.slice(0, 8).map((a: any) => (
                <div key={a.id} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-mono text-blue-700 dark:text-blue-400">{a.label} ({a.command_name})</span>
                  <span className="font-mono">{a.tap_count} tap</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs font-semibold text-slate-500 pt-1">Fallback Terbaru ({fallbackLogs.length})</div>
          <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {fallbackLogs.slice(0, 10).map((fb: any) => (
              <div key={fb.id} className="py-1.5 flex items-center justify-between gap-2">
                <span className="truncate font-mono">{fb.menu_key} · {fb.mode}</span>
                <span className="text-slate-400 shrink-0">{fb.created_at}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
