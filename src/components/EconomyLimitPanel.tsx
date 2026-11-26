import React, { useEffect, useState } from 'react';
import { Coins, Flame, Gamepad2, Plus, Sparkles, Trash2 } from 'lucide-react';

interface EconomyLimitPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
}

export const EconomyLimitPanel: React.FC<EconomyLimitPanelProps> = ({ apiFetch }) => {
  const [subTab, setSubTab] = useState<'limits' | 'games' | 'bank' | 'streaks'>('limits');
  const [limitsData, setLimitsData] = useState<{ config: any; commandCosts: any[]; transactions: any[] } | null>(null);
  const [gamesCfg, setGamesCfg] = useState<any | null>(null);
  const [undercoverItems, setUndercoverItems] = useState<any[]>([]);
  const [emojiItems, setEmojiItems] = useState<any[]>([]);
  const [streaksData, setStreaksData] = useState<{ settings: any; pairs: any[]; groups: any[] } | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const [newWordA, setNewWordA] = useState('');
  const [newWordB, setNewWordB] = useState('');
  const [newWordCat, setNewWordCat] = useState('umum');
  const [newEmojiGlyph, setNewEmojiGlyph] = useState('');
  const [newEmojiAnswer, setNewEmojiAnswer] = useState('');
  const [newEmojiHint, setNewEmojiHint] = useState('');

  const loadAll = async () => {
    const [lim, gcfg, uc, em, st] = await Promise.all([
      apiFetch('/api/admin/limits'),
      apiFetch('/api/admin/games/config'),
      apiFetch(`/api/admin/games/undercover?search=${encodeURIComponent(bankSearch)}`),
      apiFetch(`/api/admin/games/tebakemoji?search=${encodeURIComponent(bankSearch)}`),
      apiFetch('/api/admin/streaks'),
    ]);
    if (lim.ok) setLimitsData(lim);
    if (gcfg.ok) setGamesCfg(gcfg);
    if (uc.ok) setUndercoverItems(uc.items || []);
    if (em.ok) setEmojiItems(em.items || []);
    if (st.ok) setStreaksData(st);
  };

  useEffect(() => {
    void loadAll();
  }, [bankSearch]);

  const lcfg = limitsData?.config ?? {};
  const bom = gamesCfg?.bom ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'limits', label: 'Limit & Economy (#addlimit)' },
          { id: 'games', label: 'Aturan Bom, Kuis & Bahasa Bot' },
          { id: 'bank', label: `Bank Kata Undercover (${undercoverItems.length}) & Tebak Emoji (${emojiItems.length})` },
          { id: 'streaks', label: 'Streak Pasangan & Grup' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id as typeof subTab)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold ${
              subTab === t.id
                ? 'bg-blue-700 text-white'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
          {notice}
        </div>
      )}

      {subTab === 'limits' && (
        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                Konfigurasi Limit Umum & Harga #addlimit
              </h2>
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch('/api/admin/limits/config', {
                    method: 'PATCH',
                    body: JSON.stringify(lcfg),
                  });
                  if (res.ok) setNotice('Konfigurasi limit berhasil disimpan.');
                }}
                className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
              >
                Simpan Konfigurasi Limit
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label htmlFor="lim-init" className="block text-xs text-slate-500 mb-1">Limit Awal User Umum</label>
                <input
                  id="lim-init"
                  type="number"
                  min={1}
                  value={Number(lcfg.initialGeneralLimit ?? 50)}
                  onChange={(e) =>
                    setLimitsData((prev) =>
                      prev ? { ...prev, config: { ...prev.config, initialGeneralLimit: Number(e.target.value) } } : prev,
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="lim-price" className="block text-xs text-slate-500 mb-1">Harga Balance per 1 Limit</label>
                <input
                  id="lim-price"
                  type="number"
                  min={1}
                  value={Number(lcfg.pricePerUnit ?? 25)}
                  onChange={(e) =>
                    setLimitsData((prev) =>
                      prev ? { ...prev, config: { ...prev.config, pricePerUnit: Number(e.target.value) } } : prev,
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="lim-defcost" className="block text-xs text-slate-500 mb-1">Biaya Default / Command</label>
                <input
                  id="lim-defcost"
                  type="number"
                  min={0}
                  value={Number(lcfg.defaultCommandCost ?? 1)}
                  onChange={(e) =>
                    setLimitsData((prev) =>
                      prev ? { ...prev, config: { ...prev.config, defaultCommandCost: Number(e.target.value) } } : prev,
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={Boolean(lcfg.allowSelfGift ?? false)}
                    onChange={(e) =>
                      setLimitsData((prev) =>
                        prev ? { ...prev, config: { ...prev.config, allowSelfGift: e.target.checked } } : prev,
                      )
                    }
                  />
                  Izinkan User Hadiahkan Limit via #addlimit
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Biaya Limit per Command (Sample Teratas)</h3>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {(limitsData?.commandCosts ?? []).slice(0, 45).map((c) => (
                  <div key={c.name} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">#{c.name}</span>
                      <span className="ml-2 text-slate-400">{c.category}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">Biaya: {c.free_access ? '0 (Gratis)' : c.limit_cost}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/limits/commands/${encodeURIComponent(c.name)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ limit_cost: c.limit_cost, free_access: !c.free_access }),
                          });
                          void loadAll();
                        }}
                        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700"
                      >
                        {c.free_access ? 'Set Berbayar' : 'Gratis'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Riwayat Transaksi Limit & #addlimit</h3>
              <div className="max-h-72 overflow-y-auto space-y-2 text-xs">
                {(limitsData?.transactions ?? []).map((tx) => (
                  <div key={tx.id} className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                    <div className="flex justify-between font-mono">
                      <span className="font-semibold">
                        +{tx.actor_phone} → +{tx.target_phone}
                      </span>
                      <span className="text-blue-700 dark:text-blue-400">
                        {tx.delta_limit >= 0 ? `+${tx.delta_limit}` : tx.delta_limit} limit ({tx.delta_balance} bal)
                      </span>
                    </div>
                    <div className="text-slate-500">{tx.tx_type} · {tx.reason}</div>
                  </div>
                ))}
                {(limitsData?.transactions ?? []).length === 0 && (
                  <p className="text-slate-500">Belum ada transaksi limit tercatat.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'games' && gamesCfg && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Gamepad2 className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              Konfigurasi Game Bom, Kuis Salah Maksimal & Bahasa Natural Bot
            </h2>
            <button
              type="button"
              onClick={async () => {
                const res = await apiFetch('/api/admin/games/config', {
                  method: 'PATCH',
                  body: JSON.stringify(gamesCfg),
                });
                if (res.ok) setNotice('Aturan game dan bahasa bot berhasil disimpan.');
              }}
              className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
            >
              Simpan Pengaturan Game
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="bom-grid" className="block text-xs text-slate-500 mb-1">Jumlah Kotak Bom (6–25)</label>
              <input
                id="bom-grid"
                type="number"
                min={6}
                max={25}
                value={Number(bom.gridSize ?? 12)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, bom: { ...prev.bom, gridSize: Number(e.target.value) } }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="bom-count" className="block text-xs text-slate-500 mb-1">Jumlah Bom</label>
              <input
                id="bom-count"
                type="number"
                min={1}
                max={20}
                value={Number(bom.bombCount ?? 3)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, bom: { ...prev.bom, bombCount: Number(e.target.value) } }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="bom-step" className="block text-xs text-slate-500 mb-1">Hadiah per Kotak Aman</label>
              <input
                id="bom-step"
                type="number"
                min={5}
                value={Number(bom.rewardPerStep ?? 25)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, bom: { ...prev.bom, rewardPerStep: Number(e.target.value) } }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="bom-clear" className="block text-xs text-slate-500 mb-1">Bonus Full Clear</label>
              <input
                id="bom-clear"
                type="number"
                min={0}
                value={Number(bom.clearBonus ?? 100)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, bom: { ...prev.bom, clearBonus: Number(e.target.value) } }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="bom-penalty" className="block text-xs text-slate-500 mb-1">Penalti Kena Bom</label>
              <input
                id="bom-penalty"
                type="number"
                min={0}
                value={Number(bom.bombPenalty ?? 40)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, bom: { ...prev.bom, bombPenalty: Number(e.target.value) } }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="bom-partial" className="block text-xs text-slate-500 mb-1">Partial Reward (%) saat Kena Bom</label>
              <input
                id="bom-partial"
                type="number"
                min={0}
                max={100}
                value={Number(bom.partialRewardPct ?? 50)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, bom: { ...prev.bom, partialRewardPct: Number(e.target.value) } }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="quiz-max-wrong" className="block text-xs text-slate-500 mb-1">Batas Salah Tanya Jawab</label>
              <input
                id="quiz-max-wrong"
                type="number"
                min={1}
                max={20}
                value={Number(gamesCfg.maxQuizWrongAttempts ?? 5)}
                onChange={(e) =>
                  setGamesCfg((prev: any) => ({ ...prev, maxQuizWrongAttempts: Number(e.target.value) }))
                }
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="bot-lang" className="block text-xs text-slate-500 mb-1">Bahasa Aktif Bot Natural</label>
              <select
                id="bot-lang"
                value={gamesCfg.botLanguage || 'id'}
                onChange={(e) => setGamesCfg((prev: any) => ({ ...prev, botLanguage: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="id">Indonesia (Santai & Natural)</option>
                <option value="en">English (Conversational)</option>
                <option value="ja">日本語 (Natural Conversational)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {subTab === 'bank' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <label htmlFor="bank-search" className="sr-only">Cari kata undercover atau emoji</label>
            <input
              id="bank-search"
              type="text"
              value={bankSearch}
              onChange={(e) => setBankSearch(e.target.value)}
              placeholder="Cari kata Undercover atau soal Tebak Emoji..."
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-700" />
                Bank Pasangan Kata Undercover ({undercoverItems.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select
                  aria-label="Kategori Undercover"
                  value={newWordCat}
                  onChange={(e) => setNewWordCat(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="umum">Umum</option>
                  <option value="makanan">Makanan</option>
                  <option value="benda">Benda</option>
                  <option value="profesi">Profesi</option>
                  <option value="alam">Alam</option>
                  <option value="48group">48Group</option>
                </select>
                <input
                  type="text"
                  aria-label="Kata Civil A"
                  value={newWordA}
                  onChange={(e) => setNewWordA(e.target.value)}
                  placeholder="Kata Civil"
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="text"
                  aria-label="Kata Undercover B"
                  value={newWordB}
                  onChange={(e) => setNewWordB(e.target.value)}
                  placeholder="Kata Undercover"
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newWordA.trim() || !newWordB.trim()) return;
                    const res = await apiFetch('/api/admin/games/undercover', {
                      method: 'POST',
                      body: JSON.stringify({ category: newWordCat, civilian_id: newWordA, undercover_id: newWordB }),
                    });
                    if (res.ok) {
                      setNewWordA('');
                      setNewWordB('');
                      void loadAll();
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Kata
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {undercoverItems.slice(0, 60).map((item) => (
                  <div key={item.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{item.civilian_id}</span> ↔ <span className="font-semibold">{item.undercover_id}</span>
                      <span className="ml-2 text-slate-400">({item.category})</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Hapus pasangan ${item.civilian_id}`}
                      onClick={async () => {
                        await apiFetch(`/api/admin/games/undercover/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                        void loadAll();
                      }}
                      className="text-rose-600 hover:text-rose-700 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-pink-600" />
                Bank Soal Tebak Emoji ({emojiItems.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  aria-label="Emoji soal"
                  value={newEmojiGlyph}
                  onChange={(e) => setNewEmojiGlyph(e.target.value)}
                  placeholder="Emoji (cth: 🐱🐟)"
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="text"
                  aria-label="Jawaban emoji"
                  value={newEmojiAnswer}
                  onChange={(e) => setNewEmojiAnswer(e.target.value)}
                  placeholder="Jawaban"
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="text"
                  aria-label="Petunjuk emoji"
                  value={newEmojiHint}
                  onChange={(e) => setNewEmojiHint(e.target.value)}
                  placeholder="Hint (opsional)"
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newEmojiGlyph.trim() || !newEmojiAnswer.trim()) return;
                    const res = await apiFetch('/api/admin/games/tebakemoji', {
                      method: 'POST',
                      body: JSON.stringify({ emoji_prompt: newEmojiGlyph, answer: newEmojiAnswer, hint: newEmojiHint }),
                    });
                    if (res.ok) {
                      setNewEmojiGlyph('');
                      setNewEmojiAnswer('');
                      setNewEmojiHint('');
                      void loadAll();
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-pink-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Emoji
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {emojiItems.slice(0, 60).map((item) => (
                  <div key={item.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-base mr-2">{item.emoji_prompt}</span>
                      <span className="font-semibold">{item.answer}</span>
                      <span className="ml-2 text-slate-400">({item.category})</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Hapus soal ${item.answer}`}
                      onClick={async () => {
                        await apiFetch(`/api/admin/games/tebakemoji/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                        void loadAll();
                      }}
                      className="text-rose-600 hover:text-rose-700 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'streaks' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500" />
              Pair Streaks Aktif ({streaksData?.pairs?.length ?? 0})
            </h3>
            <div className="text-xs text-slate-500">
              Maks pasangan: {streaksData?.settings?.maxPairs ?? 10} · Maks pulihkan/bulan: {streaksData?.settings?.maxRestoresPerMonth ?? 5} ({streaksData?.settings?.timezone ?? 'Asia/Jakarta'})
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
              {(streaksData?.pairs ?? []).map((p) => (
                <div key={p.id} className="p-2.5 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                  <span className="font-mono">+{p.user_a} ↔ +{p.user_b}</span>
                  <span className="font-semibold text-orange-600">{p.current_streak} hari ({p.status})</span>
                </div>
              ))}
              {(streaksData?.pairs ?? []).length === 0 && <p className="text-slate-500">Belum ada streak pasangan.</p>}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-blue-600" />
              Streak Grup ({streaksData?.groups?.length ?? 0})
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
              {(streaksData?.groups ?? []).map((g) => (
                <div key={g.group_id} className="p-2.5 rounded border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{g.group_name || g.group_id}</div>
                    <div className="text-slate-500 font-mono">{g.current_streak} hari · Max: {g.longest_streak}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/streaks/group/${encodeURIComponent(g.group_id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ enabled: !g.enabled }),
                      });
                      void loadAll();
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                      g.enabled ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  >
                    {g.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
              {(streaksData?.groups ?? []).length === 0 && <p className="text-slate-500">Belum ada streak grup tercatat.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
