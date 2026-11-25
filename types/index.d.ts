export type Found = { id: string; name: string; layers: string[]; evidence: string[] }

declare module 'claude-code' {
  interface PluginState {
    'devops-multi-agent-team': {
      languages: string[]
      /**
       * The skill itself; off via `/devops off` or `/devops disable`, typed by
       * the person. Those also write enabledPlugins in .claude/settings.json.
       * While off, gates, publish checks, lint-on-commit, the monitor and the
       * DevOps session card are inactive. Default on when unset.
       */
      active: boolean
      /** The branch gate; off via `/devops gates off`, typed by the person. The push check stays on. */
      gates: boolean
      /**
       * Human authorized a push (typed /devops push-ok or chat "push"); consumed by
       * the next allowed push. Holds the tree the grant was given for; false when none.
       * The person's grant is final: it authorizes one push even without QA PASS or
       * Security CLEAR (those misses are recorded under overrides).
       */
      pushAuthorized: string | false
      /** The last human push that overrode a seat gate: tree, rule, subject, what, time. */
      lastOverride?: { tree: string; rule: string; qa: string; what: string; at: string }
      /** Every human override, kept for audit. */
      overrides?: Array<{ tree: string; rule: string; qa: string; what: string; at: string }>
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
