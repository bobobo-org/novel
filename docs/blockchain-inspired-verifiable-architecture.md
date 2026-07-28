# Blockchain-inspired Verifiable Architecture

This is a verifiable evidence architecture, not a blockchain.

The system has one authoritative Closed Agent OS coordinating three compute
backends:

```text
                         Closed Agent OS
                    authority / policy / ledger
                       /         |         \
             Browser AI   Local Ollama   Private AI Hub
               compute       compute          compute
```

The backends execute different classes of work. They do not vote, run
consensus, maintain independent copies of a chain, or become three separate
systems.

## Verifiable mechanisms

| Mechanism | Runtime guarantee |
| --- | --- |
| Append-only Audit Log | New blocks use repository `add`; an existing block cannot be overwritten through the ledger API. |
| Hash Chain | Every block binds the prior block hash. |
| Merkle Tree | Block fields and exported block sets have independently verifiable Merkle roots and inclusion proofs. |
| Signed Approval | Approval blocks use ECDSA P-256/SHA-256; key ID, public key, timestamp and signature are checked. |
| Content-addressed Storage | Retained payloads use a SHA-256 content address and a namespace-plus-ledger scoped record locator. |
| Immutable Evidence | Exported evidence excludes retained content and is protected by its own digest and ECDSA signature. |
| Learning Candidate Ledger | Candidate, evaluation, approval, dataset, adoption and rollback events remain in one governed lineage. |
| Version Rollback | Rollback creates a new append-only event and names the earlier adoption block; history is never rewritten. |
| Data Lineage | Every v2 block has same-ledger parents, optional source content digests, causation ID and an explicit rollback target when applicable. |

“Immutable” means mutation is detectable. It does not claim that local browser
storage is physically undeletable. Evidence can be exported and verified
without exporting private retained content.

## Isolation

Every block records the complete Closed AI namespace:

`tenantId`, `userId`, `projectId`, `storyId`, `canonId`, `branchId`,
`characterId`, `agentRole`, `modelId`, `modelDigest`,
`promptProfileVersion`, `storyBibleRevision`, `knowledgeScopeRevision`, and
`privacyLevel`.

The ledger authority scope fixes all of those fields except `modelId` and
`modelDigest`, because Router is allowed to select a different compute backend
after accepting the task. The selected model identity remains bound into each
individual block hash. A ledger still cannot cross tenant, user, project,
story, Canon, branch, character, role, revision, prompt or privacy boundaries.

CAS record locators bind the complete namespace digest and ledger digest, so
the same content digest can exist in different works or tasks without sharing
metadata or retrieval authority.

Credentials, cookies, passwords, OTP fields, private keys, authorization
bearers and raw chain-of-thought are rejected before append.

## Deliberately not used

- three-backend voting;
- proof-of-work, proof-of-stake or another heavy consensus mechanism;
- full data replication to each model backend;
- a public ledger;
- tokens, gas or a blockchain cost for each generation;
- a claim that Browser AI, Ollama and Private Hub are blockchain nodes.

The formal product truth is:

```text
architecture = blockchain-inspired-verifiable-architecture-v1
isBlockchain = false
topology = one_agent_os_three_compute_backends
backendNodesMaintainSharedChain = false
```

## Verification

Run:

```powershell
pnpm test:ai:closed:verifiable-architecture
pnpm test:ai:closed:unified-os
```

The dedicated matrix verifies append-only behavior, hash and Merkle integrity,
signature identity, signed evidence, scoped content addressing, explicit
rollback lineage, cross-ledger rejection, sensitive-data blocking, and
read-only compatibility with v1 blocks.
