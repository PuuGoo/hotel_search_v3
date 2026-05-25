# New Features Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver continuous high-value product features in phased releases, finishing each phase with verification before moving to the next.

**Architecture:** Use a vertical-slice rollout: each phase includes backend, realtime/socket behavior, frontend UX, and tests in one pass. Keep phases independently shippable, with explicit acceptance checks. Reuse existing chat/realtime modules and extend behavior incrementally.

**Tech Stack:** Node.js, Express, Socket.IO, vanilla JS frontend widget, Jest/Supertest.

---

## Phase Roadmap (Auto-continue model)

### Phase 1: Realtime Message Lifecycle (Edit/Delete + Sync)
**Outcome:** Users can edit/delete own messages with realtime sync across all clients.

**Files:**
- Modify: `utils/websocket.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/chatRealtime.test.js`
- Modify: `tests/websocket.test.js`

**Acceptance:**
- Edit/delete events broadcast correctly.
- UI reflects edited/deleted states without reload.
- Targeted realtime tests pass.

---

### Phase 2: Room Presence + Read Receipts
**Outcome:** Per-room online presence and message read receipts for DM/support/group.

**Files:**
- Modify: `utils/websocket.js`
- Modify: `utils/realtimeNotifications.js`
- Modify: `public/chatWidget.js`
- Modify: `routes/realtimeNotifications.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`
- Modify: `tests/chatRealtime.test.js`

**Acceptance:**
- Presence list updates join/leave in realtime.
- Read receipt updates unread counters correctly.
- No regression in notification tests.

---

### Phase 3: Admin Moderation Tools (Realtime)
**Outcome:** Admin can soft-delete any message, mute users per room, and lock/unlock rooms.

**Files:**
- Modify: `utils/websocket.js`
- Modify: `routes/websocket.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/websocket.test.js`
- Modify: `tests/routes.test.js`

**Acceptance:**
- Permission checks enforced server-side.
- Realtime events emitted for moderation actions.
- Unauthorized paths return 403 and are tested.

---

### Phase 4: Delivery Guarantees + Reconnect Recovery
**Outcome:** Robust reconnect flow with missed-message replay and idempotent event handling.

**Files:**
- Modify: `utils/websocket.js`
- Modify: `utils/realtimeNotifications.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/chatRealtime.test.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`

**Acceptance:**
- Reconnect clients resync room state reliably.
- Duplicate deliveries are prevented client-side/server-side.
- Recovery tests pass consistently.

---

### Phase 5: Observability + Operational Controls
**Outcome:** Structured audit trail for socket events and admin endpoints for diagnostics.

**Files:**
- Modify: `routes/websocket.js`
- Modify: `routes/realtimeNotifications.js`
- Modify: `utils/websocket.js`
- Modify: `tests/websocket.test.js`
- Modify: `tests/routes.test.js`

**Acceptance:**
- Key socket lifecycle events logged with metadata.
- Admin diagnostics endpoints validated and permission-guarded.
- Route + websocket test suites remain green.

---

### Phase 6: Search + Filter in Chat History
**Outcome:** Users can search message history by keyword, sender, and time range with realtime-safe rendering.

**Files:**
- Modify: `routes/chat.js`
- Modify: `utils/websocket.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/routes.test.js`
- Modify: `tests/chatRealtime.test.js`

**Acceptance:**
- Search API returns accurate filtered results.
- Frontend query state and results are stable while realtime messages continue.
- Route and realtime tests remain green.

---

### Phase 7: File Attachments Metadata + Preview Events
**Outcome:** Realtime sharing of attachment metadata (name/type/size/url) and safe preview card rendering.

**Files:**
- Modify: `utils/websocket.js`
- Modify: `routes/chat.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/websocket.test.js`
- Modify: `tests/routes.test.js`

**Acceptance:**
- Attachment metadata events broadcast and persist correctly.
- Client displays preview cards without breaking text-only flows.
- Validation blocks malformed attachment payloads.

---

### Phase 8: SLA Automation for Support Rooms
**Outcome:** Auto-tag stale support threads, escalate by inactivity thresholds, and notify admins in realtime.

**Files:**
- Modify: `utils/realtimeNotifications.js`
- Modify: `utils/websocket.js`
- Modify: `routes/realtimeNotifications.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`
- Modify: `tests/websocket.test.js`

**Acceptance:**
- SLA timers tag and escalate eligible rooms.
- Admin notifications fire once per escalation stage.
- No duplicate alerts across reconnect cycles.

---

### Phase 9: Smart Routing for Support Intake
**Outcome:** Incoming support chats are auto-routed to the most relevant admin queue based on topic, load, and priority.

**Files:**
- Modify: `routes/chat.js`
- Modify: `utils/realtimeNotifications.js`
- Modify: `utils/websocket.js`
- Modify: `tests/routes.test.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`

**Acceptance:**
- New support sessions are assigned deterministically.
- Queue balancing logic respects active admin load.
- Routing outcomes are visible in realtime events.

---

### Phase 10: Conversation Summaries + Handoff Notes
**Outcome:** Generate concise room summaries and handoff notes for admin shift changes.

**Files:**
- Modify: `utils/websocket.js`
- Modify: `routes/chat.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/chatRealtime.test.js`
- Modify: `tests/routes.test.js`

**Acceptance:**
- Summary endpoint/event produces stable structured output.
- Handoff notes persist and broadcast correctly.
- No regression to existing chat message flows.

---

### Phase 11: Proactive User Re-engagement
**Outcome:** Trigger contextual follow-up nudges for unresolved chats after inactivity windows.

**Files:**
- Modify: `utils/realtimeNotifications.js`
- Modify: `utils/websocket.js`
- Modify: `routes/realtimeNotifications.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`
- Modify: `tests/websocket.test.js`

**Acceptance:**
- Nudge rules fire once per rule window and avoid spam.
- Opt-out and resolved states suppress nudges correctly.
- Realtime notification tests remain green.

---

### Phase 12: Multi-language Realtime Support
**Outcome:** Realtime chat supports localized system messages and per-user language preferences.

**Files:**
- Modify: `public/chatWidget.js`
- Modify: `routes/chat.js`
- Modify: `utils/websocket.js`
- Modify: `tests/routes.test.js`
- Modify: `tests/chatRealtime.test.js`

**Acceptance:**
- System/status messages render in selected language.
- Language preference persists and applies on reconnect.
- Existing message delivery flows remain intact.

---

### Phase 13: Knowledge-Suggested Replies for Admin
**Outcome:** Provide realtime suggested replies for admins based on recent room context and FAQ mappings.

**Files:**
- Modify: `routes/chat.js`
- Modify: `utils/websocket.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/routes.test.js`
- Modify: `tests/websocket.test.js`

**Acceptance:**
- Suggestion payloads arrive with deterministic shape.
- Admin can insert suggestion into compose flow quickly.
- Suggestions never auto-send without explicit admin action.

---

### Phase 14: Conversation Quality Signals
**Outcome:** Compute lightweight quality metrics (response latency, reopen rate, unresolved flags) and surface them in realtime dashboard widgets.

**Files:**
- Modify: `utils/realtimeNotifications.js`
- Modify: `routes/realtimeNotifications.js`
- Modify: `routes/pages.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`
- Modify: `tests/routes.test.js`

**Acceptance:**
- Metrics update deterministically from event stream.
- Dashboard widgets refresh without full-page reload.
- Quality signal tests validate calculation integrity.

---

### Phase 15: SLA Prediction Alerts
**Outcome:** Predict likely SLA breaches and alert admins before thresholds are hit.

**Files:**
- Modify: `utils/realtimeNotifications.js`
- Modify: `routes/realtimeNotifications.js`
- Modify: `public/chatWidget.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`
- Modify: `tests/routes.test.js`

**Acceptance:**
- Prediction alerts trigger from deterministic rules.
- Alerts are deduplicated per room/time window.
- Existing SLA automation behavior remains stable.

---

### Phase 16: Team Assignment Suggestions
**Outcome:** Suggest best-fit admin/team assignee in realtime using workload + topic metadata.

**Files:**
- Modify: `routes/chat.js`
- Modify: `utils/websocket.js`
- Modify: `utils/realtimeNotifications.js`
- Modify: `tests/routes.test.js`
- Modify: `tests/websocket.test.js`

**Acceptance:**
- Suggestions include explainable scoring factors.
- Suggested assignment can be accepted/rejected explicitly.
- Assignment updates broadcast correctly to room subscribers.

---

### Phase 17: Post-Chat Feedback Loop
**Outcome:** Collect post-chat feedback and feed quality signals back to admin dashboard in near realtime.

**Files:**
- Modify: `routes/chat.js`
- Modify: `routes/pages.js`
- Modify: `utils/realtimeNotifications.js`
- Modify: `tests/routes.test.js`
- Modify: `tests/realtimeNotificationsSocket.test.js`

**Acceptance:**
- Feedback submissions are validated and stored.
- Aggregate feedback metrics update dashboard widgets.
- No regressions in existing chat completion flows.

---

## Execution Rules (for loop auto-progress)

1. Finish current phase only when acceptance criteria and related tests are green.
2. Immediately start next phase without waiting for manual prompt.
3. If blocked, create a micro-task inside current phase, resolve, then continue.
4. Keep each phase incremental; avoid unrelated refactors.
5. At phase end, run:
   - `npm test -- tests/chatRealtime.test.js tests/websocket.test.js tests/realtimeNotificationsSocket.test.js tests/routes.test.js`

## Self-review

- Spec coverage: Roadmap covers message lifecycle, presence/receipt, moderation, recovery, observability, search, attachments, SLA automation, smart routing, summaries/handoffs, re-engagement nudges, localization, suggested replies, quality signals, SLA prediction, assignment suggestions, and post-chat feedback.
- Placeholder scan: No TBD/TODO placeholders.
- Consistency: File paths and responsibilities align with current codebase modules.
