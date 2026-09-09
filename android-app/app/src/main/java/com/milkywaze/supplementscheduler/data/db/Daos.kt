package com.milkywaze.supplementscheduler.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface SupplementDao {
    @Query("SELECT * FROM supplements ORDER BY name")
    fun observeAll(): Flow<List<SupplementEntity>>

    @Query("SELECT * FROM supplements WHERE id = :id")
    suspend fun getById(id: Long): SupplementEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(supplement: SupplementEntity): Long

    @Delete
    suspend fun delete(supplement: SupplementEntity)

    @Query("UPDATE supplements SET stockCount = stockCount - 1 WHERE id = :id AND stockCount > 0")
    suspend fun decrementStock(id: Long)
}

@Dao
interface ScheduleDao {
    @Query("SELECT * FROM schedules WHERE isActive = 1")
    fun observeActive(): Flow<List<ScheduleEntity>>

    @Query("SELECT * FROM schedules WHERE supplementId = :supplementId")
    fun observeForSupplement(supplementId: Long): Flow<List<ScheduleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(schedule: ScheduleEntity): Long

    @Delete
    suspend fun delete(schedule: ScheduleEntity)
}

@Dao
interface IntakeLogDao {
    @Query(
        """
        SELECT * FROM intake_logs
        WHERE scheduledEpochDay = :epochDay
        """
    )
    fun observeForDay(epochDay: Long): Flow<List<IntakeLogEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(log: IntakeLogEntity): Long

    @Query(
        """
        SELECT * FROM intake_logs
        WHERE scheduleId = :scheduleId AND scheduledEpochDay = :epochDay
        LIMIT 1
        """
    )
    suspend fun findForScheduleAndDay(scheduleId: Long, epochDay: Long): IntakeLogEntity?

    @Query(
        """
        SELECT COUNT(*) FROM intake_logs
        WHERE scheduledEpochDay BETWEEN :fromEpochDay AND :toEpochDay AND status = 'TAKEN'
        """
    )
    suspend fun countTakenBetween(fromEpochDay: Long, toEpochDay: Long): Int

    @Query(
        """
        SELECT COUNT(*) FROM intake_logs
        WHERE scheduledEpochDay BETWEEN :fromEpochDay AND :toEpochDay
        """
    )
    suspend fun countTotalBetween(fromEpochDay: Long, toEpochDay: Long): Int
}
