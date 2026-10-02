"""
Tests unitaires — SmartClass AI v4
====================================
Valide la formule mathematique de compute_engagement_score()
sur des cas limites et des scenarios reels.

Ce fichier est AUTO-SUFFISANT : il mocke cv2, mediapipe et ultralytics
pour pouvoir tourner sans GPU ni webcam (parfait pour CI ou soutenance).

Usage :
    conda activate smartclass
    python test_smartclass_ai.py

    # Ou sans l'environnement conda (Python >= 3.9 suffit) :
    python test_smartclass_ai.py

Wessup / Wess Business City — PFE 2026
"""

import sys
import types
import importlib.util

# ══════════════════════════════════════════════════════════════════
# MOCKS AUTOMATIQUES (OpenCV, MediaPipe, Ultralytics, requests)
# ══════════════════════════════════════════════════════════════════

def _build_mocks():
    """Injecte des faux modules pour eviter les imports lourds."""

    # ── cv2 ──────────────────────────────────────────────────────
    cv2 = types.ModuleType("cv2")
    cv2.VideoCapture         = lambda *a, **k: None
    cv2.FONT_HERSHEY_SIMPLEX = 0
    cv2.LINE_AA              = 16
    cv2.FILLED               = -1
    cv2.CAP_PROP_FRAME_WIDTH = 3
    cv2.CAP_PROP_FRAME_HEIGHT= 4
    cv2.CAP_PROP_FPS         = 5
    for fn in ["putText","rectangle","imshow","waitKey","line","circle",
               "polylines","ellipse","arrowedLine","addWeighted",
               "destroyAllWindows","namedWindow","setWindowProperty",
               "imencode","cvtColor","resize","copyMakeBorder",
               "getTextSize","fillPoly"]:
        setattr(cv2, fn, lambda *a, **k: None)
    cv2.waitKey = lambda *a: -1
    sys.modules["cv2"] = cv2

    # ── numpy (on utilise le vrai si dispo, sinon fake minimal) ──
    try:
        import numpy  # noqa
    except ImportError:
        np = types.ModuleType("numpy")
        np.array  = lambda x, **k: x
        np.zeros  = lambda *a, **k: []
        np.mean   = lambda x: sum(x)/len(x) if x else 0
        np.std    = lambda x: 0
        sys.modules["numpy"] = np

    # ── mediapipe ────────────────────────────────────────────────
    mp = types.ModuleType("mediapipe")
    mp_sol = types.ModuleType("mediapipe.solutions")
    mp_fm  = types.ModuleType("mediapipe.solutions.face_mesh")
    mp_du  = types.ModuleType("mediapipe.solutions.drawing_utils")
    mp_ds  = types.ModuleType("mediapipe.solutions.drawing_styles")

    class _FakeFM:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def process(self, img): return types.SimpleNamespace(multi_face_landmarks=None)

    mp_fm.FaceMesh = _FakeFM
    mp_fm.FACEMESH_TESSELATION = []
    mp.solutions = mp_sol
    mp_sol.face_mesh       = mp_fm
    mp_sol.drawing_utils   = mp_du
    mp_sol.drawing_styles  = mp_ds
    sys.modules["mediapipe"]                          = mp
    sys.modules["mediapipe.solutions"]                = mp_sol
    sys.modules["mediapipe.solutions.face_mesh"]      = mp_fm
    sys.modules["mediapipe.solutions.drawing_utils"]  = mp_du
    sys.modules["mediapipe.solutions.drawing_styles"] = mp_ds

    # ── ultralytics ──────────────────────────────────────────────
    ul = types.ModuleType("ultralytics")
    class _FakeYOLO:
        def __init__(self, *a, **k): pass
        def __call__(self, *a, **k): return []
    ul.YOLO = _FakeYOLO
    sys.modules["ultralytics"] = ul

    # ── requests ──────────────────────────────────────────────────
    req = types.ModuleType("requests")
    req.post = lambda *a, **k: types.SimpleNamespace(status_code=200, ok=True)
    req.get  = lambda *a, **k: types.SimpleNamespace(status_code=200, ok=True)
    req.exceptions = types.SimpleNamespace(RequestException=Exception)
    sys.modules["requests"] = req

    # ── session_tracker ───────────────────────────────────────────
    st = types.ModuleType("session_tracker")
    class _FakeST:
        def __init__(self, *a, **k): pass
        def record_frame(self, *a, **k): pass
        def get_global_metrics(self): return {}
        def end_session(self): return {}
    st.SessionTracker = _FakeST
    sys.modules["session_tracker"] = st

_build_mocks()

# ══════════════════════════════════════════════════════════════════
# IMPORT DE LA FONCTION A TESTER
# ══════════════════════════════════════════════════════════════════

import os, pathlib

# Chercher smartclass_ai.py dans le meme dossier que ce test
_test_dir = pathlib.Path(__file__).parent
_module_path = _test_dir / "smartclass_ai.py"

if not _module_path.exists():
    print(f"[ERREUR] smartclass_ai.py introuvable dans {_test_dir}")
    sys.exit(1)

spec = importlib.util.spec_from_file_location("smartclass_ai", _module_path)
_mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(_mod)
except Exception as e:
    print(f"[ERREUR] Chargement de smartclass_ai.py echoue : {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)

compute_engagement_score = _mod.compute_engagement_score
print("[OK] compute_engagement_score chargee depuis smartclass_ai.py\n")


# ══════════════════════════════════════════════════════════════════
# FRAMEWORK DE TEST MINIMAL
# ══════════════════════════════════════════════════════════════════

_passed = 0
_failed = 0

def check(nom, score, condition, note=""):
    global _passed, _failed
    ok = condition(score)
    tag = "[PASS]" if ok else "[FAIL]"
    if ok:
        _passed += 1
    else:
        _failed += 1
    print(f"  {tag} {nom:<50s} => {score:5.1f}%  {note}")


# ══════════════════════════════════════════════════════════════════
# GROUPE 1 — Bornes absolues [0, 100]
# ══════════════════════════════════════════════════════════════════
print("── GROUPE 1 : Score toujours dans [0, 100] ─────────────────")

s = compute_engagement_score(0.0, 0.9, 1.0, 1.0, 60, 0.0, 1.0, False, False, True)
check("Pire scenario : tout a zero + phone", s, lambda x: 0.0 <= x <= 100.0, "borne inf")

s = compute_engagement_score(1.0, 0.0, 0.0, 0.0, 14, 100.0, 0.0, True, True, False)
check("Meilleur scenario : tout parfait", s, lambda x: 0.0 <= x <= 100.0, "borne sup")

# ══════════════════════════════════════════════════════════════════
# GROUPE 2 — Etudiant tres engage (score > 70)
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 2 : Etudiant tres engage ─────────────────────────")

s = compute_engagement_score(
    ear_norm=1.0, mar=0.10, yaw_norm=0.02, pitch=0.01,
    blink_rate=14, head_stability=90, gaze_x=0.05,
    is_nodding=False, hand_raised=False, phone=False
)
check("Attentif standard", s, lambda x: x > 70, "attendu > 70")

s2 = compute_engagement_score(
    ear_norm=0.95, mar=0.05, yaw_norm=0.01, pitch=0.01,
    blink_rate=12, head_stability=95, gaze_x=0.02,
    is_nodding=True, hand_raised=True, phone=False
)
check("Main levee + hochement de tete", s2, lambda x: x > 80, "bonus actifs => > 80")

# ══════════════════════════════════════════════════════════════════
# GROUPE 3 — Penalite telephone (-40 pts)
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 3 : Penalite telephone ───────────────────────────")

base = dict(ear_norm=0.90, mar=0.10, yaw_norm=0.05, pitch=0.03,
            blink_rate=15, head_stability=85, gaze_x=0.10,
            is_nodding=False, hand_raised=False)

s_sans = compute_engagement_score(**base, phone=False)
s_avec = compute_engagement_score(**base, phone=True)

check("phone=True penalise d'au moins 35 pts", s_avec,
      lambda x: (s_sans - x) >= 35, f"sans={s_sans:.1f} avec={s_avec:.1f}")
check("Score avec phone >= 0 (pas negatif)", s_avec,
      lambda x: x >= 0.0)

# ══════════════════════════════════════════════════════════════════
# GROUPE 4 — Penalite baillement (MAR > 0.60)
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 4 : Penalite baillement ──────────────────────────")

base2 = dict(ear_norm=0.85, yaw_norm=0.05, pitch=0.02,
             blink_rate=14, head_stability=80, gaze_x=0.08,
             is_nodding=False, hand_raised=False, phone=False)

s_normal  = compute_engagement_score(mar=0.20, **base2)
s_baille  = compute_engagement_score(mar=0.65, **base2)
s_fort    = compute_engagement_score(mar=0.85, **base2)

check("MAR=0.65 (leger) moins bon que MAR=0.20", s_baille,
      lambda x: x < s_normal, f"normal={s_normal:.1f} leger={s_baille:.1f}")
check("MAR=0.85 (fort) <= MAR=0.65 (leger)", s_fort,
      lambda x: x <= s_baille, f"fort={s_fort:.1f} <= leger={s_baille:.1f}")
check("Score avec baillement fort >= 0", s_fort,
      lambda x: x >= 0.0)

# ══════════════════════════════════════════════════════════════════
# GROUPE 5 — Taux de clignement anormal
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 5 : Taux de clignement ───────────────────────────")

base3 = dict(ear_norm=0.90, mar=0.10, yaw_norm=0.03, pitch=0.02,
             head_stability=85, gaze_x=0.05,
             is_nodding=False, hand_raised=False, phone=False)

s_norm_blink = compute_engagement_score(blink_rate=14, **base3)
s_hyper      = compute_engagement_score(blink_rate=35, **base3)
s_zero       = compute_engagement_score(blink_rate=0,  **base3)

check("Clignement excessif (35 bpm) < normal (14 bpm)", s_hyper,
      lambda x: x < s_norm_blink, f"normal={s_norm_blink:.1f} hyper={s_hyper:.1f}")
check("Absence clignement (0 bpm) < normal", s_zero,
      lambda x: x < s_norm_blink, f"normal={s_norm_blink:.1f} zero={s_zero:.1f}")

# ══════════════════════════════════════════════════════════════════
# GROUPE 6 — Orientation de la tete
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 6 : Orientation tete ─────────────────────────────")

base4 = dict(ear_norm=0.90, mar=0.10, blink_rate=14,
             head_stability=85, gaze_x=0.05,
             is_nodding=False, hand_raised=False, phone=False)

s_face   = compute_engagement_score(yaw_norm=0.01, pitch=0.01, **base4)
s_tourne = compute_engagement_score(yaw_norm=0.35, pitch=0.25, **base4)

check("Tete tournee (yaw=0.35) < face camera (yaw=0.01)", s_tourne,
      lambda x: x < s_face, f"face={s_face:.1f} tourne={s_tourne:.1f}")

# ══════════════════════════════════════════════════════════════════
# GROUPE 7 — Monotonie EAR croissant => score croissant
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 7 : Monotonie de la formule ──────────────────────")

ears = [0.4, 0.6, 0.8, 0.95]
scores_ear = [
    compute_engagement_score(
        ear_norm=e, mar=0.10, yaw_norm=0.02, pitch=0.01,
        blink_rate=14, head_stability=85, gaze_x=0.05,
        is_nodding=False, hand_raised=False, phone=False
    )
    for e in ears
]
monotone_ear = all(scores_ear[i] <= scores_ear[i+1] for i in range(len(scores_ear)-1))
check("EAR croissant => score croissant",
      1.0 if monotone_ear else 0.0, lambda x: x == 1.0,
      str(list(zip([round(e,2) for e in ears], [round(s,1) for s in scores_ear]))))

# ══════════════════════════════════════════════════════════════════
# GROUPE 8 — Stabilite tete
# ══════════════════════════════════════════════════════════════════
print("\n── GROUPE 8 : Stabilite de la tete ─────────────────────────")

base5 = dict(ear_norm=0.85, mar=0.10, yaw_norm=0.03, pitch=0.02,
             blink_rate=14, gaze_x=0.05,
             is_nodding=False, hand_raised=False, phone=False)

s_stable  = compute_engagement_score(head_stability=95, **base5)
s_agite   = compute_engagement_score(head_stability=10, **base5)

check("Tete stable (95) > tete agitee (10)", s_stable,
      lambda x: x > s_agite, f"stable={s_stable:.1f} agite={s_agite:.1f}")

# ══════════════════════════════════════════════════════════════════
# RÉSUMÉ
# ══════════════════════════════════════════════════════════════════
total = _passed + _failed
print(f"\n{'='*60}")
print(f"  RESULTATS FINAUX : {_passed}/{total} tests passes")
if _failed == 0:
    print("  [OK] Tous les tests sont passes — formule validee.")
else:
    print(f"  [!!] {_failed} test(s) echoue(s) — verifier compute_engagement_score()")
print(f"{'='*60}\n")

sys.exit(0 if _failed == 0 else 1)
