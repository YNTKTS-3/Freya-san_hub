import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_COMMANDS } from '../core/commandInventory';
import { DEFAULT_PREFIXES } from '../core/prefixParser';
import { GAME_REGISTRY } from '../core/gameRules';
import { JKT48_DIFFICULTY_LEVELS, JKT48_TEAMS } from '../core/jkt48Classification';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'freya-hub.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      language TEXT NOT NULL DEFAULT 'id',
      is_premium INTEGER NOT NULL DEFAULT 0,
      premium_expires_at TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      balance INTEGER NOT NULL DEFAULT 100,
      exp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      daily_limit INTEGER NOT NULL DEFAULT 25,
      used_today INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      privacy_opt_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      push_name TEXT,
      verified_name TEXT,
      source TEXT NOT NULL DEFAULT 'whatsapp',
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_phone TEXT,
      member_count INTEGER NOT NULL DEFAULT 0,
      is_rented INTEGER NOT NULL DEFAULT 0,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      rent_expires_at TEXT,
      language TEXT NOT NULL DEFAULT 'id',
      welcome_enabled INTEGER NOT NULL DEFAULT 0,
      welcome_text TEXT DEFAULT 'Selamat datang di grup!',
      left_enabled INTEGER NOT NULL DEFAULT 0,
      left_text TEXT DEFAULT 'Sampai jumpa!',
      anti_settings_json TEXT NOT NULL DEFAULT '{}',
      game_mode_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      warnings INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_phone),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_admins (
      group_id TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      is_super_admin INTEGER NOT NULL DEFAULT 0,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_phone),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bot_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'disconnected',
      phone_number TEXT,
      qr_code TEXT,
      last_connected_at TEXT,
      last_error TEXT,
      reconnect_attempts INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prefixes (
      prefix TEXT PRIMARY KEY,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS commands (
      name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      example TEXT NOT NULL,
      permission TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      enabled INTEGER NOT NULL DEFAULT 1,
      cooldown_sec INTEGER NOT NULL DEFAULT 3,
      daily_limit INTEGER NOT NULL DEFAULT 25,
      balance_reward INTEGER NOT NULL DEFAULT 5,
      exp_reward INTEGER NOT NULL DEFAULT 3,
      required_provider TEXT,
      required_plugin TEXT,
      has_real_handler INTEGER NOT NULL DEFAULT 1,
      is_owner_only INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      source_correction TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      implementation_version TEXT NOT NULL DEFAULT '5.0.0'
    );

    CREATE TABLE IF NOT EXISTS command_aliases (
      alias TEXT PRIMARY KEY,
      command_name TEXT NOT NULL,
      FOREIGN KEY (command_name) REFERENCES commands(name) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS command_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_name TEXT NOT NULL,
      prefix_used TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_scope TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS command_settings (
      command_name TEXT PRIMARY KEY,
      custom_cooldown_sec INTEGER,
      custom_limit INTEGER,
      free_access INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (command_name) REFERENCES commands(name) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'healthy',
      requires_key INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      usage_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      fallback_provider_id TEXT,
      system_prompt TEXT NOT NULL,
      persona_name TEXT NOT NULL DEFAULT 'Freya-san AI',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      capability TEXT NOT NULL DEFAULT 'text',
      is_default INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      user_phone TEXT,
      prompt_preview TEXT,
      tokens_est INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      autonomy_guard TEXT NOT NULL DEFAULT 'approval_required',
      status TEXT NOT NULL DEFAULT 'idle',
      benchmark_score REAL NOT NULL DEFAULT 0,
      tasks_completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ai_agent_approvals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      action_title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      cron_expr TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      output_summary TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      module TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      error_code TEXT,
      message TEXT NOT NULL,
      stack_preview TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balances (
      user_phone TEXT PRIMARY KEY,
      amount INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id TEXT,
      balance_after INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS xp_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      exp_after INTEGER NOT NULL,
      level_after INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS limits (
      user_phone TEXT PRIMARY KEY,
      daily_quota INTEGER NOT NULL DEFAULT 25,
      used_today INTEGER NOT NULL DEFAULT 0,
      reset_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_phone TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_subscriptions (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      reward_balance INTEGER NOT NULL DEFAULT 0,
      reward_exp INTEGER NOT NULL DEFAULT 0,
      reward_level INTEGER NOT NULL DEFAULT 0,
      reward_limit INTEGER NOT NULL DEFAULT 0,
      reward_premium_days INTEGER NOT NULL DEFAULT 0,
      additional_rewards_json TEXT NOT NULL DEFAULT '[]',
      max_claims INTEGER NOT NULL DEFAULT 10,
      per_user_limit INTEGER NOT NULL DEFAULT 1,
      cooldown_sec INTEGER NOT NULL DEFAULT 0,
      claimed_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS redeem_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      rewards_granted_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT UNIQUE,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS redeem_claim_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      code_name TEXT,
      user_phone TEXT NOT NULL,
      user_name TEXT,
      status TEXT NOT NULL,
      failure_reason TEXT,
      rewards_granted_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS whatsapp_wizards (
      id TEXT PRIMARY KEY,
      user_phone TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      wizard_type TEXT NOT NULL,
      step TEXT NOT NULL,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_settings (
      game_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_players INTEGER NOT NULL DEFAULT 1,
      max_players INTEGER NOT NULL DEFAULT 10,
      duration_sec INTEGER NOT NULL DEFAULT 90,
      cooldown_sec INTEGER NOT NULL DEFAULT 3
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      category TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_scope TEXT NOT NULL,
      group_name TEXT,
      host_phone TEXT NOT NULL,
      host_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      state_json TEXT NOT NULL,
      players_json TEXT NOT NULL DEFAULT '[]',
      cancel_reason TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      category TEXT NOT NULL,
      chat_scope TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      group_name TEXT,
      player_phone TEXT NOT NULL,
      player_name TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      answer_status TEXT NOT NULL,
      score_awarded INTEGER NOT NULL DEFAULT 0,
      session_status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL,
      display_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      game_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_phone, domain, game_id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      user_phone TEXT NOT NULL,
      domain TEXT NOT NULL,
      badge_name TEXT NOT NULL,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forty_eight_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_city TEXT NOT NULL,
      country TEXT NOT NULL,
      founded_year INTEGER NOT NULL,
      status TEXT NOT NULL,
      official_site TEXT NOT NULL,
      description TEXT NOT NULL,
      sister_relation TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      published_at TEXT,
      retrieved_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forty_eight_generations (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      gen_label TEXT NOT NULL,
      debut_year INTEGER NOT NULL,
      notes TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES forty_eight_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forty_eight_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nickname TEXT NOT NULL,
      group_id TEXT NOT NULL,
      generation TEXT NOT NULL,
      status TEXT NOT NULL,
      joined_date TEXT,
      graduated_date TEXT,
      bio TEXT NOT NULL,
      career_notes TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      published_at TEXT,
      retrieved_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forty_eight_discography (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      title TEXT NOT NULL,
      release_type TEXT NOT NULL,
      release_date TEXT NOT NULL,
      center_member TEXT,
      label TEXT NOT NULL,
      senbatsu_notes TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forty_eight_songs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      discography_id TEXT,
      title TEXT NOT NULL,
      unit_name TEXT,
      release_year INTEGER NOT NULL,
      metadata_hint TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forty_eight_theater (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      setlist_name TEXT NOT NULL,
      stage_number TEXT NOT NULL,
      opening_song TEXT NOT NULL,
      tracklist_json TEXT NOT NULL,
      period TEXT NOT NULL,
      notes TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forty_eight_events (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      venue TEXT NOT NULL,
      summary TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forty_eight_terminology (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      category TEXT NOT NULL,
      definition TEXT NOT NULL,
      source_url TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      retrieved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forty_eight_sources (
      id TEXT PRIMARY KEY,
      group_id TEXT,
      source_name TEXT NOT NULL,
      url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      auto_discovered INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS forty_eight_verifications (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      group_id TEXT,
      proposed_payload_json TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      info_status TEXT NOT NULL DEFAULT 'pending_review',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      retrieved_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS forty_eight_change_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      source_url TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forty_eight_questions (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      group_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL,
      hint_1 TEXT NOT NULL,
      hint_2 TEXT NOT NULL,
      source_url TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      enabled INTEGER NOT NULL DEFAULT 1,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 1,
      size_bytes INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files_metadata (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      folder TEXT NOT NULL DEFAULT 'general',
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jkt48_eras (
      id TEXT PRIMARY KEY,
      level_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      difficulty_label TEXT NOT NULL,
      era_category TEXT NOT NULL,
      period_range TEXT NOT NULL,
      description TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'official_verified',
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jkt48_teams (
      id TEXT PRIMARY KEY,
      team_group TEXT NOT NULL,
      name TEXT NOT NULL,
      historical_status TEXT NOT NULL,
      era_summary TEXT NOT NULL,
      description TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'official_verified',
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jkt48_member_team_history (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      role_in_team TEXT,
      joined_at TEXT,
      left_at TEXT,
      era_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      validation_status TEXT NOT NULL DEFAULT 'official_verified',
      source_url TEXT NOT NULL,
      FOREIGN KEY (member_id) REFERENCES forty_eight_members(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES jkt48_teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cmd_usage_name ON command_usage(command_name);
    CREATE INDEX IF NOT EXISTS idx_game_sessions_chat ON game_sessions(chat_id, status);
    CREATE INDEX IF NOT EXISTS idx_game_activity_scope ON game_activity_logs(chat_scope, session_id);
    CREATE INDEX IF NOT EXISTS idx_48_members_group ON forty_eight_members(group_id, validation_status);
  `);

  // Idempotent column upgrades for pre-existing tables
  ensureColumn('redeem_codes', 'name', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn('redeem_codes', 'description', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn('redeem_codes', 'reward_level', `INTEGER NOT NULL DEFAULT 0`);
  ensureColumn('redeem_codes', 'additional_rewards_json', `TEXT NOT NULL DEFAULT '[]'`);
  ensureColumn('redeem_codes', 'cooldown_sec', `INTEGER NOT NULL DEFAULT 0`);
  ensureColumn('redeem_codes', 'updated_at', `TEXT NOT NULL DEFAULT ''`);

  // Safely rebuild old redeem_claims if it still has ON DELETE CASCADE / missing idempotency_key
  const claimCols = db.prepare('PRAGMA table_info(redeem_claims)').all() as Array<{ name: string }>;
  if (!claimCols.some((c) => c.name === 'idempotency_key')) {
    db.exec(`
      CREATE TABLE redeem_claims_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        user_phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        rewards_granted_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT UNIQUE,
        claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO redeem_claims_v2 (id, code, user_phone, claimed_at)
      SELECT id, code, user_phone, claimed_at FROM redeem_claims;
      DROP TABLE redeem_claims;
      ALTER TABLE redeem_claims_v2 RENAME TO redeem_claims;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_redeem_claims_code_user ON redeem_claims(code, user_phone);
    CREATE INDEX IF NOT EXISTS idx_redeem_logs_code ON redeem_claim_logs(code, status, created_at);
  `);

  ensureColumn('forty_eight_generations', 'era_id', 'TEXT');
  ensureColumn('forty_eight_generations', 'difficulty_level', 'TEXT');
  ensureColumn('forty_eight_members', 'era_id', 'TEXT');
  ensureColumn('forty_eight_members', 'difficulty_level', 'TEXT');
  ensureColumn('forty_eight_members', 'primary_team_id', 'TEXT');
  ensureColumn('forty_eight_members', 'team_group', 'TEXT');
  ensureColumn('forty_eight_discography', 'era_id', 'TEXT');
  ensureColumn('forty_eight_discography', 'difficulty_level', 'TEXT');
  ensureColumn('forty_eight_theater', 'era_id', 'TEXT');
  ensureColumn('forty_eight_theater', 'difficulty_level', 'TEXT');
  ensureColumn('forty_eight_events', 'era_id', 'TEXT');
  ensureColumn('forty_eight_events', 'difficulty_level', 'TEXT');
  ensureColumn('forty_eight_questions', 'era_id', 'TEXT');
  ensureColumn('forty_eight_questions', 'difficulty_level', 'TEXT');
  ensureColumn('forty_eight_questions', 'team_id', 'TEXT');
  ensureColumn('forty_eight_questions', 'generation', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_48_q_level ON forty_eight_questions(difficulty_level, group_id, validation_status);
  `);
}

export function seedDatabase(): void {
  const nowIso = new Date().toISOString();

  // 1. Default settings (never seed secret passwords!)
  const defaultSettings: Array<[string, string, number]> = [
    ['project_name', process.env.PROJECT_NAME || 'Freya-san Hub', 0],
    ['project_version', process.env.PROJECT_VERSION || '5.0', 0],
    ['bot_name', process.env.BOT_NAME || 'Freya-san bot by Pak Ujan', 0],
    ['default_language', process.env.DEFAULT_LANGUAGE || 'id', 0],
    ['default_theme', process.env.DEFAULT_THEME || 'system', 0],
    ['blue_tick_enabled', 'false', 0],
    ['maintenance_mode', 'false', 0],
    ['auto_nexara', 'false', 0],
    ['antidelete_pc', 'false', 0],
    ['multi_room_concurrent', 'false', 0],
    ['owner_number_configured', process.env.OWNER_NUMBER || '+6285129878352', 1],
    ['redeem_global_cooldown_sec', '3', 0],
    ['redeem_max_balance_cap', '100000', 0],
    ['redeem_max_exp_cap', '50000', 0],
    ['redeem_max_level_cap', '50', 0],
    ['redeem_default_per_user_limit', '1', 0],
    ['redeem_msg_success', 'Kode {code} berhasil diklaim oleh {user}! Hadiah: {rewards}.', 0],
    ['redeem_msg_expired', 'Kode redeem {code} sudah kedaluwarsa.', 0],
    ['redeem_msg_limit', 'Kuota klaim untuk kode {code} sudah habis atau batas klaim Anda telah tercapai.', 0],
    ['redeem_msg_invalid', 'Kode redeem {code} tidak ditemukan atau sedang nonaktif.', 0],
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, is_secret) VALUES (?, ?, ?)',
  );
  db.transaction(() => {
    for (const [k, v, sec] of defaultSettings) {
      insertSetting.run(k, v, sec);
    }
  })();

  // 2. All 10 Default Prefixes active since install
  const insertPrefix = db.prepare(
    'INSERT OR IGNORE INTO prefixes (prefix, is_default, enabled, sort_order) VALUES (?, 1, 1, ?)',
  );
  db.transaction(() => {
    DEFAULT_PREFIXES.forEach((p, idx) => insertPrefix.run(p, idx));
  })();

  // 3. Complete Command Inventory Registry (ADD ONLY, NEVER REMOVE)
  const insertCmd = db.prepare(`
    INSERT OR IGNORE INTO commands (
      name, category, description, example, permission, status, enabled,
      cooldown_sec, daily_limit, balance_reward, exp_reward,
      required_provider, required_plugin, has_real_handler, is_owner_only,
      notes, source_correction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAlias = db.prepare(
    'INSERT OR IGNORE INTO command_aliases (alias, command_name) VALUES (?, ?)',
  );
  const insertCmdSettings = db.prepare(
    'INSERT OR IGNORE INTO command_settings (command_name) VALUES (?)',
  );

  db.transaction(() => {
    for (const cmd of ALL_COMMANDS) {
      insertCmd.run(
        cmd.name,
        cmd.category,
        cmd.description,
        cmd.example,
        cmd.permission,
        cmd.status,
        cmd.enabled ? 1 : 0,
        cmd.cooldownSec,
        cmd.dailyLimit,
        cmd.balanceReward,
        cmd.expReward,
        cmd.requiredProvider ?? null,
        cmd.requiredPlugin ?? null,
        cmd.hasRealHandler ? 1 : 0,
        cmd.isOwnerOnly ? 1 : 0,
        cmd.notes ?? null,
        cmd.sourceCorrection ?? null,
      );
      insertCmdSettings.run(cmd.name);
      for (const alias of cmd.aliases) {
        insertAlias.run(alias, cmd.name);
      }
    }
  })();

  // 4. Bot session row
  db.prepare(
    `INSERT OR IGNORE INTO bot_sessions (id, status) VALUES ('primary', 'disconnected')`,
  ).run();

  // 5. Plugins & AI Providers & Agents
  const insertPlugin = db.prepare(`
    INSERT OR IGNORE INTO plugins (id, name, version, description, enabled, status, requires_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insertPlugin.run('gemini-nexara', 'Gemini / Nexara Core', '5.0.0', 'Server-side @google/genai intelligence & research bridge.', 1, 'healthy', 1);
    insertPlugin.run('48group-official-monitor', '48Group Official Source Monitor', '5.0.0', 'Pemantau sumber resmi JKT48 & 48Group dengan antrean verifikasi.', 1, 'healthy', 0);
    insertPlugin.run('game-session-engine', 'Unified Game Session Engine', '5.0.0', 'Pengelola sesi permainan pribadi, grup, dan room multiplayer.', 1, 'healthy', 0);
    insertPlugin.run('downloader-provider', 'Media Downloader Adapter', '1.0.0', 'Adapter modular unduhan media eksternal (memerlukan konfigurasi endpoint eksternal).', 0, 'pending_config', 1);
    insertPlugin.run('sticker-processor', 'Sticker & WebP Media Adapter', '1.0.0', 'Adapter konversi gambar/video menjadi stiker WebP WhatsApp.', 0, 'pending_config', 0);
  })();

  db.prepare(`
    INSERT OR IGNORE INTO ai_providers (id, name, enabled, is_default, status, fallback_provider_id, system_prompt, persona_name)
    VALUES ('gemini-nexara', 'Nexara (Google Gemini)', 1, 1, 'ready', 'openai-compat',
      'Anda adalah Freya-san AI (Nexara) di Freya-san Hub. Jawab akurat, sopan, dalam Bahasa Indonesia secara default, dan jangan pernah mengarang fakta 48Group yang tidak memiliki sumber resmi.',
      'Freya-san AI')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO ai_providers (id, name, enabled, is_default, status, fallback_provider_id, system_prompt, persona_name)
    VALUES ('openai-compat', 'OpenAI Compatible Fallback', 0, 0, 'unconfigured', 'gemini-nexara',
      'Assistant fallback provider.',
      'Nexara Fallback')
  `).run();

  db.prepare(`INSERT OR IGNORE INTO ai_models (id, provider_id, model_name, capability, is_default) VALUES ('gemini-4-hydrogen', 'gemini-nexara', 'gemini-4-hydrogen', 'text', 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO ai_models (id, provider_id, model_name, capability, is_default) VALUES ('gemini-4-neon', 'gemini-nexara', 'gemini-4-neon', 'reasoning', 0)`).run();

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO ai_agents (id, name, role, permissions_json, autonomy_guard, status, benchmark_score, tasks_completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insertAgent.run('agent-researcher-48', '48Group Source Researcher', 'Official Source Discovery & Fact Verification', JSON.stringify(['read:48group', 'propose:verification']), 'owner_approval_for_publish', 'ready', 94.2, 12);
    insertAgent.run('agent-nexara-chat', 'Nexara Conversational Agent', 'User & Group Q&A Assistant', JSON.stringify(['read:public_docs', 'read:48group_verified']), 'strict_no_admin_mutations', 'ready', 91.8, 48);
    insertAgent.run('agent-ops-guard', 'Operations & Audit Guardian', 'Anomaly & Anti-Spam Monitor', JSON.stringify(['read:logs', 'propose:command_toggle']), 'approval_required', 'ready', 96.0, 9);
  })();

  // 6. Automations
  const insertAuto = db.prepare(`
    INSERT OR IGNORE INTO automations (id, name, trigger_type, cron_expr, enabled, requires_approval, status, run_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insertAuto.run('auto-48-source-check', 'Monitor Sumber Resmi 48Group', 'cron', '0 */6 * * *', 1, 0, 'scheduled', 4);
    insertAuto.run('auto-daily-48-challenge', 'Rotasi Tantangan Harian 48Group', 'cron', '0 0 * * *', 1, 0, 'scheduled', 12);
    insertAuto.run('auto-game-expiry-sweep', 'Pembersihan Sesi Game Kedaluwarsa', 'interval', '*/5 * * * *', 1, 0, 'scheduled', 84);
    insertAuto.run('auto-daily-limit-reset', 'Reset Limit Harian Pengguna', 'cron', '0 0 * * *', 1, 0, 'scheduled', 7);
  })();

  // 7. Game Registry Settings
  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO game_settings (game_id, name, domain, category, description, enabled, min_players, max_players, duration_sec, cooldown_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const g of GAME_REGISTRY) {
      insertGame.run(g.id, g.name, g.domain, g.category, g.description, g.enabled ? 1 : 0, g.minPlayers, g.maxPlayers, g.defaultDurationSec, g.cooldownSec);
    }
  })();

  // 8. Sample Redeem Codes (deterministic for testing)
  db.prepare(`
    INSERT OR IGNORE INTO redeem_codes (
      code, name, description, reward_balance, reward_exp, reward_level, reward_limit, reward_premium_days,
      additional_rewards_json, max_claims, per_user_limit, cooldown_sec, active, created_by
    ) VALUES (
      'FREYAHUB50', 'Welcome Pack Freya-san Hub', 'Paket hadiah perdana pengguna baru Freya-san Hub.',
      150, 50, 0, 10, 0, ?, 100, 1, 0, 1, 'system'
    )
  `).run(JSON.stringify([{ rewardId: 'daily_limit_bonus', params: { amount: 10 } }]));

  db.prepare(`
    INSERT OR IGNORE INTO redeem_codes (
      code, name, description, reward_balance, reward_exp, reward_level, reward_limit, reward_premium_days,
      additional_rewards_json, max_claims, per_user_limit, cooldown_sec, active, created_by
    ) VALUES (
      'JKT48THEATER', 'Theater Lover Pass', 'Hadiah penggemar theater JKT48 lengkap dengan badge eksklusif.',
      250, 100, 1, 15, 7, ?, 50, 1, 0, 1, 'system'
    )
  `).run(
    JSON.stringify([
      { rewardId: 'daily_limit_bonus', params: { amount: 15 } },
      { rewardId: 'premium_access', params: { days: 7 } },
      { rewardId: 'badge_reward', params: { badgeName: 'Theater Supporter', domain: '48group' } },
    ]),
  );

  // Backfill redeem_codes metadata for pre-existing rows
  db.prepare(`UPDATE redeem_codes SET name = 'Welcome Pack Freya-san Hub' WHERE code = 'FREYAHUB50' AND (name IS NULL OR name = '')`).run();
  db.prepare(`UPDATE redeem_codes SET name = 'Theater Lover Pass' WHERE code = 'JKT48THEATER' AND (name IS NULL OR name = '')`).run();

  // 9. Sample Users & Groups (safe demo records so dashboard tables & leaderboard are rich on first boot)
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, phone, display_name, role, language, is_premium, balance, exp, level, daily_limit, streak)
    VALUES (?, ?, ?, ?, 'id', ?, ?, ?, ?, ?, ?)
  `);
  const insertBalance = db.prepare(`INSERT OR IGNORE INTO balances (user_phone, amount) VALUES (?, ?)`);
  db.transaction(() => {
    insertUser.run('usr-web-guest', '6280000000001', 'Pengunjung Web', 'user', 0, 500, 120, 2, 25, 3);
    insertBalance.run('6280000000001', 500);
    insertUser.run('usr-demo-1', '6281234567890', 'Raka Pratama', 'user', 1, 840, 460, 5, 50, 9);
    insertBalance.run('6281234567890', 840);
    insertUser.run('usr-demo-2', '6281987654321', 'Nadia Kusuma', 'user', 0, 620, 310, 4, 25, 6);
    insertBalance.run('6281987654321', 620);
  })();

  db.prepare(`
    INSERT OR IGNORE INTO groups (id, name, owner_phone, member_count, is_rented, is_permanent, anti_settings_json)
    VALUES ('1203630001@g.us', 'Komunitas Theater JKT48 ID', '6281234567890', 48, 1, 1, ?)
  `).run(JSON.stringify({
    antilink: { enabled: false, mode: 'warn' },
    antiluar: { enabled: false, mode: 'warn' },
    antikudeta: { enabled: false, mode: 'log' },
    antibot: { enabled: false, mode: 'warn' },
    antigroupsw: { enabled: false, mode: 'warn' },
    antimentionsw: { enabled: false, mode: 'warn' },
  }));

  // 10. 48GROUP INTELLIGENCE CENTER SEED (10 Official Groups + Verified Members + Discography + Theater + Events + Terminology + Questions + Pending Review Queue)
  const insert48Group = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_groups (
      id, name, base_city, country, founded_year, status, official_site,
      description, sister_relation, validation_status, source_title, source_url, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'official_verified', ?, ?, ?)
  `);

  const groups48: Array<[string, string, string, string, number, string, string, string, string, string, string]> = [
    ['jkt48', 'JKT48', 'Jakarta', 'Indonesia', 2011, 'Aktif', 'https://jkt48.com/', 'Sister group pertama AKB48 di luar Jepang yang berbasis di Jakarta dengan teater permanen di fX Sudirman.', 'Sister group internasional pertama dari AKB48.', 'Situs Resmi JKT48', 'https://jkt48.com/about/jkt48?lang=id'],
    ['akb48', 'AKB48', 'Akihabara, Tokyo', 'Jepang', 2005, 'Aktif', 'https://www.akb48.co.jp/', 'Grup induk jaringan 48Group yang didirikan di Akihabara dengan konsep idola yang dapat ditemui setiap hari di teater.', 'Grup utama dan pendiri ekosistem 48Group.', 'AKB48 Official Website', 'https://www.akb48.co.jp/'],
    ['ske48', 'SKE48', 'Sakae, Nagoya', 'Jepang', 2008, 'Aktif', 'https://ske48.co.jp/', 'Sister group domestik pertama AKB48 yang berbasis di distrik Sakae, Nagoya.', 'Sister group domestik AKB48 (Nagoya).', 'SKE48 Official Website', 'https://ske48.co.jp/'],
    ['nmb48', 'NMB48', 'Namba, Osaka', 'Jepang', 2010, 'Aktif', 'https://www.nmb48.com/', 'Sister group yang berbasis di distrik Namba, Osaka dengan karakter komedi dan panggung khas Kansai.', 'Sister group domestik AKB48 (Osaka).', 'NMB48 Official Website', 'https://www.nmb48.com/'],
    ['hkt48', 'HKT48', 'Hakata, Fukuoka', 'Jepang', 2011, 'Aktif', 'https://www.hkt48.jp/', 'Sister group yang berbasis di Fukuoka, Pulau Kyushu.', 'Sister group domestik AKB48 (Fukuoka).', 'HKT48 Official Website', 'https://www.hkt48.jp/'],
    ['ngt48', 'NGT48', 'Niigata', 'Jepang', 2015, 'Aktif', 'https://ngt48.jp/', 'Sister group yang berbasis di Kota Niigata.', 'Sister group domestik AKB48 (Niigata).', 'NGT48 Official Website', 'https://ngt48.jp/'],
    ['stu48', 'STU48', 'Wilayah Setouchi', 'Jepang', 2017, 'Aktif', 'https://sp.stu48.com/', 'Sister group lintas tujuh prefektur di kawasan Laut Pedalaman Seto.', 'Sister group domestik AKB48 (Setouchi).', 'STU48 Official Website', 'https://sp.stu48.com/'],
    ['snh48', 'SNH48', 'Shanghai', 'Tiongkok', 2012, 'Independen', 'https://www.snh48.com/', 'Grup berbasis di Shanghai yang awalnya dibentuk sebagai sister group AKB48 sebelum beroperasi secara independen.', 'Mantan sister group AKB48 (beroperasi independen sejak 2016).', 'SNH48 Official Website', 'https://www.snh48.com/'],
    ['bnk48', 'BNK48', 'Bangkok', 'Thailand', 2017, 'Aktif', 'https://www.bnk48.com/', 'Sister group internasional AKB48 yang berbasis di Bangkok, Thailand.', 'Sister group internasional AKB48 (Bangkok).', 'BNK48 Official Website', 'https://www.bnk48.com/'],
    ['mnl48', 'MNL48', 'Manila', 'Filipina', 2018, 'Aktif', 'https://mnl48.ph/', 'Sister group internasional AKB48 yang berbasis di Manila, Filipina.', 'Sister group internasional AKB48 (Manila).', 'MNL48 Official Website', 'https://mnl48.ph/'],
  ];

  db.transaction(() => {
    for (const g of groups48) {
      insert48Group.run(...g, nowIso);
    }
  })();

  const insert48Gen = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_generations (id, group_id, gen_label, debut_year, notes, source_url, retrieved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insert48Gen.run('jkt48-gen1', 'jkt48', 'Generasi 1', 2011, 'Generasi perdana JKT48 yang diperkenalkan pada November 2011.', 'https://jkt48.com/about/jkt48?lang=id', nowIso);
    insert48Gen.run('jkt48-gen3', 'jkt48', 'Generasi 3', 2014, 'Diperkenalkan pada 2014; melahirkan struktur Team T.', 'https://jkt48.com/', nowIso);
    insert48Gen.run('jkt48-gen7', 'jkt48', 'Generasi 7', 2018, 'Diperkenalkan sebagai Academy Class B pada 2018.', 'https://jkt48.com/', nowIso);
    insert48Gen.run('jkt48-gen9', 'jkt48', 'Generasi 9', 2019, 'Diperkenalkan pada Desember 2019.', 'https://jkt48.com/', nowIso);
    insert48Gen.run('jkt48-gen10', 'jkt48', 'Generasi 10', 2020, 'Diperkenalkan tahun 2020 dan resmi beraktivitas kembali pada 2021.', 'https://jkt48.com/', nowIso);
    insert48Gen.run('jkt48-gen11', 'jkt48', 'Generasi 11', 2022, 'Diperkenalkan pada Halloween Event Oktober 2022.', 'https://jkt48.com/', nowIso);
    insert48Gen.run('jkt48-gen12', 'jkt48', 'Generasi 12', 2023, 'Diperkenalkan pada Jak-Japan Matsuri November 2023.', 'https://jkt48.com/', nowIso);
    insert48Gen.run('akb48-gen1', 'akb48', '1st Generation', 2005, 'Generasi pembuka AKB48 Theater pada Desember 2005.', 'https://www.akb48.co.jp/', nowIso);
  })();

  const insert48Member = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_members (
      id, name, nickname, group_id, generation, status, joined_date, graduated_date,
      bio, career_notes, validation_status, source_title, source_url, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official_verified', ?, ?, ?)
  `);

  db.transaction(() => {
    insert48Member.run('jkt48-freya', 'Freya Jayawardana', 'Freya', 'jkt48', 'Generasi 7', 'Member Aktif', '2018-09-29', null, 'Member JKT48 Generasi 7 yang aktif dalam berbagai pertunjukan theater dan senbatsu.', 'Bergabung di JKT48 Academy Class B (2018), dipromosikan ke Team T, lalu menjadi bagian dari formasi New Era JKT48.', 'Profil Resmi Member JKT48', 'https://jkt48.com/member/list?lang=id', nowIso);
    insert48Member.run('jkt48-gracia', 'Shania Gracia', 'Gracia', 'jkt48', 'Generasi 3', 'Member Aktif', '2014-03-15', null, 'Member JKT48 Generasi 3 dan Kapten JKT48.', 'Bergabung pada 2014 melalui Generasi 3, pernah menjadi kapten Team KIII dan ditunjuk sebagai Kapten JKT48.', 'Profil Resmi Member JKT48', 'https://jkt48.com/member/list?lang=id', nowIso);
    insert48Member.run('jkt48-christy', 'Angelina Christy', 'Christy', 'jkt48', 'Generasi 7', 'Member Aktif', '2018-09-29', null, 'Member JKT48 Generasi 7 yang kerap mengisi posisi senbatsu.', 'Memulai debut melalui JKT48 Academy Class B pada 2018.', 'Profil Resmi Member JKT48', 'https://jkt48.com/member/list?lang=id', nowIso);
    insert48Member.run('jkt48-marsha', 'Marsha Lenathea', 'Marsha', 'jkt48', 'Generasi 9', 'Member Aktif', '2019-12-01', null, 'Member JKT48 Generasi 9.', 'Diperkenalkan bersama Generasi 9 pada 2019 dan aktif dalam pertunjukan New Era.', 'Profil Resmi Member JKT48', 'https://jkt48.com/member/list?lang=id', nowIso);
    insert48Member.run('jkt48-shani', 'Shani Indira Natio', 'Shani', 'jkt48', 'Generasi 3', 'Lulus / Mantan Member', '2014-03-15', '2024-05-11', 'Mantan Kapten JKT48 dari Generasi 3 yang kini menjabat sebagai Wakil Manajer Umum Theater JKT48.', 'Meraih peringkat pertama Pemilihan Member Single ke-20 dan menjabat Kapten JKT48 hingga kelulusan pada 2024.', 'Berita Resmi JKT48', 'https://jkt48.com/news/list?lang=id', nowIso);
    insert48Member.run('jkt48-melody', 'Melody Nurramdhani Laksani', 'Melody', 'jkt48', 'Generasi 1', 'Lulus / Mantan Member', '2011-11-02', '2018-03-31', 'Member perintis Generasi 1 JKT48 dan kini General Manager Theater JKT48.', 'Center di berbagai single awal JKT48 sebelum lulus pada 2018 dan melanjutkan peran manajemen theater.', 'Profil Resmi Manajemen JKT48', 'https://jkt48.com/about/jkt48?lang=id', nowIso);
    insert48Member.run('akb48-oguri', 'Yui Oguri', 'Yuiyui', 'akb48', 'Team 8', 'Member Aktif', '2014-04-03', null, 'Member AKB48 perwakilan Tokyo (Team 8) yang beberapa kali menjadi center single AKB48.', 'Debut di Team 8 pada 2014 dan menjadi center pada single Teacher Teacher serta Idol Nanka Janakattara.', 'AKB48 Official Profile', 'https://www.akb48.co.jp/about/members/', nowIso);
    insert48Member.run('bnk48-cherprang', 'Cherprang Areekul', 'Cherprang', 'bnk48', '1st Generation', 'Lulus / Mantan Member', '2017-02-12', '2023-10-29', 'Mantan Kapten pertama BNK48 dari Generasi 1.', 'Berperan sebagai kapten BNK48 dan kini bertugas di posisi manajerial Shihainin BNK48.', 'BNK48 Official Website', 'https://www.bnk48.com/', nowIso);
  })();

  const insert48Disco = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_discography (
      id, group_id, title, release_type, release_date, center_member, label, senbatsu_notes,
      source_title, source_url, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insert48Disco.run('jkt48-heavy-rotation', 'jkt48', 'Heavy Rotation', 'Album Perdana', '2013-02-16', 'Melody Nurramdhani Laksani', 'HITS Records', 'Album studio perdana JKT48 berisi lagu-lagu panggung awal.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);
    insert48Disco.run('jkt48-river', 'jkt48', 'RIVER', 'Single ke-1', '2013-05-11', 'Melody Nurramdhani Laksani & Devi Kinal Putri', 'HITS Records', 'Single fisik perdana JKT48.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);
    insert48Disco.run('jkt48-fortune-cookie', 'jkt48', 'Fortune Cookie yang Mencinta', 'Single ke-3', '2013-08-21', 'Haruka Nakagawa', 'HITS Records', 'Dirilis serentak dengan AKB48 dengan Haruka Nakagawa sebagai center.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);
    insert48Disco.run('jkt48-rapsodi', 'jkt48', 'Rapsodi', 'Single ke-21 (Original)', '2020-01-22', 'Shani Indira Natio', 'HITS Records', 'Single original pertama JKT48 hasil Pemilihan Member ke-20.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);
    insert48Disco.run('jkt48-magic-hour', 'jkt48', 'Magic Hour', 'Single ke-25 (Original)', '2024-05-09', 'Marsha Lenathea & Angelina Christy', 'Indonesia Musik Nusantara', 'Single original JKT48 dengan konsep dual center.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);
    insert48Disco.run('akb48-heavy-rotation', 'akb48', 'Heavy Rotation', 'Single ke-17', '2010-08-18', 'Yuko Oshima', 'King Records', 'Salah satu single paling ikonik dalam sejarah AKB48.', 'AKB48 Discography', 'https://www.akb48.co.jp/about/discography/', nowIso);
  })();

  const insert48Theater = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_theater (
      id, group_id, setlist_name, stage_number, opening_song, tracklist_json, period, notes, source_url, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insert48Theater.run('jkt48-pajama-drive', 'jkt48', 'Pajama Drive', 'Kenkyuusei / Generasi Stage', 'Shonichi (Hari Pertama)', JSON.stringify(['Shonichi', 'Hissatsu Teleport', 'Gokigen Naname na Mermaid', 'Futari Nori no Jitensha', 'Tenshi no Shippo', 'Pajama Drive']), '2012 - Sekarang (Revival)', 'Setlist legendaris bagi generasi baru dan trainee JKT48.', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
    insert48Theater.run('jkt48-aturan-anti-cinta', 'jkt48', 'Aturan Anti Cinta (Renai Kinshi Jourei)', 'Team J 1st / New Era', 'Nagai Hikari', JSON.stringify(['Nagai Hikari', 'Squall no Aida ni', 'JK Nemurihime', 'Kimi ni Au Tabi Koi wo Suru', 'Kuroi Tenshi', 'Heart Gata Virus']), '2012 - Sekarang', 'Setlist klasik Theater JKT48 yang dibawakan kembali pada format New Era.', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
    insert48Theater.run('jkt48-ramune', 'jkt48', 'Cara Meminum Ramune (Ramune no Nomikata)', 'Team KIII / New Era', 'Kizashi', JSON.stringify(['Kizashi', 'Koutei no Koinu', 'Disco Hokenshitsu', 'Omatase Set list', 'Cross', 'Finland Miracle']), '2020 - Sekarang', 'Setlist adaptasi SKE48 Team KII dengan nomor lagu penuh energi.', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
    insert48Theater.run('jkt48-aitakatta', 'jkt48', 'Ingin Bertemu (Aitakatta)', 'Trainee Stage', 'Nageki no Figure', JSON.stringify(['Nageki no Figure', 'Namida no Shounan', 'Aitakatta', 'Nagisa no CHERRY', 'Glass no I LOVE YOU', 'Koi no PLAN']), '2023 - Sekarang', 'Setlist pertunjukan reguler bagi trainee Generasi terbaru.', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
  })();

  const insert48Event = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_events (
      id, group_id, title, event_type, event_date, venue, summary, source_title, source_url, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insert48Event.run('evt-jkt48-theater-reguler', 'jkt48', 'Pertunjukan Reguler Theater JKT48', 'Theater', 'Jadwal Mingguan Resmi', 'Theater JKT48, fX Sudirman Lt. 4 Jakarta', 'Jadwal pertunjukan reguler dan seitansai diperbarui melalui halaman jadwal resmi JKT48.', 'Jadwal Theater JKT48', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
    insert48Event.run('evt-jkt48-vc-mng', 'jkt48', 'Video Call & Meet and Greet Resmi', 'Meet and Greet', 'Sesuai Pengumuman Periode Single', 'Portal Resmi JKT48', 'Sesi interaksi penggemar resmi berdasarkan kepemilikan tiket digital periode aktif.', 'Pengumuman Resmi JKT48', 'https://jkt48.com/news/list?lang=id', nowIso);
    insert48Event.run('evt-akb48-theater', 'akb48', 'AKB48 Theater Live Performance', 'Theater', 'Jadwal Harian Resmi', 'AKB48 Theater, Don Quijote Akihabara 8F', 'Pertunjukan panggung harian AKB48 yang diumumkan via portal resmi.', 'AKB48 Theater Schedule', 'https://www.akb48.co.jp/theater/', nowIso);
  })();

  const insert48Term = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_terminology (id, term, category, definition, source_url, retrieved_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insert48Term.run('term-jiko', 'Jikoshoukai (Jiko)', 'Budaya Panggung', 'Perkenalan diri khas setiap member di atas panggung teater atau konser yang disertai frasa pengenalan unik (catchphrase).', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-oshimen', 'Oshimen', 'Istilah Fandom', 'Member yang paling didukung atau difavoritkan oleh seorang penggemar (singkatan dari Oshi Member).', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-senbatsu', 'Senbatsu', 'Sistem Grup', 'Sekelompok member terpilih yang membawakan lagu utama pada sebuah single atau tampil di acara tertentu.', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-undergirls', 'Undergirls', 'Sistem Grup', 'Formasi member di luar jajaran Senbatsu utama (misalnya peringkat 13-24 pada pemilihan) yang membawakan lagu pendamping (coupling song).', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-kenkyuusei', 'Kenkyuusei / Trainee', 'Struktur Generasi', 'Anggota pelatihan yang masih berstatus siswi pelatihan sebelum dipromosikan menjadi member inti.', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-theater', 'Theater', 'Infrastruktur Utama', 'Teater permanen tempat grup 48 membawakan pertunjukan setlist secara rutin di hadapan penggemar.', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
    insert48Term.run('term-handshake', 'Handshake / Meet & Greet', 'Acara Resmi', 'Acara tatap muka resmi antara penggemar dan member menggunakan tiket yang diperoleh dari rilisan resmi.', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-graduation', 'Graduation (Kelulusan)', 'Tradisi Grup', 'Proses perpisahan resmi seorang member yang menyelesaikan masa aktivitasnya di grup.', 'https://jkt48.com/', nowIso);
    insert48Term.run('term-seitansai', 'Seitansai', 'Tradisi Theater', 'Pertunjukan teater spesial untuk merayakan ulang tahun seorang member bersama penggemar.', 'https://jkt48.com/', nowIso);
  })();

  const insert48Source = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_sources (id, group_id, source_name, url, source_type, auto_discovered, last_checked_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `);
  db.transaction(() => {
    insert48Source.run('src-jkt48-web', 'jkt48', 'JKT48 Official Website', 'https://jkt48.com/', 'official_website', 0, nowIso);
    insert48Source.run('src-akb48-web', 'akb48', 'AKB48 Official Website', 'https://www.akb48.co.jp/', 'official_website', 0, nowIso);
    insert48Source.run('src-bnk48-web', 'bnk48', 'BNK48 Official Website', 'https://www.bnk48.com/', 'official_website', 0, nowIso);
    insert48Source.run('src-mnl48-web', 'mnl48', 'MNL48 Official Website', 'https://mnl48.ph/', 'official_website', 0, nowIso);
  })();

  // Pending Verification Item (demonstrates Data Update Workflow Section 11.18: Owner Approval before publishing!)
  db.prepare(`
    INSERT OR IGNORE INTO forty_eight_verifications (
      id, entity_type, entity_id, entity_name, group_id, proposed_payload_json,
      source_title, source_url, info_status, approval_status, retrieved_at
    ) VALUES (?, 'event', 'evt-jkt48-anniv-pending', 'Pembaruan Jadwal Pertunjukan Khusus Theater JKT48', 'jkt48', ?,
      'Pengumuman Resmi Situs JKT48', 'https://jkt48.com/news/list?lang=id', 'pending_review', 'pending', ?)
  `).run(
    'ver-pending-001',
    JSON.stringify({
      title: 'Pembaruan Jadwal Pertunjukan Khusus Theater JKT48',
      eventType: 'Theater',
      venue: 'Theater JKT48, fX Sudirman',
      summary: 'Menunggu konfirmasi detail tanggal dari halaman pengumuman resmi JKT48 sebelum dipublikasikan ke kalender utama.',
    }),
    nowIso,
  );

  // 10.5 JKT48 Eras, Teams, Historical Team Links, Extended Members & Level 1/2/3 Questions
  const insertEra = db.prepare(`
    INSERT OR IGNORE INTO jkt48_eras (
      id, level_order, title, difficulty_label, era_category, period_range, description, verification_status, source_title, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const era of JKT48_DIFFICULTY_LEVELS) {
      insertEra.run(
        era.id,
        era.levelOrder,
        era.title,
        era.difficultyLabel,
        era.eraCategory,
        era.periodRange,
        era.description,
        era.verificationStatus,
        era.sourceTitle,
        era.sourceUrl,
      );
    }
  })();

  const insertTeam = db.prepare(`
    INSERT OR IGNORE INTO jkt48_teams (
      id, team_group, name, historical_status, era_summary, description, verification_status, source_title, source_url, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const team of JKT48_TEAMS) {
      insertTeam.run(
        team.id,
        team.teamGroup,
        team.name,
        team.historicalStatus,
        team.eraSummary,
        team.description,
        team.verificationStatus,
        team.sourceTitle,
        team.sourceUrl,
        team.sortOrder,
      );
    }
  })();

  // Additional verified generations, members (including graduates & Level 1/2/3 coverage), discography, theater, and team history
  db.transaction(() => {
    insert48Gen.run('jkt48-gen2', 'jkt48', 'Generasi 2', 2012, 'Diperkenalkan pada November 2012; cikal bakal terbentuknya Team KIII.', 'https://jkt48.com/about/jkt48?lang=id', nowIso);
    insert48Gen.run('jkt48-gen8', 'jkt48', 'Generasi 8', 2019, 'Diperkenalkan sebagai Academy Class B pada April 2019.', 'https://jkt48.com/', nowIso);

    insert48Member.run('jkt48-haruka', 'Haruka Nakagawa', 'Haruka', 'jkt48', 'Generasi 3 AKB48 (Transfer JKT48)', 'Lulus / Mantan Member', '2012-11-01', '2016-12-30', 'Mantan member AKB48 yang ditransfer ke JKT48 pada 2012 dan menjabat Kapten Team T.', 'Menjadi center single Fortune Cookie yang Mencinta dan kapten pertama Team T sebelum lulus pada Desember 2016.', 'Arsip Resmi JKT48', 'https://jkt48.com/about/jkt48?lang=id', nowIso);
    insert48Member.run('jkt48-veranda', 'Jessica Veranda', 'Ve', 'jkt48', 'Generasi 1', 'Lulus / Mantan Member', '2011-11-02', '2017-05-25', 'Member Generasi 1 Team J yang meraih posisi #1 Senbatsu Sousenkyo dua kali berturut-turut (2015 & 2016).', 'Berperan di Team J sejak debut hingga kelulusan pada Mei 2017.', 'Arsip Resmi JKT48', 'https://jkt48.com/about/jkt48?lang=id', nowIso);
    insert48Member.run('jkt48-greesel', 'Greesella Adhalia', 'Greesel', 'jkt48', 'Generasi 11', 'Member Aktif', '2022-10-31', null, 'Member JKT48 Generasi 11 yang aktif pada era New Era – Fight Era.', 'Diperkenalkan pada Oktober 2022 sebagai Generasi 11 JKT48.', 'Profil Resmi Member JKT48', 'https://jkt48.com/member/list?lang=id', nowIso);
    insert48Member.run('jkt48-fiony', 'Fiony Alveria', 'Fiony', 'jkt48', 'Generasi 8', 'Member Aktif', '2019-04-27', null, 'Member JKT48 Generasi 8 yang aktif dari Era One hingga New Era.', 'Pernah tergabung di Team T sebelum restrukturisasi JKT48 ONE 2021.', 'Profil Resmi Member JKT48', 'https://jkt48.com/member/list?lang=id', nowIso);

    insert48Disco.run('jkt48-darashinai', 'jkt48', 'Cara Ceroboh untuk Mencinta (Darashinai Aishikata)', 'Single ke-22 (Era One)', '2021-03-16', 'Shani Indira Natio', 'Indonesia Musik Nusantara', 'Single pertama pada era JKT48 ONE dengan formasi 33 member.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);
    insert48Disco.run('jkt48-flying-high', 'jkt48', 'Flying High', 'Single ke-23 (Original New Era)', '2022-06-17', 'Azizi Asadel', 'Indonesia Musik Nusantara', 'Single original kedua JKT48 sekaligus pembuka proyek New Era.', 'Diskografi Resmi JKT48', 'https://jkt48.com/discography?lang=id', nowIso);

    insert48Theater.run('jkt48-banzai', 'jkt48', 'Banzai JKT48', '10th Anniversary / Era One Stage', 'Banzai Venus', JSON.stringify(['Banzai Venus', 'Kimi no Koto ga Suki Dakara', 'Shonichi', 'Seifuku ga Jama wo Suru', 'Oogoe Diamond']), '2022 (Era One -> New Era)', 'Setlist spesial perayaan 10 tahun JKT48 pada masa transisi Era One.', 'https://jkt48.com/theater/schedule?lang=id', nowIso);
    insert48Event.run('evt-jkt48-one-2021', 'jkt48', 'Peluncuran Format JKT48 ONE', 'Restrukturisasi Resmi', '2021-03-16', 'Theater JKT48 Jakarta', 'Transisi resmi dari sistem Team J, KIII, T ke format JKT48 ONE pada Maret 2021.', 'Pengumuman Resmi JKT48', 'https://jkt48.com/news/list?lang=id', nowIso);
  })();

  // Backfill JKT48 era_id, difficulty_level, team_group, primary_team_id on existing records if NULL
  db.transaction(() => {
    const genMap: Array<[string, string, string]> = [
      ['jkt48-gen1', 'level_3', 'level_3'],
      ['jkt48-gen2', 'level_3', 'level_3'],
      ['jkt48-gen3', 'level_3', 'level_3'],
      ['jkt48-gen7', 'level_1', 'level_1'],
      ['jkt48-gen8', 'level_2', 'level_2'],
      ['jkt48-gen9', 'level_1', 'level_1'],
      ['jkt48-gen10', 'level_2', 'level_2'],
      ['jkt48-gen11', 'level_1', 'level_1'],
      ['jkt48-gen12', 'level_1', 'level_1'],
    ];
    for (const [id, eraId, lvl] of genMap) {
      db.prepare(`UPDATE forty_eight_generations SET era_id = COALESCE(era_id, ?), difficulty_level = COALESCE(difficulty_level, ?) WHERE id = ?`).run(eraId, lvl, id);
    }

    const memberMeta: Array<[string, string, string, string, string]> = [
      ['jkt48-freya', 'level_1', 'level_1', 'team_t', 'old'],
      ['jkt48-gracia', 'level_1', 'level_1', 'team_kiii', 'old'],
      ['jkt48-christy', 'level_1', 'level_1', 'team_kiii', 'old'],
      ['jkt48-marsha', 'level_1', 'level_1', 'team_unassigned', 'other'],
      ['jkt48-shani', 'level_1', 'level_1', 'team_kiii', 'old'],
      ['jkt48-melody', 'level_3', 'level_3', 'team_j', 'old'],
      ['jkt48-haruka', 'level_3', 'level_3', 'team_t', 'old'],
      ['jkt48-veranda', 'level_3', 'level_3', 'team_j', 'old'],
      ['jkt48-greesel', 'level_1', 'level_1', 'team_unassigned', 'other'],
      ['jkt48-fiony', 'level_2', 'level_2', 'team_t', 'old'],
    ];
    for (const [id, eraId, lvl, teamId, tGroup] of memberMeta) {
      db.prepare(`
        UPDATE forty_eight_members
        SET era_id = COALESCE(era_id, ?),
            difficulty_level = COALESCE(difficulty_level, ?),
            primary_team_id = COALESCE(primary_team_id, ?),
            team_group = COALESCE(team_group, ?)
        WHERE id = ?
      `).run(eraId, lvl, teamId, tGroup, id);
    }

    const discoMeta: Array<[string, string]> = [
      ['jkt48-heavy-rotation', 'level_3'],
      ['jkt48-river', 'level_3'],
      ['jkt48-fortune-cookie', 'level_3'],
      ['jkt48-rapsodi', 'level_3'],
      ['jkt48-darashinai', 'level_2'],
      ['jkt48-flying-high', 'level_1'],
      ['jkt48-magic-hour', 'level_1'],
    ];
    for (const [id, eraId] of discoMeta) {
      db.prepare(`UPDATE forty_eight_discography SET era_id = COALESCE(era_id, ?), difficulty_level = COALESCE(difficulty_level, ?) WHERE id = ?`).run(eraId, eraId, id);
    }

    const theaterMeta: Array<[string, string]> = [
      ['jkt48-pajama-drive', 'level_3'],
      ['jkt48-aturan-anti-cinta', 'level_3'],
      ['jkt48-ramune', 'level_2'],
      ['jkt48-banzai', 'level_2'],
      ['jkt48-aitakatta', 'level_1'],
    ];
    for (const [id, eraId] of theaterMeta) {
      db.prepare(`UPDATE forty_eight_theater SET era_id = COALESCE(era_id, ?), difficulty_level = COALESCE(difficulty_level, ?) WHERE id = ?`).run(eraId, eraId, id);
    }

    const eventMeta: Array<[string, string]> = [
      ['evt-jkt48-theater-reguler', 'level_1'],
      ['evt-jkt48-vc-mng', 'level_1'],
      ['evt-jkt48-one-2021', 'level_2'],
    ];
    for (const [id, eraId] of eventMeta) {
      db.prepare(`UPDATE forty_eight_events SET era_id = COALESCE(era_id, ?), difficulty_level = COALESCE(difficulty_level, ?) WHERE id = ?`).run(eraId, eraId, id);
    }
  })();

  // Seed multi-team historical transfers (without fabricating unverified dates)
  const insertTeamHist = db.prepare(`
    INSERT OR IGNORE INTO jkt48_member_team_history (
      id, member_id, team_id, role_in_team, joined_at, left_at, era_id, notes, validation_status, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    insertTeamHist.run('mth-freya-t', 'jkt48-freya', 'team_t', 'Member Team T', '2020-06-01', '2021-03-12', 'level_3', 'Promosi dari Academy Class A ke Team T hingga restrukturisasi JKT48 ONE.', 'official_verified', 'https://jkt48.com/member/list?lang=id');
    insertTeamHist.run('mth-freya-one', 'jkt48-freya', 'team_unassigned', 'JKT48 ONE / New Era', '2021-03-16', null, 'level_1', 'Aktif di era JKT48 ONE hingga New Era – Fight Era.', 'official_verified', 'https://jkt48.com/member/list?lang=id');
    insertTeamHist.run('mth-gracia-t', 'jkt48-gracia', 'team_t', 'Member Team T', '2015-01-24', '2016-11-30', 'level_3', 'Anggota generasi awal Team T.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-gracia-kiii', 'jkt48-gracia', 'team_kiii', 'Kapten Team KIII', '2016-12-01', '2021-03-13', 'level_3', 'Dipindahkan ke Team KIII dan sempat menjabat sebagai Kapten Team KIII.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-christy-kiii', 'jkt48-christy', 'team_kiii', 'Member Team KIII', '2019-07-21', '2021-03-13', 'level_3', 'Dipromosikan dari Academy Class A ke Team KIII.', 'official_verified', 'https://jkt48.com/member/list?lang=id');
    insertTeamHist.run('mth-shani-t', 'jkt48-shani', 'team_t', 'Member Team T', '2015-01-24', '2016-11-30', 'level_3', 'Anggota formasi awal Team T.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-shani-kiii', 'jkt48-shani', 'team_kiii', 'Member Team KIII', '2016-12-01', '2021-03-13', 'level_3', 'Aktif di Team KIII sebelum era JKT48 ONE & menjabat Kapten JKT48.', 'official_verified', 'https://jkt48.com/news/list?lang=id');
    insertTeamHist.run('mth-melody-j', 'jkt48-melody', 'team_j', 'Member & Kapten JKT48', '2012-12-23', '2018-03-31', 'level_3', 'Formasi awal Team J dan pernah merangkap posisi Team T.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-melody-t', 'jkt48-melody', 'team_t', 'Member / Kapten Team T (Rangkap)', '2016-12-01', '2018-03-31', 'level_3', 'Merangkap di Team T sebagai kapten hingga kelulusan 2018.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-haruka-j', 'jkt48-haruka', 'team_j', 'Member Team J', '2012-12-23', '2015-08-01', 'level_3', 'Tergabung di Team J setelah transfer dari AKB48.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-haruka-t', 'jkt48-haruka', 'team_t', 'Kapten Team T', '2015-08-01', '2016-12-30', 'level_3', 'Dipindahkan menjadi Kapten Team T hingga kelulusan.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-veranda-j', 'jkt48-veranda', 'team_j', 'Member Team J', '2012-12-23', '2017-05-25', 'level_3', 'Aktif penuh di Team J hingga kelulusan pada Mei 2017.', 'official_verified', 'https://jkt48.com/about/jkt48?lang=id');
    insertTeamHist.run('mth-fiony-t', 'jkt48-fiony', 'team_t', 'Member Team T', '2020-06-01', '2021-03-12', 'level_2', 'Anggota Team T sebelum transisi JKT48 ONE (Era One).', 'official_verified', 'https://jkt48.com/member/list?lang=id');
    insertTeamHist.run('mth-marsha-one', 'jkt48-marsha', 'team_unassigned', 'JKT48 ONE / New Era', '2021-03-16', null, 'level_1', 'Masuk langsung ke formasi JKT48 ONE sejak restrukturisasi.', 'official_verified', 'https://jkt48.com/member/list?lang=id');
    insertTeamHist.run('mth-greesel-one', 'jkt48-greesel', 'team_unassigned', 'Generasi 11 / New Era', '2022-10-31', null, 'level_1', 'Diperkenalkan pada New Era (2022) di luar sistem Team lama.', 'official_verified', 'https://jkt48.com/member/list?lang=id');
  })();

  // Verified 48Group Questions Bank (STRICTLY official_verified only, tagged with JKT48 Level 1 / Level 2 / Level 3 & Team!)
  const insert48Q = db.prepare(`
    INSERT OR IGNORE INTO forty_eight_questions (
      id, category, difficulty, group_id, era_id, difficulty_level, team_id, generation,
      question, options_json, correct_answer, explanation, hint_1, hint_2, source_url, validation_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official_verified')
  `);

  const qBank: Array<[string, string, string, string, string | null, string | null, string | null, string | null, string, string[], string, string, string, string, string]> = [
    ['q48-01', 'member', 'easy', 'jkt48', 'level_1', 'level_1', 'team_t', 'Generasi 7', 'Dari generasi berapakah Freya Jayawardana berasal di JKT48?', ['Generasi 5', 'Generasi 7', 'Generasi 8', 'Generasi 9'], 'Generasi 7', 'Freya Jayawardana bergabung ke JKT48 sebagai bagian dari Generasi 7 pada September 2018.', 'Ia debut di JKT48 Academy Class B tahun 2018.', 'Generasinya berada di antara Gen 6 dan Gen 8.', 'https://jkt48.com/member/list?lang=id'],
    ['q48-02', 'group', 'easy', 'jkt48', 'level_3', 'level_3', 'team_j', 'Generasi 1', 'Pada tahun berapakah JKT48 pertama kali dibentuk sebagai sister group internasional pertama AKB48?', ['2009', '2011', '2013', '2015'], '2011', 'JKT48 dibentuk pada tahun 2011 dan memperkenalkan Generasi 1 pada November 2011.', 'Terjadi 6 tahun setelah AKB48 berdiri pada 2005.', 'Tahunnya ganjil di awal dekade 2010-an.', 'https://jkt48.com/about/jkt48?lang=id'],
    ['q48-03', 'discography', 'normal', 'jkt48', 'level_3', 'level_3', 'team_kiii', 'Generasi 3', 'Siapakah center utama pada single original pertama JKT48 berjudul "Rapsodi" (2020)?', ['Melody Nurramdhani Laksani', 'Shani Indira Natio', 'Haruka Nakagawa', 'Shania Gracia'], 'Shani Indira Natio', 'Shani Indira Natio meraih peringkat 1 pada Pemilihan Member Single ke-20 dan menjadi center Rapsodi.', 'Berasal dari Generasi 3 JKT48.', 'Kini menjabat sebagai Wakil Manajer Umum Theater JKT48.', 'https://jkt48.com/discography?lang=id'],
    ['q48-04', 'theater', 'normal', 'jkt48', 'level_3', 'level_3', 'team_j', 'Generasi 1', 'Lagu apakah yang menjadi lagu pembuka ikonik dari setlist Theater JKT48 "Pajama Drive"?', ['Nagai Hikari', 'Shonichi', 'Kizashi', 'Aitakatta'], 'Shonichi', 'Shonichi (Hari Pertama) selalu membuka pertunjukan setlist Pajama Drive.', 'Arti judul lagunya dalam bahasa Indonesia adalah "Hari Pertama".', 'Dimulai dengan teriakan semangat sebelum tirai panggung terbuka.', 'https://jkt48.com/theater/schedule?lang=id'],
    ['q48-05', 'group', 'normal', 'akb48', null, null, null, null, 'Di kota manakah basis teater permanen grup NMB48 berada?', ['Nagoya', 'Osaka', 'Fukuoka', 'Niigata'], 'Osaka', 'NMB48 berbasis di distrik Namba, Osaka (singkatan NMB berasal dari Namba).', 'Berada di wilayah Kansai.', 'Kotanya terkenal dengan distrik Dotonbori dan Namba.', 'https://www.nmb48.com/'],
    ['q48-06', 'terminology', 'easy', 'jkt48', 'level_1', 'level_1', 'team_unassigned', null, 'Apa arti istilah "Oshimen" dalam budaya komunitas 48Group?', ['Lagu penutup konser', 'Member yang paling didukung/difavoritkan penggemar', 'Sistem rotasi generasi', 'Tiket masuk theater reguler'], 'Member yang paling didukung/difavoritkan penggemar', 'Oshimen berasal dari kata "Oshi" (mendukung) dan "Member".', 'Merupakan gabungan dua kata dalam bahasa Jepang-Inggris fandom.', 'Istilah ini dipakai oleh penggemar untuk menyebut member favoritnya.', 'https://jkt48.com/'],
    ['q48-07', 'discography', 'hard', 'jkt48', 'level_3', 'level_3', 'team_j', 'Generasi 1', 'Apakah judul single fisik ke-1 JKT48 yang dirilis pada Mei 2013?', ['Heavy Rotation', 'RIVER', 'Yuuhi wo Miteiruka?', 'Koisuru Fortune Cookie'], 'RIVER', 'Heavy Rotation adalah album studio perdana, sedangkan RIVER adalah single fisik pertama JKT48.', 'Judulnya berarti "Sungai" dalam bahasa Inggris.', 'Melody dan Kinal menjadi dua posisi depan pada single ini.', 'https://jkt48.com/discography?lang=id'],
    ['q48-08', 'generation', 'hard', 'jkt48', 'level_1', 'level_1', 'team_unassigned', 'Generasi 9', 'Siapakah dua member yang menempati posisi dual center pada single original JKT48 ke-25 "Magic Hour" (2024)?', ['Freya & Gracia', 'Marsha Lenathea & Angelina Christy', 'Shani & Christy', 'Melody & Haruka'], 'Marsha Lenathea & Angelina Christy', 'Magic Hour dirilis pada Mei 2024 dengan Marsha Lenathea dan Angelina Christy sebagai dual center.', 'Salah satunya berasal dari Generasi 7 dan satunya dari Generasi 9.', 'Julukan mereka adalah Christy dan Marsha.', 'https://jkt48.com/discography?lang=id'],
    ['q48-09', 'theater', 'hard', 'jkt48', 'level_2', 'level_2', 'team_kiii', null, 'Setlist "Cara Meminum Ramune (Ramune no Nomikata)" awalnya merupakan setlist milik grup mana sebelum diadaptasi oleh JKT48?', ['HKT48', 'SKE48', 'NGT48', 'NMB48'], 'SKE48', 'Ramune no Nomikata merupakan setlist original milik SKE48 Team KII.', 'Grup tersebut berbasis di Sakae, Nagoya.', 'Dikenal dengan lagu pembuka Kizashi.', 'https://ske48.co.jp/'],
    ['q48-10', 'timeline', 'expert', 'akb48', null, null, null, null, 'Manakah urutan tahun pembentukan grup 48Group berikut yang benar dari paling awal ke paling baru?', ['AKB48 (2005) -> SKE48 (2008) -> JKT48 (2011) -> BNK48 (2017)', 'AKB48 (2005) -> JKT48 (2011) -> SKE48 (2008) -> BNK48 (2017)', 'SKE48 (2008) -> AKB48 (2005) -> NMB48 (2010) -> JKT48 (2011)', 'AKB48 (2005) -> NMB48 (2010) -> SKE48 (2008) -> MNL48 (2018)'], 'AKB48 (2005) -> SKE48 (2008) -> JKT48 (2011) -> BNK48 (2017)', 'AKB48 berdiri 2005, SKE48 tahun 2008, JKT48 tahun 2011, dan BNK48 tahun 2017.', 'AKB48 selalu paling awal (2005) diikuti SKE48 (2008).', 'BNK48 berdiri di tahun 2017.', 'https://www.akb48.co.jp/'],
    ['q48-11', 'discography', 'normal', 'jkt48', 'level_2', 'level_2', 'team_unassigned', 'Generasi 3', 'Apa judul single ke-22 JKT48 yang menandai dimulainya format Era One (JKT48 ONE) pada Maret 2021?', ['Rapsodi', 'Cara Ceroboh untuk Mencinta (Darashinai Aishikata)', 'Flying High', 'Sayonara Crawl'], 'Cara Ceroboh untuk Mencinta (Darashinai Aishikata)', 'Dirilis 16 Maret 2021 bertepatan dengan peluncuran format JKT48 ONE berisi 33 member.', 'Adaptasi dari lagu AKB48 berjudul Darashinai Aishikata.', 'Shani Indira Natio menempati posisi center pada single ini.', 'https://jkt48.com/discography?lang=id'],
    ['q48-12', 'generation', 'easy', 'jkt48', 'level_1', 'level_1', 'team_unassigned', 'Generasi 11', 'Pada acara apakah Generasi 11 JKT48 pertama kali diperkenalkan ke publik pada tahun 2022?', ['Konser Tahun Baru', 'Halloween Event Oktober 2022', 'Sousenkyo 2022', 'Jak-Japan Matsuri 2023'], 'Halloween Event Oktober 2022', 'Generasi 11 JKT48 diperkenalkan pada acara Halloween Event di akhir Oktober 2022.', 'Berlangsung di bulan Oktober 2022.', 'Bertema pesta kostum Halloween.', 'https://jkt48.com/'],
    ['q48-13', 'member', 'hard', 'jkt48', 'level_3', 'level_3', 'team_t', 'Generasi 3 AKB48 (Transfer JKT48)', 'Siapakah mantan member AKB48 yang ditransfer ke JKT48 pada 2012, menjadi center Fortune Cookie yang Mencinta, dan menjabat Kapten Team T?', ['Rina Chikano', 'Haruka Nakagawa', 'Aki Takajo', 'Rena Nozawa'], 'Haruka Nakagawa', 'Haruka Nakagawa menjadi ikon JKT48 di Team J kemudian ditunjuk sebagai Kapten Team T hingga kelulusannya pada 2016.', 'Dijuluki Harugon oleh para penggemar.', 'Center dari single ke-3 JKT48.', 'https://jkt48.com/about/jkt48?lang=id'],
    ['q48-14', 'history', 'normal', 'jkt48', 'level_2', 'level_2', 'team_unassigned', 'Generasi 8', 'Pada bulan dan tahun berapakah JKT48 resmi beralih dari sistem Team J, Team KIII, dan Team T ke format JKT48 ONE?', ['Januari 2020', 'Maret 2021', 'Mei 2022', 'Agustus 2019'], 'Maret 2021', 'Restrukturisasi sistem menjadi satu kesatuan JKT48 ONE berlaku resmi pada Maret 2021.', 'Berlangsung tepat di masa Era One (2021–2022).', 'Bertepatan dengan perilisan single ke-22.', 'https://jkt48.com/news/list?lang=id'],
  ];

  db.transaction(() => {
    for (const q of qBank) {
      insert48Q.run(
        q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7],
        q[8], JSON.stringify(q[9]), q[10], q[11], q[12], q[13], q[14],
      );
    }
    // Tag existing seeded questions q48-01..q48-10 if they were inserted in earlier run with NULL difficulty_level
    for (const q of qBank) {
      db.prepare(`
        UPDATE forty_eight_questions
        SET era_id = COALESCE(era_id, ?),
            difficulty_level = COALESCE(difficulty_level, ?),
            team_id = COALESCE(team_id, ?),
            generation = COALESCE(generation, ?)
        WHERE id = ?
      `).run(q[4], q[5], q[6], q[7], q[0]);
    }
  })();

  // 11. Initial audit log entry
  const existingLogs = db.prepare('SELECT COUNT(*) as c FROM logs').get() as { c: number };
  if (existingLogs.c === 0) {
    db.prepare(
      `INSERT INTO logs (level, module, message) VALUES ('info', 'bootstrap', 'Database Freya-san Hub v5.0 berhasil diinisialisasi dengan 10 prefix aktif dan seluruh inventaris command.')`,
    ).run();
  }
}

export function addSystemLog(level: 'info' | 'warn' | 'error', module: string, message: string, meta?: unknown): void {
  db.prepare('INSERT INTO logs (level, module, message, meta_json) VALUES (?, ?, ?, ?)').run(
    level,
    module,
    message,
    meta ? JSON.stringify(meta) : null,
  );
  if (level === 'error') {
    db.prepare('INSERT INTO errors (module, message) VALUES (?, ?)').run(module, message);
  }
}

export function addAuditLog(actor: string, action: string, target: string, details?: unknown): void {
  db.prepare('INSERT INTO audit_logs (actor, action, target, details_json) VALUES (?, ?, ?, ?)').run(
    actor,
    action,
    target,
    details ? JSON.stringify(details) : null,
  );
}

export function applyUserBalanceAndExp(userPhone: string, displayName: string, deltaBalance: number, deltaExp: number, reason: string, refId?: string): { balance: number; exp: number; level: number } {
  return db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO users (id, phone, display_name, balance, exp, level) VALUES (?, ?, ?, 100, 0, 1)`,
    ).run(`usr-${userPhone}`, userPhone, displayName || userPhone);

    const user = db
      .prepare('SELECT balance, exp, level FROM users WHERE phone = ?')
      .get(userPhone) as { balance: number; exp: number; level: number };

    const newBalance = Math.max(0, user.balance + deltaBalance);
    const newExp = Math.max(0, user.exp + deltaExp);
    const newLevel = Math.max(1, Math.floor(newExp / 100) + 1);

    db.prepare(
      `UPDATE users SET balance = ?, exp = ?, level = ?, updated_at = datetime('now') WHERE phone = ?`,
    ).run(newBalance, newExp, newLevel, userPhone);

    db.prepare(
      `INSERT INTO balances (user_phone, amount, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_phone) DO UPDATE SET amount = excluded.amount, updated_at = datetime('now')`,
    ).run(userPhone, newBalance);

    if (deltaBalance !== 0) {
      db.prepare(
        `INSERT INTO balance_transactions (user_phone, delta, reason, ref_id, balance_after) VALUES (?, ?, ?, ?, ?)`,
      ).run(userPhone, deltaBalance, reason, refId ?? null, newBalance);
    }

    if (deltaExp !== 0) {
      db.prepare(
        `INSERT INTO xp_transactions (user_phone, delta, reason, exp_after, level_after) VALUES (?, ?, ?, ?, ?)`,
      ).run(userPhone, deltaExp, reason, newExp, newLevel);
    }

    return { balance: newBalance, exp: newExp, level: newLevel };
  })();
}

// Security helpers for Owner Passcode + Bearer token signing
const RUNTIME_SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(passcode, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function isOwnerAuthConfigured(): { hasEnvPasscode: boolean; hasClaimedHash: boolean } {
  const hasEnvPasscode = Boolean(process.env.OWNER_PASSCODE && process.env.OWNER_PASSCODE.trim().length > 0);
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'owner_passcode_hash'")
    .get() as { value: string } | undefined;
  return {
    hasEnvPasscode,
    hasClaimedHash: Boolean(row && row.value.includes(':')),
  };
}

export function verifyOwnerCredentials(passcode: string): boolean {
  const envPasscode = process.env.OWNER_PASSCODE?.trim();
  if (envPasscode) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPasscode);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'owner_passcode_hash'")
    .get() as { value: string } | undefined;
  if (!row) return false;
  return verifyPasscode(passcode, row.value);
}

export function createSessionToken(role: 'owner' = 'owner'): string {
  const payload = Buffer.from(
    JSON.stringify({
      role,
      exp: Date.now() + 1000 * 60 * 60 * 12,
      nonce: crypto.randomBytes(8).toString('hex'),
    }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', RUNTIME_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): { valid: boolean; role?: string } {
  if (!token) return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', RUNTIME_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return { valid: false };
    }
    return { valid: true, role: parsed.role };
  } catch {
    return { valid: false };
  }
}

runMigrations();
seedDatabase();
