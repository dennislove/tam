import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';

// Thử load .env nếu có (khi chạy dev) - không bắt buộc
dotenvConfig();

// ----------------------------------------------------------------
// Credentials nhúng sẵn vào app - không cần file .env khi deploy
// Ưu tiên biến môi trường nếu có (để dev override được)
// ----------------------------------------------------------------
const SUPABASE_URL_DEFAULT         = 'https://jkbaetzxjvhleggxiqfd.supabase.co';
const SUPABASE_SECRET_DEFAULT      = 'sb_secret_ekyIYZJpooeq7nw-17NXfA_p_JmP2Q_';
const SUPABASE_PUBLISHABLE_DEFAULT = 'sb_publishable_OrkYrmf-xKFRTcv0pHPunw_6Qtg2F4c';

const supabaseUrl = process.env.SUPABASE_URL        ?? SUPABASE_URL_DEFAULT;
const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? SUPABASE_SECRET_DEFAULT;

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// Export config cho các module khác cần dùng
export const SUPABASE_CONFIG = {
  url: supabaseUrl,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_DEFAULT,
  jwksUrl: process.env.SUPABASE_JWKS_URL ?? `${SUPABASE_URL_DEFAULT}/auth/v1/.well-known/jwks.json`,
};
