# Continuity Quality Guard

Deterministic checks are authoritative for normalized age and location facts.
The same entity and field with different normalized values creates an unresolved
conflict record containing both facts and both evidence sets. Similar location
names are not collapsed. Different entity IDs with the same display name are
not merged.

The contract includes protected high-risk fields for life status, identity,
item ownership, injury, ability limits, and world rules. Phase 1.1R1 does not
claim a complete production rule engine for every field; current executable
fixtures cover age, location, evidence, identity separation, and write-gate
behavior.

Model-assisted reasoning may explain deterministic conflicts, but cannot erase
or override them.
