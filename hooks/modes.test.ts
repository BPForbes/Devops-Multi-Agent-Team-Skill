import { expect, test } from 'claude-code/testing'

import {
  interpretSkillIntent, orchestrationCard, parseSkillMode, scriptArgsFor,
  scriptNameFor, takeModeFlag,
} from './modes'

test('parseSkillMode maps aliases and --mode', () => {
  expect(parseSkillMode('ask', '--mode symbol total')).toEqual({
    word: 'question', mode: 'symbol', rest: 'total',
  })
  expect(parseSkillMode('mindmap', '')).toEqual({
    word: 'mind-map', mode: 'overview', rest: '',
  })
  expect(parseSkillMode('tidy', '--mode scan split big functions in src')).toEqual({
    word: 'clean', mode: 'scan', rest: 'split big functions in src',
  })
})

test('takeModeFlag falls back when the mode is unknown', () => {
  expect(takeModeFlag('--mode nope hello', ['brief', 'scan'], 'brief')).toEqual({
    mode: 'brief', rest: 'hello',
  })
})

test('free-form phrases route to skill modes', () => {
  expect(interpretSkillIntent('how does total work')).toEqual({
    word: 'question', mode: 'search', rest: 'how does total work',
  })
  expect(interpretSkillIntent('map this project')).toEqual({
    word: 'mind-map', mode: 'build', rest: 'map this project',
  })
  expect(interpretSkillIntent('clean up comments in src')).toEqual({
    word: 'clean', mode: 'brief', rest: 'clean up comments in src',
  })
  expect(interpretSkillIntent('run research on auth')).toEqual({
    word: 'stage', mode: 'research', rest: 'run research on auth',
  })
  expect(interpretSkillIntent('allocate agents for billing')).toEqual({
    word: 'allocate', mode: 'agent', rest: 'allocate agents for billing',
  })
  expect(interpretSkillIntent('map --mode tree total')).toEqual({
    word: 'mind-map', mode: 'tree', rest: 'total',
  })
  expect(interpretSkillIntent('something novel')).toBeUndefined()
})

test('orchestrationCard names tools and keeps free-form dumps out', () => {
  const text = orchestrationCard({
    word: 'question', mode: 'symbol', rest: 'total',
  })
  expect(text).toContain('## /devops question')
  expect(text).toContain('mindmap_query')
  expect(text).toContain('input: total')
  expect(text).not.toContain('Free-form /devops directive')
})

test('help and stage cards list catalog and seats', () => {
  const help = orchestrationCard({ word: 'help', mode: 'skills', rest: '' })
  expect(help).toContain('/devops question')
  expect(help).toContain('/devops stage')
  const stage = orchestrationCard({
    word: 'ci', mode: 'security', rest: 'lock down secrets',
  })
  expect(stage).toContain('## /devops stage')
  expect(stage).toContain('Security Engineer')
  expect(stage).toContain('input: lock down secrets')
})

test('scriptArgsFor shells out for mind-map and clean', () => {
  expect(scriptNameFor({ word: 'mind-map', mode: 'build', rest: '' }))
    .toBe('devops-mindmap.mjs')
  expect(scriptArgsFor({ word: 'mind-map', mode: 'build', rest: '' }))
    .toEqual(['build', '--save'])
  expect(scriptArgsFor({ word: 'question', mode: 'symbol', rest: 'total' }))
    .toEqual(['query', '--symbol', 'total'])
  expect(scriptArgsFor({ word: 'clean', mode: 'brief', rest: 'tidy src' }))
    .toEqual(['brief', '--statement', 'tidy src'])
  expect(scriptArgsFor({ word: 'goal', mode: 'loop', rest: 'ship X' }))
    .toBeUndefined()
})
