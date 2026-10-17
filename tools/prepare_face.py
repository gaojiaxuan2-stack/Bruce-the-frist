#!/usr/bin/env python3
"""Turn a selfie into the assets used by the "Face" particle scene.

Outputs (in --out, default assets/face):
  color.jpg  - the photo, resized (RGB)
  data.png   - R = depth (255 = nearest to camera), G = person mask,
               B = body-part label * 50 (0 bg, 1 hair, 2 body skin,
               3 face skin, 4 clothes, 5 other)
  meta.json  - size + a few normalized face landmarks

Depth is built from MediaPipe models (no internet depth model needed):
  * selfie_multiclass segmenter  -> person mask + hair/face/clothes labels
  * face_landmarker (478 3D pts) -> real relief of the face (nose, eyes, lips)
  * a head ellipsoid + a rounded body "dome" fill in hair, neck and shoulders.

Usage:
  pip install mediapipe opencv-python-headless numpy scipy pillow
  python tools/prepare_face.py path/to/selfie.jpg
"""
import argparse
import json
import os
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.interpolate import griddata

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

MODELS = {
    "segmenter": "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
    "selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
    "face": "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task",
}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")

# Landmark indices of the MediaPipe face mesh.
FACE_LEFT, FACE_RIGHT, FOREHEAD, CHIN, NOSE_TIP = 234, 454, 10, 152, 1
LEFT_EYE, RIGHT_EYE, MOUTH = (33, 133), (362, 263), (13, 14)


def model_path(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(MODELS[name]))
    if not os.path.exists(path):
        print("downloading", MODELS[name])
        urllib.request.urlretrieve(MODELS[name], path)
    return path


def segment(rgb):
    opts = vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=model_path("segmenter")),
        output_confidence_masks=True,
        output_category_mask=True,
    )
    with vision.ImageSegmenter.create_from_options(opts) as seg:
        res = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    labels = np.squeeze(res.category_mask.numpy_view()).astype(np.uint8)
    person = 1.0 - np.squeeze(res.confidence_masks[0].numpy_view()).astype(np.float32)
    return person, labels


def face_landmarks(rgb):
    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path("face")), num_faces=1
    )
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not res.face_landmarks:
        raise SystemExit("No face found in the photo - try a brighter, front-facing selfie.")
    h, w = rgb.shape[:2]
    pts = res.face_landmarks[0]
    # x, y in pixels; z in pixels too (MediaPipe uses roughly the x scale), +z = closer.
    return np.array([[p.x * w, p.y * h, -p.z * w] for p in pts], dtype=np.float32)


def build_depth(person, labels, lm):
    h, w = person.shape
    mask = person > 0.5
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    # Rounded body: distance to the silhouette edge, eased so edges curve away.
    dist = ndimage.distance_transform_edt(mask)
    body_r = 0.16 * w
    body = 0.55 * body_r * np.sqrt(np.clip(dist / body_r, 0, 1))

    # Head ellipsoid sized from the face landmarks (covers hair + ears).
    fw = np.linalg.norm(lm[FACE_LEFT, :2] - lm[FACE_RIGHT, :2])
    fh = np.linalg.norm(lm[FOREHEAD, :2] - lm[CHIN, :2])
    cx = (lm[FACE_LEFT, 0] + lm[FACE_RIGHT, 0]) / 2
    cy = (lm[FOREHEAD, 1] + lm[CHIN, 1]) / 2 - 0.12 * fh
    ax, ay, az = 0.78 * fw, 0.85 * fh, 0.62 * fw
    r = np.sqrt(((xx - cx) / ax) ** 2 + ((yy - cy) / ay) ** 2)
    # The head sits in front of the shoulders; the lift fades out over hair tips and neck.
    lift = 0.35 * fw * np.clip((1.6 - r) / 0.6, 0, 1) ** 2
    head = az * np.sqrt(np.clip(1 - r * r, 0, 1)) + lift
    depth = np.maximum(body, head) * mask
    depth = ndimage.gaussian_filter(depth, sigma=0.012 * w) * mask

    # Real face relief from the 3D landmarks, matched to the ellipsoid at the oval.
    oval = [c.start for c in vision.FaceLandmarksConnections.FACE_LANDMARKS_FACE_OVAL]
    face_z = griddata(lm[:, :2], lm[:, 2], (xx, yy), method="linear")
    inside = ~np.isnan(face_z)
    ox = np.clip(lm[oval, 0].astype(int), 0, w - 1)
    oy = np.clip(lm[oval, 1].astype(int), 0, h - 1)
    shift = np.mean(depth[oy, ox]) - np.mean(lm[oval, 2])
    face_depth = np.where(inside, np.nan_to_num(face_z) + shift, 0)
    feather = ndimage.gaussian_filter(inside.astype(np.float32), sigma=0.02 * w)
    feather = np.clip((feather - 0.5) * 2.2, 0, 1) * inside
    depth = depth * (1 - feather) + np.maximum(depth, face_depth) * feather

    depth = ndimage.gaussian_filter(depth * mask, sigma=1.5)
    depth = np.clip(depth / max(depth.max(), 1e-6), 0, 1)
    return depth * mask


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "face"))
    ap.add_argument("--width", type=int, default=768)
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    img = img.resize((args.width, round(img.height * args.width / img.width)), Image.LANCZOS)
    rgb = np.asarray(img).copy()
    h, w = rgb.shape[:2]

    person, labels = segment(rgb)
    lm = face_landmarks(rgb)
    depth = build_depth(person, labels, lm)
    soft_mask = ndimage.gaussian_filter(person, sigma=1.0)

    os.makedirs(args.out, exist_ok=True)
    img.save(os.path.join(args.out, "color.jpg"), quality=90)
    data = np.stack(
        [
            (depth * 255).round(),
            (np.clip(soft_mask, 0, 1) * 255).round(),
            np.where(person > 0.5, labels, 0) * 50,
        ],
        axis=-1,
    ).astype(np.uint8)
    Image.fromarray(data, "RGB").save(os.path.join(args.out, "data.png"), optimize=True)

    def norm(i):
        return {"x": round(float(lm[i, 0] / w), 4), "y": round(float(lm[i, 1] / h), 4)}

    def mid(a, b):
        return {"x": round(float((lm[a, 0] + lm[b, 0]) / 2 / w), 4), "y": round(float((lm[a, 1] + lm[b, 1]) / 2 / h), 4)}

    xs, ys = lm[:, 0] / w, lm[:, 1] / h
    meta = {
        "width": w,
        "height": h,
        "face": {
            "x": round(float(xs.min()), 4),
            "y": round(float(ys.min()), 4),
            "w": round(float(xs.max() - xs.min()), 4),
            "h": round(float(ys.max() - ys.min()), 4),
        },
        "leftEye": mid(*LEFT_EYE),
        "rightEye": mid(*RIGHT_EYE),
        "noseTip": norm(NOSE_TIP),
        "mouth": mid(*MOUTH),
    }
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"wrote {args.out} ({w}x{h}), person pixels: {int((person > 0.5).sum())}")


if __name__ == "__main__":
    main()
