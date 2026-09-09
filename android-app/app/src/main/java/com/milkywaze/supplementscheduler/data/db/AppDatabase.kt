package com.milkywaze.supplementscheduler.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters

class Converters {
    @TypeConverter
    fun fromIntakeStatus(status: IntakeStatus): String = status.name

    @TypeConverter
    fun toIntakeStatus(value: String): IntakeStatus = IntakeStatus.valueOf(value)
}

@Database(
    entities = [SupplementEntity::class, ScheduleEntity::class, IntakeLogEntity::class],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun supplementDao(): SupplementDao
    abstract fun scheduleDao(): ScheduleDao
    abstract fun intakeLogDao(): IntakeLogDao

    companion object {
        const val DATABASE_NAME = "supplement_scheduler.db"
    }
}
