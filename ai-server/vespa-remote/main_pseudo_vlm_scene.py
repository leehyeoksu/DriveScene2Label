"""
Per-scene VESPA-Direct: same pipeline as main_pseudo_vlm.py, but writes the final pseudo label JSON for every
requested scene separately (main_pseudo_vlm.py only writes labels once all scenes are done).

python main_pseudo_vlm_scene.py --config configs/vlm/p_final_trainval.yaml --scenes scene-0001 scene-0002
-> outs/vlm/<exp>/#out_labels_scene/<scene>/vlm_<exp>_<scene>_{1,3,8}class.json (same format as #out_labels/*.json)

No evaluation here: nuScenes mAP of a single scene is biased (missing classes count as AP=0), see scripts/per_scene_eval.py.
"""
import argparse
import json
import logging
import multiprocessing
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import rerun as rr
import yaml

from main_pseudo_union import get_out_dir, _suppress_output
from main_pseudo_vlm import process_scene
from src.data.dataset import get_dataset_scene_names
from src.labeling.prior_info import get_common_object_infos_sam
from src.labeling.submission import _get_annotation_dict

logger = logging.getLogger(__name__)


def write_scene_labels(annotations_by_mapping: dict, split: str, scene_name: str, config: dict) -> list[Path]:
    out_dir = get_out_dir(config, f"#out_labels_scene/{scene_name}")
    paths = []
    for mapping_name, annotations_by_sample in annotations_by_mapping.items():
        path = out_dir / f"{config['type']}_{config['exp_name']}_{scene_name}_{mapping_name}.json"
        submission = {
            "split": split,
            "mapping_name": mapping_name,
            "meta": {"use_camera": True, "use_lidar": True, "use_radar": False, "use_map": False, "use_external": False},
            "results": {token: [_get_annotation_dict(a, token) for a in annotations]
                        for token, annotations in annotations_by_sample.items()},
        }
        with open(path, 'w') as f:
            json.dump(submission, f, indent=2)
        paths.append(path)
    return paths


def run_scene(scene_name: str, obj_info: dict, config: dict, args: argparse.Namespace) -> list[Path]:
    annotations_by_mapping, split = process_scene(scene_name, obj_info, config, args)
    return write_scene_labels(annotations_by_mapping, split, scene_name, config)


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate pseudo labels per scene')
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--scenes', type=str, nargs='+', required=True, help='List of scenes')
    parser.add_argument('--visualize', action='store_true')
    parser.add_argument('--workers', type=int, default=1)
    rr.script_add_args(parser)
    args = parser.parse_args()

    assert args.config.exists(), f"Config file {args.config} does not exist"
    assert args.config.suffix == '.yaml', f"Config file {args.config} is not a YAML file"
    with open(args.config, 'r') as f:
        config = yaml.safe_load(f)
    assert config['type'] == 'vlm', f"Config file {args.config} is not a valid config file for this script"
    config['exp_name'] = args.config.stem

    scene_names_all = get_dataset_scene_names(config['data'])
    assert all(s in scene_names_all for s in args.scenes), f"Some scenes {args.scenes} are not in the dataset"

    obj_info = get_common_object_infos_sam(config['grounding_sam']['class_names'])

    if args.workers > 1:
        multiprocessing.set_start_method("spawn")
        with ProcessPoolExecutor(max_workers=args.workers, initializer=_suppress_output) as executor:
            futures = {executor.submit(run_scene, s, obj_info, config, args): s for s in args.scenes}
            for done_nr, future in enumerate(as_completed(futures), 1):
                logger.info(f"Completed scene:{futures[future]},{done_nr}/{len(futures)} -> {future.result()}")
    else:
        for idx, scene_name in enumerate(args.scenes, 1):
            logger.info(f"Running generation for scene {scene_name}, {idx}/{len(args.scenes)}")
            logger.info(f"Wrote {run_scene(scene_name, obj_info, config, args)}")

    if args.visualize:
        rr.script_teardown(args)


if __name__ == '__main__':
    main()
