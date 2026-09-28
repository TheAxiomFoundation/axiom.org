The mirror currently exposes declared compositions as standalone provisions unless their paths happen to match an exclusion pattern. Classify parsed documents during sync and bind the classification to the exact stored YAML bytes.

A database trigger computes the raw YAML digest and invalidates classification whenever an older writer changes those bytes without matching evidence. Unknown or malformed document types remain explicitly unknown. This describes document type, not compile or certification readiness.

Rollout: apply the additive migration first, merge this publisher, run the index sync and verify classification coverage, then deploy the API consumer. Existing readers continue using the same columns during rollout.

Validation: production build passed; 25 focused tests passed; migration and checked-in SQL regression assertions passed in PostgreSQL via PGlite. Linked production migration dry-run lists only the new migration.
