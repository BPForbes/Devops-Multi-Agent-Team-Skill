import { expect, test } from 'claude-code/testing'

import { branchNameOf, classify, commitInfo, splitArgs, verdictOf } from './guard'

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
  expect(branchNameOf('feature/ok-1.2')).toBe('feature/ok-1.2')
  expect(branchNameOf('a..b')).toBeUndefined()
  expect(branchNameOf('x; rm -rf /')).toBeUndefined()
  expect(branchNameOf('-bad')).toBeUndefined()
})

test('a commit is recognised, and whether it stages everything', () => {
  expect(commitInfo('git commit -m "msg"')).toEqual({ isCommit: true, stagesAll: false })
  expect(commitInfo('git add -A && git commit -m x')).toEqual({ isCommit: true, stagesAll: false })
  expect(commitInfo('git commit -am "x"')).toEqual({ isCommit: true, stagesAll: true })
  expect(commitInfo('git -C sub commit --all -m x')).toEqual({ isCommit: true, stagesAll: true })
  expect(commitInfo('git status')).toEqual({ isCommit: false, stagesAll: false })
  expect(commitInfo('echo "git commit"')).toEqual({ isCommit: false, stagesAll: false })
})
