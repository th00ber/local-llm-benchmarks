/* ==========================================================================
   Vitest launcher.
   On Windows some shells (Git Bash, some IDE terminals) report the working
   directory with a lower-case drive letter (`c:\…`). Vitest then loads its
   own modules twice — once as `c:` and once as `C:` — and every suite fails
   with "Vitest failed to find the current suite". Starting Vitest from the
   canonical path avoids that. On other systems this is a plain pass-through.
   ========================================================================== */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

const cwd = realpathSync.native(process.cwd());
const vitestEntry = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
