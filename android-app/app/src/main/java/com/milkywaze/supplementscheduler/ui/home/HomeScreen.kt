package com.milkywaze.supplementscheduler.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.milkywaze.supplementscheduler.data.db.IntakeStatus
import com.milkywaze.supplementscheduler.domain.TodayIntakeItem

@Composable
fun HomeScreen(
    onAddSupplementClick: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = onAddSupplementClick) {
                Icon(Icons.Filled.Add, contentDescription = "영양제 추가")
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            Text("오늘의 복용 일정", style = androidx.compose.material3.MaterialTheme.typography.titleLarge)

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("최근 7일 복용률")
                Text("${(uiState.adherenceRate * 100).toInt()}%")
            }
            LinearProgressIndicator(
                progress = { uiState.adherenceRate },
                modifier = Modifier.fillMaxWidth()
            )

            if (uiState.items.isEmpty()) {
                Text(
                    "등록된 영양제가 없어요. + 버튼으로 추가해보세요.",
                    modifier = Modifier.padding(top = 32.dp)
                )
            } else {
                LazyColumn(modifier = Modifier.padding(top = 16.dp)) {
                    items(uiState.items, key = { it.scheduleId }) { item ->
                        TodayItemCard(
                            item = item,
                            onTaken = { viewModel.onTaken(item) },
                            onSkipped = { viewModel.onSkipped(item) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TodayItemCard(
    item: TodayIntakeItem,
    onTaken: () -> Unit,
    onSkipped: () -> Unit
) {
    Card(modifier = Modifier
        .fillMaxWidth()
        .padding(vertical = 6.dp)) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(item.supplement.name, style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
            Text("${item.supplement.dosage} · ${formatTime(item.timeOfDayMinutes)}")
            if (item.supplement.isLowStock) {
                Text("재고 부족: ${item.supplement.stockCount}개 남음")
            }

            Row(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                when (item.status) {
                    IntakeStatus.TAKEN -> Text("복용 완료")
                    IntakeStatus.SKIPPED -> Text("건너뜀")
                    else -> {
                        Button(onClick = onTaken) { Text("복용 완료") }
                        TextButton(onClick = onSkipped) { Text("건너뛰기") }
                    }
                }
            }
        }
    }
}

private fun formatTime(minutes: Int): String {
    val h = minutes / 60
    val m = minutes % 60
    return "%02d:%02d".format(h, m)
}
