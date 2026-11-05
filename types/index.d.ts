export type Found = { id: string; name: string; layers: string[]; evidence: string[] }

declare module 'claude-code' {
  interface PluginState {
    'devops-multi-agent-team': {
      languages: string[]
      /** Off only by the person typing `/devops gates off`. */
      gates: boolean
      /** The person ran `/devops push-ok`; consumed by the next allowed push. */
      pushAuthorized: boolean
      allowedBranches: string[]
      monitor: boolean
      /** Cleared by a pass. */
      checkFailures: Record<string, number>
    }
  }
}
