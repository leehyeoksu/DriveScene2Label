#!/usr/bin/bash
# ---- Edit for your account and cluster. #SBATCH lines cannot use variables. ----
#SBATCH -J vlm-scenes
#SBATCH --gres=gpu:normal:1
#SBATCH --cpus-per-gpu=8
#SBATCH --mem-per-gpu=29G
#SBATCH -p batch_ugrad
##SBATCH -w <node>        # optional: pin a node by removing one leading '#'
#SBATCH -t 1-0
#SBATCH -o logs/slurm-%A.out

# Runs VESPA-Direct on the given scenes and writes a final label JSON per scene (outs/vlm/<exp>/#out_labels_scene/<scene>/).
# Copy next to main_pseudo_vlm_scene.py in the VESPA repo root (see ai-server/VESPA_Seraph.md).
# Usage: EXP=p_final SCENES="scene-0001 scene-0002" sbatch pseudo_scenes_lowmem.sh
# EXP=p_final for mini, p_final_trainval for trainval. One process only: trainval metadata alone uses ~9 GB RAM.

# Conda install and env that hold the VESPA dependencies. Edit the defaults for your account.
CONDA_SH="${CONDA_SH:-$HOME/anaconda3/etc/profile.d/conda.sh}"
CONDA_ENV="${CONDA_ENV:-vespa}"

source "$CONDA_SH"
conda activate "$CONDA_ENV"
export PYTHONUNBUFFERED=1
export TORCH_CUDA_ARCH_LIST="6.1;7.0;7.5;8.0;8.6;8.9+PTX"

EXP="${EXP:-p_final_trainval}"
SCENES="${SCENES:?set SCENES, e.g. SCENES=\"scene-0001 scene-0002\"}"

pwd
hostname
which python
python main_pseudo_vlm_scene.py --config "configs/vlm/${EXP}.yaml" --scenes $SCENES
# Always 0: the DriveScene2Label AI server judges success by a fresh output JSON, not the exit code.
exit 0
