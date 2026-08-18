/**
 * Self-check for the voice prompt safety layer. Run with:
 *   npm run check:voice-guard
 */
import { sanitizeSubject, parseCommand } from '../lib/voice.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// sanitizeSubject: junk in, clean out
assert(sanitizeSubject('a dragon') === 'a dragon', 'plain subject passes through');
assert(sanitizeSubject('a dragon um hmm') === 'a dragon', 'trailing filler stripped');
assert(sanitizeSubject('  um  ') === undefined, 'filler-only rejected');
assert(sanitizeSubject('') === undefined, 'empty rejected');
assert(sanitizeSubject('!@#$%') === undefined, 'no-letter input rejected');
assert(sanitizeSubject('an') === undefined, 'too-short rejected');
const long = 'word '.repeat(60).trim();
const capped = sanitizeSubject(long);
assert(capped !== undefined && capped.length <= 120, 'long input capped at 120');
assert(sanitizeSubject('...a red car!!!') === 'a red car', 'punctuation garbage trimmed');

// parseCommand routes through the guard
assert(parseCommand('generate a dragon', false)?.subject === 'a dragon', 'generate keeps subject');
assert(parseCommand('generate um', false)?.subject === undefined, 'generate with filler-only subject drops it');
assert(parseCommand('generate', false)?.action === 'generate', 'bare generate still works');
assert(parseCommand('confirm', false) === null, 'confirm ignored outside clear flow');
assert(parseCommand('confirm', true)?.action === 'confirm', 'confirm valid while confirming');

console.log('all voice guard checks pass');
