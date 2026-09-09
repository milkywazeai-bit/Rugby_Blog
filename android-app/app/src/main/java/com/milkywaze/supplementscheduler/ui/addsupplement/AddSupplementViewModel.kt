package com.milkywaze.supplementscheduler.ui.addsupplement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.milkywaze.supplementscheduler.data.repository.SupplementRepository
import com.milkywaze.supplementscheduler.notification.ReminderScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AddSupplementViewModel @Inject constructor(
    private val repository: SupplementRepository,
    private val reminderScheduler: ReminderScheduler
) : ViewModel() {

    fun save(
        name: String,
        dosage: String,
        stockCount: Int,
        lowStockThreshold: Int,
        timeOfDayMinutes: Int,
        daysOfWeek: Set<Int>,
        onSaved: () -> Unit
    ) {
        if (name.isBlank() || daysOfWeek.isEmpty()) return

        viewModelScope.launch {
            val supplementId = repository.addSupplement(name, dosage, stockCount, lowStockThreshold)
            val scheduleId = repository.addSchedule(supplementId, timeOfDayMinutes, daysOfWeek)
            reminderScheduler.scheduleWeekly(
                scheduleId = scheduleId,
                supplementId = supplementId,
                supplementName = name,
                timeOfDayMinutes = timeOfDayMinutes,
                daysOfWeek = daysOfWeek
            )
            onSaved()
        }
    }
}
