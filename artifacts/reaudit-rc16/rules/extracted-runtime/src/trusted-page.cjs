'use strict';
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

// Compare the local file identity, not its URL spelling. Chromium loadFile and
// Node pathToFileURL can spell the same '~' as '~' and '%7E' respectively.
// The owner window and main-frame checks remain the caller's responsibility.
function isTrustedPage(senderURL, entry, platform = process.platform) {
  try {
    if (typeof senderURL !== 'string' || typeof entry !== 'string') return false;
    const windows = platform === 'win32';
    const paths = windows ? path.win32 : path.posix;
    if (!paths.isAbsolute(entry)) return false;
    const sender = new URL(senderURL);
    if (sender.protocol !== 'file:' || sender.username || sender.password) return false;
    const normalize = value => {
      const normalized = paths.normalize(value);
      // Drive-letter case is not a distinct Windows drive. Do not case-fold
      // the remaining path: Windows can enable case-sensitive directories.
      return windows ? normalized.replace(/^[a-z]:/i, drive => drive.toUpperCase()) : normalized;
    };
    const expected = fileURLToPath(pathToFileURL(entry, { windows }), { windows });
    const actual = fileURLToPath(sender, { windows });
    return normalize(actual) === normalize(expected);
  } catch {
    // Invalid escapes, encoded separators, remote hosts on POSIX, and non-file
    // schemes are rejected. Decoding happens once, never recursively.
    return false;
  }
}

module.exports = { isTrustedPage };
