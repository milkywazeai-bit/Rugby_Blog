package com.milkywaze.supplementscheduler.domain

import com.milkywaze.supplementscheduler.data.db.IntakeStatus

data class Supplement(
    val id: Long,
    val name: String,
    val dosage: String,
    val stockCount: Int,
    val lowStockThreshold: Int
) {
    val isLowStock: Boolean get() = stockCount <= lowStockThreshold
}

data class Schedule(
    val id: Long,
    val supplementId: Long,
    val timeOfDayMinutes: Int,
    val daysOfWeek: Set<Int>,
    val isActive: Boolean
)

data class TodayIntakeItem(
    val scheduleId: Long,
    val supplement: Supplement,
    val timeOfDayMinutes: Int,
    val status: IntakeStatus
)
