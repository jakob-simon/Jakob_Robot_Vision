#!/usr/bin/env python3

import csv
import math
import os
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

import rclpy
from geometry_msgs.msg import Pose
from geometry_msgs.msg import Wrench
from nav_msgs.msg import Odometry
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from std_msgs.msg import String
from tf2_msgs.msg import TFMessage


@dataclass
class ContactEvent:
    event_time: float
    segment: int
    force_proxy: float
    odom_x: float
    odom_y: float
    pose_x: float
    pose_y: float
    pose_delta_x: float


class ForceEventNode(Node):
    """Extract paper-style contact events (t0, k, p) from five force-bar segments."""

    NUMBER_OF_SEGMENTS = 5

    def __init__(self):
        super().__init__("force_event_node")

        self.label = self.declare_parameter("label", "force_event").value
        self.log_dir = self.declare_parameter(
            "log_dir", "/workspace/logs/force_benchmarks"
        ).value
        self.baseline_duration_s = float(
            self.declare_parameter("baseline_duration_s", 3.0).value
        )
        self.threshold_n = float(self.declare_parameter("threshold_n", 18.0).value)
        self.duration_gate_s = float(
            self.declare_parameter("duration_gate_s", 0.04).value
        )
        self.peak_window_s = float(self.declare_parameter("peak_window_s", 1.0).value)
        self.sample_period_s = float(
            self.declare_parameter("sample_period_s", 0.05).value
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
        self.sample_path = os.path.join(
            self.log_dir, f"{self.label}_samples_{timestamp}.csv"
        )
        self.event_path = os.path.join(
            self.log_dir, f"{self.label}_events_{timestamp}.csv"
        )

        self.start_time = time.monotonic()
        self.latest_magnitudes: List[float] = [0.0] * self.NUMBER_OF_SEGMENTS
        self.received_segments = set()
        self.baseline_start_time_s: Optional[float] = None
        self.baseline_sums: List[float] = [0.0] * self.NUMBER_OF_SEGMENTS
        self.baseline_counts: List[int] = [0] * self.NUMBER_OF_SEGMENTS
        self.baselines: Optional[List[float]] = None
        self.above_since: Dict[int, Optional[float]] = {
            i: None for i in range(self.NUMBER_OF_SEGMENTS)
        }
        self.current_event: Optional[ContactEvent] = None
        self.event_open = False
        self.event_peak_deadline: Optional[float] = None
        self.contact_latched = False
        self.odom_x = 0.0
        self.odom_y = 0.0
        self.odom_start_x: Optional[float] = None
        self.odom_start_y: Optional[float] = None
        self.odom_time_s: Optional[float] = None
        self.last_odom_time_s: Optional[float] = None
        self.odom_reset_start_x: Optional[float] = None
        self.odom_reset_start_y: Optional[float] = None
        self.odom_pose_fallback_active = False
        self.world_pose_active = False
        self.pose_x = 0.0
        self.pose_y = 0.0
        self.pose_start_x: Optional[float] = None
        self.pose_start_y: Optional[float] = None
        self.last_pose_x: Optional[float] = None
        self.reset_count = 0
        self.closed = False

        self.sample_file = open(self.sample_path, "w", newline="")
        self.sample_writer = csv.writer(self.sample_file)
        self.sample_writer.writerow(
            [
                "wall_time_s",
                "phase",
                "odom_x",
                "odom_y",
                "odom_delta_x",
                "pose_x",
                "pose_y",
                "pose_delta_x",
                "odom_time_s",
                "reset_count",
                "pose_source",
                "max_segment",
                "max_corrected_force",
                *[f"raw_force_seg_{i}" for i in range(self.NUMBER_OF_SEGMENTS)],
                *[
                    f"corrected_force_seg_{i}"
                    for i in range(self.NUMBER_OF_SEGMENTS)
                ],
            ]
        )

        self.event_file = open(self.event_path, "w", newline="")
        self.event_writer = csv.writer(self.event_file)
        self.event_writer.writerow(
            [
                "event_time_s",
                "segment",
                "force_proxy",
                "odom_x",
                "odom_y",
                "pose_x",
                "pose_y",
                "pose_delta_x",
                "threshold_n",
                "duration_gate_s",
            ]
        )

        self.event_publisher = self.create_publisher(String, "/force_bar/events", 10)
        for segment in range(self.NUMBER_OF_SEGMENTS):
            self.create_subscription(
                Wrench,
                f"/scout/force_bar/segment_{segment}",
                lambda msg, segment=segment: self.segment_callback(segment, msg),
                10,
            )
        self.create_subscription(Odometry, "/odom", self.odom_callback, 10)
        self.create_subscription(Pose, "/pose", self.pose_callback, 10)
        self.create_subscription(TFMessage, "/world_pose", self.world_pose_callback, 10)
        self.timer = self.create_timer(self.sample_period_s, self.timer_callback)

        self.get_logger().info(
            "Force event node started: "
            f"label={self.label}, threshold={self.threshold_n:.1f} N, "
            f"tau={self.duration_gate_s:.2f} s, "
            f"baseline={self.baseline_duration_s:.1f} s, "
            f"reset_time_backward_jump={self.reset_time_backward_jump_s:.2f} s"
        )
        self.get_logger().info(f"Sample log: {self.sample_path}")
        self.get_logger().info(f"Event log: {self.event_path}")

    def now_s(self) -> float:
        return time.monotonic() - self.start_time

    def segment_callback(self, segment: int, msg: Wrench):
        force = msg.force
        magnitude = math.sqrt(force.x * force.x + force.y * force.y + force.z * force.z)
        self.latest_magnitudes[segment] = magnitude
        self.received_segments.add(segment)

        now = self.now_s()
        if (
            self.baseline_start_time_s is None
            and len(self.received_segments) == self.NUMBER_OF_SEGMENTS
        ):
            self.baseline_start_time_s = now
            self.baseline_sums = [0.0] * self.NUMBER_OF_SEGMENTS
            self.baseline_counts = [0] * self.NUMBER_OF_SEGMENTS

        if (
            self.baselines is None
            and self.baseline_start_time_s is not None
            and now - self.baseline_start_time_s <= self.baseline_duration_s
        ):
            self.baseline_sums[segment] += magnitude
            self.baseline_counts[segment] += 1

        self.ensure_baseline(now)
        if self.baselines is not None:
            self.maybe_detect_event(now, self.corrected_forces())

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
        if self.odom_start_x is None:
            self.odom_start_x = self.odom_x
            self.odom_start_y = self.odom_y

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
            f"current_pose_x={self.pose_x:.3f}, odom_time_s={odom_text}; "
            "relearning force baseline"
        )
        self.latest_magnitudes = [0.0] * self.NUMBER_OF_SEGMENTS
        self.received_segments = set()
        self.baseline_start_time_s = None
        self.baseline_sums = [0.0] * self.NUMBER_OF_SEGMENTS
        self.baseline_counts = [0] * self.NUMBER_OF_SEGMENTS
        self.baselines = None
        self.above_since = {i: None for i in range(self.NUMBER_OF_SEGMENTS)}
        self.current_event = None
        self.event_open = False
        self.event_peak_deadline = None
        self.contact_latched = False
        self.odom_time_s = odom_time_s
        self.last_odom_time_s = odom_time_s
        if odom_time_s is None:
            self.odom_start_x = None
            self.odom_start_y = None
        else:
            self.odom_start_x = self.odom_x
            self.odom_start_y = self.odom_y
        self.pose_start_x = self.pose_x
        self.pose_start_y = self.pose_y
        self.last_pose_x = self.pose_x
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
    def stamp_to_s(stamp) -> float:
        return float(stamp.sec) + float(stamp.nanosec) * 1e-9

    def ensure_baseline(self, now: float):
        if self.baselines is not None:
            return
        if self.baseline_start_time_s is None:
            return
        if now - self.baseline_start_time_s < self.baseline_duration_s:
            return

        self.baselines = []
        for segment in range(self.NUMBER_OF_SEGMENTS):
            count = self.baseline_counts[segment]
            baseline = self.baseline_sums[segment] / count if count else 0.0
            self.baselines.append(baseline)
        self.get_logger().info(
            "Baseline learned: "
            + ", ".join(f"S{i}={value:.2f}N" for i, value in enumerate(self.baselines))
        )

    def corrected_forces(self) -> List[float]:
        if self.baselines is None:
            return [0.0] * self.NUMBER_OF_SEGMENTS
        return [
            max(0.0, self.latest_magnitudes[i] - self.baselines[i])
            for i in range(self.NUMBER_OF_SEGMENTS)
        ]

    def maybe_detect_event(self, now: float, corrected: List[float]):
        if self.baselines is None:
            return

        for segment, value in enumerate(corrected):
            if value >= self.threshold_n:
                if self.above_since[segment] is None:
                    self.above_since[segment] = now
            else:
                self.above_since[segment] = None

        if self.contact_latched:
            if all(value < self.threshold_n for value in corrected):
                self.contact_latched = False
            else:
                return

        if self.event_open:
            if self.current_event is not None and self.event_peak_deadline is not None:
                peak_now = max(corrected)
                if now <= self.event_peak_deadline and peak_now > self.current_event.force_proxy:
                    self.current_event.force_proxy = peak_now
                elif now > self.event_peak_deadline:
                    self.write_event(self.current_event)
                    self.event_open = False
                    self.current_event = None
                    self.event_peak_deadline = None
                    self.contact_latched = True
            return

        candidates = [
            (start, segment)
            for segment, start in self.above_since.items()
            if start is not None and now - start >= self.duration_gate_s
        ]
        if not candidates:
            return

        event_start, event_segment = min(candidates)
        self.current_event = ContactEvent(
            event_time=event_start,
            segment=event_segment,
            force_proxy=corrected[event_segment],
            odom_x=self.odom_x,
            odom_y=self.odom_y,
            pose_x=self.pose_x,
            pose_y=self.pose_y,
            pose_delta_x=(
                self.pose_x - self.pose_start_x
                if self.pose_start_x is not None
                else 0.0
            ),
        )
        self.event_open = True
        self.event_peak_deadline = now + self.peak_window_s

    def write_event(self, event: ContactEvent, publish_event: bool = True):
        self.event_writer.writerow(
            [
                f"{event.event_time:.3f}",
                event.segment,
                f"{event.force_proxy:.3f}",
                f"{event.odom_x:.4f}",
                f"{event.odom_y:.4f}",
                f"{event.pose_x:.4f}",
                f"{event.pose_y:.4f}",
                f"{event.pose_delta_x:.4f}",
                f"{self.threshold_n:.3f}",
                f"{self.duration_gate_s:.3f}",
            ]
        )
        self.event_file.flush()

        event_text = (
            f"t0={event.event_time:.3f}, "
            f"k={event.segment}, "
            f"p={event.force_proxy:.3f}, "
            f"odom_x={event.odom_x:.4f}, "
            f"pose_delta_x={event.pose_delta_x:.4f}, "
            f"label={self.label}"
        )
        if publish_event:
            msg = String()
            msg.data = event_text
            self.event_publisher.publish(msg)
        self.get_logger().info(f"Contact event: {event_text}")

    def timer_callback(self):
        now = self.now_s()
        self.ensure_baseline(now)
        corrected = self.corrected_forces()
        self.maybe_detect_event(now, corrected)

        if corrected:
            max_force = max(corrected)
            max_segment = corrected.index(max_force)
        else:
            max_force = 0.0
            max_segment = -1

        phase = "baseline" if self.baselines is None else "active"
        odom_delta_x = (
            self.odom_x - self.odom_start_x if self.odom_start_x is not None else 0.0
        )
        pose_delta_x = (
            self.pose_x - self.pose_start_x if self.pose_start_x is not None else 0.0
        )
        self.sample_writer.writerow(
            [
                f"{now:.3f}",
                phase,
                f"{self.odom_x:.4f}",
                f"{self.odom_y:.4f}",
                f"{odom_delta_x:.4f}",
                f"{self.pose_x:.4f}",
                f"{self.pose_y:.4f}",
                f"{pose_delta_x:.4f}",
                "" if self.odom_time_s is None else f"{self.odom_time_s:.3f}",
                self.reset_count,
                self.pose_source_name(),
                max_segment,
                f"{max_force:.3f}",
                *[f"{value:.3f}" for value in self.latest_magnitudes],
                *[f"{value:.3f}" for value in corrected],
            ]
        )
        self.sample_file.flush()

    def close(self):
        if self.closed:
            return
        if self.current_event is not None:
            self.write_event(self.current_event, publish_event=False)
            self.current_event = None
        self.sample_file.close()
        self.event_file.close()
        self.closed = True


def main(args=None):
    rclpy.init(args=args)
    node = ForceEventNode()
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
