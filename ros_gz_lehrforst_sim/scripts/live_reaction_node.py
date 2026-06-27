#!/usr/bin/env python3

import csv
import json
import math
import os
import time
from typing import Any, Dict, Optional

import rclpy
from geometry_msgs.msg import Pose
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from std_msgs.msg import String
from tf2_msgs.msg import TFMessage


class LiveReactionNode(Node):
    """Drive straight and react live to traversability decisions."""

    def __init__(self):
        super().__init__("traversability_live_reaction_node")

        self.label = self.declare_parameter("label", "live").value
        self.log_dir = self.declare_parameter(
            "log_dir", "/workspace/logs/live_reaction_benchmarks"
        ).value
        self.clear_speed = float(self.declare_parameter("clear_speed", 1.30).value)
        self.obstacle_speed = float(
            self.declare_parameter("obstacle_speed", 0.45).value
        )
        self.soft_speed = float(self.declare_parameter("soft_speed", 0.45).value)
        self.hard_speed = float(self.declare_parameter("hard_speed", 0.0).value)
        self.soft_contact_hold_s = float(
            self.declare_parameter("soft_contact_hold_s", 1.5).value
        )
        self.decision_timeout_s = float(
            self.declare_parameter("decision_timeout_s", 2.0).value
        )
        self.command_period_s = float(
            self.declare_parameter("command_period_s", 0.10).value
        )
        self.lane_keep_enabled = bool(
            self.declare_parameter("lane_keep_enabled", False).value
        )
        self.lane_keep_target_y = float(
            self.declare_parameter("lane_keep_target_y", 0.0).value
        )
        self.lane_keep_lateral_gain = float(
            self.declare_parameter("lane_keep_lateral_gain", 1.5).value
        )
        self.lane_keep_yaw_gain = float(
            self.declare_parameter("lane_keep_yaw_gain", 2.0).value
        )
        self.lane_keep_max_angular = float(
            self.declare_parameter("lane_keep_max_angular", 2.5).value
        )
        self.tree_avoidance_enabled = bool(
            self.declare_parameter("tree_avoidance_enabled", False).value
        )
        self.avoid_lane_y = float(self.declare_parameter("avoid_lane_y", 4.5).value)
        self.avoid_reverse_speed = float(
            self.declare_parameter("avoid_reverse_speed", -0.40).value
        )
        self.avoid_reverse_distance_m = float(
            self.declare_parameter("avoid_reverse_distance_m", 1.20).value
        )
        self.avoid_reverse_s = float(
            self.declare_parameter("avoid_reverse_s", 6.0).value
        )
        self.avoid_turn_speed = float(
            self.declare_parameter("avoid_turn_speed", 0.50).value
        )
        self.avoid_turn_angular = float(
            self.declare_parameter("avoid_turn_angular", 1.20).value
        )
        self.avoid_turn_angle_rad = float(
            self.declare_parameter("avoid_turn_angle_rad", 0.90).value
        )
        self.avoid_turn_min_yaw_rad = float(
            self.declare_parameter("avoid_turn_min_yaw_rad", 0.75).value
        )
        self.avoid_turn_max_s = float(
            self.declare_parameter("avoid_turn_max_s", 8.0).value
        )
        self.avoid_forward_speed = float(
            self.declare_parameter("avoid_forward_speed", 1.00).value
        )
        # Net forward progress past the tree (relative to the avoidance start)
        # before the robot is allowed to steer back onto the original lane.
        # Guards against turning back into the tree too early.
        self.avoid_forward_clear_m = float(
            self.declare_parameter("avoid_forward_clear_m", 1.80).value
        )
        self.avoid_return_speed = float(
            self.declare_parameter("avoid_return_speed", 0.75).value
        )
        self.avoid_return_lateral_gain = float(
            self.declare_parameter("avoid_return_lateral_gain", 0.20).value
        )
        self.avoid_return_yaw_gain = float(
            self.declare_parameter("avoid_return_yaw_gain", 0.80).value
        )
        self.avoid_return_max_angular = float(
            self.declare_parameter("avoid_return_max_angular", 0.40).value
        )
        self.avoid_return_heading_limit_rad = float(
            self.declare_parameter("avoid_return_heading_limit_rad", 0.45).value
        )
        self.avoid_return_y_tolerance_m = float(
            self.declare_parameter("avoid_return_y_tolerance_m", 0.30).value
        )
        self.avoid_return_yaw_tolerance_rad = float(
            self.declare_parameter("avoid_return_yaw_tolerance_rad", 0.25).value
        )
        self.avoid_return_max_s = float(
            self.declare_parameter("avoid_return_max_s", 18.0).value
        )
        # Final showcase after the tree is cleared: drive the now-clear original
        # lane fast, then brake to a stop. The distance is "the same length" as
        # the approach to the tree when <= 0 (default), or a fixed value if > 0.
        # Capped for safety so the robot does not wander far past the demo tree.
        self.avoid_finish_distance_m = float(
            self.declare_parameter("avoid_finish_distance_m", 0.0).value
        )
        self.avoid_finish_cap_m = float(
            self.declare_parameter("avoid_finish_cap_m", 12.0).value
        )
        self.finish_stop_enabled = bool(
            self.declare_parameter("finish_stop_enabled", False).value
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
            self.declare_parameter(
                "reset_fallback_pose_y_m", self.lane_keep_target_y
            ).value
        )
        self.world_pose_transform_index = int(
            self.declare_parameter("world_pose_transform_index", 1).value
        )

        os.makedirs(self.log_dir, exist_ok=True)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        self.log_path = os.path.join(
            self.log_dir, f"{self.label}_live_reaction_{timestamp}.csv"
        )
        self.log_file = open(self.log_path, "w", newline="")
        self.log_writer = csv.writer(self.log_file)
        self.log_writer.writerow(
            [
                "wall_time_s",
                "label",
                "mode",
                "decision",
                "decision_age_s",
                "cmd_linear_x",
                "cmd_angular_z",
                "stopped",
                "stop_reason",
                "pose_x",
                "pose_y",
                "pose_yaw",
                "pose_delta_x",
                "lane_target_y",
                "decision_min_front_range_m",
                "decision_force_event_p_n",
                "decision_progress_after_contact_x",
                "decision_force_event_current",
                "odom_time_s",
                "reset_count",
                "pose_source",
            ]
        )

        self.start_time = time.monotonic()
        self.latest_decision: Dict[str, Any] = {}
        self.latest_decision_name = "NO_DECISION"
        self.last_decision_time_s: Optional[float] = None
        self.hard_stop_latched = False
        self.mode = "drive_line"
        self.avoid_start_time_s: Optional[float] = None
        self.avoid_start_pose_delta_x: Optional[float] = None
        self.avoid_phase_start_time_s: Optional[float] = None
        self.avoid_phase_start_pose_delta_x: Optional[float] = None
        self.avoid_phase_start_pose_x: Optional[float] = None
        self.avoid_phase_start_pose_y: Optional[float] = None
        self.avoid_phase_start_yaw: Optional[float] = None
        self.avoid_complete = False
        self.finish_ref_pose_delta_x: Optional[float] = None
        self.finish_distance_target: Optional[float] = None
        self.finish_stop_latched = False
        self.pose_x = 0.0
        self.pose_y = 0.0
        self.pose_yaw = 0.0
        self.pose_start_x: Optional[float] = None
        self.pose_start_y: Optional[float] = None
        self.last_pose_x: Optional[float] = None
        self.odom_time_s: Optional[float] = None
        self.last_odom_time_s: Optional[float] = None
        self.odom_x = 0.0
        self.odom_y = 0.0
        self.odom_yaw = 0.0
        self.odom_reset_start_x: Optional[float] = None
        self.odom_reset_start_y: Optional[float] = None
        self.odom_pose_fallback_active = False
        self.world_pose_active = False
        self.reset_count = 0
        self.closed = False

        self.cmd_publisher = self.create_publisher(Twist, "/cmd_vel", 10)
        self.status_publisher = self.create_publisher(
            String, "/traversability/live_status", 10
        )
        self.create_subscription(
            String, "/traversability/decision", self.decision_callback, 10
        )
        self.create_subscription(Pose, "/pose", self.pose_callback, 10)
        self.create_subscription(Odometry, "/odom", self.odom_callback, 10)
        self.create_subscription(TFMessage, "/world_pose", self.world_pose_callback, 10)
        self.timer = self.create_timer(self.command_period_s, self.timer_callback)

        self.get_logger().info(
            "Live reaction node started: "
            f"label={self.label}, clear={self.clear_speed:.2f} m/s, "
            f"obstacle={self.obstacle_speed:.2f} m/s, "
            f"soft={self.soft_speed:.2f} m/s, timeout={self.decision_timeout_s:.1f} s, "
            f"lane_keep={self.lane_keep_enabled}, target_y={self.lane_keep_target_y:.3f}, "
            f"tree_avoidance={self.tree_avoidance_enabled}, avoid_lane_y={self.avoid_lane_y:.3f}, "
            f"return_speed={self.avoid_return_speed:.2f} m/s, "
            f"return_max_angular={self.avoid_return_max_angular:.2f} rad/s, "
            f"reset_time_backward_jump={self.reset_time_backward_jump_s:.2f} s, "
            f"reset_fallback_pose=({self.reset_fallback_pose_x_m:.2f}, "
            f"{self.reset_fallback_pose_y_m:.2f})"
        )
        self.get_logger().info(f"Live reaction log: {self.log_path}")

    def now_s(self) -> float:
        return time.monotonic() - self.start_time

    def decision_callback(self, msg: String):
        try:
            decision = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warning(f"Ignoring malformed decision JSON: {msg.data}")
            return

        decision_name = decision.get("decision")
        if not isinstance(decision_name, str):
            self.get_logger().warning(f"Ignoring decision without state: {msg.data}")
            return

        self.latest_decision = decision
        self.latest_decision_name = decision_name
        self.last_decision_time_s = self.now_s()
        if decision_name == "HARD_BLOCKED":
            if self.tree_avoidance_enabled and not self.avoid_complete:
                if not self.mode.startswith("avoid_tree"):
                    self.start_tree_avoidance()
                    self.get_logger().info(
                        "Tree avoidance started: "
                        f"pose_delta_x={self.avoid_start_pose_delta_x:.3f}, "
                        f"pose_y={self.pose_y:.3f}, target_y={self.avoid_lane_y:.3f}"
                    )
            else:
                self.hard_stop_latched = True

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
        self.pose_yaw = self.yaw_from_pose(msg)
        if self.pose_start_x is None:
            self.pose_start_x = self.pose_x
            self.pose_start_y = self.pose_y
        self.last_pose_x = self.pose_x

    def odom_callback(self, msg: Odometry):
        odom_time_s = self.stamp_to_s(msg.header.stamp)
        self.odom_x = msg.pose.pose.position.x
        self.odom_y = msg.pose.pose.position.y
        self.odom_yaw = self.yaw_from_orientation(msg.pose.pose.orientation)
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

    def handle_sim_reset(
        self,
        msg: Optional[Pose] = None,
        reason: str = "unknown",
        odom_time_s: Optional[float] = None,
        use_odom_pose_fallback: bool = False,
    ):
        if msg is not None:
            yaw = self.yaw_from_pose(msg)
            self.pose_x = msg.position.x
            self.pose_y = msg.position.y
            self.pose_yaw = yaw
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
            f"current_pose_x={self.pose_x:.3f}, odom_time_s={odom_text}; "
            "clearing live-reaction latches"
        )
        self.latest_decision = {}
        self.latest_decision_name = "NO_DECISION"
        self.last_decision_time_s = None
        self.hard_stop_latched = False
        self.mode = "drive_line"
        self.avoid_start_time_s = None
        self.avoid_start_pose_delta_x = None
        self.clear_avoidance_latches()
        self.odom_time_s = odom_time_s
        self.last_odom_time_s = odom_time_s
        self.pose_start_x = self.pose_x
        self.pose_start_y = self.pose_y
        self.last_pose_x = self.pose_x
        self.reset_count += 1
        self.publish_stop_command()

    @staticmethod
    def yaw_from_pose(msg: Pose) -> float:
        return LiveReactionNode.yaw_from_orientation(msg.orientation)

    @staticmethod
    def yaw_from_orientation(q) -> float:
        siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
        cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        return math.atan2(siny_cosp, cosy_cosp)

    @staticmethod
    def stamp_to_s(stamp) -> float:
        return float(stamp.sec) + float(stamp.nanosec) * 1e-9

    def publish_stop_command(self):
        cmd = Twist()
        self.cmd_publisher.publish(cmd)

    def update_pose_from_odom(self):
        if self.odom_reset_start_x is None or self.odom_reset_start_y is None:
            return
        self.pose_x = self.reset_fallback_pose_x_m + (
            self.odom_x - self.odom_reset_start_x
        )
        self.pose_y = self.reset_fallback_pose_y_m + (
            self.odom_y - self.odom_reset_start_y
        )
        self.pose_yaw = self.odom_yaw

    def pose_source_name(self) -> str:
        if self.odom_pose_fallback_active:
            return "odom_reset_fallback"
        if self.world_pose_active:
            return "world_pose"
        return "pose"

    def pose_delta_x(self) -> float:
        if self.pose_start_x is None:
            return 0.0
        return self.pose_x - self.pose_start_x

    def decision_age_s(self) -> Optional[float]:
        if self.last_decision_time_s is None:
            return None
        return max(0.0, self.now_s() - self.last_decision_time_s)

    @staticmethod
    def angle_diff(a: float, b: float) -> float:
        return math.atan2(math.sin(a - b), math.cos(a - b))

    def set_avoid_mode(self, mode: str):
        self.mode = mode
        self.avoid_phase_start_time_s = self.now_s()
        self.avoid_phase_start_pose_delta_x = self.pose_delta_x()
        self.avoid_phase_start_pose_x = self.pose_x
        self.avoid_phase_start_pose_y = self.pose_y
        self.avoid_phase_start_yaw = self.pose_yaw

    def start_tree_avoidance(self):
        self.hard_stop_latched = False
        self.finish_stop_latched = False
        self.finish_ref_pose_delta_x = None
        self.finish_distance_target = None
        self.avoid_complete = False
        self.avoid_start_time_s = self.now_s()
        self.avoid_start_pose_delta_x = self.pose_delta_x()
        self.set_avoid_mode("avoid_tree_reverse")

    def clear_avoidance_latches(self):
        self.avoid_complete = False
        self.hard_stop_latched = False
        self.finish_stop_latched = False
        self.finish_ref_pose_delta_x = None
        self.finish_distance_target = None
        self.avoid_start_time_s = None
        self.avoid_start_pose_delta_x = None
        self.avoid_phase_start_time_s = None
        self.avoid_phase_start_pose_delta_x = None
        self.avoid_phase_start_pose_x = None
        self.avoid_phase_start_pose_y = None
        self.avoid_phase_start_yaw = None

    def finish_tree_avoidance(self):
        self.mode = "drive_line"
        if self.finish_stop_enabled:
            self.avoid_complete = True
            self.finish_ref_pose_delta_x = self.pose_delta_x()
            base = (
                self.avoid_finish_distance_m
                if self.avoid_finish_distance_m > 0.0
                else (self.avoid_start_pose_delta_x or 0.0)
            )
            self.finish_distance_target = min(base, self.avoid_finish_cap_m)
        else:
            self.clear_avoidance_latches()

    def active_lane_target_y(self) -> float:
        # While passing the tree, aim at the offset lane. The return phase and
        # normal drive mode aim at the original lane.
        if self.mode == "avoid_tree_forward":
            return self.avoid_lane_y
        return self.lane_keep_target_y

    def avoid_elapsed_s(self) -> float:
        if self.avoid_start_time_s is None:
            return 0.0
        return max(0.0, self.now_s() - self.avoid_start_time_s)

    def avoid_distance_x(self) -> float:
        if self.avoid_start_pose_delta_x is None:
            return 0.0
        return max(0.0, self.pose_delta_x() - self.avoid_start_pose_delta_x)

    def avoid_phase_elapsed_s(self) -> float:
        if self.avoid_phase_start_time_s is None:
            return 0.0
        return max(0.0, self.now_s() - self.avoid_phase_start_time_s)

    def avoid_phase_distance_x(self) -> float:
        if self.avoid_phase_start_pose_delta_x is None:
            return 0.0
        return max(0.0, self.pose_delta_x() - self.avoid_phase_start_pose_delta_x)

    def avoid_phase_distance_m(self) -> float:
        if self.avoid_phase_start_pose_x is None or self.avoid_phase_start_pose_y is None:
            return 0.0
        return math.hypot(
            self.pose_x - self.avoid_phase_start_pose_x,
            self.pose_y - self.avoid_phase_start_pose_y,
        )

    def avoid_turn_delta_rad(self) -> float:
        if self.avoid_phase_start_yaw is None:
            return 0.0
        return abs(self.angle_diff(self.pose_yaw, self.avoid_phase_start_yaw))

    def soft_contact_active(self) -> bool:
        if self.latest_decision_name != "SOFT_TRAVERSABLE":
            return False

        if bool(self.latest_decision.get("force_event_current", False)):
            return True

        event_age = self.latest_decision.get("force_event_age_s")
        if isinstance(event_age, (float, int)):
            return float(event_age) <= self.soft_contact_hold_s

        return False

    def obstacle_ahead(self) -> bool:
        if bool(self.latest_decision.get("obstacle_ahead", False)):
            return True
        return self.latest_decision_name == "OBSTACLE_AHEAD"

    def update_avoidance_mode(self):
        if self.mode == "avoid_tree_reverse":
            reverse_done = (
                self.avoid_phase_distance_m() >= self.avoid_reverse_distance_m
            )
            reverse_timed_out = self.avoid_phase_elapsed_s() >= self.avoid_reverse_s
            if reverse_done or reverse_timed_out:
                reverse_distance = self.avoid_phase_distance_m()
                reverse_elapsed = self.avoid_phase_elapsed_s()
                self.set_avoid_mode("avoid_tree_turn")
                self.get_logger().info(
                    "Tree avoidance turn phase: "
                    f"pose_delta_x={self.pose_delta_x():.3f}, pose_y={self.pose_y:.3f}, "
                    f"reverse_distance={reverse_distance:.3f}, "
                    f"reverse_elapsed={reverse_elapsed:.2f}s"
                )

        if self.mode == "avoid_tree_turn":
            # Turn left until the relative change is large enough and the
            # absolute heading points left of the drive line. The absolute guard
            # matters after a return phase that was interrupted while the robot
            # still pointed slightly right.
            turn_reached = (
                self.avoid_turn_delta_rad() >= self.avoid_turn_angle_rad
                and self.pose_yaw >= self.avoid_turn_min_yaw_rad
            )
            timed_out = self.avoid_phase_elapsed_s() >= self.avoid_turn_max_s
            if turn_reached or timed_out:
                turn_delta = self.avoid_turn_delta_rad()
                phase_elapsed = self.avoid_phase_elapsed_s()
                self.set_avoid_mode("avoid_tree_forward")
                self.get_logger().info(
                    "Tree avoidance forward phase: "
                    f"pose_y={self.pose_y:.3f}, "
                    f"turn_delta={turn_delta:.3f}, "
                    f"turn_elapsed={phase_elapsed:.2f}s"
                )

        if self.mode == "avoid_tree_forward":
            # Drive forward on the offset lane until we are safely past the tree
            # (net forward progress since avoidance start), then enter a
            # limited return phase. Handing directly to the normal lane
            # controller can saturate into a sharp right swing.
            if self.avoid_distance_x() >= self.avoid_forward_clear_m:
                avoid_distance = self.avoid_distance_x()
                self.get_logger().info(
                    "Tree avoidance return phase: "
                    f"avoid_distance_x={avoid_distance:.3f}, "
                    f"pose_y={self.pose_y:.3f}, target_y={self.lane_keep_target_y:.3f}"
                )
                self.set_avoid_mode("avoid_tree_return")

        if self.mode == "avoid_tree_return":
            if (
                self.latest_decision_name == "HARD_BLOCKED"
                and self.avoid_phase_elapsed_s() > 0.5
            ):
                self.get_logger().info(
                    "Tree avoidance return interrupted by new hard obstacle: "
                    f"pose_delta_x={self.pose_delta_x():.3f}, "
                    f"pose_y={self.pose_y:.3f}, pose_yaw={self.pose_yaw:.3f}"
                )
                self.start_tree_avoidance()
                return

            y_error = abs(self.pose_y - self.lane_keep_target_y)
            yaw_error = abs(self.angle_diff(self.pose_yaw, 0.0))
            return_done = (
                y_error <= self.avoid_return_y_tolerance_m
                and yaw_error <= self.avoid_return_yaw_tolerance_rad
            )
            return_timed_out = self.avoid_phase_elapsed_s() >= self.avoid_return_max_s
            if return_done or return_timed_out:
                self.get_logger().info(
                    "Tree avoidance completed, returning to drive_line: "
                    f"pose_y={self.pose_y:.3f}, y_error={y_error:.3f}, "
                    f"pose_yaw={self.pose_yaw:.3f}, yaw_error={yaw_error:.3f}, "
                    f"return_elapsed={self.avoid_phase_elapsed_s():.2f}s"
                )
                self.finish_tree_avoidance()

    def command_for_state(self):
        self.update_avoidance_mode()

        if self.mode == "avoid_tree_reverse":
            return self.avoid_reverse_speed, 0.0, False, ""

        if self.mode == "avoid_tree_turn":
            return (
                self.avoid_turn_speed,
                self.avoid_turn_angular,
                False,
                "",
            )

        if self.mode == "avoid_tree_forward":
            return self.avoid_forward_speed, None, False, ""

        if self.mode == "avoid_tree_return":
            return self.avoid_return_speed, self.angular_for_return(), False, ""

        # Optional one-shot showcase stop. Disabled for the repeatable tree demo.
        if self.finish_stop_enabled and self.avoid_complete:
            if self.finish_stop_latched:
                return self.hard_speed, 0.0, True, "finish_stop"
            if (
                self.finish_ref_pose_delta_x is not None
                and self.finish_distance_target is not None
                and self.pose_delta_x() - self.finish_ref_pose_delta_x
                >= self.finish_distance_target
            ):
                self.finish_stop_latched = True
                return self.hard_speed, 0.0, True, "finish_stop"

        age = self.decision_age_s()
        if self.hard_stop_latched:
            return self.hard_speed, 0.0, True, "hard_blocked"

        if age is None:
            return 0.0, 0.0, True, "no_decision"

        if age > self.decision_timeout_s:
            return 0.0, 0.0, True, "decision_timeout"

        if self.latest_decision_name == "CLEAR":
            return self.clear_speed, None, False, ""
        if self.latest_decision_name == "OBSTACLE_AHEAD":
            return self.obstacle_speed, None, False, ""
        if self.latest_decision_name == "SOFT_TRAVERSABLE":
            if self.soft_contact_active():
                return self.soft_speed, None, False, ""
            if self.obstacle_ahead():
                return self.obstacle_speed, None, False, ""
            return self.clear_speed, None, False, ""
        if self.latest_decision_name == "HARD_BLOCKED":
            if self.tree_avoidance_enabled and not self.avoid_complete:
                self.start_tree_avoidance()
                return (
                    self.avoid_reverse_speed,
                    0.0,
                    False,
                    "",
                )
            self.hard_stop_latched = True
            return self.hard_speed, 0.0, True, "hard_blocked"

        return 0.0, 0.0, True, f"unknown_decision:{self.latest_decision_name}"

    def angular_for_lane(self, speed: float, stopped: bool, target_y: float) -> float:
        if stopped or speed <= 0.0 or not self.lane_keep_enabled:
            return 0.0

        y_error = self.pose_y - target_y
        angular = (
            -self.lane_keep_lateral_gain * y_error
            - self.lane_keep_yaw_gain * self.pose_yaw
        )
        return max(
            -self.lane_keep_max_angular,
            min(self.lane_keep_max_angular, angular),
        )

    def angular_for_return(self) -> float:
        if not self.lane_keep_enabled:
            return 0.0

        y_error = self.pose_y - self.lane_keep_target_y
        desired_yaw = max(
            -self.avoid_return_heading_limit_rad,
            min(
                self.avoid_return_heading_limit_rad,
                -self.avoid_return_lateral_gain * y_error,
            ),
        )
        angular = self.avoid_return_yaw_gain * self.angle_diff(
            desired_yaw, self.pose_yaw
        )
        return max(
            -self.avoid_return_max_angular,
            min(self.avoid_return_max_angular, angular),
        )

    def timer_callback(self):
        speed, angular_override, stopped, stop_reason = self.command_for_state()
        lane_target_y = self.active_lane_target_y()
        if angular_override is None:
            angular_z = self.angular_for_lane(speed, stopped, lane_target_y)
        else:
            angular_z = angular_override
        age = self.decision_age_s()
        pose_delta_x = self.pose_delta_x()

        cmd = Twist()
        cmd.linear.x = speed
        cmd.angular.z = angular_z
        self.cmd_publisher.publish(cmd)

        status = {
            "time_s": round(self.now_s(), 3),
            "label": self.label,
            "mode": self.mode,
            "decision": self.latest_decision_name,
            "decision_age_s": None if age is None else round(age, 3),
            "cmd_linear_x": round(speed, 3),
            "cmd_angular_z": round(angular_z, 3),
            "stopped": stopped,
            "stop_reason": stop_reason,
            "pose_y": round(self.pose_y, 4),
            "pose_yaw": round(self.pose_yaw, 4),
            "pose_delta_x": round(pose_delta_x, 4),
            "lane_keep_target_y": lane_target_y
            if self.lane_keep_enabled
            else None,
            "hard_stop_latched": self.hard_stop_latched,
            "tree_avoidance_enabled": self.tree_avoidance_enabled,
            "avoid_complete": self.avoid_complete,
            "avoid_elapsed_s": round(self.avoid_elapsed_s(), 3),
            "avoid_distance_x": round(self.avoid_distance_x(), 4),
            "odom_time_s": self.odom_time_s,
            "reset_count": self.reset_count,
            "pose_source": self.pose_source_name(),
        }
        msg = String()
        msg.data = json.dumps(status, sort_keys=True)
        self.status_publisher.publish(msg)

        min_front = self.latest_decision.get("min_front_range_m")
        force_p = self.latest_decision.get("force_event_p_n")
        progress_after_contact = self.latest_decision.get("progress_after_contact_x")
        force_event_current = self.latest_decision.get("force_event_current")
        self.log_writer.writerow(
            [
                f"{self.now_s():.3f}",
                self.label,
                self.mode,
                self.latest_decision_name,
                "" if age is None else f"{age:.3f}",
                f"{speed:.3f}",
                f"{angular_z:.3f}",
                int(stopped),
                stop_reason,
                f"{self.pose_x:.4f}",
                f"{self.pose_y:.4f}",
                f"{self.pose_yaw:.4f}",
                f"{pose_delta_x:.4f}",
                f"{lane_target_y:.4f}" if self.lane_keep_enabled else "",
                "" if min_front is None else f"{float(min_front):.3f}",
                "" if force_p is None else f"{float(force_p):.3f}",
                ""
                if progress_after_contact is None
                else f"{float(progress_after_contact):.4f}",
                ""
                if force_event_current is None
                else int(bool(force_event_current)),
                "" if self.odom_time_s is None else f"{self.odom_time_s:.3f}",
                self.reset_count,
                self.pose_source_name(),
            ]
        )
        self.log_file.flush()

    def close(self):
        if self.closed:
            return
        try:
            if rclpy.ok():
                stop = Twist()
                self.cmd_publisher.publish(stop)
        except Exception:
            pass
        self.log_file.close()
        self.closed = True


def main(args=None):
    rclpy.init(args=args)
    node = LiveReactionNode()
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
