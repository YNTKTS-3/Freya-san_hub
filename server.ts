import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { generateInventoryAudit } from './src/core/commandInventory';
import { parseFolioText } from './src/core/folioParser';
import { maskPhoneNumberForGroup } from './src/core/gameRules';
import { researchOfficial48GroupSource, runNexaraAiQuery } from './src/server/aiService';
import {
  addAuditLog,
  addSystemLog,
  applyUserBalanceAndExp,
  createSessionToken,
  db,
  hashPasscode,
  isOwnerAuthConfigured,
  verifyOwnerCredentials,
  verifySessionToken,
} from './src/server/db';
import { expireStaleSessions, getMaxQuizWrongAttempts, startGameSession, submitGameAction } from './src/server/gameEngine';
import { validatePairingPhoneNumber, whatsappEngine } from './src/server/whatsappEngine';
import { JKT48_TEAM_GROUPS } from './src/core/jkt48Classification';
import {
  createRedeemCode,
  deleteRedeemCode,
  executeRedeemClaim,
  getClaimHistory,
  getRedeemAnalytics,
  getRedeemDetail,
  getRedeemSettings,
  listRedeemCodes,
  listRewardRegistry,
  resetRedeemClaims,
  toggleRedeemCode,
  updateRedeemCode,
  updateRedeemSettings,
} from './src/server/redeemService';
import {
  getAbuseDashboardState,
  setAbuseRestrictionAction,
  updateAbuseConfig,
} from './src/server/abuseService';
import {
  getBomConfig,
  getLimitConfig,
  setUserPremiumStatus,
  updateBomConfig,
  updateLimitConfig,
} from './src/server/economyService';
import { getStreakSettings, setGroupStreakEnabled } from './src/server/streakService';
import {
  convertMediaToLivePhotoBundle,
  convertStickerAudioBundle,
  generateMediaPipelineSample,
  listRecentMediaJobs,
  updateMediaJobDelivery,
} from './src/server/mediaService';
import { buildMotionPhotoProtoPair, buildSoundStickerProtoPayload } from './src/server/waMediaProtocol';
import { listMenuFallbackLogs } from './src/server/menuService';

const PORT = Number(process.env.PORT) || 3000;
const FILES_BASE_DIR = path.resolve(process.cwd(), 'data', 'files');
const BACKUPS_BASE_DIR = path.resolve(process.cwd(), 'data', 'backups');
for (const dir of [FILES_BASE_DIR, BACKUPS_BASE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Simple in-memory rate limiter per IP
const rateMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxPerMin: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'local';
    const now = Date.now();
    const rec = rateMap.get(ip);
    if (!rec || rec.resetAt < now) {
      rateMap.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (rec.count >= maxPerMin) {
      return res.status(429).json({ ok: false, error: 'Terlalu banyak permintaan, coba beberapa saat lagi.' });
    }
    rec.count += 1;
    return next();
  };
}

function requireOwnerAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
  const verified = verifySessionToken(token);
  if (!verified.valid || verified.role !== 'owner') {
    return res.status(401).json({ ok: false, error: 'Autentikasi owner diperlukan.' });
  }
  return next();
}

function safeResolveInBase(baseDir: string, targetName: string): string | null {
  const cleaned = path.basename(targetName);
  const resolved = path.resolve(baseDir, cleaned);
  if (!resolved.startsWith(baseDir + path.sep)) return null;
  return resolved;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Baseline security headers (no X-Frame-Options to preserve AI Studio iFrame preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcastEvent = (eventType: string, payload: unknown) => {
    const packet = JSON.stringify({ eventType, payload, ts: new Date().toISOString() });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(packet);
      }
    });
  };

  whatsappEngine.setBroadcaster(broadcastEvent);

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        eventType: 'wa:status',
        payload: whatsappEngine.getStatus(),
        ts: new Date().toISOString(),
      }),
    );
  });

  // ------------------------------------------------------------------
  // 1. HEALTH & PUBLIC PORTAL API (Zero owner secrets or owner commands)
  // ------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    const dbCheck = db.prepare('SELECT 1 as ok').get() as { ok: number };
    const waStatus = whatsappEngine.getStatus();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    res.json({
      ok: true,
      project: 'Freya-san Hub',
      version: '5.0',
      components: [
        { name: 'Backend API', status: 'operational', detail: 'Express + TypeScript aktif pada port 3000' },
        { name: 'Database Terpusat', status: dbCheck.ok === 1 ? 'operational' : 'error', detail: 'SQLite WAL mode dengan transaksi penuh' },
        { name: 'WhatsApp Engine', status: waStatus.status, detail: `Library @whiskeysockets/baileys (${waStatus.status})` },
        { name: 'AI Provider (Nexara)', status: geminiConfigured ? 'operational' : 'unconfigured', detail: geminiConfigured ? 'Gemini 4 Hydrogen siap' : 'GEMINI_API_KEY belum diatur di Secrets' },
        { name: 'Downloader Provider', status: 'pending_integration', detail: 'Adapter modular siap menunggu konfigurasi layanan eksternal' },
        { name: 'Automation Scheduler', status: 'operational', detail: '4 tugas terjadwal aktif' },
        { name: '48Group Intelligence', status: 'operational', detail: 'Database terverifikasi + alur persetujuan owner' },
      ],
      system: {
        uptimeSec: Math.floor(process.uptime()),
        memoryUsedMb: Math.round((totalMem - freeMem) / 1024 / 1024),
        memoryTotalMb: Math.round(totalMem / 1024 / 1024),
        cpuLoad1m: Number(os.loadavg()[0].toFixed(2)),
        nodeVersion: process.version,
      },
    });
  });

  app.get('/api/public/overview', (_req, res) => {
    const prefixes = db
      .prepare('SELECT prefix, is_default, enabled, usage_count FROM prefixes WHERE enabled = 1 ORDER BY sort_order ASC')
      .all();
    const cmdCounts = db
      .prepare('SELECT COUNT(*) as total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM commands WHERE is_owner_only = 0')
      .get() as { total: number; active: number };
    const totalAllCmds = (db.prepare('SELECT COUNT(*) as c FROM commands').get() as { c: number }).c;
    const stats48 = {
      groups: (db.prepare("SELECT COUNT(*) as c FROM forty_eight_groups WHERE validation_status = 'official_verified'").get() as { c: number }).c,
      members: (db.prepare("SELECT COUNT(*) as c FROM forty_eight_members WHERE validation_status = 'official_verified'").get() as { c: number }).c,
      questions: (db.prepare("SELECT COUNT(*) as c FROM forty_eight_questions WHERE validation_status = 'official_verified'").get() as { c: number }).c,
      theater: (db.prepare("SELECT COUNT(*) as c FROM forty_eight_theater WHERE validation_status = 'official_verified'").get() as { c: number }).c,
    };
    const changelog = [
      {
        version: '5.0.0',
        date: '2026-11-23',
        title: 'Arsitektur Baru Freya-san Hub + 48Group Center & Game Engine Terintegrasi',
        highlights: [
          'Penyatuan 10 prefix aktif sejak instalasi awal dengan dukungan spasi & tanpa spasi.',
          '48Group Intelligence Center & Game Center dengan verifikasi sumber resmi.',
          'Pemisahan penuh aktivitas permainan Private Chat vs Group Chat.',
          'Multi-provider AI Nexara server-side dan kontrol privasi/keamanan berlapis.',
        ],
      },
    ];

    res.json({
      ok: true,
      projectName: 'Freya-san Hub',
      botName: 'Freya-san bot by Pak Ujan',
      version: '5.0',
      prefixes,
      publicCommandCount: cmdCounts.total,
      activePublicCommandCount: cmdCounts.active,
      totalRegistryCount: totalAllCmds,
      stats48,
      waStatus: whatsappEngine.getStatus().status,
      changelog,
    });
  });

  // Public Command Explorer strictly excludes is_owner_only commands
  app.get('/api/public/commands', (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || 'ALL').toUpperCase();
    const statusFilter = String(req.query.status || 'ALL').toLowerCase();

    const rows = db
      .prepare(`
        SELECT c.name, c.category, c.description, c.example, c.permission, c.status, c.enabled,
               c.cooldown_sec, c.daily_limit, c.required_provider, c.required_plugin, c.has_real_handler,
               GROUP_CONCAT(a.alias, ',') as aliases_csv
        FROM commands c
        LEFT JOIN command_aliases a ON a.command_name = c.name
        WHERE c.is_owner_only = 0
        GROUP BY c.name
        ORDER BY c.category ASC, c.name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const filtered = rows.filter((r) => {
      if (category !== 'ALL' && r.category !== category) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search) {
        const hay = `${r.name} ${r.description} ${r.aliases_csv || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ ok: true, commands: filtered });
  });

  // ------------------------------------------------------------------
  // 2. 48GROUP CENTER API (Public Verified Read + Quiz Play)
  // ------------------------------------------------------------------
  app.get('/api/48group/intelligence', (_req, res) => {
    const groups = db.prepare("SELECT * FROM forty_eight_groups WHERE validation_status = 'official_verified' ORDER BY founded_year ASC").all();
    const generations = db.prepare("SELECT * FROM forty_eight_generations WHERE validation_status = 'official_verified' ORDER BY debut_year ASC").all();
    const members = db.prepare("SELECT * FROM forty_eight_members WHERE validation_status = 'official_verified' ORDER BY group_id ASC, name ASC").all();
    const discography = db.prepare("SELECT * FROM forty_eight_discography WHERE validation_status = 'official_verified' ORDER BY release_date DESC").all();
    const theater = db.prepare("SELECT * FROM forty_eight_theater WHERE validation_status = 'official_verified'").all();
    const events = db.prepare("SELECT * FROM forty_eight_events WHERE validation_status = 'official_verified'").all();
    const terminology = db.prepare("SELECT * FROM forty_eight_terminology WHERE validation_status = 'official_verified'").all();
    const sources = db.prepare('SELECT * FROM forty_eight_sources ORDER BY group_id ASC').all();
    const history = db.prepare('SELECT * FROM forty_eight_change_history ORDER BY id DESC LIMIT 25').all();
    const eras = db.prepare('SELECT * FROM jkt48_eras ORDER BY level_order ASC').all();
    const teams = db.prepare('SELECT * FROM jkt48_teams ORDER BY sort_order ASC').all();
    const teamHistory = db.prepare('SELECT * FROM jkt48_member_team_history ORDER BY member_id ASC').all();

    res.json({
      ok: true,
      groups,
      generations,
      members,
      discography,
      theater,
      events,
      terminology,
      sources,
      history,
      eras,
      teamGroups: JKT48_TEAM_GROUPS,
      teams,
      teamHistory,
    });
  });

  app.get('/api/48group/difficulty-explorer', (req, res) => {
    const levelId = String(req.query.levelId || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const memberStatus = String(req.query.status || 'all').trim();
    const generationFilter = String(req.query.generation || 'all').trim();
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10) || 10));

    const eras = db.prepare('SELECT * FROM jkt48_eras ORDER BY level_order ASC').all() as any[];

    if (!levelId) {
      const levels = eras.map((era) => {
        const memberCount = (
          db
            .prepare(`SELECT COUNT(*) as c FROM forty_eight_members WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?)`)
            .get(era.id, era.id) as { c: number }
        ).c;
        const discoCount = (
          db
            .prepare(`SELECT COUNT(*) as c FROM forty_eight_discography WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?)`)
            .get(era.id, era.id) as { c: number }
        ).c;
        const theaterCount = (
          db
            .prepare(`SELECT COUNT(*) as c FROM forty_eight_theater WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?)`)
            .get(era.id, era.id) as { c: number }
        ).c;
        const questionCount = (
          db
            .prepare(`SELECT COUNT(*) as c FROM forty_eight_questions WHERE validation_status = 'official_verified' AND enabled = 1 AND (difficulty_level = ? OR era_id = ?)`)
            .get(era.id, era.id) as { c: number }
        ).c;

        return {
          ...era,
          counts: { members: memberCount, discography: discoCount, theater: theaterCount, questions: questionCount },
        };
      });
      return res.json({ ok: true, levels });
    }

    const era = eras.find((e) => e.id === levelId);
    if (!era) {
      return res.status(404).json({ ok: false, error: 'Level era JKT48 nggak ketemu.' });
    }

    let members = db
      .prepare(`SELECT * FROM forty_eight_members WHERE group_id = 'jkt48' AND validation_status = 'official_verified' AND (difficulty_level = ? OR era_id = ?) ORDER BY name ASC`)
      .all(levelId, levelId) as any[];

    const availableGenerations = Array.from(new Set(members.map((m) => String(m.generation)))).sort();

    if (memberStatus !== 'all') {
      const stLow = memberStatus.toLowerCase();
      members = members.filter((m) => String(m.status).toLowerCase().includes(stLow));
    }
    if (generationFilter !== 'all') {
      members = members.filter((m) => m.generation === generationFilter);
    }
    if (search) {
      members = members.filter((m) =>
        `${m.name} ${m.nickname} ${m.generation} ${m.bio}`.toLowerCase().includes(search),
      );
    }

    const totalMembers = members.length;
    const offset = (page - 1) * pageSize;
    const pagedMembers = members.slice(offset, offset + pageSize);

    const discography = db
      .prepare(`SELECT * FROM forty_eight_discography WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?) ORDER BY release_date DESC`)
      .all(levelId, levelId);
    const theater = db
      .prepare(`SELECT * FROM forty_eight_theater WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?)`)
      .all(levelId, levelId);
    const events = db
      .prepare(`SELECT * FROM forty_eight_events WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?)`)
      .all(levelId, levelId);
    const generations = db
      .prepare(`SELECT * FROM forty_eight_generations WHERE group_id = 'jkt48' AND (difficulty_level = ? OR era_id = ?) ORDER BY debut_year ASC`)
      .all(levelId, levelId);
    const questionCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM forty_eight_questions WHERE validation_status = 'official_verified' AND enabled = 1 AND (difficulty_level = ? OR era_id = ?)`)
        .get(levelId, levelId) as { c: number }
    ).c;

    return res.json({
      ok: true,
      era,
      members: pagedMembers,
      totalMembers,
      page,
      pageSize,
      availableGenerations,
      generations,
      discography,
      theater,
      events,
      questionCount,
    });
  });

  app.get('/api/48group/team-explorer', (req, res) => {
    const groupId = String(req.query.group || '').trim().toLowerCase();
    const teamId = String(req.query.teamId || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const memberStatus = String(req.query.status || 'all').trim();
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 12) || 12));

    const allTeams = db.prepare('SELECT * FROM jkt48_teams ORDER BY sort_order ASC').all() as any[];

    if (!groupId && !teamId) {
      const groups = JKT48_TEAM_GROUPS.map((g) => {
        const teams = allTeams.filter((t) => t.team_group === g.id);
        return { ...g, teamCount: teams.length, teamsPreview: teams.map((t) => t.name) };
      });
      return res.json({ ok: true, teamGroups: groups });
    }

    if (groupId && !teamId) {
      const grp = JKT48_TEAM_GROUPS.find((g) => g.id === groupId);
      if (!grp) return res.status(404).json({ ok: false, error: 'Kategori group team nggak ketemu.' });
      const teams = allTeams
        .filter((t) => t.team_group === groupId)
        .map((t) => {
          const memberCount = (
            db
              .prepare(`SELECT COUNT(DISTINCT m.id) as c FROM forty_eight_members m LEFT JOIN jkt48_member_team_history h ON h.member_id = m.id WHERE m.primary_team_id = ? OR h.team_id = ?`)
              .get(t.id, t.id) as { c: number }
          ).c;
          return { ...t, memberCount };
        });
      return res.json({ ok: true, teamGroup: grp, teams });
    }

    const team = allTeams.find((t) => t.id === teamId);
    if (!team) return res.status(404).json({ ok: false, error: 'Team JKT48 nggak ketemu.' });

    let rows = db
      .prepare(`
        SELECT m.*, h.role_in_team, h.joined_at as team_joined_at, h.left_at as team_left_at, h.notes as team_notes
        FROM forty_eight_members m
        LEFT JOIN jkt48_member_team_history h ON h.member_id = m.id AND h.team_id = ?
        WHERE m.primary_team_id = ? OR h.team_id = ?
        GROUP BY m.id
        ORDER BY m.name ASC
      `)
      .all(team.id, team.id, team.id) as any[];

    if (memberStatus !== 'all') {
      const stLow = memberStatus.toLowerCase();
      rows = rows.filter((m) => String(m.status).toLowerCase().includes(stLow));
    }
    if (search) {
      rows = rows.filter((m) =>
        `${m.name} ${m.nickname} ${m.generation} ${m.role_in_team || ''}`.toLowerCase().includes(search),
      );
    }

    const totalMembers = rows.length;
    const pagedMembers = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((m) => {
      const transfers = db
        .prepare(`
          SELECT h.*, t.name as team_name
          FROM jkt48_member_team_history h
          JOIN jkt48_teams t ON t.id = h.team_id
          WHERE h.member_id = ?
          ORDER BY COALESCE(h.joined_at, '') ASC
        `)
        .all(m.id);
      return { ...m, teamTransfers: transfers };
    });

    const questionCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM forty_eight_questions WHERE validation_status = 'official_verified' AND enabled = 1 AND team_id = ?`)
        .get(team.id) as { c: number }
    ).c;

    return res.json({
      ok: true,
      team,
      members: pagedMembers,
      totalMembers,
      page,
      pageSize,
      questionCount,
    });
  });

  // ------------------------------------------------------------------
  // 3. GAME CENTER API (Both General & 48Group Games + Leaderboard)
  // ------------------------------------------------------------------
  app.get('/api/games/catalog', (_req, res) => {
    const games = db.prepare('SELECT * FROM game_settings ORDER BY domain ASC, name ASC').all();
    const leaderboardGeneral = db
      .prepare("SELECT display_name, game_id, SUM(score) as total_score, SUM(wins) as total_wins, SUM(games_played) as games_played FROM game_scores WHERE domain = 'general' GROUP BY user_phone ORDER BY total_score DESC LIMIT 10")
      .all();
    const leaderboard48 = db
      .prepare("SELECT display_name, game_id, SUM(score) as total_score, SUM(wins) as total_wins, SUM(games_played) as games_played FROM game_scores WHERE domain = '48group' GROUP BY user_phone ORDER BY total_score DESC LIMIT 10")
      .all();

    res.json({ ok: true, games, leaderboardGeneral, leaderboard48 });
  });

  app.post('/api/games/start', rateLimit(40), (req, res) => {
    const {
      gameId,
      playerName,
      playerPhone,
      chatScope,
      chatId,
      groupName,
      difficulty,
      difficultyLevel,
      eraId,
      teamId,
      generation,
    } = req.body ?? {};
    if (!gameId || typeof gameId !== 'string') {
      return res.status(400).json({ ok: false, error: 'gameId wajib diisi.' });
    }
    const cleanPhone = String(playerPhone || '6280000000001').replace(/\D/g, '') || '6280000000001';
    const cleanName = String(playerName || 'Pemain Web').trim().slice(0, 40) || 'Pemain Web';
    const scope = chatScope === 'group' ? 'group' : 'private';
    const resolvedChatId = String(chatId || (scope === 'group' ? 'web-room-group' : `web-private-${cleanPhone}`));

    const result = startGameSession({
      gameId,
      chatId: resolvedChatId,
      chatScope: scope,
      groupName: scope === 'group' ? String(groupName || 'Web Arena Group') : undefined,
      hostPhone: cleanPhone,
      hostName: cleanName,
      difficulty,
      difficultyLevel: typeof difficultyLevel === 'string' && difficultyLevel ? difficultyLevel : undefined,
      eraId: typeof eraId === 'string' && eraId ? eraId : undefined,
      teamId: typeof teamId === 'string' && teamId ? teamId : undefined,
      generation: typeof generation === 'string' && generation ? generation : undefined,
    });

    if (result.ok) {
      broadcastEvent('game:update', result.session);
    }
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/games/action', rateLimit(80), (req, res) => {
    const { sessionId, playerPhone, playerName, chatScope, chatId, input, actionType } = req.body ?? {};
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ ok: false, error: 'sessionId wajib diisi.' });
    }
    const cleanPhone = String(playerPhone || '6280000000001').replace(/\D/g, '') || '6280000000001';
    const cleanName = String(playerName || 'Pemain Web').trim().slice(0, 40) || 'Pemain Web';
    const scope = chatScope === 'group' ? 'group' : 'private';
    const resolvedChatId = String(chatId || (scope === 'group' ? 'web-room-group' : `web-private-${cleanPhone}`));

    const result = submitGameAction({
      sessionId,
      playerPhone: cleanPhone,
      playerName: cleanName,
      chatScope: scope,
      chatId: resolvedChatId,
      input: String(input || ''),
      actionType,
    });

    broadcastEvent('game:update', result);
    return res.json(result);
  });

  app.post('/api/tools/folio-preview', (req, res) => {
    const text = String(req.body?.text || '');
    const doc = parseFolioText(text);
    res.json({ ok: true, doc });
  });

  app.post('/api/public/redeem', rateLimit(15), (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const playerPhone = String(req.body?.playerPhone || '6280000000001').replace(/\D/g, '') || '6280000000001';
    const playerName = String(req.body?.playerName || 'Pengunjung Web').trim() || 'Pengunjung Web';
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : undefined;
    if (!code) return res.status(400).json({ ok: false, error: 'Kode redeem wajib diisi.' });

    const outcome = executeRedeemClaim({
      code,
      userPhone: playerPhone,
      displayName: playerName,
      idempotencyKey,
    });

    if (!outcome.ok) {
      return res.status(400).json({
        ok: false,
        status: outcome.status,
        error: outcome.message,
      });
    }

    return res.json({
      ok: true,
      status: outcome.status,
      code: outcome.code,
      message: outcome.message,
      rewardsGranted: outcome.rewardsGranted,
      user: outcome.userAfter,
    });
  });

  // ------------------------------------------------------------------
  // 4. OWNER AUTHENTICATION (First-run Claim or Env Passcode + Bearer Token)
  // ------------------------------------------------------------------
  app.get('/api/auth/status', (_req, res) => {
    const authState = isOwnerAuthConfigured();
    res.json({
      ok: true,
      needsFirstRunClaim: !authState.hasEnvPasscode && !authState.hasClaimedHash,
      usingEnvPasscode: authState.hasEnvPasscode,
    });
  });

  app.post('/api/auth/claim', rateLimit(10), (req, res) => {
    const authState = isOwnerAuthConfigured();
    if (authState.hasEnvPasscode || authState.hasClaimedHash) {
      return res.status(403).json({ ok: false, error: 'Akses owner udah diklaim. Login aja ya.' });
    }
    const passcode = String(req.body?.passcode || '');
    if (passcode.length < 6) {
      return res.status(400).json({ ok: false, error: 'Passcode owner minimal 6 karakter.' });
    }
    const hashed = hashPasscode(passcode);
    db.prepare(
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES ('owner_passcode_hash', ?, 1, datetime('now'))`,
    ).run(hashed);
    addAuditLog('owner', 'auth.first_run_claim', 'owner_console');
    const token = createSessionToken('owner');
    return res.json({ ok: true, token });
  });

  app.post('/api/auth/login', rateLimit(15), (req, res) => {
    const passcode = String(req.body?.passcode || '');
    if (!passcode) {
      return res.status(400).json({ ok: false, error: 'Passcode wajib diisi.' });
    }
    if (!verifyOwnerCredentials(passcode)) {
      addAuditLog('anonymous', 'auth.login_failed', 'owner_console');
      return res.status(401).json({ ok: false, error: 'Passcode owner tidak sesuai.' });
    }
    addAuditLog('owner', 'auth.login_success', 'owner_console');
    const token = createSessionToken('owner');
    return res.json({ ok: true, token });
  });

  app.get('/api/auth/verify', requireOwnerAuth, (_req, res) => {
    res.json({ ok: true, role: 'owner' });
  });

  // ------------------------------------------------------------------
  // 5. OWNER PROTECTED DASHBOARD APIs (/api/admin/*)
  // ------------------------------------------------------------------
  app.use('/api/admin', requireOwnerAuth);

  app.get('/api/admin/overview', (_req, res) => {
    expireStaleSessions();
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const totalGroups = (db.prepare('SELECT COUNT(*) as c FROM groups').get() as { c: number }).c;
    const cmdStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as inactive,
        SUM(usage_count) as total_calls,
        SUM(error_count) as total_errors
      FROM commands
    `).get() as Record<string, number>;
    const aiStats = db.prepare('SELECT COUNT(*) as calls, COALESCE(SUM(tokens_est), 0) as tokens FROM ai_usage').get() as { calls: number; tokens: number };
    const topCommands = db.prepare('SELECT name, category, usage_count, error_count FROM commands ORDER BY usage_count DESC LIMIT 5').all();
    const neverUsedCount = (db.prepare('SELECT COUNT(*) as c FROM commands WHERE usage_count = 0').get() as { c: number }).c;
    const pending48 = (db.prepare("SELECT COUNT(*) as c FROM forty_eight_verifications WHERE approval_status = 'pending'").get() as { c: number }).c;
    const activeGames = (db.prepare("SELECT COUNT(*) as c FROM game_sessions WHERE status IN ('active','waiting')").get() as { c: number }).c;
    const ownerPhone = whatsappEngine.getOwnerPhoneNormalized();

    res.json({
      ok: true,
      ownerPhone: `+${ownerPhone}`,
      wa: whatsappEngine.getStatus(),
      totalUsers,
      totalGroups,
      cmdStats,
      neverUsedCount,
      aiStats,
      topCommands,
      pending48,
      activeGames,
      system: {
        uptimeSec: Math.floor(process.uptime()),
        memoryUsedMb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
        memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
        cpuLoad1m: Number(os.loadavg()[0].toFixed(2)),
      },
    });
  });

  // Command Manager + Inventory Audit
  app.get('/api/admin/commands', (_req, res) => {
    const commands = db
      .prepare(`
        SELECT c.*, GROUP_CONCAT(a.alias, ',') as aliases_csv
        FROM commands c
        LEFT JOIN command_aliases a ON a.command_name = c.name
        GROUP BY c.name
        ORDER BY c.category ASC, c.name ASC
      `)
      .all();
    const audit = generateInventoryAudit();
    res.json({ ok: true, commands, audit });
  });

  app.post('/api/admin/commands/toggle', (req, res) => {
    const { names, category, enabled } = req.body ?? {};
    const val = enabled ? 1 : 0;
    if (Array.isArray(names) && names.length > 0) {
      const stmt = db.prepare('UPDATE commands SET enabled = ? WHERE name = ?');
      db.transaction(() => {
        for (const n of names) stmt.run(val, String(n));
      })();
      addAuditLog('owner', 'command.bulk_toggle', `${names.length} commands`, { enabled: Boolean(enabled) });
      return res.json({ ok: true });
    }
    if (category && typeof category === 'string') {
      db.prepare('UPDATE commands SET enabled = ? WHERE category = ?').run(val, category);
      addAuditLog('owner', 'command.category_toggle', category, { enabled: Boolean(enabled) });
      return res.json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Target command atau kategori wajib diisi.' });
  });

  app.patch('/api/admin/commands/:name', (req, res) => {
    const name = req.params.name;
    const { permission, cooldown_sec, daily_limit, balance_reward, exp_reward, description, status } = req.body ?? {};
    db.prepare(`
      UPDATE commands
      SET permission = COALESCE(?, permission),
          cooldown_sec = COALESCE(?, cooldown_sec),
          daily_limit = COALESCE(?, daily_limit),
          balance_reward = COALESCE(?, balance_reward),
          exp_reward = COALESCE(?, exp_reward),
          description = COALESCE(?, description),
          status = COALESCE(?, status)
      WHERE name = ?
    `).run(permission ?? null, cooldown_sec ?? null, daily_limit ?? null, balance_reward ?? null, exp_reward ?? null, description ?? null, status ?? null, name);
    addAuditLog('owner', 'command.update', name, req.body);
    res.json({ ok: true });
  });

  // Prefix Manager
  app.get('/api/admin/prefixes', (_req, res) => {
    const prefixes = db.prepare('SELECT * FROM prefixes ORDER BY sort_order ASC').all();
    res.json({ ok: true, prefixes });
  });

  app.post('/api/admin/prefixes', (req, res) => {
    const { action, prefix, enabled } = req.body ?? {};
    if (action === 'add' && prefix) {
      db.prepare('INSERT OR REPLACE INTO prefixes (prefix, is_default, enabled, sort_order) VALUES (?, 0, 1, 99)').run(String(prefix).slice(0, 3));
      addAuditLog('owner', 'prefix.add', String(prefix));
    } else if (action === 'toggle' && prefix) {
      db.prepare('UPDATE prefixes SET enabled = ? WHERE prefix = ?').run(enabled ? 1 : 0, String(prefix));
      addAuditLog('owner', 'prefix.toggle', String(prefix), { enabled: Boolean(enabled) });
    } else if (action === 'delete' && prefix) {
      db.prepare('DELETE FROM prefixes WHERE prefix = ? AND is_default = 0').run(String(prefix));
      addAuditLog('owner', 'prefix.delete', String(prefix));
    } else if (action === 'reset') {
      db.transaction(() => {
        db.prepare('DELETE FROM prefixes WHERE is_default = 0').run();
        db.prepare('UPDATE prefixes SET enabled = 1 WHERE is_default = 1').run();
      })();
      addAuditLog('owner', 'prefix.reset', 'default_10');
    }
    const prefixes = db.prepare('SELECT * FROM prefixes ORDER BY sort_order ASC').all();
    res.json({ ok: true, prefixes });
  });

  // WhatsApp Connection & Simulator
  app.get('/api/admin/whatsapp/status', (_req, res) => {
    res.json({
      ok: true,
      status: whatsappEngine.getStatus(),
      history: whatsappEngine.listConnectionHistory(30),
    });
  });

  app.get('/api/admin/whatsapp/history', (req, res) => {
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 200) : 50;
    res.json({ ok: true, history: whatsappEngine.listConnectionHistory(limit) });
  });

  app.post('/api/admin/whatsapp/connect', async (req, res) => {
    const method = req.body?.method === 'pairing_code' ? 'pairing_code' : 'qr';
    const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : undefined;
    const result = await whatsappEngine.connect({ method, phoneNumber, actor: 'owner' });
    addAuditLog('owner', 'whatsapp.connect', method, {
      ok: result.ok,
      targetMasked: phoneNumber ? maskPhoneNumberForGroup(phoneNumber) : null,
    });
    if (!result.ok) {
      const code =
        result.status === 'connected' || result.message.includes('lagi berjalan') || result.message.includes('menunggu')
          ? 409
          : 400;
      return res.status(code).json({ ...result, error: result.message });
    }
    res.json(result);
  });

  app.post('/api/admin/whatsapp/pairing', async (req, res) => {
    const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber.trim() : '';
    if (!phoneNumber) {
      const msg = 'Masukin nomor WhatsApp dulu ya (pakai kode negara, misal 6281234567890).';
      return res.status(400).json({ ok: false, error: msg, message: msg });
    }
    const validation = validatePairingPhoneNumber(phoneNumber);
    const result = await whatsappEngine.connect({
      method: 'pairing_code',
      phoneNumber,
      actor: 'owner',
    });
    addAuditLog('owner', 'whatsapp.pairing', validation.normalized ? maskPhoneNumberForGroup(validation.normalized) : 'invalid', {
      ok: result.ok,
      pairingStatus: result.pairingStatus,
    });
    if (!result.ok) {
      const code =
        result.status === 'connected' || result.message.includes('lagi berjalan') || result.message.includes('menunggu')
          ? 409
          : 400;
      return res.status(code).json({ ...result, error: result.message });
    }
    res.json(result);
  });

  app.post('/api/admin/whatsapp/pairing/cancel', async (_req, res) => {
    const result = await whatsappEngine.cancelPairing('owner');
    addAuditLog('owner', 'whatsapp.pairing_cancel', 'primary', { ok: result.ok });
    if (!result.ok) {
      return res.status(409).json({ ...result, error: result.message });
    }
    res.json(result);
  });

  app.post('/api/admin/whatsapp/disconnect', async (_req, res) => {
    const result = await whatsappEngine.disconnect('owner');
    addAuditLog('owner', 'whatsapp.disconnect', 'primary', { ok: result.ok });
    if (!result.ok) {
      return res.status(409).json({ ...result, error: result.message });
    }
    res.json(result);
  });

  app.post('/api/admin/whatsapp/reset-connection', async (_req, res) => {
    const result = await whatsappEngine.resetConnection('owner');
    addAuditLog('owner', 'whatsapp.reset_connection', 'primary', {
      ok: result.ok,
      hasStoredAuth: result.hasStoredAuth,
    });
    if (!result.ok) {
      const code = result.message.includes('lagi berjalan') ? 409 : 400;
      return res.status(code).json({ ...result, error: result.message });
    }
    res.json(result);
  });

  app.post('/api/admin/whatsapp/reset-session', async (req, res) => {
    if (req.body?.confirm !== true) {
      const msg = 'Konfirmasi tambahan wajib dicentang sebelum reset sesi penuh ya.';
      return res.status(400).json({ ok: false, error: msg, message: msg });
    }
    const result = await whatsappEngine.resetFullSession({ confirm: true, actor: 'owner' });
    addAuditLog('owner', 'whatsapp.reset_session', 'primary', { ok: result.ok });
    if (!result.ok) {
      const code = result.message.includes('lagi berjalan') ? 409 : 400;
      return res.status(code).json({ ...result, error: result.message });
    }
    res.json(result);
  });

  app.post('/api/admin/whatsapp/simulate', express.json({ limit: '15mb' }), async (req, res) => {
    const {
      text,
      selectedRowId,
      chatScope,
      chatId,
      groupName,
      senderPhone,
      senderName,
      isGroupAdmin,
      mentions,
      quotedSenderPhone,
      quotedMediaKind,
      quotedMediaBase64,
      attachedImageBase64,
      attachedAudioBase64,
      messageId,
    } = req.body ?? {};
    if ((!text || typeof text !== 'string') && (typeof selectedRowId !== 'string' || !selectedRowId.trim())) {
      return res.status(400).json({ ok: false, error: 'Teks pesan wajib diisi.' });
    }
    const scope = chatScope === 'group' ? 'group' : 'private';
    const phone = String(senderPhone || whatsappEngine.getOwnerPhoneNormalized()).replace(/\D/g, '');
    let quotedMediaBuffer: Buffer | undefined;
    if (typeof quotedMediaBase64 === 'string' && quotedMediaBase64.trim()) {
      const cleanedB64 = quotedMediaBase64.replace(/^data:[^;]+;base64,/, '');
      quotedMediaBuffer = Buffer.from(cleanedB64, 'base64');
    }
    const result = await whatsappEngine.processIncomingMessage({
      chatId: String(chatId || (scope === 'group' ? '1203630001@g.us' : `${phone}@s.whatsapp.net`)),
      chatScope: scope,
      groupName: scope === 'group' ? String(groupName || 'Komunitas Theater JKT48 ID') : undefined,
      senderPhone: phone,
      senderName: String(senderName || 'Owner Simulator'),
      text: typeof text === 'string' ? text : '',
      selectedRowId: typeof selectedRowId === 'string' && selectedRowId.trim() ? selectedRowId.trim() : undefined,
      isGroupAdmin: Boolean(isGroupAdmin ?? true),
      mentions: Array.isArray(mentions) ? mentions.map((m) => String(m)) : undefined,
      quotedSenderPhone: quotedSenderPhone ? String(quotedSenderPhone) : undefined,
      quotedMediaKind:
        quotedMediaKind === 'sticker' ||
        quotedMediaKind === 'image' ||
        quotedMediaKind === 'video' ||
        quotedMediaKind === 'audio'
          ? quotedMediaKind
          : undefined,
      quotedMediaBuffer,
      attachedImageBase64: typeof attachedImageBase64 === 'string' ? attachedImageBase64 : undefined,
      attachedAudioBase64: typeof attachedAudioBase64 === 'string' ? attachedAudioBase64 : undefined,
      messageId: typeof messageId === 'string' ? messageId : undefined,
      source: 'simulator',
    });
    res.json({ ok: true, result });
  });

  app.get('/api/admin/menus/fallbacks', (_req, res) => {
    res.json({ ok: true, logs: listMenuFallbackLogs(50) });
  });

  // Media Lab (#tolive & #sa) Real Pipeline Testing & Job Logs
  app.get('/api/admin/media/jobs', (_req, res) => {
    res.json({ ok: true, jobs: listRecentMediaJobs(30) });
  });

  app.post('/api/admin/media/test-tolive', express.json({ limit: '15mb' }), async (req, res) => {
    const mode = req.body?.mode === 'image' ? 'image' : 'video';
    const mediaBase64 = typeof req.body?.mediaBase64 === 'string' ? req.body.mediaBase64.trim() : '';
    const mediaBuffer = mediaBase64
      ? Buffer.from(mediaBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : await generateMediaPipelineSample(mode);

    const art = await convertMediaToLivePhotoBundle({
      mediaBuffer,
      mediaKind: mode,
      userPhone: whatsappEngine.getOwnerPhoneNormalized(),
      lang: 'id',
    });

    if (!art.ok || !art.livePhotoBundle) {
      return res.status(400).json({ ok: false, error: art.caption, jobs: listRecentMediaJobs(30) });
    }

    const b = art.livePhotoBundle;
    const stillSha = crypto.createHash('sha256').update(b.stillBuffer).digest();
    const vidSha = crypto.createHash('sha256').update(b.motionVideoBuffer).digest();
    const protoPair = buildMotionPhotoProtoPair({
      jid: `${whatsappEngine.getOwnerPhoneNormalized()}@s.whatsapp.net`,
      stillMeta: {
        url: 'https://mmg.whatsapp.net/v/t62.7118-24/sample-still',
        directPath: '/v/t62.7118-24/sample-still',
        mediaKey: crypto.randomBytes(32),
        fileSha256: stillSha,
        fileEncSha256: stillSha,
        fileLength: b.stillBuffer.length,
        width: b.width,
        height: b.height,
        caption: art.caption,
      },
      videoMeta: {
        url: 'https://mmg.whatsapp.net/v/t62.7161-24/sample-motion',
        directPath: '/v/t62.7161-24/sample-motion',
        mediaKey: crypto.randomBytes(32),
        fileSha256: vidSha,
        fileEncSha256: vidSha,
        fileLength: b.motionVideoBuffer.length,
        width: b.width,
        height: b.height,
        seconds: Math.max(1, Math.round(b.durationMs / 1000)),
        presentationOffsetMs: b.presentationOffsetMs,
      },
    });

    if (art.jobId) {
      updateMediaJobDelivery(art.jobId, 'dashboard_media_lab', 'tested', {
        protoParentBytes: protoPair.parentEncodedBytes.length,
        protoChildBytes: protoPair.childEncodedBytes.length,
      });
    }

    return res.json({
      ok: true,
      jobId: art.jobId,
      caption: art.caption,
      honestLimitation: art.honestLimitation,
      preview: {
        stillDataUrl: b.stillDataUrl,
        motionVideoDataUrl: b.motionVideoDataUrl,
        motionPhotoJpgDataUrl: b.motionPhotoJpgDataUrl,
        width: b.width,
        height: b.height,
        durationMs: b.durationMs,
        presentationOffsetMs: b.presentationOffsetMs,
        hasAudio: b.hasAudio,
        stillBytes: b.stillBuffer.length,
        motionVideoBytes: b.motionVideoBuffer.length,
        motionPhotoJpgBytes: b.motionPhotoJpgBuffer.length,
        validation: b.validation,
      },
      protoCheck: {
        associationType: 12,
        parentBytes: protoPair.parentEncodedBytes.length,
        childBytes: protoPair.childEncodedBytes.length,
        presentationOffsetMs: b.presentationOffsetMs,
      },
      jobs: listRecentMediaJobs(30),
    });
  });

  app.post('/api/admin/media/test-sa', express.json({ limit: '15mb' }), async (req, res) => {
    const mode = req.body?.mode === 'image_audio' ? 'image_audio' : 'video';
    const visualBase64 = typeof req.body?.visualBase64 === 'string' ? req.body.visualBase64.trim() : '';
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64.trim() : '';

    const visualKind: 'video' | 'image' = mode === 'image_audio' ? 'image' : 'video';
    const visualBuffer = visualBase64
      ? Buffer.from(visualBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : await generateMediaPipelineSample(visualKind);
    const audioBuffer = audioBase64
      ? Buffer.from(audioBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : mode === 'image_audio'
        ? await generateMediaPipelineSample('audio')
        : undefined;

    const art = await convertStickerAudioBundle({
      visualBuffer,
      visualKind,
      audioBuffer,
      userPhone: whatsappEngine.getOwnerPhoneNormalized(),
      lang: 'id',
    });

    if (!art.ok || !art.soundStickerBundle) {
      return res.status(400).json({ ok: false, error: art.caption, jobs: listRecentMediaJobs(30) });
    }

    const sb = art.soundStickerBundle;
    const stkSha = crypto.createHash('sha256').update(sb.stickerBuffer).digest();
    const audSha = crypto.createHash('sha256').update(sb.audioBuffer).digest();
    const directProto = buildSoundStickerProtoPayload({
      stickerMeta: {
        url: 'https://mmg.whatsapp.net/v/t62.15575-24/sample-sticker',
        directPath: '/v/t62.15575-24/sample-sticker',
        mediaKey: crypto.randomBytes(32),
        fileSha256: stkSha,
        fileEncSha256: stkSha,
        fileLength: sb.stickerBuffer.length,
        isAnimated: true,
        emojis: '🔊',
      },
      audioMeta: {
        url: 'https://mmg.whatsapp.net/v/t62.7114-24/sample-audio',
        directPath: '/v/t62.7114-24/sample-audio',
        mediaKey: crypto.randomBytes(32),
        fileSha256: audSha,
        fileEncSha256: audSha,
        fileLength: sb.audioBuffer.length,
        seconds: sb.audioSeconds,
        waveform: sb.waveform,
      },
      wrapFutureProofEnvelope: false,
    });
    const wrappedProto = buildSoundStickerProtoPayload({
      stickerMeta: {
        url: 'https://mmg.whatsapp.net/v/t62.15575-24/sample-sticker',
        directPath: '/v/t62.15575-24/sample-sticker',
        mediaKey: crypto.randomBytes(32),
        fileSha256: stkSha,
        fileEncSha256: stkSha,
        fileLength: sb.stickerBuffer.length,
        isAnimated: true,
        emojis: '🔊',
      },
      audioMeta: {
        url: 'https://mmg.whatsapp.net/v/t62.7114-24/sample-audio',
        directPath: '/v/t62.7114-24/sample-audio',
        mediaKey: crypto.randomBytes(32),
        fileSha256: audSha,
        fileEncSha256: audSha,
        fileLength: sb.audioBuffer.length,
        seconds: sb.audioSeconds,
        waveform: sb.waveform,
      },
      wrapFutureProofEnvelope: true,
    });

    if (art.jobId) {
      updateMediaJobDelivery(art.jobId, 'dashboard_media_lab', 'tested', {
        protoDirectBytes: directProto.encodedBytes.length,
        protoFutureProofBytes: wrappedProto.encodedBytes.length,
      });
    }

    return res.json({
      ok: true,
      jobId: art.jobId,
      caption: art.caption,
      honestLimitation: art.honestLimitation,
      preview: {
        stickerDataUrl: sb.stickerDataUrl,
        audioDataUrl: sb.audioDataUrl,
        audioSeconds: sb.audioSeconds,
        waveform: sb.waveform,
        stickerBytes: sb.stickerBuffer.length,
        audioBytes: sb.audioBuffer.length,
        webpValidation: sb.webpValidation,
        audioValidation: sb.audioValidation,
      },
      protoCheck: {
        field26AudioEmbedded: true,
        directProtoBytes: directProto.encodedBytes.length,
        futureProofField134Bytes: wrappedProto.encodedBytes.length,
      },
      jobs: listRecentMediaJobs(30),
    });
  });

  // Users, Groups, Redeem
  app.get('/api/admin/users', (_req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY updated_at DESC').all();
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY last_seen_at DESC LIMIT 100').all();
    res.json({ ok: true, users, contacts });
  });

  app.patch('/api/admin/users/:phone', (req, res) => {
    const phone = req.params.phone.replace(/\D/g, '');
    const { is_banned, is_premium, premium_expires_at, deltaBalance, deltaExp, daily_limit } = req.body ?? {};
    if (typeof is_banned === 'boolean') {
      db.prepare('UPDATE users SET is_banned = ? WHERE phone = ?').run(is_banned ? 1 : 0, phone);
    }
    if (typeof is_premium === 'boolean') {
      setUserPremiumStatus(phone, is_premium, typeof premium_expires_at === 'string' ? premium_expires_at : null);
    }
    if (typeof daily_limit === 'number' && Number.isFinite(daily_limit)) {
      db.prepare("UPDATE users SET daily_limit = ?, updated_at = datetime('now') WHERE phone = ?").run(Math.max(0, Math.floor(daily_limit)), phone);
    }
    if (typeof deltaBalance === 'number' || typeof deltaExp === 'number') {
      applyUserBalanceAndExp(phone, phone, Number(deltaBalance || 0), Number(deltaExp || 0), 'Penyesuaian oleh owner');
    }
    addAuditLog('owner', 'user.update', maskPhoneNumberForGroup(phone), req.body);
    res.json({ ok: true });
  });

  app.get('/api/admin/groups', (_req, res) => {
    const groups = db.prepare('SELECT * FROM groups ORDER BY updated_at DESC').all();
    res.json({ ok: true, groups });
  });

  app.patch('/api/admin/groups/:id', (req, res) => {
    const id = req.params.id;
    const { is_rented, is_permanent, welcome_enabled, anti_settings_json, game_mode_enabled } = req.body ?? {};
    db.prepare(`
      UPDATE groups
      SET is_rented = COALESCE(?, is_rented),
          is_permanent = COALESCE(?, is_permanent),
          welcome_enabled = COALESCE(?, welcome_enabled),
          anti_settings_json = COALESCE(?, anti_settings_json),
          game_mode_enabled = COALESCE(?, game_mode_enabled),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      is_rented !== undefined ? (is_rented ? 1 : 0) : null,
      is_permanent !== undefined ? (is_permanent ? 1 : 0) : null,
      welcome_enabled !== undefined ? (welcome_enabled ? 1 : 0) : null,
      anti_settings_json ? JSON.stringify(anti_settings_json) : null,
      game_mode_enabled !== undefined ? (game_mode_enabled ? 1 : 0) : null,
      id,
    );
    addAuditLog('owner', 'group.update', id);
    res.json({ ok: true });
  });

  // Redeem Management System (5 submenus + centralized Reward Registry + persistent history)
  app.get('/api/admin/redeems/registry', (_req, res) => {
    res.json({ ok: true, ...listRewardRegistry() });
  });

  app.get('/api/admin/redeems/settings', (_req, res) => {
    res.json({ ok: true, settings: getRedeemSettings() });
  });

  app.patch('/api/admin/redeems/settings', (req, res) => {
    const updated = updateRedeemSettings('owner', req.body ?? {});
    res.json({ ok: true, settings: updated });
  });

  app.get('/api/admin/redeems/history', (req, res) => {
    const data = getClaimHistory({
      status: String(req.query.status || 'all'),
      code: req.query.code ? String(req.query.code) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
    });
    res.json({ ok: true, ...data });
  });

  app.get('/api/admin/redeems', (req, res) => {
    const { items: codes, total: totalCodes } = listRedeemCodes({
      search: req.query.search ? String(req.query.search) : undefined,
      status: (req.query.status as any) || 'all',
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
    });
    const history = getClaimHistory({
      status: String(req.query.claimStatus || 'all'),
      limit: 50,
      offset: 0,
    });
    const analytics = getRedeemAnalytics();
    res.json({
      ok: true,
      codes,
      totalCodes,
      claims: history.items,
      totalClaims: history.total,
      analytics,
    });
  });

  app.get('/api/admin/redeems/:code', (req, res) => {
    const detail = getRedeemDetail(req.params.code);
    if (!detail.code) return res.status(404).json({ ok: false, error: 'Kode redeem-nya nggak ketemu.' });
    return res.json({ ok: true, ...detail });
  });

  app.post('/api/admin/redeems', (req, res) => {
    const b = req.body ?? {};
    const generatedCode = `FREYA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const additionalRewards = Array.isArray(b.additionalRewards) ? [...b.additionalRewards] : [];
    // Support legacy fields gracefully by mapping them into registered handlers
    if (additionalRewards.length === 0) {
      if (Number(b.reward_limit || 0) > 0) {
        additionalRewards.push({ rewardId: 'daily_limit_bonus', params: { amount: Number(b.reward_limit) } });
      }
      if (Number(b.reward_premium_days || 0) > 0) {
        additionalRewards.push({ rewardId: 'premium_access', params: { days: Number(b.reward_premium_days) } });
      }
    }

    const resCreate = createRedeemCode('owner', {
      code: String(b.code || generatedCode).trim().toUpperCase(),
      name: b.name,
      description: b.description,
      rewardBalance: Number(b.rewardBalance ?? b.reward_balance ?? 0),
      rewardExp: Number(b.rewardExp ?? b.reward_exp ?? 0),
      rewardLevel: Number(b.rewardLevel ?? b.reward_level ?? 0),
      maxClaims: Number(b.maxClaims ?? b.max_claims ?? 10),
      perUserLimit: Number(b.perUserLimit ?? b.per_user_limit ?? 1),
      cooldownSec: Number(b.cooldownSec ?? b.cooldown_sec ?? 0),
      expiresAt: b.expiresAt ?? b.expires_at ?? null,
      active: b.active !== undefined ? Boolean(b.active) : true,
      additionalRewards,
    });

    if (!resCreate.ok) {
      return res.status(400).json({ ok: false, error: resCreate.error });
    }
    return res.json({ ok: true, code: resCreate.item.code, item: resCreate.item });
  });

  app.patch('/api/admin/redeems/:code', (req, res) => {
    const resUpd = updateRedeemCode('owner', req.params.code, req.body ?? {});
    if (!resUpd.ok) return res.status(400).json({ ok: false, error: resUpd.error });
    return res.json({ ok: true, item: resUpd.item });
  });

  app.post('/api/admin/redeems/:code/toggle', (req, res) => {
    const active = Boolean(req.body?.active);
    const resTog = toggleRedeemCode('owner', req.params.code, active);
    if (!resTog.ok) return res.status(404).json({ ok: false, error: resTog.error });
    return res.json({ ok: true, item: resTog.item });
  });

  app.post('/api/admin/redeems/:code/reset', (req, res) => {
    const resReset = resetRedeemClaims('owner', req.params.code, Boolean(req.body?.confirm));
    if (!resReset.ok) return res.status(400).json({ ok: false, error: resReset.error });
    return res.json({ ok: true, code: resReset.code });
  });

  app.delete('/api/admin/redeems/:code', (req, res) => {
    const resDel = deleteRedeemCode('owner', req.params.code);
    if (!resDel.ok) return res.status(404).json({ ok: false, error: resDel.error });
    return res.json({ ok: true, code: resDel.code });
  });

  // Game Management & Strict Private vs Group Activity Logs
  app.get('/api/admin/games', (req, res) => {
    expireStaleSessions();
    const scope = String(req.query.scope || 'all');
    const search = String(req.query.search || '').trim().toLowerCase();

    const settings = db.prepare('SELECT * FROM game_settings ORDER BY domain ASC, name ASC').all();
    const sessions = db.prepare('SELECT * FROM game_sessions ORDER BY started_at DESC LIMIT 80').all();
    let logs = db.prepare('SELECT * FROM game_activity_logs ORDER BY id DESC LIMIT 150').all() as Array<Record<string, unknown>>;

    if (scope === 'private' || scope === 'group') {
      logs = logs.filter((l) => l.chat_scope === scope);
    }
    if (search) {
      logs = logs.filter((l) =>
        `${l.session_id} ${l.game_name} ${l.player_phone} ${l.player_name} ${l.chat_id} ${l.group_name || ''}`
          .toLowerCase()
          .includes(search),
      );
    }

    res.json({ ok: true, settings, sessions, activityLogs: logs });
  });

  app.patch('/api/admin/games/:gameId', (req, res) => {
    const { enabled, duration_sec, max_players, cooldown_sec } = req.body ?? {};
    db.prepare(`
      UPDATE game_settings
      SET enabled = COALESCE(?, enabled),
          duration_sec = COALESCE(?, duration_sec),
          max_players = COALESCE(?, max_players),
          cooldown_sec = COALESCE(?, cooldown_sec)
      WHERE game_id = ?
    `).run(enabled !== undefined ? (enabled ? 1 : 0) : null, duration_sec ?? null, max_players ?? null, cooldown_sec ?? null, req.params.gameId);
    addAuditLog('owner', 'game.config_update', req.params.gameId, req.body);
    res.json({ ok: true });
  });

  app.post('/api/admin/games/sessions/:sessionId/cancel', (req, res) => {
    db.prepare(`
      UPDATE game_sessions SET status = 'cancelled', ended_at = datetime('now'), cancel_reason = 'Dibatalkan oleh owner'
      WHERE id = ?
    `).run(req.params.sessionId);
    addAuditLog('owner', 'game.session_cancel', req.params.sessionId);
    res.json({ ok: true });
  });

  // 48Group Center Management & Verification Approval Queue
  app.get('/api/admin/48group', (_req, res) => {
    const verifications = db.prepare('SELECT * FROM forty_eight_verifications ORDER BY retrieved_at DESC').all();
    const questions = db.prepare('SELECT * FROM forty_eight_questions ORDER BY id ASC').all();
    const sources = db.prepare('SELECT * FROM forty_eight_sources ORDER BY last_checked_at DESC').all();
    const history = db.prepare('SELECT * FROM forty_eight_change_history ORDER BY id DESC LIMIT 40').all();
    res.json({ ok: true, verifications, questions, sources, history });
  });

  app.post('/api/admin/48group/research', async (req, res) => {
    const { query, groupId } = req.body ?? {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ ok: false, error: 'Query riset wajib diisi.' });
    }
    const result = await researchOfficial48GroupSource({
      query,
      groupId: String(groupId || 'jkt48'),
      requestedBy: 'owner',
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/admin/48group/verifications/:id/decision', (req, res) => {
    const { decision } = req.body ?? {};
    const ver = db.prepare('SELECT * FROM forty_eight_verifications WHERE id = ?').get(req.params.id) as {
      id: string; entity_type: string; entity_id: string; entity_name: string; group_id: string;
      proposed_payload_json: string; source_title: string; source_url: string; retrieved_at: string;
    } | undefined;

    if (!ver) return res.status(404).json({ ok: false, error: 'Item verifikasi nggak ketemu.' });

    const approved = decision === 'approve';
    db.transaction(() => {
      db.prepare(`
        UPDATE forty_eight_verifications
        SET approval_status = ?, info_status = ?, reviewed_by = 'owner', reviewed_at = datetime('now')
        WHERE id = ?
      `).run(approved ? 'approved' : 'rejected', approved ? 'official_verified' : 'unconfirmed', ver.id);

      if (approved && ver.entity_type === 'event') {
        const payload = JSON.parse(ver.proposed_payload_json) as { title?: string; eventType?: string; venue?: string; summary?: string };
        db.prepare(`
          INSERT OR REPLACE INTO forty_eight_events (
            id, group_id, title, event_type, event_date, venue, summary, validation_status, source_title, source_url, retrieved_at
          ) VALUES (?, ?, ?, ?, 'Terkonfirmasi Owner', ?, ?, 'official_verified', ?, ?, ?)
        `).run(
          ver.entity_id,
          ver.group_id || 'jkt48',
          payload.title || ver.entity_name,
          payload.eventType || 'Pengumuman Resmi',
          payload.venue || 'Situs Resmi 48Group',
          payload.summary || ver.entity_name,
          ver.source_title,
          ver.source_url,
          ver.retrieved_at,
        );
      }

      db.prepare(`
        INSERT INTO forty_eight_change_history (entity_type, entity_id, change_summary, source_url, changed_by)
        VALUES (?, ?, ?, ?, 'owner')
      `).run(ver.entity_type, ver.entity_id, `${approved ? 'Disetujui' : 'Ditolak'}: ${ver.entity_name}`, ver.source_url);
    })();

    addAuditLog('owner', `48group.verification.${approved ? 'approve' : 'reject'}`, ver.id);
    res.json({ ok: true });
  });

  // Plugins, AI Configuration, Multi-Agent Orchestration, Automations
  app.get('/api/admin/plugins', (_req, res) => {
    const plugins = db.prepare('SELECT * FROM plugins ORDER BY name ASC').all();
    res.json({ ok: true, plugins });
  });

  app.post('/api/admin/plugins/:id/toggle', (req, res) => {
    db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(req.body?.enabled ? 1 : 0, req.params.id);
    addAuditLog('owner', 'plugin.toggle', req.params.id, { enabled: Boolean(req.body?.enabled) });
    res.json({ ok: true });
  });

  app.get('/api/admin/ai', (_req, res) => {
    const providers = db.prepare('SELECT * FROM ai_providers').all();
    const models = db.prepare('SELECT * FROM ai_models').all();
    const usage = db.prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT 30').all();
    const agents = db.prepare('SELECT * FROM ai_agents').all();
    const approvals = db.prepare('SELECT * FROM ai_agent_approvals ORDER BY created_at DESC LIMIT 30').all();
    res.json({ ok: true, providers, models, usage, agents, approvals });
  });

  app.post('/api/admin/ai/test', async (req, res) => {
    const prompt = String(req.body?.prompt || 'Sapa owner Freya-san Hub dalam satu kalimat ringkas.');
    const result = await runNexaraAiQuery({ prompt, userPhone: 'owner-test', modelName: req.body?.modelName });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.patch('/api/admin/ai/providers/:id', (req, res) => {
    const { enabled, system_prompt, persona_name } = req.body ?? {};
    db.prepare(`
      UPDATE ai_providers
      SET enabled = COALESCE(?, enabled),
          system_prompt = COALESCE(?, system_prompt),
          persona_name = COALESCE(?, persona_name),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(enabled !== undefined ? (enabled ? 1 : 0) : null, system_prompt ?? null, persona_name ?? null, req.params.id);
    addAuditLog('owner', 'ai.provider_update', req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/ai/approvals/:id', (req, res) => {
    const decision = req.body?.decision === 'approve' ? 'approved' : 'rejected';
    db.prepare(`UPDATE ai_agent_approvals SET status = ?, reviewed_by = 'owner', reviewed_at = datetime('now') WHERE id = ?`).run(
      decision,
      req.params.id,
    );
    addAuditLog('owner', 'ai.agent_approval', req.params.id, { decision });
    res.json({ ok: true });
  });

  app.get('/api/admin/automations', (_req, res) => {
    const automations = db.prepare('SELECT * FROM automations').all();
    const history = db.prepare('SELECT * FROM scheduled_tasks ORDER BY id DESC LIMIT 30').all();
    res.json({ ok: true, automations, history });
  });

  app.post('/api/admin/automations/:id/toggle', (req, res) => {
    const enabled = req.body?.enabled ? 1 : 0;
    db.prepare('UPDATE automations SET enabled = ?, status = ? WHERE id = ?').run(enabled, enabled ? 'scheduled' : 'paused', req.params.id);
    addAuditLog('owner', 'automation.toggle', req.params.id, { enabled: Boolean(enabled) });
    res.json({ ok: true });
  });

  app.post('/api/admin/automations/:id/run', (req, res) => {
    db.prepare(`UPDATE automations SET run_count = run_count + 1, last_run_at = datetime('now') WHERE id = ?`).run(req.params.id);
    db.prepare(`INSERT INTO scheduled_tasks (automation_id, status, output_summary, finished_at) VALUES (?, 'completed', 'Eksekusi manual oleh owner berhasil.', datetime('now'))`).run(req.params.id);
    addAuditLog('owner', 'automation.run_now', req.params.id);
    res.json({ ok: true });
  });

  // Logs, Audit, Console (strict allowlist)
  app.get('/api/admin/logs', (_req, res) => {
    const logs = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100').all();
    const errors = db.prepare('SELECT * FROM errors ORDER BY id DESC LIMIT 50').all();
    const audits = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
    const cmdUsage = db.prepare('SELECT * FROM command_usage ORDER BY id DESC LIMIT 100').all();
    res.json({ ok: true, logs, errors, audits, cmdUsage });
  });

  app.post('/api/admin/console', (req, res) => {
    const cmd = String(req.body?.command || '').trim();
    const allowed: Record<string, () => string> = {
      help: () => 'Perintah terizinkan: help, status, db:tables, wa:status, prefixes, audit:summary, health',
      status: () => JSON.stringify(whatsappEngine.getStatus(), null, 2),
      'wa:status': () => JSON.stringify(whatsappEngine.getStatus(), null, 2),
      prefixes: () => whatsappEngine.getActivePrefixes().join(' '),
      'db:tables': () => {
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
        return rows.map((r) => r.name).join(', ');
      },
      'audit:summary': () => JSON.stringify(generateInventoryAudit(), null, 2),
      health: () => `Uptime: ${Math.floor(process.uptime())}s | Mem Free: ${Math.round(os.freemem() / 1024 / 1024)} MB`,
    };
    const key = cmd.toLowerCase();
    addAuditLog('owner', 'console.exec', key);
    if (!allowed[key]) {
      return res.status(403).json({
        ok: false,
        output: `Perintah "${cmd}" tidak ada di allowlist console administrator. Ketik "help" untuk daftar perintah aman.`,
      });
    }
    return res.json({ ok: true, output: allowed[key]() });
  });

  // File Manager (strict path confinement inside data/files)
  app.get('/api/admin/files', (_req, res) => {
    const files = db.prepare('SELECT * FROM files_metadata ORDER BY created_at DESC').all();
    res.json({ ok: true, files });
  });

  app.post('/api/admin/files', (req, res) => {
    const { filename, content, folder } = req.body ?? {};
    const safeName = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || safeName.startsWith('.')) {
      return res.status(400).json({ ok: false, error: 'Nama file tidak valid.' });
    }
    const allowedExt = ['.txt', '.json', '.md', '.csv', '.log'];
    if (!allowedExt.some((ext) => safeName.toLowerCase().endsWith(ext))) {
      return res.status(400).json({ ok: false, error: 'Ekstensi file dibatasi hanya .txt, .json, .md, .csv, .log untuk keamanan.' });
    }
    const targetPath = safeResolveInBase(FILES_BASE_DIR, safeName);
    if (!targetPath) return res.status(400).json({ ok: false, error: 'Path file tidak diizinkan.' });

    const buf = Buffer.from(String(content || ''), 'utf8');
    if (buf.length > 512_000) return res.status(400).json({ ok: false, error: 'Ukuran file melebihi batas 512KB.' });
    fs.writeFileSync(targetPath, buf);

    const id = `file-${Date.now()}`;
    db.prepare(`INSERT INTO files_metadata (id, filename, mime_type, size_bytes, folder, uploaded_by) VALUES (?, ?, 'text/plain', ?, ?, 'owner')`).run(
      id,
      safeName,
      buf.length,
      String(folder || 'general'),
    );
    addAuditLog('owner', 'file.create', safeName);
    res.json({ ok: true, id, filename: safeName });
  });

  app.get('/api/admin/files/:filename', (req, res) => {
    const targetPath = safeResolveInBase(FILES_BASE_DIR, req.params.filename);
    if (!targetPath || !fs.existsSync(targetPath)) return res.status(404).json({ ok: false, error: 'File-nya nggak ketemu.' });
    const content = fs.readFileSync(targetPath, 'utf8');
    res.json({ ok: true, filename: path.basename(targetPath), content });
  });

  app.delete('/api/admin/files/:filename', (req, res) => {
    const targetPath = safeResolveInBase(FILES_BASE_DIR, req.params.filename);
    if (targetPath && fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    db.prepare('DELETE FROM files_metadata WHERE filename = ?').run(path.basename(req.params.filename));
    addAuditLog('owner', 'file.delete', req.params.filename);
    res.json({ ok: true });
  });

  // Encrypted Backup & Restore
  app.get('/api/admin/backups', (_req, res) => {
    const backups = db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all();
    res.json({ ok: true, backups });
  });

  app.post('/api/admin/backups/create', (_req, res) => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      version: '5.0',
      settings: db.prepare('SELECT key, value FROM settings WHERE is_secret = 0').all(),
      prefixes: db.prepare('SELECT * FROM prefixes').all(),
      commands: db.prepare('SELECT name, enabled, permission, cooldown_sec, daily_limit FROM commands').all(),
      redeemCodes: db.prepare('SELECT * FROM redeem_codes').all(),
      fortyEightGroups: db.prepare('SELECT * FROM forty_eight_groups').all(),
      fortyEightMembers: db.prepare('SELECT * FROM forty_eight_members').all(),
    };
    const json = JSON.stringify(snapshot, null, 2);
    const keySource = process.env.BACKUP_ENCRYPTION_KEY || 'freya-san-hub-default-local-backup-key';
    const key = crypto.createHash('sha256').update(keySource).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = JSON.stringify({
      alg: 'aes-256-gcm',
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted.toString('hex'),
    });

    const id = `bkp-${Date.now()}`;
    const filename = `freya-backup-${Date.now()}.enc.json`;
    const checksum = crypto.createHash('sha256').update(envelope).digest('hex');
    const outPath = safeResolveInBase(BACKUPS_BASE_DIR, filename)!;
    fs.writeFileSync(outPath, envelope, 'utf8');

    db.prepare(`INSERT INTO backups (id, filename, encrypted, size_bytes, checksum, created_by) VALUES (?, ?, 1, ?, ?, 'owner')`).run(
      id,
      filename,
      Buffer.byteLength(envelope),
      checksum,
    );
    addAuditLog('owner', 'backup.create', filename);
    res.json({ ok: true, id, filename, checksum });
  });

  // Settings (including Blue Tick Control & Maintenance Mode)
  app.get('/api/admin/settings', (_req, res) => {
    const rows = db.prepare('SELECT key, value, is_secret, updated_at FROM settings ORDER BY key ASC').all() as Array<{
      key: string; value: string; is_secret: number; updated_at: string;
    }>;
    const sanitized = rows.map((r) => ({
      ...r,
      value: r.key === 'owner_passcode_hash' ? '********' : r.value,
    }));
    res.json({ ok: true, settings: sanitized });
  });

  app.patch('/api/admin/settings', (req, res) => {
    const updates = req.body?.updates as Record<string, string> | undefined;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ ok: false, error: 'Payload updates diperlukan.' });
    }
    const allowedKeys = new Set([
      'default_language',
      'language_style',
      'default_theme',
      'blue_tick_enabled',
      'maintenance_mode',
      'auto_nexara',
      'antidelete_pc',
      'multi_room_concurrent',
      'owner_number_configured',
    ]);
    const stmt = db.prepare(
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 0, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    );
    db.transaction(() => {
      for (const [k, v] of Object.entries(updates)) {
        if (allowedKeys.has(k)) {
          stmt.run(k, String(v));
          addAuditLog('owner', 'settings.update', k, { value: k === 'owner_number_configured' ? '[redacted]' : v });
        }
      }
    })();
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // 5b. USER ABUSE & EXPLOIT PREVENTION, LIMITS, GAMES BANK & STREAKS
  // ------------------------------------------------------------------
  app.get('/api/admin/abuse', (_req, res) => {
    res.json({ ok: true, ...getAbuseDashboardState() });
  });

  app.patch('/api/admin/abuse/config', (req, res) => {
    const updated = updateAbuseConfig(req.body ?? {});
    addAuditLog('owner', 'abuse.config_update', 'abuse_protection', req.body);
    res.json({ ok: true, config: updated });
  });

  app.post('/api/admin/abuse/action', (req, res) => {
    const { userPhone, action, reason, durationMinutes } = req.body ?? {};
    const cleaned = String(userPhone || '').replace(/\D/g, '');
    if (!cleaned) {
      return res.status(400).json({ ok: false, error: 'Nomor WhatsApp pengguna wajib diisi.' });
    }
    if (!['warn', 'temp_restrict', 'block', 'restore'].includes(String(action))) {
      return res.status(400).json({ ok: false, error: 'Aksi tidak valid.' });
    }
    const result = setAbuseRestrictionAction({
      userPhone: cleaned,
      action,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : `Aksi ${action} oleh owner`,
      durationMinutes: Number(durationMinutes || 30),
      actor: 'owner',
    });
    addAuditLog('owner', `abuse.${action}`, maskPhoneNumberForGroup(cleaned), { reason, durationMinutes });
    return res.json({ ok: true, restriction: result });
  });

  app.post('/api/admin/abuse/events/:id/resolve', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'ID event tidak valid.' });
    db.prepare('UPDATE abuse_events SET resolved = 1 WHERE id = ?').run(id);
    addAuditLog('owner', 'abuse.event_resolve', String(id));
    return res.json({ ok: true });
  });

  app.get('/api/admin/limits', (_req, res) => {
    const config = getLimitConfig();
    const commandCosts = db
      .prepare(`
        SELECT c.name, c.category, c.permission, COALESCE(cs.limit_cost, ?) AS limit_cost,
               COALESCE(cs.free_access, 0) AS free_access
        FROM commands c
        LEFT JOIN command_settings cs ON cs.command_name = c.name
        ORDER BY c.category ASC, c.name ASC
      `)
      .all(config.defaultCommandCost);
    const transactions = db
      .prepare('SELECT * FROM limit_transactions ORDER BY id DESC LIMIT 60')
      .all();
    res.json({ ok: true, config, commandCosts, transactions });
  });

  app.patch('/api/admin/limits/config', (req, res) => {
    const updated = updateLimitConfig(req.body ?? {});
    addAuditLog('owner', 'limits.config_update', 'limit_config', req.body);
    res.json({ ok: true, config: updated });
  });

  app.patch('/api/admin/limits/commands/:name', (req, res) => {
    const name = req.params.name.toLowerCase().trim();
    const cost = Math.max(0, Math.min(100, Math.floor(Number(req.body?.limit_cost ?? 1))));
    const freeAccess = Boolean(req.body?.free_access) ? 1 : 0;
    db.prepare(`
      INSERT INTO command_settings (command_name, limit_cost, free_access, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(command_name) DO UPDATE SET
        limit_cost = excluded.limit_cost,
        free_access = excluded.free_access,
        updated_at = datetime('now')
    `).run(name, cost, freeAccess);
    addAuditLog('owner', 'limits.command_cost_update', name, { cost, freeAccess });
    res.json({ ok: true });
  });

  app.get('/api/admin/games/config', (_req, res) => {
    const bom = getBomConfig();
    const langRow = db.prepare("SELECT value FROM settings WHERE key = 'default_language'").get() as { value: string } | undefined;
    const lbRow = db.prepare("SELECT value FROM settings WHERE key = 'leaderboard_limit'").get() as { value: string } | undefined;
    res.json({
      ok: true,
      bom,
      maxQuizWrongAttempts: getMaxQuizWrongAttempts(),
      botLanguage: langRow?.value || 'id',
      leaderboardLimit: Number(lbRow?.value || 10),
    });
  });

  app.patch('/api/admin/games/config', (req, res) => {
    const b = req.body ?? {};
    const bom = b.bom ? updateBomConfig(b.bom) : getBomConfig();
    if (typeof b.maxQuizWrongAttempts === 'number' && Number.isFinite(b.maxQuizWrongAttempts)) {
      const clamped = Math.max(1, Math.min(20, Math.floor(b.maxQuizWrongAttempts)));
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('max_quiz_wrong_attempts', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(String(clamped));
    }
    if (b.botLanguage === 'id' || b.botLanguage === 'en' || b.botLanguage === 'ja') {
      db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'default_language'").run(b.botLanguage);
    }
    if (typeof b.leaderboardLimit === 'number' && Number.isFinite(b.leaderboardLimit)) {
      const clampedLb = Math.max(5, Math.min(50, Math.floor(b.leaderboardLimit)));
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('leaderboard_limit', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(String(clampedLb));
    }
    addAuditLog('owner', 'games.config_update', 'game_rules', b);
    res.json({ ok: true, bom });
  });

  app.get('/api/admin/games/undercover', (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || 'ALL').trim();
    let rows = db.prepare('SELECT * FROM undercover_word_pairs ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    if (category && category !== 'ALL') {
      rows = rows.filter((r) => String(r.category) === category);
    }
    if (search) {
      rows = rows.filter((r) =>
        `${r.civilian_id} ${r.undercover_id} ${r.civilian_en} ${r.undercover_en} ${r.category}`.toLowerCase().includes(search),
      );
    }
    res.json({ ok: true, items: rows, total: rows.length });
  });

  app.post('/api/admin/games/undercover', (req, res) => {
    const b = req.body ?? {};
    const civId = String(b.civilian_id ?? b.word_a_id ?? '').trim();
    const ucId = String(b.undercover_id ?? b.word_b_id ?? '').trim();
    if (!civId || !ucId) {
      return res.status(400).json({ ok: false, error: 'Kata Civil dan Kata Undercover bahasa Indonesia wajib diisi.' });
    }
    const id = `uc-custom-${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO undercover_word_pairs (id, category, civilian_id, undercover_id, civilian_en, undercover_en, civilian_ja, undercover_ja, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      String(b.category || 'umum'),
      civId,
      ucId,
      String(b.civilian_en || civId),
      String(b.undercover_en || ucId),
      String(b.civilian_ja || civId),
      String(b.undercover_ja || ucId),
    );
    addAuditLog('owner', 'undercover.create', id, { civId, ucId });
    return res.json({ ok: true, id });
  });

  app.patch('/api/admin/games/undercover/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'ID tidak valid.' });
    const b = req.body ?? {};
    db.prepare(`
      UPDATE undercover_word_pairs
      SET enabled = COALESCE(?, enabled),
          category = COALESCE(?, category),
          civilian_id = COALESCE(?, civilian_id),
          undercover_id = COALESCE(?, undercover_id)
      WHERE id = ?
    `).run(
      b.enabled !== undefined ? (b.enabled ? 1 : 0) : b.active !== undefined ? (b.active ? 1 : 0) : null,
      b.category ?? null,
      b.civilian_id ?? b.word_a_id ?? null,
      b.undercover_id ?? b.word_b_id ?? null,
      id,
    );
    return res.json({ ok: true });
  });

  app.delete('/api/admin/games/undercover/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'ID tidak valid.' });
    db.prepare('DELETE FROM undercover_word_pairs WHERE id = ?').run(id);
    addAuditLog('owner', 'undercover.delete', id);
    return res.json({ ok: true });
  });

  app.get('/api/admin/games/tebakemoji', (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || 'ALL').trim();
    let rows = db.prepare('SELECT * FROM tebakemoji_questions ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    if (category && category !== 'ALL') {
      rows = rows.filter((r) => String(r.category) === category);
    }
    if (search) {
      rows = rows.filter((r) => `${r.emoji_prompt} ${r.answer} ${r.category} ${r.hint}`.toLowerCase().includes(search));
    }
    res.json({ ok: true, items: rows, total: rows.length });
  });

  app.post('/api/admin/games/tebakemoji', (req, res) => {
    const b = req.body ?? {};
    const emojis = String(b.emoji_prompt ?? b.emojis ?? '').trim();
    const answer = String(b.answer || '').trim();
    if (!emojis || !answer) {
      return res.status(400).json({ ok: false, error: 'Emoji dan jawaban wajib diisi.' });
    }
    const id = `em-custom-${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO tebakemoji_questions (id, category, emoji_prompt, answer, aliases_json, hint, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      String(b.category || 'Umum'),
      emojis,
      answer,
      JSON.stringify(Array.isArray(b.aliases) ? b.aliases : []),
      String(b.hint || 'Tebak gabungan emoji ini!'),
    );
    addAuditLog('owner', 'tebakemoji.create', id, { emojis, answer });
    return res.json({ ok: true, id });
  });

  app.patch('/api/admin/games/tebakemoji/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'ID tidak valid.' });
    const b = req.body ?? {};
    db.prepare(`
      UPDATE tebakemoji_questions
      SET enabled = COALESCE(?, enabled),
          category = COALESCE(?, category),
          emoji_prompt = COALESCE(?, emoji_prompt),
          answer = COALESCE(?, answer),
          hint = COALESCE(?, hint)
      WHERE id = ?
    `).run(
      b.enabled !== undefined ? (b.enabled ? 1 : 0) : b.active !== undefined ? (b.active ? 1 : 0) : null,
      b.category ?? null,
      b.emoji_prompt ?? b.emojis ?? null,
      b.answer ?? null,
      b.hint ?? null,
      id,
    );
    return res.json({ ok: true });
  });

  app.delete('/api/admin/games/tebakemoji/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'ID tidak valid.' });
    db.prepare('DELETE FROM tebakemoji_questions WHERE id = ?').run(id);
    addAuditLog('owner', 'tebakemoji.delete', id);
    return res.json({ ok: true });
  });

  app.get('/api/admin/streaks', (_req, res) => {
    const pairs = db.prepare('SELECT * FROM pair_streaks ORDER BY current_streak DESC, updated_at DESC LIMIT 80').all();
    const groups = db
      .prepare(`
        SELECT gs.*, COALESCE(g.name, gs.group_id) AS group_name
        FROM group_streaks gs
        LEFT JOIN groups g ON g.id = gs.group_id
        ORDER BY gs.current_streak DESC, gs.updated_at DESC
        LIMIT 80
      `)
      .all();
    res.json({ ok: true, settings: getStreakSettings(), pairs, groups });
  });

  app.patch('/api/admin/streaks/group/:id', (req, res) => {
    const groupId = decodeURIComponent(req.params.id);
    const enabled = Boolean(req.body?.enabled);
    setGroupStreakEnabled(groupId, enabled);
    addAuditLog('owner', 'streaks.group_toggle', groupId, { enabled });
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // 6. FRONTEND SERVING (Vite dev middleware or built dist/)
  // ------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Freya-san Hub v5.0 running at http://0.0.0.0:${PORT}`);
    if (process.env.WHATSAPP_AUTO_CONNECT === 'true') {
      void whatsappEngine.connect();
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start Freya-san Hub:', err);
  process.exit(1);
});
