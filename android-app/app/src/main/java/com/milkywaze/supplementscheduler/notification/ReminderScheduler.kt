package com.milkywaze.supplementscheduler.notification

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Schedules exact alarms per (scheduleId, dayOfWeek) so reminders keep firing
 * even under Doze, and re-registers itself for the following week after firing.
 */
@Singleton
class ReminderScheduler @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    fun scheduleWeekly(
        scheduleId: Long,
        supplementId: Long,
        supplementName: String,
        timeOfDayMinutes: Int,
        daysOfWeek: Set<Int>
    ) {
        daysOfWeek.forEach { isoDayOfWeek ->
            val triggerAt = nextTriggerMillis(isoDayOfWeek, timeOfDayMinutes)
            val intent = ReminderReceiver.buildIntent(
                context, scheduleId, supplementId, supplementName
            )
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode(scheduleId, isoDayOfWeek),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerAt,
                pendingIntent
            )
        }
    }

    fun cancel(scheduleId: Long, daysOfWeek: Set<Int>) {
        daysOfWeek.forEach { isoDayOfWeek ->
            val intent = ReminderReceiver.buildIntent(context, scheduleId, 0, "")
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode(scheduleId, isoDayOfWeek),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.cancel(pendingIntent)
        }
    }

    private fun requestCode(scheduleId: Long, isoDayOfWeek: Int): Int =
        (scheduleId * 10 + isoDayOfWeek).toInt()

    private fun nextTriggerMillis(isoDayOfWeek: Int, timeOfDayMinutes: Int): Long {
        val zone = ZoneId.systemDefault()
        val time = LocalTime.of(timeOfDayMinutes / 60, timeOfDayMinutes % 60)
        var date = LocalDate.now(zone)
        while (date.dayOfWeek.value != isoDayOfWeek ||
            date.atTime(time).atZone(zone).toInstant().toEpochMilli() < System.currentTimeMillis()
        ) {
            date = date.plusDays(1)
        }
        return date.atTime(time).atZone(zone).toInstant().toEpochMilli()
    }
}
