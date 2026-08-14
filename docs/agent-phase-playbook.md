# HoloPet Agent Phase Playbook

Tanggal acuan: 14 Agustus 2026

Dokumen ini ditulis untuk agent coding lain agar bisa lanjut tanpa briefing ulang.

## Repo State

- Branch utama: `main`
- Remote utama: `origin`
- Repo target GitHub: `https://github.com/fauzan171/virtual-pet.git`

## Core Runtime Graph

```mermaid
flowchart TD
    A[Camera or Dialogue Input] --> B[World State]
    B --> C[Local Fast Reactions]
    B --> D[Remote Planner]
    D --> E{Remote responds in time?}
    E -->|Yes| F[Remote Action Plan]
    E -->|No| G[Fallback Action Plan]
    C --> H[Visual Expression]
    F --> I[Dialogue Expression]
    G --> I
    I --> J[Movement]
    I --> K[Subtitle]
    I --> L[Voice]
    I --> M[Memory]
    M --> B
```

## Delivery Graph

```mermaid
flowchart LR
    P1[Phase 1\nPlanning + Git Safety] --> P2[Phase 2\nRemote Probe + Backup Safety]
    P2 --> P3[Phase 3\nPet Personality Tune]
    P3 --> P4[Phase 4\nMemory Expansion]
    P4 --> P5[Phase 5\nShowcase Hardening]
    P5 --> P6[Phase 6\nFinal Demo Polish]
```

## Current Completed Phases

### Phase 1

- planning docs created
- repo initialized
- remote configured
- baseline pushed

### Phase 2

- remote probe mode added
- persistence backup added
- runtime backup ignored
- pushed

### Phase 3

- fallback pet dialogue tuned
- color preference memory added
- shorter, more companion-like Indonesian replies
- pushed

## Next Recommended Phases

### Phase 4: Memory Expansion

Goal:
- make memory more useful for repeated interactions

Tasks:
- add memory recall for favorite color in more dialogue branches
- add `last_topic` updates from common utterances
- show memory-aware pet replies naturally
- add tests for recall behavior

Done when:
- memory persists
- recall paths tested
- no regression in current probe flow

### Phase 5: Showcase Hardening

Goal:
- make demo resilient for live use

Tasks:
- add explicit timeout/fallback note in probe output
- show remote/fallback source more clearly in UI
- make live dialogue non-blocking under slow remote conditions
- keep camera reactions snappy even during dialogue

Done when:
- remote slowness does not feel broken
- user can still see cute behavior under fallback

### Phase 6: Final Demo Polish

Goal:
- tighten showcase experience

Tasks:
- improve idle companion lines
- improve movement charm for shoulder/palm/nose transitions
- verify remote model choice again
- polish README demo steps

Done when:
- user can run one clean showcase command
- behavior feels intentional, not prototype-like

## Phase Execution Loop

For every phase:

```mermaid
flowchart TD
    A[Choose one narrow phase target] --> B[Implement]
    B --> C[Run tests]
    C --> D{Pass?}
    D -->|No| E[Fix immediately]
    E --> C
    D -->|Yes| F[Run remote probe if relevant]
    F --> G[Commit]
    G --> H[Push]
    H --> I[Start next phase]
```

## Mandatory Commands

### Before editing

```bash
git status --short --branch
python3 -m unittest discover -s tests
```

### During dialogue/runtime work

```bash
./run_holopet.sh --brain remote --probe-remote --utterance 'Namaku Jadi' --utterance 'ke bahu kanan' --utterance 'namaku siapa'
```

### For broader smoke

```bash
./run_holopet.sh --self-test --brain remote --utterance 'Namaku Jadi'
```

## Commit and Push Contract

Every stable phase must end with:

```bash
git add <changed files>
git commit -m "phase N: <goal>"
git push origin main
```

If a small cleanup is needed right after:

```bash
git commit -m "phase N follow-up: <cleanup>"
git push origin main
```

## Safety Rules

1. Never push with failing tests.
2. Never leave runtime artifacts tracked.
3. Keep `.gitignore` updated for runtime files.
4. Prefer small commits over giant mixed-phase commits.
5. If remote model is unstable, preserve fallback quality first.

## Runtime Truths

Current observed behavior:

- `remote` integration exists
- remote endpoint may be slow
- fallback currently carries the demo experience
- fallback must therefore stay polished and pet-like

## What To Optimize First

If time is limited, prioritize in this order:

1. fallback charm
2. memory usefulness
3. movement charm
4. remote reliability
5. voice realism

## Success Condition

This project is in good shape for showcase only when:

- test suite passes
- probe path passes
- movement is visible and cute
- memory is noticeable
- fallback does not feel like failure
- every completed phase is committed and pushed
