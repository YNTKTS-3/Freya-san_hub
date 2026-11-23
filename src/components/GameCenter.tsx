import React, { useEffect, useState } from 'react';
import { FileText, Gamepad2, Gift, Trophy } from 'lucide-react';
import { FolioDocument } from '../core/folioParser';

interface GameCatalogItem {
  game_id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
  enabled: number;
  duration_sec: number;
}

interface ActiveGeneralSession {
  id: string;
  gameId: string;
  gameName: string;
  chatScope: 'private' | 'group';
  status: string;
  state: {
    prompt?: string;
    reels?: string[];
    board?: string[];
    lastHint?: string;
    words?: string[];
    found?: string[];
    answers?: string[];
    emojis?: string;
    winner?: string;
  };
}

export const GameCenter: React.FC = () => {
  const [games, setGames] = useState<GameCatalogItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<Array<{ display_name: string; total_score: number; total_wins: number; games_played: number }>>([]);
  const [playerName, setPlayerName] = useState('Pemain Web');
  const [playerPhone, setPlayerPhone] = useState('6280000000001');
  const [chatScope, setChatScope] = useState<'private' | 'group'>('private');
  const [activeSession, setActiveSession] = useState<ActiveGeneralSession | null>(null);
  const [inputText, setInputText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  // Utility tabs: Redeem & Folio
  const [utilityTab, setUtilityTab] = useState<'arena' | 'redeem' | 'folio'>('arena');
  const [redeemCode, setRedeemCode] = useState('FREYAHUB50');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemOutcome, setRedeemOutcome] = useState<{
    ok: boolean;
    message: string;
    rewardsGranted?: {
      balance: number;
      exp: number;
      levelBonus: number;
      dailyLimitBonus: number;
      premiumDays: number;
      badges: string[];
      streakBoost: number;
      items: Array<{ rewardId: string; name: string; summary: string }>;
    };
    user?: { balance: number; exp: number; level: number; dailyLimit: number; isPremium: boolean; streak: number };
  } | null>(null);

  const [folioInput, setFolioInput] = useState(
    '{judul}SURAT PERNYATAAN RESMI\n{baris2}\nDengan ini saya menyatakan bahwa dokumen ini disusun menggunakan format kertas folio Freya-san Hub.\n{baris1}\n{kanan}Jakarta, 23 November 2026\n{baris1}\n{kanan}Hormat saya,\n{baris3}\n{kanan}{tebal}Pengguna Freya-san Hub',
  );
  const [folioDoc, setFolioDoc] = useState<FolioDocument | null>(null);

  const loadCatalog = () => {
    fetch('/api/games/catalog')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setGames((d.games as GameCatalogItem[]).filter((g) => g.domain === 'general'));
          setLeaderboard(d.leaderboardGeneral || []);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  const chatId = chatScope === 'group' ? 'web-arena-group@g.us' : `web-private-${playerPhone}`;

  const handleStartGame = async (gameId: string) => {
    const res = await fetch('/api/games/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId,
        playerName,
        playerPhone,
        chatScope,
        chatId,
        groupName: chatScope === 'group' ? 'Web Arena Group' : undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setLogs((prev) => [data.announcement || data.error, ...prev]);
      return;
    }
    setActiveSession(data.session);
    setLogs([data.announcement]);
    setInputText('');
    loadCatalog();
  };

  const handleAction = async (text: string, actionType: 'answer' | 'hint' | 'give_up' | 'join' | 'start_lobby' = 'answer') => {
    if (!activeSession) return;
    const res = await fetch('/api/games/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeSession.id,
        playerName,
        playerPhone,
        chatScope,
        chatId,
        input: text,
        actionType,
      }),
    });
    const data = await res.json();
    if (data.announcement) {
      setLogs((prev) => [...prev, data.announcement]);
    }
    setActiveSession((prev) => (prev ? { ...prev, status: data.sessionStatus, state: data.state } : null));
    setInputText('');
    loadCatalog();
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (redeemLoading) return;
    setRedeemLoading(true);
    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `web-${crypto.randomUUID()}`
        : `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await fetch('/api/public/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: redeemCode, playerPhone, playerName, idempotencyKey }),
      });
      const data = await res.json();
      if (!data.ok) {
        setRedeemOutcome({ ok: false, message: data.error || 'Gagal mengklaim kode redeem.' });
      } else {
        setRedeemOutcome({
          ok: true,
          message: data.message,
          rewardsGranted: data.rewardsGranted,
          user: data.user,
        });
      }
    } catch {
      setRedeemOutcome({ ok: false, message: 'Terjadi kesalahan jaringan saat menghubungi server.' });
    } finally {
      setRedeemLoading(false);
    }
  };

  const handleFolioPreview = async () => {
    const res = await fetch('/api/tools/folio-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: folioInput }),
    });
    const data = await res.json();
    if (data.ok) setFolioDoc(data.doc);
  };

  useEffect(() => {
    if (utilityTab === 'folio') {
      void handleFolioPreview();
    }
  }, [utilityTab]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">GAME CENTER UMUM · TERPISAH DARI 48GROUP</div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Game Center, Redeem & Studio Folio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
            Permainan umum menggunakan session engine terpusat dengan kunci anti-bertumpuk, pelacakan jawaban di server, serta pemisahan log Private Chat dan Group Chat. Balance bersifat poin virtual non-uang.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setUtilityTab('arena')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
              utilityTab === 'arena' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Arena Permainan
          </button>
          <button
            type="button"
            onClick={() => setUtilityTab('redeem')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
              utilityTab === 'redeem' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Redeem Kode
          </button>
          <button
            type="button"
            onClick={() => setUtilityTab('folio')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
              utilityTab === 'folio' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Kertas Folio (.folio)
          </button>
        </div>
      </div>

      {utilityTab === 'arena' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Pengaturan Pemain & Ruang Sesi</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="gc-name" className="block text-xs text-slate-500 mb-1">Nama Pemain</label>
                  <input
                    id="gc-name"
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="gc-phone" className="block text-xs text-slate-500 mb-1">Nomor / ID Pemain</label>
                  <input
                    id="gc-phone"
                    type="text"
                    value={playerPhone}
                    onChange={(e) => setPlayerPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <span className="block text-xs text-slate-500 mb-1">Simulasi Ruang Percakapan (Pemisahan Log Server)</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setChatScope('private')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg border ${
                      chatScope === 'private'
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Private Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatScope('group')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg border ${
                      chatScope === 'group'
                        ? 'border-pink-600 bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Group Chat
                  </button>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Daftar Game Umum ({games.length})</h2>
              <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                {games.map((g) => (
                  <div key={g.game_id} className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{g.name}</div>
                      <div className="text-xs text-slate-500">{g.category} · {g.description}</div>
                    </div>
                    <button
                      type="button"
                      disabled={!g.enabled}
                      onClick={() => handleStartGame(g.game_id)}
                      className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      Mainkan
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 min-h-[340px]">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    SESI {chatScope === 'group' ? 'GROUP CHAT' : 'PRIVATE CHAT'}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    {activeSession ? `${activeSession.gameName} (${activeSession.id})` : 'Belum ada sesi aktif'}
                  </h2>
                </div>
                {activeSession && (
                  <span className="text-xs font-mono text-slate-500">{activeSession.status}</span>
                )}
              </div>

              {activeSession ? (
                <div className="space-y-4">
                  {/* Visual board for Sloth, Bom, or Tic Tac Toe */}
                  {activeSession.gameId === 'sloth' && Array.isArray(activeSession.state.reels) && (
                    <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto py-4">
                      {activeSession.state.reels.map((sym, idx) => (
                        <div key={idx} className="h-20 rounded-xl border-2 border-blue-200 dark:border-blue-900 bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-3xl font-bold text-blue-700 dark:text-blue-400">
                          {sym}
                        </div>
                      ))}
                    </div>
                  )}

                  {(activeSession.gameId === 'bom' || activeSession.gameId === 'tictactoe') && Array.isArray(activeSession.state.board) && (
                    <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                      {activeSession.state.board.map((cell, idx) => (
                        <button
                          key={idx}
                          type="button"
                          disabled={activeSession.status !== 'active'}
                          onClick={() => handleAction(String(idx + 1))}
                          className={`h-16 rounded-lg border text-sm font-bold font-mono transition-colors ${
                            cell === 'BOOM'
                              ? 'bg-rose-600 text-white border-rose-700'
                              : cell === 'SAFE' || cell === 'X'
                              ? 'bg-blue-700 text-white border-blue-800'
                              : cell === 'O'
                              ? 'bg-pink-600 text-white border-pink-700'
                              : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 hover:border-blue-500'
                          }`}
                        >
                          {cell || idx + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeSession.state.prompt && (
                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white">
                      {activeSession.state.prompt}
                    </div>
                  )}

                  {activeSession.gameId === 'suit' && activeSession.status === 'active' && (
                    <div className="flex gap-2">
                      {['batu', 'gunting', 'kertas'].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleAction(opt)}
                          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-600 text-sm font-medium capitalize"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeSession.status === 'waiting' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleAction('gabung', 'join')}
                        className="px-4 py-2 rounded-lg border border-blue-600 text-blue-700 dark:text-blue-400 text-xs font-semibold"
                      >
                        Gabung Lobby
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction('mulai', 'start_lobby')}
                        className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                      >
                        Mulai Permainan
                      </button>
                    </div>
                  )}

                  {(activeSession.status === 'active' || activeSession.status === 'waiting') && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && inputText.trim()) void handleAction(inputText); }}
                        placeholder="Masukkan jawaban atau langkah..."
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={() => inputText.trim() && handleAction(inputText)}
                        className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                      >
                        Kirim
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction('hint', 'hint')}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                      >
                        Hint
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction('nyerah', 'give_up')}
                        className="px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-medium"
                      >
                        Nyerah
                      </button>
                    </div>
                  )}

                  <div className="space-y-2 max-h-52 overflow-y-auto text-xs font-mono bg-slate-950 text-slate-100 p-4 rounded-lg whitespace-pre-wrap">
                    {logs.map((l, i) => (
                      <div key={i} className="pb-2 border-b border-slate-800 last:border-0">{l}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-slate-500">
                  Pilih salah satu game di sebelah kiri (seperti Sloth, Tebak Bom, Tebak Kata, Tic Tac Toe, atau Werewolf Classic) untuk memulai sesi.
                </div>
              )}
            </div>

            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Papan Peringkat Game Center Umum</h3>
              {leaderboard.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada skor di Game Center umum.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {leaderboard.map((row, idx) => (
                    <div key={`${row.display_name}-${idx}`} className="py-2.5 flex items-center justify-between">
                      <span className="font-medium">{idx + 1}. {row.display_name}</span>
                      <span className="font-mono tabular-nums text-xs text-blue-700 dark:text-blue-400">
                        {row.total_score} pts · {row.total_wins} menang
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {utilityTab === 'redeem' && (
        <div className="max-w-xl mx-auto p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Klaim Kode Redeem Freya-san Hub</h2>
            <p className="text-xs text-slate-500">
              Terhubung transaksional ke sistem balance, EXP, dan limit di server. Coba kode bawaan: <code className="font-mono text-blue-700 dark:text-blue-400">FREYAHUB50</code> atau <code className="font-mono text-blue-700 dark:text-blue-400">JKT48THEATER</code>.
            </p>
          </div>
          <form onSubmit={handleRedeem} className="space-y-3">
            <div>
              <label htmlFor="rd-code" className="block text-xs text-slate-500 mb-1">Kode Redeem</label>
              <input
                id="rd-code"
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={redeemLoading}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold"
            >
              {redeemLoading ? 'Memproses...' : 'Klaim Kode Sekarang'}
            </button>
          </form>
          {redeemOutcome && (
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm space-y-2">
              <div className={redeemOutcome.ok ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-rose-700 dark:text-rose-400'}>
                {redeemOutcome.message}
              </div>
              {redeemOutcome.ok && redeemOutcome.rewardsGranted && (
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 tabular-nums">
                  <div>
                    Rincian Hadiah: +{redeemOutcome.rewardsGranted.balance} Balance · +{redeemOutcome.rewardsGranted.exp} EXP
                    {redeemOutcome.rewardsGranted.levelBonus > 0 ? ` · +${redeemOutcome.rewardsGranted.levelBonus} Level` : ''}
                    {redeemOutcome.rewardsGranted.dailyLimitBonus > 0 ? ` · +${redeemOutcome.rewardsGranted.dailyLimitBonus} Limit Harian` : ''}
                    {redeemOutcome.rewardsGranted.premiumDays > 0 ? ` · Premium ${redeemOutcome.rewardsGranted.premiumDays} hari` : ''}
                    {redeemOutcome.rewardsGranted.streakBoost > 0 ? ` · +${redeemOutcome.rewardsGranted.streakBoost} Streak` : ''}
                    {redeemOutcome.rewardsGranted.badges.length > 0 ? ` · Badge: ${redeemOutcome.rewardsGranted.badges.join(', ')}` : ''}
                  </div>
                  {redeemOutcome.user && (
                    <div className="text-slate-500">
                      Akun Anda Sekarang: {redeemOutcome.user.balance} Balance · Level {redeemOutcome.user.level} ({redeemOutcome.user.exp} EXP) · Limit {redeemOutcome.user.dailyLimit}/hari
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {utilityTab === 'folio' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Editor Kertas Folio (.folio)</h2>
              <p className="text-xs text-slate-500 mt-1">
                Tag didukung: {'{judul}'}, {'{tengah}'}, {'{kiri}'}, {'{kanan}'}, {'{tebal}'}, {'{miring}'}, {'{baris1}'}, {'{baris2}'}, {'{baris3}'}.
              </p>
            </div>
            <textarea
              rows={11}
              value={folioInput}
              onChange={(e) => setFolioInput(e.target.value)}
              className="w-full p-3 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={handleFolioPreview}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold"
            >
              Perbarui Preview Kertas Folio
            </button>
          </div>

          <div className="p-8 rounded-xl bg-white text-slate-900 border border-slate-300 shadow-sm min-h-[380px] space-y-2">
            <div className="text-xs text-slate-400 border-b border-slate-200 pb-2 mb-4">
              Preview Dokumen Folio ({folioDoc?.totalLines ?? 0} baris aktif)
            </div>
            {folioDoc?.lines.map((line, i) => (
              <div
                key={i}
                style={{ marginTop: `${line.blankLinesBefore * 1.25}rem` }}
                className={`${
                  line.align === 'center' ? 'text-center' : line.align === 'right' ? 'text-right' : 'text-left'
                } ${line.bold || line.isTitle ? 'font-bold' : ''} ${line.italic ? 'italic' : ''} ${
                  line.isTitle ? 'text-lg tracking-wide' : 'text-sm leading-relaxed'
                }`}
              >
                {line.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
