# Copyright 2016 Open Source Robotics Foundation, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


import rclpy
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node

from geometry_msgs.msg import Wrench
from std_msgs.msg import String


class ForceBarTopicMerger(Node):
    """merge force bar segment topcis into a single topic"""

    NUMBER_OF_SEGMENTS:int = 5

    def __init__(self, sn:int, hz:float=1000.0):
        """
        sn.... segment number
        hz.... timer frequency
        """
        super().__init__(f'force_bar_topic_merger_{sn}')
        self.sn = sn
        self.val = 0.0
        self.segment = self.create_subscription(Wrench, f'/scout/force_bar/segment_{self.sn}', self.segment_callback, 10)
        self.publisher = self.create_publisher(String, '/merged_force_topic', 10)
        self.timer = self.create_timer(1.0/hz, self.timer_callback)

    def segment_callback(self, msg):
        self.val = msg.force.x

    def timer_callback(self):
        msg = String()
        msg.data = f"{self.sn} {self.val}"
        self.publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    nodes = []
    executor = MultiThreadedExecutor()
    for i in range(ForceBarTopicMerger.NUMBER_OF_SEGMENTS):
        nodes.append(ForceBarTopicMerger(i))
        executor.add_node(nodes[i])
    executor.spin()
    for node in nodes:
        node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()