package com.milkywaze.supplementscheduler.data.repository

import com.milkywaze.supplementscheduler.data.db.IntakeLogDao
import com.milkywaze.supplementscheduler.data.db.IntakeLogEntity
import com.milkywaze.supplementscheduler.data.db.IntakeStatus
import com.milkywaze.supplementscheduler.data.db.ScheduleDao
import com.milkywaze.supplementscheduler.data.db.ScheduleEntity
import com.milkywaze.supplementscheduler.data.db.SupplementDao
import com.milkywaze.supplementscheduler.data.db.SupplementEntity
import com.milkywaze.supplementscheduler.domain.Schedule
import com.milkywaze.supplementscheduler.domain.Supplement
import com.milkywaze.supplementscheduler.domain.TodayIntakeItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupplementRepository @Inject constructor(
    private val supplementDao: SupplementDao,
    private val scheduleDao: ScheduleDao,
    private val intakeLogDao: IntakeLogDao
) {
    fun observeSupplements(): Flow<List<Supplement>> =
        supplementDao.observeAll().map { list -> list.map { it.toDomain() } }

    suspend fun addSupplement(name: String, dosage: String, stockCount: Int, lowStockThreshold: Int): Long =
        supplementDao.upsert(
            SupplementEntity(
                name = name,
                dosage = dosage,
                stockCount = stockCount,
                lowStockThreshold = lowStockThreshold
            )
        )

    suspend fun addSchedule(supplementId: Long, timeOfDayMinutes: Int, daysOfWeek: Set<Int>): Long =
        scheduleDao.upsert(
            ScheduleEntity(
                supplementId = supplementId,
                timeOfDayMinutes = timeOfDayMinutes,
                daysOfWeek = daysOfWeek.joinToString(",")
            )
        )

    fun observeTodayIntakeItems(today: LocalDate = LocalDate.now()): Flow<List<TodayIntakeItem>> {
        val epochDay = today.toEpochDay()
        val isoDayOfWeek = today.dayOfWeek.value // 1=Mon..7=Sun

        return combine(
            supplementDao.observeAll(),
            scheduleDao.observeActive(),
            intakeLogDao.observeForDay(epochDay)
        ) { supplements, schedules, logs ->
            val supplementsById = supplements.associateBy { it.id }
            schedules
                .filter { schedule -> isoDayOfWeek in schedule.parseDays() }
                .mapNotNull { schedule ->
                    val supplement = supplementsById[schedule.supplementId] ?: return@mapNotNull null
                    val log = logs.find { it.scheduleId == schedule.id }
                    TodayIntakeItem(
                        scheduleId = schedule.id,
                        supplement = supplement.toDomain(),
                        timeOfDayMinutes = schedule.timeOfDayMinutes,
                        status = log?.status ?: IntakeStatus.PENDING
                    )
                }
                .sortedBy { it.timeOfDayMinutes }
        }
    }

    suspend fun markTaken(scheduleId: Long, supplementId: Long, today: LocalDate = LocalDate.now()) {
        intakeLogDao.upsert(
            IntakeLogEntity(
                scheduleId = scheduleId,
                scheduledEpochDay = today.toEpochDay(),
                takenAtEpochMillis = System.currentTimeMillis(),
                status = IntakeStatus.TAKEN
            )
        )
        supplementDao.decrementStock(supplementId)
    }

    suspend fun markSkipped(scheduleId: Long, today: LocalDate = LocalDate.now()) {
        intakeLogDao.upsert(
            IntakeLogEntity(
                scheduleId = scheduleId,
                scheduledEpochDay = today.toEpochDay(),
                status = IntakeStatus.SKIPPED
            )
        )
    }

    suspend fun getAdherenceRate(daysBack: Long = 7): Float {
        val today = LocalDate.now().toEpochDay()
        val from = today - (daysBack - 1)
        val taken = intakeLogDao.countTakenBetween(from, today)
        val total = intakeLogDao.countTotalBetween(from, today)
        return if (total == 0) 0f else taken.toFloat() / total
    }
}

private fun SupplementEntity.toDomain() = Supplement(
    id = id,
    name = name,
    dosage = dosage,
    stockCount = stockCount,
    lowStockThreshold = lowStockThreshold
)

private fun ScheduleEntity.parseDays(): Set<Int> =
    daysOfWeek.split(",").filter { it.isNotBlank() }.map { it.toInt() }.toSet()

private fun ScheduleEntity.toDomain() = Schedule(
    id = id,
    supplementId = supplementId,
    timeOfDayMinutes = timeOfDayMinutes,
    daysOfWeek = parseDays(),
    isActive = isActive
)
