import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Eye,
  Gift,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import { ConfiguredAdditionalReward, RewardRegistryEntry } from '../core/types';

type RedeemSubmenu = 'codes' | 'builder' | 'history' | 'analytics' | 'settings';

interface RedeemCodeItem {
  code: string;
  name: string;
  description: string;
  rewardBalance: number;
  rewardExp: number;
  rewardLevel: number;
  rewardLimit: number;
  rewardPremiumDays: number;
  additionalRewards: ConfiguredAdditionalReward[];
  maxClaims: number;
  perUserLimit: number;
  cooldownSec: number;
  claimedCount: number;
  expiresAt: string | null;
  active: boolean;
  isExpired: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface RedeemAnalyticsData {
  totalCodes: number;
  activeCodes: number;
  inactiveCodes: number;
  expiredCodes: number;
  totalAttempts: number;
  successClaims: number;
  failedClaims: number;
  rejectedClaims: number;
  expiredAttempts: number;
  topCodes: Array<{ code: string; name: string; claimedCount: number; maxClaims: number; active: boolean }>;
  rewardTotals: {
    balanceDistributed: number;
    expDistributed: number;
    levelGranted: number;
    limitGranted: number;
    premiumDaysGranted: number;
  };
}

interface RedeemSettingsData {
  globalCooldownSec: number;
  maxBalanceCap: number;
  maxExpCap: number;
  maxLevelCap: number;
  defaultPerUserLimit: number;
  msgSuccess: string;
  msgExpired: string;
  msgLimit: string;
  msgInvalid: string;
}

interface RedeemManagementPanelProps {
  apiFetch: (url: string, init?: RequestInit) => Promise<any>;
}

const SUBMENUS: Array<{ id: RedeemSubmenu; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'codes', label: '1. Redeem Codes', icon: Ticket },
  { id: 'builder', label: '2. Reward Builder', icon: Gift },
  { id: 'history', label: '3. Claim History', icon: ClipboardList },
  { id: 'analytics', label: '4. Redeem Analytics', icon: BarChart3 },
  { id: 'settings', label: '5. Redeem Settings', icon: Settings },
];

export const RedeemManagementPanel: React.FC<RedeemManagementPanelProps> = ({ apiFetch }) => {
  const [submenu, setSubmenu] = useState<RedeemSubmenu>('codes');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Registry & Settings
  const [activeRegistry, setActiveRegistry] = useState<RewardRegistryEntry[]>([]);
  const [settings, setSettings] = useState<RedeemSettingsData | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<RedeemSettingsData | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Submenu 1: Codes list + filter + pagination + detail + edit + reset confirm
  const [codes, setCodes] = useState<RedeemCodeItem[]>([]);
  const [totalCodes, setTotalCodes] = useState(0);
  const [codeSearch, setCodeSearch] = useState('');
  const [codeStatusFilter, setCodeStatusFilter] = useState<'all' | 'active' | 'inactive' | 'expired'>('all');
  const [codePage, setCodePage] = useState(1);
  const codePageSize = 10;

  const [detailModal, setDetailModal] = useState<{ code: RedeemCodeItem; recentClaims: any[] } | null>(null);
  const [editingCode, setEditingCode] = useState<RedeemCodeItem | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    description: string;
    rewardBalance: number;
    rewardExp: number;
    rewardLevel: number;
    maxClaims: number;
    perUserLimit: number;
    cooldownSec: number;
    expiresAt: string;
    active: boolean;
  } | null>(null);
  const [resetConfirmCode, setResetConfirmCode] = useState<string | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [deleteConfirmCode, setDeleteConfirmCode] = useState<string | null>(null);

  // Submenu 2: Interactive Reward Builder
  const [builderStep, setBuilderStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [bCode, setBCode] = useState('');
  const [bName, setBName] = useState('');
  const [bDesc, setBDesc] = useState('');
  const [bBalance, setBBalance] = useState(100);
  const [bExp, setBExp] = useState(50);
  const [bLevel, setBLevel] = useState(0);
  const [bAdditional, setBAdditional] = useState<ConfiguredAdditionalReward[]>([]);
  const [addingRewardOpen, setAddingRewardOpen] = useState(false);
  const [selectedRewardId, setSelectedRewardId] = useState('');
  const [rewardParamsDraft, setRewardParamsDraft] = useState<Record<string, string | number>>({});
  const [rewardDraftError, setRewardDraftError] = useState<string | null>(null);
  const [bMaxClaims, setBMaxClaims] = useState(25);
  const [bPerUserLimit, setBPerUserLimit] = useState(1);
  const [bCooldownSec, setBCooldownSec] = useState(0);
  const [bExpiresAt, setBExpiresAt] = useState('');
  const [bActive, setBActive] = useState(true);
  const [builderSubmitting, setBuilderSubmitting] = useState(false);

  // Submenu 3: Claim History
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStatus, setHistoryStatus] = useState<'all' | 'success' | 'failed' | 'rejected' | 'expired' | 'cancelled'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 12;

  // Submenu 4: Analytics
  const [analytics, setAnalytics] = useState<RedeemAnalyticsData | null>(null);

  const loadRegistryAndSettings = async () => {
    const [regRes, setRes] = await Promise.all([
      apiFetch('/api/admin/redeems/registry'),
      apiFetch('/api/admin/redeems/settings'),
    ]);
    if (regRes.ok) {
      const act = (regRes.active || []) as RewardRegistryEntry[];
      setActiveRegistry(act);
      if (act.length > 0 && !selectedRewardId) {
        setSelectedRewardId(act[0].id);
      }
    }
    if (setRes.ok && setRes.settings) {
      setSettings(setRes.settings);
      setSettingsDraft(setRes.settings);
      setBPerUserLimit((prev) => (prev === 1 ? setRes.settings.defaultPerUserLimit : prev));
    }
  };

  const loadCodesAndAnalytics = async () => {
    const qs = new URLSearchParams({
      search: codeSearch,
      status: codeStatusFilter,
      limit: String(codePageSize),
      offset: String((codePage - 1) * codePageSize),
    });
    const d = await apiFetch(`/api/admin/redeems?${qs.toString()}`);
    if (d.ok) {
      setCodes(d.codes || []);
      setTotalCodes(Number(d.totalCodes || 0));
      if (d.analytics) setAnalytics(d.analytics);
    }
  };

  const loadHistory = async () => {
    const qs = new URLSearchParams({
      status: historyStatus,
      search: historySearch,
      limit: String(historyPageSize),
      offset: String((historyPage - 1) * historyPageSize),
    });
    const d = await apiFetch(`/api/admin/redeems/history?${qs.toString()}`);
    if (d.ok) {
      setHistoryItems(d.items || []);
      setHistoryTotal(Number(d.total || 0));
    }
  };

  useEffect(() => {
    void loadRegistryAndSettings();
  }, []);

  useEffect(() => {
    void loadCodesAndAnalytics();
  }, [codeSearch, codeStatusFilter, codePage]);

  useEffect(() => {
    if (submenu === 'history') {
      void loadHistory();
    } else if (submenu === 'analytics' || submenu === 'codes') {
      void loadCodesAndAnalytics();
    }
  }, [submenu, historyStatus, historySearch, historyPage]);

  const selectedRegistryEntry = useMemo(
    () => activeRegistry.find((r) => r.id === selectedRewardId) || null,
    [activeRegistry, selectedRewardId],
  );

  const openDetail = async (code: string) => {
    const d = await apiFetch(`/api/admin/redeems/${encodeURIComponent(code)}`);
    if (d.ok && d.code) {
      setDetailModal({ code: d.code, recentClaims: d.recentClaims || [] });
    }
  };

  const openEdit = (item: RedeemCodeItem) => {
    setEditingCode(item);
    setEditDraft({
      name: item.name,
      description: item.description,
      rewardBalance: item.rewardBalance,
      rewardExp: item.rewardExp,
      rewardLevel: item.rewardLevel,
      maxClaims: item.maxClaims,
      perUserLimit: item.perUserLimit,
      cooldownSec: item.cooldownSec,
      expiresAt: item.expiresAt ? item.expiresAt.slice(0, 16) : '',
      active: item.active,
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCode || !editDraft) return;
    setFeedback(null);
    const res = await apiFetch(`/api/admin/redeems/${encodeURIComponent(editingCode.code)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editDraft.name,
        description: editDraft.description,
        rewardBalance: Number(editDraft.rewardBalance),
        rewardExp: Number(editDraft.rewardExp),
        rewardLevel: Number(editDraft.rewardLevel),
        maxClaims: Number(editDraft.maxClaims),
        perUserLimit: Number(editDraft.perUserLimit),
        cooldownSec: Number(editDraft.cooldownSec),
        expiresAt: editDraft.expiresAt ? new Date(editDraft.expiresAt).toISOString() : null,
        active: editDraft.active,
      }),
    });
    if (!res.ok) {
      setFeedback({ type: 'err', text: res.error || 'Gagal memperbarui kode redeem.' });
      return;
    }
    setFeedback({ type: 'ok', text: `Kode ${editingCode.code} berhasil diperbarui.` });
    setEditingCode(null);
    setEditDraft(null);
    void loadCodesAndAnalytics();
  };

  const handleToggleActive = async (item: RedeemCodeItem) => {
    const res = await apiFetch(`/api/admin/redeems/${encodeURIComponent(item.code)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ active: !item.active }),
    });
    if (res.ok) {
      setFeedback({ type: 'ok', text: `Kode ${item.code} sekarang ${!item.active ? 'Aktif' : 'Nonaktif'}.` });
      void loadCodesAndAnalytics();
    } else {
      setFeedback({ type: 'err', text: res.error || 'Gagal mengubah status kode.' });
    }
  };

  const handleConfirmReset = async () => {
    if (!resetConfirmCode) return;
    if (resetConfirmText.trim().toLowerCase() !== 'confirm') {
      setFeedback({ type: 'err', text: 'Ketik "confirm" untuk menyetujui reset kuota klaim.' });
      return;
    }
    const res = await apiFetch(`/api/admin/redeems/${encodeURIComponent(resetConfirmCode)}/reset`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: `Counter klaim ${resetConfirmCode} berhasil direset ke 0. Riwayat Claim History tetap tersimpan.`,
      });
      setResetConfirmCode(null);
      setResetConfirmText('');
      void loadCodesAndAnalytics();
    } else {
      setFeedback({ type: 'err', text: res.error || 'Gagal mereset counter.' });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmCode) return;
    const res = await apiFetch(`/api/admin/redeems/${encodeURIComponent(deleteConfirmCode)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: `Kode ${deleteConfirmCode} dihapus dari daftar aktif. Log Claim History sebelumnya tetap dipertahankan.`,
      });
      setDeleteConfirmCode(null);
      void loadCodesAndAnalytics();
    } else {
      setFeedback({ type: 'err', text: res.error || 'Gagal menghapus kode redeem.' });
    }
  };

  const handleAddAdditionalReward = () => {
    if (!selectedRegistryEntry) return;
    setRewardDraftError(null);
    const cleanedParams: Record<string, string | number> = {};
    for (const spec of selectedRegistryEntry.paramsSchema) {
      const val = rewardParamsDraft[spec.key];
      if (spec.required && (val === undefined || val === null || String(val).trim() === '')) {
        setRewardDraftError(`Parameter "${spec.label}" wajib diisi.`);
        return;
      }
      if (val === undefined || val === null || String(val).trim() === '') continue;
      if (spec.type === 'number') {
        const num = Number(val);
        if (!Number.isInteger(num)) {
          setRewardDraftError(`Parameter "${spec.label}" harus berupa angka bulat.`);
          return;
        }
        if (spec.min !== undefined && num < spec.min) {
          setRewardDraftError(`Parameter "${spec.label}" minimal ${spec.min}.`);
          return;
        }
        if (spec.max !== undefined && num > spec.max) {
          setRewardDraftError(`Parameter "${spec.label}" maksimal ${spec.max}.`);
          return;
        }
        cleanedParams[spec.key] = num;
      } else {
        const str = String(val).trim();
        if (spec.maxLength !== undefined && str.length > spec.maxLength) {
          setRewardDraftError(`Parameter "${spec.label}" maksimal ${spec.maxLength} karakter.`);
          return;
        }
        cleanedParams[spec.key] = str;
      }
    }

    setBAdditional((prev) => [...prev, { rewardId: selectedRegistryEntry.id, params: cleanedParams }]);
    setRewardParamsDraft({});
    setAddingRewardOpen(false);
  };

  const handleBuilderConfirmSave = async () => {
    setBuilderSubmitting(true);
    setFeedback(null);
    const res = await apiFetch('/api/admin/redeems', {
      method: 'POST',
      body: JSON.stringify({
        code: bCode.trim().toUpperCase() || undefined,
        name: bName.trim() || bCode.trim().toUpperCase() || 'Kampanye Redeem',
        description: bDesc.trim(),
        rewardBalance: Number(bBalance || 0),
        rewardExp: Number(bExp || 0),
        rewardLevel: Number(bLevel || 0),
        additionalRewards: bAdditional,
        maxClaims: Number(bMaxClaims || 0),
        perUserLimit: Number(bPerUserLimit || 1),
        cooldownSec: Number(bCooldownSec || 0),
        expiresAt: bExpiresAt ? new Date(bExpiresAt).toISOString() : null,
        active: bActive,
      }),
    });
    setBuilderSubmitting(false);

    if (!res.ok) {
      setFeedback({ type: 'err', text: res.error || 'Gagal menyimpan kode redeem.' });
      return;
    }

    setFeedback({ type: 'ok', text: `Kode redeem ${res.code} berhasil dibuat dan aktif.` });
    // Reset builder state cleanly
    setBCode('');
    setBName('');
    setBDesc('');
    setBBalance(100);
    setBExp(50);
    setBLevel(0);
    setBAdditional([]);
    setBMaxClaims(25);
    setBPerUserLimit(settings?.defaultPerUserLimit ?? 1);
    setBCooldownSec(0);
    setBExpiresAt('');
    setBActive(true);
    setBuilderStep(1);
    setSubmenu('codes');
    void loadCodesAndAnalytics();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsDraft) return;
    setSavingSettings(true);
    setFeedback(null);
    const res = await apiFetch('/api/admin/redeems/settings', {
      method: 'PATCH',
      body: JSON.stringify(settingsDraft),
    });
    setSavingSettings(false);
    if (res.ok && res.settings) {
      setSettings(res.settings);
      setSettingsDraft(res.settings);
      setFeedback({ type: 'ok', text: 'Pengaturan global Redeem Management berhasil disimpan.' });
    } else {
      setFeedback({ type: 'err', text: res.error || 'Gagal menyimpan pengaturan.' });
    }
  };

  const describeAdditional = (r: ConfiguredAdditionalReward) => {
    const reg = activeRegistry.find((x) => x.id === r.rewardId);
    const label = reg?.name || r.rewardId;
    const paramStr = Object.entries(r.params || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return paramStr ? `${label} (${paramStr})` : label;
  };

  return (
    <div className="space-y-6">
      {/* Module Header & 5 Submenus */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              PLATFORM MANAGEMENT · MODUL MANDIRI
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              Redeem Management System
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Kelola kode redeem, Reward Builder dinamis berbasis handler tervalidasi, audit Claim History persisten, analitik distribusi hadiah, dan pengaturan global.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setBuilderStep(1);
              setSubmenu('builder');
            }}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Buat Kode di Reward Builder
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          {SUBMENUS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSubmenu(m.id);
                  setFeedback(null);
                }}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  submenu === m.id
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" aria-label="Tutup notifikasi" onClick={() => setFeedback(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SUBMENU 1: REDEEM CODES */}
      {submenu === 'codes' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Cari kode atau nama redeem"
                value={codeSearch}
                onChange={(e) => {
                  setCodeSearch(e.target.value);
                  setCodePage(1);
                }}
                placeholder="Cari kode redeem, nama kampanye, atau deskripsi..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <select
              aria-label="Filter status kode redeem"
              value={codeStatusFilter}
              onChange={(e) => {
                setCodeStatusFilter(e.target.value as any);
                setCodePage(1);
              }}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="all">Semua Status ({analytics?.totalCodes ?? totalCodes})</option>
              <option value="active">Aktif ({analytics?.activeCodes ?? 0})</option>
              <option value="inactive">Nonaktif ({analytics?.inactiveCodes ?? 0})</option>
              <option value="expired">Kedaluwarsa ({analytics?.expiredCodes ?? 0})</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-3 px-4">Kode & Kampanye</th>
                  <th className="py-3 px-4">Konfigurasi Hadiah</th>
                  <th className="py-3 px-4">Batas & Masa Berlaku</th>
                  <th className="py-3 px-4 text-right">Klaim</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {codes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Nggak ada kode redeem yang sesuai filter.
                    </td>
                  </tr>
                ) : (
                  codes.map((item) => {
                    const statusLabel = item.isExpired ? 'Kedaluwarsa' : item.active ? 'Aktif' : 'Nonaktif';
                    const statusClass = item.isExpired
                      ? 'text-amber-700 dark:text-amber-400'
                      : item.active
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-400';

                    return (
                      <tr key={item.code}>
                        <td className="py-3 px-4 align-top">
                          <div className="font-mono font-bold text-sm text-blue-700 dark:text-blue-400">{item.code}</div>
                          <div className="font-medium text-slate-900 dark:text-white">{item.name}</div>
                          {item.description && <div className="text-slate-500 max-w-xs truncate">{item.description}</div>}
                        </td>
                        <td className="py-3 px-4 align-top space-y-0.5 tabular-nums">
                          <div>
                            {item.rewardBalance > 0 && `+${item.rewardBalance} Bal`}
                            {item.rewardExp > 0 && ` · +${item.rewardExp} EXP`}
                            {item.rewardLevel > 0 && ` · +${item.rewardLevel} Lv`}
                          </div>
                          {item.additionalRewards.length > 0 && (
                            <div className="text-pink-600 dark:text-pink-400">
                              {item.additionalRewards.map(describeAdditional).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 align-top text-slate-500 tabular-nums">
                          <div>Per user: {item.perUserLimit}x · Cooldown: {item.cooldownSec}d</div>
                          <div>Exp: {item.expiresAt ? item.expiresAt.slice(0, 16).replace('T', ' ') : 'Tanpa batas'}</div>
                        </td>
                        <td className="py-3 px-4 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {item.claimedCount} / {item.maxClaims === 0 ? '∞' : item.maxClaims}
                        </td>
                        <td className={`py-3 px-4 align-top font-semibold whitespace-nowrap ${statusClass}`}>{statusLabel}</td>
                        <td className="py-3 px-4 align-top text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              aria-label={`Detail ${item.code}`}
                              onClick={() => void openDetail(item.code)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" /> Detail
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit ${item.code}`}
                              onClick={() => openEdit(item)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3 h-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(item)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {item.active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              type="button"
                              aria-label={`Reset ${item.code}`}
                              onClick={() => {
                                setResetConfirmCode(item.code);
                                setResetConfirmText('');
                              }}
                              className="px-2 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 inline-flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" /> Reset
                            </button>
                            <button
                              type="button"
                              aria-label={`Hapus ${item.code}`}
                              onClick={() => setDeleteConfirmCode(item.code)}
                              className="px-2 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalCodes > codePageSize && (
            <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
              <span>Halaman {codePage} · Total {totalCodes} kode</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={codePage <= 1}
                  onClick={() => setCodePage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={codePage * codePageSize >= totalCodes}
                  onClick={() => setCodePage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}

          {/* Edit Modal */}
          {editingCode && editDraft && (
            <form
              onSubmit={saveEdit}
              className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-blue-500 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Edit Kode Redeem: <span className="font-mono text-blue-700 dark:text-blue-400">{editingCode.code}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCode(null);
                    setEditDraft(null);
                  }}
                  className="text-xs text-slate-500"
                >
                  Batal
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="ed-name" className="block text-slate-500 mb-1">Nama Kampanye</label>
                  <input
                    id="ed-name"
                    type="text"
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-bal" className="block text-slate-500 mb-1">Balance</label>
                  <input
                    id="ed-bal"
                    type="number"
                    min={0}
                    value={editDraft.rewardBalance}
                    onChange={(e) => setEditDraft({ ...editDraft, rewardBalance: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-exp" className="block text-slate-500 mb-1">EXP</label>
                  <input
                    id="ed-exp"
                    type="number"
                    min={0}
                    value={editDraft.rewardExp}
                    onChange={(e) => setEditDraft({ ...editDraft, rewardExp: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-lvl" className="block text-slate-500 mb-1">Bonus Level</label>
                  <input
                    id="ed-lvl"
                    type="number"
                    min={0}
                    value={editDraft.rewardLevel}
                    onChange={(e) => setEditDraft({ ...editDraft, rewardLevel: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-max" className="block text-slate-500 mb-1">Batas Total Klaim (0 = ∞)</label>
                  <input
                    id="ed-max"
                    type="number"
                    min={0}
                    value={editDraft.maxClaims}
                    onChange={(e) => setEditDraft({ ...editDraft, maxClaims: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-peruser" className="block text-slate-500 mb-1">Batas Per User</label>
                  <input
                    id="ed-peruser"
                    type="number"
                    min={1}
                    value={editDraft.perUserLimit}
                    onChange={(e) => setEditDraft({ ...editDraft, perUserLimit: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-cd" className="block text-slate-500 mb-1">Cooldown (Detik)</label>
                  <input
                    id="ed-cd"
                    type="number"
                    min={0}
                    value={editDraft.cooldownSec}
                    onChange={(e) => setEditDraft({ ...editDraft, cooldownSec: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="ed-expdate" className="block text-slate-500 mb-1">Kedaluwarsa (Opsional)</label>
                  <input
                    id="ed-expdate"
                    type="datetime-local"
                    value={editDraft.expiresAt}
                    onChange={(e) => setEditDraft({ ...editDraft, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1 flex items-end pb-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editDraft.active}
                      onChange={(e) => setEditDraft({ ...editDraft, active: e.target.checked })}
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-200">Kode Aktif</span>
                  </label>
                </div>
              </div>
              <div>
                <label htmlFor="ed-desc" className="block text-xs text-slate-500 mb-1">Deskripsi</label>
                <input
                  id="ed-desc"
                  type="text"
                  value={editDraft.description}
                  onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCode(null);
                    setEditDraft(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold">
                  Simpan Perubahan
                </button>
              </div>
            </form>
          )}

          {/* Reset Confirmation */}
          {resetConfirmCode && (
            <div className="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3 text-xs">
              <div className="font-bold text-sm text-amber-900 dark:text-amber-200">
                Konfirmasi Reset Kuota Klaim: {resetConfirmCode}
              </div>
              <p className="text-amber-800 dark:text-amber-300">
                Tindakan ini akan mengatur ulang counter klaim kode ke 0 agar pengguna dapat mengklaim ulang, namun seluruh catatan pada Claim History tetap tersimpan. Ketik <code className="font-mono font-bold">confirm</code> untuk melanjutkan.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  aria-label="Ketik confirm untuk reset"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="Ketik confirm"
                  className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleConfirmReset()}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-700 text-white font-semibold"
                >
                  Konfirmasi Reset Counter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetConfirmCode(null);
                    setResetConfirmText('');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {/* Delete Confirmation */}
          {deleteConfirmCode && (
            <div className="p-5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 space-y-3 text-xs">
              <div className="font-bold text-sm text-rose-900 dark:text-rose-200">
                Hapus Kode Redeem {deleteConfirmCode}?
              </div>
              <p className="text-rose-800 dark:text-rose-300">
                Kode tidak akan bisa diklaim lagi, tetapi seluruh log audit klaim di Claim History tetap aman dan tidak ikut terhapus.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-700 text-white font-semibold"
                >
                  Ya, Hapus Kode
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmCode(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {/* Detail Panel */}
          {detailModal && (
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Detail & Riwayat Kode</div>
                  <h3 className="text-lg font-bold font-mono text-blue-700 dark:text-blue-400">
                    {detailModal.code.code} · {detailModal.code.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailModal(null)}
                  className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs"
                >
                  Tutup Detail
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950">
                  <div className="text-slate-500">Balance / EXP / Level</div>
                  <div className="font-bold mt-0.5">+{detailModal.code.rewardBalance} / +{detailModal.code.rewardExp} / +{detailModal.code.rewardLevel}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950">
                  <div className="text-slate-500">Klaim Terpakai</div>
                  <div className="font-bold mt-0.5">{detailModal.code.claimedCount} / {detailModal.code.maxClaims === 0 ? '∞' : detailModal.code.maxClaims}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950">
                  <div className="text-slate-500">Per User & Cooldown</div>
                  <div className="font-bold mt-0.5">{detailModal.code.perUserLimit}x · {detailModal.code.cooldownSec}d</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950">
                  <div className="text-slate-500">Reward Tambahan</div>
                  <div className="font-bold mt-0.5">{detailModal.code.additionalRewards.length} item</div>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  Log Klaim Terbaru ({detailModal.recentClaims.length})
                </div>
                {detailModal.recentClaims.length === 0 ? (
                  <p className="text-slate-500">Belum ada riwayat percobaan klaim pada kode ini.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-52 overflow-y-auto">
                    {detailModal.recentClaims.map((cl) => (
                      <div key={cl.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold">{cl.user_name || cl.user_phone}</span>{' '}
                          <span className="font-mono text-slate-400">(+{cl.user_phone})</span>
                          {cl.failure_reason && <div className="text-rose-600 dark:text-rose-400">{cl.failure_reason}</div>}
                        </div>
                        <div className="text-right font-mono">
                          <div className="uppercase font-semibold">{cl.status}</div>
                          <div className="text-slate-400">{cl.created_at}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBMENU 2: INTERACTIVE REWARD BUILDER */}
      {submenu === 'builder' && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <div className="text-xs font-semibold text-pink-600 dark:text-pink-400">
                LANGKAH {builderStep} DARI 5 · REWARD BUILDER TERVALIDASI
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {builderStep === 1 && 'Identitas & Kode Kampanye'}
                {builderStep === 2 && 'Reward Utama (Balance, EXP, Level)'}
                {builderStep === 3 && 'Reward Tambahan dari Reward Registry Aktif'}
                {builderStep === 4 && 'Batas Klaim, Cooldown & Masa Berlaku'}
                {builderStep === 5 && 'Ringkasan & Konfirmasi Akhir'}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
              {[1, 2, 3, 4, 5].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setBuilderStep(st as 1 | 2 | 3 | 4 | 5)}
                  className={`w-7 h-7 rounded-md font-bold ${
                    builderStep === st
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {builderStep === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <label htmlFor="rb-code" className="block text-xs font-medium text-slate-500 mb-1">
                  Kode Redeem (3–32 karakter, kosong = generate otomatis)
                </label>
                <input
                  id="rb-code"
                  type="text"
                  value={bCode}
                  onChange={(e) => setBCode(e.target.value.toUpperCase())}
                  placeholder="Contoh: THEATER2026"
                  className="w-full px-3.5 py-2.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="rb-name" className="block text-xs font-medium text-slate-500 mb-1">
                  Nama Kampanye / Hadiah
                </label>
                <input
                  id="rb-name"
                  type="text"
                  value={bName}
                  onChange={(e) => setBName(e.target.value)}
                  placeholder="Contoh: Bonus Theater Akhir Pekan"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="rb-desc" className="block text-xs font-medium text-slate-500 mb-1">
                  Deskripsi Kampanye (Opsional)
                </label>
                <input
                  id="rb-desc"
                  type="text"
                  value={bDesc}
                  onChange={(e) => setBDesc(e.target.value)}
                  placeholder="Keterangan singkat tujuan kode redeem ini..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>
          )}

          {builderStep === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Tetapkan reward utama akun. Batas maksimal server saat ini: Balance {settings?.maxBalanceCap ?? 100000} · EXP {settings?.maxExpCap ?? 50000} · Level +{settings?.maxLevelCap ?? 50}.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <label htmlFor="rb-bal" className="block text-xs font-medium text-slate-500 mb-1">Reward Balance</label>
                  <input
                    id="rb-bal"
                    type="number"
                    min={0}
                    max={settings?.maxBalanceCap ?? 100000}
                    value={bBalance}
                    onChange={(e) => setBBalance(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="rb-exp" className="block text-xs font-medium text-slate-500 mb-1">Reward EXP</label>
                  <input
                    id="rb-exp"
                    type="number"
                    min={0}
                    max={settings?.maxExpCap ?? 50000}
                    value={bExp}
                    onChange={(e) => setBExp(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="rb-lvl" className="block text-xs font-medium text-slate-500 mb-1">Bonus Level</label>
                  <input
                    id="rb-lvl"
                    type="number"
                    min={0}
                    max={settings?.maxLevelCap ?? 50}
                    value={bLevel}
                    onChange={(e) => setBLevel(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>
          )}

          {builderStep === 3 && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Mau tambahin reward tambahan dari Reward Registry nggak?
                </div>
                <p className="text-xs text-slate-500">
                  Cuma reward dengan handler aktif dan efek nyata ke database yang tersedia di menu ini. Reward yang belum punya handler dinonaktifkan otomatis.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingRewardOpen(true);
                      setRewardDraftError(null);
                    }}
                    className="px-3.5 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Tambah Reward Tambahan
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuilderStep(4)}
                    className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    {bAdditional.length === 0 ? 'Lewati & Lanjut' : 'Selesai Menambah Reward & Lanjut'}
                  </button>
                </div>
              </div>

              {addingRewardOpen && selectedRegistryEntry && (
                <div className="p-4 rounded-xl border border-blue-500 bg-white dark:bg-slate-900 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Pilih Jenis Reward Registry</h4>
                    <button
                      type="button"
                      onClick={() => setAddingRewardOpen(false)}
                      className="text-xs text-slate-500"
                    >
                      Tutup
                    </button>
                  </div>

                  <div>
                    <label htmlFor="rb-reg-select" className="block text-xs text-slate-500 mb-1">
                      Reward Terdaftar Aktif ({activeRegistry.length})
                    </label>
                    <select
                      id="rb-reg-select"
                      value={selectedRewardId}
                      onChange={(e) => {
                        setSelectedRewardId(e.target.value);
                        setRewardParamsDraft({});
                        setRewardDraftError(null);
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      {activeRegistry.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name} ({entry.category})
                        </option>
                      ))}
                    </select>
                    <div className="text-xs text-slate-500 mt-1.5">
                      {selectedRegistryEntry.description} · {selectedRegistryEntry.terms}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedRegistryEntry.paramsSchema.map((spec) => (
                      <div key={spec.key}>
                        <label htmlFor={`param-${spec.key}`} className="block text-xs text-slate-500 mb-1">
                          {spec.label} {spec.required ? '*' : '(Opsional)'}
                        </label>
                        <input
                          id={`param-${spec.key}`}
                          type={spec.type === 'number' ? 'number' : 'text'}
                          min={spec.min}
                          max={spec.max}
                          maxLength={spec.maxLength}
                          placeholder={spec.placeholder}
                          value={rewardParamsDraft[spec.key] ?? ''}
                          onChange={(e) =>
                            setRewardParamsDraft((prev) => ({ ...prev, [spec.key]: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                        />
                      </div>
                    ))}
                  </div>

                  {rewardDraftError && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">{rewardDraftError}</div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingRewardOpen(false)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleAddAdditionalReward}
                      className="px-4 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                    >
                      Simpan Reward ke Daftar
                    </button>
                  </div>
                </div>
              )}

              {bAdditional.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Reward Tambahan Terpilih ({bAdditional.length})
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                    {bAdditional.map((item, idx) => (
                      <div key={`${item.rewardId}-${idx}`} className="p-3 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {describeAdditional(item)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setBAdditional((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-rose-600 hover:underline"
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {builderStep === 4 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <label htmlFor="rb-maxclaims" className="block text-xs font-medium text-slate-500 mb-1">
                  Batas Total Klaim (0 = Tanpa Batas)
                </label>
                <input
                  id="rb-maxclaims"
                  type="number"
                  min={0}
                  value={bMaxClaims}
                  onChange={(e) => setBMaxClaims(Number(e.target.value))}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="rb-peruser" className="block text-xs font-medium text-slate-500 mb-1">
                  Batas Klaim Per User
                </label>
                <input
                  id="rb-peruser"
                  type="number"
                  min={1}
                  value={bPerUserLimit}
                  onChange={(e) => setBPerUserLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="rb-cooldown" className="block text-xs font-medium text-slate-500 mb-1">
                  Cooldown Klaim (Detik)
                </label>
                <input
                  id="rb-cooldown"
                  type="number"
                  min={0}
                  value={bCooldownSec}
                  onChange={(e) => setBCooldownSec(Number(e.target.value))}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="rb-expires" className="block text-xs font-medium text-slate-500 mb-1">
                  Masa Berlaku (Opsional)
                </label>
                <input
                  id="rb-expires"
                  type="datetime-local"
                  value={bExpiresAt}
                  onChange={(e) => setBExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4 pt-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input type="checkbox" checked={bActive} onChange={(e) => setBActive(e.target.checked)} />
                  Langsung aktifkan kode setelah disimpan
                </label>
              </div>
            </div>
          )}

          {builderStep === 5 && (
            <div className="space-y-4">
              <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Ringkasan Konfigurasi Kode Redeem
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-slate-500">Kode & Nama</div>
                    <div className="font-mono font-bold text-sm text-blue-700 dark:text-blue-400">
                      {bCode.trim() || '(Otomatis)'} · {bName.trim() || bCode.trim() || 'Kampanye Redeem'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Status Awal</div>
                    <div className="font-semibold">{bActive ? 'Aktif' : 'Nonaktif'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Reward Utama</div>
                    <div className="font-semibold tabular-nums">
                      +{bBalance} Balance · +{bExp} EXP · +{bLevel} Level
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Batas & Kedaluwarsa</div>
                    <div className="font-semibold tabular-nums">
                      Total {bMaxClaims === 0 ? 'Tanpa Batas' : bMaxClaims} · Per user {bPerUserLimit}x · Cooldown {bCooldownSec}d · {bExpiresAt ? bExpiresAt.replace('T', ' ') : 'Permanen'}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 mb-1">Reward Tambahan ({bAdditional.length})</div>
                  {bAdditional.length === 0 ? (
                    <div className="text-slate-400">Belum ada reward tambahan.</div>
                  ) : (
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-700 dark:text-slate-300">
                      {bAdditional.map((item, idx) => (
                        <li key={idx}>{describeAdditional(item)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setBuilderStep(1)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Edit Konfigurasi
                </button>
                <button
                  type="button"
                  disabled={builderSubmitting}
                  onClick={() => void handleBuilderConfirmSave()}
                  className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold"
                >
                  {builderSubmitting ? 'Menyimpan...' : 'Konfirmasi & Simpan Kode Redeem'}
                </button>
              </div>
            </div>
          )}

          {/* Step navigation footer */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              disabled={builderStep <= 1}
              onClick={() => setBuilderStep((s) => Math.max(1, s - 1) as any)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 text-xs font-semibold inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Sebelumnya
            </button>
            {builderStep < 5 && (
              <button
                type="button"
                onClick={() => setBuilderStep((s) => Math.min(5, s + 1) as any)}
                className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                Lanjut <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* SUBMENU 3: CLAIM HISTORY */}
      {submenu === 'history' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: 'Semua' },
                { id: 'success', label: 'Berhasil' },
                { id: 'failed', label: 'Gagal' },
                { id: 'rejected', label: 'Ditolak' },
                { id: 'expired', label: 'Kedaluwarsa' },
                { id: 'cancelled', label: 'Dibatalkan' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setHistoryStatus(st.id as any);
                    setHistoryPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    historyStatus === st.id
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              aria-label="Cari riwayat klaim"
              value={historySearch}
              onChange={(e) => {
                setHistorySearch(e.target.value);
                setHistoryPage(1);
              }}
              placeholder="Cari kode, nomor user, atau alasan..."
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 lg:w-72"
            />
          </div>

          <div className="text-xs text-slate-500">
            Log Claim History bersifat permanen sebagai jejak audit: riwayat tetap tersimpan meskipun kode telah dihapus atau direset.
          </div>

          <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Pengguna</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Ringkasan Hadiah / Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {historyItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Belum ada catatan klaim untuk filter ini.
                    </td>
                  </tr>
                ) : (
                  historyItems.map((h) => {
                    const g = h.rewardsGranted || {};
                    const rewardSummary = [
                      g.balance ? `+${g.balance} Bal` : null,
                      g.exp ? `+${g.exp} EXP` : null,
                      g.levelBonus ? `+${g.levelBonus} Lv` : null,
                      ...(Array.isArray(g.items) ? g.items.map((x: any) => x.summary) : []),
                    ]
                      .filter(Boolean)
                      .join(' · ');

                    const stColor =
                      h.status === 'success'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : h.status === 'expired'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-rose-700 dark:text-rose-400';

                    return (
                      <tr key={h.id}>
                        <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">{h.createdAt}</td>
                        <td className="py-2.5 px-4">
                          <span className="font-mono font-bold text-blue-700 dark:text-blue-400">{h.code}</span>
                          {h.codeName && h.codeName !== h.code && (
                            <div className="text-slate-500">{h.codeName}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white">{h.userName}</div>
                          <div className="font-mono text-slate-400">+{h.userPhone}</div>
                        </td>
                        <td className={`py-2.5 px-4 font-semibold uppercase ${stColor}`}>{h.status}</td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                          {h.status === 'success' ? rewardSummary || 'Hadiah diterapkan' : h.failureReason || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {historyTotal > historyPageSize && (
            <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
              <span>Halaman {historyPage} · Total {historyTotal} log klaim</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={historyPage <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={historyPage * historyPageSize >= historyTotal}
                  onClick={() => setHistoryPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBMENU 4: REDEEM ANALYTICS */}
      {submenu === 'analytics' && analytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Total Kode / Aktif</div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                {analytics.totalCodes} / {analytics.activeCodes}
              </div>
              <div className="text-xs text-slate-500 mt-1 tabular-nums">
                Nonaktif: {analytics.inactiveCodes} · Kedaluwarsa: {analytics.expiredCodes}
              </div>
            </div>
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Klaim Berhasil / Percobaan</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {analytics.successClaims} / {analytics.totalAttempts}
              </div>
              <div className="text-xs text-slate-500 mt-1 tabular-nums">
                Ditolak: {analytics.rejectedClaims} · Gagal: {analytics.failedClaims} · Expired: {analytics.expiredAttempts}
              </div>
            </div>
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Distribusi Balance & EXP</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 mt-1">
                {analytics.rewardTotals.balanceDistributed.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500 mt-1 tabular-nums">
                EXP: +{analytics.rewardTotals.expDistributed.toLocaleString()} · Level: +{analytics.rewardTotals.levelGranted}
              </div>
            </div>
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Distribusi Limit & Premium</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-pink-600 dark:text-pink-400 mt-1">
                +{analytics.rewardTotals.limitGranted} Limit
              </div>
              <div className="text-xs text-slate-500 mt-1 tabular-nums">
                Premium: {analytics.rewardTotals.premiumDaysGranted} hari
              </div>
            </div>
          </div>

          <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Kode Redeem Terpopuler</h3>
            <div className="space-y-3">
              {analytics.topCodes.map((tc) => {
                const pct = tc.maxClaims > 0 ? Math.min(100, Math.round((tc.claimedCount / tc.maxClaims) * 100)) : 100;
                return (
                  <div key={tc.code} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between tabular-nums">
                      <span>
                        <span className="font-mono font-bold text-blue-700 dark:text-blue-400">{tc.code}</span>{' '}
                        <span className="text-slate-500">· {tc.name}</span>
                      </span>
                      <span className="font-mono">
                        {tc.claimedCount} / {tc.maxClaims === 0 ? '∞' : tc.maxClaims} ({tc.active ? 'Aktif' : 'Nonaktif'})
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-blue-700 dark:bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUBMENU 5: REDEEM SETTINGS */}
      {submenu === 'settings' && settingsDraft && (
        <form
          onSubmit={handleSaveSettings}
          className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        >
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Pengaturan Global & Template Pesan Redeem</h3>
            <p className="text-xs text-slate-500 mt-1">
              Placeholder yang tersedia: <code className="font-mono">{'{code}'}</code>, <code className="font-mono">{'{user}'}</code>, <code className="font-mono">{'{rewards}'}</code>, <code className="font-mono">{'{balance}'}</code>, <code className="font-mono">{'{exp}'}</code>, <code className="font-mono">{'{level}'}</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
            <div>
              <label htmlFor="rs-cd" className="block text-slate-500 mb-1">Global Cooldown (detik)</label>
              <input
                id="rs-cd"
                type="number"
                min={0}
                value={settingsDraft.globalCooldownSec}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, globalCooldownSec: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-bal" className="block text-slate-500 mb-1">Maks. Balance Cap</label>
              <input
                id="rs-bal"
                type="number"
                min={100}
                value={settingsDraft.maxBalanceCap}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, maxBalanceCap: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-exp" className="block text-slate-500 mb-1">Maks. EXP Cap</label>
              <input
                id="rs-exp"
                type="number"
                min={100}
                value={settingsDraft.maxExpCap}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, maxExpCap: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-lvl" className="block text-slate-500 mb-1">Maks. Level Cap</label>
              <input
                id="rs-lvl"
                type="number"
                min={1}
                value={settingsDraft.maxLevelCap}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, maxLevelCap: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-per" className="block text-slate-500 mb-1">Default Per User Limit</label>
              <input
                id="rs-per"
                type="number"
                min={1}
                value={settingsDraft.defaultPerUserLimit}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, defaultPerUserLimit: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="rs-msg-ok" className="block text-slate-500 mb-1">Template Pesan Berhasil</label>
              <input
                id="rs-msg-ok"
                type="text"
                value={settingsDraft.msgSuccess}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, msgSuccess: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-msg-exp" className="block text-slate-500 mb-1">Template Pesan Kedaluwarsa</label>
              <input
                id="rs-msg-exp"
                type="text"
                value={settingsDraft.msgExpired}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, msgExpired: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-msg-lim" className="block text-slate-500 mb-1">Template Pesan Batas Habis</label>
              <input
                id="rs-msg-lim"
                type="text"
                value={settingsDraft.msgLimit}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, msgLimit: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rs-msg-inv" className="block text-slate-500 mb-1">Template Pesan Tidak Valid / Nonaktif</label>
              <input
                id="rs-msg-inv"
                type="text"
                value={settingsDraft.msgInvalid}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, msgInvalid: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold"
            >
              {savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan Redeem'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
