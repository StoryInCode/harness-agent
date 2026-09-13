# Config DTO documentation amendment

The parent authorized Test Writer to add JSDoc to the five `Config` fields so the configuration catalog can describe their existing obligations. Only comments in `src/types.ts` changed; exported names, field types, optionality and runtime behavior are unchanged. The comments state MAIN 00.08's explicit repository root, positive safe-integer limits, decoded UTF-8 representation, no partial-read fingerprints, complete-observation JSON limit and locator count.

This amendment supersedes only the `src/types.ts` entry in `FROZEN-SHA256SUMS`. Its predecessor DTO SHA-256 is `a22d7fbe2de0d834714dd88556b5b93d4f0143dcd950ada9c472323fa4fa2c20`; its amended SHA-256 is `24300759a873434b23accda4e0aa4fa270ddf92a87ac5fc3442032e233441452`. The unchanged historical manifest SHA-256 is `4794bb0d97942f4f0e962037d79a1429187d4f20ef1d6533f3a7b578f0c8f7ba`. All historical test, fixture, evidence and manifest files remain immutable.

`DTO-DOC-AMENDMENT-SHA256SUMS` pins the amended DTO and this record. No behavioral test change or new RED claim accompanies a documentation-only amendment. The Implementer owns the configuration-catalog regeneration and validation result.
