FROM osrf/ros:jazzy-desktop-full

ARG USERNAME=jacob
ARG USER_UID=1002
ARG USER_GID=1002

ENV DEBIAN_FRONTEND=noninteractive
ENV ROS_DISTRO=jazzy

RUN apt-get update && apt-get install -y --no-install-recommends \
    less \
    mesa-utils \
    nano \
    sudo \
    x11-apps \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid ${USER_GID} ${USERNAME} \
  && useradd --uid ${USER_UID} --gid ${USER_GID} -m ${USERNAME} \
  && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/${USERNAME} \
  && chmod 0440 /etc/sudoers.d/${USERNAME}

RUN rosdep init || true

USER ${USERNAME}
WORKDIR /workspace

RUN echo "source /opt/ros/jazzy/setup.bash" >>/home/${USERNAME}/.bashrc \
  && echo "[ -f /workspace/install/setup.bash ] && source /workspace/install/setup.bash" >>/home/${USERNAME}/.bashrc

CMD ["bash"]
