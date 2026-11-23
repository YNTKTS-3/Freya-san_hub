import { ConfiguredAdditionalReward, RewardRegistryEntry } from './types';

export const REWARD_REGISTRY: RewardRegistryEntry[] = [
  {
    id: 'daily_limit_bonus',
    name: 'Bonus Limit Harian',
    description: 'Menambahkan kuota limit command harian pada akun pengguna secara permanen.',
    category: 'utility',
    handlerKey: 'apply_daily_limit_bonus',
    hasRealHandler: true,
    version: '1.0.0',
    terms: 'Nilai antara 1 sampai 200 limit tambahan per klaim.',
    paramsSchema: [
      {
        key: 'amount',
        label: 'Jumlah Limit Tambahan',
        type: 'number',
        required: true,
        min: 1,
        max: 200,
        placeholder: 'Contoh: 15',
      },
    ],
  },
  {
    id: 'premium_access',
    name: 'Status Akses Premium',
    description: 'Mengaktifkan status pengguna premium beserta masa berlaku hari pada tabel langganan.',
    category: 'membership',
    handlerKey: 'apply_premium_days',
    hasRealHandler: true,
    version: '1.0.0',
    terms: 'Durasi aktif 1 sampai 365 hari.',
    paramsSchema: [
      {
        key: 'days',
        label: 'Durasi Premium (Hari)',
        type: 'number',
        required: true,
        min: 1,
        max: 365,
        placeholder: 'Contoh: 7',
      },
    ],
  },
  {
    id: 'badge_reward',
    name: 'Badge / Achievement Koleksi',
    description: 'Memberikan badge resmi ke profil pencapaian pengguna (tabel achievements).',
    category: 'achievement',
    handlerKey: 'grant_profile_badge',
    hasRealHandler: true,
    version: '1.0.0',
    terms: 'Nama badge maksimal 50 karakter.',
    paramsSchema: [
      {
        key: 'badgeName',
        label: 'Nama Badge',
        type: 'string',
        required: true,
        maxLength: 50,
        placeholder: 'Contoh: Pendukung Theater 2026',
      },
      {
        key: 'domain',
        label: 'Domain (general / 48group)',
        type: 'string',
        required: false,
        maxLength: 20,
        placeholder: '48group',
      },
    ],
  },
  {
    id: 'streak_boost',
    name: 'Tambahan Streak Harian',
    description: 'Menambahkan poin streak aktivitas harian akun pengguna.',
    category: 'economy',
    handlerKey: 'apply_streak_boost',
    hasRealHandler: true,
    version: '1.0.0',
    terms: 'Nilai antara 1 sampai 30 hari streak.',
    paramsSchema: [
      {
        key: 'days',
        label: 'Tambahan Streak (Hari)',
        type: 'number',
        required: true,
        min: 1,
        max: 30,
        placeholder: 'Contoh: 3',
      },
    ],
  },
  {
    id: 'physical_merch_voucher',
    name: 'Voucher Merchandise Fisik (Belum Tersedia)',
    description: 'Memerlukan integrasi sistem inventaris & pengiriman eksternal yang belum terpasang.',
    category: 'utility',
    handlerKey: 'unimplemented_merch_handler',
    hasRealHandler: false,
    version: '0.0.0',
    terms: 'Tidak tersedia untuk pemilihan aktif.',
    paramsSchema: [],
  },
];

export function getActiveRewardRegistry(): RewardRegistryEntry[] {
  return REWARD_REGISTRY.filter((r) => r.hasRealHandler);
}

export interface RedeemConfigValidationInput {
  code?: string;
  name?: string;
  description?: string;
  rewardBalance?: number;
  rewardExp?: number;
  rewardLevel?: number;
  maxClaims?: number;
  perUserLimit?: number;
  cooldownSec?: number;
  expiresAt?: string | null;
  additionalRewards?: ConfiguredAdditionalReward[];
  caps?: { maxBalance: number; maxExp: number; maxLevel: number };
}

export function validateAdditionalReward(
  item: ConfiguredAdditionalReward,
): { ok: true; normalized: ConfiguredAdditionalReward } | { ok: false; error: string } {
  const entry = REWARD_REGISTRY.find((r) => r.id === item.rewardId);
  if (!entry) {
    return { ok: false, error: `Jenis reward "${item.rewardId}" tidak terdaftar di reward registry.` };
  }
  if (!entry.hasRealHandler) {
    return { ok: false, error: `Reward "${entry.name}" belum memiliki handler aktif dan tidak dapat digunakan.` };
  }

  const normalizedParams: Record<string, string | number> = {};
  for (const spec of entry.paramsSchema) {
    const raw = item.params?.[spec.key];
    if (spec.required && (raw === undefined || raw === null || String(raw).trim() === '')) {
      return { ok: false, error: `Parameter "${spec.label}" wajib diisi untuk reward ${entry.name}.` };
    }
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;

    if (spec.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { ok: false, error: `Parameter "${spec.label}" harus berupa bilangan bulat.` };
      }
      if (spec.min !== undefined && n < spec.min) {
        return { ok: false, error: `Parameter "${spec.label}" minimal ${spec.min}.` };
      }
      if (spec.max !== undefined && n > spec.max) {
        return { ok: false, error: `Parameter "${spec.label}" maksimal ${spec.max}.` };
      }
      normalizedParams[spec.key] = n;
    } else {
      const s = String(raw).trim();
      if (spec.maxLength !== undefined && s.length > spec.maxLength) {
        return { ok: false, error: `Parameter "${spec.label}" maksimal ${spec.maxLength} karakter.` };
      }
      normalizedParams[spec.key] = s;
    }
  }

  return { ok: true, normalized: { rewardId: entry.id, params: normalizedParams } };
}

export function validateRedeemConfiguration(
  input: RedeemConfigValidationInput,
): { ok: true; normalizedAdditional: ConfiguredAdditionalReward[] } | { ok: false; error: string } {
  const caps = input.caps ?? { maxBalance: 100_000, maxExp: 50_000, maxLevel: 50 };

  const code = String(input.code ?? '').trim();
  if (code && !/^[A-Z0-9_-]{3,32}$/i.test(code)) {
    return { ok: false, error: 'Kode redeem harus 3–32 karakter (huruf, angka, - atau _).' };
  }

  const balance = Number(input.rewardBalance ?? 0);
  const exp = Number(input.rewardExp ?? 0);
  const level = Number(input.rewardLevel ?? 0);
  if (!Number.isInteger(balance) || balance < 0 || balance > caps.maxBalance) {
    return { ok: false, error: `Reward Balance harus bilangan bulat 0–${caps.maxBalance}.` };
  }
  if (!Number.isInteger(exp) || exp < 0 || exp > caps.maxExp) {
    return { ok: false, error: `Reward EXP harus bilangan bulat 0–${caps.maxExp}.` };
  }
  if (!Number.isInteger(level) || level < 0 || level > caps.maxLevel) {
    return { ok: false, error: `Reward Level harus bilangan bulat 0–${caps.maxLevel}.` };
  }

  const maxClaims = Number(input.maxClaims ?? 10);
  const perUserLimit = Number(input.perUserLimit ?? 1);
  const cooldownSec = Number(input.cooldownSec ?? 0);
  if (!Number.isInteger(maxClaims) || maxClaims < 0) {
    return { ok: false, error: 'Batas total klaim harus >= 0 (0 berarti tanpa batas).' };
  }
  if (!Number.isInteger(perUserLimit) || perUserLimit < 1) {
    return { ok: false, error: 'Batas klaim per pengguna minimal 1.' };
  }
  if (!Number.isInteger(cooldownSec) || cooldownSec < 0) {
    return { ok: false, error: 'Cooldown harus >= 0 detik.' };
  }

  if (input.expiresAt) {
    const t = new Date(input.expiresAt).getTime();
    if (Number.isNaN(t)) {
      return { ok: false, error: 'Format tanggal kedaluwarsa tidak valid.' };
    }
  }

  const additional = Array.isArray(input.additionalRewards) ? input.additionalRewards : [];
  const normalizedAdditional: ConfiguredAdditionalReward[] = [];
  for (const item of additional) {
    const check = validateAdditionalReward(item);
    if (!check.ok) return { ok: false, error: check.error };
    normalizedAdditional.push(check.normalized);
  }

  if (balance === 0 && exp === 0 && level === 0 && normalizedAdditional.length === 0) {
    return { ok: false, error: 'Minimal satu reward utama (Balance/EXP/Level) atau reward tambahan harus bernilai positif.' };
  }

  return { ok: true, normalizedAdditional };
}

export function renderRedeemMessage(
  template: string | undefined,
  fallback: string,
  vars: Record<string, string | number>,
): string {
  const base = (template && template.trim()) || fallback;
  return base.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}
