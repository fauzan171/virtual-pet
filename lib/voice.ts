/**
 * Voice command engine — native Web Speech API (webkitSpeechRecognition).
 * Runs fully in the browser, no key, no server. Chrome/Edge supported;
 * on unsupported browsers start() reports unavailable and the app keeps
 * working via buttons + keyboard.
 *
 * Commands (spoken, case-insensitive):
 *   "generate [something]"  → GENERATE; anything after "generate" becomes
 *                             the subject hint for the fallback engine
 *   "undo"                  → UNDO
 *   "clear"                 → CLEAR (first step)
 *   "confirm" / "yes"       → CLEAR (confirm step, only while confirming)
 *   "reset" / "start again" → START AGAIN
 */

export interface VoiceCommand {
  action: 'generate' | 'undo' | 'clear' | 'confirm' | 'reset';
  subject?: string;
  transcript: string;
}

// Minimal structural types — TS has no SpeechRecognition in lib.dom
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export function voiceSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/**
 * Safety layer between raw STT output and the image-generation prompt.
 * Web Speech recognition on a loud stage produces junk: trailing filler
 * words ("um", "hmm"), repeated fragments, overheard audience speech.
 * Rejects empty/too-short/too-long input so a misheard transcript never
 * reaches the model.
 */
export function sanitizeSubject(raw: string): string | undefined {
  let s = raw.trim().toLowerCase();
  if (!s) return undefined;

  // Filler words STT often appends
  s = s.replace(/\b(um+|uh+|hmm+|ah+|oh+|okay|ok|like|you know|anu|anu deh)\b/g, '');
  // Collapse repeated whitespace, trim punctuation garbage
  s = s.replace(/\s+/g, ' ').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim();

  // Too short to be a meaningful subject → treat as none spoken
  if (s.length < 3) return undefined;
  // Absurd length = misheard babble or audience bleed; cap it
  if (s.length > 120) s = s.slice(0, s.lastIndexOf(' ', 120)) || s.slice(0, 120);
  // No letters at all → not a subject
  if (!/[a-z]/.test(s)) return undefined;

  return s || undefined;
}

/** Extract a command from a final transcript. Returns null when nothing matches. */
export function parseCommand(transcript: string, clearConfirming: boolean): VoiceCommand | null {
  const text = transcript.trim().toLowerCase();
  if (!text) return null;

  // "generate a dragon" → action generate, subject "a dragon".
  // Also catch Indonesian/phonetic spellings heard on stage.
  // Longest alternatives first: "generat" is a prefix of "generate"
  const genMatch = text.match(/(?:generat e|generate|generet|generat)\s*(.*)/);
  if (genMatch !== null) {
    return { action: 'generate', subject: sanitizeSubject(genMatch[1] ?? ''), transcript };
  }
  if (/\bundo\b/.test(text)) return { action: 'undo', transcript };
  if (clearConfirming && /\b(confirm|yes|ya|iya)\b/.test(text)) {
    return { action: 'confirm', transcript };
  }
  if (/\bclear\b/.test(text)) return { action: 'clear', transcript };
  if (/\b(reset|start again)\b/.test(text)) return { action: 'reset', transcript };
  return null;
}

export interface VoiceCallbacks {
  onCommand: (cmd: VoiceCommand) => void;
  onStatus: (listening: boolean) => void;
  /** Read fresh at each result so "confirm" is only valid while CLEAR is armed */
  isClearConfirming: () => boolean;
}

export class VoiceController {
  private rec: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private cb: VoiceCallbacks | null = null;

  get supported(): boolean {
    return getRecognitionCtor() !== null;
  }

  start(cb: VoiceCallbacks): boolean {
    this.cb = cb;
    if (this.rec) return true;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return false;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const cmd = parseCommand(r[0].transcript, this.cb?.isClearConfirming() ?? false);
        if (cmd) this.cb?.onCommand(cmd);
      }
    };

    // Chrome kills recognition on silence/errors — restart while wanted
    rec.onend = () => {
      if (this.wantRunning) {
        try {
          rec.start();
        } catch {
          /* already started — ignore */
        }
      } else {
        this.cb?.onStatus(false);
      }
    };

    rec.onerror = (e) => {
      // 'no-speech' and 'aborted' end the session → onend restarts it.
      // 'not-allowed' means mic denied → stop trying.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wantRunning = false;
        this.cb?.onStatus(false);
      }
    };

    this.rec = rec;
    this.wantRunning = true;
    try {
      rec.start();
      this.cb?.onStatus(true);
    } catch {
      this.rec = null;
      return false;
    }
    return true;
  }

  stop(): void {
    this.wantRunning = false;
    if (this.rec) {
      try {
        this.rec.stop();
      } catch {
        /* ignore */
      }
      this.rec = null;
    }
    this.cb?.onStatus(false);
  }
}
