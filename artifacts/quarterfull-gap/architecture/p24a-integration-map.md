# P2.4A and Future Product Loop Integration Map

## Evidence boundary

This map is derived from the P2.4A implementation and the capability taxonomy supplied
in `P2.4A_QUARTERFULL_PRODUCT_LOOP_COMPATIBILITY_CONTRACT`. It is not a claim that the
current QuarterFull application was independently inspected.

## Canonical layers

| Layer | Authority | P2.4A access |
| --- | --- | --- |
| Creation DNA | Future preference repository | Optional reference only |
| Story Blueprint | Future planning repository | Optional reference only |
| Story Bible | Existing Story Bible repository | Read for continuity; never overwritten by projection |
| Novel Canon | Existing project and chapter repositories | Read as the projection source; never written by Drama approval |
| Drama Adaptation Canon | Existing Drama OS stores | Written only through the existing approval transaction |
| Private Simulation | Ephemeral/private candidate space | Never approvable and never canonical |

P2.4A does not become the authoritative repository for Creation DNA, Story Blueprint,
World State, Character State, Narrative Plan, proposals, or publication projections.
It stores only versioned references with `id`, `projectId`, `revision`, `status`,
`source`, and `updatedAt`.

## Existing overlap

P2.3 already provides Story Bible, revisions, retrieval, Context Composer, Persona,
Provider Router, approval transaction, revision guard, idempotency, backup/restore,
and capability truth reporting.

P2.4A provides source-grounded novel-to-drama projection, episode and scene planning,
beat sheets, hooks, emotion curves, A/B/C Drama candidates, Drama-only approval,
Drama backup records, and optional upstream references.

## Planned ownership

| Phase | Planned responsibility | Current status |
| --- | --- | --- |
| P2.4B | Character Agent behavior using existing character references | `not_implemented` |
| P2.4C | Visual Character Bible and storyboard candidates | `not_implemented` |
| P2.4D | Audience voting and audience learning | `not_implemented` |
| P2.4E | Media and video provider adapters | `contract_only` |
| P2.5A | Creation DNA and Story Blueprint authority/workbench | `not_implemented` |
| P2.5B | World and character workbenches plus knowledge-scope authoring | `not_implemented` |
| P2.5C | Reading discovery, recommendation, and AI book discovery | `not_implemented` |
| P2.5D | Publication projection, translation, and cover direction | `not_implemented` |
| P2.5E | Author analytics, monetization, and complete product-loop reporting | `not_implemented` |

These phase assignments are architecture boundaries, not authorization to start those
phases.

## Shared proposal boundary

Episode, scene, beat, branch, and dialogue candidates can be projected into the
`shared-proposal-envelope-v1` contract. The envelope does not persist or accept a
proposal. Acceptance remains exclusively owned by the existing Drama approval
transaction.

## Compatibility rules

- A Drama project without a Story Blueprint remains valid.
- An upstream reference revision mismatch expires the generated Drama candidates.
- Missing future modules are not data corruption and do not cause placeholder records.
- RC3 backups remain importable without any upstream reference.
- Creation DNA, Story Blueprint, Story Bible, Novel Canon, and Drama Adaptation Canon
  remain separate authorities.
- Knowledge scopes are used only for continuity access checks in P2.4A.
