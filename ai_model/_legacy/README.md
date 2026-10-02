# _legacy/ — Ancien pipeline ML sklearn

Ce dossier contient les fichiers de l'ancienne approche GradientBoosting
entrainee sur donnees synthetiques (R²=1.000 — overfitting complet).

## Pourquoi abandonne ?

Le modele GradientBoosting a ete entraine sur un dataset synthetique genere
artificiellement (circular reasoning). Un R²=1.000 sur donnees inventees
n'a aucune valeur scientifique.

## Remplacement

L'approche actuelle (SmartClass AI v4) utilise une formule mathematique
ponderee basee sur des indicateurs biometriques valides scientifiquement :

  - EAR 30%  — Soukupova & Cech (2016)
  - HEAD 25% — geometrie faciale 2D
  - BLINK 20% — Taux de clignement (8-20 bpm = normal)
  - STAB 15% — Stabilite de tete (std sur 30 frames)
  - GAZE 10%  — Direction du regard (iris tracking)

## Fichiers

- ml_model/engagement_classifier.pkl        — Modele GradientBoosting (234 KB)
- ml_model/engagement_classifier_scaler.pkl — StandardScaler associe
- collect_dataset.py                        — Collecteur de dataset par keypress
- evaluate_model.py                         — Script d'evaluation R²/accuracy
- detect_engagement.py                      — Ancien script de detection
