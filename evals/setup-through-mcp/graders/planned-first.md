---
type: tool_order
before:
  tool: mcp__plugin_devops-multi-agent-team_devops-multi-agent-team__install_devops_team
  input_match: '^(?!.*"apply"\s*:\s*true)'
after:
  tool: mcp__plugin_devops-multi-agent-team_devops-multi-agent-team__install_devops_team
  input_match: '"apply"\s*:\s*true'
---
