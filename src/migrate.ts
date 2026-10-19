/**
 * migrate.ts — Đồng bộ dữ liệu JSON → Supabase
 * Chạy 1 lần: pnpm tsx src/migrate.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { supabase } from './services/supabaseClient.js';

const ROOT = process.cwd();

// ================================================================
// 1. MIGRATE ACCOUNTS (46 acc → 3 lô: 20, 20, 6)
// ================================================================
async function migrateAccounts() {
  console.log('\n📋 [1/2] Đang migrate tài khoản...');

  const raw: { username: string; password: string }[] = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'accounts.json'), 'utf-8')
  );
  console.log(`   Tìm thấy ${raw.length} tài khoản trong accounts.json`);

  const LOT_SIZE = 20;

  const rows = raw.map((acc, idx) => {
    const lotNum = Math.floor(idx / LOT_SIZE) + 1;
    return {
      username: acc.username.trim(),
      password: acc.password.trim(),
      lot_id: `lot_${lotNum}`,
      sort_order: idx % LOT_SIZE,
    };
  });

  // Xóa hết dữ liệu cũ trước
  const { error: delErr } = await supabase
    .from('accounts')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (delErr) {
    console.error('   ❌ Lỗi xóa accounts cũ:', delErr.message);
    return;
  }

  // Insert theo batch 50
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase.from('accounts').insert(batch);
    if (error) {
      console.error(`   ❌ Lỗi insert batch ${i}:`, error.message);
      return;
    }
  }

  console.log(`   ✅ Đã import ${raw.length} tài khoản vào 3 lô:`);
  console.log(`      Lô 1: acc #1–#20`);
  console.log(`      Lô 2: acc #21–#40`);
  console.log(`      Lô 3: acc #41–#46`);
}

// ================================================================
// 2. MIGRATE ANSWERS (answers.json → banner_answers, banner_id = banner_4)
// ================================================================
async function migrateAnswers() {
  console.log('\n📚 [2/2] Đang migrate đáp án banner_4...');

  const answersPath = path.join(ROOT, 'answers.json');
  if (!fs.existsSync(answersPath)) {
    console.log('   ⚠️  Không tìm thấy answers.json, bỏ qua.');
    return;
  }

  const answers: { question: string; options: string[]; answer: string }[] = JSON.parse(
    fs.readFileSync(answersPath, 'utf-8')
  );
  console.log(`   Tìm thấy ${answers.length} câu hỏi trong answers.json`);

  // Xóa đáp án cũ của banner_4
  const { error: delErr } = await supabase
    .from('banner_answers')
    .delete()
    .eq('banner_id', 'banner_4');

  if (delErr) {
    console.error('   ❌ Lỗi xóa đáp án cũ:', delErr.message);
    return;
  }

  const rows = answers.map((a, idx) => ({
    banner_id: 'banner_4',
    question: a.question,
    options: a.options,
    answer: a.answer,
    sort_order: idx,
  }));

  // Insert theo batch 50
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase.from('banner_answers').insert(batch);
    if (error) {
      console.error(`   ❌ Lỗi insert answers batch ${i}:`, error.message);
      return;
    }
  }

  console.log(`   ✅ Đã import ${answers.length} câu hỏi vào banner_4`);
}

// ================================================================
// 3. CẬP NHẬT TITLE BANNER_4 THEO banners.json
// ================================================================
async function migrateBannerMeta() {
  console.log('\n🏷️  Cập nhật title banner_4...');
  const { error } = await supabase
    .from('banners')
    .update({ title: 'Cuộc thi Phạm Câu Lầu - Tuần 3', is_active: true })
    .eq('id', 'banner_4');

  if (error) console.error('   ❌', error.message);
  else console.log('   ✅ Đã cập nhật title banner_4');
}

// ================================================================
// RUN
// ================================================================
(async () => {
  console.log('🚀 Bắt đầu migrate dữ liệu JSON → Supabase...');
  await migrateBannerMeta();
  await migrateAnswers();
  await migrateAccounts();
  console.log('\n🎉 Migrate hoàn tất!');
  process.exit(0);
})();
