export type Found = { id: string; name: string; layers: string[]; evidence: string[] }

declare module 'claude-code' {
  interface PluginState {
    'devops-multi-agent-team': {
      languages: string[]
      /** Off via `/devops gates off` (or chat equivalent). */
      gates: boolean
      /** Human authorized a push (`/devops push-ok` or chat "push"); consumed by the next allowed push. */
      pushAuthorized: boolean
      /** The last human push that overrode a missing QA PASS: tree, rule, QA verdict, time. */
      lastOverride?: { tree: string; rule: string; qa: string; at: string }
      allowedBranches: string[]
      monitor: boolean
      commentAudit: 'warn' | 'strict' | 'off'
      /** Cleared by a pass. */
      checkFailures: Record<string, number>
      /** The project's standards in one line; empty when there are none. */
      standards: string
      /** The .devops/standards.json text the summary was read from, to see when it changes. */
      standardsFile: string
      /** A devops_brief call has run this session; the DevOps card is then shown. */
      briefed: boolean
    }
  }
}
