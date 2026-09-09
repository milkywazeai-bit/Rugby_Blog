package com.milkywaze.supplementscheduler.ui.addsupplement

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

private val DAY_LABELS = listOf("월", "화", "수", "목", "금", "토", "일")

@Composable
fun AddSupplementScreen(
    onDone: () -> Unit,
    viewModel: AddSupplementViewModel = hiltViewModel()
) {
    var name by remember { mutableStateOf("") }
    var dosage by remember { mutableStateOf("") }
    var stockCount by remember { mutableStateOf("30") }
    var lowStockThreshold by remember { mutableStateOf("5") }
    var hour by remember { mutableStateOf("8") }
    var minute by remember { mutableStateOf("0") }
    val selectedDays = remember { mutableStateOf(setOf(1, 2, 3, 4, 5, 6, 7)) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("영양제 추가") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("영양제 이름") },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = dosage,
                onValueChange = { dosage = it },
                label = { Text("용량 (예: 1000mg 1정)") },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
            )
            Row(modifier = Modifier.padding(top = 8.dp)) {
                OutlinedTextField(
                    value = stockCount,
                    onValueChange = { stockCount = it.filter { c -> c.isDigit() } },
                    label = { Text("현재 재고") },
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = lowStockThreshold,
                    onValueChange = { lowStockThreshold = it.filter { c -> c.isDigit() } },
                    label = { Text("부족 기준") },
                    modifier = Modifier.weight(1f).padding(start = 8.dp)
                )
            }

            Text("복용 시간", modifier = Modifier.padding(top = 16.dp))
            Row {
                OutlinedTextField(
                    value = hour,
                    onValueChange = { hour = it.filter { c -> c.isDigit() }.take(2) },
                    label = { Text("시") },
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = minute,
                    onValueChange = { minute = it.filter { c -> c.isDigit() }.take(2) },
                    label = { Text("분") },
                    modifier = Modifier.weight(1f).padding(start = 8.dp)
                )
            }

            Text("요일 선택", modifier = Modifier.padding(top = 16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                DAY_LABELS.forEachIndexed { index, label ->
                    val isoDay = index + 1
                    val isSelected = isoDay in selectedDays.value
                    FilterChip(
                        selected = isSelected,
                        onClick = {
                            selectedDays.value = if (isSelected) {
                                selectedDays.value - isoDay
                            } else {
                                selectedDays.value + isoDay
                            }
                        },
                        label = { Text(label) }
                    )
                }
            }

            Button(
                onClick = {
                    val totalMinutes = (hour.toIntOrNull() ?: 0) * 60 + (minute.toIntOrNull() ?: 0)
                    viewModel.save(
                        name = name,
                        dosage = dosage,
                        stockCount = stockCount.toIntOrNull() ?: 0,
                        lowStockThreshold = lowStockThreshold.toIntOrNull() ?: 0,
                        timeOfDayMinutes = totalMinutes,
                        daysOfWeek = selectedDays.value,
                        onSaved = onDone
                    )
                },
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp)
            ) {
                Text("저장")
            }
        }
    }
}
