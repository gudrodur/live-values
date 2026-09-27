// Is this module the file the process was started with?
//
// `import.meta.url === pathToFileURL(process.argv[1]).href` is the usual one-liner,
// and it is FALSE when the same file is invoked through a symlinked directory: Node
// reports the module's resolved path in `import.meta.url` while `argv[1]` keeps the
// spelling the caller typed. Measured on a machine where the config directory was
// a symlink to the real checkout: invoking a guarded script through the alias
// compared the resolved path with the aliased spelling, so its entry block never
// ran — the script printed nothing and exited 0, which reads exactly like a clean
// check. Several hook invocations broke the same way, as silent no-ops.
//
// Both sides are therefore resolved through the filesystem before comparing, and a
// path that cannot be resolved is NOT a match: "could not tell" and "it is the entry
// point" must not take the same branch.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!metaUrl || !argv1) return false;
  let self;
  let invoked;
  try {
    self = fs.realpathSync(fileURLToPath(metaUrl));
    invoked = fs.realpathSync(argv1);
  } catch {
    return false;
  }
  return self === invoked;
}
