# Set 01 — Agent Pool and Researched Model Catalog

The Agent Pool subsystem replaces static one-size-fits-all model defaults with an empirical, role-differentiated agent pool. It maintains an autonomously researched catalog of the models the user can legitimately access across declared channels, organized into five specialized role pools: Brain, Test Writer, Implementer, Reviewer, and Research/Utility. Access boundary declarations strictly govern permitted routes—restricting OpenRouter to genuine free-tier endpoints, limiting OpenCode Go to Muse and DeepSeek V4.1, verifying GLM subscription independently, enforcing supported subscription paths for OpenAI, Gemini, and Claude without API or Vertex substitution, and isolating OpenCode Zen. A background curator subagent researches candidate capabilities across published benchmarks, community reports, and local observations, rating suitability without treating external text as instructions. The runtime tracks availability separately from quality across account, model, and shared-bucket quota scopes, executing automatic, seamless takeover across fallback chains when quota exhaustion strikes with zero duplicated work and zero user disruption.

## Set Index

*Completed pieces live in `01-agent-pool/done/`.*

| ID | Title | Lead | Package | Depends on | Queue | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `01.01` | [Access Declaration and Policy Enforcer](01.01-access-policy.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-agent-pool-access` | `none` | 1 | todo |
| `01.02` | [Catalog Discovery and Route Reconciliation](01.02-catalog-discovery.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-agent-pool-discovery` | `01.01` | 2 | todo |
| `01.03` | [Curator Research Engine and Evidence Evaluator](01.03-curator-research.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-agent-pool-curator` | `01.02` | 3 | todo |
| `01.04` | [Agent-Pool Storage Domain and Preset Store](01.04-preset-store.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-agent-pool-store` | `01.01, 01.02` | 4 | todo |
| `01.05` | [Role Pool Definitions and Accountability Guards](01.05-role-pools.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-agent-pool-roles` | `01.04` | 5 | todo |
| `01.06` | [Model Eligibility and Fallback Selector](01.06-model-selector.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-agent-pool-selector` | `01.04, 01.05` | 6 | todo |
| `01.07` | [Manual Pinning and Strict Pin Failure Guard](01.07-manual-pinning.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-agent-pool-pinning` | `01.05, 01.06` | 7 | todo |
| `01.08` | [Catalog Refresh Scheduler and Topology Reconciler](01.08-refresh-scheduler.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-agent-pool-refresh` | `01.02, 01.03, 01.04` | 8 | todo |
| `01.09` | [Quota Scope and Route Availability Tracker](01.09-quota-tracker.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-agent-pool-quota` | `01.04` | 9 | todo |
| `01.10` | [Quota Exhaustion Classifier and Error Taxonomy](01.10-exhaustion-classifier.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-agent-pool-exhaustion` | `01.09` | 10 | todo |
| `01.11` | [Hourly Heartbeat and Reset Probe Coordinator](01.11-heartbeat-prober.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-agent-pool-heartbeat` | `01.09, 01.10` | 11 | todo |
| `01.12` | [Agent Request Route Interceptor](01.12-request-router.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-agent-pool-router` | `01.06, 01.07, 01.09` | 12 | todo |
| `01.13` | [Automatic Takeover Controller](01.13-automatic-takeover.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-agent-pool-takeover` | `01.06, 01.10, 01.12` | 13 | todo |
| `01.14` | [Takeover State Transfer and Session Projection](01.14-state-transfer.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-agent-pool-state` | `01.13` | 14 | todo |
| `01.15` | [Curator Researcher Subagent Preset Composition](01.15-curator-preset.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-agent-pool-curator-preset` | `01.03` | 15 | todo |
| `01.16` | [Model-Facing Pool Inspection Tool](01.16-model-tool.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-agent-pool-tool` | `01.05, 01.06` | 16 | todo |
| `01.17` | [Human Command Surface `/agent-pool`](01.17-command-surface.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-agent-pool-command` | `01.06, 01.07, 01.08` | 17 | todo |
| `01.18` | [Agent Pool Management and Inspection UI Extension](01.18-client-ui.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-agent-pool-ui` | `01.04, 01.09, 01.17` | 18 | todo |

## Execution Protocol

1. **Access Enforcement & Discovery**: `01.01` establishes admissible route boundaries. `01.02` queries the live Harness LLM registry to discover real endpoints, classifying them into `discovered`, `configured`, `access-unverified`, and `currently-usable`.
2. **Empirical Curation & Storage**: `01.03` and `01.15` dispatch isolated researcher subagents to ingest benchmark metrics and community leads into 4-tier evidence records without treating web data as instructions. `01.04` durably stores presets under `ctx.storageDomain` using credential references.
3. **Role Pool Partitioning**: `01.05` assigns eligible models into Brain, Test Writer, Implementer, Reviewer, and Research/Utility pools, barring unscored models from critical roles.
4. **Dynamic Selection & Fallback**: `01.06` computes ordered fallback chains honoring preferred priorities (Claude Brain -> OpenAI -> Muse via Go -> GLM; DeepSeek V4.1 Implementer). `01.07` enables strict manual pinning with fail-stop alerts.
5. **Periodic Lifecycle & Quota Tracking**: `01.08` handles weekly and topology-driven refreshes, preserving last-good state. `01.09` tracks real-time availability across account, model, and shared-bucket scopes.
6. **Error Classification & Heartbeat**: `01.10` distinguishes quota exhaustion from auth, context, or cancellation errors. `01.11` coordinates single-flight reset and hourly heartbeat probes without retry storms.
7. **Runtime Routing & Automatic Takeover**: `01.12` binds call configs via the `agent/request` waterfall. Upon exhaustion, `01.13` seamlessly fails over to the next candidate in the role chain with no user disruption, while `01.14` projects handover state and preserves tool idempotency.
8. **Inspection Surfaces**: `01.16` provides the model-facing `agent_pool_inspect` tool, `01.17` provides the `/agent-pool` CLI commands, and `01.18` renders the browser monitoring dashboard displaying verified values or "unknown".
