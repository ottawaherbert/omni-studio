import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScriptDirectoryMemoryFixture } from './script-directory-memory';
import '../../src/index.css';
import '../../apps/web/src/features/script/script.css';

document.documentElement.className = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';

createRoot(document.getElementById('root')!).render(
  <>
    <section aria-label="剧本模块外的样式对照" style={{ padding: 8 }}>
      <button
        type="button"
        id="outside-primary-control"
        className="bg-text-primary"
        data-primary="true"
        style={{ background: '#cbd5e1', color: '#334155', borderRadius: 4, display: 'block', padding: '6px 12px' }}
      >
        剧本模块外的样式对照
      </button>
    </section>
    <ScriptDirectoryMemoryFixture />
  </>,
);
