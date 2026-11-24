import { expect, test } from 'claude-code/testing'

import {
  branchNameOf, classify, commitInfo, interpretDevopsIntent, isSingleCommand, namesPush,
  shellWords,
  splitArgs, treeOf, verdictOf,
} from './guard'

test('git push and gh pr publishing are found, however they are spelled', () => {
  expect(classify('git push origin HEAD')).toEqual([{ kind: 'publish', what: 'git push' }])
  expect(classify('git -C sub -c user.name=x push -u origin main'))
    .toMatchObject([{ kind: 'publish', what: 'git push' }])
  expect(classify('cd x && FOO=1 sudo git push'))
    .toMatchObject([{ kind: 'publish', what: 'git push' }])
  expect(classify('gh pr create --title t')).toEqual([{ kind: 'publish', what: 'gh pr create' }])
  expect(classify('gh pr edit 4 --title t')).toEqual([{ kind: 'publish', what: 'gh pr edit' }])
  expect(classify('gh release create v1')).toEqual([{ kind: 'publish', what: 'gh release create' }])
})

test('reading, quoting and look-alikes publish nothing', () => {
  expect(classify('git status && git log --oneline')).toEqual([])
  expect(classify('git commit -m "do not git push yet"')).toEqual([])
  expect(classify("echo 'gh pr create'")).toEqual([])
  expect(classify('gh pr view 4')).toEqual([])
  expect(classify('git branch')).toEqual([])
  expect(classify('git branch -d old')).toEqual([])
  expect(classify('git worktree add --detach /tmp/w abc123')).toEqual([])
})

test('branch creation is found with its name', () => {
  expect(classify('git checkout -b feature/x')).toEqual([{ kind: 'branch', name: 'feature/x', what: 'git checkout -b' }])
  expect(classify('git switch -c topic')).toEqual([{ kind: 'branch', name: 'topic', what: 'git switch -c' }])
  expect(classify('git worktree add -b side /tmp/w main')).toEqual([{ kind: 'branch', name: 'side', what: 'git worktree add -b' }])
  expect(classify('git branch newone')).toEqual([{ kind: 'branch', name: 'newone', what: 'git branch <name>' }])
  expect(classify('git checkout main')).toEqual([])
})

test('a QA note is read by its last verdict line', () => {
  expect(verdictOf('x\nPublish gate: BLOCKED\nfixed\nPublish gate: PASS\n')).toBe('PASS')
  expect(verdictOf('Publish gate: PASS\nlater\nPublish gate: BLOCKED')).toBe('BLOCKED')
  expect(verdictOf('no verdict here')).toBeUndefined()
  expect(verdictOf('  Publish gate: PASS')).toBeUndefined()
})

test('command arguments and branch names are parsed strictly', () => {
  expect(splitArgs('  allow-branch  feature/x ')).toEqual({ word: 'allow-branch', rest: 'feature/x' })
  expect(splitArgs('')).toEqual({ word: '', rest: '' })
  expect(shellWords('set linters.python.command "ruff check ." 7')).toEqual(
    ['set', 'linters.python.command', 'ruff check .', '7'])
  expect(shellWords(`add lint.exclude 'vendor/**'`)).toEqual(['add', 'lint.exclude', 'vendor/**'])
  expect(branchNameOf('feature/ok-1.2')).toBe('feature/ok-1.2')
  expect(branchNameOf('a..b')).toBeUndefined()
  expect(branchNameOf('x; rm -rf /')).toBeUndefined()
  expect(branchNameOf('-bad')).toBeUndefined()
})

test('free-form words never map to a gate command (rule 3)', () => {
  const freeForm = ['push', 'go', 'publish', 'ship', 'withdraw']
  freeForm.push('cut a branch topic/x', 'gates off')
  for (const words of freeForm) {
    expect(interpretDevopsIntent(words)).toBeUndefined()
  }
  expect(interpretDevopsIntent('')).toEqual({ word: 'status', rest: '' })
})

test('a QA note names the tree it approved', () => {
  const tree = 'a'.repeat(40)
  expect(treeOf(`Publish gate: PASS\ntree: ${tree}\n`)).toBe(tree)
  expect(treeOf('Publish gate: PASS\nno tree line')).toBeUndefined()
})

test('a commit is recognised, and whether it stages everything', () => {
  expect(commitInfo('git commit -m "msg"')).toEqual({ isCommit: true, stagesAll: false })
  expect(commitInfo('git add -A && git commit -m x')).toEqual({ isCommit: true, stagesAll: false })
  expect(commitInfo('git commit -am "x"')).toEqual({ isCommit: true, stagesAll: true })
  expect(commitInfo('git -C sub commit --all -m x')).toEqual({ isCommit: true, stagesAll: true })
  expect(commitInfo('git status')).toEqual({ isCommit: false, stagesAll: false })
  expect(commitInfo('echo "git commit"')).toEqual({ isCommit: false, stagesAll: false })
})

/** The reason classify gives for refusing the command's publish, or undefined when it is allowed. */
const refusal = (command: string): string | undefined =>
  (classify(command).find(action => action.kind === 'publish') as { problem?: string } | undefined)
    ?.problem

test('a push may send only HEAD, typed exactly, so push-ok matches what is sent', () => {
  for (const command of [
    'git push origin HEAD', 'git push -u origin HEAD:refs/heads/claude/x',
    'git push --force-with-lease origin HEAD:claude/x',
    'git push --force-with-lease=split/1-human-authority:cb20ab0879e7 origin '
      + 'HEAD:refs/heads/split/1-human-authority',
  ]) {
    expect(classify(command)).toEqual([{ kind: 'publish', what: 'git push', problem: undefined }])
  }
  for (const command of [
    'git push --all origin', 'git push --tags origin', 'git push origin other', 'git push',
    'git push -o ci.skip origin HEAD', 'git push --recurse-submodules=on-demand origin HEAD',
    'git -c push.followTags=true push origin HEAD', 'git -C ../other push origin HEAD',
    'GIT_DIR=../other/.git git push origin HEAD', 'git send-pack origin HEAD',
  ]) {
    expect(refusal(command)).toBeTruthy()
  }
})

test('a push is found however it is spelled, wrapped or chained', () => {
  for (const command of [
    'true & git push origin --all', '{ git push origin --all; }', '! git push origin --all',
    'if true; then git push origin --all; fi', '>/dev/null git push origin --all',
    'git "push" origin --all', "git pu''sh origin --all", 'git p\\ush origin --all',
    '/usr/bin/git push origin --all', '\\git push origin --all', 'timeout 60 git push origin --all',
    'nice -n 5 git push origin --all', 'sudo -u root git push origin --all', 'xargs -a f git push',
    'stdbuf -o0 git push origin --all', "bash -lc 'git push origin --all'", 'eval git push origin',
    'git -calias.p=push p origin', 'git --config-env=alias.p=V p', 'GIT_CONFIG_COUNT=1 git p',
    'git config alias.p push', 'git commit -m "$(git push origin --all)"',
    "cat <<-'EOF'\n\tEOF\ngit push origin --all\nEOF", 'git grep -O"sh -c x" push',
    "git -c Alias.x='!sh' x", 'GIT_CONFIG_GLOBAL=/tmp/a.cfg git p origin', 'HOME=/tmp git p',
    'git pu$()sh origin --all', 'git pu${NOPE}sh origin', "git $'\\x70ush' origin --all",
    'git push -n origin HEAD', "rg --pre 'sh -c x' push .",
    'git push --force-with-lease=x:abc origin HEAD', 'git push --force-with-lease=a,b origin HEAD',
    'git push --force-with-lease= origin HEAD', 'git push --force-with-lease=x origin HEAD --all',
    'git push --all HEAD', 'git push --mirror HEAD', 'git push HEAD HEAD',
    '/usr/lib/git-core/git-push origin --all', 'git http-push x',
  ]) {
    expect(refusal(command)).toBeTruthy()
  }
})

test('message text, reads and searches that mention push publish nothing', () => {
  for (const command of [
    "git commit -m 'fix the push gate'", "git commit -F - <<'EOF'\nfix push\nEOF",
    "git commit -m \"$(cat <<'EOF'\nTighten the push gate\nEOF\n)\"",
    'grep -rn "git push" README.md', 'gh api -X GET search/code -f q=push', 'git log --grep=push',
    'node scripts/devops-comments.mjs --listed push-agent-x.json', 'git stash push -m wip',
    'gh pr view 4', 'gh alias list', 'ls ~/.config/gh',
  ]) {
    expect(classify(command)).toEqual([])
  }
  expect(namesPush('!git pu"sh" --all')).toBe(true)
  expect(namesPush('log --oneline')).toBe(false)
})

test('gh writes are found past -R and --repo, and gh api writes too', () => {
  expect(classify('gh --repo o/r pr close 1'))
    .toEqual([{ kind: 'publish', what: 'gh pr close', repo: 'o/r' }])
  expect(classify('gh -R o/r pr create'))
    .toEqual([{ kind: 'publish', what: 'gh pr create', repo: 'o/r' }])
  expect(classify('gh api -X PUT repos/o/r/x'))
    .toEqual([{ kind: 'publish', what: 'gh api', repo: 'o/r' }])
  expect(classify('gh api repos/o/r/issues -f title=x'))
    .toEqual([{ kind: 'publish', what: 'gh api', repo: 'o/r' }])
  expect(refusal("bash -c 'gh pr create'")).toBeTruthy()
  expect(classify('gh -R x/y pr create'))
    .toEqual([{ kind: 'publish', what: 'gh pr create', repo: 'x/y' }])
  expect(classify('gh api -X PUT repos/o/r/contents/a'))
    .toEqual([{ kind: 'publish', what: 'gh api', repo: 'o/r' }])
  expect(classify('gh repo sync')).toEqual([{ kind: 'publish', what: 'gh repo sync' }])
  expect(classify('gh api -X GET -X PUT repos/o/r/x'))
    .toEqual([{ kind: 'publish', what: 'gh api', repo: 'o/r' }])
  expect(classify('gh api -iX PUT repos/o/r/x'))
    .toEqual([{ kind: 'publish', what: 'gh api', repo: 'o/r' }])
  expect(classify('gh api -XPOST -t repos/o/r repos/x/y/git/refs -fref=a'))
    .toEqual([{ kind: 'publish', what: 'gh api', repo: 'x/y' }])
  const refused = [
    'gh pr merge 1', "gh alias set mm 'pr merge'", 'gh mm 1', 'gh api -fq=x graphql',
    'gh api -iXPUT repos/o/r/pulls/1/merge', 'gh api --hostname h repos/o/r/x -f a=b',
    'gh api -XPUT repos/o/r/pulls/1/merge?x=1', 'gh api -XPUT repos/o/r/pulls/1//merge',
    'gh api -XPUT repos/o/r/pulls/1/merge/.', 'gh api -XPOST repos/o/r/../../x/y/git/refs',
    'gh api -XPOST repos/o/r/%2e%2e/x', 'gh api -XPUT repos/o/r/pulls/1/Merge',
  ]
  for (const command of refused) {
    expect(refusal(command)).toBeTruthy()
  }
})

test('a command is single only when nothing is chained or wrapped around it', () => {
  expect(isSingleCommand('git push origin HEAD')).toBe(true)
  expect(isSingleCommand('git commit -m "a && b"')).toBe(true)
  for (const command of [
    'git commit -am x && git push origin HEAD', 'git add .; git push origin HEAD',
    'git commit -am x & git push origin HEAD', 'echo $(git push origin HEAD)',
    'git commit -m "$(git rev-parse HEAD)"', '{ git push origin HEAD; }',
  ]) {
    expect(isSingleCommand(command)).toBe(false)
  }
})
