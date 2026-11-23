import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acceptWork,
  assignWork,
  completeWork,
  workInbox,
  ackHandoff,
  addGoal,
  allowSameTeam,
  blameCounts,
  blameFor,
  closeHandoff,
  createSprint,
  emptyBoard,
  inboxFor,
  moveGoal,
  backlogView,
  markThreadRead,
  openThread,
  replyThread,
  unreadThreads,
  resolveThread,
  routeHandoff,
  sendHandoff,
  sprintView,
  threadsFor,
} from './devops-board.mjs'
import { makeHandoff } from './devops-handoff.mjs'

const AT = '2026-11-23T10:00:00Z'
const GOAL = 'goal-3c9e41'
const QA = 'agent-0c0c0c'
const CODER = 'agent-0a0a0a'
const RESEARCHER = 'agent-0f0f0f'
const T_CODER = 'team-1a2b3c'
const T_QA = 'team-4d5e6f'

function triagePayload(overrides = {}) {
  return makeHandoff('triage', {
    item: 'item-3c9e41',
    goal: GOAL,
    signedBy: QA,
    fromAgent: QA,
    fromTeam: T_QA,
    toAgent: '',
    toTeam: T_CODER,
    reason: 'The lint gate still fails',
    blame: { agent: CODER, team: T_CODER },
    created: AT,
    ...overrides,
  })
}

function withGoal() {
  const sprint = createSprint(emptyBoard(), { name: 'Sprint 1', at: AT, mint: () => '111111' })
  const board = addGoal(sprint.board, { goal: GOAL, title: 'Lint gate', sprint: sprint.id, at: AT })
  return { sprint: sprint.id, board }
}

test('a sprint opens active with no goals, and needs a name', () => {
  const { id, board } = createSprint(emptyBoard(), {
    name: ' Sprint 1 ', at: AT, mint: () => 'aaaaaa',
  })
  assert.equal(id, 'sprint-aaaaaa')
  assert.equal(board.sprints[id].name, 'Sprint 1')
  assert.equal(board.sprints[id].status, 'active')
  assert.throws(() => createSprint(emptyBoard(), { name: ' ', at: AT }), /needs a name/)
})

test('a goal goes into a sprint and can move to another one', () => {
  const { sprint, board } = withGoal()
  assert.deepEqual(sprintView(board, sprint), [
    { goal: GOAL, title: 'Lint gate', state: 'backlog' },
  ])
  const second = createSprint(board, { name: 'Sprint 2', at: AT, mint: () => 'bbbbbb' })
  const moved = addGoal(second.board, { goal: GOAL, sprint: second.id, at: AT })
  assert.deepEqual(moved.sprints[sprint].goals, [])
  assert.deepEqual(moved.sprints[second.id].goals, [GOAL])
  assert.equal(moved.goals[GOAL].history.at(-1).event, 'moved')
})

test('a goal must be a goal hash and its sprint must exist', () => {
  assert.throws(() => addGoal(emptyBoard(), { goal: 'item-3c9e41', at: AT }), /not a goal hash/)
  const unknown = () => addGoal(emptyBoard(), { goal: GOAL, sprint: 'sprint-000000', at: AT })
  assert.throws(unknown, /unknown sprint/)
})

test('a goal moves one step at a time, may block, and resumes', () => {
  const { board } = withGoal()
  const ready = moveGoal(board, { goal: GOAL, state: 'ready', at: AT })
  assert.equal(ready.goals[GOAL].state, 'ready')
  assert.throws(() => moveGoal(ready, { goal: GOAL, state: 'qa', at: AT }), /one step at a time/)
  const blocked = moveGoal(ready, { goal: GOAL, state: 'blocked', at: AT })
  const back = moveGoal(blocked, { goal: GOAL, state: 'ready', at: AT })
  assert.equal(back.goals[GOAL].state, 'ready', 'a blocked goal resumes where it was')
  assert.equal(board.goals[GOAL].state, 'backlog', 'the input board is not changed')
})

test('a handoff is accepted only from the seat that signed it', () => {
  const { board } = withGoal()
  const payload = triagePayload()
  const wrong = () => sendHandoff(board, { payload, caller: CODER, at: AT })
  assert.throws(wrong, /only the sending seat/)
  const sent = sendHandoff(board, { payload, caller: QA, at: AT, mint: () => 'cccccc' })
  assert.equal(sent.id, 'handoff-cccccc')
  assert.equal(sent.board.handoffs[sent.id].state, 'unrouted')
})

test('a handoff must name a goal on the board and pass the validator', () => {
  const { board } = withGoal()
  const missing = triagePayload({ goal: 'goal-999999' })
  const absent = () => sendHandoff(board, { payload: missing, caller: QA, at: AT })
  assert.throws(absent, /not on the board/)
  const bad = triagePayload({ reason: '' })
  assert.throws(() => sendHandoff(board, { payload: bad, caller: QA, at: AT }), /handoff refused/)
})

test('an unrouted handoff is routed to a seat, then appears in its inbox', () => {
  const { board } = withGoal()
  const sent = sendHandoff(board, {
    payload: triagePayload(), caller: QA, at: AT, mint: () => 'eeeeee',
  })
  assert.deepEqual(inboxFor(sent.board, CODER), [])
  const routed = routeHandoff(sent.board, { id: sent.id, agent: CODER, team: T_CODER, at: AT })
  assert.equal(routed.handoffs[sent.id].state, 'sent')
  assert.equal(routed.handoffs[sent.id].payload.to.agent, CODER)
  assert.equal(inboxFor(routed, CODER)[0].id, sent.id)
  const again = () => routeHandoff(routed, { id: sent.id, agent: QA, team: T_QA, at: AT })
  assert.throws(again, /already routed/)
})

test('only the addressee acknowledges, then closes, a handoff, in that order', () => {
  const { board } = withGoal()
  const sent = sendHandoff(board, {
    payload: triagePayload(), caller: QA, at: AT, mint: () => 'eeeeee',
  })
  const routed = routeHandoff(sent.board, { id: sent.id, agent: CODER, team: T_CODER, at: AT })
  assert.throws(() => ackHandoff(routed, { id: sent.id, agent: QA, at: AT }), /only the addressee/)
  const early = () => closeHandoff(routed, { id: sent.id, agent: CODER, at: AT })
  assert.throws(early, /acknowledged before/)
  const acked = ackHandoff(routed, { id: sent.id, agent: CODER, at: AT })
  assert.equal(acked.handoffs[sent.id].state, 'acked')
  const done = closeHandoff(acked, { id: sent.id, agent: CODER, at: AT })
  assert.equal(done.handoffs[sent.id].state, 'done')
  assert.deepEqual(inboxFor(done, CODER), [], 'a done handoff leaves the inbox')
})

test('a send-back records blame on the board and in the goal history', () => {
  const { board } = withGoal()
  const payload = triagePayload()
  const sent = sendHandoff(board, { payload, caller: QA, at: AT, mint: () => 'ffffff' })
  assert.equal(sent.board.blame.length, 1)
  assert.equal(sent.board.blame[0].blamed.agent, CODER)
  assert.equal(sent.board.blame[0].by, QA)
  assert.equal(sent.board.goals[GOAL].history.at(-1).event, 'sent_back')
  assert.deepEqual(blameCounts(sent.board), { [CODER]: 1 })
  assert.equal(blameFor(sent.board, { goal: GOAL }).length, 1)
  assert.equal(blameFor(sent.board, { goal: 'goal-000000' }).length, 0)
})

test('a non send-back records no blame', () => {
  const { board } = withGoal()
  const payload = makeHandoff('research-to-coder', {
    item: 'item-3c9e41', goal: GOAL, signedBy: RESEARCHER, fromAgent: RESEARCHER,
    fromTeam: T_CODER, toAgent: CODER, toTeam: T_CODER, created: AT,
  })
  const sent = sendHandoff(board, { payload, caller: RESEARCHER, at: AT })
  assert.deepEqual(sent.board.blame, [])
})

test('a board saved before blame and threads existed still loads', () => {
  const old = { version: 1, sprints: {}, goals: {}, handoffs: {} }
  const sprint = createSprint(old, { name: 'Sprint 1', at: AT, mint: () => '222222' })
  const board = addGoal(sprint.board, { goal: GOAL, title: 'Lint gate', sprint: sprint.id, at: AT })
  const sent = sendHandoff(board, { payload: triagePayload(), caller: QA, at: AT })
  assert.equal(sent.board.blame.length, 1)
  assert.deepEqual(threadsFor(board), [])
})

test('a thread is opened, answered in turn, then resolved by the seat that opened it', () => {
  const { board } = withGoal()
  const opened = openThread(board, {
    goal: GOAL, item: 'item-3c9e41', topic: 'Repro fails on the VM',
    agent: QA, team: T_QA, body: 'Step 3 gives exit 2, not 0', at: AT, mint: () => '111aaa',
  })
  assert.equal(opened.id, 'thread-111aaa')
  const replied = replyThread(opened.board, {
    thread: opened.id, agent: CODER, team: T_CODER, body: 'Which VM image?', at: AT,
  })
  assert.equal(replied.threads[opened.id].messages.length, 2)
  assert.throws(
    () => resolveThread(replied, { thread: opened.id, agent: CODER, at: AT }),
    /only the seat that opened/,
  )
  const resolved = resolveThread(replied, { thread: opened.id, agent: QA, at: AT })
  assert.equal(resolved.threads[opened.id].state, 'resolved')
  assert.throws(
    () => replyThread(resolved, {
      thread: opened.id, agent: CODER, team: T_CODER, body: 'late', at: AT,
    }),
    /is resolved/,
  )
  assert.equal(threadsFor(resolved, { goal: GOAL }).length, 1)
})

test('a thread needs a goal on the board, an item hash, a topic and a message', () => {
  const { board } = withGoal()
  const base = {
    goal: GOAL, item: 'item-3c9e41', topic: 'T', agent: QA, team: T_QA, body: 'B', at: AT,
  }
  assert.throws(() => openThread(board, { ...base, goal: 'goal-999999' }), /not on the board/)
  assert.throws(() => openThread(board, { ...base, item: 'goal-3c9e41' }), /not an item hash/)
  assert.throws(() => openThread(board, { ...base, topic: ' ' }), /needs a topic/)
  assert.throws(() => openThread(board, { ...base, body: '' }), /first message/)
})

const REVIEWER_SEAT = 'agent-0b0b0b'
const T_REVIEW = 'team-7a8b9c'

function coderToReview(board, { reviewerTeam = T_REVIEW } = {}) {
  const payload = makeHandoff('coder-to-review', {
    item: 'item-3c9e41', goal: GOAL, signedBy: CODER, fromAgent: CODER, fromTeam: T_CODER,
    toAgent: REVIEWER_SEAT, toTeam: reviewerTeam, created: AT,
  })
  return sendHandoff(board, { payload, caller: CODER, at: AT, mint: () => '333333' })
}

function reviewToQa(board, { qaTeam, reviewerTeam = T_REVIEW }) {
  const payload = makeHandoff('review-to-qa', {
    item: 'item-3c9e41', goal: GOAL, signedBy: REVIEWER_SEAT, fromAgent: REVIEWER_SEAT,
    fromTeam: reviewerTeam, toAgent: QA, toTeam: qaTeam, created: AT,
  })
  return sendHandoff(board, { payload, caller: REVIEWER_SEAT, at: AT, mint: () => '444444' })
}

test('the coder who wrote the work is recorded as its author team', () => {
  const { board } = withGoal()
  const sent = coderToReview(board)
  assert.deepEqual(sent.board.goals[GOAL].authors, [T_CODER])
})

test('a reviewer from the authoring team is refused', () => {
  const { board } = withGoal()
  assert.throws(() => coderToReview(board, { reviewerTeam: T_CODER }), /another team|must differ/)
})

test('a QA from the authoring team cannot judge the item later', () => {
  const { board } = withGoal()
  const reviewed = coderToReview(board).board
  assert.throws(
    () => reviewToQa(reviewed, { qaTeam: T_CODER }),
    /authored this goal/,
  )
  const qa = reviewToQa(reviewed, { qaTeam: T_QA })
  assert.equal(qa.board.handoffs[qa.id].state, 'sent')
})

test('routing a judge from the authoring team is refused too', () => {
  const { board } = withGoal()
  const reviewed = coderToReview(board).board
  const payload = makeHandoff('review-to-qa', {
    item: 'item-3c9e41', goal: GOAL, signedBy: REVIEWER_SEAT, fromAgent: REVIEWER_SEAT,
    fromTeam: T_REVIEW, toAgent: '', toTeam: T_QA, created: AT,
  })
  const sent = sendHandoff(reviewed, {
    payload, caller: REVIEWER_SEAT, at: AT, mint: () => '555555',
  })
  assert.throws(
    () => routeHandoff(sent.board, { id: sent.id, agent: QA, team: T_CODER, at: AT }),
    /authored this goal/,
  )
})

test('Orchestration can allow one same-team review, with a reason, and it is kept', () => {
  const { board } = withGoal()
  const reviewed = coderToReview(board).board
  assert.throws(() => reviewToQa(reviewed, { qaTeam: T_CODER }), /authored this goal/)
  const blank = () => allowSameTeam(reviewed, { goal: GOAL, team: T_CODER, reason: ' ', at: AT })
  assert.throws(blank, /needs a reason/)
  const allowed = allowSameTeam(reviewed, {
    goal: GOAL, team: T_CODER, reason: 'Only one QA seat is free', at: AT,
  })
  assert.equal(allowed.exceptions.length, 1)
  const qa = reviewToQa(allowed, { qaTeam: T_CODER })
  assert.equal(qa.board.handoffs[qa.id].payload.to.team, T_CODER)
})

test('an exception covers only its goal and its team', () => {
  const { board } = withGoal()
  const reviewed = coderToReview(board).board
  const allowed = allowSameTeam(reviewed, { goal: GOAL, team: T_QA, reason: 'Other pod', at: AT })
  assert.throws(() => reviewToQa(allowed, { qaTeam: T_CODER }), /authored this goal/)
})

const T_SEC = 'team-9a8b7c'
const SEC_SEAT = 'agent-0d0d0d'

test('work is assigned to a seat with a description, and the seat sees it', () => {
  const { board } = withGoal()
  const made = assignWork(board, {
    goal: GOAL, job: 'coder', agent: CODER, team: T_CODER,
    description: 'Fix the lint gate on the parser', by: QA, at: AT, mint: () => '666666',
  })
  assert.equal(made.id, 'work-666666')
  assert.equal(workInbox(made.board, CODER).length, 1)
  assert.equal(workInbox(made.board, SEC_SEAT).length, 0)
  assert.equal(workInbox(made.board, CODER)[0].description, 'Fix the lint gate on the parser')
})

test('assigned work needs a goal on the board, a job, a team, and a description', () => {
  const { board } = withGoal()
  const base = {
    goal: GOAL, job: 'coder', agent: CODER, team: T_CODER,
    description: 'Do it', by: QA, at: AT,
  }
  assert.throws(() => assignWork(board, { ...base, goal: 'goal-999999' }), /not on the board/)
  assert.throws(() => assignWork(board, { ...base, job: 'pizza' }), /not a job/)
  assert.throws(() => assignWork(board, { ...base, team: 'pod-1' }), /not a team hash/)
  assert.throws(() => assignWork(board, { ...base, description: ' ' }), /needs a description/)
})

test('a judging job may not go to a team that authored the goal', () => {
  const { board } = withGoal()
  const reviewed = sendHandoff(board, {
    payload: makeHandoff('coder-to-review', {
      item: 'item-3c9e41', goal: GOAL, signedBy: CODER, fromAgent: CODER, fromTeam: T_CODER,
      toAgent: '', toTeam: T_REVIEW, created: AT,
    }),
    caller: CODER, at: AT, mint: () => '777777',
  }).board
  assert.throws(
    () => assignWork(reviewed, {
      goal: GOAL, job: 'reviewer', agent: 'agent-0b0b0b', team: T_CODER,
      description: 'Review it', by: QA, at: AT,
    }),
    /authored this goal/,
  )
  const ok = assignWork(reviewed, {
    goal: GOAL, job: 'reviewer', agent: 'agent-0b0b0b', team: T_SEC,
    description: 'Review it', by: QA, at: AT,
  })
  assert.equal(ok.board.assignments[ok.id].state, 'assigned')
})

test('only the assigned seat accepts, and it completes only after accepting', () => {
  const { board } = withGoal()
  const made = assignWork(board, {
    goal: GOAL, job: 'security', agent: SEC_SEAT, team: T_SEC,
    description: 'Scan the parser', by: QA, at: AT, mint: () => '888888',
  })
  const wrongSeat = () => acceptWork(made.board, { id: made.id, agent: CODER, at: AT })
  assert.throws(wrongSeat, /only the assigned/)
  const early = () => completeWork(made.board, { id: made.id, agent: SEC_SEAT, at: AT })
  assert.throws(early, /accepted before/)
  const acc = acceptWork(made.board, { id: made.id, agent: SEC_SEAT, at: AT })
  assert.equal(acc.assignments[made.id].state, 'accepted')
  const done = completeWork(acc, { id: made.id, agent: SEC_SEAT, at: AT })
  assert.equal(done.assignments[made.id].state, 'done')
  assert.deepEqual(workInbox(done, SEC_SEAT), [], 'done work leaves the inbox')
})

test('a thread reaches the goal authors and its opener, and their unread counts', () => {
  const { board } = withGoal()
  const reviewed = coderToReview(board).board
  const opened = openThread(reviewed, {
    goal: GOAL, item: 'item-3c9e41', topic: 'Repro fails', agent: QA, team: T_QA,
    body: 'Step 3 gives exit 2', at: AT, mint: () => 'a1b2c3',
  })
  assert.deepEqual(opened.board.threads[opened.id].participants.sort(), [CODER, QA].sort())
  assert.deepEqual(unreadThreads(opened.board, CODER), [
    { id: opened.id, goal: GOAL, topic: 'Repro fails', unread: 1 },
  ])
  assert.deepEqual(unreadThreads(opened.board, QA), [], 'the opener has read its own thread')
  assert.deepEqual(unreadThreads(opened.board, REVIEWER_SEAT), [], 'not a participant')
})

test('a reply makes the thread unread for the others, and a read clears it', () => {
  const { board } = withGoal()
  const reviewed = coderToReview(board).board
  const opened = openThread(reviewed, {
    goal: GOAL, item: 'item-3c9e41', topic: 'Repro fails', agent: QA, team: T_QA,
    body: 'Step 3 gives exit 2', at: AT, mint: () => 'd4e5f6',
  })
  const replied = replyThread(opened.board, {
    thread: opened.id, agent: CODER, team: T_CODER, body: 'Which image?', at: AT,
  })
  assert.equal(unreadThreads(replied, QA)[0].unread, 1)
  assert.deepEqual(unreadThreads(replied, CODER), [], 'the replier has read its own reply')
  const read = markThreadRead(replied, { thread: opened.id, agent: QA })
  assert.deepEqual(unreadThreads(read, QA), [])
  assert.throws(
    () => markThreadRead(read, { thread: opened.id, agent: REVIEWER_SEAT }),
    /only a participant/,
  )
})

test('a blocked goal can only resume at the state it was blocked from', () => {
  const { board } = withGoal()
  const ready = moveGoal(board, { goal: GOAL, state: 'ready', at: AT })
  const blocked = moveGoal(ready, { goal: GOAL, state: 'blocked', at: AT })
  assert.throws(() => moveGoal(blocked, { goal: GOAL, state: 'done', at: AT }), /resumes at ready/)
  assert.throws(() => moveGoal(blocked, { goal: GOAL, state: 'in_progress', at: AT }), /resumes at/)
})

test('the backlog lists the goals that belong to no sprint', () => {
  const { board } = withGoal()
  const loose = addGoal(board, { goal: 'goal-7f0a12', title: 'Loose', at: AT })
  assert.deepEqual(backlogView(loose), [{ goal: 'goal-7f0a12', title: 'Loose', state: 'backlog' }])
})

test('moving a goal to another sprint keeps its authors, so independence still holds', () => {
  const { board, sprint } = withGoal()
  const reviewed = coderToReview(board).board
  const second = createSprint(reviewed, { name: 'Sprint 2', at: AT, mint: () => 'cccccc' })
  const moved = addGoal(second.board, { goal: GOAL, sprint: second.id, at: AT })
  assert.deepEqual(moved.goals[GOAL].authors, [T_CODER])
  assert.equal(moved.goals[GOAL].sprint, second.id)
  assert.ok(sprint)
  const judged = makeHandoff('review-to-qa', {
    item: 'item-3c9e41', goal: GOAL, signedBy: REVIEWER_SEAT, fromAgent: REVIEWER_SEAT,
    fromTeam: T_REVIEW, toAgent: QA, toTeam: T_CODER, created: AT,
  })
  const refused = () => sendHandoff(moved, {
    payload: judged, caller: REVIEWER_SEAT, at: AT, mint: () => '999999',
  })
  assert.throws(refused, /authored this goal/)
})
