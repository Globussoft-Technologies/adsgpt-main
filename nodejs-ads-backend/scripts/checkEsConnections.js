/**
 * ES Connection Health Check
 * Run: node scripts/checkEsConnections.js
 *
 * Verifies all platform-specific ES clients are reachable
 * and indices exist.
 */

require('dotenv').config();
const clients = require('../DB/connectCompetitor');

const INDEX_MAP = {
  facebook: process.env.COMPETITOR_INDEX_FB || 'search_mix',
  instagram: process.env.COMPETITOR_INDEX_IG || 'instagram_search_mix',
  youtube: process.env.COMPETITOR_INDEX_YT || 'youtube_ads_data',
  google: process.env.COMPETITOR_INDEX_GG || 'google_ads_data',
  linkedin: process.env.COMPETITOR_INDEX_LD || 'linkedin_ads_data',
  gdn: process.env.COMPETITOR_INDEX_GDN || 'gdn_search_mix',
};

async function checkPlatform(platform, client, index) {
  const label = platform.toUpperCase().padEnd(10);
  try {
    // 1. Ping cluster
    const ping = await client.ping({ requestTimeout: 5000 });
    const pingOk = ping.body === true || ping.statusCode === 200;

    // 2. Get cluster info
    const info = await client.info({ requestTimeout: 5000 });
    const version = info.body?.version?.number || 'unknown';

    // 3. Check index exists
    const indexExists = await client.indices.exists({ index, requestTimeout: 5000 });
    const indexOk = indexExists.body === true || indexExists.statusCode === 200;

    // 4. Count docs in index
    let docCount = 'N/A';
    try {
      const count = await client.count({ index, requestTimeout: 5000 });
      docCount = count.body?.count ?? 'N/A';
    } catch {
      docCount = 'error';
    }

    console.log(`✅ ${label} | ES v${version} | Ping: OK | Index "${index}": ${indexOk ? 'EXISTS' : 'MISSING'} | Docs: ${docCount}`);
  } catch (err) {
    console.log(`❌ ${label} | FAILED: ${err.message}`);
  }
}

async function main() {
  console.log('\n=== Competitor ES Connection Check ===\n');

  for (const [platform, client] of Object.entries(clients)) {
    const index = INDEX_MAP[platform];
    await checkPlatform(platform, client, index);
  }

  console.log('\n======================================\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
