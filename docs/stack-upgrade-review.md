# Stack Upgrade Review — HoloPet CV

Diskusi evaluasi rekomendasi "The Best Stack" dari agent riset, untuk menutup 5 kelemahan utama HoloPet CV. Dokumen ini jadi acuan agent yang mengerjakan implementasi.

**Konteks project:** laptop CPU only (no GPU), demo panggung harus responsif dalam hitungan detik, local-first dengan fallback chain di semua layer.

---

## 1. STT — faster-whisper `large-v3-turbo` + Silero VAD

**Verdict: Setuju sebagian.**

- Upgrade `base` → `small` int8: **win nyata**. Akurasi bahasa Indonesia naik signifikan, CPU masih aman.
- `large-v3-turbo` int8: **latency overclaim**. Klaim 300–500ms hanya untuk kalimat pendek di mesin kencang. Di laptop biasa, kalimat 5–8 detik bisa 1.5–3 detik. Masih oke untuk demo, tapi jangan dijadikan janji.
- **Silero VAD: paling penting dari semua upgrade.** Listener sekarang (`src/audio/listener.py`) pakai silence detection sederhana. VAD proper bikin turn detection jauh lebih reliable di panggung berisik, dan jadi fondasi barge-in (poin 4).

**Action:** pasang `small` int8 dulu, test akurasi bahasa Indonesia. Naik ke `large-v3-turbo` hanya kalau kurang. VAD langsung pasang.

---

## 2. TTS — Piper TTS (ONNX)

**Verdict: Setuju, dengan koreksi soal voice Indonesia.**

- Piper: pilihan tepat. ONNX in-process, cross-platform, cepat. Jauh lebih baik dari macOS `say`.
- **Koreksi:** voice Indonesia Piper (`id_ID-news_tts-medium`) kualitasnya **mediocre** — model berita, bukan karakter. Suara "pet imut" susah dicapai dari checkpoint ini.
- Kokoro-TTS: menarik tapi **belum ada voice Indonesia yang mature**.
- Opsi realistis untuk karakter imut: voice Inggris Piper + pitch/speed modulation, atau cloud TTS (ElevenLabs/Google) kalau latency jaringan bisa diterima.

**Action:** Piper + voice Inggris ceria + speed/pitch tune. Kalau macOS-only dan tidak mau ribet, tetap `say` masih valid untuk demo.

---

## 3. LLM Transport — OpenAI SDK + Streaming

**Verdict: Setuju ganti SDK, tapi streaming = over-engineering untuk v1.**

- Ganti raw `urllib` → `openai` SDK: **yes**. Retry, timeout, connection pooling gratis.
- `response_format={"type": "json_object"}`: **cek dulu** apakah API base yang dipakai (Qwen 3.8 Max, bukan OpenAI asli) support JSON mode.
- **Streaming + sentence buffering: skip dulu.** Dialog HoloPet respons pendek (1–2 kalimat). Bottleneck time-to-first-voice bukan LLM streaming, tapi **STT latency + TTS generation**. Streaming baru worth it kalau respons LLM >3 kalimat.
- **Pydantic: skip.** Project ini zero-dependency style. Validasi satu dataclass cukup pakai `json.loads` + try/except + fallback ke local planner — pola ini sudah ada di `src/agent/remote_planner.py`.

---

## 4. Barge-in (Interupsi saat pet bicara)

**Verdict: Setuju 100%. Upgrade paling terasa untuk "kehidupan" pet.**

- Half-duplex + barge-in via VAD = sweet spot. Full-duplex tanpa AEC fisik di laptop = feedback loop (pet mendengar suaranya sendiri).
- Implementasi: mic tetap jalan saat TTS playback, VAD monitor. Kalau speech terdeteksi >300ms → stop playback (`sd.stop()`) + pindah ke state `LISTENING`.
- **Warning:** perlu threshold volume yang tepat agar suara pet sendiri tidak trigger barge-in. Kombinasi VAD + energy threshold, atau mute mic saat TTS peak.
- File yang disentuh: `src/audio/session.py` (voice turn lifecycle), `src/audio/listener.py`.

---

## 5. CV — MediaPipe Tasks + One Euro Filter

**Verdict: Koreksi besar. Riset tidak sadar kondisi codebase.**

- Project **sudah pakai smoothing** (EMA alpha di `configs/interaction.yaml`: `pose_alpha: 0.45`, dll). One Euro Filter lebih baik untuk jitter, tapi ini **incremental improvement**, bukan masalah kritis.
- **MediaPipe Tasks API = breaking change besar**, bukan quick win. MediaPipe legacy yang dipakai sekarang memang deprecated, tapi migrasi ke Tasks API beda output format dan beda model file. Jadwalkan sebagai phase terpisah, **jangan bareng upgrade audio**.
- Resolusi 640x480: hati-hati. Config sekarang 1280x720. Turun resolusi bisa bikin gesture detection (point, two_hand_pose) kurang reliable. Test dulu.

---

## Tabel Prioritas Implementasi

| Prioritas | Item | Effort | Impact | File terdampak |
|---|---|---|---|---|
| 🔴 1 | Silero VAD (turn detection + barge-in) | Medium | Paling terasa "hidup" | `src/audio/listener.py`, `src/audio/session.py` |
| 🔴 2 | Whisper `small` int8 | Kecil | Akurasi naik langsung | `src/audio/stt.py`, default `--whisper-model` |
| 🟡 3 | Piper TTS | Medium | Suara lebih baik, cross-platform | `src/audio/tts.py` |
| 🟡 4 | OpenAI SDK ganti urllib | Kecil | Reliability | `src/agent/remote_planner.py` |
| 🟢 5 | LLM streaming | Medium | **Skip dulu** — respons pendek | — |
| 🟢 6 | One Euro Filter | Kecil | Minor, smoothing sudah ada | `src/cv/tracker.py` |
| ⚪ 7 | MediaPipe Tasks migration | **Besar** | Phase terpisah, jangan sekarang | `src/cv/*` |

---

## TL;DR

Arah riset benar, tapi: `large-v3-turbo` latency overclaim, voice Indonesia Piper mediocre, streaming LLM belum perlu, dan MediaPipe Tasks itu migration besar yang disampaikan riset seolah quick win. Fokus eksekusi: **VAD + barge-in dulu, baru Whisper upgrade, lalu TTS.**
