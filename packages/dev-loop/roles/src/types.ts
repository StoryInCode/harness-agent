/** Role policies and durable delegation observations. @module dsh-dev-loop-roles/types */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { WorktreeAssignment } from '@deepseek-ai/dsh-dev-loop-worktree'

/** Canonical specialist roles; there is no Reviewer alias. */
export type DevLoopRole = 'Research' | 'Test Writer' | 'Implementer' | 'Utility'
/** Opaque durable request identity. */
export type DelegationId = Branded<'DevLoopDelegationId'>
/** Evidence requested for a decision. */
export interface VerificationAssignment {
  /** Claim whose truth the child must investigate. */
  claim: string
  /** Decision that depends on the claim. */
  decisionRestingOnClaim: string
  /** Sources the assignment permits the child to inspect. */
  permittedSources: readonly string[]
  /** Evidence the resulting report must provide. */
  requiredEvidence: readonly string[]
}
/** Model-supplied assignment without execution authority. */
export interface DelegationBrief {
  /** Canonical dotted id in the configured repository. */
  pieceId: string
  /** One of the four configured specialist roles. */
  role: DevLoopRole
  /** Complete task delivered to the child; never silently clipped. */
  assignment: string
  /** Reason this task is needed by the caller. */
  rationale: string
  /** Optional explicit claim, sources, and required evidence. */
  verification?: VerificationAssignment
}
/** Explicit provider and child capability policy. */
export interface RoleConfig {
  /** Registered subagent provider name, not an LLM route; missing providers fail mount. */
  provider: string
  /** Nonempty child persona template; requires provider persona support. */
  persona: string
  /** Explicit inherited-tool allow/deny restriction, applied during child creation by the provider. */
  toolFilter: ToolRestriction
  /** Optional child model-route overrides; requires provider agentOptions support. */
  agentOptions?: AgentOptions
  /** Optional nonnegative safe-integer absolute child depth; requires provider depthLimit support. */
  maxDepth?: number
}
/** Host-owned policy and complete persisted-value budgets; all fields are required. */
export interface Config {
  /** Explicit policies for all four roles. Deployment owns the safety of capabilities it permits. */
  roles: Record<DevLoopRole, RoleConfig>
  /** Positive safe-integer UTF-8 byte limit for complete brief JSON; excess rejects before intent storage. */
  maxBriefBytes: number
  /** Positive safe-integer byte limit for a complete terminal record, including metadata and provenance. */
  maxOutcomeBytes: number
}
/** Scoped consumer-owned complete rendered-result budgets. */
export interface ToolConfig {
  /** Positive safe-integer UTF-8 limit for the complete rendered content array; must fit fixed error envelopes. */
  maxToolOutputBytes: number
  /** Positive safe-integer maximum history records per model receipt; overflow never returns a partial array. */
  maxHistoryRecords: number
}
/** Durable intent; it does not imply that a child is running. */
export interface RequestedDelegation extends DelegationBrief {
  /** Unique UUID for this accepted request, retained on its terminal observation. */
  delegationId: DelegationId
  /** Actual initiator's Session id, captured before asynchronous persistence. */
  parentSessionId: SessionId
  /** Configured subagent provider selected for this request. */
  provider: string
  /** Epoch milliseconds when this request was accepted. */
  requestedAt: number
  /** Unresolved intent; no child execution or completion is inferred. */
  state: 'requested'
}
/** Observed result after Queue cleanup and durable terminal recording. */
export interface SettledDelegation extends Omit<RequestedDelegation, 'state'> {
  /** Terminal observation, not an automatically verified report. */
  state: 'settled'
  /** Epoch milliseconds after Queue result and cleanup settlement. */
  finishedAt: number
  /** Actual returned child identity; absent when no lease was received. */
  subagentSessionId?: SessionId
  /** Actual optional child header preset captured while the lease is live. */
  effectivePreset?: string
  /** Actual acquired retained assignment; its presence does not imply filesystem confinement. */
  worktreeAssignment?: WorktreeAssignment
  /** Provider stop reason only when Queue returned a result. */
  stopReason?: SubagentStopReason
  /** Completed only for a complete textual report and proven cleanup; aborted and failed remain distinct. */
  status: 'completed' | 'aborted' | 'failed'
  /** Queue cleanup observation; unproven never implies child termination. */
  cleanup: 'quiescent' | 'unproven'
  /** Complete reported text, or empty/explicit failure text when no complete report can be retained. */
  outcome: string
  /** Explicit failure, partial-output, overflow, or cleanup qualifications. */
  limitations: readonly string[]
  /** Report attribution; an absent preset means no actual preset was recorded. */
  provenance: { kind: 'reported'; role: DevLoopRole; preset?: string }
}
/** Detached history row. */
export type DelegationRecord = RequestedDelegation | SettledDelegation
