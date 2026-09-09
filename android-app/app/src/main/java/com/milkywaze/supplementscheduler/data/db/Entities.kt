package com.milkywaze.supplementscheduler.data.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey

@Entity(tableName = "supplements")
data class SupplementEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val dosage: String,
    val stockCount: Int,
    val lowStockThreshold: Int
)

@Entity(
    tableName = "schedules",
    foreignKeys = [
        ForeignKey(
            entity = SupplementEntity::class,
            parentColumns = ["id"],
            childColumns = ["supplementId"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class ScheduleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val supplementId: Long,
    /** Minutes since midnight, e.g. 8:30 AM -> 510 */
    val timeOfDayMinutes: Int,
    /** Comma-separated ISO day-of-week numbers 1(Mon)..7(Sun) */
    val daysOfWeek: String,
    val isActive: Boolean = true
)

enum class IntakeStatus { TAKEN, SKIPPED, MISSED, PENDING }

@Entity(
    tableName = "intake_logs",
    foreignKeys = [
        ForeignKey(
            entity = ScheduleEntity::class,
            parentColumns = ["id"],
            childColumns = ["scheduleId"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class IntakeLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val scheduleId: Long,
    /** Epoch day of the scheduled date */
    val scheduledEpochDay: Long,
    val takenAtEpochMillis: Long? = null,
    val status: IntakeStatus = IntakeStatus.PENDING
)
