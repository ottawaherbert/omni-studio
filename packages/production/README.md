# Production Package

This package owns independent production-side logic.

- `src/domains/production`: pure Production domain types for imported scripts, breakdowns, asset candidates, and storyboard beats.
- `src/services/production`: Production-only services that consume Writing export packages and create independent production artifacts. Core mode, lock, prep, casting, creative-change, change-order, QA normalization, script import, script prep, formal asset packages, continuity, visual style lock, storyboard strategy, video storyboard contracts, runner artifacts, prep runtime, retry policy, prompt utilities, and asset-reference context live here.

Boundary rules:

- Production may consume `packages/domain/src/scriptDelivery` data-only types at import seams, but it must not mutate Writing projects.
- The script authoring domain must not import this package.
- Production package code must not import React, browser stores, Express routes, legacy project stores, or root `src/services/production` implementations.
- Root `src/domains/production` and selected `src/services/production/*` files are compatibility re-export paths only during migration.
