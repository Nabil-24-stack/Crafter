/**
 * Run Supabase migration
 * Usage: node run-migration.mjs <migration-file>
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment variables
 */

import 'dotenv/config';
import fs from 'fs';
import fetch from 'node-fetch';

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('❌ Usage: node run-migration.mjs <migration-file>');
  console.error('   Example: node run-migration.mjs supabase/add_svg_chunks.sql');
  process.exit(1);
}

// Check if file exists
if (!fs.existsSync(migrationFile)) {
  console.error(`❌ Migration file not found: ${migrationFile}`);
  process.exit(1);
}

// Check environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   - SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('💡 Run this migration manually instead:');
  console.error('   1. Open Supabase Dashboard > SQL Editor');
  console.error('   2. Paste the contents of:', migrationFile);
  console.error('   3. Run the query');
  process.exit(1);
}

// Read SQL file
const sql = fs.readFileSync(migrationFile, 'utf8');

console.log(`📝 Running migration: ${migrationFile}`);
console.log(`🔗 Supabase URL: ${process.env.SUPABASE_URL}`);
console.log('');
console.log('SQL to execute:');
console.log('─'.repeat(60));
console.log(sql);
console.log('─'.repeat(60));
console.log('');

// Use Supabase REST API to execute raw SQL
const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`;

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ sql_query: sql }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Migration failed:', response.status, response.statusText);
    console.error('Error details:', errorText);
    console.error('');
    console.error('💡 Note: Direct SQL execution via API may not be available.');
    console.error('   Please run this migration manually:');
    console.error('   1. Open Supabase Dashboard > SQL Editor');
    console.error('   2. Paste the SQL shown above');
    console.error('   3. Run the query');
    process.exit(1);
  }

  const data = await response.json();
  console.log('✅ Migration completed successfully!');
  console.log('Response:', data);
} catch (err) {
  console.error('❌ Error running migration:', err.message);
  console.error('');
  console.error('💡 Please run this migration manually:');
  console.error('   1. Open Supabase Dashboard > SQL Editor');
  console.error('   2. Copy and paste the SQL shown above');
  console.error('   3. Run the query');
  process.exit(1);
}
