import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { switchPrimaryMediaTake, type MediaTakeRecord } from '../src/domains/interactive/media/mediaTakeManager.ts';
import type { NodeContentBinding } from '../src/domains/interactive/types/schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GAME_EDITOR_PATH = path.join(__dirname, '..', 'src', 'pages', 'GameEditor.tsx');

function runMediaTakeMappingSelfCheck() {
  console.log('[Interactive Media Take Mapping Self-Check] Verifying GameEditor deletion and Media Take switching...');

  // 1. Assert GameEditor.tsx is physically gone
  if (fs.existsSync(GAME_EDITOR_PATH)) {
    throw new Error('CRITICAL: Legacy GameEditor.tsx still exists in filesystem!');
  }

  // 2. Assert Take Switching Logic
  const initialBinding: NodeContentBinding = {
    nodeId: 'node_scene_1',
    slot: 'main',
    mediaTakeRef: { artifactId: 'take_001', versionId: 'take_take_001', kind: 'media_take', checksum: 'hash_001' },
  };

  const newTake: MediaTakeRecord = {
    takeId: 'take_002_alt',
    isPrimary: true,
    videoUrl: 'https://cdn.example.com/takes/002.mp4',
    durationSeconds: 12,
    checksum: 'hash_002_alt',
  };

  const updatedBinding = switchPrimaryMediaTake(initialBinding, newTake);
  if (updatedBinding.mediaTakeRef !== undefined) {
    throw new Error('Media take switching must not keep writing the deprecated singular mediaTakeRef');
  }
  if (updatedBinding.mediaTakeRefs?.[0]?.artifactId !== 'take_002_alt') {
    throw new Error('Media take switching failed to synchronize ordered mediaTakeRefs');
  }

  console.log('[Interactive Media Take Mapping Self-Check] PASSED. Legacy GameEditor deleted and Take Switching logic verified.');
}

runMediaTakeMappingSelfCheck();
