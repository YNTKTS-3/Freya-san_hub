import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  ChevronRight,
  Command,
  Cpu,
  Database,
  Download,
  FileCode2,
  FolderOpen,
  Gamepad2,
  KeyRound,
  Layers,
  Lock,
  Menu,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { CommandAuditRow } from '../core/types';
import { RedeemManagementPanel } from './RedeemManagementPanel';
import { AbusePreventionPanel } from './AbusePreventionPanel';
import { EconomyLimitPanel } from './EconomyLimitPanel';
import { MenuManagementPanel } from './MenuManagementPanel';
import { CustomCommandBuilderPanel } from './CustomCommandBuilderPanel';
import { ApiManagerPanel } from './ApiManagerPanel';
import {
  WaConnectionHistoryItem,
  WaStatusSnapshot,
  WhatsAppConnectionHistoryCard,
  WhatsAppConnectionPanel,
} from './WhatsAppConnectionPanel';

type DashboardModule =
  | 'overview'
  | 'live_chat'
  | 'whatsapp'
  | 'commands'
  | 'menus'
  | 'custom_commands'
  | 'prefixes'
  | 'games_activity'
  | '48group_admin'
  | 'redeem_management'
  | 'limits_economy'
  | 'api_vault'
  | 'users_redeem'
  | 'abuse_prevention'
  | 'groups'
  | 'ai_agents'
  | 'plugins_auto'
  | 'languages_modules'
  | 'files'
  | 'logs_console'
  | 'backups_settings';

interface OwnerDashboardProps {
  token: string | null;
  onTokenChange: (token: string | null) => void;
}

const SIDEBAR_ITEMS: Array<{ id: DashboardModule; label: string; group: string }> = [
  { id: 'overview', label: 'Overview', group: 'Utama' },
  { id: 'live_chat', label: 'Live Chat Monitor', group: 'Utama' },
  { id: 'whatsapp', label: 'Connection & Simulator', group: 'Utama' },
  { id: 'commands', label: 'Command Manager', group: 'Kontrol Bot' },
  { id: 'menus', label: 'Menu Management', group: 'Kontrol Bot' },
  { id: 'custom_commands', label: 'Custom Commands', group: 'Kontrol Bot' },
  { id: 'prefixes', label: 'Prefix Manager', group: 'Kontrol Bot' },
  { id: 'games_activity', label: 'Game Activity & Engine', group: 'Ekosistem' },
  { id: '48group_admin', label: '48Group Management', group: 'Ekosistem' },
  { id: 'redeem_management', label: 'Redeem Management', group: 'Platform Management' },
  { id: 'limits_economy', label: 'Limit, Economy & Game Bank', group: 'Platform Management' },
  { id: 'api_vault', label: 'Central API Manager', group: 'Platform Management' },
  { id: 'users_redeem', label: 'Users & Contacts', group: 'Pengguna' },
  { id: 'abuse_prevention', label: 'User Abuse & Exploit Prevention', group: 'Pengguna' },
  { id: 'groups', label: 'Group & Anti-System', group: 'Pengguna' },
  { id: 'ai_agents', label: 'AI & Agent Center', group: 'Kecerdasan' },
  { id: 'plugins_auto', label: 'Plugins & Automation', group: 'Kecerdasan' },
  { id: 'languages_modules', label: 'Multilingual & 13 Modules', group: 'Kecerdasan' },
  { id: 'files', label: 'File Manager', group: 'Sistem' },
  { id: 'logs_console', label: 'Logs & Terminal Console', group: 'Sistem' },
  { id: 'backups_settings', label: 'Backup & Settings', group: 'Sistem' },
];

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({ token, onTokenChange }) => {
  const [authStatus, setAuthStatus] = useState<{ needsFirstRunClaim: boolean; usingEnvPasscode: boolean } | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  const [menuSearch, setMenuSearch] = useState('');
  const [activeModule, setActiveModule] = useState<DashboardModule>('overview');

  // Module states
  const [overview, setOverview] = useState<Record<string, any> | null>(null);
  const [liveChats, setLiveChats] = useState<Array<Record<string, any>>>([]);
  const [waStatus, setWaStatus] = useState<WaStatusSnapshot | null>(null);
  const [waHistory, setWaHistory] = useState<WaConnectionHistoryItem[]>([]);
  const [simScope, setSimScope] = useState<'private' | 'group'>('private');
  const [simText, setSimText] = useState('.menu');
  const [simResult, setSimResult] = useState<Record<string, any> | null>(null);
  const [menuFallbacks, setMenuFallbacks] = useState<Array<Record<string, any>>>([]);
  const [mediaLabLoading, setMediaLabLoading] = useState<string | null>(null);
  const [mediaLabError, setMediaLabError] = useState<string | null>(null);
  const [toliveLabRes, setToliveLabRes] = useState<Record<string, any> | null>(null);
  const [saLabRes, setSaLabRes] = useState<Record<string, any> | null>(null);
  const [mediaJobs, setMediaJobs] = useState<Array<Record<string, any>>>([]);
  const [customToliveBase64, setCustomToliveBase64] = useState<{ dataUrl: string; kind: 'image' | 'video'; name: string } | null>(null);
  const [customSaVisual, setCustomSaVisual] = useState<{ dataUrl: string; name: string } | null>(null);
  const [customSaAudio, setCustomSaAudio] = useState<{ dataUrl: string; name: string } | null>(null);

  // Command Manager
  const [commands, setCommands] = useState<Array<Record<string, any>>>([]);
  const [auditRows, setAuditRows] = useState<CommandAuditRow[]>([]);
  const [cmdSearch, setCmdSearch] = useState('');
  const [cmdCategory, setCmdCategory] = useState('ALL');
  const [cmdReportTab, setCmdReportTab] = useState<'all' | 'most' | 'never' | 'failed' | 'pending' | 'audit'>('all');

  // Prefixes
  const [prefixes, setPrefixes] = useState<Array<{ prefix: string; is_default: number; enabled: number; usage_count: number }>>([]);
  const [newPrefix, setNewPrefix] = useState('');

  // Game Activity
  const [gameData, setGameData] = useState<{ settings: any[]; sessions: any[]; activityLogs: any[] } | null>(null);
  const [gameScopeFilter, setGameScopeFilter] = useState<'all' | 'private' | 'group'>('all');
  const [gameSearch, setGameSearch] = useState('');

  // 48Group Management
  const [admin48, setAdmin48] = useState<{ verifications: any[]; questions: any[]; sources: any[]; history: any[] } | null>(null);
  const [researchQuery, setResearchQuery] = useState('');
  const [researchGroup, setResearchGroup] = useState('jkt48');
  const [researchFeedback, setResearchFeedback] = useState<string | null>(null);

  // Users & Groups
  const [usersData, setUsersData] = useState<{ users: any[]; contacts: any[] } | null>(null);
  const [groupsList, setGroupsList] = useState<any[]>([]);

  // AI & Plugins & Automations
  const [aiData, setAiData] = useState<{ providers: any[]; models: any[]; usage: any[]; agents: any[]; approvals: any[] } | null>(null);
  const [aiTestOut, setAiTestOut] = useState<string | null>(null);
  const [pluginsList, setPluginsList] = useState<any[]>([]);
  const [autoData, setAutoData] = useState<{ automations: any[]; history: any[] } | null>(null);

  // Files, Logs, Console, Backup, Settings
  const [filesList, setFilesList] = useState<any[]>([]);
  const [newFileName, setNewFileName] = useState('catatan-owner.txt');
  const [newFileContent, setNewFileContent] = useState('Konfigurasi operasional Freya-san Hub.');
  const [filePreview, setFilePreview] = useState<string | null>(null);

  const [logsData, setLogsData] = useState<{ logs: any[]; errors: any[]; audits: any[]; cmdUsage: any[] } | null>(null);
  const [consoleCmd, setConsoleCmd] = useState('help');
  const [consoleOutput, setConsoleOutput] = useState<string>('Siap. Ketik "help" untuk daftar perintah terizinkan.');

  const [backupsList, setBackupsList] = useState<any[]>([]);
  const [backupStatus, setBackupStatus] = useState<{ hasEnvEncryptionKey: boolean; requiresManualPassphrase: boolean } | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [settingsList, setSettingsList] = useState<Array<{ key: string; value: string; is_secret: number; updated_at: string }>>([]);
  const [ownerNumInput, setOwnerNumInput] = useState('');
  const [ownerNameInput, setOwnerNameInput] = useState('');
  const [curPassInput, setCurPassInput] = useState('');
  const [newPassInput, setNewPassInput] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  // Multilingual & 13 Bot Modules Audit
  const [translationsList, setTranslationsList] = useState<any[]>([]);
  const [modulesAuditList, setModulesAuditList] = useState<any[]>([]);
  const [trKeyInput, setTrKeyInput] = useState('');
  const [trLangInput, setTrLangInput] = useState<'id' | 'en' | 'ja'>('id');
  const [trTextInput, setTrTextInput] = useState('');

  // Automation Workflow Form & Agent Runner
  const [autoNameInput, setAutoNameInput] = useState('');
  const [autoCronInput, setAutoCronInput] = useState('0 * * * *');
  const [autoActionType, setAutoActionType] = useState<'system_note' | 'cleanup_logs' | 'webhook'>('system_note');
  const [autoTargetInput, setAutoTargetInput] = useState('');
  const [autoFeedback, setAutoFeedback] = useState<string | null>(null);
  const [agentPromptInput, setAgentPromptInput] = useState('');
  const [agentRunOut, setAgentRunOut] = useState<string | null>(null);

  const apiFetch = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
    if (res.status === 401) {
      onTokenChange(null);
    }
    return res.json();
  };

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setAuthStatus(d); })
      .catch(() => {});
  }, []);

  // WebSocket listener with mandatory owner token handshake
  useEffect(() => {
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.eventType === 'wa:status') setWaStatus(msg.payload);
        if (msg.eventType === 'wa:history') {
          void apiFetch('/api/admin/whatsapp/history?limit=30').then((h) => {
            if (h?.ok && Array.isArray(h.history)) setWaHistory(h.history);
          });
        }
        if (msg.eventType === 'chat:message') {
          setLiveChats((prev) => [msg.payload, ...prev].slice(0, 80));
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [token]);

  const loadModuleData = async (mod: DashboardModule) => {
    if (!token) return;
    if (mod === 'overview') {
      const d = await apiFetch('/api/admin/overview');
      if (d.ok) setOverview(d);
    } else if (mod === 'whatsapp') {
      const [d, jobsRes, fbRes] = await Promise.all([
        apiFetch('/api/admin/whatsapp/status'),
        apiFetch('/api/admin/media/jobs'),
        apiFetch('/api/admin/menus/fallbacks'),
      ]);
      if (d.ok) {
        setWaStatus(d.status);
        if (Array.isArray(d.history)) setWaHistory(d.history);
      }
      if (jobsRes.ok) setMediaJobs(jobsRes.jobs || []);
      if (fbRes.ok) setMenuFallbacks(fbRes.logs || []);
    } else if (mod === 'commands') {
      const d = await apiFetch('/api/admin/commands');
      if (d.ok) { setCommands(d.commands); setAuditRows(d.audit); }
    } else if (mod === 'prefixes') {
      const d = await apiFetch('/api/admin/prefixes');
      if (d.ok) setPrefixes(d.prefixes);
    } else if (mod === 'games_activity') {
      const qs = new URLSearchParams({ scope: gameScopeFilter, search: gameSearch });
      const d = await apiFetch(`/api/admin/games?${qs.toString()}`);
      if (d.ok) setGameData(d);
    } else if (mod === '48group_admin') {
      const d = await apiFetch('/api/admin/48group');
      if (d.ok) setAdmin48(d);
    } else if (mod === 'users_redeem') {
      const u = await apiFetch('/api/admin/users');
      if (u.ok) setUsersData(u);
    } else if (mod === 'groups') {
      const d = await apiFetch('/api/admin/groups');
      if (d.ok) setGroupsList(d.groups);
    } else if (mod === 'ai_agents') {
      const d = await apiFetch('/api/admin/ai');
      if (d.ok) setAiData(d);
    } else if (mod === 'plugins_auto') {
      const [p, a] = await Promise.all([apiFetch('/api/admin/plugins'), apiFetch('/api/admin/automations')]);
      if (p.ok) setPluginsList(p.plugins);
      if (a.ok) setAutoData(a);
    } else if (mod === 'languages_modules') {
      const [tRes, mRes] = await Promise.all([apiFetch('/api/admin/translations'), apiFetch('/api/admin/modules-audit')]);
      if (tRes.ok) setTranslationsList(tRes.translations || []);
      if (mRes.ok) setModulesAuditList(mRes.modules || []);
    } else if (mod === 'files') {
      const d = await apiFetch('/api/admin/files');
      if (d.ok) setFilesList(d.files);
    } else if (mod === 'logs_console') {
      const d = await apiFetch('/api/admin/logs');
      if (d.ok) setLogsData(d);
    } else if (mod === 'backups_settings') {
      const [b, s, bSt] = await Promise.all([
        apiFetch('/api/admin/backups'),
        apiFetch('/api/admin/settings'),
        apiFetch('/api/admin/backups/status'),
      ]);
      if (b.ok) setBackupsList(b.backups);
      if (s.ok) {
        setSettingsList(s.settings);
        const ownerNameRow = s.settings.find((x: any) => x.key === 'owner_name_configured');
        if (ownerNameRow && !ownerNameInput) setOwnerNameInput(ownerNameRow.value);
      }
      if (bSt.ok) setBackupStatus(bSt);
    }
  };

  useEffect(() => {
    void loadModuleData(activeModule);
  }, [token, activeModule, gameScopeFilter, gameSearch]);

  useEffect(() => {
    if (!token || activeModule !== 'whatsapp') return;
    const activePairingOrConnect =
      waStatus?.status === 'connecting' ||
      waStatus?.status === 'qr_ready' ||
      waStatus?.pairingStatus === 'waiting' ||
      waStatus?.pairingStatus === 'code_ready';
    if (!activePairingOrConnect) return;
    const timer = setInterval(() => {
      void apiFetch('/api/admin/whatsapp/status').then((d) => {
        if (d?.ok) {
          setWaStatus(d.status);
          if (Array.isArray(d.history)) setWaHistory(d.history);
        }
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [token, activeModule, waStatus?.status, waStatus?.pairingStatus]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const endpoint = authStatus?.needsFirstRunClaim ? '/api/auth/claim' : '/api/auth/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: passcodeInput }),
    });
    const data = await res.json();
    if (!data.ok) {
      setAuthError(data.error || 'Gagal autentikasi.');
      return;
    }
    setPasscodeInput('');
    onTokenChange(data.token);
  };

  const filteredCommands = useMemo(() => {
    let list = [...commands];
    if (cmdCategory !== 'ALL') list = list.filter((c) => c.category === cmdCategory);
    if (cmdSearch.trim()) {
      const q = cmdSearch.toLowerCase();
      list = list.filter((c) => `${c.name} ${c.description} ${c.aliases_csv || ''}`.toLowerCase().includes(q));
    }
    if (cmdReportTab === 'most') list = list.filter((c) => c.usage_count > 0).sort((a, b) => b.usage_count - a.usage_count);
    if (cmdReportTab === 'never') list = list.filter((c) => c.usage_count === 0);
    if (cmdReportTab === 'failed') list = list.filter((c) => c.error_count > 0).sort((a, b) => b.error_count - a.error_count);
    if (cmdReportTab === 'pending') list = list.filter((c) => c.status === 'pending_specification' || c.status === 'pending_integration');
    return list;
  }, [commands, cmdCategory, cmdSearch, cmdReportTab]);

  if (!token) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              KEAMANAN CONSOLE ADMINISTRATOR
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {authStatus?.needsFirstRunClaim ? 'Klaim Passcode Owner Pertama' : 'Login Owner Console'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {authStatus?.needsFirstRunClaim
                ? 'Passcode owner belum disetel di server. Bikin passcode minimal 6 karakter buat ngamanin seluruh modul admin dan nomor privat owner.'
                : 'Masukin passcode owner buat akses Command Manager, WhatsApp Engine, Game Activity, dan 48Group Approval.'}
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label htmlFor="owner-pass" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                {authStatus?.needsFirstRunClaim ? 'Buat Passcode Owner Baru' : 'Passcode Owner'}
              </label>
              <input
                id="owner-pass"
                type="password"
                required
                minLength={6}
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            {authError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                {authError}
              </div>
            )}
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors"
            >
              {authStatus?.needsFirstRunClaim ? 'Simpan & Masuk ke Console' : 'Masuk ke Owner Console'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const visibleSidebar = SIDEBAR_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(menuSearch.toLowerCase()),
  );

  const exportInventoryJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), audit: auditRows, commands }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'freyasan-command-inventory-audit.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative min-h-[calc(100vh-65px)] flex bg-slate-50 dark:bg-slate-950 overflow-x-hidden">
      {/* Collapsible Sidebar (Drawer on mobile, inline on desktop) */}
      {sidebarOpen && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 top-16 z-20 bg-slate-950/40 md:hidden"
          />
          <aside className="fixed md:static top-16 bottom-0 left-0 z-30 w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-4 shadow-xl md:shadow-none">
            <div className="flex items-center justify-between md:hidden">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Menu Owner Console</span>
              <button
                type="button"
                aria-label="Tutup menu admin"
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <label htmlFor="side-search" className="sr-only">Cari menu dashboard</label>
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="side-search"
                type="text"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Cari menu admin..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>

          <nav className="space-y-1 overflow-y-auto flex-1">
            {visibleSidebar.map((item, idx) => {
              const showGroupHeader = idx === 0 || visibleSidebar[idx - 1].group !== item.group;
              return (
                <React.Fragment key={item.id}>
                  {showGroupHeader && (
                    <div className={`px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 ${idx === 0 ? 'pt-0.5 pb-1' : 'pt-3 pb-1'}`}>
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModule(item.id);
                      if (typeof window !== 'undefined' && window.innerWidth < 768) {
                        setSidebarOpen(false);
                      }
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between ${
                      activeModule === item.id
                        ? 'bg-blue-700 text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => onTokenChange(null)}
            className="w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Keluar Sesi Owner
          </button>
          </aside>
        </>
      )}

      {/* Main Dashboard Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Dashboard Sub-Header */}
        <div className="px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              aria-label="Toggle sidebar navigasi"
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-slate-400">Owner Console</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold text-slate-900 dark:text-white">
              {SIDEBAR_ITEMS.find((i) => i.id === activeModule)?.label}
            </span>
          </div>
          <button
            type="button"
            onClick={() => loadModuleData(activeModule)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Muat Ulang
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* 1. OVERVIEW */}
          {activeModule === 'overview' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Command Aktif / Total</div>
                  <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                    {overview.cmdStats.active} / {overview.cmdStats.total}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Belum dipakai: {overview.neverUsedCount}</div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Pengguna & Grup</div>
                  <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                    {overview.totalUsers} / {overview.totalGroups}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Owner privat: {overview.ownerPhone || 'Belum dikonfigurasi'}</div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Antrean 48Group & Game Aktif</div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-pink-600 dark:text-pink-400 mt-1">
                    {overview.pending48} Pending · {overview.activeGames} Sesi
                  </div>
                  <div className="text-xs text-slate-500 mt-1">AI Calls: {overview.aiStats.calls}</div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Status WhatsApp & Memori</div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400 mt-1">
                    {overview.wa.status}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    RAM: {overview.system.memoryUsedMb}/{overview.system.memoryTotalMb} MB
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Command Paling Sering Digunakan</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {overview.topCommands.map((c: any) => (
                    <div key={c.name} className="py-2.5 flex items-center justify-between">
                      <span className="font-mono text-blue-700 dark:text-blue-400">.{c.name} <span className="text-xs text-slate-400">({c.category})</span></span>
                      <span className="font-mono tabular-nums text-xs">{c.usage_count} eksekusi · {c.error_count} error</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. LIVE CHAT MONITOR */}
          {activeModule === 'live_chat' && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Live Chat Monitor (WebSocket Real-Time)</h2>
                <span className="text-xs text-slate-500">{liveChats.length} pesan sesi berjalan</span>
              </div>
              {liveChats.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada pesan masuk pada sesi WebSocket ini. Kirim pesan melalui Connection & Simulator atau WhatsApp terhubung untuk memantau secara langsung.</p>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {liveChats.map((m) => (
                    <div key={m.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {m.direction === 'outbound' ? 'BOT' : m.senderName} ({m.chatScope.toUpperCase()})
                        </span>
                        <span className="font-mono">{m.timestamp}</span>
                      </div>
                      <div className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{m.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. WHATSAPP CONNECTION, SIMULATOR & MEDIA LAB (#tolive / #sa) */}
          {activeModule === 'whatsapp' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <WhatsAppConnectionPanel
                  waStatus={waStatus}
                  waHistory={waHistory}
                  apiFetch={apiFetch}
                  onRefresh={() => loadModuleData('whatsapp')}
                />

                <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">WhatsApp Command & Interactive Menu Tester</h2>
                  <p className="text-xs text-slate-500">
                    Uji seluruh 10 prefix (dengan & tanpa spasi), interactive list menu, fallback teks, Folio, dan pemisahan game Private vs Group langsung ke dispatcher bot.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSimScope('private')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${simScope === 'private' ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700'}`}
                    >
                      Private Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimScope('group')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${simScope === 'group' ? 'border-pink-600 bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400' : 'border-slate-200 dark:border-slate-700'}`}
                    >
                      Group Chat
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={simText}
                      onChange={(e) => setSimText(e.target.value)}
                      placeholder="Contoh: .menu atau ! ping atau .member48 Freya"
                      className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const d = await apiFetch('/api/admin/whatsapp/simulate', {
                          method: 'POST',
                          body: JSON.stringify({ text: simText, chatScope: simScope }),
                        });
                        if (d.ok) setSimResult(d.result);
                      }}
                      className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                    >
                      Kirim
                    </button>
                  </div>

                  {simResult && (
                    <div className="space-y-3">
                      <div className="p-4 rounded-lg bg-slate-950 text-slate-100 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {simResult.replyText}
                      </div>
                      {simResult.mediaPreview && (simResult.mediaPreview.dataUrl || simResult.mediaPreview.motionVideoDataUrl) && (
                        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 space-y-2">
                          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Preview Media ({simResult.mediaPreview.kind} · {simResult.mediaPreview.mimetype || simResult.mediaPreview.mime || 'image/webp'})
                          </div>
                          {simResult.mediaPreview.motionVideoDataUrl ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <img
                                src={simResult.mediaPreview.stillDataUrl || simResult.mediaPreview.dataUrl}
                                alt="Frame Still Cover"
                                className="max-w-full rounded-lg border border-slate-200 dark:border-slate-800"
                              />
                              <video
                                src={simResult.mediaPreview.motionVideoDataUrl}
                                controls
                                loop
                                className="max-w-full rounded-lg border border-slate-200 dark:border-slate-800"
                              />
                            </div>
                          ) : (
                            <img
                              src={simResult.mediaPreview.dataUrl}
                              alt={simResult.mediaPreview.caption || 'Hasil render simulator'}
                              className="max-w-xs rounded-lg border border-slate-200 dark:border-slate-800"
                            />
                          )}
                          {simResult.mediaPreview.audioDataUrl && (
                            <audio src={simResult.mediaPreview.audioDataUrl} controls className="w-full max-w-xs" />
                          )}
                        </div>
                      )}
                      {Array.isArray(simResult.privateDeliveries) && simResult.privateDeliveries.length > 0 && (
                        <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 text-xs space-y-1">
                          <div className="font-semibold text-blue-700 dark:text-blue-300">
                            Antrean Pengiriman Privat Bertahap ({simResult.privateDeliveries.length} pesan)
                          </div>
                          {simResult.privateDeliveries.map((d: any, i: number) => (
                            <div key={i} className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                              +{d.recipientPhone} (delay {d.delayMs}ms): {d.text.split('\n')[0]}
                            </div>
                          ))}
                        </div>
                      )}
                      {simResult.contactCard && (
                        <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 text-xs space-y-1">
                          <div className="font-bold text-emerald-800 dark:text-emerald-300">
                            📇 Kartu Kontak vCard 3.0 — {simResult.contactCard.displayName} ({simResult.contactCard.org})
                          </div>
                          <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            WhatsApp: +{simResult.contactCard.phone}
                          </div>
                          <pre className="mt-1 p-2 rounded bg-slate-950 text-slate-200 text-[10px] font-mono overflow-x-auto">
                            {simResult.contactCard.vcard}
                          </pre>
                        </div>
                      )}
                      {simResult.interactiveMenu && (
                        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-bold text-slate-900 dark:text-white">
                              {simResult.interactiveMenu.title} — Interactive List ({simResult.interactiveMenu.buttonText || 'Pilih Menu'})
                            </div>
                            <span className="text-[11px] font-mono text-slate-500">
                              {simResult.interactiveMenu.footer || 'Freya-san bot by Pak Ujan'}
                            </span>
                          </div>
                          {(() => {
                            let runningIndex = 0;
                            const sections = Array.isArray(simResult.interactiveMenu.sections)
                              ? simResult.interactiveMenu.sections
                              : [];
                            return sections.map((sec: any, secIdx: number) => (
                              <div key={`${sec.title}-${secIdx}`} className="space-y-1.5">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {sec.title}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {(sec.rows || []).map((r: any) => {
                                    runningIndex += 1;
                                    const rowNum = runningIndex;
                                    return (
                                      <button
                                        key={r.id}
                                        type="button"
                                        onClick={async () => {
                                          setSimText(r.command || String(rowNum));
                                          const d = await apiFetch('/api/admin/whatsapp/simulate', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                              text: r.command || String(rowNum),
                                              selectedRowId: r.id,
                                              chatScope: simScope,
                                            }),
                                          });
                                          if (d.ok) setSimResult(d.result);
                                          const fbRes = await apiFetch('/api/admin/menus/fallbacks');
                                          if (fbRes.ok) setMenuFallbacks(fbRes.logs || []);
                                        }}
                                        className="p-2 text-left rounded border border-slate-200 dark:border-slate-800 hover:border-blue-600 text-xs transition-colors"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-semibold text-blue-700 dark:text-blue-400 truncate">
                                            {rowNum}. {r.title}
                                          </span>
                                          {r.permission && r.permission !== 'public' && (
                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shrink-0">
                                              {String(r.permission).toUpperCase()}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-slate-500 truncate">{r.description}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Log Fallback Interactive Menu */}
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                          Log Fallback Interactive Menu
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Catat pengiriman fallback teks bernomor saat native list nggak didukung atau mode simulator aktif.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const fbRes = await apiFetch('/api/admin/menus/fallbacks');
                          if (fbRes.ok) setMenuFallbacks(fbRes.logs || []);
                        }}
                        className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                    </div>
                    {menuFallbacks.length === 0 ? (
                      <div className="text-xs text-slate-500 py-2">Belum ada catatan fallback menu terbaru.</div>
                    ) : (
                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 text-xs">
                        {menuFallbacks.slice(0, 15).map((fb: any) => (
                          <div key={fb.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">{fb.menu_key}</span>
                              <span className="text-slate-500"> · {fb.mode} · {fb.reason}</span>
                            </div>
                            <span className="text-[11px] font-mono text-slate-400">{fb.created_at}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <WhatsAppConnectionHistoryCard
                waHistory={waHistory}
                onRefresh={() => loadModuleData('whatsapp')}
              />

              {/* MEDIA LAB: #tolive & #stickeraudio / #sa */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Media Pipeline Lab (#tolive Live Photo & #sa Sound Sticker)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Uji nyata pipeline Python + FFmpeg + validasi container (XMP MotionPhoto / WebP ANIM+EXIF+Opus) + encoding WAProto WhatsApp.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadModuleData('whatsapp')}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Muat Ulang Job Log
                  </button>
                </div>

                {mediaLabError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    {mediaLabError}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* #tolive tester card */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">#tolive — Motion / Live Photo</span>
                      <span className="text-[11px] font-mono text-blue-700 dark:text-blue-400">JPEG+XMP+MP4 · Tag 12</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={Boolean(mediaLabLoading)}
                        onClick={async () => {
                          setMediaLabError(null);
                          setMediaLabLoading('tolive-image');
                          try {
                            const d = await apiFetch('/api/admin/media/test-tolive', {
                              method: 'POST',
                              body: JSON.stringify({ mode: 'image' }),
                            });
                            if (d.ok) {
                              setToliveLabRes(d);
                              if (d.jobs) setMediaJobs(d.jobs);
                            } else {
                              setMediaLabError(d.error || 'Gagal uji #tolive gambar.');
                            }
                          } finally {
                            setMediaLabLoading(null);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold"
                      >
                        {mediaLabLoading === 'tolive-image' ? 'Memproses...' : 'Uji #tolive (Sampel Gambar)'}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(mediaLabLoading)}
                        onClick={async () => {
                          setMediaLabError(null);
                          setMediaLabLoading('tolive-video');
                          try {
                            const d = await apiFetch('/api/admin/media/test-tolive', {
                              method: 'POST',
                              body: JSON.stringify({ mode: 'video' }),
                            });
                            if (d.ok) {
                              setToliveLabRes(d);
                              if (d.jobs) setMediaJobs(d.jobs);
                            } else {
                              setMediaLabError(d.error || 'Gagal uji #tolive video.');
                            }
                          } finally {
                            setMediaLabLoading(null);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold"
                      >
                        {mediaLabLoading === 'tolive-video' ? 'Memproses...' : 'Uji #tolive (Sampel Video)'}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="file"
                        accept="image/*,video/mp4,video/webm"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 10 * 1024 * 1024) {
                            setMediaLabError('Ukuran unggahan Media Lab maks 10 MB.');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            setCustomToliveBase64({
                              dataUrl: String(reader.result || ''),
                              kind: file.type.startsWith('video/') ? 'video' : 'image',
                              name: file.name,
                            });
                          };
                          reader.readAsDataURL(file);
                        }}
                        className="text-xs text-slate-600 dark:text-slate-300"
                      />
                      {customToliveBase64 && (
                        <button
                          type="button"
                          disabled={Boolean(mediaLabLoading)}
                          onClick={async () => {
                            setMediaLabError(null);
                            setMediaLabLoading('tolive-custom');
                            try {
                              const d = await apiFetch('/api/admin/media/test-tolive', {
                                method: 'POST',
                                body: JSON.stringify({
                                  mode: customToliveBase64.kind,
                                  mediaBase64: customToliveBase64.dataUrl,
                                }),
                              });
                              if (d.ok) {
                                setToliveLabRes(d);
                                if (d.jobs) setMediaJobs(d.jobs);
                              } else {
                                setMediaLabError(d.error || 'Gagal uji unggahan #tolive.');
                              }
                            } finally {
                              setMediaLabLoading(null);
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-700 text-white text-xs font-semibold"
                        >
                          Proses ({customToliveBase64.name})
                        </button>
                      )}
                    </div>

                    {toliveLabRes?.preview && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <div className="text-[11px] font-semibold text-slate-500">Still Cover (.jpg)</div>
                            <img
                              src={toliveLabRes.preview.stillDataUrl}
                              alt="MotionPhoto Cover"
                              className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-800"
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] font-semibold text-slate-500">Motion Clip (.mp4)</div>
                            <video
                              src={toliveLabRes.preview.motionVideoDataUrl}
                              controls
                              loop
                              muted
                              className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-800 bg-black"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                          <div>XMP MotionPhoto: {String(toliveLabRes.preview.validation?.motionPhotoTag ?? '1')} ({String(toliveLabRes.preview.validation?.embeddedVideoCodec ?? 'h264')})</div>
                          <div>MicroVideoOffset: {toliveLabRes.preview.validation?.microVideoOffset} B</div>
                          <div>Container .jpg: {Math.round(toliveLabRes.preview.motionPhotoJpgBytes / 1024)} KB</div>
                          <div>WAProto Pair: {toliveLabRes.protoCheck?.parentBytes}+{toliveLabRes.protoCheck?.childBytes} B</div>
                        </div>
                        <a
                          href={toliveLabRes.preview.motionPhotoJpgDataUrl}
                          download={`freyasan-motionphoto-${toliveLabRes.jobId || 'sample'}.jpg`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" /> Unduh MotionPhoto Android (.jpg)
                        </a>
                      </div>
                    )}
                  </div>

                  {/* #sa tester card */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">#sa / #stickeraudio — Sound Sticker</span>
                      <span className="text-[11px] font-mono text-pink-700 dark:text-pink-400">WebP+EXIF + Opus · Tag 26</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={Boolean(mediaLabLoading)}
                        onClick={async () => {
                          setMediaLabError(null);
                          setMediaLabLoading('sa-video');
                          try {
                            const d = await apiFetch('/api/admin/media/test-sa', {
                              method: 'POST',
                              body: JSON.stringify({ mode: 'video' }),
                            });
                            if (d.ok) {
                              setSaLabRes(d);
                              if (d.jobs) setMediaJobs(d.jobs);
                            } else {
                              setMediaLabError(d.error || 'Gagal uji #sa video.');
                            }
                          } finally {
                            setMediaLabLoading(null);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-pink-700 hover:bg-pink-800 disabled:opacity-50 text-white text-xs font-semibold"
                      >
                        {mediaLabLoading === 'sa-video' ? 'Memproses...' : 'Uji #sa (Video -> WebP+Opus)'}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(mediaLabLoading)}
                        onClick={async () => {
                          setMediaLabError(null);
                          setMediaLabLoading('sa-pair');
                          try {
                            const d = await apiFetch('/api/admin/media/test-sa', {
                              method: 'POST',
                              body: JSON.stringify({ mode: 'image_audio' }),
                            });
                            if (d.ok) {
                              setSaLabRes(d);
                              if (d.jobs) setMediaJobs(d.jobs);
                            } else {
                              setMediaLabError(d.error || 'Gagal uji #sa gambar+audio.');
                            }
                          } finally {
                            setMediaLabLoading(null);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold"
                      >
                        {mediaLabLoading === 'sa-pair' ? 'Memproses...' : 'Uji #sa (Gambar + Audio)'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-500">Visual (opsional: gambar/video)</span>
                        <input
                          type="file"
                          accept="image/*,video/mp4,video/webm"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file || file.size > 10 * 1024 * 1024) return;
                            const reader = new FileReader();
                            reader.onload = () => setCustomSaVisual({ dataUrl: String(reader.result || ''), name: file.name });
                            reader.readAsDataURL(file);
                          }}
                          className="w-full text-[11px]"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-500">Audio (opsional: mp3/ogg/wav)</span>
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file || file.size > 10 * 1024 * 1024) return;
                            const reader = new FileReader();
                            reader.onload = () => setCustomSaAudio({ dataUrl: String(reader.result || ''), name: file.name });
                            reader.readAsDataURL(file);
                          }}
                          className="w-full text-[11px]"
                        />
                      </label>
                    </div>
                    {customSaVisual && (
                      <button
                        type="button"
                        disabled={Boolean(mediaLabLoading)}
                        onClick={async () => {
                          setMediaLabError(null);
                          setMediaLabLoading('sa-custom');
                          try {
                            const isVid = customSaVisual.dataUrl.startsWith('data:video/');
                            const d = await apiFetch('/api/admin/media/test-sa', {
                              method: 'POST',
                              body: JSON.stringify({
                                mode: isVid && !customSaAudio ? 'video' : 'image_audio',
                                visualBase64: customSaVisual.dataUrl,
                                audioBase64: customSaAudio?.dataUrl,
                              }),
                            });
                            if (d.ok) {
                              setSaLabRes(d);
                              if (d.jobs) setMediaJobs(d.jobs);
                            } else {
                              setMediaLabError(d.error || 'Gagal uji unggahan #sa.');
                            }
                          } finally {
                            setMediaLabLoading(null);
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-emerald-700 text-white text-xs font-semibold"
                      >
                        Proses Unggahan ({customSaVisual.name}{customSaAudio ? ` + ${customSaAudio.name}` : ''})
                      </button>
                    )}

                    {saLabRes?.preview && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="flex flex-wrap items-center gap-4">
                          <img
                            src={saLabRes.preview.stickerDataUrl}
                            alt="Animated WebP Sticker"
                            className="w-28 h-28 rounded-lg border border-slate-200 dark:border-slate-800 bg-white"
                          />
                          <div className="flex-1 min-w-[180px] space-y-2">
                            <div className="text-[11px] font-semibold text-slate-500">
                              Audio OGG/Opus ({saLabRes.preview.audioSeconds}s · {Math.round(saLabRes.preview.audioBytes / 1024)} KB)
                            </div>
                            <audio src={saLabRes.preview.audioDataUrl} controls className="w-full h-9" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                          <div>WebP Size: {Math.round(saLabRes.preview.stickerBytes / 1024)} KB (&lt;500KB)</div>
                          <div>Frame ANMF: {saLabRes.preview.webpValidation?.anmfFrames} · EXIF: {String(saLabRes.preview.webpValidation?.hasWhatsAppExif)}</div>
                          <div>Audio: {String(saLabRes.preview.audioValidation?.codec)} @ {saLabRes.preview.audioValidation?.sampleRate}Hz</div>
                          <div>WAProto Tag 26: {saLabRes.protoCheck?.directProtoBytes} B</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Honest Limitation Notice */}
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                  <strong>Catatan Keterbatasan Perangkat & Socket:</strong> Pembuatan container XMP MotionPhoto, Animated WebP + EXIF, audio OGG/Opus, dan encoding protobuf WhatsApp (field 12 & field 26/134) berjalan penuh di backend. Untuk pengiriman nyata ke HP, tautkan akun WhatsApp di Connection Manager. Khusus #sa Sound Sticker, ikon pemutar suara hanya muncul pada aplikasi WhatsApp versi terbaru yang mendukung Sound Sticker (Android Beta 2.26.41.3+); versi lama akan merender stiker animasi tanpa audio.
                </div>

                {/* Recent Media Jobs Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Job ID</th>
                        <th className="py-2 pr-3">Command</th>
                        <th className="py-2 pr-3">Input</th>
                        <th className="py-2 pr-3">Output</th>
                        <th className="py-2 pr-3">Ukuran</th>
                        <th className="py-2 pr-3">Durasi</th>
                        <th className="py-2 pr-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {mediaJobs.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-4 text-slate-500">
                            Belum ada log eksekusi #tolive atau #sa. Klik salah satu tombol uji di atas untuk menjalankan pipeline nyata.
                          </td>
                        </tr>
                      ) : (
                        mediaJobs.map((j) => (
                          <tr key={j.id} className="font-mono">
                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{j.id}</td>
                            <td className="py-2 pr-3 font-semibold text-blue-700 dark:text-blue-400">#{j.command}</td>
                            <td className="py-2 pr-3">{j.input_kind}</td>
                            <td className="py-2 pr-3">{j.output_format}</td>
                            <td className="py-2 pr-3">{Math.round((j.bytes_out || 0) / 1024)} KB</td>
                            <td className="py-2 pr-3">{j.duration_ms} ms</td>
                            <td className="py-2 pr-3">
                              <span className={j.validation_ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}>
                                {j.delivery_mode}:{j.delivery_status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 4. COMMAND MANAGER */}
          {activeModule === 'commands' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'all', label: `Semua (${commands.length})` },
                    { id: 'most', label: 'Most Used' },
                    { id: 'never', label: 'Never Used' },
                    { id: 'failed', label: 'Error Rate' },
                    { id: 'pending', label: 'Pending Spec/Int' },
                    { id: 'audit', label: 'Inventory Audit' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCmdReportTab(tab.id as typeof cmdReportTab)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                        cmdReportTab === tab.id ? 'bg-blue-700 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={exportInventoryJson}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Export Audit JSON
                </button>
              </div>

              {cmdReportTab === 'audit' ? (
                <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                        <th className="py-3 px-4">Kategori</th>
                        <th className="py-3 px-4 text-right">Jumlah Sumber</th>
                        <th className="py-3 px-4 text-right">Jumlah Registry</th>
                        <th className="py-3 px-4 text-right">Handler Nyata</th>
                        <th className="py-3 px-4 text-right">Pending</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                      {auditRows.map((r) => (
                        <tr key={r.category}>
                          <td className="py-2.5 px-4 font-semibold">{r.category}</td>
                          <td className="py-2.5 px-4 text-right">{r.sourceCount}</td>
                          <td className="py-2.5 px-4 text-right">{r.registryCount}</td>
                          <td className="py-2.5 px-4 text-right text-emerald-700 dark:text-emerald-400">{r.realHandlerCount}</td>
                          <td className="py-2.5 px-4 text-right text-amber-700 dark:text-amber-400">{r.pendingCount}</td>
                          <td className="py-2.5 px-4 font-sans text-xs">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    <input
                      type="text"
                      value={cmdSearch}
                      onChange={(e) => setCmdSearch(e.target.value)}
                      placeholder="Cari command..."
                      className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <select
                      value={cmdCategory}
                      onChange={(e) => setCmdCategory(e.target.value)}
                      className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {['ALL', 'AI', 'DOWNLOAD', 'GAME', '48GROUP', 'GENERAL', 'GROUP', 'INFO', 'OWNER', 'RANDOM', 'SEARCH', 'STICKER', 'TEXTMAKER', 'TOOLS'].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {cmdCategory !== 'ALL' && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch('/api/admin/commands/toggle', {
                              method: 'POST',
                              body: JSON.stringify({ category: cmdCategory, enabled: true }),
                            });
                            void loadModuleData('commands');
                          }}
                          className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold"
                        >
                          Aktifkan Kategori
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch('/api/admin/commands/toggle', {
                              method: 'POST',
                              body: JSON.stringify({ category: cmdCategory, enabled: false }),
                            });
                            void loadModuleData('commands');
                          }}
                          className="px-3 py-2 rounded-lg bg-rose-700 text-white text-xs font-semibold"
                        >
                          Nonaktifkan Kategori
                        </button>
                      </>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-3 px-4">Command</th>
                          <th className="py-3 px-4">Kategori</th>
                          <th className="py-3 px-4">Akses</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Pakai</th>
                          <th className="py-3 px-4 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredCommands.slice(0, 100).map((c) => (
                          <tr key={c.name}>
                            <td className="py-2.5 px-4 font-mono font-semibold text-blue-700 dark:text-blue-400">
                              {c.name}
                              {c.source_correction && <div className="text-[11px] font-sans font-normal text-pink-600">{c.source_correction}</div>}
                            </td>
                            <td className="py-2.5 px-4">{c.category}</td>
                            <td className="py-2.5 px-4">{c.permission}</td>
                            <td className="py-2.5 px-4">{c.status}</td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums">{c.usage_count}</td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch('/api/admin/commands/toggle', {
                                    method: 'POST',
                                    body: JSON.stringify({ names: [c.name], enabled: !c.enabled }),
                                  });
                                  void loadModuleData('commands');
                                }}
                                className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                                  c.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {c.enabled ? 'Aktif' : 'Nonaktif'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 5. PREFIX MANAGER */}
          {activeModule === 'prefixes' && (
            <div className="max-w-3xl p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Prefix Manager (10 Prefix Default Aktif)</h2>
                  <p className="text-xs text-slate-500">Mendukung format dengan spasi (. menu) dan tanpa spasi (.menu).</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const d = await apiFetch('/api/admin/prefixes', { method: 'POST', body: JSON.stringify({ action: 'reset' }) });
                    if (d.ok) setPrefixes(d.prefixes);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Reset 10 Default
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={3}
                  value={newPrefix}
                  onChange={(e) => setNewPrefix(e.target.value)}
                  placeholder="Tambah prefix baru (mis. ~)"
                  className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newPrefix.trim()) return;
                    const d = await apiFetch('/api/admin/prefixes', { method: 'POST', body: JSON.stringify({ action: 'add', prefix: newPrefix.trim() }) });
                    if (d.ok) { setPrefixes(d.prefixes); setNewPrefix(''); }
                  }}
                  className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                >
                  Tambah Prefix
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {prefixes.map((p) => (
                  <div key={p.prefix} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-mono font-bold text-blue-700 dark:text-blue-400">{p.prefix}</span>
                      <span className="text-[11px] text-slate-400 font-mono">{p.usage_count}x</span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={async () => {
                          const d = await apiFetch('/api/admin/prefixes', {
                            method: 'POST',
                            body: JSON.stringify({ action: 'toggle', prefix: p.prefix, enabled: !p.enabled }),
                          });
                          if (d.ok) setPrefixes(d.prefixes);
                        }}
                        className={`text-[11px] font-semibold ${p.enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}
                      >
                        {p.enabled ? 'ON' : 'OFF'}
                      </button>
                      {!p.is_default && (
                        <button
                          type="button"
                          onClick={async () => {
                            const d = await apiFetch('/api/admin/prefixes', { method: 'POST', body: JSON.stringify({ action: 'delete', prefix: p.prefix }) });
                            if (d.ok) setPrefixes(d.prefixes);
                          }}
                          className="text-[11px] text-rose-600"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. GAME ACTIVITY & ENGINE (Strict Private vs Group separation) */}
          {activeModule === 'games_activity' && gameData && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-full">
                  {[
                    { id: 'all', label: 'Semua Aktivitas' },
                    { id: 'private', label: 'PRIVATE GAME ACTIVITY' },
                    { id: 'group', label: 'GROUP GAME ACTIVITY' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setGameScopeFilter(f.id as typeof gameScopeFilter)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                        gameScopeFilter === f.id ? 'bg-blue-700 text-white' : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                  placeholder="Cari nomor pemain, ID sesi, atau grup..."
                  className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 w-full sm:w-72"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Log Jawaban & Aktivitas Pemain (Owner Only)</h2>
                  <div className="space-y-2.5 max-h-[420px] overflow-y-auto">
                    {gameData.activityLogs.length === 0 ? (
                      <p className="text-xs text-slate-500">Belum ada aktivitas permainan tercatat.</p>
                    ) : (
                      gameData.activityLogs.map((log) => (
                        <div key={log.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                          <div className="flex items-center justify-between font-semibold">
                            <span className={log.chat_scope === 'group' ? 'text-pink-600 dark:text-pink-400' : 'text-blue-700 dark:text-blue-400'}>
                              {log.chat_scope === 'group' ? `GROUP GAME ACTIVITY · ${log.group_name || log.chat_id}` : 'PRIVATE GAME ACTIVITY'}
                            </span>
                            <span className="font-mono text-slate-400">{log.session_id}</span>
                          </div>
                          <div>Pemain: {log.player_name} (+{log.player_phone}) · Game: {log.game_name}</div>
                          <div>Jawaban: <code className="font-mono">{log.answer_text}</code> · Status: <span className="font-semibold">{log.answer_status}</span> · Skor: +{log.score_awarded}</div>
                          <div className="text-slate-400 font-mono">{log.created_at}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Sesi Permainan & Konfigurasi</h2>
                  <div className="space-y-2 max-h-[210px] overflow-y-auto">
                    {gameData.sessions.map((s) => (
                      <div key={s.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold">{s.game_name} ({s.id})</div>
                          <div className="text-slate-500">{s.chat_scope.toUpperCase()} · {s.status}</div>
                        </div>
                        {(s.status === 'active' || s.status === 'waiting') && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/games/sessions/${s.id}/cancel`, { method: 'POST' });
                              void loadModuleData('games_activity');
                            }}
                            className="px-2.5 py-1 rounded bg-rose-600 text-white text-[11px]"
                          >
                            Batalkan
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">Aktif/Nonaktifkan Game</h3>
                    <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto">
                      {gameData.settings.map((gs) => (
                        <button
                          key={gs.game_id}
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/games/${gs.game_id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: !gs.enabled }),
                            });
                            void loadModuleData('games_activity');
                          }}
                          className="p-2 rounded border border-slate-200 dark:border-slate-800 text-left text-xs flex items-center justify-between"
                        >
                          <span className="truncate">{gs.name}</span>
                          <span className={gs.enabled ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                            {gs.enabled ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 7. 48GROUP MANAGEMENT & OWNER APPROVAL */}
          {activeModule === '48group_admin' && (
            <div className="space-y-6">
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Riset Sumber Resmi 48Group (Gemini Grounded + Antrean Verifikasi)</h2>
                <p className="text-xs text-slate-500">
                  Data baru dari riset tidak langsung dipublikasikan ke database utama maupun kuis sebelum mendapat persetujuan owner di bawah ini.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={researchGroup}
                    onChange={(e) => setResearchGroup(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  >
                    {['jkt48', 'akb48', 'ske48', 'nmb48', 'hkt48', 'bnk48', 'mnl48'].map((g) => (
                      <option key={g} value={g}>{g.toUpperCase()}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={researchQuery}
                    onChange={(e) => setResearchQuery(e.target.value)}
                    placeholder="Contoh: jadwal setlist theater terbaru atau member generasi baru"
                    className="flex-1 min-w-[240px] px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!researchQuery.trim()) return;
                      setResearchFeedback('Memeriksa sumber resmi...');
                      const d = await apiFetch('/api/admin/48group/research', {
                        method: 'POST',
                        body: JSON.stringify({ query: researchQuery, groupId: researchGroup }),
                      });
                      setResearchFeedback(d.ok ? `Berhasil masuk antrean verifikasi (${d.verificationId}): ${d.summary}` : `Gagal: ${d.error}`);
                      void loadModuleData('48group_admin');
                    }}
                    className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold"
                  >
                    Jalankan Riset Sumber
                  </button>
                </div>
                {researchFeedback && (
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs whitespace-pre-wrap">
                    {researchFeedback}
                  </div>
                )}
              </div>

              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Antrean Verifikasi & Persetujuan Owner (48Group)</h2>
                <div className="space-y-3">
                  {admin48?.verifications.map((v) => (
                    <div key={v.id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">
                          {v.entity_type} · {v.group_id?.toUpperCase()} · Status Info: {v.info_status} · Approval: <span className="font-semibold">{v.approval_status}</span>
                        </div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-white">{v.entity_name}</div>
                        <div className="text-xs text-blue-700 dark:text-blue-400">{v.source_title} — {v.source_url}</div>
                      </div>
                      {v.approval_status === 'pending' && (
                        <div className="flex gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/48group/verifications/${v.id}/decision`, {
                                method: 'POST',
                                body: JSON.stringify({ decision: 'approve' }),
                              });
                              void loadModuleData('48group_admin');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold"
                          >
                            Setujui & Publikasikan
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/48group/verifications/${v.id}/decision`, {
                                method: 'POST',
                                body: JSON.stringify({ decision: 'reject' }),
                              });
                              void loadModuleData('48group_admin');
                            }}
                            className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 dark:text-rose-400 text-xs font-semibold"
                          >
                            Tolak
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 8. REDEEM MANAGEMENT (Platform Management Standalone Module) */}
          {activeModule === 'redeem_management' && <RedeemManagementPanel apiFetch={apiFetch} />}

          {/* 8b. LIMIT, ECONOMY & GAME BANK */}
          {activeModule === 'limits_economy' && <EconomyLimitPanel apiFetch={apiFetch} />}

          {/* 8c. MENU MANAGEMENT & CUSTOM COMMANDS & API VAULT */}
          {activeModule === 'menus' && <MenuManagementPanel apiFetch={apiFetch} />}
          {activeModule === 'custom_commands' && <CustomCommandBuilderPanel apiFetch={apiFetch} />}
          {activeModule === 'api_vault' && <ApiManagerPanel apiFetch={apiFetch} />}

          {/* 9b. USER ABUSE & EXPLOIT PREVENTION */}
          {activeModule === 'abuse_prevention' && <AbusePreventionPanel apiFetch={apiFetch} />}

          {/* 9. USERS & CONTACTS */}
          {activeModule === 'users_redeem' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Daftar Pengguna ({usersData?.users.length ?? 0})</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {usersData?.users.map((u) => (
                    <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">{u.display_name} <span className="font-mono text-xs text-slate-400">+{u.phone}</span></div>
                        <div className="text-slate-500 tabular-nums">
                          Balance: {u.balance} · EXP: {u.exp} (Lv.{u.level}) · Limit: {u.daily_limit} · Streak: {u.streak ?? 0} · {u.is_premium ? 'Premium' : 'Reguler'}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/users/${u.phone}`, { method: 'PATCH', body: JSON.stringify({ deltaBalance: 100 }) });
                            void loadModuleData('users_redeem');
                          }}
                          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700"
                        >
                          +100 Bal
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/users/${u.phone}`, { method: 'PATCH', body: JSON.stringify({ is_banned: !u.is_banned }) });
                            void loadModuleData('users_redeem');
                          }}
                          className={`px-2 py-1 rounded ${u.is_banned ? 'bg-rose-700 text-white' : 'border border-slate-300 dark:border-slate-700'}`}
                        >
                          {u.is_banned ? 'Unban' : 'Ban'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Kontak Terpantau ({usersData?.contacts.length ?? 0})</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-60 overflow-y-auto">
                  {(usersData?.contacts ?? []).length === 0 ? (
                    <p className="text-slate-500 py-2">Belum ada kontak tambahan tercatat.</p>
                  ) : (
                    usersData?.contacts.map((ct) => (
                      <div key={ct.phone} className="py-2 flex items-center justify-between gap-2">
                        <span className="font-medium">{ct.push_name || ct.phone}</span>
                        <span className="font-mono text-slate-400">+{ct.phone}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="text-xs text-slate-500">
                    Pengelolaan kode redeem, Reward Builder, Claim History, dan Analytics kini berada pada modul terpisah.
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveModule('redeem_management')}
                    className="w-full py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold"
                  >
                    Buka Platform Management → Redeem Management
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 9. GROUP & ANTI-SYSTEM */}
          {activeModule === 'groups' && (
            <div className="space-y-4">
              {groupsList.map((g) => {
                const anti = JSON.parse(g.anti_settings_json || '{}');
                return (
                  <div key={g.id} className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">{g.name}</h2>
                        <div className="text-xs font-mono text-slate-500">{g.id} · Anggota: {g.member_count} · {g.is_permanent ? 'Permanen' : g.is_rented ? 'Sewa Aktif' : 'Standar'}</div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/groups/${encodeURIComponent(g.id)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ is_rented: !g.is_rented }),
                          });
                          void loadModuleData('groups');
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                      >
                        Toggle Sewa
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                      {['antilink', 'antiluar', 'antikudeta', 'antibot', 'antigroupsw', 'antimentionsw'].map((key) => {
                        const cur = anti[key] || { enabled: false, mode: 'warn' };
                        return (
                          <div key={key} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                            <div className="font-semibold uppercase">{key}</div>
                            <button
                              type="button"
                              onClick={async () => {
                                const updated = { ...anti, [key]: { ...cur, enabled: !cur.enabled } };
                                await apiFetch(`/api/admin/groups/${encodeURIComponent(g.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ anti_settings_json: updated }),
                                });
                                void loadModuleData('groups');
                              }}
                              className={`w-full py-1 rounded text-[11px] font-semibold ${cur.enabled ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                            >
                              {cur.enabled ? 'ON' : 'OFF (Default)'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Bahasa Menu / Bot Grup</span>
                        <select
                          aria-label={`Bahasa menu grup ${g.name}`}
                          value={g.menu_language || ''}
                          onChange={async (e) => {
                            await apiFetch(`/api/admin/groups/${encodeURIComponent(g.id)}/languages`, {
                              method: 'PATCH',
                              body: JSON.stringify({ menu_language: e.target.value || null }),
                            });
                            void loadModuleData('groups');
                          }}
                          className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                        >
                          <option value="">Ikut Global</option>
                          <option value="id">Indonesia (Santai)</option>
                          <option value="en">English</option>
                          <option value="ja">日本語</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Bahasa AI / Nexara Grup</span>
                        <select
                          aria-label={`Bahasa AI grup ${g.name}`}
                          value={g.ai_language || ''}
                          onChange={async (e) => {
                            await apiFetch(`/api/admin/groups/${encodeURIComponent(g.id)}/languages`, {
                              method: 'PATCH',
                              body: JSON.stringify({ ai_language: e.target.value || null }),
                            });
                            void loadModuleData('groups');
                          }}
                          className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                        >
                          <option value="">Ikut Global</option>
                          <option value="id">Indonesia (Santai)</option>
                          <option value="en">English</option>
                          <option value="ja">日本語</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 10. AI CONFIGURATION & AGENT ORCHESTRATION */}
          {activeModule === 'ai_agents' && aiData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">AI Provider Configuration (Nexara Default)</h2>
                  {aiData.providers.map((p) => (
                    <div key={p.id} className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{p.name}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/ai/providers/${p.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: !p.enabled }),
                            });
                            void loadModuleData('ai_agents');
                          }}
                          className={`px-2.5 py-1 rounded font-semibold ${p.enabled ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                        >
                          {p.enabled ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </div>
                      <div className="text-slate-500">Persona: {p.persona_name} · Fallback: {p.fallback_provider_id}</div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      setAiTestOut('Menguji koneksi server-side @google/genai...');
                      const res = await apiFetch('/api/admin/ai/test', { method: 'POST', body: JSON.stringify({}) });
                      setAiTestOut(res.ok ? `Respons (${res.latencyMs}ms): ${res.text}` : `Status: ${res.error}`);
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                  >
                    Uji Provider Nexara (Gemini)
                  </button>
                  {aiTestOut && (
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                      {aiTestOut}
                    </div>
                  )}
                </div>

                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Multi-Agent Orchestration & Human Approval</h2>
                  <div className="space-y-2">
                    {aiData.agents.map((ag) => (
                      <div key={ag.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-sm">{ag.name}</div>
                          <div className="text-slate-500">{ag.role} · Guard: {ag.autonomy_guard}</div>
                        </div>
                        <span className="font-mono text-blue-700 dark:text-blue-400">Benchmark {ag.benchmark_score}%</span>
                      </div>
                    ))}
                  </div>
                  {aiData.approvals.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="text-xs font-semibold">Antrean Persetujuan Agen</div>
                      {aiData.approvals.map((ap) => (
                        <div key={ap.id} className="p-2.5 rounded border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{ap.action_title}</div>
                            <div className="text-slate-400">Status: {ap.status}</div>
                          </div>
                          {ap.status === 'pending' && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/admin/ai/approvals/${ap.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) });
                                  void loadModuleData('ai_agents');
                                }}
                                className="px-2 py-1 rounded bg-emerald-700 text-white"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/admin/ai/approvals/${ap.id}`, { method: 'POST', body: JSON.stringify({ decision: 'reject' }) });
                                  void loadModuleData('ai_agents');
                                }}
                                className="px-2 py-1 rounded bg-rose-700 text-white"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                    <div className="font-semibold">Uji AI Agent dengan Guardrail Keamanan</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={agentPromptInput}
                        onChange={(e) => setAgentPromptInput(e.target.value)}
                        placeholder="Tugas aman untuk agent (mis. Ringkas jadwal theater terbaru)"
                        className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const targetAgent = aiData.agents[0]?.id || 'coordinator';
                          const res = await apiFetch(`/api/admin/ai/agents/${encodeURIComponent(targetAgent)}/run`, {
                            method: 'POST',
                            body: JSON.stringify({ prompt: agentPromptInput, riskLevel: 'low' }),
                          });
                          setAgentRunOut(res.ok ? res.text : res.error || 'Ditolak guardrail.');
                        }}
                        className="px-3 py-1.5 rounded bg-blue-700 text-white font-semibold"
                      >
                        Jalankan Agent
                      </button>
                    </div>
                    {agentRunOut && (
                      <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 whitespace-pre-wrap">
                        {agentRunOut}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 11. PLUGINS & AUTOMATION */}
          {activeModule === 'plugins_auto' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Plugin Manager &amp; Dependencies</h2>
                {pluginsList.map((pl) => (
                  <div key={pl.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm">{pl.name} <span className="font-mono text-xs text-slate-400">v{pl.version}</span></div>
                        <div className="text-slate-500">{pl.description}</div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/plugins/${pl.id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled: !pl.enabled }) });
                          void loadModuleData('plugins_auto');
                        }}
                        className={`px-3 py-1.5 rounded font-semibold shrink-0 ${pl.enabled ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                      >
                        {pl.enabled ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </div>
                    {pl.documentation && <div className="text-[11px] text-slate-600 dark:text-slate-400">Docs: {pl.documentation}</div>}
                    {pl.dependencies_json && pl.dependencies_json !== '[]' && (
                      <div className="font-mono text-[11px] text-slate-500">Dependencies: {pl.dependencies_json}</div>
                    )}
                    {pl.last_error && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400">Error terakhir: {pl.last_error}</div>
                    )}
                  </div>
                ))}
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Automation Workflow &amp; Retry</h2>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2 text-xs">
                  <div className="font-semibold">Tambah Workflow Otomatisasi</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={autoNameInput}
                      onChange={(e) => setAutoNameInput(e.target.value)}
                      placeholder="Nama workflow"
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <input
                      type="text"
                      value={autoCronInput}
                      onChange={(e) => setAutoCronInput(e.target.value)}
                      placeholder="Cron (mis. 0 * * * *)"
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                    <select
                      aria-label="Tipe aksi otomatisasi"
                      value={autoActionType}
                      onChange={(e) => setAutoActionType(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="system_note">Catat Log Sistem</option>
                      <option value="cleanup_logs">Bersihkan Log Kadaluwarsa</option>
                      <option value="webhook">Webhook HTTPS (Anti-SSRF)</option>
                    </select>
                    <input
                      type="text"
                      value={autoTargetInput}
                      onChange={(e) => setAutoTargetInput(e.target.value)}
                      placeholder={autoActionType === 'webhook' ? 'https://example.com/hook' : 'Catatan aksi'}
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await apiFetch('/api/admin/automations', {
                        method: 'POST',
                        body: JSON.stringify({
                          name: autoNameInput,
                          cron_expr: autoCronInput,
                          action: {
                            type: autoActionType,
                            ...(autoActionType === 'webhook' ? { url: autoTargetInput } : { note: autoTargetInput }),
                          },
                          max_retries: 2,
                        }),
                      });
                      setAutoFeedback(res?.ok ? 'Workflow tersimpan.' : res?.error || 'Gagal menyimpan workflow.');
                      if (res?.ok) {
                        setAutoNameInput('');
                        setAutoTargetInput('');
                      }
                      void loadModuleData('plugins_auto');
                    }}
                    className="px-3 py-1.5 rounded bg-blue-700 text-white font-semibold"
                  >
                    Simpan Workflow
                  </button>
                  {autoFeedback && <div className="text-blue-700 dark:text-blue-400">{autoFeedback}</div>}
                </div>

                {autoData?.automations.map((au) => (
                  <div key={au.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm">{au.name}</div>
                        <div className="font-mono text-slate-500">Cron: {au.cron_expr} · Run: {au.run_count}x · Retry max: {au.max_retries ?? 2}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const r = await apiFetch(`/api/admin/automations/${au.id}/run`, { method: 'POST' });
                            setAutoFeedback(r?.summary || (r?.ok ? 'Berhasil dijalankan.' : 'Gagal dijalankan.'));
                            void loadModuleData('plugins_auto');
                          }}
                          className="px-2.5 py-1 rounded bg-blue-700 text-white font-semibold"
                        >
                          Jalankan
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/automations/${au.id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled: !au.enabled }) });
                            void loadModuleData('plugins_auto');
                          }}
                          className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700"
                        >
                          {au.enabled ? 'Pause' : 'Resume'}
                        </button>
                      </div>
                    </div>
                    {au.last_error && <div className="text-[11px] text-rose-600">Error: {au.last_error}</div>}
                  </div>
                ))}

                {Array.isArray(autoData?.history) && autoData.history.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                    <div className="font-semibold">Riwayat Eksekusi Terbaru</div>
                    <div className="max-h-36 overflow-y-auto space-y-1">
                      {autoData.history.slice(0, 8).map((h: any) => (
                        <div key={h.id} className="p-2 rounded bg-slate-50 dark:bg-slate-950 font-mono text-[11px] flex justify-between gap-2">
                          <span className="truncate">{h.automation_id} ({h.status}, try {h.attempt_count ?? 1}x): {h.output_summary}</span>
                          <span className="text-slate-400 shrink-0">{h.started_at}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 11b. MULTILINGUAL TRANSLATIONS & 13 BOT MODULES HONEST AUDIT */}
          {activeModule === 'languages_modules' && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Audit Jujur 13 Modul Inti Bot</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  {modulesAuditList.map((m: any) => (
                    <div key={m.id} className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{m.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                            m.status === 'operational'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : m.status === 'partial'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {m.status}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">{m.summary}</p>
                      <div className="text-[11px] font-mono text-slate-500">Dependency: {m.dependencies}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Translation Override &amp; Review Nonbaku</h2>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                  <input
                    type="text"
                    value={trKeyInput}
                    onChange={(e) => setTrKeyInput(e.target.value)}
                    placeholder="Key (mis. greeting.welcome)"
                    className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                  />
                  <select
                    aria-label="Bahasa terjemahan"
                    value={trLangInput}
                    onChange={(e) => setTrLangInput(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="id">ID (Santai Nonbaku)</option>
                    <option value="en">EN</option>
                    <option value="ja">JA</option>
                  </select>
                  <input
                    type="text"
                    value={trTextInput}
                    onChange={(e) => setTrTextInput(e.target.value)}
                    placeholder="Teks terjemahan"
                    className="sm:col-span-2 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!trKeyInput.trim() || !trTextInput.trim()) return;
                    await apiFetch('/api/admin/translations', {
                      method: 'POST',
                      body: JSON.stringify({ key: trKeyInput.trim(), lang: trLangInput, text: trTextInput.trim() }),
                    });
                    setTrKeyInput('');
                    setTrTextInput('');
                    void loadModuleData('languages_modules');
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                >
                  Simpan Entri Terjemahan
                </button>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto text-xs">
                  {translationsList.map((tr) => (
                    <div key={tr.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">[{tr.lang}] {tr.key}</span>
                        <div className="text-slate-600 dark:text-slate-300">{tr.text}</div>
                        <div className="text-[11px] text-slate-400">Status: {tr.review_status}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/translations/${encodeURIComponent(tr.id)}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ action: 'review', status: 'approved' }),
                            });
                            void loadModuleData('languages_modules');
                          }}
                          className="px-2 py-1 rounded bg-emerald-700 text-white font-semibold"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/translations/${encodeURIComponent(tr.id)}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ action: 'review', status: 'rejected' }),
                            });
                            void loadModuleData('languages_modules');
                          }}
                          className="px-2 py-1 rounded bg-rose-700 text-white font-semibold"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 12. FILE MANAGER */}
          {activeModule === 'files' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Buat / Unggah File Aman (.txt/.json/.md/.csv/.log)</h2>
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <textarea
                  rows={5}
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full p-3 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/admin/files', {
                      method: 'POST',
                      body: JSON.stringify({ filename: newFileName, content: newFileContent }),
                    });
                    void loadModuleData('files');
                  }}
                  className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                >
                  Simpan File
                </button>
              </div>
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Daftar File ({filesList.length})</h2>
                {filesList.map((f) => (
                  <div key={f.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-mono">{f.filename} ({f.size_bytes} B)</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const d = await apiFetch(`/api/admin/files/${encodeURIComponent(f.filename)}`);
                          if (d.ok) setFilePreview(d.content);
                        }}
                        className="text-blue-700 dark:text-blue-400"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/files/${encodeURIComponent(f.filename)}`, { method: 'DELETE' });
                          void loadModuleData('files');
                        }}
                        className="text-rose-600"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
                {filePreview !== null && (
                  <pre className="p-3 rounded-lg bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">{filePreview}</pre>
                )}
              </div>
            </div>
          )}

          {/* 13. LOGS & TERMINAL CONSOLE */}
          {activeModule === 'logs_console' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Admin Console (Strict Allowlist)</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={consoleCmd}
                    onChange={(e) => setConsoleCmd(e.target.value)}
                    placeholder="help | status | prefixes | audit:summary | db:tables | health"
                    className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const d = await apiFetch('/api/admin/console', { method: 'POST', body: JSON.stringify({ command: consoleCmd }) });
                      setConsoleOutput(d.output || d.error);
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                  >
                    Jalankan
                  </button>
                </div>
                <pre className="p-4 rounded-lg bg-slate-950 text-slate-100 text-xs font-mono max-h-72 overflow-y-auto whitespace-pre-wrap">
                  {consoleOutput}
                </pre>
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Audit Log & System Events</h2>
                <div className="space-y-2 max-h-80 overflow-y-auto text-xs">
                  {logsData?.audits.map((a) => (
                    <div key={a.id} className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                      <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">{a.action}</span> → {a.target}
                      <div className="text-slate-400">{a.actor} · {a.created_at}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 14. BACKUP & SETTINGS (Blue Tick Control, Maintenance Mode, Encrypted Backup) */}
          {activeModule === 'backups_settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Pengaturan Sistem & Kontrol WhatsApp</h2>
                {settingsList
                  .filter((s) => ['blue_tick_enabled', 'maintenance_mode', 'auto_nexara', 'antidelete_pc', 'multi_room_concurrent'].includes(s.key))
                  .map((s) => (
                    <div key={s.key} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-mono font-semibold">{s.key}</div>
                        <div className="text-slate-500">
                          {s.key === 'blue_tick_enabled'
                            ? 'Blue Tick Control WhatsApp (centang biru read receipt)'
                            : s.key === 'maintenance_mode'
                            ? 'Mode Pemeliharaan (cuma owner yang bisa pakai bot)'
                            : s.key === 'auto_nexara'
                            ? 'Auto-reply AI Nexara terkonfigurasi'
                            : s.key === 'antidelete_pc'
                            ? 'Notifikasi penghapusan pesan private yang tersedia secara sah'
                            : 'Izinkan beberapa room game bersamaan'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = s.value === 'true' ? 'false' : 'true';
                          await apiFetch('/api/admin/settings', {
                            method: 'PATCH',
                            body: JSON.stringify({ updates: { [s.key]: next } }),
                          });
                          void loadModuleData('backups_settings');
                        }}
                        className={`px-3 py-1.5 rounded font-semibold ${s.value === 'true' ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
                      >
                        {s.value === 'true' ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}

                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">Bahasa Terpisah: Menu/Bot vs AI Nexara</div>
                    <div className="text-slate-500">
                      Mengubah bahasa AI nggak akan mengubah bahasa Menu/Bot, dan sebaliknya. Bahasa Indonesia selalu pakai gaya santai nonbaku.
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="font-semibold mb-1.5">Bahasa Global Menu &amp; Bot</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(['id', 'en', 'ja'] as const).map((code) => {
                          const cur = settingsList.find((s) => s.key === 'menu_language')?.value || 'id';
                          return (
                            <button
                              key={`menu-${code}`}
                              type="button"
                              onClick={async () => {
                                await apiFetch('/api/admin/settings', {
                                  method: 'PATCH',
                                  body: JSON.stringify({ updates: { menu_language: code, default_language: code, language_style: 'santai_nonbaku' } }),
                                });
                                void loadModuleData('backups_settings');
                              }}
                              className={`px-2.5 py-1 rounded font-semibold border ${cur === code ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 dark:border-slate-700'}`}
                            >
                              {code.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1.5">Bahasa Global AI / Nexara</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(['id', 'en', 'ja'] as const).map((code) => {
                          const cur = settingsList.find((s) => s.key === 'ai_language')?.value || 'id';
                          return (
                            <button
                              key={`ai-${code}`}
                              type="button"
                              onClick={async () => {
                                await apiFetch('/api/admin/settings', {
                                  method: 'PATCH',
                                  body: JSON.stringify({ updates: { ai_language: code } }),
                                });
                                void loadModuleData('backups_settings');
                              }}
                              className={`px-2.5 py-1 rounded font-semibold border ${cur === code ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 dark:border-slate-700'}`}
                            >
                              {code.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Owner Profile & Passcode Rotation */}
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                  <div className="font-bold text-slate-900 dark:text-white">Identitas Owner (#owner) &amp; Ganti Passcode</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={ownerNameInput}
                      onChange={(e) => setOwnerNameInput(e.target.value)}
                      placeholder="Nama owner (mis. Pak Ujan)"
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <input
                      type="text"
                      value={ownerNumInput}
                      onChange={(e) => setOwnerNumInput(e.target.value)}
                      placeholder="Nomor WhatsApp owner (mis. 62812...)"
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const updates: Record<string, string> = {};
                      if (ownerNameInput.trim()) updates.owner_name_configured = ownerNameInput.trim();
                      if (ownerNumInput.trim()) updates.owner_number_configured = ownerNumInput.trim();
                      await apiFetch('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ updates }) });
                      setOwnerNumInput('');
                      setSettingsFeedback('Profil owner disimpan (nomor disamarkan).');
                      void loadModuleData('backups_settings');
                    }}
                    className="px-3 py-1.5 rounded bg-blue-700 text-white font-semibold"
                  >
                    Simpan Nomor &amp; Nama Owner
                  </button>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="password"
                      value={curPassInput}
                      onChange={(e) => setCurPassInput(e.target.value)}
                      placeholder="Passcode lama"
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <input
                      type="password"
                      value={newPassInput}
                      onChange={(e) => setNewPassInput(e.target.value)}
                      placeholder="Passcode baru (min 6)"
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await apiFetch('/api/admin/auth/change-passcode', {
                          method: 'POST',
                          body: JSON.stringify({ currentPasscode: curPassInput, newPasscode: newPassInput }),
                        });
                        setCurPassInput('');
                        setNewPassInput('');
                        setSettingsFeedback(r?.message || r?.error || 'Selesai.');
                      }}
                      className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 font-semibold"
                    >
                      Ganti Passcode
                    </button>
                  </div>
                  {settingsFeedback && <div className="text-blue-700 dark:text-blue-400">{settingsFeedback}</div>}
                </div>
              </div>

              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">Backup Terenkripsi (AES-256-GCM)</h2>
                    <p className="text-[11px] text-slate-500">
                      {backupStatus?.hasEnvEncryptionKey
                        ? 'Menggunakan BACKUP_ENCRYPTION_KEY dari environment server.'
                        : 'BACKUP_ENCRYPTION_KEY belum disetel di server; masukkan passphrase manual minimal 12 karakter.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setBackupFeedback(null);
                      const res = await apiFetch('/api/admin/backups/create', {
                        method: 'POST',
                        body: JSON.stringify({ passphrase: backupPassphrase || undefined }),
                      });
                      setBackupFeedback(res?.ok ? `Backup ${res.filename} dibuat.` : res?.error || 'Gagal membuat backup.');
                      void loadModuleData('backups_settings');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold"
                  >
                    Buat Backup Baru
                  </button>
                </div>

                {!backupStatus?.hasEnvEncryptionKey && (
                  <input
                    type="password"
                    value={backupPassphrase}
                    onChange={(e) => setBackupPassphrase(e.target.value)}
                    placeholder="Passphrase enkripsi/dekripsi backup (min 12 karakter)"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                  />
                )}

                {backupFeedback && (
                  <div className="p-2.5 rounded-lg border border-blue-200 bg-blue-50/70 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-300">
                    {backupFeedback}
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  {backupsList.length === 0 ? (
                    <p className="text-slate-500">Belum ada file backup dibuat.</p>
                  ) : (
                    backupsList.map((b) => (
                      <div key={b.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-mono font-semibold">{b.filename}</div>
                            <div className="text-slate-500">Ukuran: {b.size_bytes} B · SHA256: {b.checksum.slice(0, 16)}...</div>
                            <div className="text-slate-400">{b.created_at}</div>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await apiFetch(`/api/admin/backups/${b.id}/verify`, {
                                  method: 'POST',
                                  body: JSON.stringify({ passphrase: backupPassphrase || undefined }),
                                });
                                setBackupFeedback(
                                  res?.ok
                                    ? `Verifikasi OK (${res.filename}): ${res.counts?.commands ?? 0} command, ${res.counts?.settings ?? 0} settings.`
                                    : res?.error || 'Verifikasi gagal.',
                                );
                              }}
                              className="px-2.5 py-1 rounded border border-blue-600 text-blue-700 dark:text-blue-400 font-semibold"
                            >
                              Verify SHA-256
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRestoreConfirmId(restoreConfirmId === b.id ? null : b.id);
                                setRestoreConfirmText('');
                              }}
                              className="px-2.5 py-1 rounded border border-rose-400 text-rose-700 dark:text-rose-400 font-semibold"
                            >
                              Restore
                            </button>
                          </div>
                        </div>

                        {restoreConfirmId === b.id && (
                          <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 space-y-2">
                            <div className="font-semibold text-rose-800 dark:text-rose-300">
                              Konfirmasi Ganda Restore: Ketik <code className="font-mono">RESTORE</code> (snapshot keamanan otomatis dibuat sebelum restore).
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={restoreConfirmText}
                                onChange={(e) => setRestoreConfirmText(e.target.value)}
                                placeholder="Ketik RESTORE"
                                className="flex-1 px-2.5 py-1 rounded border border-rose-300 bg-white dark:bg-slate-900 font-mono"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await apiFetch(`/api/admin/backups/${b.id}/restore`, {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      confirm: true,
                                      confirmText: restoreConfirmText,
                                      passphrase: backupPassphrase || undefined,
                                    }),
                                  });
                                  setBackupFeedback(
                                    res?.ok
                                      ? `Restore sukses dari ${res.restoredFrom}. Snapshot aman: ${res.safetyBackup}`
                                      : res?.error || 'Restore gagal.',
                                  );
                                  setRestoreConfirmId(null);
                                  void loadModuleData('backups_settings');
                                }}
                                className="px-3 py-1 rounded bg-rose-700 text-white font-semibold"
                              >
                                Jalankan Restore
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
