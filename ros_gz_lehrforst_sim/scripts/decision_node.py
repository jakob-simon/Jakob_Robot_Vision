#!/usr/bin/env python3

import csv
import json
import math
import os
import re
import time
from typing import Optional

import rclpy
from geometry_msgs.msg import Pose
from nav_msgs.msg import Odometry
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from tf2_msgs.msg import TFMessage


FORCE_FIELD_RE = re.compile(r"([A-Za-z0-9_]+)=([^,]+)")


class DecisionNode(Node):
    """Classify front obstacles with LiDAR plus paper-style force events."""

    def __init__(self):
        super().__init__("traversability_decision_node")

        self.label = self.declare_parameter("label", "decision").value
        self.log_dir = self.declare_parameter(
            "log_dir", "/workspace/logs/decision_benchmarks"
        ).value
        self.front_angle_deg = float(
            self.declare_parameter("front_angle_deg", 25.0).value
        )
        self.obstacle_distance_m = float(
            self.declare_parameter("obstacle_distance_m", 2.0).value
        )
        self.corridor_half_width_m = float(
            self.declare_parameter("corridor_half_width_m", 0.45).value
        )
        self.corridor_look_ahead_m = float(
            self.declare_parameter("corridor_look_ahead_m", 1.0).value
        )
        self.contact_obstacle_distance_m = float(
            self.declare_parameter("contact_obstacle_distance_m", 0.12).value
        )
        self.hard_force_threshold_n = float(
            self.declare_parameter("hard_force_threshold_n", 5000.0).value
        )
        self.blocked_progress_threshold_m = float(
            self.declare_parameter("blocked_progress_threshold_m", 0.15).value
        )
        legacy_test_duration_s = float(
            self.declare_parameter("blocked_progress_delay_s", 2.0).value
        )
        self.contact_test_duration_s = float(
            self.declare_parameter(
                "contact_test_duration_s", legacy_test_duration_s
            ).value
        )
        self.new_contact_progress_reset_m = float(
            self.declare_parameter("new_contact_progress_reset_m", 0.30).value
        )
        self.sample_period_s = float(
            self.declare_parameter("sample_period_s", 0.10).value
        )
        self.reset_backward_jump_m = float(
            self.declare_parameter("reset_backward_jump_m", 1.50).value
        )
        self.reset_time_backward_jump_s = float(
            self.declare_parameter("reset_time_backward_jump_s", 0.50).value
        )
        self.reset_fallback_pose_x_m = float(
            self.declare_parameter("reset_fallback_pose_x_m", 0.0).value
        )
        self.reset_fallback_pose_y_m = float(
            self.declare_parameter("reset_fallback_pose_y_m", 0.0).value
        )
        self.world_pose_transform_index = int(
            self.declare_parameter("world_pose_transform_index", 1).value
        )

        os.makedirs(self.log_dir, exist_ok=True)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        self.decision_path = os.path.join(
            self.log_dir, f"{self.label}_decisions_{timestamp}.csv"
        )
        self.decision_file = open(self.decision_path, "w", newline="")
        self.decision_writer = csv.writer(self.decision_file)
        self.decision_writer.writerow(
            [
                "wall_time_s",
                "label",
                "decision",
                "obstacle_ahead",
                "min_front_range_m",
                "corridor_min_forward_m",
                "corridor_hit_count",
                "force_event_seen",
                "force_event_t0_s",
                "force_event_segment",
                "force_event_p_n",
                "force_event_age_s",
                "contact_test_elapsed_s",
                "force_event_pose_delta_x",
                "pose_x",
                "pose_y",
                "pose_delta_x",
                "progress_after_contact_x",
                "force_event_current",
                "odom_time_s",
                "force_event_start_odom_time_s",
                "reset_count",
                "pose_source",
            ]
        )

        self.start_time = time.monotonic()
        self.latest_min_front_range: Optional[float] = None
        self.latest_corridor_min_forward: Optional[float] = None
        self.latest_corridor_hit_count = 0
        self.obstacle_ahead = False
        self.force_event_seen = False
        self.force_event_t0_s: Optional[float] = None
        self.force_event_segment: Optional[int] = None
        self.force_event_p_n: Optional[float] = None
        self.contact_source: Optional[str] = None
        self.force_event_pose_delta_x: Optional[float] = None
        self.force_event_received_time_s: Optional[float] = None
        self.force_event_start_odom_time_s: Optional[float] = None
        self.odom_time_s: Optional[float] = None
        self.last_odom_time_s: Optional[float] = None
        self.odom_x = 0.0
        self.odom_y = 0.0
        self.odom_reset_start_x: Optional[float] = None
        self.odom_reset_start_y: Optional[float] = None
        self.odom_pose_fallback_active = False
        self.world_pose_active = False
        self.pose_x = 0.0
        self.pose_y = 0.0
        self.pose_start_x: Optional[float] = None
        self.pose_start_y: Optional[float] = None
        self.last_pose_x: Optional[float] = None
        self.last_decision = "UNKNOWN"
        self.reset_count = 0
        self.closed = False

        self.publisher = self.create_publisher(String, "/traversability/decision", 10)
        self.create_subscription(LaserScan, "/scan", self.scan_callback, 10)
        self.create_subscription(String, "/force_bar/events", self.event_callback, 10)
        self.create_subscription(Odometry, "/odom", self.odom_callback, 10)
        self.create_subscription(Pose, "/pose", self.pose_callback, 10)
        self.create_subscription(TFMessage, "/world_pose", self.world_pose_callback, 10)
        self.timer = self.create_timer(self.sample_period_s, self.timer_callback)

        self.get_logger().info(
            "Decision node started: "
            f"label={self.label}, front_angle=+/-{self.front_angle_deg:.1f} deg, "
            f"obstacle_distance={self.obstacle_distance_m:.2f} m, "
            f"corridor_half_width={self.corridor_half_width_m:.2f} m, "
            f"corridor_look_ahead={self.corridor_look_ahead_m:.2f} m, "
            f"contact_obstacle_distance={self.contact_obstacle_distance_m:.2f} m, "
            f"hard_force_threshold={self.hard_force_threshold_n:.1f} N, "
            f"blocked_progress_threshold={self.blocked_progress_threshold_m:.2f} m, "
            f"contact_test_duration={self.contact_test_duration_s:.2f} s, "
            f"reset_time_backward_jump={self.reset_time_backward_jump_s:.2f} s"
        )
        self.get_logger().info(f"Decision log: {self.decision_path}")

    def now_s(self) -> float:
        return time.monotonic() - self.start_time

    def scan_callback(self, msg: LaserScan):
        front_angle_rad = math.radians(self.front_angle_deg)
        min_front = None
        corridor_min_forward = None
        corridor_hit_count = 0

        for index, value in enumerate(msg.ranges):
            if not math.isfinite(value):
                continue
            if value < msg.range_min or value > msg.range_max:
                continue

            angle = msg.angle_min + index * msg.angle_increment
            if abs(angle) > front_angle_rad:
                forward = value * math.cos(angle)
                lateral = value * math.sin(angle)
                if (
                    0.0 < forward <= self.corridor_look_ahead_m
                    and abs(lateral) <= self.corridor_half_width_m
                ):
                    corridor_hit_count += 1
                    if (
                        corridor_min_forward is None
                        or forward < corridor_min_forward
                    ):
                        corridor_min_forward = forward
                continue

            if min_front is None or value < min_front:
                min_front = value

            forward = value * math.cos(angle)
            lateral = value * math.sin(angle)
            if (
                0.0 < forward <= self.corridor_look_ahead_m
                and abs(lateral) <= self.corridor_half_width_m
            ):
                corridor_hit_count += 1
                if corridor_min_forward is None or forward < corridor_min_forward:
                    corridor_min_forward = forward

        self.latest_min_front_range = min_front
        self.latest_corridor_min_forward = corridor_min_forward
        self.latest_corridor_hit_count = corridor_hit_count
        self.obstacle_ahead = corridor_hit_count > 0

    def event_callback(self, msg: String):
        if self.force_event_seen and (
            self.progress_after_contact_x() < self.new_contact_progress_reset_m
        ):
            return

        fields = {
            key: value.strip()
            for key, value in FORCE_FIELD_RE.findall(msg.data)
        }
        try:
            force_proxy = float(fields["p"])
        except (KeyError, ValueError):
            self.get_logger().warning(f"Ignoring malformed force event: {msg.data}")
            return

        self.force_event_seen = True
        self.force_event_p_n = force_proxy
        self.contact_source = "force"
        self.force_event_t0_s = self.parse_float(fields.get("t0"))
        self.force_event_segment = self.parse_int(fields.get("k"))
        self.force_event_pose_delta_x = self.parse_float(fields.get("pose_delta_x"))
        self.force_event_received_time_s = self.now_s()
        self.force_event_start_odom_time_s = self.odom_time_s
        self.get_logger().info(
            "Accepted force event: "
            f"k={self.force_event_segment}, p={self.force_event_p_n:.1f} N, "
            f"pose_delta_x={self.force_event_pose_delta_x}"
        )

    def odom_callback(self, msg: Odometry):
        odom_time_s = self.stamp_to_s(msg.header.stamp)
        self.odom_x = msg.pose.pose.position.x
        self.odom_y = msg.pose.pose.position.y
        if (
            self.last_odom_time_s is not None
            and odom_time_s
            < self.last_odom_time_s - self.reset_time_backward_jump_s
        ):
            self.handle_sim_reset(
                reason=(
                    "odom time jump "
                    f"{self.last_odom_time_s:.3f}->{odom_time_s:.3f}"
                ),
                odom_time_s=odom_time_s,
                use_odom_pose_fallback=True,
            )

        self.odom_time_s = odom_time_s
        self.last_odom_time_s = odom_time_s
        if self.odom_pose_fallback_active:
            self.update_pose_from_odom()
        if self.force_event_seen and self.force_event_start_odom_time_s is None:
            self.force_event_start_odom_time_s = odom_time_s

    def pose_callback(self, msg: Pose):
        if self.world_pose_active:
            return
        self.apply_pose_sample(msg, "pose")

    def world_pose_callback(self, msg: TFMessage):
        selected = None
        for transform in msg.transforms:
            if transform.child_frame_id == "scout":
                selected = transform
                break
        if selected is None and 0 <= self.world_pose_transform_index < len(msg.transforms):
            selected = msg.transforms[self.world_pose_transform_index]
        if selected is None:
            return

        pose = Pose()
        pose.position.x = selected.transform.translation.x
        pose.position.y = selected.transform.translation.y
        pose.position.z = selected.transform.translation.z
        pose.orientation = selected.transform.rotation
        self.world_pose_active = True
        self.apply_pose_sample(pose, "world_pose")

    def apply_pose_sample(self, msg: Pose, source: str):
        if (
            self.last_pose_x is not None
            and msg.position.x < self.last_pose_x - self.reset_backward_jump_m
        ):
            self.handle_sim_reset(
                msg=msg,
                reason=(
                    f"{source} jump "
                    f"{self.last_pose_x:.3f}->{msg.position.x:.3f}"
                ),
                use_odom_pose_fallback=False,
            )

        if self.odom_pose_fallback_active and source != "world_pose":
            self.last_pose_x = msg.position.x
            return

        self.odom_pose_fallback_active = False
        self.odom_reset_start_x = None
        self.odom_reset_start_y = None
        self.pose_x = msg.position.x
        self.pose_y = msg.position.y
        if self.pose_start_x is None:
            self.pose_start_x = self.pose_x
            self.pose_start_y = self.pose_y
        self.last_pose_x = self.pose_x

    def handle_sim_reset(
        self,
        msg: Optional[Pose] = None,
        reason: str = "unknown",
        odom_time_s: Optional[float] = None,
        use_odom_pose_fallback: bool = False,
    ):
        if msg is not None:
            self.pose_x = msg.position.x
            self.pose_y = msg.position.y
            self.odom_pose_fallback_active = False
            self.odom_reset_start_x = None
            self.odom_reset_start_y = None
        elif use_odom_pose_fallback:
            self.odom_pose_fallback_active = True
            self.odom_reset_start_x = self.odom_x
            self.odom_reset_start_y = self.odom_y
            self.update_pose_from_odom()
        last_pose_text = "None" if self.last_pose_x is None else f"{self.last_pose_x:.3f}"
        odom_text = "None" if odom_time_s is None else f"{odom_time_s:.3f}"
        self.get_logger().warning(
            "Simulation reset detected: "
            f"reason={reason}, last_pose_x={last_pose_text}, "
            f"current_pose_x={self.pose_x:.3f}, odom_time_s={odom_text}"
        )
        self.latest_min_front_range = None
        self.latest_corridor_min_forward = None
        self.latest_corridor_hit_count = 0
        self.obstacle_ahead = False
        self.force_event_seen = False
        self.force_event_t0_s = None
        self.force_event_segment = None
        self.force_event_p_n = None
        self.contact_source = None
        self.force_event_pose_delta_x = None
        self.force_event_received_time_s = None
        self.force_event_start_odom_time_s = None
        self.odom_time_s = odom_time_s
        self.last_odom_time_s = odom_time_s
        self.pose_start_x = self.pose_x
        self.pose_start_y = self.pose_y
        self.last_pose_x = self.pose_x
        self.last_decision = "UNKNOWN"
        self.reset_count += 1

    def update_pose_from_odom(self):
        if self.odom_reset_start_x is None or self.odom_reset_start_y is None:
            return
        self.pose_x = self.reset_fallback_pose_x_m + (
            self.odom_x - self.odom_reset_start_x
        )
        self.pose_y = self.reset_fallback_pose_y_m + (
            self.odom_y - self.odom_reset_start_y
        )

    def pose_source_name(self) -> str:
        if self.odom_pose_fallback_active:
            return "odom_reset_fallback"
        if self.world_pose_active:
            return "world_pose"
        return "pose"

    @staticmethod
    def parse_float(value: Optional[str]) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except ValueError:
            return None

    @staticmethod
    def parse_int(value: Optional[str]) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            return None

    @staticmethod
    def stamp_to_s(stamp) -> float:
        return float(stamp.sec) + float(stamp.nanosec) * 1e-9

    def pose_delta_x(self) -> float:
        if self.pose_start_x is None:
            return 0.0
        return self.pose_x - self.pose_start_x

    def progress_after_contact_x(self) -> float:
        if self.force_event_pose_delta_x is None:
            return 0.0
        return max(0.0, self.pose_delta_x() - self.force_event_pose_delta_x)

    def force_event_age_s(self) -> Optional[float]:
        sim_elapsed = self.contact_test_elapsed_s()
        if sim_elapsed is not None:
            return sim_elapsed
        if self.force_event_received_time_s is None:
            return None
        return max(0.0, self.now_s() - self.force_event_received_time_s)

    def contact_test_elapsed_s(self) -> Optional[float]:
        if self.force_event_start_odom_time_s is None or self.odom_time_s is None:
            return None
        return max(0.0, self.odom_time_s - self.force_event_start_odom_time_s)

    def force_event_current(self) -> bool:
        if not self.force_event_seen:
            return False
        elapsed = self.contact_test_elapsed_s()
        if elapsed is not None and elapsed <= self.contact_test_duration_s:
            return True
        return self.progress_after_contact_x() <= self.new_contact_progress_reset_m

    def near_contact_obstacle(self) -> bool:
        corridor_near = (
            self.latest_corridor_min_forward is not None
            and self.latest_corridor_min_forward <= self.contact_obstacle_distance_m
        )
        legacy_front_near = (
            self.latest_min_front_range is not None
            and self.latest_min_front_range <= self.contact_obstacle_distance_m
        )
        return corridor_near or legacy_front_near

    def start_lidar_contact_test(self):
        self.force_event_seen = True
        self.contact_source = "lidar_near"
        self.force_event_p_n = 0.0
        self.force_event_t0_s = None
        self.force_event_segment = None
        self.force_event_pose_delta_x = self.pose_delta_x()
        self.force_event_received_time_s = self.now_s()
        self.force_event_start_odom_time_s = self.odom_time_s
        min_front_text = (
            "None"
            if self.latest_min_front_range is None
            else f"{self.latest_min_front_range:.3f} m"
        )
        corridor_text = (
            "None"
            if self.latest_corridor_min_forward is None
            else f"{self.latest_corridor_min_forward:.3f} m"
        )
        self.get_logger().info(
            "Started near-obstacle contact test: "
            f"min_front={min_front_text}, "
            f"corridor_forward={corridor_text}, "
            f"pose_delta_x={self.force_event_pose_delta_x:.4f}"
        )

    def classify(self) -> str:
        # LiDAR only gates speed. Force plus real pose progress separates
        # yielding vegetation from a hard blocker.

        if (
            self.near_contact_obstacle()
            and (not self.force_event_seen or not self.force_event_current())
        ):
            self.start_lidar_contact_test()

        if self.force_event_seen and self.force_event_p_n is not None:
            # A stale event means the robot has driven well past the last
            # contact; fall back to LiDAR-only speed gating.
            if not self.force_event_current():
                if self.obstacle_ahead:
                    return "OBSTACLE_AHEAD"
                return "CLEAR"

            test_elapsed = self.contact_test_elapsed_s()
            progress_after_contact = self.progress_after_contact_x()

            # Very high force is a fast hard path. It is not the only
            # discriminator because tree force can be low when the trunk is
            # grazed; the robust path below is progress based.
            if self.force_event_p_n >= self.hard_force_threshold_n:
                return "HARD_BLOCKED"

            if progress_after_contact >= self.blocked_progress_threshold_m:
                return "SOFT_TRAVERSABLE"

            # During the test window keep pushing slowly. If the pose has not
            # advanced enough after the sim-time window, the obstacle is hard.
            if test_elapsed is not None and test_elapsed >= self.contact_test_duration_s:
                return "HARD_BLOCKED"

            return "SOFT_TRAVERSABLE"

        # No contact yet: the LiDAR only decides whether to slow down.
        if self.obstacle_ahead:
            return "OBSTACLE_AHEAD"

        return "CLEAR"

    def timer_callback(self):
        decision = self.classify()
        self.last_decision = decision
        pose_delta_x = self.pose_delta_x()
        progress_after_contact_x = self.progress_after_contact_x()
        force_event_age_s = self.force_event_age_s()
        contact_test_elapsed_s = self.contact_test_elapsed_s()
        min_front = self.latest_min_front_range
        corridor_min_forward = self.latest_corridor_min_forward
        force_event_current = self.force_event_current()

        payload = {
            "time_s": round(self.now_s(), 3),
            "label": self.label,
            "decision": decision,
            "obstacle_ahead": self.obstacle_ahead,
            "min_front_range_m": None if min_front is None else round(min_front, 3),
            "corridor_min_forward_m": None
            if corridor_min_forward is None
            else round(corridor_min_forward, 3),
            "corridor_hit_count": self.latest_corridor_hit_count,
            "force_event_seen": self.force_event_seen,
            "force_event_t0_s": self.force_event_t0_s,
            "force_event_age_s": force_event_age_s,
            "contact_test_elapsed_s": contact_test_elapsed_s,
            "contact_source": self.contact_source,
            "force_event_segment": self.force_event_segment,
            "force_event_p_n": self.force_event_p_n,
            "pose_delta_x": round(pose_delta_x, 4),
            "progress_after_contact_x": round(progress_after_contact_x, 4),
            "force_event_current": force_event_current,
            "blocked_progress_threshold_m": self.blocked_progress_threshold_m,
            "hard_force_threshold_n": self.hard_force_threshold_n,
            "odom_time_s": self.odom_time_s,
            "force_event_start_odom_time_s": self.force_event_start_odom_time_s,
            "reset_count": self.reset_count,
            "pose_source": self.pose_source_name(),
        }

        msg = String()
        msg.data = json.dumps(payload, sort_keys=True)
        self.publisher.publish(msg)

        self.decision_writer.writerow(
            [
                f"{self.now_s():.3f}",
                self.label,
                decision,
                int(self.obstacle_ahead),
                "" if min_front is None else f"{min_front:.3f}",
                ""
                if corridor_min_forward is None
                else f"{corridor_min_forward:.3f}",
                self.latest_corridor_hit_count,
                int(self.force_event_seen),
                "" if self.force_event_t0_s is None else f"{self.force_event_t0_s:.3f}",
                "" if self.force_event_segment is None else self.force_event_segment,
                "" if self.force_event_p_n is None else f"{self.force_event_p_n:.3f}",
                "" if force_event_age_s is None else f"{force_event_age_s:.3f}",
                ""
                if contact_test_elapsed_s is None
                else f"{contact_test_elapsed_s:.3f}",
                ""
                if self.force_event_pose_delta_x is None
                else f"{self.force_event_pose_delta_x:.4f}",
                f"{self.pose_x:.4f}",
                f"{self.pose_y:.4f}",
                f"{pose_delta_x:.4f}",
                f"{progress_after_contact_x:.4f}",
                int(force_event_current),
                "" if self.odom_time_s is None else f"{self.odom_time_s:.3f}",
                ""
                if self.force_event_start_odom_time_s is None
                else f"{self.force_event_start_odom_time_s:.3f}",
                self.reset_count,
                self.pose_source_name(),
            ]
        )
        self.decision_file.flush()

    def close(self):
        if self.closed:
            return
        self.decision_file.close()
        self.closed = True


def main(args=None):
    rclpy.init(args=args)
    node = DecisionNode()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    except Exception as exc:
        message = str(exc)
        context_shutdown = (
            "context is not valid" in message or "rcl_shutdown" in message
        )
        if not context_shutdown:
            raise
    finally:
        node.close()
        try:
            node.destroy_node()
        except Exception:
            pass
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
