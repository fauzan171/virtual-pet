# HoloPet Agent Continuation Rules

Use this file before making changes in this repo.

## Mission

Continue HoloPet phase-by-phase until the project is stable for showcase use:

- cute companion behavior
- short pet-like dialogue
- visible movement
- persistent memory
- safe fallback when remote model is slow
- always test before pushing

## Required Read Order

1. Read [`docs/agent-phase-playbook.md`](docs/agent-phase-playbook.md)
2. Read [`docs/phase-graph-plan.md`](docs/phase-graph-plan.md)
3. Check `git status --short --branch`
4. Run the current test suite before editing

## Non-Negotiable Workflow

For every phase:

1. pick one small phase target
2. implement it
3. run tests
4. fix failures immediately
5. commit with a phase-style message
6. push to `origin/main`

Do not leave the repo with failing tests.

## Required Test Commands

Run these as applicable:

```bash
python3 -m unittest discover -s tests
./run_holopet.sh --brain remote --probe-remote --utterance 'Namaku Jadi' --utterance 'ke bahu kanan' --utterance 'namaku siapa'
./run_holopet.sh --self-test --brain remote --utterance 'Namaku Jadi'
```

## Current Direction

Prefer this runtime behavior:

- fast visual reactions stay local
- dialogue uses remote planner when available
- fallback planner must stay cute and safe
- remote failure must never freeze the demo

## Push Policy

Push after each stable phase checkpoint.

Commit style:

- `phase N: <goal>`
- `phase N follow-up: <small cleanup>`

## Done Condition

A phase is done only when:

- tests pass
- probe path still works
- no obvious regression in memory, movement, or dialogue
- commit is created
- push succeeds
