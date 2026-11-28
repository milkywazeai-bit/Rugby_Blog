package com.milkywaze.supplementscheduler.di

import android.content.Context
import androidx.room.Room
import com.milkywaze.supplementscheduler.data.db.AppDatabase
import com.milkywaze.supplementscheduler.data.db.IntakeLogDao
import com.milkywaze.supplementscheduler.data.db.ScheduleDao
import com.milkywaze.supplementscheduler.data.db.SupplementDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, AppDatabase.DATABASE_NAME)
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provideSupplementDao(db: AppDatabase): SupplementDao = db.supplementDao()

    @Provides
    fun provideScheduleDao(db: AppDatabase): ScheduleDao = db.scheduleDao()

    @Provides
    fun provideIntakeLogDao(db: AppDatabase): IntakeLogDao = db.intakeLogDao()
}
