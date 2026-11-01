// Static node graph for the local Pixal3D / TRELLIS.2 image-to-mesh pipeline.
// Split from the builder so each module stays readable; the builder injects
// the per-run parameters afterwards.
export const MESH_GRAPH_A = {
    '3': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "108",
          0
        ],
        "seed": 56,
        "steps": 12,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "314",
          0
        ],
        "negative": [
          "315",
          0
        ],
        "latent_image": [
          "87",
          0
        ],
        "denoise": 1
      }
    },
    '12': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "seed": 43,
        "steps": 12,
        "cfg": 1,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "98",
          0
        ],
        "negative": [
          "98",
          1
        ],
        "latent_image": [
          "98",
          2
        ],
        "denoise": 1
      }
    },
    '15': {
      "class_type": "CLIPVisionLoader",
      "inputs": {
        "clip_name": "dino_v3_L_naf_fp32.safetensors"
      }
    },
    '18': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "126",
          0
        ],
        "seed": 42,
        "steps": 20,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "91",
          0
        ],
        "negative": [
          "91",
          1
        ],
        "latent_image": [
          "91",
          2
        ],
        "denoise": 1
      }
    },
    '23': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "126",
          0
        ],
        "seed": 42,
        "steps": 12,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "simple",
        "positive": [
          "94",
          0
        ],
        "negative": [
          "94",
          1
        ],
        "latent_image": [
          "94",
          2
        ],
        "denoise": 1
      }
    },
    '40': {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "trellis_2_int8_convrot.safetensors",
        "weight_dtype": "default"
      }
    },
    '87': {
      "class_type": "EmptyTrellis2LatentStructure",
      "inputs": {
        "batch_size": 1
      }
    },
    '91': {
      "class_type": "Trellis2ShapeStage",
      "inputs": {
        "positive": [
          "314",
          0
        ],
        "negative": [
          "315",
          0
        ],
        "voxel": [
          "119",
          0
        ]
      }
    },
    '92': {
      "class_type": "VaeDecodeShapeTrellis",
      "inputs": {
        "samples": [
          "23",
          0
        ],
        "vae": [
          "117",
          0
        ]
      }
    },
    '93': {
      "class_type": "VaeDecodeTextureTrellis",
      "inputs": {
        "samples": [
          "12",
          0
        ],
        "vae": [
          "118",
          0
        ],
        "shape_subdivides": [
          "92",
          1
        ]
      }
    },
    '94': {
      "class_type": "Trellis2UpsampleStage",
      "inputs": {
        "positive": [
          "91",
          0
        ],
        "negative": [
          "91",
          1
        ],
        "shape_latent": [
          "18",
          0
        ],
        "vae": [
          "117",
          0
        ],
        "target_resolution": 1536
      }
    },
    '98': {
      "class_type": "Trellis2TextureStage",
      "inputs": {
        "positive": [
          "94",
          0
        ],
        "negative": [
          "94",
          1
        ],
        "shape_latent": [
          "23",
          0
        ]
      }
    },
    // MoGe FOV branch (official workflow 920c795f693a): depth-estimate the
    // cropped input and derive the true horizontal FOV for Pixal3D
    // conditioning — a fixed 49.13° placeholder distorts geometry on most
    // photos. Runs only in pixal3d mode (TRELLIS.2's conditioning has no
    // camera input, so 298 never executes and these stay lazy).
    '55': {
      "class_type": "LoadMoGeModel",
      "inputs": {
        "model_name": "moge_2_vitl_normal_fp16.safetensors"
      }
    },
    '56': {
      "class_type": "MoGeInference",
      "inputs": {
        "moge_model": [
          "55",
          0
        ],
        "image": [
          "312",
          0
        ],
        "resolution_level": 9,
        "fov_x_degrees": 0,
        "batch_size": 4,
        "force_projection": true,
        "apply_mask": true,
        "refine_steps": 3
      }
    },
    '242': {
      "class_type": "MoGeGeometryToFOV",
      "inputs": {
        "moge_geometry": [
          "56",
          0
        ],
        "axis": "horizontal",
        "unit": "degrees"
      }
    },
    '108': {
      "class_type": "ModelSamplingSD3",
      "inputs": {
        "model": [
          "125",
          0
        ],
        "shift": 5
      }
    },
    '117': {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "trellis_2_shape_vae_bf16.safetensors"
      }
    },
    '118': {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "trellis_2_texture_vae_bf16.safetensors"
      }
    },
    '119': {
      "class_type": "VaeDecodeStructureTrellis2",
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "117",
          0
        ],
        "resolution": "32"
      }
    },
    '122': {
      "class_type": "LoadImage",
      "inputs": {
        "image": "cave_wall.png"
      }
    },
    '125': {
      "class_type": "RescaleCFG",
      "inputs": {
        "model": [
          "199",
          0
        ],
        "multiplier": 0.7
      }
    },
    '126': {
      "class_type": "RescaleCFG",
      "inputs": {
        "model": [
          "279",
          0
        ],
        "multiplier": 0.5
      }
    },
    '147': {
      "class_type": "BakeTextureFromVoxel",
      "inputs": {
        "mesh": [
          "196",
          0
        ],
        "voxel_colors": [
          "93",
          0
        ],
        "texture_size": [
          "288",
          0
        ],
        "reference_mesh": [
          "92",
          0
        ]
      }
    },
    '186': {
      "class_type": "DecimateMesh",
      "inputs": {
        "mesh": [
          "241",
          0
        ],
        "target_face_count": 700000,
        "placement_mode": "midpoint"
      }
    },
    '192': {
      "class_type": "RemoveBackground",
      "inputs": {
        "bg_removal_model": [
          "193",
          0
        ],
        "image": [
          "122",
          0
        ]
      }
    },
    '193': {
      "class_type": "LoadBackgroundRemovalModel",
      "inputs": {
        "bg_removal_name": "birefnet.safetensors"
      }
    },
    '196': {
      "class_type": "UnwrapMesh",
      "inputs": {
        "mesh": [
          "238",
          0
        ],
        "segmenter": "pec",
        "resolution": [
          "288",
          0
        ],
        "padding": 1,
        "weld_distance": 0.0002
      }
    },
    '199': {
      "class_type": "CFGOverride",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "cfg": 1,
        "start_percent": 0.667,
        "end_percent": 1
      }
    },
}
