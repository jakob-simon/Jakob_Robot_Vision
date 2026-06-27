#!/usr/bin/env python3

import argparse
import json
import time
from typing import Any, Dict, Optional

import rclpy
from geometry_msgs.msg import Pose
from geometry_msgs.msg import Twist
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from std_msgs.msg import String


class GuiLiveMonitor(Node):
    """Print compact live diagnostics for the visible Gazebo demo."""

    def __init__(self, label: str):
        super().__init__("gui_live_monitor")
        self.label = label
        self.start_time = time.monotonic()
        self.latest_status: Dict[str, Any] = {}
        self.latest_status_time: Optional[float] = None
        self.latest_cmd_x: Optional[float] = None
        self.latest_cmd_z: Optional[float] = None
        self.latest_cmd_time: Optional[float] = None
        self.pose_x: Optional[float] = None
        self.pose_y: Optional[float] = None
        self.pose_start_x: Optional[float] = None

        self.create_subscription(
            String, "/traversability/live_status", self.status_callback, 10
        )
        self.create_subscription(Twist, "/cmd_vel", self.cmd_callback, 10)
        self.create_subscription(Pose, "/pose", self.pose_callback, 10)
        self.create_timer(1.0, self.timer_callback)

    def elapsed(self) -> float:
        return time.monotonic() - self.start_time

    def status_callback(self, msg: String):
        try:
            self.latest_status = json.loads(msg.data)
            self.latest_status_time = self.elapsed()
        except json.JSONDecodeError:
            self.latest_status = {"decision": "BAD_STATUS_JSON"}
            self.latest_status_time = self.elapsed()

    def cmd_callback(self, msg: Twist):
        self.latest_cmd_x = msg.linear.x
        self.latest_cmd_z = msg.angular.z
        self.latest_cmd_time = self.elapsed()

    def pose_callback(self, msg: Pose):
        self.pose_x = msg.position.x
        self.pose_y = msg.position.y
        if self.pose_start_x is None:
            self.pose_start_x = self.pose_x

    def pose_delta_x(self) -> Optional[float]:
        if self.pose_x is None or self.pose_start_x is None:
            return None
        return self.pose_x - self.pose_start_x

    def timer_callback(self):
        now = self.elapsed()
        decision = self.latest_status.get("decision", "NO_STATUS")
        mode = self.latest_status.get("mode", "?")
        status_cmd = self.latest_status.get("cmd_linear_x")
        status_cmd_z = self.latest_status.get("cmd_angular_z")
        stopped = self.latest_status.get("stopped")
        stop_reason = self.latest_status.get("stop_reason") or ""
        hard_latched = self.latest_status.get("hard_stop_latched")
        pose_y = self.latest_status.get("pose_y")
        status_pose_delta = self.latest_status.get("pose_delta_x")
        if isinstance(status_pose_delta, (float, int)):
            pose_delta = float(status_pose_delta)
        else:
            pose_delta = self.pose_delta_x()

        notes = []
        if self.latest_status_time is None and now > 5.0:
            notes.append("warte auf /traversability/live_status")
        if self.latest_cmd_time is None and now > 5.0:
            notes.append("kein /cmd_vel gesehen")
        if stop_reason:
            notes.append(f"stop={stop_reason}")
        if hard_latched:
            notes.append("hard_stop_latched=true")
        if (
            self.latest_cmd_x is not None
            and abs(self.latest_cmd_x) > 0.05
            and now > 15.0
            and pose_delta is not None
            and abs(pose_delta) < 0.02
        ):
            notes.append("cmd_vel positiv, aber Pose bewegt sich kaum")

        cmd_text = "?"
        if self.latest_cmd_x is not None:
            cmd_text = f"{self.latest_cmd_x:.2f}"
        elif isinstance(status_cmd, (float, int)):
            cmd_text = f"{float(status_cmd):.2f}"

        cmd_z_text = "?"
        if self.latest_cmd_z is not None:
            cmd_z_text = f"{self.latest_cmd_z:.2f}"
        elif isinstance(status_cmd_z, (float, int)):
            cmd_z_text = f"{float(status_cmd_z):.2f}"

        pose_text = "?"
        if pose_delta is not None:
            pose_text = f"{pose_delta:.3f}"

        pose_y_text = "?"
        if isinstance(pose_y, (float, int)):
            pose_y_text = f"{float(pose_y):.3f}"

        note_text = " | ".join(notes) if notes else "ok"
        print(
            f"[{self.label}] t={now:5.1f}s mode={mode:<18} decision={decision:<17} "
            f"cmd_x={cmd_text:>5} cmd_z={cmd_z_text:>5} stopped={stopped} "
            f"pose_dx={pose_text:>7} pose_y={pose_y_text:>7} {note_text}",
            flush=True,
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="gui")
    args = parser.parse_args()

    rclpy.init()
    node = GuiLiveMonitor(args.label)
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
