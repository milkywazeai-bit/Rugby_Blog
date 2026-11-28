package com.milkywaze.supplementscheduler.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.milkywaze.supplementscheduler.MainActivity
import com.milkywaze.supplementscheduler.SupplementSchedulerApp
import android.app.PendingIntent

class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val scheduleId = intent.getLongExtra(EXTRA_SCHEDULE_ID, -1L)
        val supplementName = intent.getStringExtra(EXTRA_SUPPLEMENT_NAME).orEmpty()
        if (scheduleId == -1L) return

        showNotification(context, scheduleId, supplementName)
    }

    private fun showNotification(context: Context, scheduleId: Long, supplementName: String) {
        val openIntent = Intent(context, MainActivity::class.java)
        val contentIntent = PendingIntent.getActivity(
            context, scheduleId.toInt(), openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, SupplementSchedulerApp.REMINDER_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle("복용 시간이에요")
            .setContentText("$supplementName 복용할 시간입니다")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(context).notify(scheduleId.toInt(), notification)
    }

    companion object {
        private const val EXTRA_SCHEDULE_ID = "extra_schedule_id"
        private const val EXTRA_SUPPLEMENT_ID = "extra_supplement_id"
        private const val EXTRA_SUPPLEMENT_NAME = "extra_supplement_name"

        fun buildIntent(
            context: Context,
            scheduleId: Long,
            supplementId: Long,
            supplementName: String
        ): Intent = Intent(context, ReminderReceiver::class.java).apply {
            putExtra(EXTRA_SCHEDULE_ID, scheduleId)
            putExtra(EXTRA_SUPPLEMENT_ID, supplementId)
            putExtra(EXTRA_SUPPLEMENT_NAME, supplementName)
        }
    }
}
