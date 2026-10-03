import { and, eq, gt, lte } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { onCallAssignments, shiftSchedules, shifts, users } from "./schema";

type LocalClock = {
  date: string;
  dayOfWeek: number;
  minuteOfDay: number;
};

export type OnCallResolution =
  | { status: "resolved"; shiftId: string; userId: string; priority: number }
  | { status: "inactive_shift" | "outside_schedule" | "unassigned"; shiftId: string }
  | { status: "ambiguous"; shiftId: string; priority: number; userIds: string[] };

function localClock(at: Date, timezone: string): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdays[parts.weekday];
  if (dayOfWeek === undefined) throw new Error(`No fue posible resolver el día local para ${timezone}.`);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localDateOffset(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function withinValidity(startDate: string, validFrom: string | null, validTo: string | null) {
  if (validFrom && startDate < validFrom) return false;
  if (validTo && startDate > validTo) return false;
  return true;
}

export function scheduleMatches(input: {
  at: Date;
  timezone: string;
  schedule: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    validFrom: string | null;
    validTo: string | null;
  };
}) {
  const clock = localClock(input.at, input.timezone);
  const start = timeMinutes(input.schedule.startTime);
  const end = timeMinutes(input.schedule.endTime);

  if (start < end) {
    return input.schedule.dayOfWeek === clock.dayOfWeek
      && clock.minuteOfDay >= start
      && clock.minuteOfDay < end
      && withinValidity(clock.date, input.schedule.validFrom, input.schedule.validTo);
  }

  if (input.schedule.dayOfWeek === clock.dayOfWeek && clock.minuteOfDay >= start) {
    return withinValidity(clock.date, input.schedule.validFrom, input.schedule.validTo);
  }

  const previousDay = (clock.dayOfWeek + 6) % 7;
  if (input.schedule.dayOfWeek === previousDay && clock.minuteOfDay < end) {
    return withinValidity(localDateOffset(clock.date, -1), input.schedule.validFrom, input.schedule.validTo);
  }
  return false;
}

export async function resolveOnCallUser(
  db: Cam5Database,
  shiftId: string,
  at = new Date(),
): Promise<OnCallResolution> {
  const [shift] = await db.select({
    id: shifts.id,
    timezone: shifts.timezone,
    active: shifts.active,
  }).from(shifts).where(eq(shifts.id, shiftId)).limit(1);

  if (!shift || !shift.active) return { status: "inactive_shift", shiftId };

  const schedules = await db.select({
    dayOfWeek: shiftSchedules.dayOfWeek,
    startTime: shiftSchedules.startTime,
    endTime: shiftSchedules.endTime,
    validFrom: shiftSchedules.validFrom,
    validTo: shiftSchedules.validTo,
  }).from(shiftSchedules).where(eq(shiftSchedules.shiftId, shiftId));

  if (schedules.length && !schedules.some((schedule) => scheduleMatches({
    at,
    timezone: shift.timezone,
    schedule,
  }))) {
    return { status: "outside_schedule", shiftId };
  }

  const assignments = await db.select({
    userId: onCallAssignments.userId,
    priority: onCallAssignments.priority,
  }).from(onCallAssignments)
    .innerJoin(users, eq(users.id, onCallAssignments.userId))
    .where(and(
      eq(onCallAssignments.shiftId, shiftId),
      lte(onCallAssignments.startsAt, at),
      gt(onCallAssignments.endsAt, at),
      eq(users.status, "active"),
    ));

  if (!assignments.length) return { status: "unassigned", shiftId };

  // HOIT decision: lower numeric value means higher priority. Equal top priority is ambiguous.
  const priority = Math.min(...assignments.map((assignment) => assignment.priority));
  const primary = assignments.filter((assignment) => assignment.priority === priority);
  if (primary.length > 1) {
    return {
      status: "ambiguous",
      shiftId,
      priority,
      userIds: primary.map((assignment) => assignment.userId).sort(),
    };
  }

  return {
    status: "resolved",
    shiftId,
    userId: primary[0].userId,
    priority,
  };
}
