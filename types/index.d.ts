/** One language the setup CLI found, as `devops-setup detect --json` prints it. */
export type Found = { id: string; name: string; layers: string[]; evidence: string[] }

declare module 'claude-code' {
  interface PluginState {
    'devops-multi-agent-team': {
      /** Language ids found in the project at session start (from languages.json). */
      languages: string[]
      /** Whether the push and branch gates are enforced. Off only by the person's `/devops gates off`. */
      gates: boolean
      /** The person ran `/devops push-ok`; consumed by the next allowed push. */
      pushAuthorized: boolean
      /** Branch names the person allowed with `/devops allow-branch NAME`. */
      allowedBranches: string[]
      /** Whether failing validation commands start the bounded correction loop (monitoring.md). */
      monitor: boolean
      /** Consecutive failures per check key (for example "cargo test"); cleared by a pass. */
      checkFailures: Record<string, number>
    }
  }
}
