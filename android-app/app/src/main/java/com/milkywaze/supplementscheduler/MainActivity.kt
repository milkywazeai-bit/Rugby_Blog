package com.milkywaze.supplementscheduler

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.milkywaze.supplementscheduler.ui.addsupplement.AddSupplementScreen
import com.milkywaze.supplementscheduler.ui.home.HomeScreen
import com.milkywaze.supplementscheduler.ui.theme.SupplementSchedulerTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SupplementSchedulerTheme {
                SupplementSchedulerNavHost()
            }
        }
    }
}

private object Routes {
    const val HOME = "home"
    const val ADD_SUPPLEMENT = "add_supplement"
}

@Composable
private fun SupplementSchedulerNavHost(navController: NavHostController = rememberNavController()) {
    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(onAddSupplementClick = { navController.navigate(Routes.ADD_SUPPLEMENT) })
        }
        composable(Routes.ADD_SUPPLEMENT) {
            AddSupplementScreen(onDone = { navController.popBackStack() })
        }
    }
}
