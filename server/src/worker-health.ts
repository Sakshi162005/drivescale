import fs from 'fs';
import path from 'path';
import os from 'os';

const heartbeatPath =
  process.env['WORKER_HEARTBEAT_FILE'] ||
  path.join(os.tmpdir(), 'drivescale-worker-heartbeat');

try {
  if (!fs.existsSync(heartbeatPath)) {
    console.error(`Worker heartbeat file not found at ${heartbeatPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(heartbeatPath, 'utf-8');
  const data = JSON.parse(raw);

  const ageMs = Date.now() - Number(data.timestamp);
  if (ageMs > 30000) {
    console.error(`Worker heartbeat is stale (${Math.round(ageMs / 1000)}s old)`);
    process.exit(1);
  }

  console.log(`Worker healthy (heartbeat age: ${Math.round(ageMs / 1000)}s)`);
  process.exit(0);
} catch (err) {
  console.error('Failed to read or parse worker heartbeat file:', err);
  process.exit(1);
}

