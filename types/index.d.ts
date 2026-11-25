export type Found = { id: string; name: string; layers: string[]; evidence: string[] }

declare module 'claude-code' {
  interface PluginState {
    'devops-multi-agent-team': {
      languages: string[]
      /**
       * The skill itself; off via `/devops off`, typed by the person.
       * While off, gates, publish checks, lint-on-commit, the monitor and the
       * DevOps session card are inactive. Default on when unset.
       */
      active: boolean
      /** The branch gate; off via `/devops gates off`, typed by the person. The push check stays on. */
      gates: boolean
      /**
       * Human authorized a push (typed /devops push-ok); consumed by the next allowed push.
       * Holds the tree the push-ok was given for; false when none is given.
       */
      pushAuthorized: string | false
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
