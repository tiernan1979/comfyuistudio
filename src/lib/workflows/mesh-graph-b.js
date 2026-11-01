// Second half of the static Pixal3D / TRELLIS.2 graph (post-process chain).
export const MESH_GRAPH_B = {
    '202': {
      "class_type": "GetMeshInfo",
      "inputs": {
        "mesh": [
          "92",
          0
        ]
      }
    },
    '210': {
      "class_type": "ApplyTextureToMesh",
      "inputs": {
        "mesh": [
          "196",
          0
        ],
        "base_color": [
          "147",
          0
        ],
        "metallic": [
          "147",
          1
        ],
        "roughness": [
          "147",
          2
        ],
        "occlusion": [
          "233",
          0
        ],
        "normal_map": [
          "224",
          0
        ]
      }
    },
    '224': {
      "class_type": "BakeNormalMapFromMesh",
      "inputs": {
        "low_poly": [
          "196",
          0
        ],
        "high_poly": [
          "241",
          0
        ],
        "resolution": 2048,
        "cage_distance": 0.05,
        "ignore_backfaces": true
      }
    },
    '233': {
      "class_type": "BakeAmbientOcclusion",
      "inputs": {
        "low_poly": [
          "196",
          0
        ],
        "high_poly": [
          "241",
          0
        ],
        "resolution": 1024,
        "samples": 64,
        "max_distance": 0.71,
        "strength": 1,
        "bias": 0.01
      }
    },
    '238': {
      "class_type": "MeshSmoothNormals",
      "inputs": {
        "mesh": [
          "186",
          0
        ],
        "crease_angle": 180
      }
    },
    '241': {
      "class_type": "RemeshMesh",
      "inputs": {
        "mesh": [
          "202",
          0
        ],
        "resolution": 768,
        "sign_mode": "udf",
        "sign_mode.qef": false,
        "sign_mode.drop_inverted_components": false,
        "sign_mode.drop_enclosed_components": false,
        "band": 1,
        "project_back": 0,
        "fix_poles": false,
        "smooth_iters": 20,
        "drop_small_components": 0.01,
        "precluster_max_verts": 20000000
      }
    },
    '248': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": true,
        "on_false": [
          "122",
          1
        ],
        "on_true": [
          "192",
          0
        ]
      }
    },
    '260': {
      "class_type": "MeshSmoothNormals",
      "inputs": {
        "mesh": [
          "210",
          0
        ],
        "crease_angle": 180
      }
    },
    '279': {
      "class_type": "CFGOverride",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "cfg": 1,
        "start_percent": 0.769,
        "end_percent": 1
      }
    },
    '285': {
      "class_type": "MeshToFile3D",
      "inputs": {
        "mesh": [
          "260",
          0
        ]
      }
    },
    '288': {
      "class_type": "PrimitiveInt",
      "inputs": {
        "value": 4096
      }
    },
    '298': {
      "class_type": "Pixal3DConditioning",
      "inputs": {
        "clip_vision_model": [
          "15",
          0
        ],
        "image": [
          "312",
          0
        ],
        "camera_angle_x": [
          "242",
          0
        ]
      }
    },
    '299': {
      "class_type": "Trellis2Conditioning",
      "inputs": {
        "clip_vision_model": [
          "15",
          0
        ],
        "image": [
          "312",
          0
        ]
      }
    },
    '312': {
      "class_type": "ImageCropToMask",
      "inputs": {
        "images": [
          "122",
          0
        ],
        "masks": [
          "248",
          0
        ],
        "width": 1024,
        "height": 1024,
        "pad_factor": 1.1,
        "grow_mask": 0,
        "background": "#000000"
      }
    },
    '314': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "298",
          0
        ],
        "on_true": [
          "299",
          0
        ]
      }
    },
    '315': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "298",
          1
        ],
        "on_true": [
          "299",
          1
        ]
      }
    },
    '316': {
      "class_type": "PrimitiveBoolean",
      "inputs": {
        "value": false
      }
    },
    '318': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "319",
          0
        ],
        "on_true": [
          "40",
          0
        ]
      }
    },
    '319': {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "pixal3d_int8_convrot.safetensors",
        "weight_dtype": "default"
      }
    },
    '322': {
      "class_type": "Save3DAdvanced",
      "inputs": {
        "model_3d": [
          "285",
          0
        ],
        "filename_prefix": "3d/ComfyUI",
        "viewport_state": "",
        "width": 1024,
        "height": 1024
      }
    },
}
