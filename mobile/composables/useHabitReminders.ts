import { Capacitor, registerPlugin } from '@capacitor/core'
import type { NativeHabit, HabitPlace } from '../../utils/habits'

// The app's own native plugin, "HabitReminders" (ios/App/App/
// HabitRemindersPlugin.swift, android/.../HabitRemindersPlugin.java): it
// schedules "Mis hábitos" as local notifications on the phone. A habit with
// places is scheduled by the phone itself when it arrives at one of them and
// cancelled when it leaves -- with the app closed, which is why that part is
// native and not here. Nothing about the places or the location leaves the
// phone. "Hecho" on a notification is kept natively until the app next opens
// and hands it over (takePendingCheckins), since the app may not be running.

export type PermissionState = 'granted' | 'denied' | 'prompt'
export type LocationPermission = 'always' | 'whenInUse' | 'denied' | 'prompt'

export interface PendingCheckin { habitId: string; kind: string; doneAt: string; clientId: string }

interface HabitRemindersPlugin {
  schedule(options: { habits: NativeHabit[]; places: Pick<HabitPlace, 'id' | 'lat' | 'lng' | 'radius'>[] }): Promise<void>
  checkPermissions(): Promise<{ notifications: PermissionState; location: LocationPermission }>
  requestNotifications(): Promise<{ notifications: PermissionState }>
  requestLocationAlways(): Promise<{ location: LocationPermission }>
  currentPosition(): Promise<{ lat: number; lng: number }>
  takePendingCheckins(): Promise<{ checkins: PendingCheckin[] }>
  addListener(event: 'habitOpened', cb: (data: { habitId: string }) => void): Promise<{ remove: () => Promise<void> }>
}

const HabitReminders = registerPlugin<HabitRemindersPlugin>('HabitReminders')

/** Whether this is the app on a phone (the portal and a browser have no reminders). */
export const habitRemindersAvailable = () => Capacitor.isNativePlatform()

export function useHabitReminders() {
  const available = habitRemindersAvailable()
  return {
    available,
    schedule: (habits: NativeHabit[], places: HabitPlace[]) =>
      available ? HabitReminders.schedule({ habits, places: places.map(({ id, lat, lng, radius }) => ({ id, lat, lng, radius })) }) : Promise.resolve(),
    checkPermissions: () => (available ? HabitReminders.checkPermissions() : Promise.resolve({ notifications: 'denied' as PermissionState, location: 'denied' as LocationPermission })),
    requestNotifications: () => (available ? HabitReminders.requestNotifications() : Promise.resolve({ notifications: 'denied' as PermissionState })),
    requestLocationAlways: () => (available ? HabitReminders.requestLocationAlways() : Promise.resolve({ location: 'denied' as LocationPermission })),
    currentPosition: () => HabitReminders.currentPosition(),
    takePendingCheckins: async () => (available ? (await HabitReminders.takePendingCheckins()).checkins : []),
    /** A habit notification was tapped (not its buttons). */
    onOpened: (cb: (habitId: string) => void) => (available ? HabitReminders.addListener('habitOpened', (d) => cb(d.habitId)) : Promise.resolve({ remove: async () => {} })),
  }
}
