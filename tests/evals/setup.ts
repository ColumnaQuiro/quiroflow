import { vi } from 'vitest'

// The receptionist's server modules import what talks to the database, the
// automations and push notifications. The evals call none of it -- their
// tools are stand-ins answering from the fixture -- so those modules are
// replaced here, where nothing reaches them.
vi.mock('~/server/utils/requireGrowth', () => ({ hasReceptionist: () => true, hasGrowth: () => true }))
vi.mock('~/server/utils/leadConversion', () => ({}))
vi.mock('~/server/utils/publicApiAppointments', () => ({}))
vi.mock('~/server/utils/automationEngine', () => ({}))
vi.mock('~/server/utils/unattendedCancellation', () => ({}))
vi.mock('~/server/utils/staffPush', () => ({}))
vi.mock('~/server/utils/appointmentNotifications', () => ({}))
vi.mock('~/server/utils/receptionistAudit', () => ({}))
vi.mock('~/server/utils/recallReplies', () => ({}))
