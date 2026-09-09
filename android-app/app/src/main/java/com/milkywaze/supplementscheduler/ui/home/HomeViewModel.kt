package com.milkywaze.supplementscheduler.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.milkywaze.supplementscheduler.data.repository.SupplementRepository
import com.milkywaze.supplementscheduler.domain.TodayIntakeItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val items: List<TodayIntakeItem> = emptyList(),
    val adherenceRate: Float = 0f
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: SupplementRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.observeTodayIntakeItems().collect { items ->
                _uiState.value = _uiState.value.copy(items = items)
            }
        }
        refreshAdherence()
    }

    fun onTaken(item: TodayIntakeItem) {
        viewModelScope.launch {
            repository.markTaken(item.scheduleId, item.supplement.id)
            refreshAdherence()
        }
    }

    fun onSkipped(item: TodayIntakeItem) {
        viewModelScope.launch {
            repository.markSkipped(item.scheduleId)
            refreshAdherence()
        }
    }

    private fun refreshAdherence() {
        viewModelScope.launch {
            val rate = repository.getAdherenceRate()
            _uiState.value = _uiState.value.copy(adherenceRate = rate)
        }
    }
}
