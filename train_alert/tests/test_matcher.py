"""SRT에 붙지 않고 확인할 수 있는 순수 로직 테스트.

    python -m unittest discover -s train_alert/tests
"""

import unittest
from datetime import timedelta

from train_alert.config import Leg, load_config, normalize_time, now_kst
from train_alert.fake import AVAILABLE, SOLD_OUT
from train_alert.matcher import SEAT, TrainView, alert_key, build_result
from train_alert.state import State


def leg(**kwargs):
    base = dict(
        id="go", dep="수서", arr="부산", date="20260924",
        time_from="05:00", time_to="11:59", adults=2,
    )
    base.update(kwargs)
    return Leg(**base)


def train(dep_time, general=SOLD_OUT, special=SOLD_OUT, standby=False, number="301"):
    return TrainView(
        train_name="KTX",
        train_number=number,
        dep_time=dep_time,
        arr_time="090000",
        dep_station="수서",
        arr_station="부산",
        general_state=general,
        special_state=special,
        general_available=general == AVAILABLE,
        special_available=special == AVAILABLE,
        standby_available=standby,
    )


class TimeParsingTest(unittest.TestCase):
    def test_various_time_formats(self):
        self.assertEqual(normalize_time("6"), "060000")
        self.assertEqual(normalize_time("06"), "060000")
        self.assertEqual(normalize_time("610"), "061000")
        self.assertEqual(normalize_time("06:10"), "061000")
        self.assertEqual(normalize_time("061000"), "061000")

    def test_reversed_window_is_rejected(self):
        with self.assertRaises(ValueError):
            leg(time_from="19:00", time_to="16:00")


class WindowTest(unittest.TestCase):
    def test_only_trains_inside_window_are_kept(self):
        trains = [
            train("043000", general=AVAILABLE, number="299"),
            train("061000", general=AVAILABLE, number="301"),
            train("123000", general=AVAILABLE, number="399"),
        ]
        result = build_result(leg(), trains)
        self.assertEqual([t.train_number for t in result.trains], ["301"])
        self.assertEqual([t.train_number for t in result.hits], ["301"])

    def test_results_are_sorted_by_departure(self):
        trains = [
            train("093000", general=AVAILABLE, number="330"),
            train("061000", general=AVAILABLE, number="301"),
        ]
        result = build_result(leg(), trains)
        self.assertEqual([t.train_number for t in result.hits], ["301", "330"])


class AvailabilityTest(unittest.TestCase):
    def test_sold_out_train_is_not_a_hit(self):
        result = build_result(leg(), [train("061000")])
        self.assertEqual(result.hits, [])
        self.assertEqual(result.trains[0].seat_label, "매진")

    def test_special_seat_only_counts(self):
        result = build_result(leg(), [train("061000", special=AVAILABLE)])
        self.assertEqual(len(result.hits), 1)
        self.assertEqual(result.hits[0].seat_label, "특실")

    def test_both_classes(self):
        result = build_result(
            leg(), [train("061000", general=AVAILABLE, special=AVAILABLE)]
        )
        self.assertEqual(result.hits[0].seat_label, "일반실/특실")

    def test_standby_ignored_unless_enabled(self):
        trains = [train("061000", standby=True)]
        self.assertEqual(build_result(leg(), trains).standby_hits, [])
        enabled = build_result(leg(), trains, notify_standby=True)
        self.assertEqual(len(enabled.standby_hits), 1)

    def test_seat_wins_over_standby(self):
        trains = [train("061000", general=AVAILABLE, standby=True)]
        result = build_result(leg(), trains, notify_standby=True)
        self.assertEqual(len(result.hits), 1)
        self.assertEqual(result.standby_hits, [])


class AlertKeyTest(unittest.TestCase):
    def test_key_is_stable_for_same_train(self):
        view = build_result(leg(), [train("061000", general=AVAILABLE)]).hits[0]
        self.assertEqual(alert_key(leg(), view, SEAT), alert_key(leg(), view, SEAT))

    def test_key_differs_per_train_and_leg(self):
        a = build_result(leg(), [train("061000", general=AVAILABLE, number="301")]).hits[0]
        b = build_result(leg(), [train("063000", general=AVAILABLE, number="303")]).hits[0]
        self.assertNotEqual(alert_key(leg(), a, SEAT), alert_key(leg(), b, SEAT))
        self.assertNotEqual(
            alert_key(leg(), a, SEAT), alert_key(leg(id="back"), a, SEAT)
        )


class StateTest(unittest.TestCase):
    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = State(f"{self.tmp.name}/state.json")

    def test_first_time_notifies_then_waits(self):
        self.assertTrue(self.state.should_notify("k", 120))
        self.state.mark_notified("k")
        self.assertFalse(self.state.should_notify("k", 120))

    def test_renotifies_after_window(self):
        self.state.mark_notified("k")
        past = (now_kst() - timedelta(minutes=200)).isoformat()
        self.state.alerts["k"]["last_notified"] = past
        self.assertTrue(self.state.should_notify("k", 120))

    def test_sold_out_again_resets_the_key(self):
        self.state.mark_notified("k")
        self.state.forget_missing(set())
        self.assertTrue(self.state.should_notify("k", 120))

    def test_save_only_writes_when_changed(self):
        self.state.mark_notified("k")
        self.assertTrue(self.state.save())
        self.assertFalse(self.state.save())


class ConfigFileTest(unittest.TestCase):
    """trips.json이 언제든 수정되므로 값이 아니라 형식을 검증한다."""

    def setUp(self):
        self.cfg = load_config()

    def test_loads_and_ids_are_unique(self):
        ids = [leg.id for leg in self.cfg.legs]
        self.assertTrue(ids, "감시할 구간이 없습니다")
        self.assertEqual(len(ids), len(set(ids)))

    def test_provider_is_known(self):
        self.assertIn(self.cfg.provider, ("korail", "srt", "fake"))

    def test_every_leg_is_usable(self):
        for leg in self.cfg.legs:
            with self.subTest(leg=leg.id):
                self.assertEqual(len(leg.date), 8)
                self.assertLessEqual(leg.time_from, leg.time_to)
                self.assertGreaterEqual(leg.adults, 1)
                self.assertNotEqual(leg.dep, leg.arr)

    def test_srt_station_names_are_valid_when_using_srt(self):
        if self.cfg.provider != "srt":
            self.skipTest("코레일 조회에서는 SRT 역 코드표를 쓰지 않습니다")
        try:
            from SRT.constants import STATION_CODE
        except ImportError:
            self.skipTest("SRTrain이 설치되어 있지 않습니다")
        for leg in self.cfg.legs:
            with self.subTest(leg=leg.id):
                self.assertIn(leg.dep, STATION_CODE)
                self.assertIn(leg.arr, STATION_CODE)


class KorailMappingTest(unittest.TestCase):
    """코레일 응답 한 건이 TrainView로 제대로 옮겨지는지."""

    def info(self, **kwargs):
        base = {
            "h_trn_clsf_nm": "KTX",
            "h_trn_no": "0301",
            "h_dpt_tm": "061000",
            "h_arv_tm": "084500",
            "h_dpt_rs_stn_nm": "수서",
            "h_arv_rs_stn_nm": "부산",
            "h_gen_rsv_cd": "13",
            "h_spe_rsv_cd": "13",
            "h_wait_rsv_flg": "0",
        }
        base.update(kwargs)
        from train_alert.korail_client import to_view

        return to_view(base)

    def test_sold_out(self):
        view = self.info()
        self.assertFalse(view.seat_available)
        self.assertEqual(view.general_state, "매진")
        self.assertEqual(view.seat_label, "매진")

    def test_general_seat_open(self):
        view = self.info(h_gen_rsv_cd="11")
        self.assertTrue(view.general_available)
        self.assertTrue(view.seat_available)
        self.assertEqual(view.seat_label, "일반실")

    def test_special_seat_open(self):
        view = self.info(h_spe_rsv_cd="11")
        self.assertTrue(view.special_available)
        self.assertEqual(view.seat_label, "특실")

    def test_no_special_class_train(self):
        view = self.info(h_spe_rsv_cd="00")
        self.assertEqual(view.special_state, "-")
        self.assertFalse(view.special_available)

    def test_waiting_list(self):
        self.assertTrue(self.info(h_wait_rsv_flg="9").standby_available)
        self.assertFalse(self.info(h_wait_rsv_flg="-2").standby_available)
        self.assertFalse(self.info(h_wait_rsv_flg="0").standby_available)

    def test_line_uses_train_name(self):
        view = self.info(h_gen_rsv_cd="11")
        self.assertEqual(view.line(), "06:10→08:45  KTX 0301  일반실")


class SrtMappingTest(unittest.TestCase):
    """레거시 SRT 응답 매핑."""

    def test_maps_srt_train(self):
        try:
            from train_alert.srt_client import to_view
        except ImportError:
            self.skipTest("SRTrain이 설치되어 있지 않습니다")

        class Stub:
            train_name = "SRT"
            train_number = "301"
            dep_time = "061000"
            arr_time = "084500"
            dep_station_name = "수서"
            arr_station_name = "부산"
            general_seat_state = "예약가능"
            special_seat_state = "매진"

            def general_seat_available(self):
                return True

            def special_seat_available(self):
                return False

            def reserve_standby_available(self):
                return False

        view = to_view(Stub())
        self.assertEqual(view.train_name, "SRT")
        self.assertTrue(view.seat_available)
        self.assertEqual(view.seat_label, "일반실")


if __name__ == "__main__":
    unittest.main()
