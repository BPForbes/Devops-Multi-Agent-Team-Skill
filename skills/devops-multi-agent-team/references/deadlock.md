# Deadlocks and the client's vision

Read this file. Do not paste it into seat prompts.

The Business Analyst watches every team the way a team lead watches its
members. A goal that stops moving is a **deadlock**: the team may be stuck,
or building something other than the client's vision. Rules:
`scripts/devops-vision.mjs`. Records: the board's `deadlocks` and each goal's
`vision` notes.

## What counts as stalled

A goal is stalled when either is true (`deadlock_scan` lists them):

- it stayed unchanged across **2 standups** of its team (the daily meeting),
  counted since its last change;
- it was **sent back twice**.

A goal with an open deadlock is not listed again.

## The flow

1. **Lead looks for the vision.** The team lead reads the goal's objective,
   acceptance and vision notes on the dashboard first.
2. **Lead raises it** (`deadlock_raise`), with the reason. The record says
   whether a vision was found. Only that team's lead may raise.
3. **BA decides.** The BA reads the vision and either:
   - gives it (`deadlock_resolve` with `vision`): the BA's reading becomes a
     vision note, and feedback goes to the lead; or
   - asks the client (`deadlock_resolve` with `question`): the goal waits
     until the person answers.
4. **Client answers.** The person types `/devops answer DEADLOCK-ID TEXT`. The
   answer becomes the goal's vision note (source `client`), and feedback goes to
   the BA, then the lead.
5. **Lead forwards** (`deadlock_forward`) the feedback to the team's members,
   at the next standup or refinement (`meeting`). The deadlock closes.

Standup and refinement are where most of these loops run: the lead carries
the BA's feedback there, and the record keeps the meeting it was forwarded at.

## Vision notes

`goal_vision` adds a note with its source (`client`, `ba` or `lead`). The
person adds one with `/devops vision GOAL TEXT`. Notes stay in the goal's
history and show on the dashboard next to its objective and acceptance.

## Limits

- A BA that does not act leaves the deadlock open. Nothing times it out yet.
- The standup count is the only clock: a team that holds no standups will
  not stall by this rule (a send-back still counts).
