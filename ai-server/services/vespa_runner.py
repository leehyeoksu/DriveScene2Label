"""External adapter executed in VESPA's environment. Does not edit upstream files."""
import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace


def main():
    p = argparse.ArgumentParser()
    for name in ("repo", "config", "scene", "output-root", "data-root", "dataset-version"):
        p.add_argument("--"+name, required=True)
    p.add_argument("--class-mode", type=int, choices=(1,3,8), required=True)
    a = p.parse_args()
    sys.path.insert(0, str(Path(a.repo).resolve()))
    import yaml
    import numpy as np
    # Bridge upstream NumPy 1.x/2.x aliases in this subprocess only.
    # Scope compatibility to the isolated subprocess; leave upstream files intact.
    np.__dict__.setdefault("bool", np.bool_)
    np.__dict__.setdefault("concat", np.concatenate)
    np.__dict__.setdefault("atan2", np.arctan2)
    np.__dict__.setdefault("int", int)
    import main_pseudo_union
    import main_pseudo_vlm
    from src.labeling.submission import _get_annotation_dict
    from src.labeling.prior_info import get_common_object_infos_sam

    path = Path(a.config)
    config = yaml.safe_load(path.read_text())
    if config["type"] != "vlm" or config["data"]["dataset"] != "nuscenes":
        raise ValueError("Expected nuScenes VLM configuration")
    config["exp_name"] = path.stem
    config["data"]["root_path"] = a.data_root
    config["data"]["dataset_version"] = a.dataset_version
    main_pseudo_union.EXP_PSEUDO_OUT_PATH = Path(a.output_root).resolve() / "outs"
    infos = get_common_object_infos_sam(config["grounding_sam"]["class_names"])
    annotations, split = main_pseudo_vlm.process_scene(a.scene, infos, config, SimpleNamespace(visualize=False))
    mapping = f"{a.class_mode}class"
    payload = {"split": split, "mapping_name": mapping,
        "meta": {"use_camera": True, "use_lidar": True, "use_radar": False, "use_map": False, "use_external": False},
        "results": {token: [_get_annotation_dict(box, token) for box in boxes]
                    for token, boxes in annotations[mapping].items()}}
    output = main_pseudo_union.get_out_dir(config, "#out_labels") / f"vlm_{config['exp_name']}_{a.scene}_{mapping}.json"
    output.write_text(json.dumps(payload, indent=2, allow_nan=False))

if __name__ == "__main__":
    main()
