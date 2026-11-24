import { expect, test } from 'claude-code/testing'

import {
  branchNameOf, chatAuthorizesPush, classify, commitInfo, interpretDevopsIntent, shellWords,
  splitArgs, treeOf, verdictOf,
} from './guard'

test('git push and gh pr publishing are found, however they are spelled', () => {
  expect(classify('git push origin HEAD')).toEqual([{ kind: 'publish', what: 'git push' }])
  expect(classify('git -C sub -c user.name=x push -u origin main')).toEqual([{ kind: 'publish', what: 'git push' }])
  expect(classify('cd x && FOO=1 sudo git push')).toEqual([{ kind: 'publish', what: 'git push' }])
  expect(classify('gh pr create --title t')).toEqual([{ kind: 'publish', what: 'gh pr create' }])
  expect(classify('gh pr merge 4 --squash')).toEqual([{ kind: 'publish', what: 'gh pr merge' }])
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

test('a push hidden in a shell wrapper, env, xargs or eval is still a push', () => {
  for (const command of [
    'bash -c "git push"', "sh -c 'git push origin HEAD'", 'env -i PATH=$PATH git push',
    'eval "git push"', 'xargs git push', 'nohup git push', 'git -c alias.x=push x',
  ]) {
    expect(classify(command).some(action => action.kind === 'publish')).toBe(true)
  }
  expect(classify('git commit -m "do not git push yet"')).toEqual([])
})

test('chat "push" authorizes only from the person, and only as the whole message', () => {
  expect(chatAuthorizesPush('push', 'composer')).toBe(true)
  expect(chatAuthorizesPush('  Push it ', 'composer')).toBe(true)
  expect(chatAuthorizesPush('push', 'peer')).toBe(false)
  expect(chatAuthorizesPush('push', undefined)).toBe(false)
  expect(chatAuthorizesPush('please push the fix', 'composer')).toBe(false)
  expect(chatAuthorizesPush('go ahead and push', 'composer')).toBe(false)
})
