cmake_minimum_required(VERSION 3.5)

project(ros_gz_lehrforst_sim)

find_package(ament_cmake REQUIRED)
find_program(XACRO_EXECUTABLE xacro REQUIRED)

set(ROBOTS
  bunker
  scout
  scout_bumper
)

foreach(robot ${ROBOTS})
  set(xacro_file
    "${CMAKE_CURRENT_SOURCE_DIR}/models/${robot}/model.xacro"
  )
  set(sdf_file
    "${CMAKE_CURRENT_BINARY_DIR}/generated_models/${robot}/model.sdf"
  )

  add_custom_command(
    OUTPUT ${sdf_file}
    COMMAND ${CMAKE_COMMAND} -E make_directory
      "${CMAKE_CURRENT_BINARY_DIR}/generated_models/${robot}"
    COMMAND ${XACRO_EXECUTABLE} ${xacro_file} -o ${sdf_file}
    DEPENDS ${xacro_file}
    COMMENT "Generating ${robot}/model.sdf from xacro"
    VERBATIM
  )

  add_custom_target(generate_${robot}_sdf ALL
    DEPENDS ${sdf_file}
  )

  install(
    FILES ${sdf_file}
    DESTINATION share/${PROJECT_NAME}/models/${robot}
  )
endforeach()

install(
  DIRECTORY config/
  DESTINATION share/${PROJECT_NAME}/config
)

install(
  DIRECTORY launch/
  DESTINATION share/${PROJECT_NAME}/launch
)

install(
  DIRECTORY rviz/
  DESTINATION share/${PROJECT_NAME}/rviz
)

install(
  DIRECTORY models/
  DESTINATION share/${PROJECT_NAME}/models
)

install(
  DIRECTORY scripts/
  DESTINATION share/${PROJECT_NAME}/scripts
)

install(
  DIRECTORY worlds/
  DESTINATION share/${PROJECT_NAME}/worlds
)

set(GEN_SOFT_VEGETATION_SCRIPT
  "${CMAKE_CURRENT_SOURCE_DIR}/models/soft_vegetation_forest/generate_soft_vegetation_forest_model_sdf.py"
)
set(GEN_SOFT_VEGETATION_TARGET
  "${CMAKE_CURRENT_BINARY_DIR}/generated_models/soft_vegetation_forest"
)
set(GEN_SOFT_VEGETATION_SDF
  "${GEN_SOFT_VEGETATION_TARGET}/model.sdf"
)
set(GEN_SOFT_VEGETATION_CSV
  "${GEN_SOFT_VEGETATION_TARGET}/vegetation_positions.csv"
)

add_custom_command(
  OUTPUT
    ${GEN_SOFT_VEGETATION_SDF}
    ${GEN_SOFT_VEGETATION_CSV}
  COMMAND ${CMAKE_COMMAND} -E make_directory
    "${GEN_SOFT_VEGETATION_TARGET}"
  COMMAND python3 ${GEN_SOFT_VEGETATION_SCRIPT} ${GEN_SOFT_VEGETATION_TARGET}
  DEPENDS
    ${GEN_SOFT_VEGETATION_SCRIPT}
    "${CMAKE_CURRENT_SOURCE_DIR}/models/lehrforst_trees/tree_positions.csv"
  COMMENT "Generating forest-wide soft vegetation model"
  VERBATIM
)

add_custom_target(generate_soft_vegetation_forest_sdf ALL
  DEPENDS
    ${GEN_SOFT_VEGETATION_SDF}
    ${GEN_SOFT_VEGETATION_CSV}
)

install(
  FILES
    ${GEN_SOFT_VEGETATION_SDF}
    ${GEN_SOFT_VEGETATION_CSV}
  DESTINATION share/${PROJECT_NAME}/models/soft_vegetation_forest
)

set(GEN_SOFT_CONTACT_SCRIPT
  "${CMAKE_CURRENT_SOURCE_DIR}/models/soft_vegetation_contact_field/generate_soft_vegetation_contact_field_model_sdf.py"
)
set(GEN_SOFT_CONTACT_TARGET
  "${CMAKE_CURRENT_BINARY_DIR}/generated_models/soft_vegetation_contact_field"
)
set(GEN_SOFT_CONTACT_SDF
  "${GEN_SOFT_CONTACT_TARGET}/model.sdf"
)
set(GEN_SOFT_CONTACT_CSV
  "${GEN_SOFT_CONTACT_TARGET}/contact_positions.csv"
)

add_custom_command(
  OUTPUT
    ${GEN_SOFT_CONTACT_SDF}
    ${GEN_SOFT_CONTACT_CSV}
  COMMAND ${CMAKE_COMMAND} -E make_directory
    "${GEN_SOFT_CONTACT_TARGET}"
  COMMAND python3 ${GEN_SOFT_CONTACT_SCRIPT} ${GEN_SOFT_CONTACT_TARGET}
  DEPENDS ${GEN_SOFT_CONTACT_SCRIPT}
  COMMENT "Generating soft vegetation contact field model"
  VERBATIM
)

add_custom_target(generate_soft_vegetation_contact_field_sdf ALL
  DEPENDS
    ${GEN_SOFT_CONTACT_SDF}
    ${GEN_SOFT_CONTACT_CSV}
)

install(
  FILES
    ${GEN_SOFT_CONTACT_SDF}
    ${GEN_SOFT_CONTACT_CSV}
  DESTINATION share/${PROJECT_NAME}/models/soft_vegetation_contact_field
)

set(GEN_TREE_SCRIPT
  "${CMAKE_CURRENT_SOURCE_DIR}/models/lehrforst_trees/generate_lehrforst_trees_model_sdf.py"
)
set(GEN_TREE_TARGET
  "${CMAKE_CURRENT_BINARY_DIR}/generated_models/lehrforst_trees"
)
set(GEN_TREE_SDF
  "${GEN_TREE_TARGET}/model.sdf"
)
set(GEN_TREE_CSV
  "${GEN_TREE_TARGET}/tree_position_filtered.csv"
)

add_custom_command(
  OUTPUT
    ${GEN_TREE_SDF}
    ${GEN_TREE_CSV}
  COMMAND ${CMAKE_COMMAND} -E make_directory
    "${GEN_TREE_TARGET}"
  COMMAND python3 ${GEN_TREE_SCRIPT} ${GEN_TREE_TARGET}
  DEPENDS
    ${GEN_TREE_SCRIPT}
    "${CMAKE_CURRENT_SOURCE_DIR}/models/lehrforst_trees/tree_positions.csv"
  COMMENT "Generating lehrforst tree model"
  VERBATIM
)

add_custom_target(generate_lehrforst_trees_sdf ALL
  DEPENDS
    ${GEN_TREE_SDF}
    ${GEN_TREE_CSV}
)

install(
  FILES
    ${GEN_TREE_SDF}
    ${GEN_TREE_CSV}
  DESTINATION share/${PROJECT_NAME}/models/lehrforst_trees
)

ament_package()
